// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getTargetMovementBracketForDistance, type TnTargetNumberCalculatorState, type TnTargetUnitType } from '../models/target-number-calculator.model';
import type { Unit } from '../models/units.model';

export const OPFOR_INVENTORY_TARGET_ID_PREFIX = 'opfor:';

export function getOpforInventoryTargetId(unitId: string): string {
    return `${OPFOR_INVENTORY_TARGET_ID_PREFIX}${unitId}`;
}

export function isOpforInventoryTargetId(targetId: string): boolean {
    return targetId.startsWith(OPFOR_INVENTORY_TARGET_ID_PREFIX);
}

export function resolveInventoryTargetUnitType(unit: Unit): TnTargetUnitType {
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

export function isLargeInventoryTarget(unit: Unit): boolean {
    return unit.type === 'Mek' && unit.tons > 100;
}

export function deriveOpforTargetCalculatorState(
    unit: CBTForceUnit,
    current: TnTargetNumberCalculatorState = {}
): TnTargetNumberCalculatorState {
    const immobile = unit.getCondition('immobile');
    const prone = unit.getCondition('prone');
    const moveDistance = unit.turnState().moveDistance();
    const isAirborne = unit.turnState().moveMode() === 'jump' || unit.turnState().airborne() === true;
    const targetMovementBracket = moveDistance !== null
        ? getTargetMovementBracketForDistance(moveDistance)?.id ?? null
        : null;

    return {
        ...current,
        isAirborne,
        targetMovementBracket,
        skidding: unit.getCondition('skidding'),
        prone,
        immobile,
        largeTarget: isLargeInventoryTarget(unit.getUnit())
    };
}
