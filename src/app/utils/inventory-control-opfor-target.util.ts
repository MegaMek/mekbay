// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getActiveStealthTnModifiers } from '../models/stealth-equipment.model';
import { getTargetMovementBracketForDistance, type TnTargetNumberCalculatorState, type TnTargetUnitType } from '../models/target-number-calculator.model';
import { isUnitBuildingLevel, isUnitWaterDepth } from '../models/unit-cover.model';
import { getUnitHeight, type UnitSummary, type WeightClass } from '../models/unit-summary.model';

export const OPFOR_INVENTORY_TARGET_ID_PREFIX = 'opfor:';
const LARGE_TARGET_WEIGHT_CLASSES = new Set<WeightClass>([
    'Colossal/Super-Heavy',
    'Large Support Vehicle',
]);

export function getOpforInventoryTargetId(unitId: string): string {
    return `${OPFOR_INVENTORY_TARGET_ID_PREFIX}${unitId}`;
}

export function isOpforInventoryTargetId(targetId: string): boolean {
    return targetId.startsWith(OPFOR_INVENTORY_TARGET_ID_PREFIX);
}

export function resolveInventoryTargetUnitType(unit: UnitSummary): TnTargetUnitType {
    switch (unit.type) {
        case 'Mek':
            if (unit.subtype.includes('Quad') || unit.subtype.includes('QuadVee')) return 'mek-quad';
            if (unit.subtype.includes('Tripod') || unit.moveType === 'Tripod') return 'mek-tripod';
            return 'mek-biped';
        case 'Infantry': return unit.subtype === 'Battle Armor' ? 'battle-armor' : 'infantry';
        case 'ProtoMek': return 'protoMek';
        case 'VTOL': return 'vtol';
        case 'Aero': return 'aero';
        case 'Tank':
        case 'Naval': return 'vehicle';
        default: return 'vehicle';
    }
}

export function isLargeInventoryTarget(unit: UnitSummary): boolean {
    return getUnitHeight(unit) === 3 || LARGE_TARGET_WEIGHT_CLASSES.has(unit.weightClass);
}

export function deriveOpforTargetCalculatorState(
    unit: CBTForceUnit,
    current: TnTargetNumberCalculatorState = {}
): TnTargetNumberCalculatorState {
    const immobile = unit.getCondition('immobile');
    const prone = unit.getCondition('prone');
    const moveDistance = unit.turnState().moveDistance();
    const isAirborne = unit.turnState().effectiveMoveMode() === 'jump' || unit.turnState().airborne() === true;
    const cover = unit.turnState().cover();
    const narcWaterLayers = unit.getActiveNarcWaterLayers();
    const targetMovementBracket = moveDistance !== null
        ? getTargetMovementBracketForDistance(moveDistance)?.id ?? null
        : null;

    return {
        ...current,
        isAirborne,
        targetMovementBracket,
        targetMovementDistance: moveDistance,
        skidding: unit.getCondition('skidding'),
        prone,
        immobile,
        targetHexCover: cover === 'light' || cover === 'heavy' ? cover : 'none',
        waterDepth: isUnitWaterDepth(cover) ? cover : undefined,
        buildingCover: isUnitBuildingLevel(cover) ? cover : undefined,
        largeTarget: isLargeInventoryTarget(unit.getUnit()),
        narcAboveWater: narcWaterLayers.aboveWater,
        narcUnderwater: narcWaterLayers.underwater,
        tagged: unit.getCondition('tagged'),
        ecmShielded: unit.getCondition('ecm-shielded'),
        stealth: getActiveStealthTnModifiers(unit),
    };
}
