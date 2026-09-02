// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentRegistry } from '../../models/equipment-lookup';
import { equipmentCatalogEntriesIncludingSupplements } from '../../models/equipment-catalog-supplements';
import {
    createEquipment,
    type EquipmentMap,
    type RawEquipmentData,
} from '../../models/equipment.model';
import { isPlaytestEquipment } from './equipment-catalog-policy';

/** Framework-free equipment hydration shared by the app and Node tooling. */
export function buildEquipmentRegistry(
    data: RawEquipmentData,
    onInvalidEntry?: (internalName: string, error: unknown) => void,
): EquipmentRegistry {
    const equipment: EquipmentMap = {};
    for (const [internalName, raw] of equipmentCatalogEntriesIncludingSupplements(data.equipment)) {
        if (isPlaytestEquipment(internalName, raw)) continue;
        try {
            equipment[internalName] = createEquipment(raw);
        } catch (error) {
            if (!onInvalidEntry) {
                throw new Error(`Invalid equipment catalog entry ${internalName}`, { cause: error });
            }
            onInvalidEntry(internalName, error);
        }
    }
    return new EquipmentRegistry(equipment);
}
