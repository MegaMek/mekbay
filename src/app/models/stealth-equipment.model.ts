// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ECMMode } from './common.model';
import { isEcmEquipment } from './ecm-mode.model';
import { isBattleArmorMyomerBoosterEquipment } from './escalating-equipment.model';
import type { Equipment } from './equipment.model';
import type { ComponentId } from './entity/entity-identifiers';
import {
    getVisualCamoTnModifiers,
    TN_CHAMELEON_MODIFIERS,
    TN_NULL_SIGNATURE_MODIFIERS,
    TN_STANDARD_STEALTH_MODIFIERS,
    type TnRangeModifiers,
    type TnStealthModifiers,
} from './target-number-calculator.model';

/** Exact catalog definition plus the sparse runtime facts that can change its effect. */
export interface StealthEquipmentFacts {
    readonly componentId: ComponentId;
    readonly equipment: Equipment;
    readonly mode?: string;
    /** Exact four-state lifecycle for switchable signature systems. */
    readonly state?: StealthState;
    readonly operational: boolean;
}

export type StealthState = 'disabled' | 'enabling' | 'enabled' | 'disabling';

export const STEALTH_FLAG = 'F_STEALTH' as const;
export const VISUAL_CAMO_FLAG = 'F_VISUAL_CAMO' as const;
export const CHAMELEON_SHIELD_FLAG = 'F_CHAMELEON_SHIELD' as const;
export const NULL_SIGNATURE_FLAG = 'F_NULL_SIG' as const;
export const VOID_SIGNATURE_FLAG = 'F_VOID_SIG' as const;
export const SIGNATURE_SYSTEM_HEAT = 10;
export const CHAMELEON_SHIELD_HEAT = 6;
export const SIGNATURE_SYSTEM_TMM_BONUS = 2;

/** Internal sparse mode values used only while an End Turn transition is pending. */
export const STEALTH_ENABLING_MODE = 'Enabling';
export const STEALTH_DISABLING_MODE = 'Disabling';

const ZERO_RANGE_MODIFIERS: TnRangeModifiers = { short: 0, medium: 0, long: 0 };
const BA_STEALTH_ARMOR_TYPES = new Set([
    'BA_STEALTH_BASIC',
    'BA_STEALTH',
    'BA_STEALTH_PROTOTYPE',
    'BA_STEALTH_IMP',
]);
const STEALTH_ECM_MODES = new Set<string>([
    ECMMode.ECM,
    ECMMode.ECM_ECCM,
    ECMMode.ECM_GHOST,
]);

function armorType(equipment: Equipment): string | undefined {
    return equipment.type === 'armor' && 'armorType' in equipment
        ? String(equipment.armorType)
        : undefined;
}

/** Any catalog definition carrying the shared stealth marker. */
export function hasStealthFlag(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(STEALTH_FLAG) === true;
}

/** Electronic Stealth Armor, excluding visual camouflage that also carries F_STEALTH. */
export function isStealthEquipment(equipment: Equipment | null | undefined): boolean {
    return hasStealthFlag(equipment) && !equipment!.hasFlag(VISUAL_CAMO_FLAG);
}

export function isVisualCamoEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(VISUAL_CAMO_FLAG) === true;
}

export function isMimeticArmorEquipment(equipment: Equipment): boolean {
    return isVisualCamoEquipment(equipment) && armorType(equipment) === 'BA_MIMETIC';
}

export function isSimpleCamoEquipment(equipment: Equipment): boolean {
    return isVisualCamoEquipment(equipment) && !isMimeticArmorEquipment(equipment);
}

export function isBattleArmorStealthEquipment(equipment: Equipment): boolean {
    const type = armorType(equipment);
    return isStealthEquipment(equipment) && type !== undefined && BA_STEALTH_ARMOR_TYPES.has(type);
}

export function isChameleonShieldEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(CHAMELEON_SHIELD_FLAG) === true;
}

export function isNullSignatureEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(NULL_SIGNATURE_FLAG) === true;
}

export function isVoidSignatureEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(VOID_SIGNATURE_FLAG) === true;
}

export function isStealthSystemEquipment(equipment: Equipment): boolean {
    return isStealthEquipment(equipment)
        || isVisualCamoEquipment(equipment)
        || isChameleonShieldEquipment(equipment)
        || isNullSignatureEquipment(equipment)
        || isVoidSignatureEquipment(equipment);
}

export function isSignatureSystemEquipment(equipment: Equipment | null | undefined): boolean {
    return isStealthEquipment(equipment)
        || isNullSignatureEquipment(equipment)
        || isVoidSignatureEquipment(equipment);
}

export function isInteractiveStealthFlags(flags: ReadonlySet<string>): boolean {
    return flags.has(STEALTH_FLAG)
        || flags.has(VISUAL_CAMO_FLAG)
        || flags.has(CHAMELEON_SHIELD_FLAG)
        || flags.has(NULL_SIGNATURE_FLAG)
        || flags.has(VOID_SIGNATURE_FLAG);
}

export function stealthFlagsRequireEcm(flags: ReadonlySet<string>): boolean {
    return flags.has(VOID_SIGNATURE_FLAG)
        || flags.has(STEALTH_FLAG) && !flags.has(VISUAL_CAMO_FLAG);
}

export function signatureSystemOperatingHeat(equipment: Equipment | null | undefined): number {
    if (isNullSignatureEquipment(equipment) || isVoidSignatureEquipment(equipment)) {
        return SIGNATURE_SYSTEM_HEAT;
    }
    return isChameleonShieldEquipment(equipment) ? CHAMELEON_SHIELD_HEAT : 0;
}

export function stealthAlphaStrikeAbilities(
    equipment: Equipment | null | undefined,
): readonly ('STL' | 'MAS')[] {
    const abilities: ('STL' | 'MAS')[] = [];
    if (isNullSignatureEquipment(equipment) || isChameleonShieldEquipment(equipment)) {
        abilities.push('STL');
    }
    if (isVoidSignatureEquipment(equipment)) abilities.push('MAS');
    return Object.freeze(abilities);
}

export function adjustedStealthTmm(
    baseTmm: number,
    facts: Readonly<{
        armorStealth: boolean;
        nullSignature: boolean;
        chameleonShield: boolean;
        voidSignature: boolean;
    }>,
): number {
    let tmm = baseTmm;
    if (facts.armorStealth || facts.nullSignature) tmm += SIGNATURE_SYSTEM_TMM_BONUS;
    if (facts.chameleonShield) tmm += SIGNATURE_SYSTEM_TMM_BONUS;
    if (facts.voidSignature) tmm = tmm < 3 ? 3 : tmm === 3 ? 4 : tmm;
    return tmm;
}

export function signatureHeatEfficiencyPenalty(facts: Readonly<{
    stealthArmor: boolean;
    chameleonShield: boolean;
    nullSignature: boolean;
    voidSignature: boolean;
}>): number {
    return (facts.stealthArmor ? SIGNATURE_SYSTEM_HEAT : 0)
        + (facts.chameleonShield ? CHAMELEON_SHIELD_HEAT : 0)
        + (facts.nullSignature || facts.voidSignature ? SIGNATURE_SYSTEM_HEAT : 0);
}

export function alphaStrikeSignatureHeat(signature: boolean, chameleonShield: boolean): number {
    return (signature ? SIGNATURE_SYSTEM_HEAT : 0)
        + (chameleonShield ? CHAMELEON_SHIELD_HEAT : 0);
}

export function isSwitchableStealthEquipment(equipment: Equipment): boolean {
    return equipment.modes.some(mode => mode.toLowerCase() === 'off')
        && equipment.modes.some(mode => mode.toLowerCase() === 'on');
}

export function stealthStateForMode(
    equipment: Equipment,
    mode: string | undefined,
): StealthState {
    if (!isSwitchableStealthEquipment(equipment)) return 'enabled';
    if (mode === STEALTH_ENABLING_MODE) return 'enabling';
    if (mode === STEALTH_DISABLING_MODE) return 'disabling';
    return mode?.toLowerCase() === 'on' ? 'enabled' : 'disabled';
}

export function nextStealthState(state: StealthState): StealthState {
    switch (state) {
        case 'disabled': return 'enabling';
        case 'enabling': return 'disabled';
        case 'enabled': return 'disabling';
        case 'disabling': return 'enabled';
    }
}

export function stealthStateIsActive(state: StealthState): boolean {
    return state === 'enabled' || state === 'disabling';
}

function isActive(facts: StealthEquipmentFacts): boolean {
    if (!facts.operational) return false;
    if (!isSwitchableStealthEquipment(facts.equipment)) return true;
    return stealthStateIsActive(facts.state ?? stealthStateForMode(facts.equipment, facts.mode));
}

/** Only ECM-bearing modes power switchable Stealth Armor. */
export function ecmModeSupportsStealth(mode: string | undefined): boolean {
    return STEALTH_ECM_MODES.has(mode ?? ECMMode.ECM);
}

export function hasFunctionalEcmForStealth(equipment: readonly StealthEquipmentFacts[]): boolean {
    return equipment.some(entry => entry.operational
        && isEcmEquipment(entry.equipment)
        && ecmModeSupportsStealth(entry.mode));
}

function isFunctioning(
    facts: StealthEquipmentFacts,
    functionalEcm: boolean,
): boolean {
    if (!isActive(facts)) return false;
    if (isVoidSignatureEquipment(facts.equipment)) return functionalEcm;
    if (!isStealthEquipment(facts.equipment)) return false;
    return !isSwitchableStealthEquipment(facts.equipment) || functionalEcm;
}

/** Active switchable Stealth Armor cuts C3; Chameleon LPS does not. */
export function unitHasActiveC3DisruptingStealth(
    equipment: readonly StealthEquipmentFacts[],
    unitUnavailable = false,
): boolean {
    if (unitUnavailable) return false;
    const functionalEcm = hasFunctionalEcmForStealth(equipment);
    return equipment.some(entry => isSwitchableStealthEquipment(entry.equipment)
        && isFunctioning(entry, functionalEcm));
}

/** Void Signature penalizes every weapon attack made by its carrying unit. */
export function unitHasActiveVoidSignature(
    equipment: readonly StealthEquipmentFacts[],
    unitUnavailable = false,
): boolean {
    if (unitUnavailable) return false;
    const functionalEcm = hasFunctionalEcmForStealth(equipment);
    return equipment.some(entry => isVoidSignatureEquipment(entry.equipment)
        && isFunctioning(entry, functionalEcm));
}

/** Active heat-producing signature-system component ids. */
export function activeStealthHeatComponents(
    equipment: readonly StealthEquipmentFacts[],
    unitUnavailable = false,
): ReadonlySet<ComponentId> {
    if (unitUnavailable) return new Set<ComponentId>();
    const functionalEcm = hasFunctionalEcmForStealth(equipment);
    return new Set(equipment.flatMap(entry => {
        if (!isSwitchableStealthEquipment(entry.equipment) || !isActive(entry)) return [];
        if ((isStealthEquipment(entry.equipment) || isVoidSignatureEquipment(entry.equipment))
            && !isFunctioning(entry, functionalEcm)) return [];
        return isStealthSystemEquipment(entry.equipment) ? [entry.componentId] : [];
    }));
}

function infantryIgnoredProfile(short: number, medium: number, long: number): TnStealthModifiers {
    return { short, medium, long, conventionalInfantry: ZERO_RANGE_MODIFIERS };
}

function profileForEquipment(
    facts: StealthEquipmentFacts,
    targetMoveDistance: number,
    functionalEcm: boolean,
): TnStealthModifiers | null {
    const equipment = facts.equipment;
    if (!isActive(facts)) return null;
    if (isVoidSignatureEquipment(equipment)) {
        if (!isFunctioning(facts, functionalEcm)) return null;
        const modifier = targetMoveDistance > 5 ? 0
            : targetMoveDistance > 2 ? 1
                : targetMoveDistance > 0 ? 2 : 3;
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
    if (isChameleonShieldEquipment(equipment)) return TN_CHAMELEON_MODIFIERS;
    if (isNullSignatureEquipment(equipment)) return TN_NULL_SIGNATURE_MODIFIERS;
    if (isMimeticArmorEquipment(equipment)) {
        return getVisualCamoTnModifiers('mimetic', targetMoveDistance);
    }
    if (isSimpleCamoEquipment(equipment)) {
        return getVisualCamoTnModifiers('simple-camo', targetMoveDistance);
    }
    if (!isFunctioning(facts, functionalEcm)) return null;

    switch (armorType(equipment)) {
        case 'BA_STEALTH_BASIC':
        case 'BA_STEALTH_PROTOTYPE':
            return infantryIgnoredProfile(0, 1, 2);
        case 'BA_STEALTH':
            return infantryIgnoredProfile(1, 1, 2);
        case 'BA_STEALTH_IMP':
            return infantryIgnoredProfile(1, 2, 3);
        default:
            return TN_STANDARD_STEALTH_MODIFIERS;
    }
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

/** One compact profile for the unit's effective Entity equipment plus sparse runtime state. */
export function getActiveStealthTnModifiers(
    equipment: readonly StealthEquipmentFacts[],
    targetMoveDistance = 0,
    unitUnavailable = false,
): TnStealthModifiers | undefined {
    if (unitUnavailable) return undefined;
    const operational = equipment.filter(entry => entry.operational);
    const functionalEcm = hasFunctionalEcmForStealth(operational);
    const hasBattleArmorMyomerBooster = operational.some(entry => (
        isBattleArmorMyomerBoosterEquipment(entry.equipment)
    ));

    const electronicStealth: TnStealthModifiers[] = [];
    const mimetic: TnStealthModifiers[] = [];
    const simpleCamo: TnStealthModifiers[] = [];
    const chameleon: TnStealthModifiers[] = [];
    const nullSignature: TnStealthModifiers[] = [];
    const voidSignature: TnStealthModifiers[] = [];

    for (const entry of operational) {
        if (hasBattleArmorMyomerBooster
            && (isBattleArmorStealthEquipment(entry.equipment)
                || isMimeticArmorEquipment(entry.equipment))) continue;
        const profile = profileForEquipment(entry, targetMoveDistance, functionalEcm);
        if (!profile) continue;
        if (isVoidSignatureEquipment(entry.equipment)) voidSignature.push(profile);
        else if (isMimeticArmorEquipment(entry.equipment)) mimetic.push(profile);
        else if (isSimpleCamoEquipment(entry.equipment)) simpleCamo.push(profile);
        else if (isChameleonShieldEquipment(entry.equipment)) chameleon.push(profile);
        else if (isNullSignatureEquipment(entry.equipment)) nullSignature.push(profile);
        else electronicStealth.push(profile);
    }

    // Void Signature replaces, rather than combines with, other signature protection.
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
