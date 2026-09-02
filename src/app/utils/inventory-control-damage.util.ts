// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    AmmoEquipment,
    resolveWeaponAmmo,
    resolveWeaponDamage,
    WeaponDamage,
    WeaponEquipment,
} from '../models/equipment.model';
import { isGaussEquipment } from '../models/gauss-equipment.model';
import { isHagEquipment } from '../models/hag-mode.model';
import { WEAPON_TYPES, type WeaponType } from '../models/weapon-types.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { AmmoWeaponProfile } from '../models/ammo-weapon-profile.model';
import type { InventoryControlRuntimeRangeKey } from '../models/inventory-control-runtime-state.model';
import type { ComponentId } from '../models/entity/entity-identifiers';
import {
    formatWeaponDamage,
    type WeaponDamageRange,
} from './weapon-damage.util';

export interface InventoryControlDamageContext {
    readonly selectedRange: WeaponDamageRange | null;
    readonly selectedAmmo: AmmoEquipment | null;
    readonly equipmentCatalog: EquipmentRegistry;
    readonly ammoProfile?: AmmoWeaponProfile | null;
    readonly damageOverride?: WeaponEquipment['damage'];
}

export interface DefaultWeaponDamageContext {
    readonly selectedRange?: WeaponDamageRange | null;
    readonly ammoProfile?: AmmoWeaponProfile | null;
}

export interface InventoryControlDamageResolution {
    readonly damage: WeaponDamage;
    readonly damageTypes: readonly WeaponType[];
    readonly text: string;
}

/** Immutable component-local input for inventory weapon-damage projection. */
export interface InventoryControlDamageComponentFacts {
    readonly componentId: ComponentId;
    readonly physical: boolean;
    /** Catalog rule subject only; never a mounted component or mutable owner graph. */
    readonly weapon: WeaponEquipment | null;
}

export interface InventoryControlDamageRules {
    applyDamageEffects?: (
        componentId: ComponentId,
        damage: WeaponDamage,
        context: InventoryControlDamageContext
    ) => WeaponDamage;
    applyWeaponTypes?: (
        componentId: ComponentId,
        types: ReadonlySet<WeaponType>
    ) => ReadonlySet<WeaponType>;
}

export function inventoryControlDamageRange(
    range: InventoryControlRuntimeRangeKey | null
): WeaponDamageRange | null {
    return range === 'short' || range === 'medium' || range === 'long' || range === 'extreme'
        ? range
        : null;
}

export function resolveInventoryControlDamageText(
    component: InventoryControlDamageComponentFacts,
    context: InventoryControlDamageContext,
    rules: InventoryControlDamageRules = {}
): string | null {
    return resolveInventoryControlWeaponDamage(component, context, rules)?.text ?? null;
}

export function resolveDefaultWeaponDamageText(
    weapon: WeaponEquipment,
    equipmentCatalog: EquipmentRegistry,
    context: DefaultWeaponDamageContext = {}
): string {
    const ammo = resolveWeaponAmmo(weapon, equipmentCatalog, context);
    const damage = resolveWeaponDamage(weapon, equipmentCatalog, {
        ammo,
        ammoProfile: context.ammoProfile,
        range: context.selectedRange,
    });
    return formatDamageWithTypes(
        damage,
        getUnmountedWeaponTypes(weapon, ammo),
        weapon,
        ammo,
        context.ammoProfile
    );
}

export function resolveInventoryControlWeaponDamage(
    component: InventoryControlDamageComponentFacts,
    context: InventoryControlDamageContext,
    rules: InventoryControlDamageRules = {}
): InventoryControlDamageResolution | null {
    const weapon = component.weapon;
    if (component.physical || !weapon) return null;

    const ammo = resolveWeaponAmmo(weapon, context.equipmentCatalog, {
        ammo: context.selectedAmmo,
        ammoProfile: context.ammoProfile,
    });
    const baseDamage = resolveWeaponDamage(weapon, context.equipmentCatalog, {
        ammo,
        ammoProfile: context.ammoProfile,
        range: context.selectedRange,
        damageOverride: context.damageOverride,
    });
    const damageTypes = getInventoryControlDamageTypes(component, ammo, rules);
    const modifiedDamage = rules.applyDamageEffects?.(component.componentId, baseDamage, context) ?? baseDamage;
    const damage = context.selectedRange === 'extreme'
        ? applyExtremeRangeDamageRules(weapon, modifiedDamage, damageTypes)
        : modifiedDamage;
    return {
        damage,
        damageTypes,
        text: formatDamageWithTypes(
            damage,
            damageTypes,
            weapon,
            ammo,
            context.ammoProfile
        ),
    };
}

function applyExtremeRangeDamageRules(
    weapon: WeaponEquipment,
    damage: WeaponDamage,
    damageTypes: readonly WeaponType[],
): WeaponDamage {
    let divisor = 1;
    let subtraction = 0;
    let multiplier = 1;

    if (weapon.hasFlag('F_PULSE')) divisor = 2;
    if (damageTypes.includes('DE') || (isGaussEquipment(weapon) && !isHagEquipment(weapon))) {
        subtraction = 1;
    }
    if (damageTypes.includes('DB') && !isGaussEquipment(weapon)) multiplier = 0.75;

    if (divisor === 1 && subtraction === 0 && multiplier === 1) return damage;
    const adjust = (value: number): number => Math.max(0, Math.floor(((value / divisor) - subtraction) * multiplier));
    return {
        ...damage,
        values: damage.values.map(adjust),
        maximum: adjust(damage.maximum),
    };
}

export function getInventoryControlDamageTypes(
    component: InventoryControlDamageComponentFacts,
    selectedAmmo?: AmmoEquipment | null,
    rules: InventoryControlDamageRules = {}
): WeaponType[] {
    const weapon = component.weapon;
    if (component.physical || !weapon) return [];

    const baseTypes = getUnmountedWeaponTypes(weapon, selectedAmmo);
    const effectiveTypes = rules.applyWeaponTypes?.(component.componentId, baseTypes) ?? baseTypes;
    return WEAPON_TYPES.filter(type => effectiveTypes.has(type));
}

function formatDamageWithTypes(
    damage: WeaponDamage,
    damageTypes: Iterable<WeaponType>,
    weapon: WeaponEquipment,
    ammo: AmmoEquipment | null,
    ammoProfile?: AmmoWeaponProfile | null
): string {
    const damageValue = weapon.damage === '' ? '' : formatWeaponDamage(damage, {
        shotSuffix: '/Sht',
    });
    const typeSet = new Set(damageTypes);
    const labels = WEAPON_TYPES
        .filter(type => typeSet.has(type))
        .map(type => formatWeaponTypeLabel(type, weapon, ammo, ammoProfile));
    return [damageValue, labels.length > 0 ? `[${labels.join(',')}]` : ''].filter(Boolean).join(' ');
}

function getUnmountedWeaponTypes(weapon: WeaponEquipment, ammo?: AmmoEquipment | null): Set<WeaponType> {
    const types = new Set(weapon.getWeaponTypes());
    ammo?.getRemovedDamageTypes().forEach(type => types.delete(type));
    ammo?.getWeaponTypes().forEach(type => types.add(type));
    return types;
}

function formatWeaponTypeLabel(
    type: WeaponType,
    weapon: WeaponEquipment,
    ammo?: AmmoEquipment | null,
    ammoProfile?: AmmoWeaponProfile | null
): string {
    if (type === 'C') {
        const clusterSize = weapon.getClusterSize(ammo, ammoProfile);
        return clusterSize > 0 ? `C${clusterSize}` : type;
    }
    if (type === 'R') {
        const rapidFireCount = weapon.getRapidFireCount();
        return rapidFireCount > 0 ? `R${rapidFireCount}` : type;
    }
    return type;
}
