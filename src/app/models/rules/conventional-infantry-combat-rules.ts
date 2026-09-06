// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { InfantryEntity } from '../entity/entities/infantry/infantry-entity';
import type { InfantryWeaponEquipment } from '../equipment.model';

/** The conventional-infantry weapon reference used by the existing CBT sheet.
 * This is not the Core Rulebook's separate Infantry Asset conversion. */
export interface ConventionalInfantryCombatProfile {
    readonly maximumStrength: number;
    readonly damagePerTrooper: number;
    readonly damageByStrength: readonly number[];
    readonly rangeModifiers: readonly (number | null)[];
    readonly underwaterRangeModifiers: readonly (number | null)[] | null;
}

const PRIMARY_DAMAGE_CAP = 0.6;

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
    // ConvInfantry.getDamagePerTrooper: primary damage is capped; secondary damage is not.
    const damagePerTrooper = primary === null || squadSize <= 0 ? 0
        : (Math.min(PRIMARY_DAMAGE_CAP, primary.infantry.damage) * (squadSize - secondaryCount)
            + (secondary?.infantry.damage ?? 0) * secondaryCount) / squadSize;
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
        rangeModifiers: infantryRangeModifiers(rangeWeapon, otherWeapon, false,
            (primary?.infantry.damage ?? 0) > PRIMARY_DAMAGE_CAP),
        underwaterRangeModifiers: underwater ? infantryRangeModifiers(rangeWeapon, otherWeapon, true,
            (primary?.infantry.damage ?? 0) > PRIMARY_DAMAGE_CAP) : null,
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
