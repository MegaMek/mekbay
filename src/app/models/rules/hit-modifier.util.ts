/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import type { MountedEquipment } from '../force-serialization';
import { WeaponEquipment, type AmmoEquipment } from '../equipment.model';
import type { InventoryControlRuntimeRangeKey } from '../inventory-control-runtime-state.model';
import { CORE_2026_RULES_DATA, type CBTRulesData } from './cbt-rules-data';

/**
 * Pure game-rules utilities for hit modifier calculation.
 * No SVG/DOM dependencies.
 */

/**
 * Compute per-entry linked-equipment modifiers
 */

export type LinkedEquipmentHitModifierResolver = (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => number;
export type EntryBaseHitModifierResolver = (entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null) => number | null;
export type HitModifier = number | 'Vs' | '*' | null;

export function getEntryBaseHitModifier(
    entry: MountedEquipment,
    range?: InventoryControlRuntimeRangeKey | null,
    rulesData: CBTRulesData = CORE_2026_RULES_DATA
): HitModifier {
    if (entry.physical) return rulesData.physicalBaseHitModifiers[entry.name.toLowerCase()] ?? null;
    const equipment = entry.equipment;
    if (!equipment) return null;
    const supportsHitModifier = equipment instanceof WeaponEquipment
        || equipment.flags.has('F_CLUB')
        || equipment.flags.has('F_HAND_WEAPON');
    if (!supportsHitModifier) return null;

    if (!range && equipment.getToHitModifiers().length > 1) return '*';
    return equipment.getToHitModifier(range);
}

/**
 * Resolve the final hit modifier for an inventory entry.
 * Returns `null` if the entry is not eligible for hit modifiers
 * (no equipment, unsupported physical attack, weapon enhancement, or no-range weapon).
 *
 * @param entry             - the mounted equipment entry
 * @param additionalModifiers - non-linked modifiers to add (global fire mod, damage mods, etc.)
 */
export function resolveHitModifier(
    entry: MountedEquipment,
    additionalModifiers: number,
    range?: InventoryControlRuntimeRangeKey | null,
    selectedAmmo?: AmmoEquipment | null,
    resolveLinkedModifiers?: LinkedEquipmentHitModifierResolver,
    resolveBaseModifier?: EntryBaseHitModifierResolver,
    rulesData: CBTRulesData = CORE_2026_RULES_DATA
): HitModifier {
    const linkedModifiers = resolveLinkedModifiers?.(entry, selectedAmmo) ?? 0;
    const resolvedBaseModifier = resolveBaseModifier?.(entry, range);
    const baseModifier = resolvedBaseModifier ?? getEntryBaseHitModifier(entry, range, rulesData);
    if (baseModifier === 'Vs' || baseModifier === '*') return baseModifier;
    if (!entry.equipment && !entry.physical) {
        return null;
    }
    if (entry.equipment) {
        if (entry.equipment.flags.has('F_WEAPON_ENHANCEMENT') && baseModifier === null) {
            return null;
        }
        if (entry.equipment instanceof WeaponEquipment) {
            if (entry.equipment.hasNoRange() && !entry.equipment.flags.has('F_CLUB') && !entry.equipment.flags.has('F_HAND_WEAPON') && !(entry.equipment.weapon.ammoType==='MML')) {
                if (!entry.parent?.equipment || (entry.parent.equipment instanceof WeaponEquipment && entry.parent.equipment.hasNoRange())) {
                    return null;
                }
            }
        }
    }
    if (baseModifier === null) return null;
    return baseModifier + additionalModifiers + linkedModifiers;
}
