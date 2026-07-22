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

import { WeaponEquipment } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';

export interface InventoryControlHeatEffect {
    readonly value: number;
    readonly weakened: boolean;
    readonly suffix?: '*';
}

export interface InventoryControlHeatRules {
    applyHeatEffects?: (entry: MountedEquipment, effect: InventoryControlHeatEffect) => InventoryControlHeatEffect;
}

/** Resolves weapon firing heat from typed model data and equipment effects. */
export function resolveInventoryControlHeat(
    entry: MountedEquipment,
    rules: InventoryControlHeatRules = {}
): number | null {
    return resolveInventoryControlHeatEffect(entry, rules)?.value ?? null;
}

export function resolveInventoryControlHeatEffect(
    entry: MountedEquipment,
    rules: InventoryControlHeatRules = {}
): InventoryControlHeatEffect | null {
    if (!(entry.equipment instanceof WeaponEquipment)) return null;
    const baseEffect: InventoryControlHeatEffect = { value: entry.equipment.heat, weakened: false };
    const effect = rules.applyHeatEffects?.(entry, baseEffect) ?? baseEffect;
    return Number.isFinite(effect.value)
        ? { ...effect, value: Math.max(0, effect.value) }
        : null;
}

export function formatInventoryControlHeat(heat: number, suffix = '', rapidFireCount = 0): string {
    if (heat === 0) return '—';
    const value = Number.isInteger(heat) ? heat.toString() : heat.toFixed(1).replace(/\.0$/, '');
    return `${value}${suffix}${rapidFireCount > 0 ? '/s' : ''}`;
}
