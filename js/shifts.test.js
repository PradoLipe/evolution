// Testes da regra central de turnos (v8.0). Rodar: node js/shifts.test.js
const assert = require('node:assert/strict');
const S = require('./shifts.js');

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

// 1-3: turnos pre-definidos — mesmas horas de antes
assert.deepEqual(S.getShiftSegments('07x15').flatMap(s => s.hours), range(7, 15));
assert.deepEqual(S.getShiftSegments('15x23').flatMap(s => s.hours), range(15, 23));
assert.deepEqual(S.getShiftSegments('15x23').map(s => s.label), ['15h-19h', '19h-23h']);
assert.deepEqual(S.getShiftSegments('15x23').map(s => s.reportLabel), ['15x19', '19x23']);
assert.deepEqual(S.getShiftSegments('23x07').flatMap(s => s.hours), [23, 0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(S.getShiftSegments('07x19').flatMap(s => s.hours), range(7, 19));
assert.deepEqual(S.getShiftSegments('19x07').flatMap(s => s.hours), [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]);
['07x15', '23x07', '07x19', '19x07'].forEach(t => {
    assert.equal(S.getShiftSegments(t).length, 1, `${t} continua com um unico campo`);
    assert.equal(S.getShiftSegments(t)[0].label, 'Produção Total');
    assert.ok(S.isPresetShift(t) && !S.isCustomShift(t));
});

// 4: personalizado 13x23 -> 13..22, dividido em diurno 13-19 e noturno 19-23
assert.deepEqual(S.getShiftHours(13, 23), range(13, 23));
const s1323 = S.getShiftSegments('13x23');
assert.deepEqual(s1323.map(s => [s.label, s.rate]), [['13h-19h', 'day'], ['19h-23h', 'night']]);
assert.deepEqual(s1323.flatMap(s => s.hours), range(13, 23));
assert.ok(!s1323.flatMap(s => s.hours).includes(23), '23h nao pertence ao 13x23');

// 5: personalizado 21x07 -> 21..06, todo noturno
assert.deepEqual(S.getShiftHours(21, 7), [21, 22, 23, 0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(S.getShiftSegments('21x07').map(s => s.rate), ['night']);
assert.ok(!S.getShiftHours(21, 7).includes(7));

// 6: personalizado 08x17 -> 08..16, todo diurno
assert.deepEqual(S.getShiftHours(8, 17), range(8, 17));
assert.deepEqual(S.getShiftSegments('08x17').map(s => s.rate), ['day']);

// 7: invalido 13x13 -> bloqueado
assert.deepEqual(S.getShiftHours(13, 13), []);
assert.deepEqual(S.getShiftSegments('13x13'), []);
assert.equal(S.parseShiftLabel('13x13'), null);
assert.equal(S.validateCustomShift('13', '13').ok, false);
assert.match(S.validateCustomShift('13', '13').error, /não podem ser iguais/);

// Validacoes de entrada
assert.equal(S.validateCustomShift('', '23').ok, false);
assert.equal(S.validateCustomShift('13', undefined).ok, false);
assert.equal(S.validateCustomShift('24', '07').ok, false);
assert.equal(S.validateCustomShift('ab', '07').ok, false);
assert.equal(S.validateCustomShift('-1', '07').ok, false);
assert.deepEqual(S.validateCustomShift('13', '23'), { ok: true, start: 13, end: 23, label: '13x23' });
assert.deepEqual(S.validateCustomShift('21:00', '07:00').label, '21x07');
assert.equal(S.parseShiftLabel('25x07'), null);
assert.equal(S.parseShiftLabel('7x15'), null);

// Virada de dia: 23x07, 19x07, 21x07 validos
['23x07', '19x07', '21x07'].forEach(t => assert.ok(S.isValidShift(t), t));

// Turno com 3 trechos (17x09): agrupa por faixa de taxa, sem perder/duplicar hora
const s1709 = S.getShiftSegments('17x09');
assert.deepEqual(s1709.map(s => s.rate), ['day', 'night']);
assert.deepEqual(s1709[0].hours, [17, 18, 7, 8]);
assert.equal(s1709[0].reportLabel, '17x19 + 07x09');
assert.equal(new Set(s1709.flatMap(s => s.hours)).size, 16);

// Nenhum turno valido duplica ou pula hora
for (let a = 0; a < 24; a++) for (let b = 0; b < 24; b++) {
    if (a === b) continue;
    const label = S.formatShiftLabel(a, b);
    const hours = S.getShiftSegments(label).flatMap(s => s.hours);
    assert.equal(hours.length, (b - a + 24) % 24, label);
    assert.equal(new Set(hours).size, hours.length, label);
    assert.ok(hours.includes(a) && !hours.includes(b), label);
}

console.log('shifts: testes concluídos com sucesso');
