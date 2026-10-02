// ============================================================
// TURNOS — REGRA UNICA E CENTRAL (v8.0)
// ------------------------------------------------------------
// Registro de Producao, Gerador de Relatorio, edicao de registros e a
// importacao por foto usam SOMENTE estas funcoes para saber quais horas
// pertencem a um turno. Nao copiar esta regra para outros arquivos.
//
// Regra fundamental: a hora inicial e INCLUSIVA e a hora final e EXCLUSIVA
// (ela inicia o proximo periodo). Quando a hora final e menor que a inicial
// o turno atravessa a meia-noite.
//   getShiftHours(13, 23) => [13..22]
//   getShiftHours(21, 7)  => [21,22,23,0,1,2,3,4,5,6]
//   getShiftHours(13, 13) => []   (invalido)
//
// Turnos pre-definidos (07x15, 15x23, 23x07, 07x19, 19x07) continuam com
// as mesmas horas, campos e taxas de antes. O turno personalizado e salvo
// no proprio campo "turno" do registro no formato HHxHH (ex.: "13x23").
// Taxa do personalizado: horas entre 07h e 19h usam a taxa do 07x19 e
// horas entre 19h e 07h usam a taxa do 19x07 (normal/feriado conforme o
// tipo escolhido).
// ============================================================
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.EvolutionShifts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PRESET_SHIFTS = ['07x15', '15x23', '23x07', '07x19', '19x07'];
    const CUSTOM_SHIFT_VALUE = 'custom';
    const DAY_START = 7;    // 07h..18h -> taxa diurna (07x19)
    const NIGHT_START = 19; // 19h..06h -> taxa noturna (19x07)
    const DAY_RATE_SHIFT = '07x19';
    const NIGHT_RATE_SHIFT = '19x07';

    const pad = value => String(value).padStart(2, '0');

    // Aceita 13, "13", "13:00". Retorna 0..23 ou null.
    function toHour(value) {
        if (value === null || value === undefined) return null;
        const text = String(value).trim();
        if (!/^\d{1,2}(:00)?$/.test(text)) return null;
        const hour = Number(text.split(':')[0]);
        return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
    }

    function formatShiftLabel(start, end) {
        return `${pad(start)}x${pad(end)}`;
    }

    function getShiftHours(start, end) {
        const s = toHour(start);
        const e = toHour(end);
        if (s === null || e === null || s === e) return [];
        const hours = [];
        let hour = s;
        while (hour !== e) {
            hours.push(hour);
            hour = (hour + 1) % 24;
        }
        return hours;
    }

    // "13x23" -> { start: 13, end: 23, label: "13x23" } | null quando invalido.
    function parseShiftLabel(label) {
        const match = String(label || '').match(/^(\d{2})x(\d{2})$/);
        if (!match) return null;
        const start = toHour(match[1]);
        const end = toHour(match[2]);
        if (start === null || end === null || start === end) return null;
        return { start, end, label: formatShiftLabel(start, end) };
    }

    function isPresetShift(label) {
        return PRESET_SHIFTS.indexOf(String(label || '')) !== -1;
    }

    function isValidShift(label) {
        return !!parseShiftLabel(label);
    }

    function isCustomShift(label) {
        return isValidShift(label) && !isPresetShift(label);
    }

    // Valida os campos Inicio/Fim do turno personalizado.
    function validateCustomShift(start, end) {
        const emptyStart = start === null || start === undefined || String(start).trim() === '';
        const emptyEnd = end === null || end === undefined || String(end).trim() === '';
        if (emptyStart || emptyEnd) {
            return { ok: false, error: 'Informe a hora inicial e a hora final do turno personalizado.' };
        }
        const s = toHour(start);
        const e = toHour(end);
        if (s === null || e === null) {
            return { ok: false, error: 'Horário inválido. Use horas entre 00 e 23.' };
        }
        if (s === e) {
            return { ok: false, error: 'A hora inicial e a hora final não podem ser iguais.' };
        }
        return { ok: true, start: s, end: e, label: formatShiftLabel(s, e) };
    }

    function isDayHour(hour) {
        return hour >= DAY_START && hour < NIGHT_START;
    }

    // Agrupa horas consecutivas: [17,18,7,8] -> [[17,18],[7,8]]
    function toRuns(hours) {
        const runs = [];
        hours.forEach(hour => {
            const last = runs[runs.length - 1];
            if (last && (last[last.length - 1] + 1) % 24 === hour) last.push(hour);
            else runs.push([hour]);
        });
        return runs;
    }

    function runsLabel(runs, separator) {
        return runs.map(run => {
            const first = run[0];
            const end = (run[run.length - 1] + 1) % 24;
            return separator === 'x' ? `${pad(first)}x${pad(end)}` : `${pad(first)}h-${pad(end)}h`;
        }).join(' + ');
    }

    /**
     * Segmentos de producao do turno (cada segmento = um campo de producao).
     *  - 15x23: 15h-19h / 19h-23h (P1/P2, como sempre foi)
     *  - demais pre-definidos: um unico "Producao Total"
     *  - personalizado: dividido em parte diurna (07h-19h) e noturna
     *    (19h-07h), na ordem em que aparecem no turno. Se o turno estiver
     *    todo em uma faixa, vira um unico "Producao Total".
     * Cada segmento: { label, reportLabel, hours:number[], rate:'day'|'night'|null }
     */
    function getShiftSegments(label) {
        const parsed = parseShiftLabel(label);
        if (!parsed) return [];
        const hours = getShiftHours(parsed.start, parsed.end);
        if (parsed.label === '15x23') {
            return [
                { label: '15h-19h', reportLabel: '15x19', hours: getShiftHours(15, 19), rate: null },
                { label: '19h-23h', reportLabel: '19x23', hours: getShiftHours(19, 23), rate: null }
            ];
        }
        if (isPresetShift(parsed.label)) {
            return [{ label: 'Produção Total', reportLabel: 'TOTAL', hours, rate: null }];
        }
        const bands = [];
        hours.forEach(hour => {
            const rate = isDayHour(hour) ? 'day' : 'night';
            let band = bands.find(item => item.rate === rate);
            if (!band) {
                band = { rate, hours: [] };
                bands.push(band);
            }
            band.hours.push(hour);
        });
        if (bands.length === 1) {
            return [{ label: 'Produção Total', reportLabel: 'TOTAL', hours, rate: bands[0].rate }];
        }
        return bands.map(band => {
            const runs = toRuns(band.hours);
            return {
                label: runsLabel(runs, 'h'),
                reportLabel: runsLabel(runs, 'x'),
                hours: band.hours,
                rate: band.rate
            };
        });
    }

    // Turno com dois campos de producao (P1/P2).
    function isSplitShift(label) {
        return getShiftSegments(label).length === 2;
    }

    // Opcoes 00:00..23:00 para os selects de Inicio/Fim.
    function hourOptionsHtml(selected) {
        const current = toHour(selected);
        let html = '<option value="">--:--</option>';
        for (let hour = 0; hour < 24; hour++) {
            html += `<option value="${pad(hour)}"${current === hour ? ' selected' : ''}>${pad(hour)}:00</option>`;
        }
        return html;
    }

    return {
        PRESET_SHIFTS,
        CUSTOM_SHIFT_VALUE,
        DAY_RATE_SHIFT,
        NIGHT_RATE_SHIFT,
        toHour,
        formatShiftLabel,
        getShiftHours,
        parseShiftLabel,
        isPresetShift,
        isValidShift,
        isCustomShift,
        validateCustomShift,
        isDayHour,
        getShiftSegments,
        isSplitShift,
        hourOptionsHtml
    };
});
