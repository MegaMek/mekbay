/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { MotiveModes } from './motiveModes.model';
import type { MoveType } from './units.model';

export const TN_JUMPED_MODIFIER = 1;
export const TN_SKIDDING_MODIFIER = 2;
export const TN_BATTLE_ARMOR_MODIFIER = 1;
export const TN_AIRBORNE_MOVE_TYPE_MODIFIER = 1;
export const TN_PARTIAL_COVER_MODIFIER = 1;
export const TN_HEAD_LOCATION_MODIFIER = 7;

export type TnTargetUnitType =
    | 'mek-biped'
    | 'mek-quad'
    | 'mek-tripod'
    | 'battle-armor'
    | 'vehicle'
    | 'vtol'
    | 'infantry'
    | 'protoMek'
    | 'aero';

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

export const TN_TARGET_MOVE_TYPE_OPTIONS: readonly { value: MoveType | ''; label: string }[] = [
    { value: '', label: 'None' },
    { value: 'Biped', label: 'Biped' },
    { value: 'Quad', label: 'Quad' },
    { value: 'Tripod', label: 'Tripod' },
    { value: 'Tracked', label: 'Tracked' },
    { value: 'Wheeled', label: 'Wheeled' },
    { value: 'Hover', label: 'Hover' },
    { value: 'VTOL', label: 'VTOL' },
    { value: 'WiGE', label: 'WiGE' },
    { value: 'Jump', label: 'Jump' },
    { value: 'UMU', label: 'UMU' },
    { value: 'Naval', label: 'Naval' },
] as const;

export type TnTargetStance = 'none' | 'prone' | 'immobile';
export type TnInterveningWoods = 'none' | 'light1' | 'light2' | 'heavy1';
export type TnTargetHexCover = 'none' | 'light' | 'heavy';
export type TnAttackDirection = 'front' | 'left' | 'rear' | 'right';
export type TnTargetLocation = string;
export type TnSpotterMoveMode = 'stationary' | 'walk' | 'run' | 'jump';

export interface TnTargetNumberCalculatorState {
    targetMoveType?: MoveType | null;
    targetMovementBracket?: TnTargetMovementBracketId | null;
    jumped?: boolean;
    skidding?: boolean;
    stance?: TnTargetStance;
    interveningWoods?: TnInterveningWoods;
    targetHexCover?: TnTargetHexCover;
    partialCover?: boolean;
    attackDirection?: TnAttackDirection;
    targetLocation?: TnTargetLocation | null;
}

export interface TnTargetNumberCalculationInput extends TnTargetNumberCalculatorState {
    unitType?: TnTargetUnitType;
    range?: number;
}

export interface TnTargetLocationOption {
    value: TnTargetLocation;
    label: string;
}

const DEFAULT_TARGET_LOCATIONS: readonly TnTargetLocationOption[] = [
    { value: 'FRONT', label: 'Front' },
    { value: 'LEFT', label: 'Left' },
    { value: 'REAR', label: 'Rear' },
    { value: 'RIGHT', label: 'Right' },
] as const;

const MEK_TARGET_LOCATIONS: readonly TnTargetLocationOption[] = [
    { value: 'HD', label: 'HD' },
    { value: 'CT', label: 'CT' },
    { value: 'LT', label: 'LT' },
    { value: 'RT', label: 'RT' },
    { value: 'LA', label: 'LA' },
    { value: 'RA', label: 'RA' },
    { value: 'LL', label: 'LL' },
    { value: 'RL', label: 'RL' },
] as const;

const QUAD_TARGET_LOCATIONS: readonly TnTargetLocationOption[] = [
    { value: 'HD', label: 'HD' },
    { value: 'CT', label: 'CT' },
    { value: 'LT', label: 'LT' },
    { value: 'RT', label: 'RT' },
    { value: 'FLL', label: 'FLL' },
    { value: 'FRL', label: 'FRL' },
    { value: 'RLL', label: 'RLL' },
    { value: 'RRL', label: 'RRL' },
] as const;

const TRIPOD_TARGET_LOCATIONS: readonly TnTargetLocationOption[] = [
    { value: 'HD', label: 'HD' },
    { value: 'CT', label: 'CT' },
    { value: 'LT', label: 'LT' },
    { value: 'RT', label: 'RT' },
    { value: 'LA', label: 'LA' },
    { value: 'RA', label: 'RA' },
    { value: 'LL', label: 'LL' },
    { value: 'RL', label: 'RL' },
    { value: 'CL', label: 'CL' },
] as const;

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

export function getTargetMoveTypeModifier(moveType: MoveType | null | undefined): number {
    return moveType === 'VTOL' || moveType === 'WiGE' ? TN_AIRBORNE_MOVE_TYPE_MODIFIER : 0;
}

export function getTargetStanceModifier(stance: TnTargetStance | null | undefined, range: number): number {
    if (stance === 'prone') return range <= 0 ? -2 : 1;
    if (stance === 'immobile') return -4;
    return 0;
}

export function getInterveningWoodsModifier(woods: TnInterveningWoods | null | undefined): number {
    switch (woods) {
        case 'light1': return 1;
        case 'light2':
        case 'heavy1': return 2;
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

export function getTargetLocationModifier(stance: TnTargetStance | null | undefined, location: TnTargetLocation | null | undefined): number {
    return stance === 'immobile' && location === 'HD' ? TN_HEAD_LOCATION_MODIFIER : 0;
}

export function getTargetLocationOptions(unitType: TnTargetUnitType | null | undefined): readonly TnTargetLocationOption[] {
    switch (unitType) {
        case 'mek-quad': return QUAD_TARGET_LOCATIONS;
        case 'mek-tripod': return TRIPOD_TARGET_LOCATIONS;
        case 'mek-biped': return MEK_TARGET_LOCATIONS;
        default: return DEFAULT_TARGET_LOCATIONS;
    }
}

export function calculateTargetTnModifier(input: TnTargetNumberCalculationInput): number {
    const range = Math.max(0, input.range ?? 0);
    const stance = input.stance ?? 'none';
    let total = 0;

    total += getTargetUnitTypeModifier(input.unitType);
    total += getTargetMoveTypeModifier(input.targetMoveType);
    if (stance === 'none') {
        total += getTargetMovementBracketModifier(input.targetMovementBracket);
        total += input.jumped ? TN_JUMPED_MODIFIER : 0;
        total += input.skidding ? TN_SKIDDING_MODIFIER : 0;
    }
    total += getTargetStanceModifier(stance, range);
    total += getInterveningWoodsModifier(input.interveningWoods);
    total += getTargetHexCoverModifier(input.targetHexCover);
    total += input.partialCover && range > 0 && stance !== 'prone' ? TN_PARTIAL_COVER_MODIFIER : 0;
    total += getTargetLocationModifier(stance, input.targetLocation);

    return total;
}

export function getAttackerMovementModifier(moveMode: MotiveModes | null | undefined): number {
    switch (moveMode) {
        case 'walk': return 1;
        case 'run': return 2;
        case 'jump':
        case 'UMU': return 3;
        default: return 0;
    }
}