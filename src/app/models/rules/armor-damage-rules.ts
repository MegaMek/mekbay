// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ArmorType } from '../entity/types';
import type { WeaponType } from '../weapon-types.model';

/** What dealt the damage: a fall, a physical attack, or a weapon attack with its damage types. */
export type DamageSource =
    | Readonly<{ kind: 'fall' }>
    | Readonly<{ kind: 'physical' }>
    | Readonly<{ kind: 'weapon'; types: readonly WeaponType[] }>;

export const FALL_DAMAGE: DamageSource = Object.freeze({ kind: 'fall' });
export const PHYSICAL_DAMAGE: DamageSource = Object.freeze({ kind: 'physical' });

/** Armors whose pips absorb two points from these weapon types (Core p.202; TacOps, IntOps). */
const WEAPON_HALVING_ARMOR: Partial<Record<ArmorType, readonly WeaponType[]>> = {
    REFLECTIVE: ['DE', 'P'],
    REACTIVE: ['M', 'AE'],
    BALLISTIC_REINFORCED: ['DB', 'M'],
};

export interface ArmorDamageResolution {
    /** Armor marks removed (one mark per damage point; Hardened pips hold two). */
    readonly armorDamage: number;
    /** Damage that passes on to the structure. */
    readonly remainingDamage: number;
}

/** Armor marks one damage group removes from a location's armor, and what reaches the structure, for any unit. */
export function resolveArmorDamage(
    ruleset: CBTRuleset,
    damage: number,
    remainingArmor: number,
    armorType: ArmorType | null,
    source: DamageSource,
): ArmorDamageResolution {
    const incoming = Math.max(0, Math.trunc(damage) || 0);
    const armor = Math.max(0, Math.trunc(remainingArmor) || 0);
    if (incoming === 0 || armor === 0) return Object.freeze({ armorDamage: 0, remainingDamage: incoming });
    const fall = source.kind === 'fall';
    const physical = source.kind === 'physical';
    const weaponTypes = source.kind === 'weapon' ? source.types : [];
    if (WEAPON_HALVING_ARMOR[armorType ?? 'STANDARD']?.some(type => weaponTypes.includes(type))) {
        // Total Warfare halves the damage (rounding down, minimum 1); Core lets a leftover point destroy a pip.
        const pips = ruleset === 'core-2026' ? Math.ceil(incoming / 2) : Math.max(1, Math.floor(incoming / 2));
        const armorDamage = Math.min(armor, pips);
        return Object.freeze({ armorDamage, remainingDamage: armorDamage < pips ? incoming - 2 * armorDamage : 0 });
    }
    // Laser-reflective armor is brittle: falls, physical attacks and area-effect weapons deal double damage.
    if (armorType === 'REFLECTIVE' && (fall || physical || weaponTypes.includes('AE'))) {
        const modifiedDamage = incoming + Math.min(incoming, Math.floor(armor / 2));
        return armor >= modifiedDamage
            ? Object.freeze({ armorDamage: modifiedDamage, remainingDamage: 0 })
            : Object.freeze({ armorDamage: armor, remainingDamage: Math.max(0, incoming - Math.ceil(armor / 2)) });
    }
    // Impact-resistant armor: Core halves falls and takes 1 off every 3 (or fraction) of a physical attack;
    // Total Warfare takes 1 off every full 3 of either. Both deal at least 1.
    const modifiedDamage = armorType === 'FERRO_LAMELLOR'
        ? Math.floor(incoming * 4 / 5)
        : armorType === 'IMPACT_RESISTANT' && (fall || physical)
            ? Math.max(1, ruleset !== 'core-2026'
                ? incoming - Math.floor(incoming / 3)
                : fall ? Math.floor(incoming / 2) : incoming - Math.ceil(incoming / 3))
            : incoming;
    const armorDamage = Math.min(armor, modifiedDamage);
    return Object.freeze({ armorDamage, remainingDamage: modifiedDamage - armorDamage });
}
