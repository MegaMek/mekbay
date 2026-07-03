import type { MountedEquipment } from '../models/force-serialization';

export const PPC_CAPACITOR_STATE_KEY = 'ppc_capacitor_state';
export const PPC_CAPACITOR_CHARGED_STATE = 'charged';
export const PPC_CAPACITOR_HEAT_BONUS = 5;
export const PPC_CAPACITOR_DAMAGE_BONUS = 5;

export function isPpcWeapon(entry: MountedEquipment): boolean {
    return entry.equipment?.hasFlag('F_PPC') === true;
}

export function isPpcCapacitor(entry: MountedEquipment): boolean {
    return entry.equipment?.hasFlag('F_WEAPON_ENHANCEMENT') === true
        && entry.equipment.hasFlag('F_PPC_CAPACITOR');
}

export function linkedPpcCapacitor(weapon: MountedEquipment): MountedEquipment | null {
    if (!isPpcWeapon(weapon)) return null;
    return weapon.linkedWith?.find(isPpcCapacitor) ?? null;
}

export function isPpcCapacitorUsable(weapon: MountedEquipment, capacitor: MountedEquipment): boolean {
    return isPpcWeapon(weapon)
        && isPpcCapacitor(capacitor)
        && !weapon.isUnavailable()
        && !capacitor.isUnavailable();
}

export function isPpcCapacitorCharged(capacitor: MountedEquipment): boolean {
    return capacitor.states.get(PPC_CAPACITOR_STATE_KEY) === PPC_CAPACITOR_CHARGED_STATE;
}

export function chargedLinkedPpcCapacitor(weapon: MountedEquipment): MountedEquipment | null {
    const capacitor = linkedPpcCapacitor(weapon);
    if (!capacitor || !isPpcCapacitorUsable(weapon, capacitor)) return null;
    return isPpcCapacitorCharged(capacitor) ? capacitor : null;
}

export function setPpcCapacitorCharged(capacitor: MountedEquipment, charged: boolean): boolean {
    if (charged) return capacitor.setState(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
    return capacitor.deleteState(PPC_CAPACITOR_STATE_KEY);
}

export function addPpcCapacitorBonus(value: string, bonus: number): string | null {
    const match = value.trim().match(/^([+-]?\d+(?:\.\d+)?)(.*)$/);
    if (!match) return null;
    const next = Number.parseFloat(match[1]) + bonus;
    if (!Number.isFinite(next)) return null;
    const nextText = Number.isInteger(next) ? next.toString() : next.toFixed(1).replace(/\.0$/, '');
    return `${nextText}${match[2]}`;
}