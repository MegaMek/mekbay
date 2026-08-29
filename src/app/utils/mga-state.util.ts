// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';

export const MGA_ACTIVATION_STATE_KEY = 'mgaActivation';
export const MGA_ACTIVE_STATE = 'active';
export const MGA_TURNING_ON_STATE = 'turning-on';
export const MGA_OFF_STATE = 'off';
export const MGA_TURNING_OFF_STATE = 'turning-off';

export type MgaActivationState =
    | typeof MGA_ACTIVE_STATE
    | typeof MGA_TURNING_ON_STATE
    | typeof MGA_OFF_STATE
    | typeof MGA_TURNING_OFF_STATE;

/** MGAs begin active unless the owning player turns them off during an End Phase. */
export function machineGunArrayActivationState(array: MountedEquipment): MgaActivationState {
    const state = array.states.get(MGA_ACTIVATION_STATE_KEY);
    return state === MGA_ACTIVE_STATE
        || state === MGA_TURNING_ON_STATE
        || state === MGA_OFF_STATE
        || state === MGA_TURNING_OFF_STATE
        ? state
        : MGA_ACTIVE_STATE;
}

/** A pending End-Phase change retains the state that applies during the current turn. */
export function isMachineGunArrayEffectivelyActive(array: MountedEquipment): boolean {
    const state = machineGunArrayActivationState(array);
    return state === MGA_ACTIVE_STATE || state === MGA_TURNING_OFF_STATE;
}

export function isMachineGunArray(equipment: MountedEquipment): boolean {
    return equipment.equipment instanceof WeaponEquipment
        && equipment.equipment.hasFlag('F_MGA');
}

export function machineGunArrayController(equipment: MountedEquipment): MountedEquipment | null {
    return equipment.parent && isMachineGunArray(equipment.parent)
        ? equipment.parent
        : null;
}

export function isMachineGunArrayMember(equipment: MountedEquipment): boolean {
    return machineGunArrayController(equipment) !== null;
}

/** Returns only same-location, same-type machine guns that are valid members of this array. */
export function machineGunArrayMembers(array: MountedEquipment): MountedEquipment[] {
    if (!isMachineGunArray(array)) return [];
    return [...(array.linkedWith ?? [])].filter(member => isCompatibleMachineGunArrayMember(array, member));
}

export function operationalMachineGunArrayMembers(
    array: MountedEquipment,
    isOperational: (member: MountedEquipment) => boolean = member => member.owner.isEquipmentOperational(member),
): MountedEquipment[] {
    return machineGunArrayMembers(array).filter(isOperational);
}

/**
 * Restores MGA bays when a record-sheet SVG exports the array and its guns as flat rows.
 * Explicit nested links win; otherwise arrays claim up to four compatible, unclaimed guns
 * in inventory order, matching MegaMek's loader fallback.
 */
export function reconcileMachineGunArrayLinks(inventory: readonly MountedEquipment[]): void {
    const arrays = inventory.filter(isMachineGunArray);
    const claimed = new Set<MountedEquipment>();

    for (const array of arrays) {
        const explicitMembers = machineGunArrayMembers(array);
        if (explicitMembers.length === 0) continue;
        explicitMembers.forEach(member => claimed.add(member));
    }

    for (const array of arrays) {
        if (machineGunArrayMembers(array).length > 0) continue;
        const criticalSlotMembers = inferCriticalSlotMachineGunArrayMembers(array, inventory, claimed);
        const inferredMembers = criticalSlotMembers.length > 0 ? criticalSlotMembers : inventory
            .filter(candidate => !claimed.has(candidate)
                && (!candidate.parent || candidate.parent === array)
                && isCompatibleMachineGunArrayMember(array, candidate))
            .slice(0, 4);
        if (inferredMembers.length === 0) continue;
        array.setLinkedEquipment(inferredMembers);
        inferredMembers.forEach(member => claimed.add(member));
    }
}

function inferCriticalSlotMachineGunArrayMembers(
    array: MountedEquipment,
    inventory: readonly MountedEquipment[],
    claimed: ReadonlySet<MountedEquipment>,
): MountedEquipment[] {
    const candidatesById = new Map(inventory
        .filter(candidate => !claimed.has(candidate)
            && (!candidate.parent || candidate.parent === array)
            && isCompatibleMachineGunArrayMember(array, candidate))
        .map(candidate => [candidate.id, candidate]));
    if (candidatesById.size === 0) return [];

    const arrayLocations = array.locations;
    const slots = array.owner.getCritSlots()
        .filter(slot => !arrayLocations?.size || (!!slot.loc && arrayLocations.has(slot.loc)))
        .sort((first, second) => (first.slot ?? Number.MAX_SAFE_INTEGER) - (second.slot ?? Number.MAX_SAFE_INTEGER));
    if (slots.length === 0) return [];

    const members: MountedEquipment[] = [];
    let started = false;
    for (const slot of slots) {
        const candidate = candidatesById.get(slot.id);
        if (candidate) {
            if (!members.includes(candidate)) members.push(candidate);
            started = true;
            if (members.length >= 4) break;
        } else if (started) {
            break;
        }
    }
    return members;
}

function isCompatibleMachineGunArrayMember(array: MountedEquipment, candidate: MountedEquipment): boolean {
    const arrayType = array.equipment;
    const candidateType = candidate.equipment;
    return candidate !== array
        && arrayType instanceof WeaponEquipment
        && candidateType instanceof WeaponEquipment
        && candidateType.hasFlag('F_MG')
        && !candidateType.hasFlag('F_MGA')
        && candidateType.rackSize === arrayType.rackSize
        && mountedLocationsOverlap(array, candidate);
}

function mountedLocationsOverlap(first: MountedEquipment, second: MountedEquipment): boolean {
    const firstLocations = first.locations;
    const secondLocations = second.locations;
    if (!firstLocations?.size || !secondLocations?.size) return true;
    return [...firstLocations].some(location => secondLocations.has(location));
}
