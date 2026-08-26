// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { TnTargetUnitType } from '../models/target-number-calculator.model';
import type { UnitSummary } from '../models/unit-summary.model';

export const OPFOR_INVENTORY_TARGET_ID_PREFIX = 'opfor:';

/**
 * Stable unambiguous identity for a force-owned opponent row.
 */
export function getForceOpforInventoryTargetId(forceInstanceId: string, unitInstanceId: string): string {
    return `${OPFOR_INVENTORY_TARGET_ID_PREFIX}${forceInstanceId.length}:${forceInstanceId}:${unitInstanceId}`;
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
        case 'VTOL': return 'vtol-wige';
        case 'Aero': return 'aero';
        case 'Tank': return unit.moveType === 'WiGE' ? 'vtol-wige' : 'vehicle';
        case 'Naval': return 'vehicle';
        default: return 'vehicle';
    }
}

export function isLargeInventoryTarget(unit: UnitSummary): boolean {
    return unit.type === 'Mek' && unit.tons > 100;
}
