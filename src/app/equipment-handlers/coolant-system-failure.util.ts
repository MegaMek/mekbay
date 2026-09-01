// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import { EQUIPMENT_HEAT_SOURCE_GROUP, type UnitHeatSource } from '../models/rules/unit-type-rules';
import { isEquipmentDisabledByFailure } from './disabled-equipment.handler';

/** Heat leaked by a failed/damaged RHS or RISC emergency coolant system. */
export function getFailedCoolantSystemHeatSources(
    equipment: MountedEquipment,
    turnState: TurnState,
    sourceId: string,
    label: string,
): UnitHeatSource[] {
    const committedDestroyed = equipment.owner.isEquipmentResolvedCommittedDestroyed?.(equipment)
        ?? equipment.committedDestroyed();
    if (!isEquipmentDisabledByFailure(equipment) && !committedDestroyed) return [];

    const sources: UnitHeatSource[] = [];
    const moveMode = turnState.effectiveMoveMode();
    if (moveMode !== null && moveMode !== 'stationary') {
        sources.push({ id: `${sourceId}:movement`, label, value: 1, group: EQUIPMENT_HEAT_SOURCE_GROUP });
    }

    const selectedWeapon = equipment.owner.getInventory().some(entry =>
        entry.equipment instanceof WeaponEquipment
        && (equipment.owner.isInventoryControlEntrySelected?.(entry.id) ?? false)
    );
    if (turnState.weaponsHeat() > 0 || selectedWeapon) {
        sources.push({ id: `${sourceId}:weapons`, label, value: 1, group: EQUIPMENT_HEAT_SOURCE_GROUP });
    }
    return sources;
}
