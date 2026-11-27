// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    MAX_HEAT_VALUE,
    PRISTINE_TURN_HEAT_LEDGER,
    projectTurnHeat,
    readTurnHeatLedger,
    serializeTurnHeatLedger,
    settleTurnHeatLedger,
} from './turn-heat-ledger';

const fail = (message: string, path: string): never => {
    throw new Error(`${path}: ${message}`);
};
const read = (settledHeat: unknown, consumed?: unknown) => readTurnHeatLedger(settledHeat, consumed, '$', fail);
const row = (sourceId: unknown, heat: unknown) => ({ sourceId, heat });

describe('turn heat ledger', () => {
    it('reads back the canonical wire it writes, an unsettled turn and a booked 0 included', () => {
        const ledger = settleTurnHeatLedger(PRISTINE_TURN_HEAT_LEDGER, 10, [
            { id: 'weapons', label: 'Weapons', value: 6 },
            { id: 'damaged-engine', label: 'Engine', value: 5 },
        ], 0);
        const wire = serializeTurnHeatLedger(ledger);
        const back = read(wire.settledHeat, wire.heatDissipationConsumed);

        expect([...back.settledHeat]).toEqual([['damaged-engine', 5], ['weapons', 6]]);
        expect(back.heatDissipationConsumed).toBe(0);
        expect(wire.heatDissipationConsumed).toBe(0);
        const pristine = read(undefined);
        expect([...pristine.settledHeat]).toEqual([]);
        expect(pristine.heatDissipationConsumed).toBe(PRISTINE_TURN_HEAT_LEDGER.heatDissipationConsumed);
    });

    for (const [title, settledHeat, consumed] of [
        ['an empty settled list', [], undefined],
        ['heat of 0', [row('weapons', 0)], undefined],
        ['fractional heat', [row('weapons', 1.5)], undefined],
        ['heat past the heat bound', [row('weapons', MAX_HEAT_VALUE + 1)], undefined],
        ['an empty source id', [row('', 1)], undefined],
        ['an untrimmed source id', [row(' weapons', 1)], undefined],
        ['a repeated source', [row('weapons', 1), row('weapons', 2)], undefined],
        ['unsorted sources', [row('weapons', 1), row('damaged-engine', 2)], undefined],
        ['an extra row field', [{ ...row('weapons', 1), value: 1 }], undefined],
        ['more than 256 sources', Array.from({ length: 257 }, (_, index) => row(`s${String(index).padStart(3, '0')}`, 1)),
            undefined],
        ['negative booked dissipation', undefined, -1],
        ['fractional booked dissipation', undefined, 0.5],
        ['booked dissipation past the heat bound', undefined, MAX_HEAT_VALUE + 1],
    ] as const) {
        it(`rejects ${title}`, () => {
            expect(() => read(settledHeat, consumed)).toThrowError();
        });
    }

    it('keeps projected heat within the heat bound', () => {
        expect(projectTurnHeat(MAX_HEAT_VALUE, [{ id: 'weapons', label: 'Weapons', value: 10 }], 0,
            PRISTINE_TURN_HEAT_LEDGER).projected).toBe(MAX_HEAT_VALUE);
    });

    it('never settles a source below what it settled before, and books only the dissipation the turn can still use', () => {
        const first = settleTurnHeatLedger(PRISTINE_TURN_HEAT_LEDGER, 10, [{ id: 'weapons', label: 'Weapons', value: 8 }], 8);
        // Sinks lost since: 8 booked against 6 left; the 2 over capacity came back as heat in this projection.
        const second = settleTurnHeatLedger(first, 6, [{ id: 'weapons', label: 'Weapons', value: 3 }], 0);

        expect(second.settledHeat.get('weapons')).toBe(8);
        expect(second.heatDissipationConsumed).toBe(6);
    });
});
