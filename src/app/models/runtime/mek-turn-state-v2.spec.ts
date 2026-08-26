// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    MAX_MEK_TURN_COLLECTION_ENTRIES,
    MekTurnStateValidationError,
    canonicalizeMekTurnStateV2,
    createPristineMekTurnStateV2,
    deserializeMekTurnStateV2,
    mekTurnStatesEqualV2,
    serializeMekTurnStateV2,
} from './mek-turn-state-v2';

describe('Mek V2 turn state', () => {
    it('canonicalizes live turn facts and round-trips its sorted immutable heat ledger', () => {
        const state = canonicalizeMekTurnStateV2({
            ...createPristineMekTurnStateV2(),
            turnCounter: 3,
            airborne: false,
            weaponsHeat: 8,
            acknowledgedHeatSources: new Map([
                ['weapons', '[8,null,null]'],
                ['movement', '[3,null,null]'],
            ]),
            heatDissipationConsumed: 7,
            spotting: true,
            equipmentStateChanged: true,
        });

        const serialized = serializeMekTurnStateV2(state);
        expect(serialized.turnCounter).toBe(3);
        expect(serialized.acknowledgedHeatSources?.map(item => item.sourceId))
            .toEqual(['movement', 'weapons']);

        const restored = deserializeMekTurnStateV2(JSON.parse(JSON.stringify(serialized)));
        expect(mekTurnStatesEqualV2(restored, state)).toBeTrue();
        expect(Object.isFrozen(restored)).toBeTrue();
        expect(() => (restored.acknowledgedHeatSources as Map<string, string>).set('other', '[]'))
            .toThrowError(TypeError);
    });

    it('uses one canonical sparse pristine representation', () => {
        const pristine = createPristineMekTurnStateV2();
        expect(serializeMekTurnStateV2(pristine)).toEqual({ schemaVersion: 1 });
        expect(pristine.turnCounter).toBe(0);
        expect(mekTurnStatesEqualV2(deserializeMekTurnStateV2({ schemaVersion: 1 }), pristine)).toBeTrue();
    });

    it('round-trips sparse production cover without adding a parallel UI state', () => {
        const state = canonicalizeMekTurnStateV2({
            ...createPristineMekTurnStateV2(),
            cover: 'underwater-depth-2',
        });

        expect(serializeMekTurnStateV2(state)).toEqual({ schemaVersion: 1, cover: 4 });
        expect(deserializeMekTurnStateV2({ schemaVersion: 1, cover: 7 }).cover)
            .toBe('building-2');
        expect(() => deserializeMekTurnStateV2({ schemaVersion: 1, cover: 9 }))
            .toThrowError(MekTurnStateValidationError, /serialized unit cover/);
    });

    it('fails closed on unknown fields, non-canonical order/defaults, and oversized collections', () => {
        expect(() => deserializeMekTurnStateV2({ schemaVersion: 1, future: true }))
            .toThrowError(MekTurnStateValidationError, /unknown field/);
        expect(() => deserializeMekTurnStateV2({ schemaVersion: 1, moveMode: 'walk' }))
            .toThrowError(MekTurnStateValidationError, /unknown field/);
        expect(() => deserializeMekTurnStateV2({ schemaVersion: 1, weaponsHeat: 0 }))
            .toThrowError(MekTurnStateValidationError, /sparse number must be positive/);
        expect(() => deserializeMekTurnStateV2({
            schemaVersion: 1,
            acknowledgedHeatSources: [
                { sourceId: 'z', signature: '[]' },
                { sourceId: 'a', signature: '[]' },
            ],
        })).toThrowError(MekTurnStateValidationError, /unique and sorted/);
        expect(() => deserializeMekTurnStateV2({
            schemaVersion: 1,
            acknowledgedHeatSources: Array.from(
                { length: MAX_MEK_TURN_COLLECTION_ENTRIES + 1 },
                (_, index) => ({ sourceId: `source:${index}`, signature: '[]' }),
            ),
        })).toThrowError(MekTurnStateValidationError, /at most 256/);
    });
});
