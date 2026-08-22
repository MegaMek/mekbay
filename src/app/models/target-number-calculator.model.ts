// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MotiveModes } from './motiveModes.model';
import { CORE_2026_GAME_RULES, type CBTGameRules } from './rules/game-rules';
import {
    resolveUnitBuildingCoverState,
    resolveUnitWaterState,
    type UnitBuildingCoverState,
    type UnitBuildingLevel,
    type UnitWaterDepth,
    type UnitWaterState,
} from './unit-cover.model';
import type { UnitHeight } from './unit-summary.model';

export const TN_SKIDDING_MODIFIER = 2;
export const TN_BATTLE_ARMOR_MODIFIER = 1;
export const TN_AIRBORNE_MOVE_TYPE_MODIFIER = 1;
export const TN_PARTIAL_COVER_MODIFIER = 1;
export const TN_SECONDARY_TARGET_MODIFIER = 1;
export const TN_SECONDARY_TARGET_SIDE_BACK_MODIFIER = 2;
export const TN_LARGE_TARGET_MODIFIER = -1;
export const TN_PRONE_ADJACENT = -2;
export const TN_PRONE = 1;
export const TN_IMMOBILE = -4;
export const TN_INDIRECT_FIRE_MODIFIER = 1;
export const TN_CUSTOM_MODIFIER_MIN = -9;
export const TN_CUSTOM_MODIFIER_MAX = 9;

export const TN_PRONE_ATTACKER = 2;
export const TN_SKIDDING_ATTACKER = 1;

export const ADJACENT_RANGE = 1;

export type TnTargetUnitType =
    | 'mek-biped'
    | 'mek-quad'
    | 'mek-tripod'
    | 'battle-armor'
    | 'vehicle'
    | 'vtol'
    | 'infantry'
    | 'protoMek'
    | 'aero'
    | 'terrain'
    | 'building';

export interface TnTargetUnitTypeOption {
    value: TnTargetUnitType;
    label: string;
}

export const TN_TARGET_UNIT_TYPE_OPTIONS: readonly TnTargetUnitTypeOption[] = [
    { value: 'mek-biped', label: 'Mek (Biped)' },
    { value: 'mek-quad', label: 'Mek (Quad)' },
    { value: 'mek-tripod', label: 'Mek (Tripod)' },
    { value: 'battle-armor', label: 'Battle Armor' },
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'vtol', label: 'VTOL' },
    { value: 'infantry', label: 'Infantry' },
    { value: 'protoMek', label: 'ProtoMek' },
    { value: 'aero', label: 'Aero' },
    { value: 'terrain', label: 'Terrain' },
    { value: 'building', label: 'Building' },
] as const;

const TN_LARGE_TARGET_INELIGIBLE_UNIT_TYPES = new Set<TnTargetUnitType>([
    'battle-armor',
    'infantry',
    'protoMek',
]);

/**
 * Whether the selected target kind can be Large. Aero remains eligible for Large Support aircraft,
 * while terrain and buildings can be designated Large by a mission. Unknown legacy types remain eligible.
 */
export function canTnTargetTypeBeLarge(unitType: TnTargetUnitType | null | undefined): boolean {
    return unitType === null
        || unitType === undefined
        || !TN_LARGE_TARGET_INELIGIBLE_UNIT_TYPES.has(unitType);
}

/**
 * Whether a Large target receives its to-hit modifier in the current state.
 *
 * The calculator's single Jumped/Airborne flag represents two different TW states. Jumping Meks
 * and airborne non-aerospace units still retain the Large Support/Superheavy modifier; MegaMek's
 * `Entity.isAirborne()` exclusion applies to airborne aerospace targets.
 */
export function canApplyTnLargeTargetModifier(
    unitType: TnTargetUnitType | null | undefined,
    isAirborne: boolean | null | undefined,
): boolean {
    return canTnTargetTypeBeLarge(unitType)
        && !(unitType === 'aero' && isAirborne === true);
}

export type TnTargetMovementBracketId = '0-2' | '3-4' | '5-6' | '7-9' | '10-17' | '18-24' | '25+';

export interface TnTargetMovementBracket {
    id: TnTargetMovementBracketId;
    label: string;
    min: number;
    max: number | null;
    modifier: number;
}

export const TN_TARGET_MOVEMENT_BRACKETS: readonly TnTargetMovementBracket[] = [
    { id: '0-2', label: '0-2', min: 0, max: 2, modifier: 0 },
    { id: '3-4', label: '3-4', min: 3, max: 4, modifier: 1 },
    { id: '5-6', label: '5-6', min: 5, max: 6, modifier: 2 },
    { id: '7-9', label: '7-9', min: 7, max: 9, modifier: 3 },
    { id: '10-17', label: '10-17', min: 10, max: 17, modifier: 4 },
    { id: '18-24', label: '18-24', min: 18, max: 24, modifier: 5 },
    { id: '25+', label: '25+', min: 25, max: null, modifier: 6 },
] as const;

export type TnInterveningWoods = 'none' | 'light1' | 'light2';
export type TnTargetHexCover = 'none' | 'light' | 'heavy';
export type TnAttackDirection = 'front' | 'left' | 'rear' | 'right';
export type TnSpotterMoveMode = 'stationary' | 'walk' | 'run' | 'jump';
export type TnRangeBracket = 'short' | 'medium' | 'long' | 'extreme';

export interface TnRangeModifiers {
    readonly short: number;
    readonly medium: number;
    readonly long: number;
}

export interface TnStealthModifiers extends TnRangeModifiers {
    /** Active Mek/vehicle stealth armor cannot be selected as a secondary target. */
    readonly secondaryTargetRestricted?: boolean;
    /** Conventional infantry use this profile; when omitted, the normal profile applies. */
    readonly conventionalInfantry?: TnRangeModifiers;
}

export type TnStealthSystem =
    | 'stealth-armor'
    | 'null-signature'
    | 'chameleon'
    | 'chameleon-null'
    | 'ba-basic'
    | 'ba-standard'
    | 'ba-improved'
    | 'mimetic'
    | 'simple-camo';

export type TnVisualCamoSystem = Extract<TnStealthSystem, 'mimetic' | 'simple-camo'>;

/** Manual targets use `true`; linked units may supply their exact range profile. */
export type TnStealthState = boolean | TnStealthModifiers;

export const TN_STANDARD_STEALTH_MODIFIERS: TnStealthModifiers = {
    short: 0,
    medium: 1,
    long: 2,
    secondaryTargetRestricted: true,
    conventionalInfantry: { short: 0, medium: 0, long: 0 },
};

export const TN_NULL_SIGNATURE_MODIFIERS: TnStealthModifiers = {
    short: 0,
    medium: 1,
    long: 2,
    conventionalInfantry: { short: 0, medium: 0, long: 0 },
};

export const TN_CHAMELEON_MODIFIERS: TnStealthModifiers = {
    short: 0,
    medium: 1,
    long: 2,
};

export const TN_CHAMELEON_NULL_SIGNATURE_MODIFIERS: TnStealthModifiers = {
    short: 0,
    medium: 2,
    long: 4,
    conventionalInfantry: TN_CHAMELEON_MODIFIERS,
};

export function getVisualCamoTnModifiers(
    system: TnVisualCamoSystem,
    targetMoveDistance: number,
): TnStealthModifiers {
    const stationaryModifier = system === 'mimetic' ? 3 : 2;
    const modifier = Math.max(0, stationaryModifier - Math.max(0, targetMoveDistance));
    return { short: modifier, medium: modifier, long: modifier };
}

export interface TnTargetNumberCalculatorState {
    /** The target jumped or is airborne; applies the +1 target movement modifier. */
    isAirborne?: boolean;
    targetMovementBracket?: TnTargetMovementBracketId | null;
    /** Exact distance when known; manual input preserves 0/1/2 for movement-dependent camouflage. */
    targetMovementDistance?: number | null;
    skidding?: boolean;
    prone?: boolean;
    immobile?: boolean;
    interveningWoods?: TnInterveningWoods;
    targetHexCover?: TnTargetHexCover;
    partialCover?: boolean;
    waterDepth?: UnitWaterDepth;
    buildingCover?: UnitBuildingLevel;
    attackDirection?: TnAttackDirection;
    indirectFire?: boolean;
    secondaryTarget?: boolean;
    secondaryTargetSideBack?: boolean;
    /** Standing height used only for water/building geometry; prone posture is applied separately. */
    targetHeight?: UnitHeight;
    /** Applies the scenario/unit-size Large Target to-hit modifier. */
    largeTarget?: boolean;
    spotterMoveMode?: TnSpotterMoveMode;
    spotterDeclaredAttacks?: boolean;
    narcAboveWater?: boolean;
    narcUnderwater?: boolean;
    tagged?: boolean;
    ecmShielded?: boolean;
    /** Range-dependent protection supplied by an active stealth system. */
    stealth?: TnStealthState;
    /** Identifies the selected system when its profile changes with movement. */
    stealthSystem?: TnStealthSystem;
    /** Attacker-local delta for rules not represented by the calculator controls. */
    customModifier?: number;
}

export interface TnTargetNumberCalculationInput extends TnTargetNumberCalculatorState {
    unitType?: TnTargetUnitType;
    range?: number;
    /** Effective weapon bracket, after any C3 range adjustment. */
    rangeBracket?: TnRangeBracket;
    /** Conventional infantry ignore electronic stealth, but not visual camouflage or Chameleon LPS. */
    attackerIsConventionalInfantry?: boolean;
}

export type TnTargetModifierId =
    | 'battle-armor'
    | 'airborne'
    | 'target-movement'
    | 'skidding'
    | 'prone'
    | 'immobile'
    | 'intervening-woods'
    | 'target-hex-cover'
    | 'building-cover'
    | 'partial-cover'
    | 'secondary-target'
    | 'secondary-target-side-back'
    | 'large-target'
    | 'stealth'
    | 'custom'
    | 'indirect-fire'
    | 'spotter-movement'
    | 'spotter-declared-attack'
    | 'semi-guided'
    | 'narc';

export type TnTargetModifierAdjustmentGroup = 'target-movement' | 'terrain' | 'partial-cover';

export type TnTargetModifierGroupTotals = Readonly<Record<TnTargetModifierAdjustmentGroup, number>>;

export interface TnTargetModifierBreakdownEntry {
    id: TnTargetModifierId;
    label: string;
    modifier: number;
    targetHexCover?: Exclude<TnTargetHexCover, 'none'>;
    partialCoverSource?: 'manual' | 'water' | 'building';
    adjustmentGroup?: TnTargetModifierAdjustmentGroup;
    ignoredByNarcGuidance?: boolean;
    ignoredBySemiGuidedGuidance?: boolean;
}

/** Compiles semantic totals once so equipment handlers do not need to inspect display labels or rebuild target rules. */
export function getTnTargetModifierGroupTotals(
    breakdown: readonly TnTargetModifierBreakdownEntry[],
): TnTargetModifierGroupTotals {
    const totals: Record<TnTargetModifierAdjustmentGroup, number> = {
        'target-movement': 0,
        terrain: 0,
        'partial-cover': 0,
    };
    for (const modifier of breakdown) {
        if (modifier.adjustmentGroup) totals[modifier.adjustmentGroup] += modifier.modifier;
    }
    return totals;
}

export function getTargetMovementDistanceModifier(distance: number | null | undefined): number {
    const bracket = getTargetMovementBracketForDistance(distance ?? 0);
    return bracket?.modifier ?? 0;
}

export function getTargetMovementBracketForDistance(distance: number): TnTargetMovementBracket | null {
    return TN_TARGET_MOVEMENT_BRACKETS.find(bracket => distance >= bracket.min && (bracket.max === null || distance <= bracket.max)) ?? null;
}

export function getTargetMovementBracketModifier(bracketId: TnTargetMovementBracketId | null | undefined): number {
    return TN_TARGET_MOVEMENT_BRACKETS.find(bracket => bracket.id === bracketId)?.modifier ?? 0;
}

export function getTargetUnitTypeModifier(unitType: TnTargetUnitType | null | undefined): number {
    return unitType === 'battle-armor' ? TN_BATTLE_ARMOR_MODIFIER : 0;
}

export function isStaticTargetType(unitType: TnTargetUnitType | null | undefined): boolean {
    return unitType === 'terrain' || unitType === 'building';
}

export function isTnTargetImmobile(
    unitType: TnTargetUnitType | null | undefined,
    immobile: boolean | null | undefined,
): boolean {
    return isStaticTargetType(unitType) || immobile === true;
}

export function isTerrainTargetType(unitType: TnTargetUnitType | null | undefined): boolean {
    return unitType === 'terrain';
}

export function resolveTnTargetWaterState(
    input: Pick<TnTargetNumberCalculatorState, 'waterDepth' | 'targetHeight' | 'largeTarget' | 'prone'> & { unitType?: TnTargetUnitType },
): UnitWaterState {
    return resolveUnitWaterState(
        input.waterDepth,
        resolveTnTargetHeight(input),
    );
}

export function resolveTnTargetBuildingCoverState(
    input: Pick<TnTargetNumberCalculatorState, 'buildingCover' | 'targetHeight' | 'largeTarget' | 'prone'> & { unitType?: TnTargetUnitType },
): UnitBuildingCoverState {
    return resolveUnitBuildingCoverState(
        input.buildingCover,
        resolveTnTargetHeight(input),
    );
}

function resolveTnTargetHeight(
    input: Pick<TnTargetNumberCalculatorState, 'targetHeight' | 'largeTarget' | 'prone'> & { unitType?: TnTargetUnitType },
): UnitHeight {
    const isMek = input.unitType?.startsWith('mek-') === true;
    const standingHeight: UnitHeight = input.targetHeight ?? (isMek ? (input.largeTarget ? 3 : 2) : 1);
    return input.prone && standingHeight > 1
        ? (standingHeight - 1) as UnitHeight
        : standingHeight;
}

export function getTargetAirborneModifier(isAirborne: boolean | null | undefined): number {
    return isAirborne ? TN_AIRBORNE_MOVE_TYPE_MODIFIER : 0;
}

export function getTargetProneModifier(range: number): number {
    return range <= ADJACENT_RANGE ? TN_PRONE_ADJACENT : TN_PRONE;
}

export function getInterveningWoodsModifier(woods: TnInterveningWoods | null | undefined): number {
    switch (woods) {
        case 'light1': return 1;
        case 'light2': return 2;
        default: return 0;
    }
}

export function getTargetHexCoverModifier(cover: TnTargetHexCover | null | undefined): number {
    switch (cover) {
        case 'light': return 1;
        case 'heavy': return 2;
        default: return 0;
    }
}

export function getStealthTnModifier(
    stealth: TnStealthState | null | undefined,
    rangeBracket: TnRangeBracket | null | undefined,
    attackerIsConventionalInfantry = false,
): number {
    if (!stealth || !rangeBracket) return 0;
    const profile = stealth === true ? TN_STANDARD_STEALTH_MODIFIERS : stealth;
    const effectiveProfile = attackerIsConventionalInfantry
        ? profile.conventionalInfantry ?? profile
        : profile;
    const value = rangeBracket === 'extreme' ? effectiveProfile.long : effectiveProfile[rangeBracket];
    return Number.isFinite(value) ? value : 0;
}

export function stealthDisallowsSecondaryTarget(
    stealth: TnStealthState | null | undefined,
): boolean {
    return stealth === true
        || (!!stealth && typeof stealth === 'object' && stealth.secondaryTargetRestricted === true);
}

export function getIndirectFireModifier(indirectFire: boolean | null | undefined, spotterMoveMode: TnSpotterMoveMode | null | undefined, spotterDeclaredAttacks: boolean | null | undefined): number {
    if (!indirectFire) return 0;
    return TN_INDIRECT_FIRE_MODIFIER
        + getDefaultAttackerMovementModifier(spotterMoveMode ?? 'stationary')
        + (spotterDeclaredAttacks ? 1 : 0);
}

export function calculateTargetTnModifier(
    input: TnTargetNumberCalculationInput,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES
): number {
    return calculateTargetTnModifierBreakdown(input, gameRules)
        .reduce((total, entry) => total + entry.modifier, 0);
}

export function normalizeTargetCustomModifier(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(TN_CUSTOM_MODIFIER_MIN, Math.min(TN_CUSTOM_MODIFIER_MAX, Math.round(value!)));
}

export function calculateTargetTnModifierBreakdown(
    input: TnTargetNumberCalculationInput,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES
): TnTargetModifierBreakdownEntry[] {
    const range = Math.max(0, input.range ?? 0);
    const staticTarget = isStaticTargetType(input.unitType);
    const prone = input.prone ?? false;
    const waterState = resolveTnTargetWaterState(input);
    const buildingCoverState = resolveTnTargetBuildingCoverState(input);
    const immobile = isTnTargetImmobile(input.unitType, input.immobile);
    const terrainTarget = isTerrainTargetType(input.unitType);
    const aerospaceTarget = input.unitType === 'aero';
    const breakdown: TnTargetModifierBreakdownEntry[] = [];
    const add = (
        id: TnTargetModifierId,
        label: string,
        modifier: number,
        metadata: Omit<TnTargetModifierBreakdownEntry, 'id' | 'label' | 'modifier'> = {},
        includeZero = false,
    ) => {
        if (modifier !== 0 || includeZero) {
            breakdown.push({ id, label, modifier, ...metadata });
        }
    };

    add('battle-armor', 'Battle Armor', getTargetUnitTypeModifier(input.unitType));
    if (!staticTarget && !aerospaceTarget) {
        add('airborne', 'Airborne', getTargetAirborneModifier(input.isAirborne), { adjustmentGroup: 'target-movement' });
        const movementBracket = TN_TARGET_MOVEMENT_BRACKETS.find(bracket => bracket.id === input.targetMovementBracket);
        if (movementBracket) add('target-movement', `Moved ${movementBracket.label}`, movementBracket.modifier, { adjustmentGroup: 'target-movement' });
        add('skidding', 'Skidding', gameRules.supportsSkidding && input.skidding ? TN_SKIDDING_MODIFIER : 0, { adjustmentGroup: 'target-movement' });
    }
    add('prone', range <= ADJACENT_RANGE ? 'Prone (adjacent)' : 'Prone', !staticTarget && prone ? getTargetProneModifier(range) : 0);
    add('immobile', 'Immobile', immobile ? TN_IMMOBILE : 0);
    add('intervening-woods', 'Intervening Woods', getInterveningWoodsModifier(input.interveningWoods), {
        adjustmentGroup: 'terrain',
        ignoredByNarcGuidance: true,
        ignoredBySemiGuidedGuidance: true,
    });
    if (!terrainTarget && !input.waterDepth && !input.buildingCover) {
        const targetHexCover = input.targetHexCover === 'light' || input.targetHexCover === 'heavy'
            ? input.targetHexCover
            : null;
        if (targetHexCover) {
            add('target-hex-cover', targetHexCover === 'heavy' ? 'Heavy Cover' : 'Light Cover', getTargetHexCoverModifier(targetHexCover), {
                targetHexCover,
                adjustmentGroup: 'terrain',
                ...(gameRules.narcIndirectFireIgnoresAllTerrain && { ignoredByNarcGuidance: true }),
                ignoredBySemiGuidedGuidance: true,
            });
        }
    }
    add('building-cover', 'Heavy Cover (building)', !staticTarget && buildingCoverState.effect === 'heavy'
        ? buildingCoverState.modifier
        : 0, {
            adjustmentGroup: 'terrain',
            ...(gameRules.narcIndirectFireIgnoresAllTerrain && { ignoredByNarcGuidance: true }),
            ignoredBySemiGuidedGuidance: true,
        });
    const specialPartialCover = waterState.partiallyUnderwater || buildingCoverState.effect === 'partial';
    const ordinaryPartialCoverAllowed = input.indirectFire
        ? gameRules.indirectFireUsesSpotterPartialCover
        : range > ADJACENT_RANGE;
    const ordinaryPartialCover = !input.waterDepth
        && !input.buildingCover
        && !prone
        && input.partialCover
        && ordinaryPartialCoverAllowed;
    const partialCoverModifier = !staticTarget
        && (specialPartialCover || ordinaryPartialCover)
        ? TN_PARTIAL_COVER_MODIFIER
        : 0;
    const partialCoverSource = waterState.partiallyUnderwater
        ? 'water'
        : buildingCoverState.effect === 'partial'
            ? 'building'
            : 'manual';
    const partialCoverLabel = {
        manual: 'Partial Cover',
        water: 'Partial Cover (water)',
        building: 'Partial Cover (building)',
    }[partialCoverSource];
    add('partial-cover', partialCoverLabel, partialCoverModifier, {
        partialCoverSource,
        adjustmentGroup: partialCoverSource === 'manual' ? 'partial-cover' : 'terrain',
        ...(gameRules.narcIndirectFireIgnoresAllTerrain && { ignoredByNarcGuidance: true }),
        ignoredBySemiGuidedGuidance: true,
    });
    add('secondary-target', 'Secondary Target', input.secondaryTarget ? TN_SECONDARY_TARGET_MODIFIER : 0);
    add('secondary-target-side-back', 'Secondary Target (side/back)', gameRules.supportsSecondaryTargetSideBack && !input.secondaryTarget && input.secondaryTargetSideBack
        ? TN_SECONDARY_TARGET_SIDE_BACK_MODIFIER : 0);
    add('large-target', 'Large Target', input.largeTarget
        && canApplyTnLargeTargetModifier(input.unitType, input.isAirborne)
        ? TN_LARGE_TARGET_MODIFIER
        : 0);
    add('stealth', 'Stealth', getStealthTnModifier(
        input.stealth,
        input.rangeBracket,
        input.attackerIsConventionalInfantry,
    ));
    add('custom', 'Custom', normalizeTargetCustomModifier(input.customModifier));

    if (input.indirectFire) {
        add('indirect-fire', 'Indirect Fire', TN_INDIRECT_FIRE_MODIFIER, {}, true);
        const spotterMovementModifier = getDefaultAttackerMovementModifier(input.spotterMoveMode ?? 'stationary');
        const spotterMoveLabel = input.spotterMoveMode
            ? `Spotter Moved (${input.spotterMoveMode[0].toUpperCase()}${input.spotterMoveMode.slice(1)})`
            : 'Spotter Movement';
        const ignoredSpotterModifier = {
            ignoredByNarcGuidance: true,
            ignoredBySemiGuidedGuidance: true,
        } as const;
        add('spotter-movement', spotterMoveLabel, spotterMovementModifier, ignoredSpotterModifier);
        add('spotter-declared-attack', 'Spotter Declared Attack', input.spotterDeclaredAttacks ? 1 : 0, ignoredSpotterModifier);
    }

    return breakdown;
}

export function getDefaultAttackerMovementModifier(moveMode: MotiveModes | null | undefined): number {
    switch (moveMode) {
        case 'walk': return 1;
        case 'run': return 2;
        case 'jump':
        case 'UMU': return 3;
        default: return 0;
    }
}
