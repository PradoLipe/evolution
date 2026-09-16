// Leitura local da tabela operacional. A imagem nunca sai do navegador e
// nunca e persistida; somente os valores estruturados permanecem em memoria
// durante o fluxo de relatorio/registro.
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.EvolutionPhotoOCR = api;
    if (typeof EvolutionApp !== 'undefined') api.install(EvolutionApp);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const MAX_FILE_SIZE = 15 * 1024 * 1024;
    const MIN_IMAGE_WIDTH = 600;
    const MIN_IMAGE_HEIGHT = 300;
    const VALUE_CONFIDENCE = 52;
    // Refinamento por celula (2a passada, somente digitos)
    const CELL_INK_RATIO = 0.004;      // abaixo disso a celula nao tem tinta -> sem producao
    const CELL_MIN_RANGE = 45;         // contraste minimo para considerar que ha algo escrito
    const REFINED_CONFIDENCE = 62;     // confianca minima para aceitar a leitura da celula
    const GEOMETRY_CONFIDENCE = 55;    // idem, quando a geometria ja confirmou a quantidade de digitos
    const REFINED_AGREEMENT = 74;      // confianca para a celula vencer a 1a passada em caso de divergencia
    const MAX_REFINED_CELLS = 180;     // trava de seguranca (performance no celular)

    const hourKey = value => String(value).padStart(2, '0');

    function normalizeLbs(value) {
        const match = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^(?:LBS)?0*(\d{1,2})$/);
        if (!match) return null;
        const number = Number(match[1]);
        if (!Number.isInteger(number) || number < 1 || number > 99) return null;
        return `LBS ${String(number).padStart(2, '0')}`;
    }

    function parseNumericToken(raw, max = 999999) {
        const source = String(raw || '').trim().toUpperCase();
        if (!source) return null;
        const compact = source.replace(/[.,:;()[\]{}]/g, '');
        const normalized = compact.replace(/O/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5');
        if (!/^\d+$/.test(normalized)) return null;
        const value = Number(normalized);
        if (!Number.isSafeInteger(value) || value < 0 || value > max) return null;
        return { value, altered: normalized !== compact, raw: source };
    }

    function parseHourToken(raw) {
        const source = String(raw || '').trim().toUpperCase();
        if (!source) return null;
        const normalized = source
            .replace(/O/g, '0')
            .replace(/[IL|]/g, '1')
            .replace(/\s/g, '')
            .replace(/[.;]/g, ':');
        let match = normalized.match(/^([01]?\d|2[0-3])(?::?00)?$/);
        if (!match) return null;
        const hour = Number(match[1]);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
        const canonical = `${String(hour).padStart(2, '0')}:00`;
        const compactCanonical = canonical.replace(':', '');
        const compactSource = normalized.replace(':', '').padStart(4, '0');
        return {
            value: hour,
            altered: compactSource !== compactCanonical,
            raw: source
        };
    }

    function parseTsvTokens(tsv) {
        return String(tsv || '').split(/\r?\n/).slice(1).map((line, index) => {
            const parts = line.split('\t');
            if (parts.length < 12 || Number(parts[0]) !== 5) return null;
            const left = Number(parts[6]);
            const top = Number(parts[7]);
            const width = Number(parts[8]);
            const height = Number(parts[9]);
            const confidence = Number(parts[10]);
            const text = parts.slice(11).join('\t').trim();
            if (!text || ![left, top, width, height].every(Number.isFinite)) return null;
            return {
                id: index,
                text,
                confidence: Number.isFinite(confidence) ? confidence : 0,
                left,
                top,
                width,
                height,
                cx: left + width / 2,
                cy: top + height / 2
            };
        }).filter(Boolean);
    }

    function looksLikeLbs(text) {
        const normalized = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return /^L(?:B|8)(?:S|5)$/.test(normalized);
    }

    function combinedLbs(text) {
        const normalized = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const match = normalized.match(/^L(?:B|8)(?:S|5)0*(\d{1,2})$/);
        return match ? normalizeLbs(match[1]) : null;
    }

    function findRows(tokens) {
        const rows = [];
        const used = new Set();

        tokens.forEach(token => {
            const key = combinedLbs(token.text);
            if (!key) return;
            rows.push({ key, y: token.cy, x: token.cx, confidence: token.confidence, tokenIds: [token.id] });
            used.add(token.id);
        });

        tokens.forEach(label => {
            if (used.has(label.id) || !looksLikeLbs(label.text)) return;
            const candidates = tokens.filter(token => {
                if (token.id === label.id || token.cx <= label.cx) return false;
                const number = parseNumericToken(token.text, 99);
                const sameRow = Math.abs(token.cy - label.cy) <= Math.max(label.height, token.height) * 0.85;
                const closeEnough = token.left - (label.left + label.width) <= Math.max(85, label.height * 4.5);
                return number && number.value > 0 && sameRow && closeEnough;
            }).sort((a, b) => a.left - b.left);
            if (!candidates.length) return;
            const numberToken = candidates[0];
            const number = parseNumericToken(numberToken.text, 99);
            const key = normalizeLbs(number.value);
            rows.push({
                key,
                y: (label.cy + numberToken.cy) / 2,
                x: Math.min(label.cx, numberToken.cx),
                confidence: Math.min(label.confidence, numberToken.confidence) - (number.altered ? 22 : 0),
                tokenIds: [label.id, numberToken.id]
            });
            used.add(label.id);
            used.add(numberToken.id);
        });

        const bestByKey = new Map();
        rows.forEach(row => {
            const current = bestByKey.get(row.key);
            if (!current || row.confidence > current.confidence) bestByKey.set(row.key, row);
        });
        return Array.from(bestByKey.values()).sort((a, b) => a.y - b.y);
    }

    function clusterTokensByY(tokens) {
        const sorted = [...tokens].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
        const clusters = [];
        sorted.forEach(token => {
            const tolerance = Math.max(10, token.height * 0.8);
            let cluster = clusters.find(item => Math.abs(item.y - token.cy) <= Math.max(tolerance, item.height * 0.8));
            if (!cluster) {
                cluster = { y: token.cy, height: token.height, tokens: [] };
                clusters.push(cluster);
            }
            cluster.tokens.push(token);
            cluster.y = cluster.tokens.reduce((sum, item) => sum + item.cy, 0) / cluster.tokens.length;
            cluster.height = Math.max(cluster.height, token.height);
        });
        return clusters;
    }

    function findHeaders(tokens, rows) {
        const firstRowY = rows.length ? Math.min(...rows.map(row => row.y)) : Infinity;
        const rowTokenIds = new Set(rows.flatMap(row => row.tokenIds));
        const candidates = clusterTokensByY(tokens.filter(token => !rowTokenIds.has(token.id))).map(cluster => {
            const hours = [];
            cluster.tokens.forEach(token => {
                const parsed = parseHourToken(token.text);
                if (!parsed) return;
                hours.push({
                    hour: parsed.value,
                    x: token.cx,
                    y: token.cy,
                    confidence: token.confidence - (parsed.altered ? 22 : 0),
                    tokenId: token.id
                });
            });
            const unique = Array.from(new Map(hours.sort((a, b) => b.confidence - a.confidence).map(item => [item.hour, item])).values()).sort((a, b) => a.x - b.x);
            const ascendingPairs = unique.slice(1).filter((item, index) => item.hour > unique[index].hour).length;
            const descendingPairs = unique.slice(1).filter((item, index) => item.hour < unique[index].hour).length;
            const orderedPairs = Math.max(ascendingPairs, descendingPairs);
            const aboveRows = cluster.y < firstRowY;
            const score = unique.length * 10 + orderedPairs * 2 + (aboveRows ? 45 : 0);
            return { ...cluster, hours: unique, score, aboveRows };
        }).filter(candidate => candidate.hours.length >= 3);

        candidates.sort((a, b) => b.score - a.score || a.y - b.y);
        return candidates.length ? candidates[0].hours : [];
    }

    function buildCellsFromCoordinates(tokens, rows, headers) {
        const excluded = new Set([
            ...rows.flatMap(row => row.tokenIds),
            ...headers.map(header => header.tokenId)
        ]);
        const sortedHeaders = [...headers].sort((a, b) => a.x - b.x);
        const sortedRows = [...rows].sort((a, b) => a.y - b.y);
        const result = {};

        sortedRows.forEach((row, rowIndex) => {
            const previous = sortedRows[rowIndex - 1];
            const next = sortedRows[rowIndex + 1];
            const top = previous ? (previous.y + row.y) / 2 : row.y - (next ? (next.y - row.y) / 2 : 40);
            const bottom = next ? (row.y + next.y) / 2 : row.y + (previous ? (row.y - previous.y) / 2 : 40);
            result[row.key] = {};

            sortedHeaders.forEach((header, columnIndex) => {
                const previousHeader = sortedHeaders[columnIndex - 1];
                const nextHeader = sortedHeaders[columnIndex + 1];
                const left = previousHeader ? (previousHeader.x + header.x) / 2 : header.x - (nextHeader ? (nextHeader.x - header.x) / 2 : 35);
                const right = nextHeader ? (header.x + nextHeader.x) / 2 : header.x + (previousHeader ? (header.x - previousHeader.x) / 2 : 35);
                const matches = tokens.filter(token => {
                    if (excluded.has(token.id) || token.cy <= top || token.cy >= bottom || token.cx <= left || token.cx >= right) return false;
                    return Boolean(parseNumericToken(token.text));
                }).map(token => {
                    const parsed = parseNumericToken(token.text);
                    const confidence = token.confidence - (parsed.altered ? 25 : 0);
                    const distance = Math.abs(token.cx - header.x) / Math.max(1, right - left) + Math.abs(token.cy - row.y) / Math.max(1, bottom - top);
                    return { token, parsed, confidence, distance };
                }).sort((a, b) => a.distance - b.distance || b.confidence - a.confidence);

                if (!matches.length) return;
                const match = matches[0];
                const repeatedOne = match.parsed.value === 1
                    && /^[1IL|]$/i.test(String(match.token.text || '').trim())
                    && match.token.width >= match.token.height * 1.05;
                const value = repeatedOne ? 11 : match.parsed.value;
                const confidence = match.confidence - (repeatedOne ? 8 : 0);
                result[row.key][hourKey(header.hour)] = {
                    value: confidence >= VALUE_CONFIDENCE ? value : null,
                    confidence: Math.round(confidence),
                    raw: match.token.text,
                    uncertain: confidence < VALUE_CONFIDENCE
                };
            });
        });
        return result;
    }

    function parseTextFallback(text) {
        const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const headerLine = lines.map((line, index) => ({
            index,
            hours: line.split(/\s+/).map(token => parseHourToken(token)).filter(Boolean).map(item => item.value)
        })).filter(item => item.hours.length >= 3).sort((a, b) => b.hours.length - a.hours.length)[0];
        if (!headerLine) return { headers: [], rows: {} };

        const headers = headerLine.hours.map((hour, index) => ({ hour, x: index, confidence: 60, tokenId: `fallback-${index}` }));
        const rows = {};
        lines.slice(headerLine.index + 1).forEach(line => {
            const match = line.toUpperCase().match(/L(?:B|8)(?:S|5)\s*0*(\d{1,2})\s+(.+)/);
            if (!match) return;
            const key = normalizeLbs(match[1]);
            const values = (match[2].match(/[0-9OIL|]+/g) || []).map(token => parseNumericToken(token)).filter(Boolean);
            if (!key || !values.length) return;
            rows[key] = {};
            headers.forEach((header, index) => {
                const parsed = values[index];
                if (!parsed) return;
                const confidence = parsed.altered ? 35 : 60;
                rows[key][hourKey(header.hour)] = {
                    value: confidence >= VALUE_CONFIDENCE ? parsed.value : null,
                    confidence,
                    raw: parsed.raw,
                    uncertain: confidence < VALUE_CONFIDENCE
                };
            });
        });
        return { headers, rows };
    }

    function parseOcrResult(tsv, text) {
        const tokens = parseTsvTokens(tsv);
        const rowDefinitions = findRows(tokens);
        const headers = findHeaders(tokens, rowDefinitions);
        let rows = headers.length && rowDefinitions.length ? buildCellsFromCoordinates(tokens, rowDefinitions, headers) : {};
        let finalHeaders = headers;
        let usedFallback = false;

        if (!headers.length || !Object.keys(rows).length) {
            const fallback = parseTextFallback(text);
            finalHeaders = fallback.headers;
            rows = fallback.rows;
            usedFallback = true;
        }

        return {
            rows,
            hours: finalHeaders.map(header => hourKey(header.hour)),
            usedFallback,
            recognizedRows: Object.keys(rows).length,
            // Posicoes reais (px) usadas pelo refinamento celula a celula.
            // No fallback de texto puro nao existem coordenadas confiaveis.
            layout: usedFallback ? null : { headers: finalHeaders, rows: rowDefinitions }
        };
    }

    // As colunas operacionais representam a hora de ABERTURA do intervalo de
    // producao: a coluna "07:00" contem a producao realizada entre 07:00 e
    // 08:00. Por isso, o turno deve comecar exatamente na hora inicial
    // configurada (hora inicial INCLUSIVA) e seguir ate a hora anterior a
    // hora final (hora final EXCLUSIVA), sem qualquer deslocamento de +1/-1.
    // Ex.: 07x15 -> 07..14 | 15x23 -> 15..22 (dividido em 15..18 e 19..22
    // para preservar os campos P1/P2 ja existentes) | 23x07 -> 23..06,
    // respeitando a virada do dia.
    // NAO adicionar excecoes especificas por turno aqui: qualquer turno no
    // formato HHxHH deve funcionar a partir desta unica regra.
    function hoursStartingInPeriod(start, end) {
        const hours = [];
        let current = ((start % 24) + 24) % 24;
        const stop = ((end % 24) + 24) % 24;
        let guard = 0;
        while (guard++ < 24) {
            hours.push(hourKey(current));
            const next = (current + 1) % 24;
            if (next === stop) break;
            current = next;
        }
        return hours;
    }

    function getTurnSegments(turno) {
        const match = String(turno || '').match(/^(\d{2})x(\d{2})$/);
        if (!match) return [];
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (turno === '15x23') {
            return [
                { label: '15h-19h', hours: hoursStartingInPeriod(15, 19) },
                { label: '19h-23h', hours: hoursStartingInPeriod(19, 23) }
            ];
        }
        return [{ label: 'Produção Total', hours: hoursStartingInPeriod(start, end) }];
    }

    // Distingue os tres estados possiveis de uma celula lida por OCR:
    //  - 'recognized' (VERDE): valor numerico extraido com confianca.
    //  - 'empty' (AMARELO): nenhuma celula/token foi encontrado naquela
    //    posicao da grade -> assume-se 0 (sem producao), valor valido.
    //  - 'unrecognized' (VERMELHO): havia algo na celula mas o OCR nao
    //    conseguiu determinar o valor com seguranca -> exige revisao.
    function getCellStatus(cell) {
        if (cell === undefined || cell === null) return { value: 0, status: 'empty' };
        if (cell === 0 || Number.isFinite(cell)) return { value: Number(cell), status: 'recognized' };
        const raw = cell && cell.value;
        if (raw === null || raw === undefined || !Number.isFinite(raw)) return { value: null, status: 'unrecognized' };
        return { value: Number(raw), status: 'recognized' };
    }

    function aggregateRows(rows, turno, selectedKeys) {
        const segments = getTurnSegments(turno);
        const keys = selectedKeys && selectedKeys.length ? selectedKeys : Object.keys(rows || {});
        const totals = segments.map(() => 0);
        const unresolved = [];
        keys.forEach(key => {
            segments.forEach((segment, segmentIndex) => {
                segment.hours.forEach(hour => {
                    const cell = getCellStatus(rows?.[key]?.[hour]);
                    if (cell.status === 'unrecognized') unresolved.push({ key, hour });
                    else totals[segmentIndex] += cell.value;
                });
            });
        });
        return { totals, unresolved, segments, keys };
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function findVisibleContentBounds(imageData, width, height) {
        const pixels = imageData.data;
        const rowActive = new Uint8Array(height);
        const minimumRowInk = Math.max(3, Math.floor(width * .012));
        for (let y = 0; y < height; y++) {
            let ink = 0;
            for (let x = 0; x < width; x += 2) {
                const index = (y * width + x) * 4;
                const r = pixels[index];
                const g = pixels[index + 1];
                const b = pixels[index + 2];
                const luminance = r * .299 + g * .587 + b * .114;
                if (luminance < 238 || Math.max(r, g, b) - Math.min(r, g, b) > 18) ink++;
            }
            if (ink >= minimumRowInk / 2) rowActive[y] = 1;
        }

        let top = 0;
        while (top < height && !rowActive[top]) top++;
        let bottom = height - 1;
        while (bottom > top && !rowActive[bottom]) bottom--;
        if (top >= bottom) return { left: 0, top: 0, width, height, trimmed: false };

        const columnActive = new Uint8Array(width);
        const activeHeight = bottom - top + 1;
        const minimumColumnInk = Math.max(3, Math.floor(activeHeight * .012));
        for (let x = 0; x < width; x++) {
            let ink = 0;
            for (let y = top; y <= bottom; y += 2) {
                const index = (y * width + x) * 4;
                const r = pixels[index];
                const g = pixels[index + 1];
                const b = pixels[index + 2];
                const luminance = r * .299 + g * .587 + b * .114;
                if (luminance < 238 || Math.max(r, g, b) - Math.min(r, g, b) > 18) ink++;
            }
            if (ink >= minimumColumnInk / 2) columnActive[x] = 1;
        }
        let left = 0;
        while (left < width && !columnActive[left]) left++;
        let right = width - 1;
        while (right > left && !columnActive[right]) right--;

        const padding = 4;
        left = Math.max(0, left - padding);
        top = Math.max(0, top - padding);
        right = Math.min(width - 1, right + padding);
        bottom = Math.min(height - 1, bottom + padding);
        const cropWidth = right - left + 1;
        const cropHeight = bottom - top + 1;
        const trimmed = cropWidth * cropHeight < width * height * .94;
        return trimmed
            ? { left, top, width: cropWidth, height: cropHeight, trimmed: true }
            : { left: 0, top: 0, width, height, trimmed: false };
    }

    // Capturas da tela inteira incluem graficos e paineis cujos numeros podem
    // ser confundidos com celulas. A grade operacional, porem, possui varias
    // linhas horizontais longas, neutras e alinhadas. Usamos essa assinatura
    // visual para isolar a tabela antes do OCR, sem depender da resolucao ou
    // de coordenadas fixas da tela.
    function findGridTableBounds(imageData, width, height) {
        const pixels = imageData.data;
        const minimumRun = Math.max(260, Math.floor(width * .28));
        const candidates = [];

        for (let y = 0; y < height; y++) {
            let runStart = -1;
            let bestStart = -1;
            let bestEnd = -1;
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const r = pixels[index];
                const g = pixels[index + 1];
                const b = pixels[index + 2];
                const luminance = r * .299 + g * .587 + b * .114;
                const neutralLine = luminance >= 60 && luminance <= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 30;
                if (neutralLine) {
                    if (runStart < 0) runStart = x;
                } else if (runStart >= 0) {
                    if (x - runStart > bestEnd - bestStart) {
                        bestStart = runStart;
                        bestEnd = x - 1;
                    }
                    runStart = -1;
                }
            }
            if (runStart >= 0 && width - runStart > bestEnd - bestStart) {
                bestStart = runStart;
                bestEnd = width - 1;
            }
            if (bestStart >= 0 && bestEnd - bestStart + 1 >= minimumRun) {
                candidates.push({ y, left: bestStart, right: bestEnd, length: bestEnd - bestStart + 1 });
            }
        }

        const lines = [];
        candidates.forEach(candidate => {
            const previous = lines[lines.length - 1];
            if (previous && candidate.y <= previous.bottom + 2) {
                previous.bottom = candidate.y;
                if (candidate.length > previous.best.length) previous.best = candidate;
            } else {
                lines.push({ top: candidate.y, bottom: candidate.y, best: candidate });
            }
        });
        if (lines.length < 4) return null;

        let bestGroup = [];
        lines.forEach(seed => {
            const group = lines.filter(line => {
                const overlap = Math.min(seed.best.right, line.best.right) - Math.max(seed.best.left, line.best.left) + 1;
                const shorter = Math.min(seed.best.length, line.best.length);
                const widthDifference = Math.abs(seed.best.length - line.best.length) / Math.max(seed.best.length, line.best.length);
                return overlap > 0 && overlap / shorter >= .88 && widthDifference <= .18;
            });
            const verticalSpan = group.length ? group[group.length - 1].bottom - group[0].top : 0;
            const score = group.length * 1000 + verticalSpan;
            const bestSpan = bestGroup.length ? bestGroup[bestGroup.length - 1].bottom - bestGroup[0].top : 0;
            const bestScore = bestGroup.length * 1000 + bestSpan;
            if (score > bestScore) bestGroup = group;
        });
        if (bestGroup.length < 4) return null;

        bestGroup.sort((a, b) => a.top - b.top);
        const top = bestGroup[0].top;
        const bottom = bestGroup[bestGroup.length - 1].bottom;
        if (bottom - top < Math.max(80, height * .08)) return null;

        const median = values => {
            const sorted = [...values].sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length / 2)];
        };
        const padding = Math.max(4, Math.round(width * .003));
        const left = Math.max(0, median(bestGroup.map(line => line.best.left)) - padding);
        const right = Math.min(width - 1, median(bestGroup.map(line => line.best.right)) + padding);
        const cropTop = Math.max(0, top - padding);
        const cropBottom = Math.min(height - 1, bottom + padding);
        const cropWidth = right - left + 1;
        const cropHeight = cropBottom - cropTop + 1;
        if (cropWidth < minimumRun || cropHeight < 80 || cropWidth * cropHeight > width * height * .9) return null;
        return { left, top: cropTop, width: cropWidth, height: cropHeight };
    }

    // =====================================================================
    // REFINAMENTO CELULA A CELULA (2a passada)
    //
    // A 1a passada faz OCR da tabela inteira e acerta a ESTRUTURA (quais
    // linhas sao LBS, quais colunas sao horarios). Ela erra nos casos
    // dificeis: um "0" isolado some ou vem com confianca baixa, um "15"
    // pode virar "16", e um numero da coluna vizinha (ou da linha "Paradas")
    // pode ser puxado para a celula errada, porque os limites da celula sao
    // estimados pelo ponto medio entre os cabecalhos.
    //
    // A 2a passada corrige isso usando a GRADE REAL da tabela: as linhas de
    // grade horizontais e verticais dao o retangulo exato de cada celula.
    // Cada celula e recortada, ampliada e relida com o OCR restrito a
    // 0123456789. Antes disso, um teste de tinta separa "celula vazia" de
    // "celula com conteudo" sem precisar de OCR.
    //
    // Nada aqui depende de resolucao fixa: tudo sai das linhas detectadas.
    // =====================================================================

    function clusterPositions(positions, tolerance) {
        const clusters = [];
        positions.forEach(position => {
            const last = clusters[clusters.length - 1];
            if (last && position - last[last.length - 1] <= tolerance) last.push(position);
            else clusters.push([position]);
        });
        return clusters.map(cluster => Math.round(cluster.reduce((sum, value) => sum + value, 0) / cluster.length));
    }

    // Linhas de grade sao longas, neutras (cinza) e continuas: os numeros
    // (brancos) e os rotulos (azuis) nao passam nesse filtro.
    function detectGridLines(imageData, width, height) {
        if (!imageData || !imageData.data || width < 60 || height < 40) return null;
        const pixels = imageData.data;
        const verticalHits = new Uint32Array(width);
        const horizontalHits = new Uint32Array(height);
        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            for (let x = 0; x < width; x++) {
                const index = (rowOffset + x) * 4;
                const r = pixels[index];
                const g = pixels[index + 1];
                const b = pixels[index + 2];
                const luminance = r * .299 + g * .587 + b * .114;
                if (luminance < 60 || luminance > 205) continue;
                if (Math.max(r, g, b) - Math.min(r, g, b) > 30) continue;
                verticalHits[x]++;
                horizontalHits[y]++;
            }
        }
        const collect = (hits, limit) => {
            const found = [];
            for (let index = 0; index < hits.length; index++) if (hits[index] >= limit) found.push(index);
            return found;
        };
        const xs = clusterPositions(collect(verticalHits, height * .55), Math.max(3, Math.round(width * .004)));
        const ys = clusterPositions(collect(horizontalHits, width * .55), Math.max(3, Math.round(height * .01)));
        if (xs.length < 3 || ys.length < 2) return null;
        // As bordas externas podem ter sido cortadas pelo recorte da tabela.
        const withBorders = (lines, size) => {
            const result = [...lines];
            if (result[0] > size * .04) result.unshift(0);
            if (result[result.length - 1] < size - 1 - size * .04) result.push(size - 1);
            return result;
        };
        return { xs: withBorders(xs, width), ys: withBorders(ys, height) };
    }

    function findBand(lines, position) {
        for (let index = 0; index < lines.length - 1; index++) {
            if (position > lines[index] && position < lines[index + 1]) return index;
        }
        return -1;
    }

    // Cruza a grade detectada com a estrutura da 1a passada: cada cabecalho
    // de hora cai em uma coluna da grade e cada LBS cai em uma linha da
    // grade. Linhas sem LBS (vazias, "Paradas") simplesmente nao entram.
    function buildCellLattice(gridLines, layout) {
        if (!gridLines || !layout) return null;
        const headers = layout.headers || [];
        const rowDefinitions = layout.rows || [];
        if (!headers.length || !rowDefinitions.length) return null;
        const xs = gridLines.xs || [];
        const ys = gridLines.ys || [];
        if (xs.length < 4 || ys.length < 3) return null;

        const columns = [];
        const usedColumns = new Set();
        for (const header of headers) {
            const index = findBand(xs, header.x);
            if (index < 0) continue;
            if (usedColumns.has(index)) return null; // duas horas na mesma coluna: grade nao confiavel
            const left = xs[index];
            const right = xs[index + 1];
            if (right - left < 12) return null;
            usedColumns.add(index);
            columns.push({ hour: hourKey(header.hour), left, right });
        }

        const rows = [];
        const usedRows = new Set();
        for (const row of rowDefinitions) {
            const index = findBand(ys, row.y);
            if (index < 0) continue;
            if (usedRows.has(index)) return null; // duas LBS na mesma linha: grade nao confiavel
            const top = ys[index];
            const bottom = ys[index + 1];
            if (bottom - top < 10) return null;
            usedRows.add(index);
            rows.push({ key: row.key, top, bottom });
        }

        if (columns.length < 3 || !rows.length) return null;
        if (columns.length < Math.ceil(headers.length * .7)) return null;
        if (rows.length < Math.ceil(rowDefinitions.length * .7)) return null;
        return { columns, rows };
    }

    // Recorta a celula por dentro das bordas para a linha da grade nao virar
    // "tinta" e para nao invadir a coluna/linha vizinha.
    function insetCellRect(column, row, width, height) {
        const insetX = Math.max(2, Math.round((column.right - column.left) * .10));
        const insetY = Math.max(2, Math.round((row.bottom - row.top) * .14));
        const left = Math.max(0, Math.min(width - 1, Math.round(column.left + insetX)));
        const top = Math.max(0, Math.min(height - 1, Math.round(row.top + insetY)));
        const right = Math.max(left + 1, Math.min(width, Math.round(column.right - insetX)));
        const bottom = Math.max(top + 1, Math.min(height, Math.round(row.bottom - insetY)));
        const rectWidth = right - left;
        const rectHeight = bottom - top;
        if (rectWidth < 6 || rectHeight < 6) return null;
        return { left, top, width: rectWidth, height: rectHeight };
    }

    // Teste de tinta: e isto que distingue "sem producao" de "OCR falhou".
    // Uma celula uniforme (sem contraste) nao tem nada escrito; nao adianta
    // rodar OCR nela e muito menos marcar como erro.
    function measureCellInk(imageData, width, height) {
        const pixels = imageData && imageData.data;
        const total = pixels ? pixels.length / 4 : 0;
        if (!total) return { inkRatio: 0, threshold: 128, darkBackground: false, range: 0, blobs: null };
        const cellWidth = Math.round(Number(width || imageData.width) || 0);
        const cellHeight = cellWidth ? Math.round(Number(height || imageData.height) || total / cellWidth) : 0;
        const values = new Uint8Array(total);
        let rawSum = 0;
        for (let index = 0, position = 0; index < pixels.length; index += 4, position++) {
            const luminance = Math.round(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
            values[position] = luminance;
            rawSum += luminance;
        }
        const darkBackground = rawSum / total < 115;
        let min = 255;
        let max = 0;
        for (let position = 0; position < total; position++) {
            const value = darkBackground ? 255 - values[position] : values[position];
            values[position] = value;
            if (value < min) min = value;
            if (value > max) max = value;
        }
        const range = max - min;
        const threshold = Math.round((min + max) / 2);
        if (range < CELL_MIN_RANGE) return { inkRatio: 0, threshold, darkBackground, range, blobs: 0 };
        let ink = 0;
        for (let position = 0; position < total; position++) if (values[position] < threshold) ink++;
        return { inkRatio: ink / total, threshold, darkBackground, range, blobs: countInkBlobs(values, cellWidth, cellHeight, threshold) };
    }

    // Conta quantos algarismos estao desenhados na celula projetando a tinta
    // no eixo horizontal: cada digito vira um bloco continuo de colunas com
    // tinta. E uma medida puramente geometrica, entao serve de segunda
    // opiniao sobre o que o OCR devolveu (ex.: OCR diz "4" mas ha 2 blocos
    // desenhados -> a leitura perdeu um digito).
    function countInkBlobs(values, width, height, threshold) {
        if (!width || !height || width * height > values.length) return null;
        const columns = new Uint32Array(width);
        let top = height;
        let bottom = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (values[y * width + x] >= threshold) continue;
                columns[x]++;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
        if (bottom < top) return 0;
        const minimumRun = Math.max(1, Math.round((bottom - top + 1) * .12));
        let blobs = 0;
        let run = 0;
        for (let x = 0; x <= width; x++) {
            if (x < width && columns[x] > 0) { run++; continue; }
            if (run >= minimumRun) blobs++;
            run = 0;
        }
        return blobs;
    }

    function binarizeCellPixels(imageData, stats) {
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) {
            let luminance = Math.round(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
            if (stats.darkBackground) luminance = 255 - luminance;
            const output = luminance < stats.threshold ? 0 : 255;
            pixels[index] = pixels[index + 1] = pixels[index + 2] = output;
            pixels[index + 3] = 255;
        }
        return imageData;
    }

    // Combina a leitura da tabela inteira (coarse) com a leitura da celula
    // isolada (refined). Regra de ouro: divergencia sem confianca alta NAO
    // vira um numero chutado, vira VERMELHO para o conferente decidir.
    function mergeCellReadings(coarse, refined) {
        if (!refined || !refined.status) return coarse === undefined ? null : coarse;
        const coarseStatus = getCellStatus(coarse);
        const coarseConfidence = Number(coarse && coarse.confidence) || 0;
        const confidence = Number.isFinite(Number(refined.confidence)) ? Number(refined.confidence) : 0;
        const raw = refined.raw || '';

        if (refined.status === 'empty') {
            if (coarseStatus.status === 'recognized' && coarseConfidence >= 90) return coarse;
            return null; // AMARELO: celula sem producao -> 0
        }

        if (refined.status === 'unreadable') {
            if (coarseStatus.status === 'recognized' && coarseConfidence >= 80) return coarse;
            return { value: null, confidence, raw, uncertain: true, source: 'cell' };
        }

        const value = Number(refined.value);
        if (!Number.isInteger(value) || value < 0) return { value: null, confidence, raw, uncertain: true, source: 'cell' };

        // Veto geometrico: o OCR leu uma quantidade de algarismos diferente da
        // que esta desenhada na celula. So passa se a 1a passada confirmar o
        // mesmo valor; caso contrario vai para revisao, sem chute.
        if (refined.geometryOk === false && !(coarseStatus.status === 'recognized' && coarseStatus.value === value)) {
            return { value: null, confidence, raw, uncertain: true, source: 'geometry' };
        }

        if (coarseStatus.status === 'recognized' && coarseStatus.value === value) {
            return { value, confidence: Math.max(confidence, coarseConfidence), raw: raw || String(value), uncertain: false, source: 'both' };
        }
        if (coarseStatus.status !== 'recognized') {
            // Com a contagem de digitos confirmada pelo desenho da celula, a
            // confianca do OCR pode ser um pouco menor sem risco de chute.
            const minimum = refined.geometryOk === true ? GEOMETRY_CONFIDENCE : REFINED_CONFIDENCE;
            if (confidence >= minimum) return { value, confidence, raw: raw || String(value), uncertain: false, source: 'cell' };
            return { value: null, confidence, raw, uncertain: true, source: 'cell' };
        }
        if (confidence >= REFINED_AGREEMENT) {
            return { value, confidence, raw: raw || String(value), uncertain: false, source: 'cell' };
        }
        return { value: null, confidence, raw, uncertain: true, source: 'conflict' };
    }

    function applyRefinedCells(rows, refined) {
        const output = {};
        Object.keys(rows || {}).forEach(key => { output[key] = { ...rows[key] }; });
        Object.entries(refined || {}).forEach(([key, hours]) => {
            if (!output[key]) output[key] = {};
            Object.entries(hours || {}).forEach(([hour, reading]) => {
                const merged = mergeCellReadings(rows && rows[key] ? rows[key][hour] : undefined, reading);
                if (merged === null) delete output[key][hour];
                else output[key][hour] = merged;
            });
        });
        return output;
    }

    // =====================================================================
    // CONTROLE DE ACESSO (recurso em beta)
    //
    // O admin liga/desliga a leitura por foto e escolhe quem pode usar.
    // Desligado, o recurso nao aparece para ninguem -- nem para o admin --
    // para que o proprio admin consiga ver a tela como o usuario comum ve.
    // =====================================================================

    const PHOTO_IMPORT_AUDIENCES = ['admins', 'selected', 'all'];
    const DEFAULT_PHOTO_IMPORT_SETTINGS = { enabled: false, audience: 'admins' };
    const PHOTO_IMPORT_CACHE_KEY = 'evo_photo_import_v1';
    const PHOTO_IMPORT_CARDS = ['entryPhotoImportCard', 'reportPhotoImportCard'];

    function normalizePhotoImportSettings(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: Boolean(source.enabled),
            audience: PHOTO_IMPORT_AUDIENCES.includes(source.audience)
                ? source.audience
                : DEFAULT_PHOTO_IMPORT_SETTINGS.audience
        };
    }

    function canUsePhotoImport(settings, context) {
        const resolved = normalizePhotoImportSettings(settings);
        if (!resolved.enabled) return false;
        const scope = context || {};
        if (scope.isAdmin) return true;
        if (resolved.audience === 'all') return true;
        if (resolved.audience === 'selected') return Boolean(scope.betaUser);
        return false;
    }

    function install(EvolutionAppClass) {
        EvolutionAppClass.prototype.getPhotoImportSettings = function () {
            return normalizePhotoImportSettings(this.photoImportSettings);
        };

        EvolutionAppClass.prototype.loadCachedPhotoImportSettings = function () {
            // O cache so entra quando ainda nao recebemos a configuracao do
            // servidor nesta sessao, para nao sobrescrever um valor mais novo.
            if (this.photoImportSettings) return this.getPhotoImportSettings();
            if (typeof safeStorage !== 'undefined') {
                try {
                    const cached = safeStorage.getItem(PHOTO_IMPORT_CACHE_KEY);
                    if (cached) this.photoImportSettings = normalizePhotoImportSettings(JSON.parse(cached));
                } catch (error) {}
            }
            return this.getPhotoImportSettings();
        };

        EvolutionAppClass.prototype.setPhotoImportSettings = function (raw) {
            this.photoImportSettings = normalizePhotoImportSettings(raw);
            if (typeof safeStorage !== 'undefined') {
                try { safeStorage.setItem(PHOTO_IMPORT_CACHE_KEY, JSON.stringify(this.photoImportSettings)); } catch (error) {}
            }
            this.applyPhotoImportAccess();
            return this.photoImportSettings;
        };

        EvolutionAppClass.prototype.canUsePhotoImport = function () {
            const user = this.currentUserId && this.users ? this.users[this.currentUserId] : null;
            return canUsePhotoImport(this.photoImportSettings, {
                isAdmin: Boolean(this.isAdmin),
                betaUser: Boolean(user && user.photoImportBeta)
            });
        };

        // Mostra/esconde os dois cartoes de importacao por foto.
        EvolutionAppClass.prototype.applyPhotoImportAccess = function () {
            const allowed = this.canUsePhotoImport();
            PHOTO_IMPORT_CARDS.forEach(id => {
                const card = document.getElementById(id);
                if (card) card.style.display = allowed ? '' : 'none';
            });
            if (!allowed) {
                this._resetPhotoFileInputs();
                if (this._photoOcrData || this._photoImportMode) this.clearPhotoImportSession();
            }
            return allowed;
        };

        EvolutionAppClass.prototype._setPhotoProgress = function (message, progress) {
            const text = document.getElementById('photoOcrProgressText');
            const bar = document.getElementById('photoOcrProgressBar');
            const track = bar?.parentElement;
            const percent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
            if (text) text.textContent = message;
            if (bar) bar.style.transform = `scaleX(${percent / 100})`;
            if (track) track.setAttribute('aria-valuenow', String(percent));
        };

        EvolutionAppClass.prototype._resetPhotoFileInputs = function () {
            ['entryPhotoInput', 'reportPhotoInput'].forEach(id => {
                const input = document.getElementById(id);
                if (input) input.value = '';
            });
        };

        EvolutionAppClass.prototype._clearPhotoWorkingState = function () {
            this._photoOcrData = null;
            this._photoOcrMeta = null;
            this._photoImportMode = null;
            this._photoImportTurno = null;
            this._photoSelectedLbs = null;
            this._photoEntryPrefill = null;
            this._resetPhotoFileInputs();
        };

        EvolutionAppClass.prototype.clearPhotoImportSession = function () {
            this._clearPhotoWorkingState();
            this._photoReportHandoff = null;
        };

        EvolutionAppClass.prototype._loadTesseract = function () {
            if (window.Tesseract) return Promise.resolve(window.Tesseract);
            if (this._tesseractLoadPromise) return this._tesseractLoadPromise;
            this._tesseractLoadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = TESSERACT_URL;
                script.async = true;
                script.crossOrigin = 'anonymous';
                script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Biblioteca OCR indisponível'));
                script.onerror = () => reject(new Error('Não foi possível carregar o leitor OCR. Verifique sua conexão.'));
                document.head.appendChild(script);
            }).catch(error => {
                this._tesseractLoadPromise = null;
                throw error;
            });
            return this._tesseractLoadPromise;
        };

        EvolutionAppClass.prototype._validatePhotoFile = function (file) {
            if (!file) return 'Selecione uma imagem.';
            const name = String(file.name || '').toLowerCase();
            if (/\.(heic|heif)$/.test(name) || /heic|heif/.test(file.type || '')) return 'HEIC ainda não é compatível. Exporte a foto como JPG, PNG ou WEBP.';
            if (!ALLOWED_TYPES.has(file.type)) return 'Formato inválido. Use uma imagem JPG, PNG ou WEBP.';
            if (file.size > MAX_FILE_SIZE) return 'A imagem é muito grande. Use um arquivo de até 15 MB.';
            return '';
        };

        EvolutionAppClass.prototype._preparePhotoCanvas = async function (file, token) {
            let bitmap = null;
            let objectUrl = null;
            try {
                if ('createImageBitmap' in window) {
                    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
                } else {
                    objectUrl = URL.createObjectURL(file);
                    bitmap = await new Promise((resolve, reject) => {
                        const image = new Image();
                        image.onload = () => resolve(image);
                        image.onerror = () => reject(new Error('A imagem não pôde ser aberta.'));
                        image.src = objectUrl;
                    });
                }
                if (token !== this._photoOcrToken) throw new Error('Leitura cancelada');
                const sourceWidth = bitmap.width || bitmap.naturalWidth;
                const sourceHeight = bitmap.height || bitmap.naturalHeight;
                if (sourceWidth < MIN_IMAGE_WIDTH || sourceHeight < MIN_IMAGE_HEIGHT) throw new Error('A imagem tem baixa resolução. Use uma foto com pelo menos 600 × 300 pixels.');

                const targetWidth = Math.min(2600, Math.max(1600, sourceWidth));
                const scale = targetWidth / sourceWidth;
                let canvas = document.createElement('canvas');
                canvas.width = Math.round(sourceWidth * scale);
                canvas.height = Math.round(sourceHeight * scale);
                let context = canvas.getContext('2d', { willReadFrequently: true });
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

                const initialImageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const bounds = findVisibleContentBounds(initialImageData, canvas.width, canvas.height);
                if (bounds.trimmed) {
                    const cropped = document.createElement('canvas');
                    cropped.width = bounds.width;
                    cropped.height = bounds.height;
                    const croppedContext = cropped.getContext('2d', { willReadFrequently: true });
                    croppedContext.drawImage(canvas, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
                    canvas.width = 0;
                    canvas.height = 0;
                    canvas = cropped;
                    context = croppedContext;
                }
                let photoTrimmed = bounds.trimmed;
                const gridImageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const gridBounds = findGridTableBounds(gridImageData, canvas.width, canvas.height);
                if (gridBounds) {
                    const cropped = document.createElement('canvas');
                    cropped.width = gridBounds.width;
                    cropped.height = gridBounds.height;
                    const croppedContext = cropped.getContext('2d', { willReadFrequently: true });
                    croppedContext.drawImage(canvas, gridBounds.left, gridBounds.top, gridBounds.width, gridBounds.height, 0, 0, gridBounds.width, gridBounds.height);
                    canvas.width = 0;
                    canvas.height = 0;
                    canvas = cropped;
                    context = croppedContext;
                    photoTrimmed = true;
                }
                if (gridBounds && canvas.width < 1600) {
                    const enlargedWidth = 1600;
                    const enlargedHeight = Math.round(canvas.height * enlargedWidth / canvas.width);
                    const enlarged = document.createElement('canvas');
                    enlarged.width = enlargedWidth;
                    enlarged.height = enlargedHeight;
                    const enlargedContext = enlarged.getContext('2d', { willReadFrequently: true });
                    enlargedContext.imageSmoothingEnabled = true;
                    enlargedContext.imageSmoothingQuality = 'high';
                    enlargedContext.drawImage(canvas, 0, 0, enlargedWidth, enlargedHeight);
                    canvas.width = 0;
                    canvas.height = 0;
                    canvas = enlarged;
                    context = enlargedContext;
                }
                canvas.dataset.photoTrimmed = photoTrimmed ? 'true' : 'false';

                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                // Antes de binarizar: detecta a grade e guarda uma copia nao
                // binarizada. O recorte celula a celula le desta copia, onde
                // os digitos pequenos ainda tem meio-tom (melhor para o OCR).
                const gridLines = detectGridLines(imageData, canvas.width, canvas.height);
                const sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = canvas.width;
                sourceCanvas.height = canvas.height;
                sourceCanvas.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
                const pixels = imageData.data;
                const histogram = new Uint32Array(256);
                let luminanceSum = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    const luminance = Math.round(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
                    histogram[luminance]++;
                    luminanceSum += luminance;
                }
                const totalPixels = pixels.length / 4;
                const darkBackground = luminanceSum / totalPixels < 115;
                let weightedSum = 0;
                for (let value = 0; value < 256; value++) weightedSum += value * histogram[value];
                let backgroundWeight = 0;
                let backgroundSum = 0;
                let bestVariance = -1;
                let threshold = 155;
                for (let value = 0; value < 256; value++) {
                    backgroundWeight += histogram[value];
                    if (!backgroundWeight) continue;
                    const foregroundWeight = totalPixels - backgroundWeight;
                    if (!foregroundWeight) break;
                    backgroundSum += value * histogram[value];
                    const meanBackground = backgroundSum / backgroundWeight;
                    const meanForeground = (weightedSum - backgroundSum) / foregroundWeight;
                    const variance = backgroundWeight * foregroundWeight * Math.pow(meanBackground - meanForeground, 2);
                    if (variance > bestVariance) {
                        bestVariance = variance;
                        threshold = value;
                    }
                }
                for (let index = 0; index < pixels.length; index += 4) {
                    let luminance = Math.round(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
                    if (darkBackground) luminance = 255 - luminance;
                    const output = luminance < threshold ? 0 : 255;
                    pixels[index] = pixels[index + 1] = pixels[index + 2] = output;
                    pixels[index + 3] = 255;
                }
                context.putImageData(imageData, 0, 0);
                return { canvas, sourceCanvas, gridLines };
            } finally {
                if (bitmap && typeof bitmap.close === 'function') bitmap.close();
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }
        };

        EvolutionAppClass.prototype.startPhotoImport = async function (mode, input) {
            // Trava de verdade: nao basta esconder o botao, o fluxo tambem recusa.
            if (!this.canUsePhotoImport()) {
                this.showToast('A leitura por foto não está liberada para o seu usuário.', 'warning');
                this._resetPhotoFileInputs();
                this.applyPhotoImportAccess();
                return;
            }
            const file = input?.files?.[0];
            const validationError = this._validatePhotoFile(file);
            if (validationError) {
                this.showToast(validationError, 'error');
                this._resetPhotoFileInputs();
                return;
            }
            const isReport = mode === 'report';
            const lbs = isReport ? normalizeLbs(document.getElementById('relPhotoLbs')?.value) : null;
            if (isReport && !lbs) {
                this.showToast('Informe uma LBS válida antes de selecionar a foto.', 'warning');
                this._resetPhotoFileInputs();
                document.getElementById('relPhotoLbs')?.focus();
                return;
            }

            const turno = document.getElementById(isReport ? 'relTurno' : 'calcTurno')?.value;
            if (!getTurnSegments(turno).length) {
                this.showToast('Selecione um turno válido.', 'error');
                this._resetPhotoFileInputs();
                return;
            }

            const token = (this._photoOcrToken || 0) + 1;
            this._photoOcrToken = token;
            this._photoImportMode = mode;
            this._photoImportTurno = turno;
            this._photoSelectedLbs = lbs;
            this._setPhotoProgress('Preparando a imagem no seu aparelho…', 4);
            this.openModal('photoOcrProgressModal');
            await new Promise(resolve => requestAnimationFrame(resolve));

            let canvas = null;
            let sourceCanvas = null;
            let gridLines = null;
            let worker = null;
            try {
                const prepared = await this._preparePhotoCanvas(file, token);
                canvas = prepared.canvas;
                sourceCanvas = prepared.sourceCanvas;
                gridLines = prepared.gridLines;
                if (token !== this._photoOcrToken) return;
                this._setPhotoProgress('Carregando o leitor local…', 12);
                const Tesseract = await this._loadTesseract();
                if (token !== this._photoOcrToken) return;
                worker = await Tesseract.createWorker('eng', 1, {
                    logger: message => {
                        if (token !== this._photoOcrToken || this._photoRefining || message.status !== 'recognizing text') return;
                        this._setPhotoProgress('Reconhecendo linhas, horários e valores…', 20 + (Number(message.progress) || 0) * 68);
                    }
                });
                this._photoOcrWorker = worker;
                await worker.setParameters({
                    tessedit_pageseg_mode: canvas.dataset.photoTrimmed === 'true'
                        ? (Tesseract.PSM?.SINGLE_BLOCK || '6')
                        : (Tesseract.PSM?.SPARSE_TEXT || '11'),
                    preserve_interword_spaces: '1',
                    tessedit_char_whitelist: 'LBSlbs0123456789: '
                });
                const result = await worker.recognize(canvas, {}, { text: true, tsv: true });
                if (token !== this._photoOcrToken) return;
                this._setPhotoProgress('Organizando a tabela…', 88);
                const parsed = parseOcrResult(result?.data?.tsv, result?.data?.text);
                if (!parsed.recognizedRows || !parsed.hours.length) throw new Error('Não foi possível identificar a grade da tabela. Use uma imagem mais nítida e sem cortes.');

                // 2a passada: relê cada célula isolada, só com dígitos.
                // Se a grade não for confiável, mantém a leitura da 1a passada.
                let rows = parsed.rows;
                let lattice = null;
                try {
                    lattice = buildCellLattice(gridLines, parsed.layout);
                    if (lattice && sourceCanvas) {
                        const refined = await this._refinePhotoCells(sourceCanvas, lattice, worker, Tesseract, token);
                        if (token !== this._photoOcrToken) return;
                        if (refined) rows = applyRefinedCells(parsed.rows, refined);
                    }
                } catch (refineError) {
                    console.warn('Refinamento por célula indisponível, usando a leitura da tabela inteira:', refineError);
                }

                this._photoOcrData = rows;
                this._photoOcrMeta = { ...parsed, rows, refined: Boolean(lattice) };
                if (isReport && !this._photoOcrData[lbs]) this._photoOcrData[lbs] = {};
                this._setPhotoProgress('Leitura concluída.', 100);
                this.closeModal('photoOcrProgressModal');
                this.renderPhotoReview();
                this.openModal('photoReviewModal');
            } catch (error) {
                if (token === this._photoOcrToken && error?.message !== 'Leitura cancelada') {
                    console.error('Falha no OCR local:', error);
                    this.showToast(error?.message || 'Não foi possível ler a imagem.', 'error');
                    this.closeModal('photoOcrProgressModal');
                    this._clearPhotoWorkingState();
                }
            } finally {
                if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                }
                if (sourceCanvas) {
                    sourceCanvas.width = 0;
                    sourceCanvas.height = 0;
                }
                if (worker) {
                    try { await worker.terminate(); } catch (error) {}
                }
                if (this._photoOcrWorker === worker) this._photoOcrWorker = null;
            }
        };

        // Le uma unica celula: recorta, amplia, binariza e roda o OCR
        // restrito a digitos. O teste de tinta vem antes: celula sem tinta e
        // "sem producao" (0), nunca "falha de leitura".
        EvolutionAppClass.prototype._readPhotoCell = async function (sourceCanvas, context, cellCanvas, cellContext, rect, worker) {
            const cellData = context.getImageData(rect.left, rect.top, rect.width, rect.height);
            const stats = measureCellInk(cellData, rect.width, rect.height);
            if (stats.inkRatio < CELL_INK_RATIO) return { status: 'empty', confidence: 100 };

            const scale = Math.max(2, Math.min(6, 58 / rect.height));
            const padding = 14;
            cellCanvas.width = Math.round(rect.width * scale) + padding * 2;
            cellCanvas.height = Math.round(rect.height * scale) + padding * 2;
            cellContext.fillStyle = stats.darkBackground ? '#000000' : '#ffffff';
            cellContext.fillRect(0, 0, cellCanvas.width, cellCanvas.height);
            cellContext.imageSmoothingEnabled = true;
            cellContext.imageSmoothingQuality = 'high';
            cellContext.drawImage(
                sourceCanvas,
                rect.left, rect.top, rect.width, rect.height,
                padding, padding, Math.round(rect.width * scale), Math.round(rect.height * scale)
            );
            const upscaled = cellContext.getImageData(0, 0, cellCanvas.width, cellCanvas.height);
            cellContext.putImageData(binarizeCellPixels(upscaled, stats), 0, 0);

            const result = await worker.recognize(cellCanvas, {}, { text: true });
            const raw = String(result?.data?.text || '').trim();
            const digits = raw.replace(/[^0-9]/g, '');
            const confidence = Number(result?.data?.confidence);
            const safeConfidence = Number.isFinite(confidence) ? confidence : 0;
            const blobs = stats.blobs;
            if (!digits) return { status: 'unreadable', confidence: safeConfidence, raw, blobs };
            // A geometria diz quantos algarismos existem na celula. Se o OCR
            // devolveu uma quantidade diferente, a leitura perdeu (ou inventou)
            // um digito: nao vale como valor reconhecido.
            const geometryOk = Number.isFinite(blobs) && blobs > 0 ? digits.length === blobs : null;
            return {
                status: 'value',
                value: Number(digits.slice(0, 4)),
                confidence: safeConfidence,
                raw,
                blobs,
                geometryOk
            };
        };

        EvolutionAppClass.prototype._refinePhotoCells = async function (sourceCanvas, lattice, worker, Tesseract, token) {
            const total = lattice.rows.length * lattice.columns.length;
            if (!total || total > MAX_REFINED_CELLS) return null;
            const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
            const cellCanvas = document.createElement('canvas');
            const cellContext = cellCanvas.getContext('2d', { willReadFrequently: true });
            const refined = {};
            let done = 0;
            this._photoRefining = true;
            try {
                await worker.setParameters({
                    tessedit_char_whitelist: '0123456789',
                    tessedit_pageseg_mode: Tesseract.PSM?.SINGLE_LINE || '7',
                    preserve_interword_spaces: '0'
                });
                const retries = [];
                for (const row of lattice.rows) {
                    refined[row.key] = {};
                    for (const column of lattice.columns) {
                        if (token !== this._photoOcrToken) return null;
                        const rect = insetCellRect(column, row, sourceCanvas.width, sourceCanvas.height);
                        const reading = rect
                            ? await this._readPhotoCell(sourceCanvas, context, cellCanvas, cellContext, rect, worker)
                            : { status: 'unreadable', confidence: 0 };
                        refined[row.key][column.hour] = reading;
                        // Numero isolado curto (tipicamente um "0") as vezes escapa do
                        // modo "palavra". Guardamos para uma segunda tentativa em modo
                        // de caractere unico, em vez de ja marcar como nao reconhecido.
                        if (rect && (reading.status === 'unreadable' || reading.geometryOk === false)) {
                            retries.push({ key: row.key, hour: column.hour, rect, previous: reading });
                        }
                        done++;
                        if (done % 3 === 0) this._setPhotoProgress('Conferindo célula por célula…', 90 + (done / total) * 8);
                    }
                }

                if (retries.length && retries.length <= 48) {
                    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM?.SINGLE_CHAR || '10' });
                    for (const retry of retries) {
                        if (token !== this._photoOcrToken) return null;
                        const second = await this._readPhotoCell(sourceCanvas, context, cellCanvas, cellContext, retry.rect, worker);
                        // So troca se a segunda tentativa for melhor: valor com
                        // a contagem de digitos batendo com o desenho da celula.
                        if (second.status === 'empty') refined[retry.key][retry.hour] = second;
                        else if (second.status === 'value' && second.geometryOk !== false) refined[retry.key][retry.hour] = second;
                    }
                    this._setPhotoProgress('Conferindo célula por célula…', 99);
                }
            } finally {
                this._photoRefining = false;
                cellCanvas.width = 0;
                cellCanvas.height = 0;
            }
            return refined;
        };

        EvolutionAppClass.prototype.cancelPhotoOcr = async function () {
            this._photoOcrToken = (this._photoOcrToken || 0) + 1;
            const worker = this._photoOcrWorker;
            this._photoOcrWorker = null;
            if (worker) {
                try { await worker.terminate(); } catch (error) {}
            }
            this.closeModal('photoOcrProgressModal');
            this._clearPhotoWorkingState();
            this.showToast('Leitura cancelada.', 'info');
        };

        EvolutionAppClass.prototype._photoReviewKeys = function () {
            if (this._photoImportMode === 'report') return this._photoSelectedLbs ? [this._photoSelectedLbs] : [];
            return Object.keys(this._photoOcrData || {}).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
        };

        EvolutionAppClass.prototype._photoReviewHours = function () {
            return getTurnSegments(this._photoImportTurno).flatMap(segment => segment.hours);
        };

        EvolutionAppClass.prototype._photoUnresolved = function () {
            return aggregateRows(this._photoOcrData || {}, this._photoImportTurno, this._photoReviewKeys()).unresolved;
        };

        EvolutionAppClass.prototype.renderPhotoReview = function () {
            const content = document.getElementById('photoReviewContent');
            const subtitle = document.getElementById('photoReviewSubtitle');
            const addRow = document.getElementById('photoAddLbsRow');
            if (!content) return;
            const keys = this._photoReviewKeys();
            const hours = this._photoReviewHours();
            const isReport = this._photoImportMode === 'report';
            if (subtitle) subtitle.textContent = isReport
                ? `${keys[0] || 'LBS'} • turno ${this._photoImportTurno} • somente esta LBS será usada no relatório`
                : `${keys.length} LBS identificada${keys.length === 1 ? '' : 's'} • turno ${this._photoImportTurno} • todas entram no total`;
            if (addRow) addRow.style.display = isReport ? 'none' : 'grid';

            const input = (key, hour) => {
                const raw = this._photoOcrData?.[key]?.[hour];
                const cell = getCellStatus(raw);
                const statusClass = cell.status === 'unrecognized'
                    ? ' needs-review'
                    : cell.status === 'empty' ? ' ocr-empty' : ' ocr-recognized';
                const displayValue = cell.status === 'unrecognized' ? '' : cell.value;
                const hint = cell.status === 'empty'
                    ? 'Sem produção nessa hora — considerado 0'
                    : cell.status === 'unrecognized'
                        ? (raw?.source === 'conflict'
                            ? 'As duas leituras divergiram — confira na foto'
                            : 'Não foi possível ler este valor — confira na foto')
                        : raw?.source === 'both'
                            ? 'Valor confirmado nas duas leituras'
                            : 'Valor reconhecido';
                return `<input class="photo-review-input${statusClass}" type="number" min="0" step="1" inputmode="numeric" aria-label="${escapeHtml(key)}, ${hour} horas: ${escapeHtml(hint)}" title="${escapeHtml(hint)}" value="${displayValue}" placeholder="?" data-photo-lbs="${escapeHtml(key)}" data-photo-hour="${hour}" data-photo-status="${cell.status}" oninput="app.updatePhotoReviewValue(this)">`;
            };

            if (isReport) {
                content.innerHTML = `<div class="photo-review-single"><h4>${escapeHtml(keys[0] || '')}</h4><div class="photo-review-single-grid">${hours.map(hour => `<div class="photo-review-cell"><label>${hour}h</label>${input(keys[0], hour)}</div>`).join('')}</div></div>`;
            } else {
                content.innerHTML = `<table class="photo-review-table"><thead><tr><th scope="col">LBS</th>${hours.map(hour => `<th scope="col">${hour}h</th>`).join('')}</tr></thead><tbody>${keys.map(key => `<tr><th scope="row">${escapeHtml(key)}</th>${hours.map(hour => `<td>${input(key, hour)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
            }
            this._updatePhotoReviewStatus();
        };

        EvolutionAppClass.prototype.updatePhotoReviewValue = function (input) {
            const key = input?.dataset?.photoLbs;
            const hour = input?.dataset?.photoHour;
            if (!key || !hour || !this._photoOcrData?.[key]) return;
            const raw = String(input.value || '').trim();
            const value = raw === '' ? null : Number(raw);
            const valid = value === null || (Number.isInteger(value) && value >= 0);
            input.classList.toggle('invalid', !valid);
            input.classList.remove('needs-review', 'ocr-empty', 'ocr-recognized');
            input.classList.add(value === null ? 'needs-review' : 'ocr-recognized');
            input.dataset.photoStatus = value === null ? 'unrecognized' : 'recognized';
            this._photoOcrData[key][hour] = {
                value: valid ? value : null,
                confidence: valid && value !== null ? 100 : 0,
                raw,
                uncertain: value === null || !valid,
                corrected: true
            };
            this._updatePhotoReviewStatus();
        };

        EvolutionAppClass.prototype._updatePhotoReviewStatus = function () {
            const unresolved = this._photoUnresolved();
            const notice = document.getElementById('photoReviewNotice');
            const confirm = document.getElementById('photoReviewConfirm');
            const invalid = document.querySelectorAll('#photoReviewContent .photo-review-input.invalid').length;
            if (confirm) confirm.disabled = unresolved.length > 0 || invalid > 0;
            if (!notice) return;
            notice.classList.toggle('ready', unresolved.length === 0 && invalid === 0);
            if (invalid) notice.textContent = 'Há valores inválidos. Use somente números inteiros iguais ou maiores que zero.';
            else if (unresolved.length) notice.textContent = `${unresolved.length} valor${unresolved.length === 1 ? '' : 'es'} em vermelho não${unresolved.length === 1 ? ' foi' : ' foram'} reconhecido${unresolved.length === 1 ? '' : 's'} pelo OCR. Revise antes de confirmar.`;
            else notice.textContent = 'Leitura completa. Células em amarelo não tiveram produção informada e foram consideradas 0. Confira e confirme.';
        };

        EvolutionAppClass.prototype.focusPhotoCorrection = function () {
            const target = document.querySelector('#photoReviewContent .photo-review-input.invalid, #photoReviewContent .photo-review-input.needs-review');
            if (target) {
                target.focus();
                target.select();
            } else {
                document.querySelector('#photoReviewContent .photo-review-input')?.focus();
                this.showToast('Os valores reconhecidos também podem ser editados.', 'info');
            }
        };

        EvolutionAppClass.prototype.addPhotoReviewLbs = function () {
            const field = document.getElementById('photoAddLbsInput');
            const key = normalizeLbs(field?.value);
            if (!key) {
                this.showToast('Informe uma LBS válida.', 'warning');
                field?.focus();
                return;
            }
            if (this._photoOcrData[key]) {
                this.showToast(`${key} já está na conferência.`, 'info');
                return;
            }
            this._photoOcrData[key] = {};
            if (field) field.value = '';
            this.renderPhotoReview();
            requestAnimationFrame(() => document.querySelector(`[data-photo-lbs="${key}"]`)?.focus());
        };

        EvolutionAppClass.prototype.cancelPhotoImport = function () {
            this.closeModal('photoReviewModal');
            this._clearPhotoWorkingState();
            this.showToast('Importação cancelada. Nenhum dado foi alterado.', 'info');
        };

        EvolutionAppClass.prototype._applyPhotoTotals = function (prefix, turno, totals) {
            if (prefix === 'rel') this.toggleRelatorioCampos();
            else this.adjustCalcFields();
            if (turno === '15x23') {
                const first = document.getElementById(`${prefix}P1`);
                const second = document.getElementById(`${prefix}P2`);
                if (first) first.value = String(totals[0]);
                if (second) second.value = String(totals[1]);
            } else {
                const total = document.getElementById(`${prefix}PT`);
                if (total) total.value = String(totals[0]);
            }
        };

        EvolutionAppClass.prototype.confirmPhotoImport = function () {
            const keys = this._photoReviewKeys();
            const aggregation = aggregateRows(this._photoOcrData || {}, this._photoImportTurno, keys);
            if (!keys.length || aggregation.unresolved.length) {
                this._updatePhotoReviewStatus();
                this.focusPhotoCorrection();
                return;
            }

            const mode = this._photoImportMode;
            const turno = this._photoImportTurno;
            if (mode === 'report') {
                this._applyPhotoTotals('rel', turno, aggregation.totals);
                this._photoReportHandoff = {
                    rows: this._photoOcrData,
                    turno,
                    navio: document.getElementById('relNavio')?.value || '',
                    data: document.getElementById('relData')?.value || ''
                };
                this.closeModal('photoReviewModal');
                this._photoOcrData = null;
                this._photoOcrMeta = null;
                this._photoImportMode = null;
                this._resetPhotoFileInputs();
                this.showToast(`${keys[0]} preenchida. Gerando o relatório pelo fluxo atual…`, 'success');
                setTimeout(() => this.generateReport(), 180);
                return;
            }

            const prefill = this._photoEntryPrefill;
            if (prefill) {
                const navio = document.getElementById('calcNavio');
                const data = document.getElementById('calcData');
                const turnoField = document.getElementById('calcTurno');
                if (navio) navio.value = prefill.navio;
                if (data) data.value = prefill.data;
                if (turnoField) turnoField.value = prefill.turno;
                this.adjustCalcTipoForDate();
            }
            this._applyPhotoTotals('calc', turno, aggregation.totals);
            this.closeModal('photoReviewModal');
            this.navigateWorkspace('secNew');
            this._photoReportHandoff = null;
            this._clearPhotoWorkingState();
            this.showToast('Produção preenchida com todas as LBS do turno.', 'success');
        };

        EvolutionAppClass.prototype.completePhotoReportFlow = function () {
            if (!this._photoReportHandoff) return;
            this._keepPhotoHandoffOnReportClose = true;
            this.closeModal('reportPreviewModal');
            setTimeout(() => this.openModal('photoRegisterPromptModal'), 180);
        };

        EvolutionAppClass.prototype.dismissPhotoRegistration = function () {
            this.closeModal('photoRegisterPromptModal');
            this.clearPhotoImportSession();
        };

        EvolutionAppClass.prototype.transferPhotoReportToEntry = function () {
            const handoff = this._photoReportHandoff;
            if (!handoff) return;
            this.closeModal('photoRegisterPromptModal');
            this._photoOcrData = handoff.rows;
            this._photoImportMode = 'entry';
            this._photoImportTurno = handoff.turno;
            this._photoSelectedLbs = null;
            this._photoEntryPrefill = { navio: handoff.navio, data: handoff.data, turno: handoff.turno };
            this.renderPhotoReview();
            setTimeout(() => this.openModal('photoReviewModal'), 120);
        };
    }

    return {
        normalizeLbs,
        parseHourToken,
        parseOcrResult,
        getTurnSegments,
        aggregateRows,
        hoursStartingInPeriod,
        getCellStatus,
        detectGridLines,
        findVisibleContentBounds,
        findGridTableBounds,
        buildCellLattice,
        insetCellRect,
        measureCellInk,
        mergeCellReadings,
        applyRefinedCells,
        normalizePhotoImportSettings,
        canUsePhotoImport,
        install
    };
});
