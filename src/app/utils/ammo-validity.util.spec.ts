import { AmmoEquipment } from '../models/equipment.model';
import type { Era } from '../models/eras.model';
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
});