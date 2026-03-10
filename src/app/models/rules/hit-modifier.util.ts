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
import { WeaponEquipment } from '../equipment.model';

/**
 * Pure game-rules utilities for hit modifier calculation.
 * No SVG/DOM dependencies.
 */

/**
 * Compute per-entry linked-equipment modifiers
 */
/**
 * Check whether a mounted-equipment entry is destroyed.
 * When critSlots exist they are the authoritative (signal-derived) source;
 * the mutable `destroyed` flag is only used as fallback for entries without crits.
 */
export function isMountedDestroyed(entry: MountedEquipment): boolean {
    if (entry.critSlots?.length) {
        return entry.critSlots.some(s => s.destroyed);
    }
    return !!entry.destroyed;
}

export function computeLinkedModifiers(entry: MountedEquipment): number {
    let mod = 0;
    if (entry.linkedWith) {
        for (const linked of entry.linkedWith) {
            if (linked.equipment?.flags.has('F_ARTEMIS_V') && isMountedDestroyed(linked)) {
                mod += 1;
            }
        }
    }
    return mod;
}

/**
 * Resolve the final hit modifier for an inventory entry.
 * Returns `null` if the entry is not eligible for hit modifiers
 * (no equipment, weapon enhancement, no-range weapon, invalid baseHitMod).
 *
 * @param entry             - the mounted equipment entry
 * @param additionalModifiers - pre-computed modifiers to add (global fire mod, linked mods, etc.)
 */
export function resolveHitModifier(entry: MountedEquipment, additionalModifiers: number): number | 'Vs' | '*' | null {
    if (entry.baseHitMod === 'Vs' || entry.baseHitMod === '*') {
        return entry.baseHitMod;
    }
    if (!entry.equipment && !entry.physical) {
        return null;
    }
    if (entry.equipment) {
        if (entry.equipment.flags.has('F_WEAPON_ENHANCEMENT')) {
            if (!entry.equipment.flags.has('F_RISC_LASER_PULSE_MODULE')) {
                return null;
            }
        }
        if (entry.equipment instanceof WeaponEquipment) {
            if (entry.equipment.hasNoRange() && !entry.equipment.flags.has('F_CLUB') && !entry.equipment.flags.has('F_HAND_WEAPON')) {
                if (!entry.parent?.equipment || (entry.parent.equipment instanceof WeaponEquipment && entry.parent.equipment.hasNoRange())) {
                    return null;
                }
            }
        }
    }
    const baseHitModValue = parseInt(entry.baseHitMod || '0');
    if (isNaN(baseHitModValue)) {
        return null;
    }
    return baseHitModValue + additionalModifiers;
}
