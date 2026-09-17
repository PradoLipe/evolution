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
    const MIN_IMAGE_WIDTH = 480;
    const MIN_IMAGE_HEIGHT = 240;
    const VALUE_CONFIDENCE = 52;
    // Refinamento por celula (2a passada, somente digitos)
    const CELL_INK_RATIO = 0.004;      // abaixo disso a celula nao tem tinta -> sem producao
    const CELL_MIN_RANGE = 45;         // contraste minimo para considerar que ha algo escrito
    const REFINED_CONFIDENCE = 62;     // confianca minima para aceitar a leitura da celula
    const GEOMETRY_CONFIDENCE = 55;    // idem, quando a geometria ja confirmou a quantidade de digitos
    const REFINED_AGREEMENT = 74;      // confianca para a celula vencer a 1a passada em caso de divergencia
    const MAX_REFINED_CELLS = 180;     // trava de seguranca (performance no celular)
    // Reconhecimento por molde: o Tesseract as vezes devolve VAZIO num digito
    // isolado (tipicamente um "0"), mesmo com a celula nitida. Como a tabela e
    // desenhada pelo sistema, sempre na mesma fonte e tamanho, o mesmo digito
    // tem o mesmo desenho em todas as celulas. Entao montamos moldes a partir
    // dos digitos que o OCR JA leu com confianca NESTA imagem e usamos esses
    // moldes para decidir as celulas que ficaram sem leitura.
    const GLYPH_W = 12;
    const GLYPH_H = 18;
    const TEMPLATE_MIN_SIMILARITY = 0.90;  // semelhanca minima com o molde
    const TEMPLATE_MIN_MARGIN = 0.12;      // distancia minima para o 2o candidato
    const TEMPLATE_MIN_CONFIDENCE = 70;    // confianca para uma leitura virar molde
    const LABEL_MIN_CONFIDENCE = 55;       // confianca para aceitar um rotulo (LBS / hora) lido na celula
    const COARSE_ONLY_CONFIDENCE = 80;     // sem grade mapeada, so passa leitura muito confiante

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

    // =====================================================================
    // DETECCAO DE LINHA POR CRISTA LOCAL
    //
    // A versao anterior classificava como "linha de grade" todo pixel cinza
    // dentro de uma faixa fixa de luminancia (60..205). Isso quebra no tema
    // claro do painel: ali o FUNDO da celula fica em ~204, cai dentro da
    // faixa e a imagem inteira vira "linha" (medido: 403 de 429 linhas).
    //
    // Uma linha de grade nao e definida pela cor dela, e sim pelo contraste
    // com o que esta imediatamente acima e abaixo. Testamos exatamente isso:
    // o pixel precisa ser neutro (a fonte azul dos rotulos nao passa) e
    // diferir, no MESMO sentido, dos pixels a alguns pixels de distancia nos
    // dois lados. Isso vale no tema escuro, no tema claro e em foto da tela.
    // =====================================================================
    const RIDGE_SPANS = [2, 4, 7];   // cobre linhas finas e linhas grossas (imagem ampliada)
    const RIDGE_MIN_DELTA = 13;      // contraste minimo com a vizinhanca
    const RIDGE_MAX_SATURATION = 40; // acima disso e texto colorido, nao linha

    function buildLuminanceMap(imageData, width, height) {
        const data = imageData.data;
        const total = width * height;
        const lum = new Uint8Array(total);
        const flat = new Uint8Array(total);
        for (let index = 0, position = 0; position < total; index += 4, position++) {
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            lum[position] = (r * .299 + g * .587 + b * .114) | 0;
            flat[position] = (Math.max(r, g, b) - Math.min(r, g, b)) <= RIDGE_MAX_SATURATION ? 1 : 0;
        }
        return { lum, flat, width, height };
    }

    function ridgeAt(map, x, y, horizontal) {
        const { lum, flat, width, height } = map;
        const here = y * width + x;
        if (!flat[here]) return false;
        const value = lum[here];
        for (let index = 0; index < RIDGE_SPANS.length; index++) {
            const span = RIDGE_SPANS[index];
            let before;
            let after;
            if (horizontal) {
                if (y - span < 0 || y + span >= height) continue;
                before = lum[here - span * width];
                after = lum[here + span * width];
            } else {
                if (x - span < 0 || x + span >= width) continue;
                before = lum[here - span];
                after = lum[here + span];
            }
            const d1 = value - before;
            const d2 = value - after;
            if ((d1 >= RIDGE_MIN_DELTA && d2 >= RIDGE_MIN_DELTA) || (d1 <= -RIDGE_MIN_DELTA && d2 <= -RIDGE_MIN_DELTA)) return true;
        }
        return false;
    }

    // =====================================================================
    // CORRECAO DE INCLINACAO (deskew)
    //
    // Toda a leitura depende de linhas de grade HORIZONTAIS: o recorte da
    // tabela, a deteccao da grade e o retangulo de cada celula. Numa foto
    // tirada da tela, mesmo 1 ou 2 graus de inclinacao derrubam tudo isso --
    // medido: a leitura caia para a 1a passada e produzia dezenas de valores
    // verdes errados.
    //
    // O angulo e estimado projetando os pixels de crista em linhas inclinadas
    // e escolhendo o angulo em que essa projecao fica mais concentrada (as
    // linhas da tabela "colapsam" em poucos picos). Nao depende de OCR.
    // =====================================================================
    const SKEW_MAX_DEGREES = 6;
    const SKEW_MIN_DEGREES = .15;   // abaixo disso nao compensa girar
    const SKEW_MIN_GAIN = 1.08;     // ganho minimo sobre o angulo zero

    function collectRidgePoints(map, width, height, stride) {
        const xs = [];
        const ys = [];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 0; x < width; x += stride) {
                if (!ridgeAt(map, x, y, true)) continue;
                xs.push(x);
                ys.push(y);
            }
        }
        return { xs, ys, count: xs.length };
    }

    function projectionScore(points, height, tangent) {
        const bins = new Float64Array(height + 1);
        const { xs, ys, count } = points;
        for (let index = 0; index < count; index++) {
            const y = ys[index] - xs[index] * tangent;
            if (y < 0 || y >= height) continue;
            bins[y | 0]++;
        }
        let score = 0;
        for (let index = 0; index < bins.length; index++) score += bins[index] * bins[index];
        return score;
    }

    function estimateSkewDegrees(imageData, width, height) {
        if (width < 200 || height < 120) return 0;
        const map = buildLuminanceMap(imageData, width, height);
        const stride = Math.max(1, Math.round(width / 420));
        const points = collectRidgePoints(map, width, height, stride);
        if (points.count < 400) return 0;
        const evaluate = degrees => projectionScore(points, height, Math.tan(degrees * Math.PI / 180));
        const zero = evaluate(0);
        if (!zero) return 0;
        let best = { degrees: 0, score: zero };
        for (let degrees = -SKEW_MAX_DEGREES; degrees <= SKEW_MAX_DEGREES + 1e-9; degrees += .5) {
            const score = evaluate(degrees);
            if (score > best.score) best = { degrees, score };
        }
        for (let degrees = best.degrees - .5; degrees <= best.degrees + .5 + 1e-9; degrees += .05) {
            const score = evaluate(degrees);
            if (score > best.score) best = { degrees, score };
        }
        if (Math.abs(best.degrees) < SKEW_MIN_DEGREES) return 0;
        if (best.score < zero * SKEW_MIN_GAIN) return 0;
        return Math.round(best.degrees * 100) / 100;
    }

    // As linhas de uma TABELA sao igualmente espacadas. Bordas de painel,
    // divisorias de layout e molduras aparecem isoladas, fora desse ritmo --
    // e no print de celular elas tem praticamente a mesma largura da tabela,
    // entrando no mesmo grupo e esticando o recorte para a tela inteira.
    // Mantendo so a maior sequencia de espacamento regular, o recorte cai
    // exatamente sobre a tabela, em qualquer layout ou resolucao.
    function keepEvenlySpacedRun(lines) {
        if (!lines || lines.length < 4) return lines || [];
        const gaps = [];
        for (let index = 1; index < lines.length; index++) gaps.push(lines[index].top - lines[index - 1].top);
        const sorted = [...gaps].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (!median || median <= 0) return lines;
        const tolerance = Math.max(4, median * .25);
        let bestFrom = 0;
        let bestTo = 0;
        let from = 0;
        for (let index = 0; index <= gaps.length; index++) {
            if (index < gaps.length && Math.abs(gaps[index] - median) <= tolerance) continue;
            if (index - from > bestTo - bestFrom) { bestFrom = from; bestTo = index; }
            from = index + 1;
        }
        return lines.slice(bestFrom, bestTo + 1);
    }

    // Capturas da tela inteira incluem graficos e paineis cujos numeros podem
    // ser confundidos com celulas. A grade operacional, porem, possui varias
    // linhas horizontais longas, neutras e alinhadas. Usamos essa assinatura
    // visual para isolar a tabela antes do OCR, sem depender da resolucao ou
    // de coordenadas fixas da tela.
    function findGridTableBounds(imageData, width, height) {
        const map = buildLuminanceMap(imageData, width, height);
        const minimumRun = Math.max(260, Math.floor(width * .28));
        const candidates = [];

        // Um digito encostando na linha abre um buraco de 1-2 px nela. Exigir
        // run perfeitamente continuo derrubava a linha inteira (medido: 1310
        // pixels de linha viravam um trecho maximo de 262). Por isso a
        // varredura tolera falhas curtas dentro do mesmo traco.
        const maxGap = Math.max(4, Math.round(width * .006));
        for (let y = 0; y < height; y++) {
            let runStart = -1;
            let runEnd = -1;
            let gap = 0;
            let bestStart = -1;
            let bestEnd = -1;
            const closeRun = () => {
                if (runStart >= 0 && runEnd - runStart > bestEnd - bestStart) {
                    bestStart = runStart;
                    bestEnd = runEnd;
                }
                runStart = -1;
                runEnd = -1;
            };
            for (let x = 0; x < width; x++) {
                if (ridgeAt(map, x, y, true)) {
                    if (runStart < 0) runStart = x;
                    runEnd = x;
                    gap = 0;
                } else if (runStart >= 0 && ++gap > maxGap) {
                    closeRun();
                    gap = 0;
                }
            }
            closeRun();
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
        bestGroup = keepEvenlySpacedRun(bestGroup);
        if (bestGroup.length < 4) return null;
        const top = bestGroup[0].top;
        const bottom = bestGroup[bestGroup.length - 1].bottom;
        // A altura minima nao pode depender do tamanho da imagem: num print de
        // celular (imagem muito alta) isso rejeitava tabelas perfeitamente boas.
        if (bottom - top < 80) return null;

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
        const map = buildLuminanceMap(imageData, width, height);
        const verticalHits = new Uint32Array(width);
        const horizontalHits = new Uint32Array(height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (ridgeAt(map, x, y, true)) horizontalHits[y]++;
                if (ridgeAt(map, x, y, false)) verticalHits[x]++;
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

    // As horas do painel sao sempre consecutivas e monotonicas (15,14,13...).
    // Com esse padrao, tres colunas lidas ja determinam TODAS as outras --
    // inclusive as que o OCR da tabela inteira nao conseguiu ler. E uma
    // verificacao forte: se as horas lidas nao formarem uma sequencia, a
    // estrutura da 1a passada estava errada e nao deve ser usada.
    function predictHour(fit, index) {
        return ((fit.base + fit.step * index) % 24 + 24) % 24;
    }

    function fitHourSequence(bands) {
        const observed = bands.filter(band => band.hour !== null).map(band => ({ index: band.index, hour: Number(band.hour) }));
        if (observed.length < 3) return null;
        let best = null;
        [-1, 1].forEach(step => {
            observed.forEach(anchor => {
                const base = ((anchor.hour - step * anchor.index) % 24 + 24) % 24;
                const fit = { step, base };
                const agree = observed.filter(item => predictHour(fit, item.index) === item.hour).length;
                if (!best || agree > best.agree) best = { step, base, agree };
            });
        });
        if (!best) return null;
        best.observed = observed.length;
        return best.agree >= Math.max(3, Math.ceil(observed.length * .7)) ? best : null;
    }

    function markTruncatedColumns(columns) {
        if (!columns.length) return columns;
        const widths = columns.map(column => column.right - column.left).sort((a, b) => a - b);
        const medianWidth = widths[Math.floor(widths.length / 2)];
        columns.forEach(column => {
            column.truncated = (column.right - column.left) < medianWidth * .7;
        });
        return columns;
    }

    // Monta a grade de celulas a partir da GEOMETRIA: cada faixa entre duas
    // linhas da grade e uma coluna/linha em potencial. A 1a passada entra
    // apenas para NOMEAR as faixas (qual hora, qual LBS) e a sequencia de
    // horas preenche as colunas que ela nao conseguiu ler.
    //
    // As faixas que sobram sem nome ficam em columnBands/rowBands para serem
    // resolvidas com OCR da celula isolada -- muito mais confiavel do que ler
    // "LBS 07" no meio do OCR da tela inteira (medido: no tema claro e em
    // imagem reduzida, a 1a passada devolve "s07"/"SB8 07" e a tabela inteira
    // era descartada, mesmo com a geometria perfeita).
    function buildCellLattice(gridLines, layout) {
        if (!gridLines) return null;
        const xs = gridLines.xs || [];
        const ys = gridLines.ys || [];
        if (xs.length < 4 || ys.length < 3) return null;
        const headers = (layout && layout.headers) || [];
        const rowDefinitions = (layout && layout.rows) || [];

        const columnBands = [];
        for (let index = 0; index < xs.length - 1; index++) {
            if (xs[index + 1] - xs[index] >= 12) {
                columnBands.push({ index, left: xs[index], right: xs[index + 1], hour: null, origin: null });
            }
        }
        const rowBands = [];
        for (let index = 0; index < ys.length - 1; index++) {
            if (ys[index + 1] - ys[index] >= 10) {
                rowBands.push({ index, top: ys[index], bottom: ys[index + 1], key: null, origin: null });
            }
        }
        if (columnBands.length < 3 || !rowBands.length) return null;

        for (const header of headers) {
            const band = columnBands.find(item => header.x > item.left && header.x < item.right);
            if (!band) continue;
            if (band.hour !== null) return null; // duas horas na mesma coluna: grade nao confiavel
            band.hour = hourKey(header.hour);
            band.origin = 'coarse';
        }
        for (const row of rowDefinitions) {
            const band = rowBands.find(item => row.y > item.top && row.y < item.bottom);
            if (!band) continue;
            if (band.key !== null) return null; // duas LBS na mesma linha: grade nao confiavel
            band.key = row.key;
            band.origin = 'coarse';
        }

        const hourFit = fitHourSequence(columnBands);
        if (hourFit) {
            const observed = columnBands.filter(band => band.origin === 'coarse');
            const first = observed[0].index;
            const last = observed[observed.length - 1].index;
            columnBands.forEach(band => {
                if (band.index < first || band.index > last) return;
                const predicted = hourKey(predictHour(hourFit, band.index));
                if (band.hour === predicted) return;
                // Buraco no meio da sequencia, ou hora lida que contraria a
                // sequencia: a geometria manda, porque ela nao depende do OCR.
                band.hour = predicted;
                band.origin = band.origin === 'coarse' ? 'fit-fix' : 'fit';
            });
        }

        keepConsistentRowKeys(rowBands);
        const columns = columnBands.filter(band => band.hour !== null)
            .map(band => ({ hour: band.hour, left: band.left, right: band.right }));
        const rows = rowBands.filter(band => band.key !== null)
            .map(band => ({ key: band.key, top: band.top, bottom: band.bottom }));
        markTruncatedColumns(columns);

        // Coluna de rotulo ("Guindaste"/LBS): a faixa sem hora mais proxima da
        // esquerda das colunas de dados. E dela que sai o nome de cada linha.
        const firstHourIndex = columnBands.find(band => band.hour !== null)?.index;
        const labelColumn = Number.isInteger(firstHourIndex)
            ? [...columnBands].reverse().find(band => band.hour === null && band.index < firstHourIndex) || null
            : columnBands[0] || null;

        return { columns, rows, columnBands, rowBands, labelColumn, hourFit };
    }

    // Cada linha tem ate duas leituras do rotulo: a da 1a passada (que ve
    // "LBS 08" inteiro) e a da celula isolada (que le so o numero, com veto
    // geometrico). Quando as duas discordam, quem decide e a SEQUENCIA: as
    // LBS do painel sao consecutivas e crescentes de cima para baixo.
    // Medido: isso corrige "LBS 48" numa foto inclinada sem derrubar as
    // linhas de uma foto ruidosa, que o override cego perdia.
    function reconcileRowKeys(rowBands) {
        const entries = [];
        rowBands.forEach(band => {
            const candidates = [];
            [band.cellKey, band.key].forEach(key => {
                const number = key ? Number(String(key).replace(/\D/g, '')) : NaN;
                if (Number.isInteger(number) && number > 0 && !candidates.includes(number)) candidates.push(number);
            });
            if (candidates.length) entries.push({ band, candidates });
        });
        rowBands.forEach(band => { band.key = null; });
        if (!entries.length) return rowBands;

        let best = null;
        entries.forEach((entry, position) => {
            entry.candidates.forEach(candidate => {
                const base = candidate - position;
                const agree = entries.filter((item, index) => item.candidates.includes(base + index)).length;
                if (!best || agree > best.agree) best = { base, agree };
            });
        });

        const used = new Set();
        entries.forEach((entry, position) => {
            const predicted = best && best.agree >= 2 ? best.base + position : null;
            let chosen = null;
            if (predicted !== null && entry.candidates.includes(predicted)) chosen = predicted;
            else if (entry.candidates.length === 1) chosen = entry.candidates[0]; // leituras concordam
            const key = chosen === null ? null : normalizeLbs(chosen);
            if (!key || used.has(key)) return;
            used.add(key);
            entry.band.key = key;
            entry.band.origin = entry.band.cellKey ? 'cell' : 'coarse';
        });
        return keepConsistentRowKeys(rowBands);
    }

    // No painel as LBS aparecem em ordem CRESCENTE de cima para baixo. Um
    // rotulo que quebra essa ordem foi lido errado -- e producao lancada no
    // guindaste errado nao pode acontecer. Mantemos a maior sequencia
    // crescente e descartamos o resto (o conferente adiciona a LBS na mao).
    function keepConsistentRowKeys(rowBands) {
        const named = rowBands.filter(band => band.key);
        if (named.length < 2) return rowBands;
        const numbers = named.map(band => Number(String(band.key).replace(/\D/g, '')));
        const length = new Array(named.length).fill(1);
        const previous = new Array(named.length).fill(-1);
        let bestIndex = 0;
        for (let index = 1; index < named.length; index++) {
            for (let before = 0; before < index; before++) {
                if (numbers[before] < numbers[index] && length[before] + 1 > length[index]) {
                    length[index] = length[before] + 1;
                    previous[index] = before;
                }
            }
            if (length[index] > length[bestIndex]) bestIndex = index;
        }
        const keep = new Set();
        for (let index = bestIndex; index >= 0; index = previous[index]) {
            keep.add(named[index]);
            if (previous[index] < 0) break;
        }
        named.forEach(band => {
            if (keep.has(band)) return;
            band.key = null;
            band.origin = null;
        });
        return rowBands;
    }

    // O lattice so pode substituir a 1a passada quando tem colunas e linhas
    // suficientes; caso contrario o fluxo volta para a leitura da tabela
    // inteira (ou recusa a imagem).
    function latticeIsUsable(lattice) {
        return Boolean(lattice && lattice.columns.length >= 3 && lattice.rows.length >= 1);
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

    // Recorta o desenho de cada algarismo da celula e normaliza para uma
    // grade fixa (GLYPH_W x GLYPH_H), onde cada posicao guarda quanto daquele
    // pedaco esta pintado. Assim dois desenhos podem ser comparados mesmo com
    // pequenas diferencas de tamanho ou posicao.
    function buildCellValues(imageData, width, height, stats) {
        const pixels = imageData && imageData.data;
        if (!pixels || !width || !height || width * height * 4 > pixels.length + 3) return null;
        const values = new Uint8Array(width * height);
        for (let index = 0, position = 0; position < values.length; index += 4, position++) {
            let luminance = Math.round(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
            if (stats.darkBackground) luminance = 255 - luminance;
            values[position] = luminance;
        }
        return values;
    }

    // Separa os desenhos (algarismos, letras) por colunas com tinta.
    function findGlyphRuns(values, width, height, threshold) {
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
        if (bottom < top) return { runs: [], top: 0, bottom: -1 };
        const minimumRun = Math.max(1, Math.round((bottom - top + 1) * .12));
        const runs = [];
        let start = -1;
        for (let x = 0; x <= width; x++) {
            const on = x < width && columns[x] > 0;
            if (on && start < 0) start = x;
            if (!on && start >= 0) {
                if (x - start >= minimumRun) runs.push([start, x - 1]);
                start = -1;
            }
        }
        return { runs, top, bottom };
    }

    // Na celula de rotulo ("LBS 07") o numero fica depois do MAIOR espaco
    // horizontal. Lendo so esse pedaco, com o OCR restrito a digitos, o
    // rotulo passa pelas mesmas travas dos valores (contagem de algarismos
    // pelo desenho e molde) -- medido: sem isso, "LBS 08" virava "LBS 48"
    // numa foto inclinada, ou seja, producao atribuida a outro guindaste.
    function findLabelNumberSpan(imageData, width, height, stats) {
        const values = buildCellValues(imageData, width, height, stats);
        if (!values) return null;
        const { runs } = findGlyphRuns(values, width, height, stats.threshold);
        if (runs.length < 2) return null;
        let bestGap = 0;
        let splitAt = -1;
        for (let index = 1; index < runs.length; index++) {
            const gap = runs[index][0] - runs[index - 1][1];
            if (gap > bestGap) { bestGap = gap; splitAt = index; }
        }
        // Espaco precisa ser claramente maior do que o vao entre letras.
        const inner = [];
        for (let index = 1; index < runs.length; index++) if (index !== splitAt) inner.push(runs[index][0] - runs[index - 1][1]);
        const typical = inner.length ? inner.reduce((sum, value) => sum + value, 0) / inner.length : 0;
        if (splitAt < 0 || bestGap < Math.max(4, typical * 1.8)) return null;
        // Antes do espaco tem que haver "LBS" (1 a 3 desenhos, letras podendo
        // se encostar) e depois dele no maximo 2 algarismos. Isso rejeita
        // "Paradas", "Guindaste" e qualquer outro texto da coluna.
        if (splitAt < 1 || splitAt > 3) return null;
        const digits = runs.slice(splitAt);
        if (!digits.length || digits.length > 2) return null;
        return { left: digits[0][0], right: digits[digits.length - 1][1], count: digits.length };
    }

    function extractGlyphBitmaps(imageData, width, height, stats) {
        const values = buildCellValues(imageData, width, height, stats);
        if (!values) return [];
        const threshold = stats.threshold;
        const { runs, top, bottom } = findGlyphRuns(values, width, height, threshold);
        if (bottom < top) return [];

        return runs.map(([left, right]) => {
            let glyphTop = height;
            let glyphBottom = -1;
            for (let y = 0; y < height; y++) {
                for (let x = left; x <= right; x++) {
                    if (values[y * width + x] >= threshold) continue;
                    if (y < glyphTop) glyphTop = y;
                    if (y > glyphBottom) glyphBottom = y;
                }
            }
            const glyphWidth = right - left + 1;
            const glyphHeight = glyphBottom - glyphTop + 1;
            const bitmap = new Float32Array(GLYPH_W * GLYPH_H);
            for (let ty = 0; ty < GLYPH_H; ty++) {
                const sy0 = glyphTop + Math.floor(ty * glyphHeight / GLYPH_H);
                const sy1 = Math.min(glyphBottom + 1, Math.max(glyphTop + Math.floor((ty + 1) * glyphHeight / GLYPH_H), sy0 + 1));
                for (let tx = 0; tx < GLYPH_W; tx++) {
                    const sx0 = left + Math.floor(tx * glyphWidth / GLYPH_W);
                    const sx1 = Math.min(right + 1, Math.max(left + Math.floor((tx + 1) * glyphWidth / GLYPH_W), sx0 + 1));
                    let ink = 0;
                    let total = 0;
                    for (let y = sy0; y < sy1; y++) {
                        for (let x = sx0; x < sx1; x++) {
                            total++;
                            if (values[y * width + x] < threshold) ink++;
                        }
                    }
                    bitmap[ty * GLYPH_W + tx] = total ? ink / total : 0;
                }
            }
            return bitmap;
        });
    }

    function bitmapSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let difference = 0;
        for (let index = 0; index < a.length; index++) difference += Math.abs(a[index] - b[index]);
        return 1 - difference / a.length;
    }

    // Uma leitura so vira molde quando o OCR estava confiante E a quantidade de
    // digitos bate com a quantidade de desenhos na celula.
    function collectGlyphTemplates(readings) {
        const templates = {};
        (readings || []).forEach(reading => {
            if (!reading || reading.status !== 'value' || !reading.bitmaps) return;
            const digits = String(reading.digits || '');
            if (!digits || digits.length !== reading.bitmaps.length) return;
            if (Number(reading.confidence) < TEMPLATE_MIN_CONFIDENCE) return;
            for (let index = 0; index < digits.length; index++) {
                const character = digits[index];
                if (!templates[character]) templates[character] = [];
                if (templates[character].length < 12) templates[character].push(reading.bitmaps[index]);
            }
        });
        return templates;
    }

    // Decide a celula pelo desenho. Exige semelhanca alta com o molde vencedor
    // E folga clara para o segundo colocado -- na duvida, nao decide (fica
    // vermelho para o conferente), nunca chuta.
    function classifyByTemplates(bitmaps, templates) {
        if (!bitmaps || !bitmaps.length || !templates) return null;
        const characters = Object.keys(templates);
        if (characters.length < 2) return null;
        let digits = '';
        let worstScore = 1;
        let worstMargin = 1;
        for (const bitmap of bitmaps) {
            const scores = characters.map(character => ({
                character,
                score: templates[character].reduce((best, template) => Math.max(best, bitmapSimilarity(bitmap, template)), 0)
            })).sort((a, b) => b.score - a.score);
            const best = scores[0];
            const margin = best.score - (scores[1] ? scores[1].score : 0);
            if (best.score < TEMPLATE_MIN_SIMILARITY || margin < TEMPLATE_MIN_MARGIN) return null;
            digits += best.character;
            worstScore = Math.min(worstScore, best.score);
            worstMargin = Math.min(worstMargin, margin);
        }
        if (!digits || digits.length > 4) return null;
        return { digits, value: Number(digits), score: worstScore, margin: worstMargin };
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
            // Coluna cortada na foto: o numero esta incompleto na imagem, entao
            // nenhuma leitura vale -- nem a da 1a passada.
            if (refined.truncated) return { value: null, confidence: 0, raw, uncertain: true, source: 'truncated' };
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
            // Decidido pelo molde: ja passou por semelhanca alta E folga clara
            // para o segundo candidato, entao nao depende da confianca do OCR.
            if (refined.byTemplate) return { value, confidence, raw: raw || String(value), uncertain: false, source: 'template' };
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

    // Quando a grade da tabela nao pode ser mapeada, a unica leitura
    // disponivel e a da tabela inteira -- justamente a que confunde colunas
    // vizinhas e a linha "Paradas". Medido nas fotos tortas/desfocadas: esse
    // caminho produzia dezenas de valores VERDES errados. Aqui ele passa a
    // exigir confianca alta; abaixo disso a celula vai para revisao.
    function demoteCoarseOnlyRows(rows) {
        const output = {};
        Object.entries(rows || {}).forEach(([key, hours]) => {
            output[key] = {};
            Object.entries(hours || {}).forEach(([hour, cell]) => {
                const status = getCellStatus(cell);
                const confidence = Number(cell && cell.confidence) || 0;
                if (status.status === 'recognized' && confidence < COARSE_ONLY_CONFIDENCE) {
                    output[key][hour] = { value: null, confidence, raw: cell && cell.raw, uncertain: true, source: 'coarse-only' };
                } else {
                    output[key][hour] = cell;
                }
            });
        });
        return output;
    }

    // allowedKeys: quando a grade foi mapeada, só as LBS da grade podem sair
    // daqui. Sem isso, uma linha inventada pela 1a passada sobreviveria e
    // entraria no total do registro de produção.
    function applyRefinedCells(rows, refined, allowedKeys) {
        const allowed = allowedKeys && allowedKeys.length ? new Set(allowedKeys) : null;
        const output = {};
        Object.keys(rows || {}).forEach(key => {
            if (allowed && !allowed.has(key)) return;
            output[key] = { ...rows[key] };
        });
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
                if (typeof createImageBitmap === 'function') {
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
                if (sourceWidth < MIN_IMAGE_WIDTH || sourceHeight < MIN_IMAGE_HEIGHT) throw new Error('A imagem tem baixa resolução. Use uma foto com pelo menos 480 × 240 pixels.');

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

                // Endireita a foto ANTES de procurar a tabela: sem isso, uma
                // inclinacao de 1-2 graus ja impede o recorte e a grade.
                const skewImageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const skew = estimateSkewDegrees(skewImageData, canvas.width, canvas.height);
                if (skew) {
                    const straight = document.createElement('canvas');
                    straight.width = canvas.width;
                    straight.height = canvas.height;
                    const straightContext = straight.getContext('2d', { willReadFrequently: true });
                    // Fundo com a cor da borda, para o giro nao criar faixas
                    // pretas que virariam "conteudo" no recorte seguinte.
                    const corner = skewImageData.data;
                    straightContext.fillStyle = `rgb(${corner[0]},${corner[1]},${corner[2]})`;
                    straightContext.fillRect(0, 0, straight.width, straight.height);
                    straightContext.imageSmoothingEnabled = true;
                    straightContext.imageSmoothingQuality = 'high';
                    straightContext.translate(straight.width / 2, straight.height / 2);
                    straightContext.rotate(-skew * Math.PI / 180);
                    straightContext.translate(-straight.width / 2, -straight.height / 2);
                    straightContext.drawImage(canvas, 0, 0);
                    straightContext.setTransform(1, 0, 0, 1, 0, 0);
                    canvas.width = 0;
                    canvas.height = 0;
                    canvas = straight;
                    context = straightContext;
                    photoTrimmed = true;
                }

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

        EvolutionAppClass.prototype._createPhotoWorker = function (Tesseract, token) {
            return Tesseract.createWorker('eng', 1, {
                logger: message => {
                    if (token !== this._photoOcrToken || this._photoRefining || message.status !== 'recognizing text') return;
                    this._setPhotoProgress('Reconhecendo linhas, horários e valores…', 40 + (Number(message.progress) || 0) * 45);
                }
            });
        };

        // Pipeline completo de leitura: prepara a imagem, faz a 1a passada,
        // monta a grade e refina celula a celula. Fica isolado da interface
        // para poder ser medido fora do navegador (harness de regressao).
        // Retorna null quando a leitura foi cancelada (token trocado).
        EvolutionAppClass.prototype._runPhotoPipeline = async function (file, token) {
            let canvas = null;
            let sourceCanvas = null;
            let gridLines = null;
            let worker = null;
            try {
                const prepared = await this._preparePhotoCanvas(file, token);
                canvas = prepared.canvas;
                sourceCanvas = prepared.sourceCanvas;
                gridLines = prepared.gridLines;
                if (token !== this._photoOcrToken) return null;
                this._setPhotoProgress('Carregando o leitor local…', 12);
                const Tesseract = await this._loadTesseract();
                if (token !== this._photoOcrToken) return null;
                worker = await this._createPhotoWorker(Tesseract, token);
                this._photoOcrWorker = worker;

                // ETAPA 1 - ESTRUTURA PELA GEOMETRIA.
                // A grade da tabela ja diz onde estao as colunas e as linhas;
                // so os rotulos (hora e LBS) precisam de OCR, e em celulas
                // isoladas. Isso dispensa a leitura da tabela INTEIRA, que
                // custa sozinha cerca de 60% de todo o tempo de OCR
                // (medido: 575 ms de 956 ms, contra 10 ms por celula).
                let lattice = null;
                try {
                    const geometric = buildCellLattice(gridLines, null);
                    if (geometric && sourceCanvas) {
                        this._setPhotoProgress('Mapeando a grade da tabela…', 35);
                        const resolved = await this._resolvePhotoStructure(sourceCanvas, geometric, worker, Tesseract, token);
                        if (token !== this._photoOcrToken) return null;
                        if (latticeIsUsable(resolved)) lattice = resolved;
                    }
                } catch (structureError) {
                    console.warn('Não foi possível mapear a grade da tabela:', structureError);
                    lattice = null;
                }

                // ETAPA 2 - PLANO B: leitura da tabela inteira. So entra quando
                // a geometria nao resolveu a estrutura sozinha.
                let parsed = { rows: {}, hours: [], usedFallback: false, recognizedRows: 0, layout: null };
                if (!lattice) {
                    this._setPhotoProgress('Reconhecendo linhas, horários e valores…', 40);
                    await worker.setParameters({
                        tessedit_pageseg_mode: canvas.dataset.photoTrimmed === 'true'
                            ? (Tesseract.PSM?.SINGLE_BLOCK || '6')
                            : (Tesseract.PSM?.SPARSE_TEXT || '11'),
                        preserve_interword_spaces: '1',
                        tessedit_char_whitelist: 'LBSlbs0123456789: '
                    });
                    const result = await worker.recognize(canvas, {}, { text: true, tsv: true });
                    if (token !== this._photoOcrToken) return null;
                    this._setPhotoProgress('Organizando a tabela…', 88);
                    parsed = parseOcrResult(result?.data?.tsv, result?.data?.text);
                    try {
                        const hinted = buildCellLattice(gridLines, parsed.layout);
                        if (hinted && sourceCanvas) {
                            const resolved = await this._resolvePhotoStructure(sourceCanvas, hinted, worker, Tesseract, token);
                            if (token !== this._photoOcrToken) return null;
                            if (latticeIsUsable(resolved)) lattice = resolved;
                        }
                    } catch (structureError) {
                        console.warn('Não foi possível mapear a grade da tabela:', structureError);
                    }
                }

                if (!lattice && (!parsed.recognizedRows || !parsed.hours.length)) {
                    throw new Error('Não foi possível identificar a grade da tabela. Use uma imagem mais nítida e sem cortes.');
                }

                // 2a passada: relê cada célula isolada, só com dígitos.
                // Se a grade não for confiável, mantém a leitura da 1a passada.
                let rows = parsed.rows;
                let hours = parsed.hours;
                try {
                    if (lattice && sourceCanvas) {
                        const refined = await this._refinePhotoCells(sourceCanvas, lattice, worker, Tesseract, token);
                        if (token !== this._photoOcrToken) return null;
                        if (refined) {
                            rows = applyRefinedCells(parsed.rows, refined, lattice.rows.map(row => row.key));
                            hours = lattice.columns.map(column => column.hour);
                        }
                    }
                } catch (refineError) {
                    console.warn('Refinamento por célula indisponível, usando a leitura da tabela inteira:', refineError);
                }
                // Sem grade mapeada nao existe conferência célula a célula:
                // a leitura da tabela inteira sozinha só vale com confiança
                // alta -- o resto vai para revisão, nunca para valor "chutado".
                if (!lattice) rows = demoteCoarseOnlyRows(rows);
                return { rows, parsed: { ...parsed, hours }, lattice, refined: Boolean(lattice) };
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

            try {
                const outcome = await this._runPhotoPipeline(file, token);
                if (!outcome || token !== this._photoOcrToken) return;
                this._photoOcrData = outcome.rows;
                this._photoOcrMeta = { ...outcome.parsed, rows: outcome.rows, refined: outcome.refined };
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
            }
        };

        // Le uma unica celula: recorta, amplia, binariza e roda o OCR
        // restrito a digitos. O teste de tinta vem antes: celula sem tinta e
        // "sem producao" (0), nunca "falha de leitura".
        // Recorta, amplia e binariza a celula dentro de cellCanvas. Devolve as
        // estatisticas de tinta (ou null quando a celula esta vazia).
        EvolutionAppClass.prototype._prepareCellCanvas = function (sourceCanvas, context, cellCanvas, cellContext, rect) {
            const cellData = context.getImageData(rect.left, rect.top, rect.width, rect.height);
            const stats = measureCellInk(cellData, rect.width, rect.height);
            if (stats.inkRatio < CELL_INK_RATIO) return { cellData, stats, empty: true };

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
            return { cellData, stats, empty: false };
        };

        // Le o texto de uma celula de rotulo (cabecalho de hora ou coluna LBS).
        // O OCR da celula isolada e muito mais confiavel do que o mesmo texto
        // dentro do OCR da tabela inteira.
        EvolutionAppClass.prototype._readPhotoTextCell = async function (sourceCanvas, context, cellCanvas, cellContext, rect, worker) {
            const prepared = this._prepareCellCanvas(sourceCanvas, context, cellCanvas, cellContext, rect);
            if (prepared.empty) return { text: '', confidence: 0, empty: true };
            const result = await worker.recognize(cellCanvas, {}, { text: true });
            const confidence = Number(result?.data?.confidence);
            return {
                text: String(result?.data?.text || '').trim(),
                confidence: Number.isFinite(confidence) ? confidence : 0,
                empty: false
            };
        };

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
            const bitmaps = extractGlyphBitmaps(cellData, rect.width, rect.height, stats);
            if (!digits) return { status: 'unreadable', confidence: safeConfidence, raw, blobs, bitmaps };
            // A geometria diz quantos algarismos existem na celula. Se o OCR
            // devolveu uma quantidade diferente, a leitura perdeu (ou inventou)
            // um digito: nao vale como valor reconhecido.
            const geometryOk = Number.isFinite(blobs) && blobs > 0 ? digits.length === blobs : null;
            return {
                status: 'value',
                value: Number(digits.slice(0, 4)),
                digits,
                confidence: safeConfidence,
                raw,
                blobs,
                bitmaps,
                geometryOk
            };
        };

        // Resolve as faixas da grade que a 1a passada nao conseguiu nomear,
        // lendo APENAS a celula de rotulo correspondente. E o que torna a
        // estrutura independente do OCR da tela inteira.
        EvolutionAppClass.prototype._resolvePhotoStructure = async function (sourceCanvas, lattice, worker, Tesseract, token) {
            // Sem nenhuma hora conhecida, o cabecalho inteiro precisa ser lido
            // celula a celula. A faixa mais a esquerda nunca entra: e a coluna
            // de rotulo ("Guindaste"/LBS), nao uma hora.
            const pendingColumns = lattice.hourFit
                ? lattice.columnBands.filter(band => band.hour === null && band !== lattice.labelColumn && band.index >= 1)
                : lattice.columnBands.every(band => band.hour === null)
                    ? lattice.columnBands.filter(band => band.index >= 1)
                    : [];
            const pending = { rows: lattice.rowBands, columns: pendingColumns };
            if (!lattice.labelColumn && !pending.columns.length) return lattice;

            const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
            const cellCanvas = document.createElement('canvas');
            const cellContext = cellCanvas.getContext('2d', { willReadFrequently: true });
            this._photoRefining = true;
            try {
                // Todas as linhas passam pela conferencia do rotulo, inclusive
                // as que a 1a passada ja nomeou: atribuir producao ao guindaste
                // errado e o pior erro possivel aqui.
                if (lattice.labelColumn) {
                    await worker.setParameters({
                        tessedit_char_whitelist: '0123456789',
                        tessedit_pageseg_mode: Tesseract.PSM?.SINGLE_LINE || '7',
                        preserve_interword_spaces: '0'
                    });
                    const loose = [];
                    for (const band of lattice.rowBands) {
                        if (token !== this._photoOcrToken) return null;
                        const rect = insetCellRect(lattice.labelColumn, band, sourceCanvas.width, sourceCanvas.height);
                        if (!rect) continue;
                        const cellData = context.getImageData(rect.left, rect.top, rect.width, rect.height);
                        const stats = measureCellInk(cellData, rect.width, rect.height);
                        if (stats.inkRatio < CELL_INK_RATIO) continue;
                        const span = findLabelNumberSpan(cellData, rect.width, rect.height, stats);
                        if (!span) { loose.push({ band, rect }); continue; }
                        const reading = await this._readPhotoCell(sourceCanvas, context, cellCanvas, cellContext, {
                            left: rect.left + span.left,
                            top: rect.top,
                            width: Math.max(4, span.right - span.left + 1),
                            height: rect.height
                        }, worker);
                        // O desenho tem que ter a mesma quantidade de algarismos
                        // que o OCR leu, e a mesma que a segmentacao encontrou.
                        const digits = reading.status === 'value' ? String(reading.digits || '') : '';
                        const strict = digits
                            && reading.geometryOk !== false
                            && Number(reading.confidence) >= LABEL_MIN_CONFIDENCE
                            && digits.length === span.count;
                        if (strict) band.cellKey = normalizeLbs(digits);
                        else loose.push({ band, rect });
                    }

                    // Quando os algarismos do rótulo se encostam (desfoque), a
                    // leitura estrita não decide. O rótulo inteiro entra então
                    // como SEGUNDO candidato -- quem arbitra é a sequência.
                    if (loose.length) {
                        await worker.setParameters({ tessedit_char_whitelist: 'LBS0123456789 ' });
                        for (const item of loose) {
                            if (token !== this._photoOcrToken) return null;
                            const reading = await this._readPhotoTextCell(sourceCanvas, context, cellCanvas, cellContext, item.rect, worker);
                            if (reading.empty || reading.confidence < LABEL_MIN_CONFIDENCE) continue;
                            const key = combinedLbs(reading.text);
                            if (key) item.band.cellKey = key;
                        }
                    }
                    reconcileRowKeys(lattice.rowBands);
                }

                // Cabecalho de hora conferido celula a celula. Uma hora lida so
                // e aceita quando bate com a sequencia consecutiva do painel --
                // atribuir producao a hora errada seria um erro silencioso.
                const headerBand = lattice.rowBands[0];
                if (pending.columns.length && headerBand) {
                    await worker.setParameters({
                        tessedit_char_whitelist: '0123456789:',
                        tessedit_pageseg_mode: Tesseract.PSM?.SINGLE_LINE || '7'
                    });
                    const readings = [];
                    for (const band of pending.columns) {
                        if (token !== this._photoOcrToken) return null;
                        const rect = insetCellRect(band, headerBand, sourceCanvas.width, sourceCanvas.height);
                        if (!rect) continue;
                        const reading = await this._readPhotoTextCell(sourceCanvas, context, cellCanvas, cellContext, rect, worker);
                        if (reading.empty || reading.confidence < LABEL_MIN_CONFIDENCE) continue;
                        const parsedHour = parseHourToken(reading.text);
                        if (parsedHour) readings.push({ band, hour: parsedHour.value });
                    }
                    const fit = lattice.hourFit || fitHourSequence(readings.map(item => ({ index: item.band.index, hour: hourKey(item.hour) })));
                    if (fit) {
                        readings.forEach(item => {
                            if (item.hour !== predictHour(fit, item.band.index)) return;
                            item.band.hour = hourKey(item.hour);
                            item.band.origin = 'cell';
                        });
                        // Buracos entre colunas confirmadas seguem a sequencia.
                        const confirmed = lattice.columnBands.filter(band => band.hour !== null);
                        if (confirmed.length >= 3) {
                            const first = confirmed[0].index;
                            const last = confirmed[confirmed.length - 1].index;
                            lattice.columnBands.forEach(band => {
                                if (band.hour !== null || band.index < first || band.index > last) return;
                                band.hour = hourKey(predictHour(fit, band.index));
                                band.origin = 'fit';
                            });
                        }
                        lattice = { ...lattice, hourFit: fit };
                    }
                }
            } finally {
                this._photoRefining = false;
                cellCanvas.width = 0;
                cellCanvas.height = 0;
            }

            const columns = lattice.columnBands.filter(band => band.hour !== null)
                .map(band => ({ hour: band.hour, left: band.left, right: band.right }));
            const rows = lattice.rowBands.filter(band => band.key !== null)
                .map(band => ({ key: band.key, top: band.top, bottom: band.bottom }));
            markTruncatedColumns(columns);
            return { ...lattice, columns, rows };
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
                        const reading = column.truncated
                            ? { status: 'unreadable', confidence: 0, truncated: true }
                            : rect
                                ? await this._readPhotoCell(sourceCanvas, context, cellCanvas, cellContext, rect, worker)
                                : { status: 'unreadable', confidence: 0 };
                        refined[row.key][column.hour] = reading;
                        // Numero isolado curto (tipicamente um "0") as vezes escapa do
                        // modo "palavra". Guardamos para uma segunda tentativa em modo
                        // de caractere unico, em vez de ja marcar como nao reconhecido.
                        if (rect && !reading.truncated && (reading.status === 'unreadable' || reading.geometryOk === false)) {
                            retries.push({ key: row.key, hour: column.hour, rect, previous: reading });
                        }
                        done++;
                        if (done % 3 === 0) this._setPhotoProgress('Conferindo célula por célula…', 48 + (done / total) * 44);
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
                        else if (second.bitmaps && second.bitmaps.length) refined[retry.key][retry.hour] = second;
                    }
                    this._setPhotoProgress('Conferindo célula por célula…', 95);
                }

                // 3a tentativa: o que o OCR nao leu, decidimos pelo desenho,
                // comparando com os digitos que ele JA leu com certeza nesta
                // mesma tabela (mesma fonte, mesmo tamanho).
                const allReadings = [];
                Object.values(refined).forEach(hours => Object.values(hours).forEach(reading => allReadings.push(reading)));
                const templates = collectGlyphTemplates(allReadings);
                let recovered = 0;
                Object.entries(refined).forEach(([key, hours]) => {
                    Object.entries(hours).forEach(([hour, reading]) => {
                        if (!reading || reading.status === 'empty' || reading.truncated) return;
                        const undecided = reading.status === 'unreadable' || reading.geometryOk === false;
                        if (!undecided) return;
                        const match = classifyByTemplates(reading.bitmaps, templates);
                        if (!match) return;
                        refined[key][hour] = {
                            status: 'value',
                            value: match.value,
                            digits: match.digits,
                            confidence: Math.round(match.score * 100),
                            raw: match.digits,
                            blobs: reading.blobs,
                            geometryOk: Number.isFinite(reading.blobs) && reading.blobs > 0
                                ? match.digits.length === reading.blobs
                                : null,
                            byTemplate: true
                        };
                        recovered++;
                    });
                });
                if (recovered) console.info(`[photo-ocr] ${recovered} célula(s) resolvida(s) pelo desenho do dígito.`);
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
                            : raw?.source === 'truncated'
                                ? 'Esta coluna ficou cortada na foto — digite o valor'
                                : 'Não foi possível ler este valor — confira na foto')
                        : raw?.source === 'both'
                            ? 'Valor confirmado nas duas leituras'
                            : raw?.source === 'template'
                                ? 'Valor confirmado pelo desenho do dígito'
                                : 'Valor reconhecido';
                return `<input class="photo-review-input${statusClass}" type="number" min="0" step="1" inputmode="numeric" aria-label="${escapeHtml(key)}, ${hour} horas: ${escapeHtml(hint)}" title="${escapeHtml(hint)}" value="${displayValue}" placeholder="?" data-photo-lbs="${escapeHtml(key)}" data-photo-hour="${hour}" data-photo-status="${cell.status}" oninput="app.updatePhotoReviewValue(this)">`;
            };

            if (isReport) {
                content.innerHTML = `<div class="photo-review-single"><h4>${escapeHtml(keys[0] || '')}</h4><div class="photo-review-single-grid">${hours.map(hour => `<div class="photo-review-cell"><label>${hour}h</label>${input(keys[0], hour)}</div>`).join('')}</div></div>`;
            } else {
                // data-hour serve ao layout: no celular a tabela vira um cartao
                // por LBS e cada celula mostra a propria hora, sem rolagem
                // horizontal. A estrutura da tabela nao muda.
                content.innerHTML = `<table class="photo-review-table"><thead><tr><th scope="col">LBS</th>${hours.map(hour => `<th scope="col">${hour}h</th>`).join('')}</tr></thead><tbody>${keys.map(key => `<tr><th scope="row">${escapeHtml(key)}</th>${hours.map(hour => `<td data-hour="${hour}h">${input(key, hour)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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
            else if (this._photoOcrMeta && this._photoOcrMeta.refined === false) notice.textContent = 'Leitura feita em modo simples (não foi possível mapear a grade da tabela nesta foto). Confira os valores com atenção antes de confirmar.';
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
        estimateSkewDegrees,
        fitHourSequence,
        predictHour,
        latticeIsUsable,
        demoteCoarseOnlyRows,
        findVisibleContentBounds,
        findGridTableBounds,
        buildCellLattice,
        insetCellRect,
        measureCellInk,
        mergeCellReadings,
        applyRefinedCells,
        extractGlyphBitmaps,
        findLabelNumberSpan,
        findGlyphRuns,
        reconcileRowKeys,
        keepConsistentRowKeys,
        bitmapSimilarity,
        collectGlyphTemplates,
        classifyByTemplates,
        normalizePhotoImportSettings,
        canUsePhotoImport,
        install
    };
});
