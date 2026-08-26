// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoMunitionFlag } from "./ammo-munition-flags.type";
import { EquipmentFlag } from "./equipment-flags.type";
import type { RangeBrackets } from './equipment.model';

export type AmmoWeaponProfileId =
    | 'mml-lrm'
    | 'mml-srm'
    | 'atm-standard'
    | 'atm-extended-range'
    | 'atm-high-explosive';

export interface AmmoWeaponProfile {
    readonly id: AmmoWeaponProfileId;
    readonly displayName: string;
    readonly minimumRange: number;
    readonly ranges: readonly [short: number, medium: number, long: number, extreme: number];
    readonly maximumAerospaceBracket: RangeBrackets;
    readonly clusterSize: number;
}

/** Canonical inventory-control modes shared by entity and runtime rules. */
export const MML_INVENTORY_MODES = ['LRM', 'SRM'] as const;
export const ATM_INVENTORY_MODES = ['Standard', 'Extended Range', 'High Explosive'] as const;
/** Exact legacy owner-state key promoted by tolerant intrinsic-magazine restore. */
export const INTRINSIC_ONE_SHOT_AMMO_STATE = 'intrinsic_one_shot_ammo' as const;

interface AmmoProfileSource {
    readonly ammoType: string;
    readonly name: string;
    readonly shortName: string;
    hasFlag(equipmentFlag: EquipmentFlag): boolean;
    hasMunitionType(ammoMunitionFlag: AmmoMunitionFlag): boolean;
}

export const MML_LRM_PROFILE: AmmoWeaponProfile = {
    id: 'mml-lrm',
    displayName: MML_INVENTORY_MODES[0],
    minimumRange: 6,
    ranges: [7, 14, 21, 28],
    maximumAerospaceBracket: 'long',
    clusterSize: 5
};

export const MML_SRM_PROFILE: AmmoWeaponProfile = {
    id: 'mml-srm',
    displayName: MML_INVENTORY_MODES[1],
    minimumRange: 0,
    ranges: [3, 6, 9, 12],
    maximumAerospaceBracket: 'short',
    clusterSize: 2
};

export const ATM_STANDARD_PROFILE: AmmoWeaponProfile = {
    id: 'atm-standard',
    displayName: ATM_INVENTORY_MODES[0],
    minimumRange: 4,
    ranges: [5, 10, 15, 20],
    maximumAerospaceBracket: 'medium',
    clusterSize: 6
};

export const ATM_EXTENDED_RANGE_PROFILE: AmmoWeaponProfile = {
    id: 'atm-extended-range',
    displayName: ATM_INVENTORY_MODES[1],
    minimumRange: 4,
    ranges: [9, 18, 27, 36],
    maximumAerospaceBracket: 'extreme',
    clusterSize: 6
};

export const ATM_HIGH_EXPLOSIVE_PROFILE: AmmoWeaponProfile = {
    id: 'atm-high-explosive',
    displayName: ATM_INVENTORY_MODES[2],
    minimumRange: 0,
    ranges: [3, 6, 9, 12],
    maximumAerospaceBracket: 'short',
    clusterSize: 6
};

export const MML_AMMO_PROFILES: readonly AmmoWeaponProfile[] = [MML_LRM_PROFILE, MML_SRM_PROFILE];
export const ATM_AMMO_PROFILES: readonly AmmoWeaponProfile[] = [
    ATM_STANDARD_PROFILE,
    ATM_EXTENDED_RANGE_PROFILE,
    ATM_HIGH_EXPLOSIVE_PROFILE
];

export function resolveAmmoWeaponProfile(ammo: AmmoProfileSource | null | undefined): AmmoWeaponProfile | null {
    if (!ammo) return null;
    if (ammo.ammoType === 'MML') {
        if (ammo.hasFlag('F_MML_LRM')) return MML_LRM_PROFILE;
        if (ammo.hasFlag('F_MML_SRM')) return MML_SRM_PROFILE;

        const name = `${ammo.shortName} ${ammo.name}`.toLowerCase();
        if (name.includes('lrm')) return MML_LRM_PROFILE;
        if (name.includes('srm')) return MML_SRM_PROFILE;
        return null;
    }
    if (ammo.ammoType !== 'ATM' && ammo.ammoType !== 'IATM') return null;
    if (ammo.hasMunitionType('M_EXTENDED_RANGE')) return ATM_EXTENDED_RANGE_PROFILE;
    if (ammo.hasMunitionType('M_HIGH_EXPLOSIVE') || ammo.hasMunitionType('M_IATM_IMP')) return ATM_HIGH_EXPLOSIVE_PROFILE;
    return ammo.hasMunitionType('M_STANDARD') ? ATM_STANDARD_PROFILE : null;
}
