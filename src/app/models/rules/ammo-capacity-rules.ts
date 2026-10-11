// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { EquipmentTechBase } from '../entity/types/tech';
import type { AmmoType } from '../equipment.model';

/** Detached catalog facts needed to derive munition capacity and Battle Value. */
export interface AmmoCapacityFacts {
    readonly ammoType: AmmoType;
    readonly techBase: EquipmentTechBase;
    readonly rackSize: number;
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
    if (facts.baseAmmoBv === undefined) return current;

    // Derive both rulesets from standard ammo, regardless of the catalog's exported BV.
    if (facts.munitionTypes.has('M_AX_HEAD') || facts.munitionTypes.has('M_CASELESS')) {
        const doubleBv = ruleset === 'total-warfare' && (
            facts.munitionTypes.has('M_AX_HEAD') || ['AC', 'LAC', 'PAC'].includes(facts.ammoType)
        );
        return doubleBv && typeof facts.baseAmmoBv === 'number'
            ? facts.baseAmmoBv * 2
            : facts.baseAmmoBv;
    }

    if (facts.munitionTypes.has('M_THUNDER')) {
        if (ruleset === 'core-2026'
            || !['LRM', 'LRM_IMP', 'MML', 'NLRM', 'TBOLT_10', 'TBOLT_15', 'TBOLT_20'].includes(facts.ammoType)) {
            return facts.baseAmmoBv;
        }
        // TO:AUE pp. 197-198: 4 BV per 5 points of standard mines delivered per ton.
        return facts.rackSize * resolveAmmoShots(ruleset, facts) / 5 * 4;
    }

    if (facts.ammoType === 'ARROW_IV' && facts.munitionTypes.has('M_FASCAM')) {
        if (ruleset === 'core-2026') return facts.baseAmmoBv;
        // TO:AR p. 152: Clan Arrow IV lays a 30-point field; Inner Sphere lays 20.
        const minePoints = facts.techBase === 'Clan' ? 30 : 20;
        return minePoints * resolveAmmoShots(ruleset, facts) / 5 * 4;
    }
    return current;
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
