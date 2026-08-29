// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ECMMode } from './common.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import type { ArmorEquipment } from './equipment.model';
import type { MountedEquipment } from './mounted-equipment.model';
import {
    TN_CHAMELEON_MODIFIERS,
    TN_NULL_SIGNATURE_MODIFIERS,
    TN_STANDARD_STEALTH_MODIFIERS,
    getVisualCamoTnModifiers,
    type TnRangeModifiers,
    type TnStealthModifiers,
} from './target-number-calculator.model';
import { getEffectiveEcmMode, getNextEffectiveEcmMode } from '../utils/ecm-state.util';

export const STEALTH_STATE_KEY = 'state';
export const STEALTH_ENABLED_STATE = 'enabled';
export const STEALTH_ENABLING_STATE = 'enabling';
export const STEALTH_DISABLED_STATE = 'disabled';
export const STEALTH_DISABLING_STATE = 'disabling';

const ZERO_RANGE_MODIFIERS: TnRangeModifiers = { short: 0, medium: 0, long: 0 };
const BA_STEALTH_ARMOR_TYPES = new Set<string>([
    'BA_STEALTH_BASIC',
    'BA_STEALTH',
    'BA_STEALTH_PROTOTYPE',
    'BA_STEALTH_IMP',
]);

function armorType(equipment: MountedEquipment): string | undefined {
    return equipment.equipment?.type === 'armor'
        ? (equipment.equipment as ArmorEquipment).armorType
        : undefined;
}

/** Electronic Stealth Armor, excluding visual-camouflage equipment that shares F_STEALTH. */
export function isStealthEquipment(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_STEALTH') === true
        && equipment.equipment.flags.has('F_VISUAL_CAMO') === false;
}

export function isVisualCamoEquipment(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_VISUAL_CAMO') === true;
}

export function isMimeticArmorEquipment(equipment: MountedEquipment): boolean {
    return isVisualCamoEquipment(equipment) && armorType(equipment) === 'BA_MIMETIC';
}

export function isSimpleCamoEquipment(equipment: MountedEquipment): boolean {
    return isVisualCamoEquipment(equipment) && !isMimeticArmorEquipment(equipment);
}

export function isBattleArmorStealthEquipment(equipment: MountedEquipment): boolean {
    const type = armorType(equipment);
    return isStealthEquipment(equipment) && type !== undefined && BA_STEALTH_ARMOR_TYPES.has(type);
}

export function isChameleonShieldEquipment(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_CHAMELEON_SHIELD') === true;
}

export function isNullSignatureEquipment(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_NULL_SIG') === true;
}

export function isVoidSignatureEquipment(equipment: MountedEquipment): boolean {
    return equipment.equipment?.flags.has('F_VOID_SIG') === true;
}

export function isStealthSystemEquipment(equipment: MountedEquipment): boolean {
    return isStealthEquipment(equipment)
        || isVisualCamoEquipment(equipment)
        || isChameleonShieldEquipment(equipment)
        || isNullSignatureEquipment(equipment)
        || isVoidSignatureEquipment(equipment);
}

export function isSwitchableStealthEquipment(equipment: MountedEquipment): boolean {
    const modes = equipment.equipment?.modes ?? [];
    return modes.includes('Off') && modes.includes('On');
}

function isToggleEffectivelyActive(equipment: MountedEquipment): boolean {
    const state = equipment.states.get(STEALTH_STATE_KEY);
    return state === STEALTH_ENABLED_STATE || state === STEALTH_DISABLING_STATE;
}

function isPassiveOrToggleActive(equipment: MountedEquipment): boolean {
    return !isSwitchableStealthEquipment(equipment) || isToggleEffectivelyActive(equipment);
}

export function isStealthEquipmentActive(equipment: MountedEquipment): boolean {
    return isStealthEquipment(equipment) && isPassiveOrToggleActive(equipment);
}

export function isVisualCamoActive(equipment: MountedEquipment): boolean {
    return isVisualCamoEquipment(equipment) && isPassiveOrToggleActive(equipment);
}

export function isChameleonShieldActive(equipment: MountedEquipment): boolean {
    return isChameleonShieldEquipment(equipment) && isPassiveOrToggleActive(equipment);
}

export function isNullSignatureActive(equipment: MountedEquipment): boolean {
    return isNullSignatureEquipment(equipment) && isPassiveOrToggleActive(equipment);
}

export function isVoidSignatureActive(equipment: MountedEquipment): boolean {
    return isVoidSignatureEquipment(equipment) && isPassiveOrToggleActive(equipment);
}

export function isStealthSystemActive(equipment: MountedEquipment): boolean {
    return isStealthEquipmentActive(equipment)
        || isVisualCamoActive(equipment)
        || isChameleonShieldActive(equipment)
        || isNullSignatureActive(equipment)
        || isVoidSignatureActive(equipment);
}

/** Only ECM-bearing modes power Stealth Armor; ECCM and plain Ghost do not. */
export function ecmModeSupportsStealth(equipment: MountedEquipment, next = false): boolean {
    const mode = next ? getNextEffectiveEcmMode(equipment) : getEffectiveEcmMode(equipment);
    return mode === ECMMode.ECM
        || mode === ECMMode.ECM_ECCM
        || mode === ECMMode.ECM_GHOST;
}

/** Switchable Stealth Armor needs an operable ECM suite in an ECM-bearing mode. */
export function hasFunctionalEcmForStealth(equipment: MountedEquipment, next = false): boolean {
    const owner = equipment.owner;
    const roots = [
        ...(owner.getInventory?.() ?? []),
        ...(equipment.linkedWith ?? []),
        ...(equipment.parent ? [equipment.parent] : []),
    ];
    const visited = new Set<MountedEquipment>();
    const pending = [...roots];

    while (pending.length > 0) {
        const candidate = pending.pop()!;
        if (visited.has(candidate)) continue;
        visited.add(candidate);
        pending.push(...(candidate.linkedWith ?? []));
        if (candidate.parent) pending.push(candidate.parent);

        if (candidate.equipment?.flags.has('F_ECM') !== true || !ecmModeSupportsStealth(candidate, next)) continue;
        if (candidate.committedDestroyed()
            || candidate.isDestroying()
            || owner.isEquipmentOperational?.(candidate) === false) continue;
        return true;
    }
    return false;
}

export function isStealthEquipmentFunctioning(equipment: MountedEquipment): boolean {
    if (!isStealthEquipmentActive(equipment)) return false;
    return !isSwitchableStealthEquipment(equipment) || hasFunctionalEcmForStealth(equipment);
}

export function isVoidSignatureFunctioning(equipment: MountedEquipment): boolean {
    return isVoidSignatureActive(equipment) && hasFunctionalEcmForStealth(equipment);
}

/** Active Stealth Armor cuts C3 and suppresses the unit's ECM-sensitive systems. */
export function isC3DisruptingStealthActive(equipment: MountedEquipment): boolean {
    return isSwitchableStealthEquipment(equipment)
        && (isStealthEquipmentFunctioning(equipment) || isVoidSignatureFunctioning(equipment));
}

export function unitHasActiveC3DisruptingStealth(unit: CBTForceUnit): boolean {
    if (unit.destroyed || unit.getCondition('shutdown')) return false;
    return (unit.getInventory?.() ?? []).some(equipment => (
        unit.isEquipmentOperational?.(equipment) !== false
        && isC3DisruptingStealthActive(equipment)
    ));
}

/** Void Signature penalizes every weapon attack made by its carrying unit. */
export function unitHasActiveVoidSignature(unit: CBTForceUnit): boolean {
    if (unit.destroyed || unit.getCondition('shutdown')) return false;
    return (unit.getInventory?.() ?? []).some(equipment => (
        unit.isEquipmentOperational?.(equipment) !== false
        && isVoidSignatureFunctioning(equipment)
    ));
}

function infantryIgnoredProfile(short: number, medium: number, long: number): TnStealthModifiers {
    return { short, medium, long, conventionalInfantry: ZERO_RANGE_MODIFIERS };
}

/** Resolves the profile supplied by one active, functioning signature-system mount. */
export function getStealthTnModifiersForEquipment(
    equipment: MountedEquipment,
    targetMoveDistance = 0,
): TnStealthModifiers | null {
    if (isVoidSignatureFunctioning(equipment)) {
        const modifier = targetMoveDistance > 5 ? 0 : targetMoveDistance > 2 ? 1 : targetMoveDistance > 0 ? 2 : 3;
        const infantryModifier = Math.max(0, modifier - 1);
        return {
            short: modifier,
            medium: modifier,
            long: modifier,
            conventionalInfantry: {
                short: infantryModifier,
                medium: infantryModifier,
                long: infantryModifier,
            },
        };
    }
    if (isChameleonShieldActive(equipment)) return TN_CHAMELEON_MODIFIERS;
    if (isNullSignatureActive(equipment)) return TN_NULL_SIGNATURE_MODIFIERS;
    if (isMimeticArmorEquipment(equipment) && isVisualCamoActive(equipment)) {
        return getVisualCamoTnModifiers('mimetic', targetMoveDistance);
    }
    if (isSimpleCamoEquipment(equipment) && isVisualCamoActive(equipment)) {
        return getVisualCamoTnModifiers('simple-camo', targetMoveDistance);
    }
    if (!isStealthEquipmentFunctioning(equipment)) return null;

    switch (armorType(equipment)) {
        case 'BA_STEALTH_BASIC':
        case 'BA_STEALTH_PROTOTYPE':
            return infantryIgnoredProfile(0, 1, 2);
        case 'BA_STEALTH':
            return infantryIgnoredProfile(1, 1, 2);
        case 'BA_STEALTH_IMP':
            return infantryIgnoredProfile(1, 2, 3);
    }
    return TN_STANDARD_STEALTH_MODIFIERS;
}

function rangeProfile(profile: TnStealthModifiers, conventionalInfantry: boolean): TnRangeModifiers {
    return conventionalInfantry ? profile.conventionalInfantry ?? profile : profile;
}

function sameRange(left: TnRangeModifiers, right: TnRangeModifiers): boolean {
    return left.short === right.short && left.medium === right.medium && left.long === right.long;
}

function combineProfiles(
    left: TnStealthModifiers,
    right: TnStealthModifiers,
    combine: (left: number, right: number) => number,
): TnStealthModifiers {
    const normal = {
        short: combine(left.short, right.short),
        medium: combine(left.medium, right.medium),
        long: combine(left.long, right.long),
    };
    const leftInfantry = rangeProfile(left, true);
    const rightInfantry = rangeProfile(right, true);
    const conventionalInfantry = {
        short: combine(leftInfantry.short, rightInfantry.short),
        medium: combine(leftInfantry.medium, rightInfantry.medium),
        long: combine(leftInfantry.long, rightInfantry.long),
    };
    return {
        ...normal,
        ...(!sameRange(normal, conventionalInfantry) && { conventionalInfantry }),
        ...((left.secondaryTargetRestricted || right.secondaryTargetRestricted)
            && { secondaryTargetRestricted: true }),
    };
}

function maxProfiles(profiles: readonly TnStealthModifiers[]): TnStealthModifiers | undefined {
    return profiles.reduce<TnStealthModifiers | undefined>((combined, profile) => (
        combined ? combineProfiles(combined, profile, Math.max) : profile
    ), undefined);
}

function addProfiles(
    left: TnStealthModifiers | undefined,
    right: TnStealthModifiers | undefined,
): TnStealthModifiers | undefined {
    if (!left) return right;
    if (!right) return left;
    return combineProfiles(left, right, (leftValue, rightValue) => leftValue + rightValue);
}

/** Returns one compact profile for the unit's currently effective signature protection. */
export function getActiveStealthTnModifiers(unit: CBTForceUnit): TnStealthModifiers | undefined {
    if (unit.destroyed || unit.getCondition('shutdown')) return undefined;
    const inventory = (unit.getInventory?.() ?? [])
        .filter(entry => unit.isEquipmentOperational?.(entry) !== false);
    const recordedMoveDistance = unit.turnState().moveDistance() ?? 0;
    // Void Signature treats a unit that spent MP without leaving its hex as
    // having moved one hex. The selected non-stationary mode is the tracker’s
    // record that MP was spent when the hex distance itself remains zero.
    const targetMoveDistance = recordedMoveDistance === 0
        && unit.turnState().effectiveMoveMode() !== null
        && unit.turnState().effectiveMoveMode() !== 'stationary'
        ? 1
        : recordedMoveDistance;
    const hasBattleArmorMyomerBooster = inventory.some(entry => (
        entry.equipment?.flags.has('F_BA_EQUIPMENT') === true
        && entry.equipment.flags.has('F_MASC')
    ));

    const electronicStealth: TnStealthModifiers[] = [];
    const mimetic: TnStealthModifiers[] = [];
    const simpleCamo: TnStealthModifiers[] = [];
    const chameleon: TnStealthModifiers[] = [];
    const nullSignature: TnStealthModifiers[] = [];
    const voidSignature: TnStealthModifiers[] = [];

    for (const entry of inventory) {
        if (hasBattleArmorMyomerBooster
            && (isBattleArmorStealthEquipment(entry) || isMimeticArmorEquipment(entry))) continue;
        const profile = getStealthTnModifiersForEquipment(entry, targetMoveDistance);
        if (!profile) continue;
        if (isVoidSignatureEquipment(entry)) voidSignature.push(profile);
        else if (isMimeticArmorEquipment(entry)) mimetic.push(profile);
        else if (isSimpleCamoEquipment(entry)) simpleCamo.push(profile);
        else if (isChameleonShieldEquipment(entry)) chameleon.push(profile);
        else if (isNullSignatureEquipment(entry)) nullSignature.push(profile);
        else electronicStealth.push(profile);
    }

    // Void Signature does not combine with Stealth Armor or Null Signature.
    const voidProfile = maxProfiles(voidSignature);
    if (voidProfile) return voidProfile;

    const mimeticProfile = maxProfiles(mimetic);
    const armorProfile = mimeticProfile ?? addProfiles(
        maxProfiles(electronicStealth),
        maxProfiles(simpleCamo),
    );
    const signatureProfile = addProfiles(maxProfiles(chameleon), maxProfiles(nullSignature));
    if (!armorProfile) return signatureProfile;
    if (!signatureProfile) return armorProfile;
    return combineProfiles(armorProfile, signatureProfile, Math.max);
}
