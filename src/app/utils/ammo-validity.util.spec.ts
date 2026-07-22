import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import type { WireSplitTechDates } from '../models/equipment-tech-codec';
import type { Era } from '../models/eras.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
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

function createAmmo(id: string, advancement: WireSplitTechDates): AmmoEquipment {
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

function issueReasons(ammo: AmmoEquipment, context: Parameters<typeof AmmoValidityUtil.getAmmoSelectionIssues>[1] = {}) {
    return AmmoValidityUtil.getAmmoSelectionIssues(ammo, context).map(issue => issue.reason);
}

describe('AmmoValidityUtil', () => {
    it('marks ammo with a selection issue when its advancement is after the selected era', () => {
        const ammo = createAmmo('Future Ammo', { clan: { prototype: '3057', production: '~3079', common: '3088' } });

        expect(issueReasons(ammo, { era: createEra(3025, 3056) })).toEqual(['not-yet-existing-in-era']);
        expect(issueReasons(ammo, { era: createEra(3025, 3057) })).toEqual([]);
    });

    it('uses approximate advancement years as five years earlier for non-extinction dates', () => {
        const ammo = createAmmo('Approximate Future Ammo', { clan: { production: '~3079' } });

        expect(issueReasons(ammo, { era: createEra(3025, 3073) })).toEqual(['not-yet-existing-in-era']);
        expect(issueReasons(ammo, { era: createEra(3025, 3074) })).toEqual([]);
    });

    it('marks ammo with a selection issue while every advancement branch is extinct for the selected era', () => {
        const ammo = createAmmo('Extinct Ammo', {
            is: { prototype: '~2375'
                , production: '2377'
                , common: '3058'
                , extinct: '2790'
                , reintroduced: '3054' },
        });

        expect(issueReasons(ammo, { era: createEra(3025, 3049) })).toEqual(['extinct-in-era']);
        expect(issueReasons(ammo, { era: createEra(3025, 3054) })).toEqual([]);
    });

    it('uses approximate extinction years as five years later', () => {
        const ammo = createAmmo('Approximate Extinct Ammo', {
            is: { production: '2377', extinct: '~2790', reintroduced: '~3054' },
        });

        expect(issueReasons(ammo, { era: createEra(2794, 3048) })).toEqual([]);
        expect(issueReasons(ammo, { era: createEra(2795, 3048) })).toEqual(['extinct-in-era']);
        expect(issueReasons(ammo, { era: createEra(2795, 3049) })).toEqual([]);
    });

    it('does not mark mixed advancement ammo with a selection issue when one branch is valid for the selected era', () => {
        const ammo = createAmmo('Mixed Availability Ammo', {
            is: { prototype: '1950', production: '1950', common: '2100' },
            clan: { prototype: '2375', production: '2377', extinct: '2790' },
        });

        expect(issueReasons(ammo, { era: createEra(3025, 3049) })).toEqual([]);
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

    it('does not hard-filter Artemis-capable ammo without a compatible Artemis-enhanced weapon', () => {
        const standardAmmo = createSrmAmmo('IS Ammo SRM-4');
        const artemisAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis-capable', ['M_ARTEMIS_CAPABLE']);
        const weaponEntry = mount('ISSRM4@RT#0', createSrmWeapon(), ['RT']);
        const nonArtemisWeaponEntry = mount('ISSRM4@RT#0', createSrmWeapon([]), ['RT']);
        const artemisEntry = mount('ISArtemisIV@RT#1', createArtemis(), ['RT']);
        const wrongLocationArtemisEntry = mount('ISArtemisIV@LT#1', createArtemis(), ['LT']);
        const unit = { type: 'Mek', techBase: 'Inner Sphere' } as any;

        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [nonArtemisWeaponEntry, artemisEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry, wrongLocationArtemisEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry, artemisEntry])).toBeTrue();
    });

    it('adds Artemis selection issues only when the matching Artemis component is missing', () => {
        const standardAmmo = createSrmAmmo('IS Ammo SRM-4');
        const artemisAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis-capable', ['M_ARTEMIS_CAPABLE']);
        const artemisVAmmo = createSrmAmmo('IS Ammo SRM-4 Artemis V-capable', ['M_ARTEMIS_V_CAPABLE']);
        const weaponEntry = mount('ISSRM4@RT#0', createSrmWeapon(), ['RT']);
        const artemisEntry = mount('ISArtemisIV@RT#1', createArtemis(), ['RT']);
        const artemisProtoEntry = mount('ISArtemisProto@RT#2', createArtemis(['F_ARTEMIS_PROTO']), ['RT']);
        const artemisVEntry = mount('ISArtemisV@RT#1', createArtemis(['F_ARTEMIS_V']), ['RT']);
        const unit = { type: 'Mek', techBase: 'Inner Sphere' } as any;

        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisVAmmo, unit, [weaponEntry, artemisEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisVAmmo, unit, [weaponEntry, artemisVEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry, artemisVEntry])).toBeTrue();
        expect(AmmoValidityUtil.isAmmoCompatible(standardAmmo, artemisAmmo, unit, [weaponEntry])).toBeTrue();

        expect(issueReasons(artemisAmmo, { inventory: [weaponEntry] })).toEqual(['missing-artemis-iv-component']);
        expect(issueReasons(artemisAmmo, { inventory: [weaponEntry, artemisEntry] })).toEqual([]);
        expect(issueReasons(artemisAmmo, { inventory: [weaponEntry, artemisProtoEntry] })).toEqual([]);
        expect(issueReasons(artemisAmmo, { inventory: [weaponEntry, artemisVEntry] })).toEqual(['missing-artemis-iv-component']);
        expect(issueReasons(artemisVAmmo, { inventory: [weaponEntry, artemisEntry] })).toEqual(['missing-artemis-v-component']);
        expect(issueReasons(artemisVAmmo, { inventory: [weaponEntry, artemisVEntry] })).toEqual([]);
    });
});
