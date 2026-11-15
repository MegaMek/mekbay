// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import { supportVehicleBarRating } from '../entity/entities/support-vehicle';
import type { ArmorType } from '../entity/types';
import {
    isAeroEntity,
    isBattleArmorEntity,
    isInfantryEntity,
    isMekEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { WeaponType } from '../weapon-types.model';

/** What dealt the damage: a fall, a physical attack, or a weapon attack with its damage types. */
export type DamageSource =
    | Readonly<{ kind: 'fall' }>
    | Readonly<{ kind: 'physical' }>
    /** `rifle`: each hit loses 3 points where it strikes (`rifleHitDamage`). */
    | Readonly<{ kind: 'weapon'; types: readonly WeaponType[]; rifle?: true }>;

export const FALL_DAMAGE: DamageSource = Object.freeze({ kind: 'fall' });
export const PHYSICAL_DAMAGE: DamageSource = Object.freeze({ kind: 'physical' });

/** The source of an attack's hits: a physical attack, or its weapon's damage types and whether it is a rifle. */
export function attackDamageSource(
    attack: Readonly<{ physical?: unknown; types: readonly WeaponType[]; rifle?: true }>,
): DamageSource {
    return attack.physical
        ? PHYSICAL_DAMAGE
        : Object.freeze({ kind: 'weapon', types: attack.types, ...(attack.rifle ? { rifle: true as const } : {}) });
}

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
    // Impact-resistant armor takes 1 off every 3 points (or fraction) of a physical attack, and of a fall under Total
    // Warfare (IO p. 81); Core halves a fall instead (p. 202). Both deal at least 1.
    const modifiedDamage = armorType === 'FERRO_LAMELLOR'
        ? Math.floor(incoming * 4 / 5)
        : armorType === 'IMPACT_RESISTANT' && (fall || physical)
            ? Math.max(1, ruleset === 'core-2026' && fall
                ? Math.floor(incoming / 2)
                : incoming - Math.ceil(incoming / 3))
            : incoming;
    const armorDamage = Math.min(armor, modifiedDamage);
    return Object.freeze({ armorDamage, remainingDamage: modifiedDamage - armorDamage });
}

/** What a rifle hit strikes: an open unit, the location and the armor left on its struck face, or a declared type. */
export type RifleHitTarget =
    | Readonly<{ entity: BaseEntity; location: string; armor: number }>
    | Readonly<{ unitType: TnTargetUnitType | undefined }>;

/**
 * A rifle hit's damage where it strikes: 3 less, to a minimum of 0. Core takes them off against 'Mechs, vehicles and
 * aerospace units (p. 190). Total Warfare takes them off only while the struck location keeps armor, and never against
 * conventional infantry, battle armor, buildings, a 'Mech's commercial armor or a support vehicle's armor below BAR 8
 * (TO:AuE p. 150). A target of no declared type is a 'Mech, and a target not open here is taken to keep its armor.
 */
export function rifleHitDamage(ruleset: CBTRuleset, damage: number, target: RifleHitTarget): number {
    return rifleReducesHit(ruleset, target) ? Math.max(0, damage - 3) : damage;
}

function rifleReducesHit(ruleset: CBTRuleset, target: RifleHitTarget): boolean {
    if ('unitType' in target) {
        const type = target.unitType ?? 'mek-biped';
        return ruleset === 'core-2026'
            ? type.startsWith('mek-') || type === 'vehicle' || type === 'vtol-wige' || type === 'aero'
            : type !== 'infantry' && type !== 'battle-armor' && type !== 'terrain' && type !== 'building';
    }
    const { entity, location, armor } = target;
    if (ruleset === 'core-2026') return isMekEntity(entity) || isVehicleEntity(entity) || isAeroEntity(entity);
    if (armor <= 0 || isInfantryEntity(entity) || isBattleArmorEntity(entity)) return false;
    if (entity.entityType === 'BuildingEntity' || entity.entityType === 'MobileStructure') return false;
    if (isMekEntity(entity)) return entity.armorAt(location).type !== 'COMMERCIAL';
    return !entity.isSupportVehicle() || supportVehicleBarRating(entity, location) >= 8;
}
