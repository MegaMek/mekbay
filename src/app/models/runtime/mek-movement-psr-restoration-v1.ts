// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import {
    canonicalizeLegacyMekTurnStateV1,
    type LegacyMekTurnStateParseResultV1,
    type LegacyMekTurnStateV1,
} from './legacy-mek-turn-state-v1';
import { canonicalizeMekTurnStateV2, type MekTurnStateV2 } from './mek-turn-state-v2';
import {
    canonicalizeMekMovementPsrStateV2,
    MAX_MEK_MOVEMENT_MP_V2,
    MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
    type MekMovementModeV2,
    type MekMovementPsrStateV2,
} from './mek-movement-psr-v2';

export type LegacyMekMovementPsrRestorationResultV1 =
    | {
        readonly kind: 'supported';
        readonly state: MekMovementPsrStateV2;
    }
    | {
        readonly kind: 'unsupported';
        readonly warnings: readonly string[];
    };

/**
 * Classifies one old turn without synthesizing historical checks. A supported
 * result contains declarations and the safe phase total only; it never calls
 * the live transition kernel, which could create evidence that was not saved.
 */
export function restoreLegacyMekMovementPsrV1(
    input: Pick<LegacyMekTurnStateParseResultV1, 'state'>,
): LegacyMekMovementPsrRestorationResultV1 {
    let turn: LegacyMekTurnStateV1;
    try {
        turn = canonicalizeLegacyMekTurnStateV1(input.state);
    } catch {
        return blocked(['Saved movement had an inconsistent mode and distance and could not be converted.']);
    }

    const blockers = new Set<string>();
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
        phaseStateChanged: turn.equipmentStateChanged,
    });
}

function classifyMovement(
    turn: LegacyMekTurnStateV1,
    blockers: Set<string>,
): void {
    const mode = turn.moveMode;
    const distance = turn.moveDistance;
    if (distance !== null
        && (!Number.isSafeInteger(distance) || distance < 0 || distance > MAX_MEK_MOVEMENT_MP_V2)) {
        blockers.add('Saved movement distance is outside the supported range and could not be converted.');
    }
    if ((mode === null) !== (distance === null)
        || (mode === 'stationary' && distance !== 0)) {
        blockers.add('Saved movement had an inconsistent mode and distance and could not be converted.');
    }
    if (mode === 'VTOL') blockers.add('Saved VTOL movement is unsupported for this Mek and could not be converted.');
    if ((mode === 'run' || mode === 'jump') && turn.applyMovePSR) {
        blockers.add('Saved movement required piloting history that was not recorded and could not be converted.');
    }
}

function classifyDamage(
    turn: LegacyMekTurnStateV1,
    blockers: Set<string>,
): void {
    if (!Number.isSafeInteger(turn.dmgReceived)) {
        blockers.add('Saved fractional phase damage could not be converted.');
    } else if (turn.dmgReceived >= 20) {
        blockers.add('Saved phase damage required piloting history that was not recorded and could not be converted.');
    }
}

function classifyChecks(
    turn: LegacyMekTurnStateV1,
    blockers: Set<string>,
): void {
    const checks = turn.psrChecks;
    if (checks.legActuators.size > 0
        || checks.hipsHit.size > 0
        || checks.gyroHit > 0
        || checks.gyroDestroyed
        || checks.legsDestroyed.size > 0
        || checks.shutdown) {
        blockers.add('Saved piloting checks lack their trigger history and could not be converted.');
    }
    if (turn.psrOutcomes.size > 0) {
        blockers.add('Saved piloting outcomes lack their dice rolls and could not be converted.');
    }
}

function blocked(
    values: readonly string[],
): LegacyMekMovementPsrRestorationResultV1 {
    const blockers = Object.freeze([...new Set(values)].sort(compareText));
    return Object.freeze({
        kind: 'unsupported',
        warnings: blockers,
    });
}
