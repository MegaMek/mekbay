// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuntimeArmorFace, CBTRuntimeLocation, CBTUnitRuntimeIndex } from '../runtime/cbt-unit-runtime';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import { supportVehicleBarRating } from '../entity/entities/support-vehicle';
import { getTopologyFor, type ArmorType } from '../entity/types';
import type { LocationId } from '../entity/entity-identifiers';
import {
    isAeroEntity,
    isBattleArmorEntity,
    isInfantryEntity,
    isMekEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { WeaponType } from '../weapon-types.model';

/** Ammunition that special armor treats apart: an autocannon's armor-piercing rounds, or acid (AX) missiles. */
export type ArmorSpecialAmmo = 'armor-piercing' | 'acid';

/** What dealt the damage: a fall, a physical attack, or a weapon attack with its damage types. */
export type DamageSource =
    | Readonly<{ kind: 'fall' }>
    | Readonly<{ kind: 'physical' }>
    /**
     * `rifle`: each hit loses 3 points where it strikes (`rifleHitDamage`). `rackSize`: the autocannon firing
     * armor-piercing rounds, whose size sets its armor-piercing check (`armorPiercingCheckModifiers`).
     */
    | Readonly<{ kind: 'weapon'; types: readonly WeaponType[]; rifle?: true; ammo?: ArmorSpecialAmmo; rackSize?: number }>;

export const FALL_DAMAGE: DamageSource = Object.freeze({ kind: 'fall' });
export const PHYSICAL_DAMAGE: DamageSource = Object.freeze({ kind: 'physical' });

/** The source of an attack's hits: a physical attack, or its weapon's damage types and whether it is a rifle. */
export function attackDamageSource(
    attack: Readonly<{
        physical?: unknown; types: readonly WeaponType[]; rifle?: true; ammo?: ArmorSpecialAmmo; rackSize?: number;
    }>,
): DamageSource {
    return attack.physical
        ? PHYSICAL_DAMAGE
        : Object.freeze({
            kind: 'weapon',
            types: attack.types,
            ...(attack.rifle ? { rifle: true as const } : {}),
            ...(attack.ammo ? { ammo: attack.ammo } : {}),
            ...(attack.rackSize === undefined ? {} : { rackSize: attack.rackSize }),
        });
}

/**
 * Armors whose pips absorb two points from these weapon types (Core p.202; TacOps, IntOps). Battle armor's laser-
 * reflective armor keeps the benefit without the drawbacks (TO:AUE p. 93).
 */
const WEAPON_HALVING_ARMOR: Partial<Record<ArmorType, readonly WeaponType[]>> = {
    REFLECTIVE: ['DE', 'P'],
    BA_REFLECTIVE: ['DE', 'P'],
    REACTIVE: ['M', 'AE'],
    BALLISTIC_REINFORCED: ['DB', 'M'],
};

/**
 * Laser-reflective armor halves the heat of the flamers, lasers, PPCs and plasma weapons it reflects (BattleMech Manual
 * p. 114; TO:AUE p. 93), to a minimum of 1, while the struck location keeps armor. Core p. 202 has no heat effect.
 */
export function reflectedHeat(ruleset: CBTRuleset, armorType: ArmorType, source: DamageSource | undefined, heat: number): number {
    return heat > 0 && ruleset !== 'core-2026' && armorType === 'REFLECTIVE' && source?.kind === 'weapon'
        && WEAPON_HALVING_ARMOR.REFLECTIVE!.some(type => source.types.includes(type)) ? Math.max(1, Math.floor(heat / 2)) : heat;
}

type ArmorReadingUnit = Readonly<{ entity: BaseEntity; ruleset: CBTRuleset; index: CBTUnitRuntimeIndex }>;

/**
 * A Mek's outside heat as it strikes, through the armor of the face it strikes as that face is when the hit is applied,
 * before the hit's own damage: armor with special effects acts while the location has armor then (Core p. 201).
 * Laser-reflective armor halves some weapons' heat (`reflectedHeat`); heat-dissipating armor reduces any outside heat to
 * 0 (Core p. 202) or halves it, rounding down (IO:AE p. 81). A located hit strikes where its damage lands: past a
 * destroyed location, the next one inward (Core, Transferring Damage); a rear-arc hit on a location without rear armor
 * strikes its front armor. Heat without a hit location, such as fire, meets heat-dissipating armor while the Mek has
 * any of it (Core p. 202) or, under TW, while every location keeps that front armor, as MegaMek's
 * Mek.hasIntactHeatDissipatingArmor reads it.
 */
export function struckOutsideHeat(
    unit: ArmorReadingUnit,
    heat: number,
    location: Readonly<{ code: string; rear: boolean }> | null,
    armor: (face: CBTRuntimeArmorFace) => number,
    destroyed: (locationId: LocationId) => boolean,
    source?: DamageSource,
): number {
    if (!isMekEntity(unit.entity)) return heat;
    const dissipated = (amount: number) => unit.ruleset === 'core-2026' ? 0 : Math.floor(amount / 2);
    const sections = [...unit.index.locations.values()];
    if (!location) {
        const keeps = (section: CBTRuntimeLocation, front: boolean) =>
            unit.entity.armorAt(section.code).type === 'HEAT_DISSIPATING' && !destroyed(section.id)
            && section.armorFaceIds.some(id => {
                const face = unit.index.armorFaces.get(id)!;
                return (!front || face.face === 'front') && armor(face) > 0;
            });
        const dissipates = unit.ruleset === 'core-2026'
            ? sections.some(section => keeps(section, false))
            : sections.every(section => keeps(section, true));
        return dissipates ? dissipated(heat) : heat;
    }
    const topology = getTopologyFor(sections.map(section => section.code));
    let struck = sections.find(section => section.code === location.code);
    while (struck && destroyed(struck.id)) {
        const next = topology[struck.code as keyof typeof topology]?.transfersTo;
        struck = next ? sections.find(section => section.code === next) : undefined;
    }
    const faces = struck?.armorFaceIds.map(id => unit.index.armorFaces.get(id)!) ?? [];
    const face = faces.find(candidate => candidate.face === 'rear' && location.rear)
        ?? faces.find(candidate => candidate.face === 'front');
    if (!struck || !face || armor(face) <= 0) return heat;
    const armorType = unit.entity.armorAt(struck.code).type;
    const reflected = reflectedHeat(unit.ruleset, armorType, source, heat);
    return armorType === 'HEAT_DISSIPATING' ? dissipated(reflected) : reflected;
}

export interface ArmorDamageResolution {
    /** Armor marks removed (one mark per damage point; Hardened pips hold two). */
    readonly armorDamage: number;
    /** Damage that passes on to the structure. */
    readonly remainingDamage: number;
}

/**
 * Core p.191: against armor-piercing rounds, ABA, ballistic-reinforced and hardened armor take "standard damage dealt
 * to standard armor" and "provide no damage reduction or other special protective bonuses of any kind".
 */
export function armorPiercingIgnoresSpecialArmor(
    ruleset: CBTRuleset,
    armorType: ArmorType | null,
    source: DamageSource,
): boolean {
    return ruleset === 'core-2026' && source.kind === 'weapon' && source.ammo === 'armor-piercing'
        && (armorType === 'ANTI_PENETRATIVE_ABLATION' || armorType === 'BALLISTIC_REINFORCED'
            || armorType === 'HARDENED');
}

/** Total Warfare ablation armor on a TAC or armor-piercing check while the struck location had armor (IO:AE p.80). */
export const ABLATION_CRITICAL_MODIFIER = Object.freeze({ label: 'Ablation armor', value: -2 });

/**
 * The modifiers of the armor-piercing check an armor-piercing autocannon hit that damaged only armor makes, or null when
 * it makes none. Core p.191: AC/2 -3, AC/5 -2, AC/10 and larger -1; ablation, ballistic-reinforced and hardened armor
 * negate it. TW p.140: AC/2 -4, AC/5 -3, AC/10 -2, AC/20 -1, sizes between as MegaMek; hardened (TO:AUE p.93),
 * ferro-lamellor (TO:AUE p.92) and reactive armor (TO:AUE p.94) negate it; laser-reflective armor adds +2 (TO:AUE
 * p.93), impact-resistant +1 (IO:AE p.82) and ablation -2 (IO:AE p.80).
 */
export function armorPiercingCheckModifiers(
    ruleset: CBTRuleset,
    armorType: ArmorType | null,
    source: DamageSource,
): readonly Readonly<{ label: string; value: number }>[] | null {
    if (source.kind !== 'weapon' || source.ammo !== 'armor-piercing' || source.rackSize === undefined) return null;
    const size = source.rackSize;
    if (ruleset === 'core-2026') {
        return armorPiercingIgnoresSpecialArmor(ruleset, armorType, source)
            ? null : [Object.freeze({ label: 'Armor-piercing ammo', value: size <= 2 ? -3 : size <= 5 ? -2 : -1 })];
    }
    if (armorType === 'HARDENED' || armorType === 'FERRO_LAMELLOR' || armorType === 'REACTIVE') return null;
    const armor = armorType === 'REFLECTIVE' ? { label: 'Laser-reflective armor', value: 2 }
        : armorType === 'IMPACT_RESISTANT' ? { label: 'Impact-resistant armor', value: 1 }
            : armorType === 'ANTI_PENETRATIVE_ABLATION' ? ABLATION_CRITICAL_MODIFIER : null;
    return [
        Object.freeze({ label: 'Armor-piercing ammo', value: size <= 2 ? -4 : size <= 6 ? -3 : size <= 15 ? -2 : -1 }),
        ...(armor ? [Object.freeze(armor)] : []),
    ];
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
    const ammo = source.kind === 'weapon' ? source.ammo : undefined;
    const standardVsArmorPiercing = armorPiercingIgnoresSpecialArmor(ruleset, armorType, source);
    if (standardVsArmorPiercing && armorType === 'HARDENED') {
        // "each single point of damage removes one full armor pip": two hardened marks per point (Core p.191)
        return Object.freeze({
            armorDamage: Math.min(armor, 2 * incoming),
            remainingDamage: Math.max(0, incoming - Math.ceil(armor / 2)),
        });
    }
    // Core: acid missiles' damage "is not reduced by special armor rules" (p.192)
    const unreduced = standardVsArmorPiercing || (ruleset === 'core-2026' && ammo === 'acid');
    if (!unreduced
        && ((ruleset === 'core-2026' && armorType === 'HEAT_DISSIPATING' && weaponTypes.includes('H'))
        || WEAPON_HALVING_ARMOR[armorType ?? 'STANDARD']?.some(type => weaponTypes.includes(type)))) {
        // Total Warfare halves the damage (rounding down, minimum 1); Core lets a leftover point destroy a pip.
        const pips = ruleset === 'core-2026' ? Math.ceil(incoming / 2) : Math.max(1, Math.floor(incoming / 2));
        // Each pip absorbs up to two points, so only damage beyond twice the remaining pips reaches the structure
        // (Core pp.201-202; TO:AUE pp.93-94)
        return Object.freeze({ armorDamage: Math.min(armor, pips), remainingDamage: Math.max(0, incoming - 2 * armor) });
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
    const modifiedDamage = armorType === 'FERRO_LAMELLOR' && !unreduced
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
