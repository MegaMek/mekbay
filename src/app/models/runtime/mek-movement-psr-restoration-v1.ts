// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { isObjectLiteralRecord } from '../../utils/json-value.util';
import {
    canonicalizeLegacyMekTurnStateV1,
    type LegacyMekTurnStateParseResultV1,
    type LegacyMekTurnStateV1,
} from './legacy-mek-turn-state-v1';
import { canonicalizeMekTurnStateV2, type MekTurnStateV2 } from './mek-turn-state-v2';
export {
    canonicalizeLegacyMekTurnStateV1,
    createPristineLegacyMekTurnStateV1,
    deserializeLegacyMekTurnStateV1,
    parseLegacyMekTurnStateV1,
    serializeLegacyMekTurnStateV1,
    type LegacyMekTurnStateParseResultV1,
    type LegacyMekTurnStateV1,
    type SerializedLegacyMekTurnStateV1,
} from './legacy-mek-turn-state-v1';
import {
    canonicalizeMekMovementPsrStateV2,
    MAX_MEK_MOVEMENT_MP_V2,
    MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
    type MekMovementModeV2,
    type MekMovementPsrStateV2,
} from './mek-movement-psr-v2';

export const MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1 = 1 as const;

/**
 * Exact reasons why an old mutable turn cannot author typed movement/PSR state.
 * These are durable machine codes; display text belongs to the caller.
 */
export type LegacyMekMovementPsrBlockerV1 =
    | 'LEGACY_INCOHERENT_MOVEMENT'
    | 'LEGACY_MOVEMENT_DISTANCE_UNREPRESENTABLE'
    | 'LEGACY_VTOL_MOVEMENT_UNSUPPORTED'
    | 'LEGACY_STANDING_STATE_UNREPRESENTABLE'
    | 'LEGACY_FRACTIONAL_PHASE_DAMAGE'
    | 'LEGACY_DAMAGE_PSR_WITNESS_UNAVAILABLE'
    | 'LEGACY_PSR_CHECK_WITNESS_UNAVAILABLE'
    | 'LEGACY_PSR_OUTCOME_DICE_UNAVAILABLE'
    | 'LEGACY_MOVEMENT_PSR_WITNESS_UNAVAILABLE';

export interface LegacyMekMovementPsrRestorationInputV1 {
    /** Canonical field-by-field result from the legacy turn parser. */
    readonly state: LegacyMekTurnStateV1;
    /** Exact malformed fragments returned by that parser. */
    readonly unresolved?: unknown;
}

export type LegacyMekMovementPsrRestorationResultV1 =
    | {
        readonly kind: 'supported';
        readonly algorithmVersion: typeof MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1;
        readonly state: MekMovementPsrStateV2;
    }
    | {
        readonly kind: 'unsupported';
        readonly algorithmVersion: typeof MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1;
        readonly blockers: readonly LegacyMekMovementPsrBlockerV1[];
    };

/**
 * Classifies one old turn without synthesizing historical checks. A supported
 * result contains declarations and the safe phase total only; it never calls
 * the live transition kernel, which could create evidence that was not saved.
 */
export function restoreLegacyMekMovementPsrV1(
    input: LegacyMekMovementPsrRestorationInputV1
        | Pick<LegacyMekTurnStateParseResultV1, 'state' | 'unresolved'>,
): LegacyMekMovementPsrRestorationResultV1 {
    let turn: LegacyMekTurnStateV1;
    try {
        turn = canonicalizeLegacyMekTurnStateV1(input.state);
    } catch {
        return blocked(['LEGACY_INCOHERENT_MOVEMENT']);
    }

    const blockers = new Set<LegacyMekMovementPsrBlockerV1>();
    classifyUnresolved(input.unresolved, turn, blockers);
    classifyMovement(turn, blockers);
    classifyDamage(turn, blockers);
    classifyChecks(turn, blockers);

    if (blockers.size > 0) return blocked([...blockers]);

    const movement = turn.moveMode === null
        ? null
        : Object.freeze({
            schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
            mode: turn.moveMode as MekMovementModeV2,
            distance: turn.moveDistance as number,
            boosterComponentIds: Object.freeze([]),
        });
    return Object.freeze({
        kind: 'supported',
        algorithmVersion: MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1,
        state: canonicalizeMekMovementPsrStateV2({
            movement,
            action: null,
            standAttempts: turn.standAttempts,
            carefulStand: turn.carefulStand,
            damageThisPhase: turn.dmgReceived,
            checks: Object.freeze([]),
            automaticFalls: Object.freeze([]),
        }),
    });
}

/**
 * Current unit schema keeps heat/equipment turn facts only. Movement,
 * phase-damage, PSR checks/outcomes, and the historical apply flag are owned
 * exclusively by `movementPsr`.
 */
export function projectLegacyMekTurnStateV1(
    value: LegacyMekTurnStateV1,
): MekTurnStateV2 {
    const turn = canonicalizeLegacyMekTurnStateV1(value);
    return canonicalizeMekTurnStateV2({
        turnCounter: turn.turnCounter,
        airborne: turn.airborne,
        cover: turn.cover,
        weaponsHeat: turn.weaponsHeat,
        acknowledgedHeatSources: turn.acknowledgedHeatSources,
        heatDissipationConsumed: turn.heatDissipationConsumed,
        spotting: turn.spotting,
        equipmentStateChanged: turn.equipmentStateChanged,
    });
}

function classifyMovement(
    turn: LegacyMekTurnStateV1,
    blockers: Set<LegacyMekMovementPsrBlockerV1>,
): void {
    const mode = turn.moveMode;
    const distance = turn.moveDistance;
    if (distance !== null
        && (!Number.isSafeInteger(distance) || distance < 0 || distance > MAX_MEK_MOVEMENT_MP_V2)) {
        blockers.add('LEGACY_MOVEMENT_DISTANCE_UNREPRESENTABLE');
    }
    if ((mode === null) !== (distance === null)
        || (mode === 'stationary' && distance !== 0)) {
        blockers.add('LEGACY_INCOHERENT_MOVEMENT');
    }
    if (mode === 'VTOL') blockers.add('LEGACY_VTOL_MOVEMENT_UNSUPPORTED');
    if ((mode === 'run' || mode === 'jump') && turn.applyMovePSR) {
        blockers.add('LEGACY_MOVEMENT_PSR_WITNESS_UNAVAILABLE');
    }
}

function classifyDamage(
    turn: LegacyMekTurnStateV1,
    blockers: Set<LegacyMekMovementPsrBlockerV1>,
): void {
    if (!Number.isSafeInteger(turn.dmgReceived)) {
        blockers.add('LEGACY_FRACTIONAL_PHASE_DAMAGE');
    } else if (turn.dmgReceived >= 20) {
        blockers.add('LEGACY_DAMAGE_PSR_WITNESS_UNAVAILABLE');
    }
}

function classifyChecks(
    turn: LegacyMekTurnStateV1,
    blockers: Set<LegacyMekMovementPsrBlockerV1>,
): void {
    const checks = turn.psrChecks;
    if (checks.legActuators.size > 0
        || checks.hipsHit.size > 0
        || checks.gyroHit > 0
        || checks.gyroDestroyed
        || checks.legsDestroyed.size > 0
        || checks.shutdown) {
        blockers.add('LEGACY_PSR_CHECK_WITNESS_UNAVAILABLE');
    }
    if (turn.psrOutcomes.size > 0) {
        blockers.add('LEGACY_PSR_OUTCOME_DICE_UNAVAILABLE');
    }
}

function classifyUnresolved(
    value: unknown,
    turn: LegacyMekTurnStateV1,
    blockers: Set<LegacyMekMovementPsrBlockerV1>,
): void {
    if (!isObjectLiteralRecord(value)) return;
    if (Object.hasOwn(value, 'moveMode')) blockers.add('LEGACY_INCOHERENT_MOVEMENT');
    if (Object.hasOwn(value, 'moveDistance')) {
        blockers.add('LEGACY_MOVEMENT_DISTANCE_UNREPRESENTABLE');
    }
    if (Object.hasOwn(value, 'standAttempts') || Object.hasOwn(value, 'carefulStand')) {
        blockers.add('LEGACY_STANDING_STATE_UNREPRESENTABLE');
    }
    if (Object.hasOwn(value, 'dmgReceived')) {
        const rawDamage = value['dmgReceived'];
        if (typeof rawDamage === 'number' && Number.isFinite(rawDamage) && !Number.isInteger(rawDamage)) {
            blockers.add('LEGACY_FRACTIONAL_PHASE_DAMAGE');
        } else {
            blockers.add('LEGACY_DAMAGE_PSR_WITNESS_UNAVAILABLE');
        }
    }
    if (Object.hasOwn(value, 'psrChecks')) {
        blockers.add('LEGACY_PSR_CHECK_WITNESS_UNAVAILABLE');
    }
    if (Object.hasOwn(value, 'psrOutcomes')) {
        blockers.add('LEGACY_PSR_OUTCOME_DICE_UNAVAILABLE');
    }
    if (Object.hasOwn(value, 'applyMovePSR')
        && (turn.moveMode === 'run' || turn.moveMode === 'jump')) {
        blockers.add('LEGACY_MOVEMENT_PSR_WITNESS_UNAVAILABLE');
    }
}

function blocked(
    values: readonly LegacyMekMovementPsrBlockerV1[],
): LegacyMekMovementPsrRestorationResultV1 {
    const blockers = Object.freeze([...new Set(values)].sort(compareText));
    return Object.freeze({
        kind: 'unsupported',
        algorithmVersion: MEK_MOVEMENT_PSR_RESTORATION_ALGORITHM_VERSION_V1,
        blockers,
    });
}
