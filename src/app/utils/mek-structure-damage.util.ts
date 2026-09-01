// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export type MekStructureKind = 'standard' | 'composite' | 'reinforced';

export const MEK_STRUCTURE_TYPE = {
    REINFORCED: 4,
    COMPOSITE: 5,
} as const;

export interface MekStructureDamageResolution {
    readonly internalDamage: number;
    readonly overflowDamage: number;
}

/** Incoming damage required to destroy the remaining structure. */
export function mekStructureDamageCapacity(
    remainingInternal: number,
    kind: MekStructureKind,
): number {
    const capacity = normalizedInteger(remainingInternal);
    if (capacity === 0) return 0;
    if (kind === 'composite') return Math.ceil(capacity / 2);
    return capacity;
}

/** MegaMek-compatible integer structure absorption and transfer. */
export function resolveMekStructureDamage(
    damage: number,
    remainingInternal: number,
    kind: MekStructureKind,
): MekStructureDamageResolution {
    const incoming = normalizedInteger(damage);
    const capacity = normalizedInteger(remainingInternal);
    const possibleInternal = kind === 'composite'
        ? incoming * 2
        : incoming;
    const internalDamage = Math.min(capacity, possibleInternal);
    const absorbedDamage = Math.min(incoming, kind === 'composite'
        ? Math.ceil(internalDamage / 2)
        : internalDamage);
    return {
        internalDamage,
        overflowDamage: incoming - absorbedDamage,
    };
}

/**
 * Damage represented by the marked structure pips. Keeping this cumulative makes
 * the result independent of whether the same record edit was entered in one step
 * or several smaller steps.
 */
export function mekStructureDamageReceived(
    internalPoints: number,
    internalHits: number,
    kind: MekStructureKind,
): number {
    const points = normalizedInteger(internalPoints);
    const hits = Math.min(points, normalizedInteger(internalHits));
    if (kind === 'reinforced') return fullDoubleDamagePipsRemoved(points, hits);
    if (kind === 'composite') {
        return mekStructureDamageCapacity(points, kind)
            - mekStructureDamageCapacity(points - hits, kind);
    }
    return hits;
}

/** Full printed pips removed when each pip is represented by two ordered damage pips. */
export function fullDoubleDamagePipsRemoved(remaining: number, damage: number): number {
    return Math.ceil(remaining / 2) - Math.ceil((remaining - damage) / 2);
}

function normalizedInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
