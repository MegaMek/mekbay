// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';

/** Detached catalog facts needed to derive one munition's effective shot mass. */
export interface AmmoCapacityFacts {
    readonly shots: number;
    readonly kgPerShot: number;
    readonly hasCustomKgPerShot: boolean;
    readonly munitionTypes: ReadonlySet<string>;
    readonly baseAmmoShots?: number;
    readonly bv?: number | 'variable';
    readonly baseAmmoBv?: number | 'variable';
}

/**
 * Ruleset capacity is derived from the base munition. Catalog shot counts for
 * special munitions are not runtime authority.
 */
export function resolveAmmoShots(
    ruleset: CBTRuleset,
    facts: AmmoCapacityFacts,
): number {
    const multiplier = ammoShotMultiplier(ruleset, facts.munitionTypes);
    return multiplier === null || facts.baseAmmoShots === undefined
        ? facts.shots
        : Math.floor(facts.baseAmmoShots * multiplier);
}

/** Ruleset BV for munitions whose value is based on the standard round. */
export function resolveAmmoBattleValue(
    ruleset: CBTRuleset,
    facts: AmmoCapacityFacts,
): number | 'variable' {
    const current = facts.bv ?? 0;
    if (!facts.munitionTypes.has('M_AX_HEAD') || facts.baseAmmoBv === undefined) return current;
    return typeof facts.baseAmmoBv === 'number'
        ? facts.baseAmmoBv * (ruleset === 'total-warfare' ? 2 : 1)
        : facts.baseAmmoBv;
}

export function resolveAmmoKgPerShot(
    ruleset: CBTRuleset,
    facts: AmmoCapacityFacts,
): number {
    const effectiveShots = resolveAmmoShots(ruleset, facts);
    if (effectiveShots <= 0) return 0;
    return facts.hasCustomKgPerShot
        ? facts.kgPerShot * facts.shots / effectiveShots
        : 1000 / effectiveShots;
}

/** Exact capacity when a fixed-mass installed bin changes munition. */
export function resolveChangedAmmoCapacity(
    ruleset: CBTRuleset,
    original: AmmoCapacityFacts,
    originalCapacity: number,
    selected: AmmoCapacityFacts,
): number {
    const selectedKgPerShot = resolveAmmoKgPerShot(ruleset, selected);
    if (selectedKgPerShot <= 0) return originalCapacity;
    return Math.floor(
        resolveAmmoKgPerShot(ruleset, original) * originalCapacity / selectedKgPerShot,
    );
}

function ammoShotMultiplier(
    ruleset: CBTRuleset,
    munitionTypes: ReadonlySet<string>,
): number | null {
    if (munitionTypes.has('M_PRECISION')) return ruleset === 'total-warfare' ? 0.5 : 0.6;
    if (munitionTypes.has('M_ARMOR_PIERCING')) return ruleset === 'total-warfare' ? 0.5 : 0.8;
    if (munitionTypes.has('M_AX_HEAD')) return ruleset === 'total-warfare' ? 0.5 : 1;
    return null;
}
