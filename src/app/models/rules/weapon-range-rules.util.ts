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

export type WeaponRangeKey = 'short' | 'medium' | 'long' | 'extreme';

export const WEAPON_RANGE_ORIGINAL_DAMAGE_TEXT_ATTRIBUTE = 'data-mekbay-original-damage-text';

const RANGE_DAMAGE_INDEX: Record<WeaponRangeKey, number> = {
    short: 0,
    medium: 1,
    long: 2,
    extreme: 3
};

const PULSE_RANGE_HIT_MODIFIERS: Partial<Record<WeaponRangeKey, number>> = {
    short: -3,
    medium: -2,
    long: -1
};

export function resolveWeaponRangeDamageText(entry: MountedEquipment, range: WeaponRangeKey | null | undefined, baseDamageText: string | null | undefined): string | null {
    if (!range || !(entry.equipment instanceof WeaponEquipment)) return null;
    const damage = entry.equipment.weapon.damage;
    if (!Array.isArray(damage)) return null;

    const value = damage[RANGE_DAMAGE_INDEX[range]];
    if (typeof value === 'number' && Number.isFinite(value)) return appendDamageBracketText(value.toString(), baseDamageText);
    return null;
}

function appendDamageBracketText(damage: string, baseDamageText: string | null | undefined): string {
    const bracketText = baseDamageText?.match(/(?:\s*\[[^\]]+\])+\s*$/)?.[0]?.trim();
    return bracketText ? `${damage} ${bracketText}` : damage;
}

export function resolveWeaponRangeHitModifier(entry: MountedEquipment, range: WeaponRangeKey | null | undefined): number | null {
    if (!range || !(entry.equipment instanceof WeaponEquipment)) return null;
    if (!entry.equipment.flags.has('F_VSP')) return null;
    return PULSE_RANGE_HIT_MODIFIERS[range] ?? null;
}