// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, type Equipment, WeaponEquipment } from '../models/equipment.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { Unit } from '../models/units.model';
import { WEAPON_TYPES } from '../models/weapon-types.model';

const SUPPORT_VEHICLE_SUBTYPES = new Set<Unit['subtype']>([
    'Support Vehicle',
    'Support Vehicle Omni',
    'Fixed Wing Support Vehicle',
    'Fixed Wing Support Vehicle Omni',
]);

interface InventoryMountNameMetadata {
    readonly rearMounted: boolean;
    readonly mekTurretMounted: boolean;
    readonly sponsonTurretMounted: boolean;
    readonly pintleTurretMounted: boolean;
    readonly baMountLocation: 'Body' | 'Turret' | null;
    readonly squadSupportWeapon: boolean;
    readonly dwpMounted: boolean;
    readonly size: number;
}

/** Calculates the canonical display name for a typed equipment mount. */
export function calculateInventoryName(entry: MountedEquipment): string | null {
    const equipment = entry.equipment;
    if (!equipment) return null;

    const unit = entry.owner.getUnit?.();
    const registry = entry.owner.getEquipmentRegistry?.();
    const mount = readInventoryMountNameMetadata(entry);
    const parts = [baseInventoryEquipmentName(equipment, unit, entry.name)];

    const inBracketsParts: string[] = [];
    if (unit && registry && showInventoryTechBase(equipment, unit, registry)) {
        inBracketsParts.push(equipment.techBase === 'Clan' ? 'C' : 'IS');
    }
    if (mount.rearMounted && !isSpheroidSmallCraft(unit)) inBracketsParts.push('R');
    if (mount.mekTurretMounted) inBracketsParts.push('T');
    if (mount.sponsonTurretMounted) inBracketsParts.push('S');
    if (mount.pintleTurretMounted) inBracketsParts.push('P');

    if (equipment instanceof WeaponEquipment && unit?.subtype === 'Battle Armor') {
        if (mount.baMountLocation === 'Body') {
            inBracketsParts.push('Body');
        } else if (!mount.mekTurretMounted && mount.baMountLocation === 'Turret') {
            inBracketsParts.push('T');
        }
    }
    if (mount.squadSupportWeapon) inBracketsParts.push('SSW: Trooper 1');
    if (mount.dwpMounted) inBracketsParts.push('DWP');

    if (inBracketsParts.length > 0) {
        parts.push(`(${inBracketsParts.join(', ')})`);
    }

    if (unit?.type === 'Aero') {
        const aeroInfo = formatAeroEquipmentTypes(entry);
        if (aeroInfo) parts.push(aeroInfo);
    }
    if (unit && SUPPORT_VEHICLE_SUBTYPES.has(unit.subtype)
        && equipment instanceof WeaponEquipment
        && equipment.isInfantryWeapon()) {
        parts.push(`[${Math.trunc(mount.size) * equipment.infantry.shots} shots]`);
    }

    const oneShotAmmo = selectedIntrinsicOneShotAmmo(entry, registry);
    if (equipment instanceof WeaponEquipment && equipment.oneShotCount && oneShotAmmo?.baseAmmo) {
        const mutatorName = oneShotAmmo.mutatorName?.replace('(Clan) ', '').trim();
        if (mutatorName) parts.push(`[${mutatorName}]`);
    }

    return parts.filter(Boolean).join(' ').trim();
}

function baseInventoryEquipmentName(equipment: Equipment, unit: Unit | undefined, fallbackName: string): string {
    const equipmentName = equipment.name?.trim() || equipment.shortName?.trim() || fallbackName.trim();
    let name = equipmentName.length > 20 ? equipment.shortName?.trim() || equipmentName : equipmentName;
    if (unit && !unit.mixed) {
        name = name.replace(/ ?(?:\((?:Clan|IS)\)|\[(?:Clan|IS)\])/g, '');
    }
    return name.trim();
}

function showInventoryTechBase(
    equipment: Equipment,
    unit: Unit,
    registry: EquipmentRegistry,
): boolean {
    if (!unit.mixed || equipment.techBase === 'All') return false;

    return [...new Set(Object.values(registry.equipment))].some(candidate =>
        candidate.techBase !== equipment.techBase
        && candidate.name === equipment.name
        && candidate.level !== 'Unofficial');
}

function readInventoryMountNameMetadata(entry: MountedEquipment): InventoryMountNameMetadata {
    const element = entry.el;
    const baMountLocation = element?.getAttribute('baMountLoc')?.toLowerCase();
    const sizeAttribute = element?.getAttribute('mountSize');
    const size = sizeAttribute === null || sizeAttribute === undefined ? 1 : Number(sizeAttribute);
    return {
        rearMounted: readBooleanAttribute(element, 'rearMounted') ?? false,
        mekTurretMounted: readBooleanAttribute(element, 'mekTurretMounted') ?? false,
        sponsonTurretMounted: readBooleanAttribute(element, 'sponsonTurretMounted') ?? false,
        pintleTurretMounted: readBooleanAttribute(element, 'pintleTurretMounted') ?? false,
        baMountLocation: baMountLocation === 'body'
            ? 'Body'
            : baMountLocation === 'turret' ? 'Turret' : null,
        squadSupportWeapon: readBooleanAttribute(element, 'SSW') ?? false,
        dwpMounted: readBooleanAttribute(element, 'dwpMounted') ?? false,
        size: Number.isFinite(size) && size >= 0 ? size : 1,
    };
}

function readBooleanAttribute(element: SVGElement | undefined, name: string): boolean | undefined {
    const value = element?.getAttribute(name);
    if (value === null || value === undefined) return undefined;
    return value !== '0' && value.toLowerCase() !== 'false';
}

function isSpheroidSmallCraft(unit: Unit | undefined): boolean {
    return unit?.subtype.includes('Spheroid') === true;
}

function selectedIntrinsicOneShotAmmo(
    entry: MountedEquipment,
    registry: EquipmentRegistry | undefined,
): AmmoEquipment | null {
    const ammoMount = entry.linkedWith?.find(candidate =>
        candidate.equipment instanceof AmmoEquipment && candidate.intrinsicOneShotAmmo === true);
    if (!(ammoMount?.equipment instanceof AmmoEquipment)) return null;
    const selectedAmmo = ammoMount.ammo ? registry?.findEquipment(ammoMount.ammo) : null;
    return selectedAmmo instanceof AmmoEquipment ? selectedAmmo : ammoMount.equipment;
}

function formatAeroEquipmentTypes(entry: MountedEquipment): string {
    const equipment = entry.equipment;
    if (equipment instanceof WeaponEquipment) {
        const weapon = entry as MountedWeapon;
        const types = entry.owner.getEffectiveWeaponTypes?.(weapon) ?? new Set(weapon.getWeaponTypes());
        const labels = WEAPON_TYPES.filter(type => types.has(type));
        return labels.length > 0 ? `[${labels.join(',')}]` : '';
    }
    return equipment instanceof AmmoEquipment && equipment.ammoType === 'COOLANT_POD'
        ? '[PE,OS,X]'
        : '[E]';
}
