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
import type { UnitHeight } from './units.model';

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

export interface TnTargetNumberCalculatorState {
    isAirborne?: boolean;
    targetMovementBracket?: TnTargetMovementBracketId | null;
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
    largeTarget?: boolean;
    spotterMoveMode?: TnSpotterMoveMode;
    spotterDeclaredAttacks?: boolean;
    narcAboveWater?: boolean;
    narcUnderwater?: boolean;
    tagged?: boolean;
}

export interface TnTargetNumberCalculationInput extends TnTargetNumberCalculatorState {
    unitType?: TnTargetUnitType;
    range?: number;
    indirectFireBaseModifier?: number;
}

export interface TnTargetModifierBreakdownEntry {
    label: string;
    modifier: number;
    partialCoverSource?: 'manual' | 'water' | 'building';
    guidanceAdjustment?: 'movement' | 'terrain' | 'partial-cover';
    ignoredByNarcGuidance?: boolean;
    ignoredBySemiGuidedGuidance?: boolean;
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

export function isTerrainTargetType(unitType: TnTargetUnitType | null | undefined): boolean {
    return unitType === 'terrain';
}

export function resolveTnTargetWaterState(
    input: Pick<TnTargetNumberCalculatorState, 'waterDepth' | 'largeTarget' | 'prone'> & { unitType?: TnTargetUnitType },
): UnitWaterState {
    return resolveUnitWaterState(
        input.waterDepth,
        resolveTnTargetHeight(input),
    );
}

export function resolveTnTargetBuildingCoverState(
    input: Pick<TnTargetNumberCalculatorState, 'buildingCover' | 'largeTarget' | 'prone'> & { unitType?: TnTargetUnitType },
): UnitBuildingCoverState {
    return resolveUnitBuildingCoverState(
        input.buildingCover,
        resolveTnTargetHeight(input),
    );
}

function resolveTnTargetHeight(
    input: Pick<TnTargetNumberCalculatorState, 'largeTarget' | 'prone'> & { unitType?: TnTargetUnitType },
): UnitHeight {
    const isMek = input.unitType?.startsWith('mek-') === true;
    const standingHeight: UnitHeight = !isMek ? 1 : input.largeTarget === true ? 3 : 2;
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

export function getIndirectFireModifier(indirectFire: boolean | null | undefined, spotterMoveMode: TnSpotterMoveMode | null | undefined, spotterDeclaredAttacks: boolean | null | undefined, baseModifier = 1): number {
    if (!indirectFire) return 0;
    return baseModifier
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

export function calculateTargetTnModifierBreakdown(
    input: TnTargetNumberCalculationInput,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES
): TnTargetModifierBreakdownEntry[] {
    const range = Math.max(0, input.range ?? 0);
    const staticTarget = isStaticTargetType(input.unitType);
    const prone = input.prone ?? false;
    const waterState = resolveTnTargetWaterState(input);
    const buildingCoverState = resolveTnTargetBuildingCoverState(input);
    const immobile = input.immobile ?? (staticTarget && input.prone === undefined);
    const terrainTarget = isTerrainTargetType(input.unitType);
    const breakdown: TnTargetModifierBreakdownEntry[] = [];
    const add = (
        label: string,
        modifier: number,
        metadata: Omit<TnTargetModifierBreakdownEntry, 'label' | 'modifier'> = {},
        includeZero = false,
    ) => {
        if (modifier !== 0 || includeZero) {
            breakdown.push({ label, modifier, ...metadata });
        }
    };

    add('Battle Armor', getTargetUnitTypeModifier(input.unitType));
    if (!staticTarget) {
        add('Airborne', getTargetAirborneModifier(input.isAirborne));
        const movementBracket = TN_TARGET_MOVEMENT_BRACKETS.find(bracket => bracket.id === input.targetMovementBracket);
        if (movementBracket) add(`Moved ${movementBracket.label}`, movementBracket.modifier, { guidanceAdjustment: 'movement' });
        add('Skidding', gameRules.supportsSkidding && input.skidding ? TN_SKIDDING_MODIFIER : 0);
    }
    add(range <= ADJACENT_RANGE ? 'Prone (adjacent)' : 'Prone', !staticTarget && prone ? getTargetProneModifier(range) : 0);
    add('Immobile', immobile ? TN_IMMOBILE : 0);
    add('Intervening Woods', getInterveningWoodsModifier(input.interveningWoods), {
        guidanceAdjustment: 'terrain',
        ignoredByNarcGuidance: true,
        ignoredBySemiGuidedGuidance: true,
    });
    if (!terrainTarget && !input.waterDepth && !input.buildingCover) {
        const coverModifier = getTargetHexCoverModifier(input.targetHexCover);
        add(input.targetHexCover === 'heavy' ? 'Heavy Cover' : 'Light Cover', coverModifier, {
            guidanceAdjustment: 'terrain',
            ignoredBySemiGuidedGuidance: true,
        });
    }
    add('Heavy Cover (building)', !staticTarget && buildingCoverState.effect === 'heavy'
        ? buildingCoverState.modifier
        : 0);
    const specialPartialCover = waterState.partiallyUnderwater || buildingCoverState.effect === 'partial';
    const partialCoverModifier = !staticTarget
        && (specialPartialCover || (!input.waterDepth && !input.buildingCover
            && !prone && !input.indirectFire && input.partialCover && range > ADJACENT_RANGE))
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
    add(partialCoverLabel, partialCoverModifier, {
        partialCoverSource,
        ...(partialCoverSource === 'manual' && { guidanceAdjustment: 'partial-cover' }),
    });
    add('Secondary Target', input.secondaryTarget ? TN_SECONDARY_TARGET_MODIFIER : 0);
    add('Secondary Target (side/back)', gameRules.supportsSecondaryTargetSideBack && !input.secondaryTarget && input.secondaryTargetSideBack
        ? TN_SECONDARY_TARGET_SIDE_BACK_MODIFIER : 0);
    add('Large Target', gameRules.supportsLargeTarget && input.largeTarget ? TN_LARGE_TARGET_MODIFIER : 0);

    if (input.indirectFire) {
        add('Indirect Fire', input.indirectFireBaseModifier ?? 1, {}, true);
        const spotterMovementModifier = getDefaultAttackerMovementModifier(input.spotterMoveMode ?? 'stationary');
        const spotterMoveLabel = input.spotterMoveMode
            ? `Spotter Moved (${input.spotterMoveMode[0].toUpperCase()}${input.spotterMoveMode.slice(1)})`
            : 'Spotter Movement';
        const ignoredSpotterModifier = {
            ignoredByNarcGuidance: true,
            ignoredBySemiGuidedGuidance: true,
        } as const;
        add(spotterMoveLabel, spotterMovementModifier, ignoredSpotterModifier);
        add('Spotter Declared Attack', input.spotterDeclaredAttacks ? 1 : 0, ignoredSpotterModifier);
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
