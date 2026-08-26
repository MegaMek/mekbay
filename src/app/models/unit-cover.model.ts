// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export type UnitHeight = 1 | 2 | 3;

export type UnitWaterDepth = 'underwater-depth-1' | 'underwater-depth-2' | 'underwater-depth-3';
export type UnitBuildingLevel = 'building-1' | 'building-2' | 'building-3';
export type UnitCover = 'light' | 'heavy' | UnitWaterDepth | UnitBuildingLevel;
export type SerializedUnitCover = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface UnitWaterState {
    partiallyUnderwater: boolean;
    submerged: boolean;
}

export type UnitBuildingCoverEffect = 'none' | 'partial' | 'heavy';

export interface UnitBuildingCoverState {
    effect: UnitBuildingCoverEffect;
    modifier: 0 | 1 | 2;
}

const SERIALIZED_UNIT_COVER: Record<UnitCover, SerializedUnitCover> = {
    light: 1,
    heavy: 2,
    'underwater-depth-1': 3,
    'underwater-depth-2': 4,
    'underwater-depth-3': 5,
    'building-1': 6,
    'building-2': 7,
    'building-3': 8,
};

const UNIT_COVER_BY_SERIALIZED_VALUE: Record<SerializedUnitCover, UnitCover> = {
    1: 'light',
    2: 'heavy',
    3: 'underwater-depth-1',
    4: 'underwater-depth-2',
    5: 'underwater-depth-3',
    6: 'building-1',
    7: 'building-2',
    8: 'building-3',
};

const WATER_DEPTH_NUMBER: Record<UnitWaterDepth, 1 | 2 | 3> = {
    'underwater-depth-1': 1,
    'underwater-depth-2': 2,
    'underwater-depth-3': 3,
};

const BUILDING_LEVEL_NUMBER: Record<UnitBuildingLevel, 1 | 2 | 3> = {
    'building-1': 1,
    'building-2': 2,
    'building-3': 3,
};

export function isUnitWaterDepth(cover: unknown): cover is UnitWaterDepth {
    return cover === 'underwater-depth-1'
        || cover === 'underwater-depth-2'
        || cover === 'underwater-depth-3';
}

export function unitWaterDepthNumber(depth: UnitWaterDepth): 1 | 2 | 3 {
    return WATER_DEPTH_NUMBER[depth];
}

export function isUnitBuildingLevel(cover: unknown): cover is UnitBuildingLevel {
    return cover === 'building-1' || cover === 'building-2' || cover === 'building-3';
}

export function isUnitCover(cover: unknown): cover is UnitCover {
    return cover === 'light' || cover === 'heavy'
        || isUnitWaterDepth(cover) || isUnitBuildingLevel(cover);
}

export function unitBuildingLevelNumber(level: UnitBuildingLevel): 1 | 2 | 3 {
    return BUILDING_LEVEL_NUMBER[level];
}

type UnitLevelCoverEffect = 'none' | 'partial' | 'full';

function resolveUnitLevelCoverEffect(level: UnitHeight | undefined, unitHeight: UnitHeight): UnitLevelCoverEffect {
    if (level === undefined) return 'none';
    if (level >= unitHeight) return 'full';
    return level === unitHeight - 1 ? 'partial' : 'none';
}

export function resolveUnitWaterState(
    depth: UnitWaterDepth | undefined,
    unitHeight: UnitHeight,
): UnitWaterState {
    const effect = resolveUnitLevelCoverEffect(
        depth === undefined ? undefined : unitWaterDepthNumber(depth),
        unitHeight,
    );
    return {
        partiallyUnderwater: effect === 'partial',
        submerged: effect === 'full',
    };
}

export function resolveUnitBuildingCoverState(
    level: UnitBuildingLevel | undefined,
    unitHeight: UnitHeight,
): UnitBuildingCoverState {
    const effect = resolveUnitLevelCoverEffect(
        level === undefined ? undefined : unitBuildingLevelNumber(level),
        unitHeight,
    );
    if (effect === 'full') return { effect: 'heavy', modifier: 2 };
    return effect === 'partial' ? { effect, modifier: 1 } : { effect, modifier: 0 };
}

export function serializeUnitCover(cover: UnitCover): SerializedUnitCover {
    return SERIALIZED_UNIT_COVER[cover];
}

export function deserializeUnitCover(value: unknown): UnitCover | undefined {
    if (typeof value !== 'number') return undefined;
    return UNIT_COVER_BY_SERIALIZED_VALUE[value as SerializedUnitCover];
}
