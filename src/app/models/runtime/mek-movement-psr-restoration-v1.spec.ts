// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    serializeMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1,
    canonicalizeLegacyMekTurnStateV1,
    createPristineLegacyMekTurnStateV1,
    parseLegacyMekTurnStateV1,
    projectLegacyMekTurnStateV1,
    restoreLegacyMekMovementPsrV1,
} from './mek-movement-psr-restoration-v1';

describe('legacy Mek movement/PSR restoration V1', () => {
    it('materializes a pristine typed state from an absent legacy turn', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1(undefined));

        expect(result.kind).toBe('supported');
        expect(result.algorithmVersion).toBe(MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1);
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

    it('retains malformed legacy standing fields instead of inventing attempts', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            carefulStand: true,
        }));

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported',
            blockers: ['LEGACY_STANDING_STATE_UNREPRESENTABLE'],
        }));
    });

    it('carries production V1 cover into the one current turn-state model', () => {
        const legacy = parseLegacyMekTurnStateV1({ cover: 8, turnCounter: 4 });

        expect(legacy.unresolved).toBeUndefined();
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
            blockers: ['LEGACY_MOVEMENT_PSR_WITNESS_UNAVAILABLE'],
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
                    blockers: jasmine.arrayContaining(['LEGACY_INCOHERENT_MOVEMENT']),
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
            blockers: [
                'LEGACY_MOVEMENT_DISTANCE_UNREPRESENTABLE',
                'LEGACY_VTOL_MOVEMENT_UNSUPPORTED',
            ],
        }));
    });

    it('retains fractional and threshold damage as distinct blockers', () => {
        const fractional = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            dmgReceived: 0.5,
        }));
        const threshold = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            dmgReceived: 20,
        }));

        expect(fractional).toEqual(jasmine.objectContaining({
            kind: 'unsupported', blockers: ['LEGACY_FRACTIONAL_PHASE_DAMAGE'],
        }));
        expect(threshold).toEqual(jasmine.objectContaining({
            kind: 'unsupported', blockers: ['LEGACY_DAMAGE_PSR_WITNESS_UNAVAILABLE'],
        }));
    });

    it('retains every old PSR check and outcome because trigger/dice evidence is absent', () => {
        const result = restoreLegacyMekMovementPsrV1(parseLegacyMekTurnStateV1({
            psrChecks: { shutdown: true },
            psrOutcomes: { old: 'failed' },
        }));

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported',
            blockers: [
                'LEGACY_PSR_CHECK_WITNESS_UNAVAILABLE',
                'LEGACY_PSR_OUTCOME_DICE_UNAVAILABLE',
            ],
        }));
    });

    it('maps only the six movement-owned malformed legacy fields', () => {
        const result = restoreLegacyMekMovementPsrV1({
            state: createPristineLegacyMekTurnStateV1(),
            unresolved: {
                moveMode: 'teleport',
                moveDistance: 'far',
                dmgReceived: 'many',
                psrChecks: 'lost',
                psrOutcomes: 'lost',
                unrelatedFamilyFact: { future: true },
            },
        });

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported',
            blockers: [
                'LEGACY_DAMAGE_PSR_WITNESS_UNAVAILABLE',
                'LEGACY_INCOHERENT_MOVEMENT',
                'LEGACY_MOVEMENT_DISTANCE_UNREPRESENTABLE',
                'LEGACY_PSR_CHECK_WITNESS_UNAVAILABLE',
                'LEGACY_PSR_OUTCOME_DICE_UNAVAILABLE',
            ],
        }));
    });

    it('classifies a malformed finite fractional damage value as fractional', () => {
        const result = restoreLegacyMekMovementPsrV1({
            state: createPristineLegacyMekTurnStateV1(),
            unresolved: { dmgReceived: -0.5 },
        });

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported', blockers: ['LEGACY_FRACTIONAL_PHASE_DAMAGE'],
        }));
    });

    it('ignores nonmovement unresolved family evidence', () => {
        const result = restoreLegacyMekMovementPsrV1({
            state: createPristineLegacyMekTurnStateV1(),
            unresolved: { futureFamilyFact: { exact: true } },
        });

        expect(result.kind).toBe('supported');
    });

    it('fails closed on a forged noncanonical typed turn input', () => {
        const result = restoreLegacyMekMovementPsrV1({
            state: { ...createPristineLegacyMekTurnStateV1(), moveMode: 'fly' } as never,
        });

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'unsupported', blockers: ['LEGACY_INCOHERENT_MOVEMENT'],
        }));
    });

    it('returns sorted unique frozen blockers', () => {
        const turn = canonicalizeLegacyMekTurnStateV1({
            ...createPristineLegacyMekTurnStateV1(),
            moveMode: 'jump',
            moveDistance: 2_000,
            dmgReceived: 20,
        });
        const result = restoreLegacyMekMovementPsrV1({
            state: turn,
            unresolved: { moveDistance: 'bad', dmgReceived: 'bad' },
        });

        expect(result.kind).toBe('unsupported');
        if (result.kind !== 'unsupported') return;
        expect(result.blockers).toEqual([...new Set(result.blockers)].sort());
        expect(Object.isFrozen(result)).toBeTrue();
        expect(Object.isFrozen(result.blockers)).toBeTrue();
    });
});
