// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { getMekLocationLabel } from '../entity/types';
import {
    hitLocationCellDefinition,
    tripodLegLocation,
    type MekHitArc,
    type MekHitLocationTable,
} from '../../utils/record-sheet-reference-table';

export interface MekFallOrientation {
    readonly roll: number;
    readonly facingOffset: number;
    readonly facingInstruction: string;
    readonly hitArc: MekHitArc;
    readonly hitArcLabel: string;
    readonly rulesExplanation: string;
}

export interface MekHitLocationResult {
    readonly hitLocationRoll: number;
    readonly rawTableResult: string;
    readonly tableLabel: string;
    readonly location: string | null;
    readonly locationLabel: string | null;
    readonly rear: boolean;
    readonly throughArmorCritical: boolean;
    readonly tripodLegRoll?: number;
    readonly tripodLegModifier?: number;
    readonly adjustedTripodLegRoll?: number;
}

export interface MekFallDamageBreakdown {
    readonly surfaceDamage: number;
    readonly waterDamage: number;
    readonly totalDamage: number;
}

export interface MekStructureDamageResolution {
    readonly internalDamage: number;
    readonly overflowDamage: number;
}

const TW_ORIENTATION: Readonly<Record<number, Omit<MekFallOrientation, 'roll'>>> = {
    1: orientation(0, 'Keep the current facing', 'front', 'Front', 'The Mek falls forward without changing facing.'),
    2: orientation(1, 'Turn 1 hexside to the right', 'right', 'Right side', 'The new facing is one hexside clockwise.'),
    3: orientation(2, 'Turn 2 hexsides to the right', 'right', 'Right side', 'The new facing is two hexsides clockwise.'),
    4: orientation(3, 'Reverse facing', 'rear', 'Rear', 'The new facing is opposite the old facing.'),
    5: orientation(-2, 'Turn 2 hexsides to the left', 'left', 'Left side', 'The new facing is two hexsides counter-clockwise.'),
    6: orientation(-1, 'Turn 1 hexside to the left', 'left', 'Left side', 'The new facing is one hexside counter-clockwise.'),
};

/**
 * Facing after a fall. `alwaysRear` (a missed death from above) still rolls the facing,
 * but every damage group strikes the rear.
 */
export function resolveMekFallOrientation(
    ruleset: CBTRuleset,
    roll: number,
    alwaysRear = false,
): MekFallOrientation {
    assertIntegerInRange(roll, 1, 6, 'Fall orientation roll');
    if (ruleset === 'core-2026') {
        const rear = alwaysRear || roll === 1;
        return Object.freeze({
            roll,
            facingOffset: 0,
            facingInstruction: 'Keep the current facing',
            hitArc: rear ? 'rear' : 'front',
            hitArcLabel: rear ? 'Rear' : 'Front',
            rulesExplanation: rear
                ? 'The Mek keeps its existing facing; all fall damage goes to the rear.'
                : 'The Mek keeps its existing facing; all fall damage goes to the front.',
        });
    }
    const orientation = TW_ORIENTATION[roll];
    return Object.freeze(alwaysRear
        ? {
            roll,
            ...orientation,
            hitArc: 'rear' as const,
            hitArcLabel: 'Rear',
            rulesExplanation: `${orientation.rulesExplanation} All fall damage goes to the rear.`,
        }
        : { roll, ...orientation });
}

export function mekFallDamage(tons: number, levelsFallen = 0): number {
    return mekFallWeightDamage(tons) * (normalizedInteger(levelsFallen) + 1);
}

/** Surface/bottom damage for a fall into the current water depth. */
export function resolveMekFallDamage(
    ruleset: CBTRuleset,
    tons: number,
    levelsFallen = 0,
    waterDepth = 0,
): MekFallDamageBreakdown {
    const levels = normalizedInteger(levelsFallen);
    const depth = normalizedInteger(waterDepth);
    if (depth === 0) {
        const surfaceDamage = mekFallDamage(tons, levels);
        return Object.freeze({ surfaceDamage, waterDamage: 0, totalDamage: surfaceDamage });
    }
    const weightDamage = mekFallWeightDamage(tons);
    if (ruleset === 'core-2026') {
        const waterDamage = Math.floor(weightDamage * (levels + depth + 1) / 2);
        return Object.freeze({ surfaceDamage: 0, waterDamage, totalDamage: waterDamage });
    }
    let surfaceDamage = Math.floor(mekFallDamage(tons, levels) / 2);
    let waterDamage = Math.floor(weightDamage * (depth + 1) / 2);
    if (depth >= levels) {
        surfaceDamage = 0;
        waterDamage = Math.floor(weightDamage * (levels + 1) / 2);
    }
    return Object.freeze({ surfaceDamage, waterDamage, totalDamage: surfaceDamage + waterDamage });
}

export function resolvedMekFallDamageGroups(damage: MekFallDamageBreakdown): readonly number[] {
    return Object.freeze([
        ...mekFallDamageGroups(damage.surfaceDamage),
        ...mekFallDamageGroups(damage.waterDamage),
    ]);
}

export function mekFallDamageGroups(damage: number): readonly number[] {
    let remaining = normalizedInteger(damage);
    const groups: number[] = [];
    while (remaining > 0) {
        const group = Math.min(5, remaining);
        groups.push(group);
        remaining -= group;
    }
    return Object.freeze(groups);
}

export function resolveMekHitLocation(
    table: MekHitLocationTable,
    arc: MekHitArc,
    hitLocationRoll: number,
    tripodLegRoll?: number,
): MekHitLocationResult {
    assertIntegerInRange(hitLocationRoll, 2, 12, 'Mek hit-location roll');
    if (tripodLegRoll !== undefined) assertIntegerInRange(tripodLegRoll, 1, 6, 'Tripod leg roll');
    const cell = hitLocationCellDefinition(table, hitLocationRoll, arc);
    let location = cell.location;
    let adjustedTripodLegRoll: number | undefined;
    if (cell.tripodLegModifier !== undefined && tripodLegRoll !== undefined) {
        adjustedTripodLegRoll = tripodLegRoll + cell.tripodLegModifier;
        location = tripodLegLocation(adjustedTripodLegRoll);
    }
    return Object.freeze({
        hitLocationRoll,
        rawTableResult: cell.tableText,
        tableLabel: cell.tableLabel,
        location,
        locationLabel: getMekLocationLabel(location ?? undefined),
        rear: arc === 'rear',
        throughArmorCritical: cell.throughArmorCritical,
        ...(cell.tripodLegModifier === undefined ? {} : { tripodLegModifier: cell.tripodLegModifier }),
        ...(tripodLegRoll === undefined || cell.tripodLegModifier === undefined ? {} : { tripodLegRoll }),
        ...(adjustedTripodLegRoll === undefined ? {} : { adjustedTripodLegRoll }),
    });
}

export function resolveMekStructureDamage(
    damage: number,
    remainingInternal: number,
    kind: 'standard' | 'composite' | 'reinforced',
): MekStructureDamageResolution {
    const incoming = normalizedInteger(damage);
    const capacity = normalizedInteger(remainingInternal);
    const possibleInternal = kind === 'composite' ? incoming * 2 : incoming;
    const internalDamage = Math.min(capacity, possibleInternal);
    const absorbed = Math.min(incoming, kind === 'composite'
        ? Math.ceil(internalDamage / 2)
        : internalDamage);
    return Object.freeze({ internalDamage, overflowDamage: incoming - absorbed });
}

function orientation(
    facingOffset: number,
    facingInstruction: string,
    hitArc: MekHitArc,
    hitArcLabel: string,
    rulesExplanation: string,
): Omit<MekFallOrientation, 'roll'> {
    return Object.freeze({ facingOffset, facingInstruction, hitArc, hitArcLabel, rulesExplanation });
}

function normalizedInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function mekFallWeightDamage(tons: number): number {
    return Math.round(Math.max(0, Number.isFinite(tons) ? tons : 0) / 10);
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    }
}
