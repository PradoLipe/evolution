const assert = require('node:assert/strict');
const {
    normalizeLbs,
    parseHourToken,
    parseOcrResult,
    getTurnSegments,
    aggregateRows,
    hoursStartingInPeriod,
    getCellStatus,
    detectGridLines,
    buildCellLattice,
    insetCellRect,
    measureCellInk,
    mergeCellReadings,
    applyRefinedCells,
    normalizePhotoImportSettings,
    canUsePhotoImport,
    install
} = require('./photo-ocr.js');

function tsvWord(id, left, top, text, confidence = 95, width = 42, height = 24) {
    return `5\t1\t1\t1\t1\t${id}\t${left}\t${top}\t${width}\t${height}\t${confidence}\t${text}`;
}

const header = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'];
const hours = Array.from({ length: 9 }, (_, index) => String(index).padStart(2, '0'));
hours.forEach((hour, index) => header.push(tsvWord(index + 1, 180 + index * 70, 20, hour)));
header.push(tsvWord(20, 20, 100, 'LBS'));
header.push(tsvWord(21, 90, 100, '08'));
[22, 18, 15, 19, 15, 14, 11, 7, 17].forEach((value, index) => header.push(tsvWord(30 + index, 180 + index * 70, 100, String(value))));

const parsed = parseOcrResult(header.join('\n'), '');
assert.equal(normalizeLbs('8'), 'LBS 08');
assert.equal(parseHourToken('10:00').value, 10);
assert.equal(parseHourToken('0900').value, 9);
assert.deepEqual(parsed.hours, hours);
assert.deepEqual(
    Object.fromEntries(hours.map(hour => [hour, parsed.rows['LBS 08'][hour].value])),
    { '00': 22, '01': 18, '02': 15, '03': 19, '04': 15, '05': 14, '06': 11, '07': 7, '08': 17 }
);

// ---------------------------------------------------------------------------
// TESTE 1 — 07:00 às 15:00 deve começar exatamente às 07 (não 08).
// ---------------------------------------------------------------------------
assert.deepEqual(getTurnSegments('07x15')[0].hours, ['07', '08', '09', '10', '11', '12', '13', '14']);
assert.ok(getTurnSegments('07x15')[0].hours.includes('07'), '07x15 precisa incluir a hora 07');
assert.ok(!getTurnSegments('07x15')[0].hours.includes('15'), '07x15 nao deve incluir a hora final 15 (exclusiva, sem duplo bucket)');

// ---------------------------------------------------------------------------
// TESTE 2 — todos os turnos existentes no projeto comecam na hora configurada,
// sem deslocamento de +1/-1, e a logica e generica (hoursStartingInPeriod),
// nao ha excecao hardcoded por turno.
// ---------------------------------------------------------------------------
assert.deepEqual(getTurnSegments('15x23').map(segment => segment.hours), [
    ['15', '16', '17', '18'],
    ['19', '20', '21', '22']
]);
assert.deepEqual(getTurnSegments('23x07')[0].hours, ['23', '00', '01', '02', '03', '04', '05', '06']);
assert.deepEqual(getTurnSegments('07x19')[0].hours, ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
assert.deepEqual(getTurnSegments('19x07')[0].hours, ['19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06']);

// ---------------------------------------------------------------------------
// TESTE 3 — virada de dia (23x07 e 19x07): a sequencia de horas deve
// atravessar a meia-noite corretamente, comecando na hora inicial do turno.
// ---------------------------------------------------------------------------
assert.deepEqual(hoursStartingInPeriod(23, 7), ['23', '00', '01', '02', '03', '04', '05', '06']);
assert.deepEqual(hoursStartingInPeriod(19, 7), ['19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06']);

// Nenhum turno duplica ou pula hora: cada turno HHxHH tem exatamente a
// quantidade de horas correspondente à duração do turno.
['07x15', '15x23', '23x07', '07x19', '19x07'].forEach(turno => {
    const totalHours = getTurnSegments(turno).reduce((sum, segment) => sum + segment.hours.length, 0);
    const uniqueHours = new Set(getTurnSegments(turno).flatMap(segment => segment.hours));
    assert.equal(uniqueHours.size, totalHours, `${turno}: nao pode haver hora repetida entre segmentos`);
});

// ---------------------------------------------------------------------------
// TESTE 4, 5 e 6 — classificação VERDE (reconhecido) / AMARELO (sem
// produção, assume 0) / VERMELHO (falha real de OCR, exige revisão).
// ---------------------------------------------------------------------------
assert.deepEqual(getCellStatus({ value: 12, uncertain: false }), { value: 12, status: 'recognized' });
assert.deepEqual(getCellStatus({ value: 0, uncertain: false }), { value: 0, status: 'recognized' });
assert.deepEqual(getCellStatus(undefined), { value: 0, status: 'empty' });
assert.deepEqual(getCellStatus(null), { value: 0, status: 'empty' });
assert.deepEqual(getCellStatus({ value: null, uncertain: true }), { value: null, status: 'unrecognized' });

// ---------------------------------------------------------------------------
// TESTE 7 — vários horários sem produção (celulas ausentes) devem contar
// como 0/AMARELO e NAO bloquear a confirmacao (unresolved vazio).
// ---------------------------------------------------------------------------
assert.equal(aggregateRows({ 'LBS 01': { '16': { value: 0 } } }, '15x23').unresolved.length, 0);
assert.deepEqual(aggregateRows({ 'LBS 01': { '16': { value: 0 } } }, '15x23').totals, [0, 0]);

// Apenas celulas explicitamente nao reconhecidas (value: null) entram em
// "unresolved" e exigem revisao (VERMELHO).
assert.equal(
    aggregateRows({ 'LBS 01': { '16': { value: 0 }, '17': { value: null, uncertain: true } } }, '15x23').unresolved.length,
    1
);

const rows = {
    'LBS 01': Object.fromEntries(['15', '16', '17', '18'].map(hour => [hour, { value: 1 }])),
    'LBS 08': Object.fromEntries(['15', '16', '17', '18', '19', '20', '21', '22'].map(hour => [hour, { value: 2 }]))
};
// LBS 01 nao tem valores para 19-22: viram AMARELO/0, nao bloqueiam o total.
assert.deepEqual(aggregateRows(rows, '15x23', ['LBS 08']).totals, [8, 8]);
assert.deepEqual(aggregateRows(rows, '15x23').totals, [12, 8]);
assert.equal(aggregateRows(rows, '15x23').unresolved.length, 0);

// hour '23' nao existe nesta grade sintetica (00..08) -> conta como AMARELO/0
assert.deepEqual(aggregateRows(parsed.rows, '23x07', ['LBS 08']).totals, [114]);

// ---------------------------------------------------------------------------
// Caso real (grade extraida por coordenadas, como na imagem de referencia):
// colunas descendentes 10,09,...,00,23 — turno 23x07 deve comecar em 23.
// ---------------------------------------------------------------------------
const realHeader = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'];
const realHours = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 23];
realHours.forEach((hour, index) => realHeader.push(tsvWord(index + 1, 180 + index * 70, 20, `${String(hour).padStart(2, '0')}:00`)));
[
    ['07', [14, 10, 6, 3, 16, 9, 15, 16, 0, 3, 14, 13]],
    ['08', [9, 19, 17, 7, 11, 14, 15, 19, 15, 18, 22, 17]],
    ['09', [0, 0, 0, 0, 0, 22, 12, 14, 0, 10, 19, 12]]
].forEach(([lbs, values], rowIndex) => {
    const top = 100 + rowIndex * 48;
    realHeader.push(tsvWord(100 + rowIndex * 20, 20, top, 'LBS'));
    realHeader.push(tsvWord(101 + rowIndex * 20, 90, top, lbs));
    values.forEach((value, index) => {
        const repeatedOneOcr = lbs === '08' && index === 4;
        realHeader.push(tsvWord(
            102 + rowIndex * 20 + index,
            180 + index * 70,
            top,
            repeatedOneOcr ? '1' : String(value),
            repeatedOneOcr ? 82 : 95,
            repeatedOneOcr ? 23 : 42,
            repeatedOneOcr ? 18 : 24
        ));
    });
});
const realParsed = parseOcrResult(realHeader.join('\n'), '');
assert.deepEqual(realParsed.hours, realHours.map(hour => String(hour).padStart(2, '0')));
assert.deepEqual(aggregateRows(realParsed.rows, '23x07', ['LBS 08']).totals, [131]);
assert.deepEqual(aggregateRows(realParsed.rows, '23x07').totals, [306]);

// ---------------------------------------------------------------------------
// TESTE 8/9 — Gerar Relatório (somente a LBS informada) e Registrar Produção
// (todos os lançamentos do período) continuam intactos: aggregateRows já
// aceita `selectedKeys` para restringir a uma única LBS, e sem esse filtro
// soma todas — esse contrato não foi alterado por esta correção.
// ---------------------------------------------------------------------------
assert.deepEqual(aggregateRows(realParsed.rows, '23x07', ['LBS 08']).keys, ['LBS 08']);
assert.deepEqual(aggregateRows(realParsed.rows, '23x07').keys.sort(), ['LBS 07', 'LBS 08', 'LBS 09']);

// ===========================================================================
// REFINAMENTO CELULA A CELULA
// ===========================================================================

// Imagem sintetica no mesmo padrao do painel: fundo escuro, linhas de grade
// cinza-neutras e numeros brancos.
function buildFakeTable() {
    const width = 600;
    const height = 200;
    const data = new Uint8ClampedArray(width * height * 4);
    const paint = (x, y, r, g, b) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const index = (y * width + x) * 4;
        data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = 255;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, 18, 24, 31); // fundo
    const xs = [0, 100, 200, 300, 400, 500, 599];
    const ys = [0, 40, 80, 120, 160, 199];
    xs.forEach(x => { for (let y = 0; y < height; y++) paint(x, y, 128, 128, 128); });
    ys.forEach(y => { for (let x = 0; x < width; x++) paint(x, y, 128, 128, 128); });
    // "numero" branco dentro da celula (coluna 100-200, linha 40-80)
    for (let y = 52; y < 68; y++) for (let x = 140; x < 160; x++) paint(x, y, 255, 255, 255);
    return { imageData: { data }, width, height, xs, ys };
}

const fake = buildFakeTable();
const gridLines = detectGridLines(fake.imageData, fake.width, fake.height);
assert.ok(gridLines, 'a grade precisa ser detectada');
assert.deepEqual(gridLines.xs, fake.xs);
assert.deepEqual(gridLines.ys, fake.ys);

const layout = {
    headers: [{ hour: 12, x: 150 }, { hour: 11, x: 250 }, { hour: 10, x: 350 }],
    rows: [{ key: 'LBS 07', y: 60 }, { key: 'LBS 08', y: 100 }]
};
const lattice = buildCellLattice(gridLines, layout);
assert.ok(lattice, 'a grade + estrutura precisam gerar o lattice de celulas');
assert.deepEqual(lattice.columns, [
    { hour: '12', left: 100, right: 200 },
    { hour: '11', left: 200, right: 300 },
    { hour: '10', left: 300, right: 400 }
]);
assert.deepEqual(lattice.rows, [
    { key: 'LBS 07', top: 40, bottom: 80 },
    { key: 'LBS 08', top: 80, bottom: 120 }
]);

// Duas horas caindo na mesma coluna = grade nao confiavel -> volta para a 1a passada
assert.equal(buildCellLattice(gridLines, {
    headers: [{ hour: 12, x: 120 }, { hour: 11, x: 180 }],
    rows: layout.rows
}), null);

// O recorte fica DENTRO da celula (nao pega a borda nem a coluna vizinha)
const rect = insetCellRect(lattice.columns[0], lattice.rows[0], fake.width, fake.height);
assert.ok(rect.left > lattice.columns[0].left && rect.left + rect.width < lattice.columns[0].right);
assert.ok(rect.top > lattice.rows[0].top && rect.top + rect.height < lattice.rows[0].bottom);

// Teste de tinta: celula com numero tem tinta; celula vazia nao.
function cropFake(rectangle) {
    const out = new Uint8ClampedArray(rectangle.width * rectangle.height * 4);
    for (let y = 0; y < rectangle.height; y++) {
        for (let x = 0; x < rectangle.width; x++) {
            const from = ((rectangle.top + y) * fake.width + (rectangle.left + x)) * 4;
            const to = (y * rectangle.width + x) * 4;
            out[to] = fake.imageData.data[from];
            out[to + 1] = fake.imageData.data[from + 1];
            out[to + 2] = fake.imageData.data[from + 2];
            out[to + 3] = 255;
        }
    }
    return { data: out };
}
const inked = measureCellInk(cropFake(rect), rect.width, rect.height);
assert.ok(inked.inkRatio > 0.004, 'celula com numero precisa acusar tinta');
assert.equal(inked.darkBackground, true);
const emptyRect = insetCellRect(lattice.columns[1], lattice.rows[0], fake.width, fake.height);
assert.equal(measureCellInk(cropFake(emptyRect), emptyRect.width, emptyRect.height).inkRatio, 0, 'celula vazia nao pode acusar tinta');
assert.equal(inked.blobs, 1, 'um unico numero desenhado = 1 bloco de tinta');

// Dois numeros lado a lado = 2 blocos: e essa contagem geometrica que
// denuncia quando o OCR perde um digito (ex.: ler "4" onde esta escrito "14").
function cellWithTwoDigits() {
    const width = 80, height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 18; data[i + 1] = 24; data[i + 2] = 31; data[i + 3] = 255; }
    const bar = (from, to) => {
        for (let y = 8; y < 22; y++) for (let x = from; x < to; x++) {
            const i = (y * width + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = 255;
        }
    };
    bar(20, 30);
    bar(40, 50);
    return { data };
}
assert.equal(measureCellInk(cellWithTwoDigits(), 80, 30).blobs, 2);

// ---------------------------------------------------------------------------
// VETO GEOMETRICO — o OCR leu menos digitos do que existem desenhados.
// Sem confirmacao da 1a passada, vai para revisao em vez de gravar errado.
// ---------------------------------------------------------------------------
const lostDigit = mergeCellReadings(undefined, { status: 'value', value: 4, confidence: 95, raw: '4', blobs: 2, geometryOk: false });
assert.equal(getCellStatus(lostDigit).status, 'unrecognized');
assert.equal(lostDigit.source, 'geometry');

// Se a 1a passada confirma o mesmo valor, o veto nao se aplica.
const confirmed = mergeCellReadings({ value: 4, confidence: 90 }, { status: 'value', value: 4, confidence: 95, raw: '4', blobs: 2, geometryOk: false });
assert.equal(confirmed.value, 4);
assert.equal(getCellStatus(confirmed).status, 'recognized');

// ---------------------------------------------------------------------------
// O "0" isolado: confianca do OCR um pouco menor e aceita quando a geometria
// confirma que ha um unico algarismo na celula (era exatamente aqui que os
// zeros das 11h e 12h da LBS 09 caiam como "nao reconhecido").
// ---------------------------------------------------------------------------
const lonelyZero = mergeCellReadings(undefined, { status: 'value', value: 0, confidence: 58, raw: '0', blobs: 1, geometryOk: true });
assert.equal(lonelyZero.value, 0);
assert.equal(getCellStatus(lonelyZero).status, 'recognized');

// Sem confirmacao geometrica, a mesma confianca nao passa.
const unconfirmed = mergeCellReadings(undefined, { status: 'value', value: 0, confidence: 58, raw: '0', blobs: null, geometryOk: null });
assert.equal(getCellStatus(unconfirmed).status, 'unrecognized');

// ---------------------------------------------------------------------------
// CASO RELATADO 1 — "0" que nao era reconhecido.
// Celula sem tinta vira AMARELO/0 (nunca vermelho); "0" lido com confianca
// vira VERDE com valor 0 de verdade.
// ---------------------------------------------------------------------------
assert.equal(mergeCellReadings(undefined, { status: 'empty', confidence: 100 }), null); // -> AMARELO (0)
assert.equal(mergeCellReadings({ value: null, uncertain: true, confidence: 20 }, { status: 'empty', confidence: 100 }), null);
const zero = mergeCellReadings(undefined, { status: 'value', value: 0, confidence: 88, raw: '0' });
assert.equal(zero.value, 0);
assert.equal(getCellStatus(zero).status, 'recognized'); // VERDE

// Celula COM tinta mas ilegivel continua VERMELHA (nao vira 0 chutado)
const unreadable = mergeCellReadings(undefined, { status: 'unreadable', confidence: 10 });
assert.equal(getCellStatus(unreadable).status, 'unrecognized');

// ---------------------------------------------------------------------------
// CASO RELATADO 2 — "15" lido como "16".
// Divergencia entre a leitura da tabela inteira e a leitura da celula:
// so vale a da celula se ela estiver bem confiante; caso contrario o campo
// fica VERMELHO para o conferente decidir, em vez de gravar numero errado.
// ---------------------------------------------------------------------------
const confident = mergeCellReadings({ value: 16, confidence: 70 }, { status: 'value', value: 15, confidence: 92, raw: '15' });
assert.equal(confident.value, 15);
assert.equal(getCellStatus(confident).status, 'recognized');

const conflicted = mergeCellReadings({ value: 16, confidence: 70 }, { status: 'value', value: 15, confidence: 55, raw: '15' });
assert.equal(getCellStatus(conflicted).status, 'unrecognized'); // VERMELHO, sem chute
assert.equal(conflicted.source, 'conflict');

// Duas leituras concordando = maior confianca possivel
const agreed = mergeCellReadings({ value: 15, confidence: 64 }, { status: 'value', value: 15, confidence: 90, raw: '15' });
assert.equal(agreed.value, 15);
assert.equal(agreed.source, 'both');
assert.equal(agreed.uncertain, false);

// applyRefinedCells aplica tudo isso sobre as linhas da 1a passada
const refinedRows = applyRefinedCells(
    { 'LBS 07': { '12': { value: 16, confidence: 60 }, '11': { value: 3, confidence: 82 } } },
    {
        'LBS 07': {
            '12': { status: 'value', value: 15, confidence: 95, raw: '15' }, // corrige 16 -> 15
            '11': { status: 'empty', confidence: 100 },                      // 3 fantasma some -> AMARELO
            '10': { status: 'value', value: 7, confidence: 80, raw: '7' }    // celula que a 1a passada perdeu
        }
    }
);
assert.equal(refinedRows['LBS 07']['12'].value, 15);
assert.equal(refinedRows['LBS 07']['11'], undefined);
assert.equal(getCellStatus(refinedRows['LBS 07']['11']).status, 'empty');
assert.equal(refinedRows['LBS 07']['10'].value, 7);

// A 1a passada so vence o teste de tinta quando estava MUITO confiante
// (protecao contra grade levemente deslocada)
const keepsCoarse = applyRefinedCells(
    { 'LBS 07': { '12': { value: 19, confidence: 95 } } },
    { 'LBS 07': { '12': { status: 'empty', confidence: 100 } } }
);
assert.equal(keepsCoarse['LBS 07']['12'].value, 19);

// ===========================================================================
// CONTROLE DE ACESSO (recurso em beta, ligado pelo painel adm)
// ===========================================================================

// Padrao seguro: nasce desligado e restrito a administradores.
assert.deepEqual(normalizePhotoImportSettings(undefined), { enabled: false, audience: 'admins' });
assert.deepEqual(normalizePhotoImportSettings({ enabled: true, audience: 'invalido' }), { enabled: true, audience: 'admins' });

const ADMIN = { isAdmin: true };
const BETA = { isAdmin: false, betaUser: true };
const COMUM = { isAdmin: false, betaUser: false };

// Desligado: ninguem usa, nem o admin (para ele conferir a tela do usuario).
[ADMIN, BETA, COMUM].forEach(scope => {
    assert.equal(canUsePhotoImport({ enabled: false, audience: 'all' }, scope), false);
});

// Somente administradores
assert.equal(canUsePhotoImport({ enabled: true, audience: 'admins' }, ADMIN), true);
assert.equal(canUsePhotoImport({ enabled: true, audience: 'admins' }, BETA), false);
assert.equal(canUsePhotoImport({ enabled: true, audience: 'admins' }, COMUM), false);

// Usuarios selecionados (os testadores)
assert.equal(canUsePhotoImport({ enabled: true, audience: 'selected' }, ADMIN), true);
assert.equal(canUsePhotoImport({ enabled: true, audience: 'selected' }, BETA), true);
assert.equal(canUsePhotoImport({ enabled: true, audience: 'selected' }, COMUM), false);

// Todos
assert.equal(canUsePhotoImport({ enabled: true, audience: 'all' }, COMUM), true);

// Sem contexto de usuario (antes do login) nao libera nada alem do padrao.
assert.equal(canUsePhotoImport({ enabled: true, audience: 'selected' }, undefined), false);

class FakeEvolutionApp {}
install(FakeEvolutionApp);
assert.equal(typeof FakeEvolutionApp.prototype.startPhotoImport, 'function');
assert.equal(typeof FakeEvolutionApp.prototype.confirmPhotoImport, 'function');
assert.equal(typeof FakeEvolutionApp.prototype.transferPhotoReportToEntry, 'function');
assert.equal(typeof FakeEvolutionApp.prototype._refinePhotoCells, 'function');
assert.equal(typeof FakeEvolutionApp.prototype._readPhotoCell, 'function');
assert.equal(typeof FakeEvolutionApp.prototype.canUsePhotoImport, 'function');
assert.equal(typeof FakeEvolutionApp.prototype.applyPhotoImportAccess, 'function');
assert.equal(typeof FakeEvolutionApp.prototype.setPhotoImportSettings, 'function');
assert.equal(typeof FakeEvolutionApp.prototype.renderPhotoReview, 'function');

console.log('photo-ocr: testes concluídos com sucesso');
