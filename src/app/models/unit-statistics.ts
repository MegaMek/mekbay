// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitSummary } from './unit-summary.model';

/** Measurements of a prepared catalog summary. Null means the capability is unavailable. */
export const UNIT_STAT_READERS = {
    mobility: unit => Math.max(unit.run2, unit.jump),
    endurance: unit => unit.armor + unit.internal,
    armor: unit => unit.armor,
    internal: unit => unit.internal,
    heat: unit => unit.heat,
    dissipation: unit => unit.dissipation,
    dissipationEfficiency: unit => unit.heat === null || unit.dissipation === null
        ? null : unit.dissipation - unit.heat,
    runMP: unit => unit.run,
    run2MP: unit => unit.run2,
    jumpMP: unit => unit.jump,
    umuMP: unit => unit.umu,
    alphaNoPhysical: unit => unit._mdSumNoPhysical ?? null,
    alphaNoPhysicalNoOneshots: unit => unit._mdSumNoPhysicalNoOneshots ?? null,
    // Aerospace component ranges are named bands, not comparable hex measurements.
    maxRange: unit => unit.type === 'Aero' ? null : unit._maxRange ?? null,
    weightedMaxRange: unit => unit.type === 'Aero' ? null : unit._weightedMaxRange ?? null,
    dpt: unit => unit.dpt,
    asEndurance: unit => alphaStrikeMeasurement(unit, unit.as.Arm + unit.as.Str),
    asTmm: unit => alphaStrikeMeasurement(unit, unit.as.TMM),
    asArm: unit => alphaStrikeMeasurement(unit, unit.as.Arm),
    asStr: unit => alphaStrikeMeasurement(unit, unit.as.Str),
    asDmgS: unit => alphaStrikeMeasurement(unit, unit.as.dmg._dmgS),
    asDmgM: unit => alphaStrikeMeasurement(unit, unit.as.dmg._dmgM),
    asDmgL: unit => alphaStrikeMeasurement(unit, unit.as.dmg._dmgL),
    dropshipCapacity: unit => unit.capital?.dropshipCapacity ?? null,
    escapePods: unit => unit.capital?.escapePods ?? null,
    lifeBoats: unit => unit.capital?.lifeBoats ?? null,
    gravDecks: unit => unit.capital?.gravDecks.length ?? null,
    sailIntegrity: unit => unit.capital?.sailIntegrity ?? null,
    kfIntegrity: unit => unit.capital?.kfIntegrity ?? null,
} satisfies Record<string, (unit: UnitSummary) => number | null>;

function alphaStrikeMeasurement(unit: UnitSummary, value: number | null | undefined): number | null {
    return unit.as.TP === 'XX' ? null : value ?? null;
}

export type UnitStatKey = keyof typeof UNIT_STAT_READERS;
export const UNIT_STAT_KEYS: readonly UnitStatKey[] = Object.freeze(Object.keys(UNIT_STAT_READERS) as UnitStatKey[]);

export interface BucketStatSummary {
    readonly min: number;
    readonly max: number;
    readonly average: number;
    /** Nearest-rank 95th percentile of available measurements. */
    readonly p95: number;
    readonly count: number;
}

export type UnitBucketStats = Readonly<Record<UnitStatKey, BucketStatSummary>>;

const EMPTY_STAT: BucketStatSummary = Object.freeze({ min: 0, max: 0, average: 0, p95: 0, count: 0 });
export const EMPTY_UNIT_BUCKET_STATS: UnitBucketStats = Object.freeze(Object.fromEntries(
    UNIT_STAT_KEYS.map(key => [key, EMPTY_STAT]),
) as Record<UnitStatKey, BucketStatSummary>);

export function getUnitStatBucketKey(unit: UnitSummary): string {
    const category = unit.as.TP === 'XX' ? `cbt:${unit.entityType}` : `as:${unit.as.TP}`;
    return `${category}:${unit.weightClass === 'Colossal/Super-Heavy' ? 'superheavy' : 'standard'}`;
}
