import { AmmoEquipment } from './equipment.model';
import {
    ATM_EXTENDED_RANGE_PROFILE,
    ATM_HIGH_EXPLOSIVE_PROFILE,
    ATM_STANDARD_PROFILE,
    MML_LRM_PROFILE,
    MML_SRM_PROFILE,
    resolveAmmoWeaponProfile
} from './ammo-weapon-profile.model';

describe('ammo weapon profiles', () => {
    function ammo(
        id: string,
        type: 'ATM' | 'IATM' | 'MML' | 'LRM',
        options: { flags?: string[]; munitionType?: string[] } = {}
    ): AmmoEquipment {
        return new AmmoEquipment({
            id,
            name: id,
            shortName: id,
            type: 'ammo',
            flags: options.flags,
            ammo: { type, rackSize: 6, munitionType: options.munitionType }
        });
    }

    it('resolves MML profiles from authoritative ammunition flags', () => {
        expect(resolveAmmoWeaponProfile(ammo('Misleading SRM', 'MML', { flags: ['F_MML_LRM'] }))).toBe(MML_LRM_PROFILE);
        expect(resolveAmmoWeaponProfile(ammo('Misleading LRM', 'MML', { flags: ['F_MML_SRM'] }))).toBe(MML_SRM_PROFILE);
    });

    it('retains name fallback for legacy unflagged MML ammunition', () => {
        expect(resolveAmmoWeaponProfile(ammo('MML 9 LRM Ammo', 'MML'))).toBe(MML_LRM_PROFILE);
        expect(resolveAmmoWeaponProfile(ammo('MML 9 SRM Ammo', 'MML'))).toBe(MML_SRM_PROFILE);
        expect(resolveAmmoWeaponProfile(ammo('MML 9 Ammo', 'MML'))).toBeNull();
    });

    it('resolves ATM and IATM profiles from munition types', () => {
        expect(resolveAmmoWeaponProfile(ammo('Standard', 'ATM', { munitionType: ['M_STANDARD'] }))).toBe(ATM_STANDARD_PROFILE);
        expect(resolveAmmoWeaponProfile(ammo('ER', 'ATM', { munitionType: ['M_EXTENDED_RANGE'] }))).toBe(ATM_EXTENDED_RANGE_PROFILE);
        expect(resolveAmmoWeaponProfile(ammo('HE', 'IATM', { munitionType: ['M_HIGH_EXPLOSIVE'] }))).toBe(ATM_HIGH_EXPLOSIVE_PROFILE);
        expect(resolveAmmoWeaponProfile(ammo('IMP', 'IATM', { munitionType: ['M_IATM_IMP'] }))).toBe(ATM_HIGH_EXPLOSIVE_PROFILE);
    });

    it('does not invent profiles for unsupported or unclassified ammunition', () => {
        expect(resolveAmmoWeaponProfile(ammo('LRM Ammo', 'LRM'))).toBeNull();
        expect(resolveAmmoWeaponProfile(ammo('ATM Unknown', 'ATM'))).toBeNull();
        expect(resolveAmmoWeaponProfile(null)).toBeNull();
    });

    it('defines complete firing profiles for range, cluster, and fallback damage', () => {
        expect(MML_LRM_PROFILE).toEqual(jasmine.objectContaining({
            minimumRange: 6,
            ranges: [7, 14, 21, 28],
            clusterSize: 5,
            fallbackDamagePerShot: 1
        }));
        expect(ATM_HIGH_EXPLOSIVE_PROFILE).toEqual(jasmine.objectContaining({
            minimumRange: 0,
            ranges: [3, 6, 9, 12],
            clusterSize: 6,
            fallbackDamagePerShot: 3
        }));
    });
});
