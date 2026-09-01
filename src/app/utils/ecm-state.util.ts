// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ECMMode } from '../models/common.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import {
    EQUIPMENT_POWER_OFF_STATE,
    EQUIPMENT_POWER_ON_STATE,
    EQUIPMENT_POWER_STATE_KEY,
    EQUIPMENT_POWER_TURNING_OFF_STATE,
    EQUIPMENT_POWER_TURNING_ON_STATE,
    equipmentPowerState,
} from './equipment-power-state.util';

export const ECM_MODE_STATE_KEY = 'ecm_mode';
export const ECM_PENDING_MODE_STATE_KEY = 'ecm_pending_mode';

export const NOVA_CEWS_STATE_KEY = ECM_MODE_STATE_KEY;
export const NOVA_CEWS_ON_STATE = ECMMode.ECM;
export const NOVA_CEWS_TURNING_OFF_STATE = 'nova-cews-turning-off';
export const NOVA_CEWS_OFF_STATE = ECMMode.OFF;
export const NOVA_CEWS_TURNING_ON_STATE = 'nova-cews-turning-on';

export type NovaCewsState =
    | typeof NOVA_CEWS_ON_STATE
    | typeof NOVA_CEWS_TURNING_OFF_STATE
    | typeof NOVA_CEWS_OFF_STATE
    | typeof NOVA_CEWS_TURNING_ON_STATE;

function inventoryFor(equipment: MountedEquipment): MountedEquipment[] {
    const inventory = [...equipment.owner.getInventory()];
    if (!inventory.some(candidate => candidate.id === equipment.id)) inventory.push(equipment);
    return inventory;
}

function isOperational(equipment: MountedEquipment): boolean {
    return !equipment.owner.destroyed
        && !equipment.owner.getCondition('shutdown')
        && equipment.owner.isEquipmentOperational(equipment);
}

function isNovaCews(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_NOVA') === true;
}

function isEcmSuite(equipment: MountedEquipment): boolean {
    return isNovaCews(equipment) || equipment.equipment?.flags.has('F_ECM') === true;
}

function isProbeSuite(equipment: MountedEquipment): boolean {
    return isNovaCews(equipment) || equipment.equipment?.flags.has('F_BAP') === true;
}

function currentRawEcmMode(equipment: MountedEquipment): string {
    if (isNovaCews(equipment)) {
        const state = novaCewsState(equipment);
        return state === NOVA_CEWS_ON_STATE || state === NOVA_CEWS_TURNING_OFF_STATE
            ? ECMMode.ECM
            : ECMMode.OFF;
    }
    return equipment.states.get(ECM_MODE_STATE_KEY) || ECMMode.ECM;
}

function nextRawEcmMode(equipment: MountedEquipment): string {
    if (isNovaCews(equipment)) {
        const state = novaCewsState(equipment);
        return state === NOVA_CEWS_ON_STATE || state === NOVA_CEWS_TURNING_ON_STATE
            ? ECMMode.ECM
            : ECMMode.OFF;
    }
    return equipment.states.get(ECM_PENDING_MODE_STATE_KEY) || currentRawEcmMode(equipment);
}

function hasPendingEcmActivation(equipment: MountedEquipment): boolean {
    if (isNovaCews(equipment)) return novaCewsState(equipment) === NOVA_CEWS_TURNING_ON_STATE;
    const pendingMode = equipment.states.get(ECM_PENDING_MODE_STATE_KEY);
    return pendingMode !== undefined && pendingMode !== ECMMode.OFF;
}

function preferredEcmSuite(
    equipment: MountedEquipment,
    next: boolean,
): MountedEquipment | undefined {
    const candidates = inventoryFor(equipment).filter(candidate => (
        isEcmSuite(candidate)
        && isOperational(candidate)
        && (next ? nextRawEcmMode(candidate) : currentRawEcmMode(candidate)) !== ECMMode.OFF
    ));
    const activating = next ? candidates.filter(hasPendingEcmActivation) : [];
    const selection = activating.length > 0 ? activating : candidates;
    return selection.find(candidate => candidate.equipment?.flags.has('F_ANGEL_ECM'))
        ?? selection[0];
}

function currentRawProbePowered(equipment: MountedEquipment): boolean {
    if (isEcmSuite(equipment)) return getEffectiveEcmMode(equipment) !== ECMMode.OFF;
    const state = equipmentPowerState(equipment);
    return state === EQUIPMENT_POWER_ON_STATE || state === EQUIPMENT_POWER_TURNING_OFF_STATE;
}

function nextRawProbePowered(equipment: MountedEquipment): boolean {
    if (isEcmSuite(equipment)) return getNextEffectiveEcmMode(equipment) !== ECMMode.OFF;
    const state = equipmentPowerState(equipment);
    return state === EQUIPMENT_POWER_ON_STATE || state === EQUIPMENT_POWER_TURNING_ON_STATE;
}

function hasPendingProbeActivation(equipment: MountedEquipment): boolean {
    if (isEcmSuite(equipment)) return hasPendingEcmActivation(equipment);
    return equipmentPowerState(equipment) === EQUIPMENT_POWER_TURNING_ON_STATE;
}

function preferredProbeSuite(
    equipment: MountedEquipment,
    next: boolean,
): MountedEquipment | undefined {
    const candidates = inventoryFor(equipment).filter(candidate => (
        isProbeSuite(candidate)
        && isOperational(candidate)
        && (next ? nextRawProbePowered(candidate) : currentRawProbePowered(candidate))
    ));
    const activating = next ? candidates.filter(hasPendingProbeActivation) : [];
    if (activating.length > 0) return activating[0];

    // A selected combined suite supplies both functions; otherwise the first
    // standalone probe in mount order is the stable tabletop default.
    return candidates.find(isEcmSuite)
        ?? candidates[0];
}

/** Missing and legacy non-Off ECM modes preserve the rules-default active state. */
export function novaCewsState(equipment: MountedEquipment | null | undefined): NovaCewsState {
    switch (equipment?.states.get(NOVA_CEWS_STATE_KEY)?.trim().toLowerCase()) {
        case NOVA_CEWS_TURNING_OFF_STATE: return NOVA_CEWS_TURNING_OFF_STATE;
        case ECMMode.OFF: return NOVA_CEWS_OFF_STATE;
        case NOVA_CEWS_TURNING_ON_STATE: return NOVA_CEWS_TURNING_ON_STATE;
        default: return NOVA_CEWS_ON_STATE;
    }
}

/** Resolves the one ECM suite supplying effects during the current turn. */
export function getEffectiveEcmMode(equipment: MountedEquipment): ECMMode | string {
    const rawMode = currentRawEcmMode(equipment);
    if (rawMode === ECMMode.OFF) return ECMMode.OFF;
    return preferredEcmSuite(equipment, false)?.id === equipment.id ? rawMode : ECMMode.OFF;
}

/** Resolves the queued End-Phase ECM selection without changing current-turn effects. */
export function getNextEffectiveEcmMode(equipment: MountedEquipment): ECMMode | string {
    const rawMode = nextRawEcmMode(equipment);
    if (rawMode === ECMMode.OFF) return ECMMode.OFF;
    return preferredEcmSuite(equipment, true)?.id === equipment.id ? rawMode : ECMMode.OFF;
}

/** A pending End-Phase transition does not change the system's current effects. */
export function isNovaCewsEffectivelyActive(equipment: MountedEquipment | null | undefined): boolean {
    return !!equipment
        && isNovaCews(equipment)
        && getEffectiveEcmMode(equipment) !== ECMMode.OFF;
}

/** Resolves the Nova state presented by its single shared power control. */
export function nextEffectiveNovaCewsState(equipment: MountedEquipment): NovaCewsState {
    const state = novaCewsState(equipment);
    if (state === NOVA_CEWS_TURNING_ON_STATE || state === NOVA_CEWS_TURNING_OFF_STATE) return state;
    return getNextEffectiveEcmMode(equipment) === ECMMode.OFF
        ? NOVA_CEWS_OFF_STATE
        : NOVA_CEWS_ON_STATE;
}

/** Mode state only; callers remain responsible for equipment and unit availability. */
export function isEcmModeActive(equipment: MountedEquipment): boolean {
    return getEffectiveEcmMode(equipment) !== ECMMode.OFF;
}

/** Resolves the one active probe supplying effects during the current turn. */
export function isActiveProbeEffectivelyActive(equipment: MountedEquipment): boolean {
    return isProbeSuite(equipment)
        && currentRawProbePowered(equipment)
        && preferredProbeSuite(equipment, false)?.id === equipment.id;
}

/** Resolves the state presented by a standalone active-probe power control. */
export function nextEffectiveProbePowerState(equipment: MountedEquipment): string {
    const state = equipmentPowerState(equipment);
    if (state === EQUIPMENT_POWER_TURNING_ON_STATE || state === EQUIPMENT_POWER_TURNING_OFF_STATE) return state;
    return nextRawProbePowered(equipment)
        && preferredProbeSuite(equipment, true)?.id === equipment.id
        ? EQUIPMENT_POWER_ON_STATE
        : EQUIPMENT_POWER_OFF_STATE;
}

function switchEcmOff(equipment: MountedEquipment): boolean {
    const changed = equipment.setState(ECM_MODE_STATE_KEY, ECMMode.OFF);
    return equipment.deleteState(ECM_PENDING_MODE_STATE_KEY) || changed;
}

function switchStandaloneProbeOff(equipment: MountedEquipment): boolean {
    return equipment.setState(EQUIPMENT_POWER_STATE_KEY, EQUIPMENT_POWER_OFF_STATE);
}

function cancelPendingEcmActivation(equipment: MountedEquipment): boolean {
    if (isNovaCews(equipment)) {
        return novaCewsState(equipment) === NOVA_CEWS_TURNING_ON_STATE
            && equipment.setState(NOVA_CEWS_STATE_KEY, NOVA_CEWS_OFF_STATE);
    }
    const pendingMode = equipment.states.get(ECM_PENDING_MODE_STATE_KEY);
    return pendingMode !== undefined
        && pendingMode !== ECMMode.OFF
        && equipment.deleteState(ECM_PENDING_MODE_STATE_KEY);
}

function cancelPendingProbeActivation(equipment: MountedEquipment): boolean {
    return equipmentPowerState(equipment) === EQUIPMENT_POWER_TURNING_ON_STATE
        && equipment.setState(EQUIPMENT_POWER_STATE_KEY, EQUIPMENT_POWER_OFF_STATE);
}

/**
 * Makes the most recently selected suite win a queued End-Phase handoff while
 * preserving every suite's current-turn effects.
 */
export function cancelConflictingElectronicSuiteActivations(selected: MountedEquipment): boolean {
    const claimsEcm = isEcmSuite(selected);
    const claimsProbe = isProbeSuite(selected);
    if (!claimsEcm && !claimsProbe) return false;

    let changed = false;
    for (const other of selected.owner.getInventory()) {
        if (other.id === selected.id) continue;
        const conflictsWithEcm = claimsEcm && isEcmSuite(other);
        const conflictsWithProbe = claimsProbe && isProbeSuite(other);
        if (!conflictsWithEcm && !conflictsWithProbe) continue;

        const otherChanged = isEcmSuite(other)
            ? cancelPendingEcmActivation(other)
            : cancelPendingProbeActivation(other);
        if (otherChanged) {
            other.owner.setInventoryEntry(other);
            changed = true;
        }
    }
    return changed;
}

/**
 * Commits the exclusivity part of an End-Phase electronic-suite handoff.
 * A combined ECM/probe suite powers fully down when either of its functions
 * conflicts with the newly selected suite.
 */
export function deactivateConflictingElectronicSuites(selected: MountedEquipment): void {
    const claimsEcm = isEcmSuite(selected);
    const claimsProbe = isProbeSuite(selected);
    if (!claimsEcm && !claimsProbe) return;

    for (const other of selected.owner.getInventory()) {
        if (other.id === selected.id) continue;
        const conflictsWithEcm = claimsEcm && isEcmSuite(other);
        const conflictsWithProbe = claimsProbe && isProbeSuite(other);
        if (!conflictsWithEcm && !conflictsWithProbe) continue;

        const changed = isEcmSuite(other)
            ? switchEcmOff(other)
            : switchStandaloneProbeOff(other);
        if (changed) other.owner.setInventoryEntry(other);
    }
}

function hasEcmTransition(equipment: MountedEquipment): boolean {
    if (isNovaCews(equipment)) {
        const state = novaCewsState(equipment);
        return state === NOVA_CEWS_TURNING_ON_STATE || state === NOVA_CEWS_TURNING_OFF_STATE;
    }
    return equipment.states.has(ECM_PENDING_MODE_STATE_KEY);
}

function hasProbeTransition(equipment: MountedEquipment): boolean {
    if (isEcmSuite(equipment)) return hasEcmTransition(equipment);
    const state = equipmentPowerState(equipment);
    return state === EQUIPMENT_POWER_TURNING_ON_STATE || state === EQUIPMENT_POWER_TURNING_OFF_STATE;
}

/**
 * Repairs the implicit all-on state produced by equipment defaults at load.
 * Explicit End-Phase transitions are preserved so a saved handoff is not
 * collapsed early.
 */
export function normalizeElectronicSuiteDefaults(inventory: readonly MountedEquipment[]): void {
    const ecmSuites = inventory.filter(equipment => (
        isEcmSuite(equipment)
        && isOperational(equipment)
        && currentRawEcmMode(equipment) !== ECMMode.OFF
    ));
    if (ecmSuites.length > 1 && !ecmSuites.some(hasEcmTransition)) {
        const kept = ecmSuites.find(equipment => equipment.equipment?.flags.has('F_ANGEL_ECM'))
            ?? ecmSuites[0];
        for (const equipment of ecmSuites) {
            if (equipment.id !== kept.id) switchEcmOff(equipment);
        }
    }

    const activeProbes = inventory.filter(equipment => {
        if (!isProbeSuite(equipment) || !isOperational(equipment)) return false;
        return isEcmSuite(equipment)
            ? currentRawEcmMode(equipment) !== ECMMode.OFF
            : currentRawProbePowered(equipment);
    });
    if (activeProbes.length > 1 && !activeProbes.some(hasProbeTransition)) {
        const kept = activeProbes.find(isEcmSuite)
            ?? activeProbes[0];
        for (const equipment of activeProbes) {
            if (equipment.id === kept.id) continue;
            if (isEcmSuite(equipment)) switchEcmOff(equipment);
            else switchStandaloneProbeOff(equipment);
        }
    }
}
