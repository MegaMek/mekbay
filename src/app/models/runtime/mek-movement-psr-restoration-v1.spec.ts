// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    serializeMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    canonicalizeLegacyMekTurnStateV1,
    createPristineLegacyMekTurnStateV1,
    parseLegacyMekTurnStateV1,
} from './legacy-mek-turn-state-v1';
import {
    projectLegacyMekTurnStateV1,
    restoreLegacyMekMovementPsrV1,
} from './mek-movement-psr-restoration-v1';

describe('legacy Mek movement/PSR restoration V1', () => {
    it('keeps valid heat acknowledgements and piloting facts when neighboring entries are invalid', () => {
        const parsed = parseLegacyMekTurnStateV1({
            acknowledgedHeatSources: { source: 'signature', invalid: { discarded: true } },
            psrOutcomes: { valid: 'success', invalid: 'unknown' },
            psrChecks: {
                legActuators: { LL: 2, RL: -1 }, hipsHit: ['LL', null],
                gyroHit: 1, gyroDestroyed: 'invalid', unknownField: { discarded: true },
            },
            turnCounter: 2,
        });

        expect([...parsed.state.acknowledgedHeatSources]).toEqual([['source', 'signature']]);
        expect([...parsed.state.psrOutcomes]).toEqual([['valid', 'success']]);
        expect([...parsed.state.psrChecks.legActuators]).toEqual([['LL', 2]]);
        expect([...parsed.state.psrChecks.hipsHit]).toEqual(['LL']);
        expect(parsed.state.psrChecks.gyroHit).toBe(1);
        expect(parsed.state.psrChecks.gyroDestroyed).toBeFalse();
        expect(parsed.state.turnCounter).toBe(2);
        expect(parsed.warnings.length).toBe(3);
        expect(Object.keys(parsed).sort()).toEqual(['state', 'warnings']);
        expect(JSON.stringify(parsed)).not.toContain('discarded');
    });

    it('resets an unreadable turn with one warning and no raw diagnostic payload', () => {
        const parsed = parseLegacyMekTurnStateV1(['unreadable']);
        expect(parsed.state).toBe(createPristineLegacyMekTurnStateV1());
        expect(parsed.warnings.length).toBe(1);
        expect(Object.keys(parsed).sort()).toEqual(['state', 'warnings']);
    });

    it('materializes a pristine typed state from an absent legacy turn', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1(undefined));

        expect(result.kind).toBe('supported');
        if (result.kind !== 'supported') return;
        expect(serializeMekMovementPsrStateV2(result.state)).toEqual({ schemaVersion: 2 });
        expect(Object.isFrozen(result)).toBeTrue();
        expect(Object.isFrozen(result.state)).toBeTrue();
    });

    it('materializes only safe declarations and phase damage without inventing checks', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            moveMode: 'walk',
            moveDistance: 5,
            dmgReceived: 19,
        }));

        expect(result.kind).toBe('supported');
        if (result.kind !== 'supported') return;
        expect(serializeMekMovementPsrStateV2(result.state)).toEqual({
            schemaVersion: 2,
            movement: {
                schemaVersion: 1,
                mode: 'walk',
                distance: 5,
                boosterComponentIds: [],
            },
            damageThisPhase: 19,
        });
    });

    it('restores production standing state, including its zero-distance walk declaration', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            moveMode: 'walk',
            moveDistance: 0,
            standAttempts: 1,
            carefulStand: true,
        }));

        expect(result.kind).toBe('supported');
        if (result.kind !== 'supported') return;
        expect(serializeMekMovementPsrStateV2(result.state)).toEqual({
            schemaVersion: 2,
            movement: {
                schemaVersion: 1,
                mode: 'walk',
                distance: 0,
                boosterComponentIds: [],
            },
            standAttempts: 1,
            carefulStand: true,
        });
    });

    it('warns and resets malformed standing fields without inventing attempts', () => {
        const parsed = parseLegacyMekTurnStateV1({
            carefulStand: true,
        });
        const result = restoreLegacyMekMovementPsrV1(parsed);

        expect(parsed.warnings.length).toBe(1);
        expect(parsed.state.carefulStand).toBeFalse();
        expect(parsed.state.standAttempts).toBe(0);
        expect(result.kind).toBe('supported');
    });

    it('carries production V1 cover into the one current turn-state model', () => {
        const legacy = parseLegacyMekTurnStateV1({ cover: 8, turnCounter: 4 });

        expect(legacy.warnings).toEqual([]);
        expect(legacy.state.cover).toBe('building-3');
        expect(projectLegacyMekTurnStateV1(legacy.state).cover).toBe('building-3');
        expect(projectLegacyMekTurnStateV1(legacy.state).turnCounter).toBe(4);
    });

    it('uses the strict old-wire applyMovePSR default only after legacy decoding', () => {
        const absent = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            moveMode: 'run', moveDistance: 8,
        }));
        const disabled = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            moveMode: 'run', moveDistance: 8, applyMovePSR: false,
        }));

        expect(absent).toEqual(jasmine.objectContaining({
            kind: 'unsupported',
            warnings: ['Saved movement required piloting history that was not recorded and could not be converted.'],
        }));
        expect(disabled.kind).toBe('supported');
    });

    it('does not apply the movement-witness blocker to stationary, walk, or UMU', () => {
        for (const [moveMode, moveDistance] of [
            ['stationary', 0], ['walk', 4], ['UMU', 3],
        ] as const) {
            const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
                moveMode, moveDistance,
            }));
            expect(result.kind).withContext(moveMode).toBe('supported');
        }
    });

    it('classifies incoherent mode/distance pairs without guessing', () => {
        for (const raw of [
            { moveMode: 'walk' },
            { moveDistance: 4 },
            { moveMode: 'stationary', moveDistance: 1 },
        ]) {
            expect(restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1(raw))).toEqual(
                jasmine.objectContaining({
                    kind: 'unsupported',
                    warnings: jasmine.arrayContaining(['Saved movement had an inconsistent mode and distance and could not be converted.']),
                }),
            );
        }
    });

    it('separates unrepresentable distance from VTOL support', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            moveMode: 'VTOL',
            moveDistance: 1_001,
        }));

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported',
            warnings: [
                'Saved VTOL movement is unsupported for this Mek and could not be converted.',
                'Saved movement distance is outside the supported range and could not be converted.',
            ],
        }));
    });

    it('retains fractional and threshold damage as distinct warnings', () => {
        const fractional = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            dmgReceived: 0.5,
        }));
        const threshold = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            dmgReceived: 20,
        }));

        expect(fractional).toEqual(jasmine.objectContaining({
            kind: 'unsupported', warnings: ['Saved fractional phase damage could not be converted.'],
        }));
        expect(threshold).toEqual(jasmine.objectContaining({
            kind: 'unsupported', warnings: ['Saved phase damage required piloting history that was not recorded and could not be converted.'],
        }));
    });

    it('retains every old PSR check and outcome because trigger/dice evidence is absent', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            psrChecks: { shutdown: true },
            psrOutcomes: { old: 'failed' },
        }));

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported',
            warnings: [
                'Saved piloting checks lack their trigger history and could not be converted.',
                'Saved piloting outcomes lack their dice rolls and could not be converted.',
            ],
        }));
    });

    it('skips malformed turn fields with warnings and keeps readable facts', () => {
        const parsed = parseLegacyMekTurnStateV1({
            moveMode: 'teleport', moveDistance: 'far', dmgReceived: 'many',
            psrChecks: 'lost', psrOutcomes: 'lost', weaponsHeat: 7,
            unrelatedFamilyFact: { future: true },
        });
        const result = restoreLegacyMekMovementPsrV1(parsed);

        expect(parsed.warnings.length).toBe(6);
        expect(parsed.state.weaponsHeat).toBe(7);
        expect(Object.keys(parsed).sort()).toEqual(['state', 'warnings']);
        expect(result.kind).toBe('supported');
    });

    it('skips malformed negative damage with a warning', () => {
        const parsed = parseLegacyMekTurnStateV1({ dmgReceived: -0.5 });
        const result = restoreLegacyMekMovementPsrV1(parsed);

        expect(parsed.warnings.length).toBe(1);
        expect(parsed.state.dmgReceived).toBe(0);
        expect(result.kind).toBe('supported');
    });

    it('warns about unknown turn fields without dropping valid movement', () => {
        const parsed = parseLegacyMekTurnStateV1({
            moveMode: 'walk', moveDistance: 2, futureFamilyFact: { exact: true },
        });
        const result = restoreLegacyMekMovementPsrV1(parsed);

        expect(parsed.warnings.length).toBe(1);
        expect(result.kind).toBe('supported');
    });

    it('fails closed on a forged noncanonical typed turn input', () => {
        const result = restoreLegacyMekMovementPsrV1({
            state: { ...createPristineLegacyMekTurnStateV1(), moveMode: 'fly' } as never,
        });

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported', warnings: ['Saved movement had an inconsistent mode and distance and could not be converted.'],
        }));
    });

    it('returns sorted unique frozen warnings', () => {
        const turn = canonicalizeLegacyMekTurnStateV1({
            ...createPristineLegacyMekTurnStateV1(),
            moveMode: 'jump',
            moveDistance: 2_000,
            dmgReceived: 20,
        });
        const result = restoreLegacyMekMovementPsrV1({
            state: turn,
        });

        expect(result.kind).toBe('unsupported');
        if (result.kind !== 'unsupported') return;
        expect(result.warnings).toEqual([...new Set(result.warnings)].sort());
        expect(Object.isFrozen(result)).toBeTrue();
        expect(Object.isFrozen(result.warnings)).toBeTrue();
    });
});
