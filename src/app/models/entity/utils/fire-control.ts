// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../base-entity';
import type { EquipmentFlag } from '../../equipment-flags.type';
import type { Equipment } from '../../equipment.model';

const BASIC_FIRE_CONTROL_FLAG = 'F_BASIC_FIRE_CONTROL' as const;
const ADVANCED_FIRE_CONTROL_FLAG = 'F_ADVANCED_FIRE_CONTROL' as const;

export type FireControlKind = 'basic' | 'advanced';

export function fireControlKind(equipment: Equipment | null | undefined): FireControlKind | null {
    if (equipment?.hasFlag(ADVANCED_FIRE_CONTROL_FLAG) === true) return 'advanced';
    if (equipment?.hasFlag(BASIC_FIRE_CONTROL_FLAG) === true) return 'basic';
    return null;
}

export function isFireControlEquipment(equipment: Equipment | null | undefined): boolean {
    return fireControlKind(equipment) !== null;
}

export function isAdvancedFireControlEquipment(equipment: Equipment | null | undefined): boolean {
    return fireControlKind(equipment) === 'advanced';
}

export function fireControlVariableTonnage(
    equipment: Equipment | null | undefined,
    context: Readonly<{
        baseChassisWeight: number;
        weaponWeight: () => number | undefined;
        standardRound: (value: number) => number;
    }>,
): number | null | undefined {
    const kind = fireControlKind(equipment);
    if (kind === null) return null;
    if (context.baseChassisWeight > 0) return context.baseChassisWeight;
    const weaponWeight = context.weaponWeight();
    return weaponWeight === undefined
        ? undefined
        : context.standardRound(weaponWeight / (kind === 'basic' ? 20 : 10));
}

export function fireControlVariableCost(
    equipment: Equipment | null | undefined,
    weaponCost: () => number | undefined,
): number | null | undefined {
    const kind = fireControlKind(equipment);
    if (kind === null) return null;
    const cost = weaponCost();
    return cost === undefined ? undefined : cost * (kind === 'basic' ? 0.05 : 0.1);
}

export function fireControlBattleValueModifier(
    equipment: Iterable<Equipment | null | undefined>,
): number {
    const kinds = [...equipment].map(fireControlKind);
    if (kinds.includes('basic')) return 0.9;
    return kinds.includes('advanced') ? 1 : 0.8;
}

export function fireControlAlphaStrikeAbility(
    equipment: Equipment | null | undefined,
): 'AFC' | 'BFC' | null {
    const kind = fireControlKind(equipment);
    return kind === 'advanced' ? 'AFC' : kind === 'basic' ? 'BFC' : null;
}

export function fireControlFeatureFromFlagLookup(
    hasEquipmentFlag: (flag: EquipmentFlag) => boolean,
): 'Advanced Fire Control' | 'Basic Fire Control' | undefined {
    if (hasEquipmentFlag(ADVANCED_FIRE_CONTROL_FLAG)) return 'Advanced Fire Control';
    if (hasEquipmentFlag(BASIC_FIRE_CONTROL_FLAG)) return 'Basic Fire Control';
    return undefined;
}

export function getFireControlWeaponWeight(entity: BaseEntity): number | undefined {
    let weight = 0;

    for (const mount of entity.equipment()) {
        const equipment = mount.equipment;
        if (equipment?.type !== 'weapon') continue;
        if (equipment.hasWeaponTrait('anti-missile')) continue;
        if (equipment.hasWeaponTrait('infantry-weapon')
            && !equipment.hasWeaponTrait('infantry-support')) continue;

        const tonnage = mount.getTonnage(entity);
        if (tonnage === undefined) return undefined;
        weight += tonnage;
    }

    return weight;
}

export function getFireControlWeaponCost(entity: BaseEntity): number | undefined {
    let cost = 0;

    for (const mount of entity.equipment()) {
        if (mount.equipment?.type !== 'weapon') continue;

        const weaponCost = mount.getCost(entity);
        if (weaponCost === undefined) return undefined;
        cost += weaponCost;
    }

    return cost;
}
