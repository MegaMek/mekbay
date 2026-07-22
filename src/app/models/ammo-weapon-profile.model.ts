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
    readonly clusterSize: number;
    readonly fallbackDamagePerShot: number;
}

interface AmmoProfileSource {
    readonly ammoType: string;
    readonly name: string;
    readonly shortName: string;
    hasFlag(flag: string): boolean;
    hasMunitionType(type: string): boolean;
}

export const MML_LRM_PROFILE: AmmoWeaponProfile = {
    id: 'mml-lrm',
    displayName: 'LRM',
    minimumRange: 6,
    ranges: [7, 14, 21, 28],
    clusterSize: 5,
    fallbackDamagePerShot: 1
};

export const MML_SRM_PROFILE: AmmoWeaponProfile = {
    id: 'mml-srm',
    displayName: 'SRM',
    minimumRange: 0,
    ranges: [3, 6, 9, 12],
    clusterSize: 2,
    fallbackDamagePerShot: 2
};

export const ATM_STANDARD_PROFILE: AmmoWeaponProfile = {
    id: 'atm-standard',
    displayName: 'Standard',
    minimumRange: 4,
    ranges: [5, 10, 15, 20],
    clusterSize: 6,
    fallbackDamagePerShot: 2
};

export const ATM_EXTENDED_RANGE_PROFILE: AmmoWeaponProfile = {
    id: 'atm-extended-range',
    displayName: 'Extended Range',
    minimumRange: 4,
    ranges: [9, 18, 27, 36],
    clusterSize: 6,
    fallbackDamagePerShot: 1
};

export const ATM_HIGH_EXPLOSIVE_PROFILE: AmmoWeaponProfile = {
    id: 'atm-high-explosive',
    displayName: 'High Explosive',
    minimumRange: 0,
    ranges: [3, 6, 9, 12],
    clusterSize: 6,
    fallbackDamagePerShot: 3
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
