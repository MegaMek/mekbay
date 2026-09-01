// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asCrewPositionId, asLocationId } from '../entity/entity-identifiers';
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
        const pilotId = asCrewPositionId('crew:0');
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
            phaseStateChanged: true,
            endTurnCheckpoint: 'phase-ended',
            pendingFallConsequences: {
                eventId: 'fall:unit:3',
                totalDamage: 10,
                hitArcLabel: 'Front',
                applyPilotHits: true,
                forceSeatbeltFailure: false,
                seatbeltPositionIds: [pilotId],
                headHits: 1,
                stage: 'crew-hits',
                seatbeltFailures: [pilotId],
            },
        });

        const serialized = serializeMekTurnStateV2(state);
        expect(serialized.turnCounter).toBe(3);
        expect(serialized.acknowledgedHeatSources?.map(item => item.sourceId))
            .toEqual(['movement', 'weapons']);
        expect(serialized.endTurnCheckpoint).toBe('phase-ended');
        expect(serialized.pendingFallConsequences).toEqual({
            eventId: 'fall:unit:3',
            totalDamage: 10,
            hitArcLabel: 'Front',
            applyPilotHits: true,
            forceSeatbeltFailure: false,
            seatbeltPositionIds: [pilotId],
            headHits: 1,
            stage: 'crew-hits',
            seatbeltFailures: [pilotId],
        });

        const restored = deserializeMekTurnStateV2(JSON.parse(JSON.stringify(serialized)));
        expect(mekTurnStatesEqualV2(restored, state)).toBeTrue();
        expect(Object.isFrozen(restored)).toBeTrue();
        expect(Object.isFrozen(restored.pendingFallConsequences)).toBeTrue();
        expect(Object.isFrozen(restored.pendingFallConsequences?.seatbeltFailures)).toBeTrue();
        expect(() => (restored.acknowledgedHeatSources as Map<string, string>).set('other', '[]'))
            .toThrowError(TypeError);
    });

    it('uses one canonical sparse pristine representation', () => {
        const pristine = createPristineMekTurnStateV2();
        expect(serializeMekTurnStateV2(pristine)).toEqual({ schemaVersion: 1 });
        expect(pristine.turnCounter).toBe(0);
        expect(mekTurnStatesEqualV2(deserializeMekTurnStateV2({ schemaVersion: 1 }), pristine)).toBeTrue();
        expect(deserializeMekTurnStateV2({
            schemaVersion: 1,
            endTurnCheckpoint: 'heat-staged',
        }).endTurnCheckpoint).toBe('heat-staged');
    });

    it('round-trips the exact ordered critical cursor without rerolling it', () => {
        const locationId = asLocationId('mek:location:CT');
        const state = canonicalizeMekTurnStateV2({
            ...createPristineMekTurnStateV2(),
            pendingCriticalEvents: [{
                type: 'critical-chance',
                eventId: 'critical:unit:7:ct',
                locationId,
                target: 'pending',
                roll: [1, 1],
                modifier: -3,
                total: -1,
                result: 'none',
                breakdown: [{ label: 'Reinforced structure', value: -1 }],
                effects: ['No critical hits'],
                caseIIDiscards: [],
            }, {
                type: 'critical-hit',
                eventId: 'critical:unit:8:ct',
                locationId,
                target: 'committed',
                locationDestroyed: true,
                remainingHits: 2,
                caseIIDiscards: [false, true],
                roll: [4, 2],
            }],
        });

        const serialized = serializeMekTurnStateV2(state);
        const restored = deserializeMekTurnStateV2(JSON.parse(JSON.stringify(serialized)));

        expect(restored.pendingCriticalEvents).toEqual(state.pendingCriticalEvents);
        expect(Object.isFrozen(restored.pendingCriticalEvents)).toBeTrue();
        expect(Object.isFrozen(restored.pendingCriticalEvents?.[0])).toBeTrue();
        expect(Object.isFrozen(restored.pendingCriticalEvents?.[0]?.caseIIDiscards)).toBeTrue();
        expect(Object.isFrozen(restored.pendingCriticalEvents?.[1]?.roll)).toBeTrue();
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
        expect(() => deserializeMekTurnStateV2({ schemaVersion: 1, endTurnCheckpoint: 'complete' }))
            .toThrowError(MekTurnStateValidationError, /valid End Turn checkpoint/);
        expect(() => deserializeMekTurnStateV2({
            schemaVersion: 1,
            pendingFallConsequences: {
                eventId: 'fall:invalid',
                totalDamage: 5,
                hitArcLabel: 'Front',
                applyPilotHits: true,
                forceSeatbeltFailure: false,
                seatbeltPositionIds: ['crew:0'],
                headHits: 0,
                stage: 'seatbelts',
                seatbeltFailures: ['crew:0'],
            },
        })).toThrowError(MekTurnStateValidationError, /only valid at the crew-hits stage/);
        expect(() => deserializeMekTurnStateV2({
            schemaVersion: 1,
            pendingCriticalEvents: [{
                type: 'critical-hit',
                eventId: 'critical:invalid',
                locationId: 'mek:location:CT',
                target: 'committed',
                remainingHits: 2,
                caseIIDiscards: [false],
            }],
        })).toThrowError(MekTurnStateValidationError, /one CASE II result per remaining hit/);
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
