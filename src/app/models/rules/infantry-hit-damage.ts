// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { interiorInfantryDamage, ordinaryInfantryTroopers, type InfantryBuildingType } from './infantry-building-damage';
import type { WeaponType } from '../weapon-types.model';

export const INFANTRY_HIT_CLASSES = ['ordinary', 'squad-direct', 'plasma', 'infantry', 'burst-half', 'burst-1', 'burst-2', 'burst-3', 'burst-4'] as const;
export type InfantryHitClass = typeof INFANTRY_HIT_CLASSES[number];

/** TW p. 217, Burst-Fire Weapon Damage vs. Conventional Infantry. */
export function infantryHitClass(weapon: WeaponEquipment, battleArmor: boolean, ammo?: AmmoEquipment | null): InfantryHitClass {
    if (ammo?.hasMunitionType('M_FLECHETTE') || ammo?.hasMunitionType('M_FRAGMENTATION')) return 'infantry';
    if (weapon.isInfantryWeapon()) return 'infantry';
    if (weapon.hasFlag('F_PLASMA')) return 'plasma';
    if (weapon.hasFlag('F_FLAMER')) return battleArmor ? 'burst-3' : 'burst-4';
    switch (weapon.ammoType) {
        case 'MG_LIGHT': return battleArmor ? 'burst-half' : 'burst-1';
        case 'MG': return battleArmor ? 'burst-1' : 'burst-2';
        case 'MG_HEAVY': return battleArmor ? 'burst-2' : 'burst-3';
        case 'APGAUSS': return 'burst-2';
    }
    if (weapon.hasFlag('F_PULSE') && /small|micro/i.test(weapon.id)) return 'burst-2';
    if (battleArmor) {
        if (/recoilless/i.test(weapon.id)) return /light/i.test(weapon.id) ? 'burst-1' : 'burst-2';
        if (/mortar/i.test(weapon.id)) return 'burst-1';
        if (/grenade/i.test(weapon.id)) return /heavy/i.test(weapon.id) ? 'burst-1' : 'burst-half';
    }
    return battleArmor ? 'squad-direct' : 'ordinary';
}

/** Roll burst dice once for the report and replay them on the defending sheet. */
export function infantryCasualtyDiceCount(hit: InfantryHitClass | undefined, groups: number, bonus = 0): number {
    const count = hit?.startsWith('burst-') ? hit === 'burst-half' ? 1 : Number(hit.slice(-1)) : 0;
    return bonus + groups * count;
}

/** Convert the whole weapon hit before rounding. Each burst rolls separately (TW pp. 215–217). */
export function infantryCasualties(hit: InfantryHitClass, types: readonly WeaponType[], groups: readonly number[],
    mechanized: boolean, inOpen: boolean, armorDivisor: number, d6: () => number, building?: InfantryBuildingType): number {
    const damage = interiorInfantryDamage(groups.reduce((sum, group) => sum + group, 0), building);
    if (damage <= 0) return 0;
    const exposed = inOpen ? 2 : 1;
    if (hit === 'infantry') return Math.floor(damage * exposed / Math.max(1, armorDivisor) / (mechanized ? 2 : 1));
    let casualties: number;
    if (hit === 'plasma') return damage * exposed * (mechanized ? 2 : 1);
    if (hit === 'squad-direct' && !types.includes('M') && !types.includes('C')) {
        return groups.reduce((sum, group) => sum + infantryCasualties('ordinary', types, [group], mechanized, inOpen, armorDivisor, d6, building), 0);
    }
    if (hit === 'ordinary' || hit === 'squad-direct') {
        casualties = ordinaryInfantryTroopers(damage, types);
    } else {
        const dice = hit === 'burst-half' ? 1 : Number(hit.slice(-1));
        casualties = groups.reduce((sum, group) => {
            if (group <= 0) return sum;
            const roll = Array.from({ length: dice }, () => d6()).reduce((total, n) => total + n, 0);
            return sum + (hit === 'burst-half' ? Math.ceil(roll / 2) : roll);
        }, 0);
        return Math.floor(interiorInfantryDamage(casualties, building, true) * exposed / Math.max(1, armorDivisor) / (mechanized ? 2 : 1));
    }
    return casualties * exposed * (mechanized ? 2 : 1);
}
