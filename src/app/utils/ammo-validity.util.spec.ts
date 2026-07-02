import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import type { Era } from '../models/eras.model';
import type { MountedEquipment } from '../models/force-serialization';
import { AmmoValidityUtil } from './ammo-validity.util';

function createEra(from: number | undefined, to: number | undefined): Era {
    return {
        id: 1,
        name: 'Test Era',
        years: { from, to },
        factions: [],
        units: [],
    };
}

function createAmmo(id: string, advancement: AmmoEquipment['tech']['advancement']): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        tech: {
            base: 'All',
            advancement,
        },
        ammo: { type: 'SNIPER', rackSize: 20, shots: 10, munitionType: ['M_STANDARD'] }
    });
}

function createSrmAmmo(id: string, munitionType: string[] = []): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        tech: { base: 'IS' },
        ammo: { type: 'SRM', rackSize: 4, shots: 25, munitionType }
    });
}

function createSrmWeapon(flags: string[] = ['F_ARTEMIS_COMPATIBLE']): WeaponEquipment {
    return new WeaponEquipment({
        id: 'ISSRM4',
        name: 'SRM 4',
        type: 'weapon',
        flags,
        weapon: { ammoType: 'SRM', rackSize: 4 }
    });
}

function createArtemis(flags: string[] = ['F_ARTEMIS']): MiscEquipment {
    return new MiscEquipment({
        id: flags.includes('F_ARTEMIS_V') ? 'ISArtemisV' : 'ISArtemisIV',
        name: flags.includes('F_ARTEMIS_V') ? 'Artemis V FCS' : 'Artemis IV FCS',
        type: 'misc',
        flags: ['F_WEAPON_ENHANCEMENT', ...flags]
    });
}

function mount(id: string, equipment: MountedEquipment['equipment'], locations: string[] = []): MountedEquipment {
    return {
        id,
        name: equipment?.internalName ?? id,
        equipment,
        locations: new Set(locations),
        states: new Map<string, string>(),
    } as MountedEquipment;
}

describe('AmmoValidityUtil', () => {
    it('marks ammo unavailable when its advancement is after the selected era', () => {
        const ammo = createAmmo('Future Ammo', { clan: { prototype: '3057', production: '~3079', common: '3088' } });

        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3056) })).toBeTrue();
        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3057) })).toBeFalse();
    });

    it('uses approximate advancement years as five years earlier for non-extinction dates', () => {
        const ammo = createAmmo('Approximate Future Ammo', { clan: { production: '~3079' } });

        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3073) })).toBeTrue();
        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3074) })).toBeFalse();
    });

    it('marks ammo unavailable while every advancement branch is extinct for the selected era', () => {
        const ammo = createAmmo('Extinct Ammo', {
            is: { prototype: '~2375', production: '2377', common: '3058', extinct: '2790', reintroduced: '3054' },
        });

        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3049) })).toBeTrue();
        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3054) })).toBeFalse();
    });

    it('uses approximate extinction years as five years later', () => {
        const ammo = createAmmo('Approximate Extinct Ammo', {
            is: { production: '2377', extinct: '~2790', reintroduced: '~3054' },
        });

        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(2794, 3048) })).toBeFalse();
        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(2795, 3048) })).toBeTrue();
        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(2795, 3049) })).toBeFalse();
    });

    it('does not mark mixed advancement ammo unavailable when one branch is valid for the selected era', () => {
        const ammo = createAmmo('Mixed Availability Ammo', {
            is: { prototype: '1950', production: '1950', common: '2100' },
            clan: { prototype: '2375', production: '2377', extinct: '2790' },
        });

        expect(AmmoValidityUtil.isAmmoUnavailable(ammo, { era: createEra(3025, 3049) })).toBeFalse();
    });

    it('treats unit-invalid ammo as incompatible', () => {
        const ammo = new AmmoEquipment({
            id: 'LBX Standard Ammo',
            name: 'LBX Standard Ammo',
            type: 'ammo',
            tech: { base: 'All' },
            ammo: { type: 'AC_LBX', rackSize: 10, shots: 10, munitionType: ['M_STANDARD'] }
        });

        expect(AmmoValidityUtil.isAmmoCompatible(ammo, ammo, { type: 'Aero', techBase: 'Inner Sphere' } as any)).toBeFalse();
    });

    it('requires Artemis-capable ammo to have a compatible Artemis-enhanced weapon', () => {
        const standardAmmo = createSrmAmmo('IS Ammo SRM-4');
        const artemisAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis-capable', ['M_ARTEMIS_CAPABLE']);
        const weaponEntry = mount('ISSRM4@RT#0', createSrmWeapon(), ['RT']);
        const nonArtemisWeaponEntry = mount('ISSRM4@RT#0', createSrmWeapon([]), ['RT']);
        const artemisEntry = mount('ISArtemisIV@RT#1', createArtemis(), ['RT']);
        const wrongLocationArtemisEntry = mount('ISArtemisIV@LT#1', createArtemis(), ['LT']);
        const unit = { type: 'Mek', techBase: 'Inner Sphere' } as any;

        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry])).toBeFalse();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [nonArtemisWeaponEntry, artemisEntry])).toBeFalse();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry, wrongLocationArtemisEntry])).toBeFalse();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry, artemisEntry])).toBeTrue();
    });

    it('Artemis V-capable can be used with Artemis IV weapons', () => {
        const standardAmmo = createSrmAmmo('IS Ammo SRM-4');
        const artemisAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis-capable', ['M_ARTEMIS_CAPABLE']);
        const artemisVAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis V-capable', ['M_ARTEMIS_V_CAPABLE']);
        const weaponEntry = mount('ISSRM4@RT#0', createSrmWeapon(), ['RT']);
        const artemisEntry = mount('ISArtemisIV@RT#1', createArtemis(), ['RT']);
        const artemisVEntry = mount('ISArtemisV@RT#1', createArtemis(['F_ARTEMIS_V']), ['RT']);
        const unit = { type: 'Mek', techBase: 'Inner Sphere' } as any;

        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisVAmmo, unit, [weaponEntry, artemisEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisVAmmo, unit, [weaponEntry, artemisVEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry, artemisVEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry])).toBeFalse();
    });
});