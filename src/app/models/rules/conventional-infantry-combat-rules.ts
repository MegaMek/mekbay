// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { InfantryEntity } from '../entity/entities/infantry/infantry-entity';
import type { InfantryWeaponEquipment } from '../equipment.model';
import { isHeatOrDamageWeapon } from '../flamer-mode.model';

/** The conventional-infantry weapon reference used by the existing CBT sheet.
 * This is not the Core Rulebook's separate Infantry Asset conversion. */
export interface ConventionalInfantryCombatProfile {
    readonly maximumStrength: number;
    readonly damagePerTrooper: number;
    readonly damageByStrength: readonly number[];
    readonly rangeModifiers: readonly (number | null)[];
    readonly underwaterRangeModifiers: readonly (number | null)[] | null;
}

/** TAG is a targeting aid, not the weapon used for infantry combat ranges or notes. */
export function conventionalInfantryRangeWeapon(entity: InfantryEntity): InfantryWeaponEquipment | null {
    const secondary = entity.secondaryWeapon();
    return entity.secondaryCount() > 1 && secondary !== null && !secondary.hasFlag('F_TAG')
        ? secondary : entity.primaryWeapon();
}

// TW/TechManual infantry range categories, also used by MegaMek Compute.getInfantryRangeMods.
const RANGE_MODIFIERS: readonly (readonly number[])[] = Object.freeze([
    [0],
    [-2, 0, 2, 4],
    [-2, 0, 0, 2, 2, 4, 4],
    [-2, 0, 0, 0, 2, 2, 2, 4, 4, 4],
    [-2, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
    [-1, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4],
    [-1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 4, 4, 4, 5, 5, 5],
    [-1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 6, 6, 6, 6],
].map(values => Object.freeze(values)));

export function projectConventionalInfantryCombat(
    entity: InfantryEntity,
): ConventionalInfantryCombatProfile {
    const primary = entity.primaryWeapon();
    const secondary = entity.secondaryWeapon();
    const squadSize = entity.squadSize();
    const secondaryCount = entity.secondaryCount();
    const primaryDamage = entity.platoonWeaponDamagePerTrooper('primary');
    const damagePerTrooper = primary === null || squadSize <= 0 ? 0
        : (primaryDamage * (squadSize - secondaryCount)
            + entity.platoonWeaponDamagePerTrooper('secondary') * secondaryCount) / squadSize;
    const primaryDamageCapped = (primary?.infantry.damage ?? 0) > primaryDamage;
    const maximumStrength = entity.structureValues().get('Infantry') ?? 0;
    // PrintInfantry.writeTextFields uses rounded per-strength damage, not ceil or AS damage.
    const damageByStrength = Array.from({ length: maximumStrength + 1 }, (_, strength) =>
        Math.round(damagePerTrooper * strength));
    const rangeWeapon = conventionalInfantryRangeWeapon(entity);
    const otherWeapon = secondaryCount === 1 ? secondary : null;
    const underwater = entity.motiveType() === 'UMU' || entity.motiveType() === 'Submarine';
    return Object.freeze({
        maximumStrength,
        damagePerTrooper,
        damageByStrength: Object.freeze(damageByStrength),
        rangeModifiers: infantryRangeModifiers(rangeWeapon, otherWeapon, false, primaryDamageCapped),
        underwaterRangeModifiers: underwater
            ? infantryRangeModifiers(rangeWeapon, otherWeapon, true, primaryDamageCapped) : null,
    });
}

/**
 * A conventional platoon's attack as play resolves it: the Cluster Hits Table is rolled on the troopers able to fire,
 * and the damage those troopers deal is read from the same per-trooper damage the sheet prints (MegaMek
 * InfantryWeaponHandler).
 */
export interface PlatoonAttackFacts {
    /** Troopers firing: the Cluster Hits Table column. */
    readonly troopers: number;
    /** Damage dealt when that many troopers hit, indexed by troopers hitting. */
    readonly damageByTroopers: readonly number[];
    /** The range modifier at each hex distance; null out of range. */
    readonly rangeModifiers: readonly (number | null)[];
    /** An SRM platoon declared with Inferno munitions fires inferno missiles instead of damage (TW p. 142). */
    readonly inferno: boolean;
    /** The weapon whose heat the attack may deal in place of damage, if it carries one. */
    readonly heatOrDamageWeapon: InfantryWeaponEquipment | null;
}

/** The platoon's standard weapon attack with its current troopers. */
export function platoonAttack(entity: InfantryEntity, troopers: number): PlatoonAttackFacts {
    const profile = projectConventionalInfantryCombat(entity);
    const firing = Math.max(0, Math.min(troopers, profile.maximumStrength));
    return Object.freeze({
        troopers: firing,
        damageByTroopers: Object.freeze(profile.damageByStrength.slice(0, firing + 1)),
        rangeModifiers: profile.rangeModifiers,
        inferno: entity.firesInfernoSrms(),
        heatOrDamageWeapon: platoonHeatOrDamageWeapon(entity),
    });
}

/**
 * The platoon weapon whose heat the platoon may deal in place of damage: either weapon gives the attack that choice
 * (TW p. 214; TechManual's flame-based feature applies with one or more such weapons). A platoon firing inferno SRMs
 * fires missiles instead, as MegaMek resolves those first.
 */
export function platoonHeatOrDamageWeapon(entity: InfantryEntity): InfantryWeaponEquipment | null {
    if (entity.firesInfernoSrms()) return null;
    const secondary = entity.secondaryCount() > 0 ? entity.secondaryWeapon() : null;
    return [entity.primaryWeapon(), secondary].find(weapon => isHeatOrDamageWeapon(weapon)) ?? null;
}

/** The platoon attack's name: its primary weapon, and its secondary weapon when it has one. */
export function platoonAttackLabel(entity: InfantryEntity): string {
    const names = [entity.primaryWeapon(), entity.secondaryCount() > 0 ? entity.secondaryWeapon() : null]
        .flatMap(weapon => weapon === null ? [] : [weapon.name]);
    return names.join(' + ');
}

/**
 * The once-per-scenario disposable weapon attack, made instead of the platoon's standard attack: three times the
 * weapon's damage per trooper hitting, at the weapon's own ranges (TO:AuE p. 116; MegaMek
 * InfantryDisposableWeaponHandler).
 */
export function disposableWeaponAttack(entity: InfantryEntity, troopers: number): PlatoonAttackFacts | null {
    const weapon = entity.disposableWeapon();
    if (weapon === null) return null;
    const damagePerTrooper = entity.platoonWeaponDamagePerTrooper('disposable');
    const firing = Math.max(0, troopers);
    return Object.freeze({
        troopers: firing,
        damageByTroopers: Object.freeze(Array.from({ length: firing + 1 }, (_, hit) => Math.round(damagePerTrooper * hit))),
        rangeModifiers: infantryRangeModifiers(weapon, null, false, false),
        inferno: false,
        heatOrDamageWeapon: null,
    });
}

function infantryRangeModifiers(
    weapon: InfantryWeaponEquipment | null,
    otherWeapon: InfantryWeaponEquipment | null,
    underwater: boolean,
    primaryDamageCapped: boolean,
): readonly (number | null)[] {
    const category = weapon === null ? -1 : underwater
        ? Math.floor(weapon.infantry.range / 2) : weapon.infantry.range;
    const modifiers = RANGE_MODIFIERS[category];
    let pointBlank = 0;
    if (weapon !== null) {
        if (weapon.hasFlag('F_INF_POINT_BLANK') || otherWeapon?.hasFlag('F_INF_POINT_BLANK')) pointBlank += 1;
        if (weapon.hasFlag('F_INF_ENCUMBER') || weapon.infantry.crew > 1
            || otherWeapon?.hasFlag('F_INF_ENCUMBER') || (otherWeapon?.infantry.crew ?? 0) > 1) pointBlank += 1;
        if (weapon.hasFlag('F_INF_BURST') || primaryDamageCapped) pointBlank -= 1;
    }
    return Object.freeze(Array.from({ length: 22 }, (_, distance) => {
        const modifier = modifiers?.[distance];
        return modifier === undefined ? null : modifier + (distance === 0 ? pointBlank : 0);
    }));
}
