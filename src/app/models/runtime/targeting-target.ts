// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EncounterTargetId } from './encounter-runtime';
import {
    isTnTargetImmobile,
    type TnTargetNumberCalculatorState,
    type TnTargetUnitType,
} from '../target-number-calculator.model';

/**
 * Effective target facts for one attacker. This projection combines the
 * encounter-owned target with that attacker's local distance and calculator
 * inputs; it is not independently persisted state.
 */
export interface TargetingTarget {
    readonly id: EncounterTargetId;
    readonly letter: string;
    readonly name: string;
    readonly color: string;
    readonly source?: 'manual' | 'opfor';
    readonly readOnly?: boolean;
    readonly unitType?: TnTargetUnitType;
    readonly distance: number;
    readonly c3Distance?: number;
    readonly useC3?: boolean;
    readonly tnModifier: number;
    /** Present only when this attacker owns an explicit manual TN override. */
    readonly manualTnModifier?: number;
    readonly tnCalculator?: TnTargetNumberCalculatorState;
}

/** Calculator-derived modes are inactive while the target TN is manually overridden. */
export function activeTargetCalculator(
    target: Pick<TargetingTarget, 'manualTnModifier' | 'tnCalculator' | 'unitType'>,
): TnTargetNumberCalculatorState | undefined {
    if (target.manualTnModifier !== undefined || !target.tnCalculator) return undefined;
    if (target.tnCalculator.immobile === true || !isTnTargetImmobile(target.unitType, false)) {
        return target.tnCalculator;
    }
    return { ...target.tnCalculator, immobile: true };
}

const ENCOUNTER_TARGET_CALCULATOR_KEYS = [
    'isAirborne',
    'targetMovementBracket',
    'targetMovementDistance',
    'skidding',
    'prone',
    'immobile',
    'targetHexCover',
    'waterDepth',
    'buildingCover',
    'targetHeight',
    'largeTarget',
    'narcAboveWater',
    'narcUnderwater',
    'tagged',
    'ecmShielded',
    'stealth',
    'stealthSystem',
] as const satisfies readonly (keyof TnTargetNumberCalculatorState)[];

const ENCOUNTER_TARGET_CALCULATOR_KEY_SET = new Set<keyof TnTargetNumberCalculatorState>(
    ENCOUNTER_TARGET_CALCULATOR_KEYS,
);

/** Splits an effective calculator form into encounter-owned and attacker-owned facts. */
export function splitTargetCalculatorByOwner(state: TnTargetNumberCalculatorState | undefined): {
    encounter?: TnTargetNumberCalculatorState;
    attacker?: TnTargetNumberCalculatorState;
} {
    if (!state) return {};
    const encounter: TnTargetNumberCalculatorState = {};
    const attacker: TnTargetNumberCalculatorState = {};
    for (const key of Object.keys(state) as (keyof TnTargetNumberCalculatorState)[]) {
        const value = state[key];
        Object.assign(ENCOUNTER_TARGET_CALCULATOR_KEY_SET.has(key) ? encounter : attacker, { [key]: value });
    }
    return {
        ...(Object.keys(encounter).length > 0 && { encounter }),
        ...(Object.keys(attacker).length > 0 && { attacker }),
    };
}

/** Composes encounter-owned facts with attacker-owned overrides. */
export function combineTargetCalculator(
    encounter: TnTargetNumberCalculatorState | undefined,
    attacker: TnTargetNumberCalculatorState | undefined,
): TnTargetNumberCalculatorState | undefined {
    if (!encounter && !attacker) return undefined;
    return { ...encounter, ...attacker };
}
