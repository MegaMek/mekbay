// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';

export const HPG_STATE_KEY = 'hpgState';
export const HPG_IDLE_STATE = 'idle';
export const HPG_CHARGING_STATE = 'charging';
export const HPG_CHARGED_STATE = 'charged';
export const HPG_TRANSMITTING_STATE = 'transmitting';
export const HPG_COOLDOWN_STATE = 'cooldown';
export const HPG_COOLDOWN_TURNS_STATE_KEY = 'hpgCooldownTurns';

export function isGroundMobileHpg(equipment: MountedEquipment): boolean {
    return equipment.equipment?.hasAllFlags(['F_MOBILE_HPG', 'F_MEK_EQUIPMENT']) === true;
}

export function hpgState(equipment: MountedEquipment): string {
    const state = equipment.states.get(HPG_STATE_KEY);
    return state === HPG_CHARGING_STATE
        || state === HPG_CHARGED_STATE
        || state === HPG_TRANSMITTING_STATE
        || state === HPG_COOLDOWN_STATE
        ? state
        : HPG_IDLE_STATE;
}

export function isHpgBlockingWeaponAttacks(equipment: MountedEquipment): boolean {
    const state = hpgState(equipment);
    return state === HPG_CHARGING_STATE || state === HPG_TRANSMITTING_STATE;
}

export function unitHasBusyHpg(unit: CBTForceUnit): boolean {
    return unit.getInventory().some(entry =>
        entry.equipment?.hasFlag('F_MOBILE_HPG') === true
        && unit.isEquipmentOperational(entry)
        && isHpgBlockingWeaponAttacks(entry));
}

export function unitHasTransmittingGroundMobileHpg(unit: CBTForceUnit): boolean {
    return unit.getInventory().some(entry =>
        isGroundMobileHpg(entry)
        && unit.isEquipmentOperational(entry)
        && hpgState(entry) === HPG_TRANSMITTING_STATE);
}

/** Planned inventory selections are the unit's weapon attacks for this turn. */
export function unitHasSelectedWeaponAttack(unit: CBTForceUnit): boolean {
    return unit.getInventory().some(entry =>
        entry.equipment instanceof WeaponEquipment
        && !entry.isPhysicalWeapon()
        && (unit.isInventoryControlEntrySelected?.(entry.id) ?? false));
}
