import { MountedWeapon } from './mounted-equipment.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { MML_LRM_PROFILE } from './ammo-weapon-profile.model';
import {
    AmmoEquipment,
    type AmmoType,
    EquipmentMap,
    findIntrinsicAmmoForWeapon,
    MiscEquipment,
    StructureEquipment,
    WeaponEquipment,
    createEquipment,
} from './equipment.model';
import { getStructureByName, getStructureByTypeId } from './entity/components';

describe('equipment model', () => {
    it('deserializes structure records as StructureEquipment', () => {
        const equipment = createEquipment({
            id: 'IS Endo-Composite',
            name: 'Endo-Composite',
            type: 'structure',
            structure: { typeId: 6 },
            tech: { base: 'IS' },
        });

        expect(equipment).toBeInstanceOf(StructureEquipment);
        expect(equipment.type).toBe('structure');
        expect((equipment as StructureEquipment).structureTypeId).toBe(6);
        expect(equipment.techBase).toBe('IS');
    });

    it('preserves exported structure type IDs without interpreting them', () => {
        const equipment = createEquipment({
            id: 'Unknown Structure',
            name: 'Unknown Structure',
            type: 'structure',
            structure: { typeId: 99 },
            tech: { base: 'All' },
        });

        expect((equipment as StructureEquipment).structureTypeId).toBe(99);
    });

    it('resolves structure equipment variants by ID or MTF name', () => {
        const equipmentDb: EquipmentMap = {
            'IS Endo Steel': createEquipment({
                id: 'IS Endo Steel', name: 'Endo Steel', type: 'structure',
                structure: { typeId: 2 }, tech: { base: 'IS' },
            }),
            'Clan Endo Steel': createEquipment({
                id: 'Clan Endo Steel', name: 'Endo Steel', type: 'structure',
                structure: { typeId: 2 }, tech: { base: 'Clan' },
            }),
            Standard: createEquipment({
                id: 'Standard', name: 'Standard', type: 'structure',
                structure: { typeId: 0 }, tech: { base: 'All' },
            }),
        };

        expect(getStructureByTypeId(2, 'IS', equipmentDb)?.id).toBe('IS Endo Steel');
        expect(getStructureByName('Endo Steel', 'Clan', equipmentDb)?.id).toBe('Clan Endo Steel');
        expect(getStructureByTypeId(0, 'Clan', equipmentDb)?.id).toBe('Standard');
    });

    it('derives intrinsic weapon categories and damage profiles', () => {
        const srm = weapon('srm-6', 'SRM 6', 'SRM', 'cluster', 6, ['F_MISSILE']);
        const ultra = weapon('uac-10', 'Ultra AC/10', 'AC_ULTRA', 10, 10, ['F_BALLISTIC']);
        const variable = weapon('variable', 'Variable Laser', 'NA', [10, 8, 5], 0, ['F_ENERGY']);

        expect(srm.getWeaponCategory()).toBe('missile');
        expect(srm.getDamageProfile()).toEqual({
            kind: 'missile-cluster', damagePerMissile: 2, maximum: 12,
        });
        expect(ultra.getWeaponCategory()).toBe('ballistic');
        expect(ultra.getDamageProfile()).toEqual({
            kind: 'fixed', damage: 10, maximum: 20, perShot: true,
        });
        expect(variable.getWeaponCategory()).toBe('energy');
        expect(variable.getDamageProfile()).toEqual({
            kind: 'range', damage: [10, 8, 5], maximum: 10,
        });
    });

    it('derives optional one-shot counts from weapon flags', () => {
        const standard = weapon('standard', 'Standard', 'NA', 5, 0, []);
        const oneShot = weapon('one-shot', 'One-Shot', 'SRM', 'cluster', 2, ['F_ONE_SHOT']);
        const doubleOneShot = weapon(
            'double-one-shot', 'Double One-Shot', 'SRM', 'cluster', 2,
            ['F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT'],
        );

        expect(standard.oneShotCount).toBeUndefined();
        expect(oneShot.oneShotCount).toBe(1);
        expect(doubleOneShot.oneShotCount).toBe(2);
    });

    it('resolves standard intrinsic ammo for one-shot weapons and derives special damage', () => {
        const mineLauncher = weapon('mine-launcher', 'Pop-up Mine', 'MINE', 'special', 1, ['F_ONE_SHOT']);
        const wrongRack = new AmmoEquipment({
            id: 'wrong-rack', name: 'Wrong Rack', type: 'ammo',
            ammo: { type: 'MINE', rackSize: 2, damagePerShot: 9, munitionType: ['M_STANDARD'] },
        });
        const alternate = new AmmoEquipment({
            id: 'alternate', name: 'Alternate', type: 'ammo',
            ammo: { type: 'MINE', rackSize: 1, damagePerShot: 7, munitionType: ['M_INFERNO'] },
        });
        const standard = new AmmoEquipment({
            id: 'standard', name: 'Standard', type: 'ammo',
            ammo: { type: 'MINE', rackSize: 1, damagePerShot: 4, munitionType: ['M_STANDARD'] },
        });

        expect(findIntrinsicAmmoForWeapon(mineLauncher, { wrongRack, alternate, standard })).toBe(standard);
        expect(mineLauncher.getDamageProfile(standard)).toEqual({
            kind: 'fixed', damage: 4, maximum: 4, perShot: false,
        });
        expect(mineLauncher.getDamageProfile()).toEqual({ kind: 'special', maximum: 0 });

        const repeating = weapon('repeating', 'Repeating', 'MINE', 'special', 1, []);
        expect(findIntrinsicAmmoForWeapon(repeating, { standard })).toBeNull();
        expect(repeating.getDamageProfile(standard)).toEqual({ kind: 'special', maximum: 0 });

        const noAmmo = weapon('no-ammo', 'No Ammo', 'NA', 'special', 0, ['F_ONE_SHOT']);
        expect(findIntrinsicAmmoForWeapon(noAmmo, { standard })).toBeNull();
        expect(noAmmo.getDamageProfile(standard)).toEqual({ kind: 'special', maximum: 0 });
    });

    it('exposes intrinsic equipment classifications', () => {
        const compactHeatSinks = new MiscEquipment({
            id: '2 Compact Heat Sinks', name: '2 Compact Heat Sinks', type: 'misc',
            flags: ['F_DOUBLE_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
        });
        const armorKit = new MiscEquipment({
            id: 'armor-kit', name: 'Armor Kit', type: 'misc', flags: ['F_ARMOR_KIT'],
        });
        const internalWeapon = weapon(
            'internal', 'Internal', 'NA', 0, 0, ['INTERNAL_REPRESENTATION'],
        );

        expect(compactHeatSinks.isHeatSink).toBeTrue();
        expect(compactHeatSinks.isCompactHeatSink).toBeTrue();
        expect(compactHeatSinks.heatSinkUnitsPerMount).toBe(2);
        expect(armorKit.isArmorKit).toBeTrue();
        expect(internalWeapon.isInternalRepresentation).toBeTrue();
    });
});

function weapon(
    id: string,
    name: string,
    ammoType: AmmoType,
    damage: string | number | number[],
    rackSize: number,
    flags: string[],
): WeaponEquipment {
    return new WeaponEquipment({
        id, name, type: 'weapon', flags,
        weapon: { ammoType, damage, rackSize },
    });
}
describe('equipment damage types', () => {

    it('derives weapon types from flags and weapon data', () => {
        const weapon = new WeaponEquipment({
            id: 'Sniper Artillery Cannon',
            name: 'Sniper Artillery Cannon',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE', 'F_ARTILLERY'],
            weapon: { ammoType: 'SNIPER_CANNON', damage: 10 }
        });

        expect(weapon.getWeaponTypes()).toEqual(['DB', 'F']);
    });

    it('derives missile, cluster, and switchable types from an MML weapon', () => {
        const weapon = new WeaponEquipment({
            id: 'ISMML9',
            name: 'MML 9',
            type: 'weapon',
            weapon: { ammoType: 'MML', damage: 'cluster', rackSize: 9 }
        });

        expect(weapon.getWeaponTypes()).toEqual(['C', 'M', 'S']);
    });

    it('caps cluster size at the weapon rack size', () => {
        const mml3 = new WeaponEquipment({
            id: 'ISMML3',
            name: 'MML 3',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', damage: 'cluster', rackSize: 3 }
        });
        const mml7 = new WeaponEquipment({
            id: 'ISMML7',
            name: 'MML 7',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', damage: 'cluster', rackSize: 7 }
        });
        const hag = new WeaponEquipment({
            id: 'CLHAG20',
            name: 'HAG/20',
            type: 'weapon',
            flags: ['F_HAG'],
            weapon: { ammoType: 'HAG', damage: 'cluster', rackSize: 20 }
        });

        expect(mml3.getClusterSize(null, MML_LRM_PROFILE)).toBe(3);
        expect(mml7.getClusterSize(null, MML_LRM_PROFILE)).toBe(5);
        expect(hag.getClusterSize()).toBe(5);
    });

    it('resolves MML cluster size from its ammunition profile', () => {
        const mml9 = new WeaponEquipment({
            id: 'ISMML9',
            name: 'MML 9',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', damage: 'cluster', rackSize: 9 }
        });
        const mml3 = new WeaponEquipment({
            id: 'ISMML3',
            name: 'MML 3',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', damage: 'cluster', rackSize: 3 }
        });

        const lrmAmmo = new AmmoEquipment({
            id: 'MML9LRMAmmo', name: 'MML 9 LRM Ammo', type: 'ammo', flags: ['F_MML_LRM'],
            ammo: { type: 'MML', rackSize: 9, damagePerShot: 1 }
        });
        const srmAmmo = new AmmoEquipment({
            id: 'MML9SRMAmmo', name: 'MML 9 SRM Ammo', type: 'ammo', flags: ['F_MML_SRM'],
            ammo: { type: 'MML', rackSize: 9, damagePerShot: 2 }
        });

        expect(mml9.getClusterSize(lrmAmmo)).toBe(5);
        expect(mml9.getClusterSize(srmAmmo)).toBe(2);
        expect(mml3.getClusterSize(lrmAmmo)).toBe(3);
        expect(mml3.getClusterSize(srmAmmo)).toBe(2);
        expect(mml9.getClusterSize()).toBe(0);
        expect(mml3.getClusterSize(null, MML_LRM_PROFILE)).toBe(3);
    });

    it('returns the supported rapid-fire shot count', () => {
        const rapidFireCount = (ammoType: 'AC' | 'AC_ULTRA' | 'AC_ULTRA_THB' | 'AC_ROTARY') => new WeaponEquipment({
            id: ammoType,
            name: ammoType,
            type: 'weapon',
            weapon: { ammoType }
        }).getRapidFireCount();

        expect(rapidFireCount('AC')).toBe(0);
        expect(rapidFireCount('AC_ULTRA')).toBe(2);
        expect(rapidFireCount('AC_ULTRA_THB')).toBe(2);
        expect(rapidFireCount('AC_ROTARY')).toBe(6);
    });

    it('exposes an empty damage value for non-damaging weapon flags', () => {
        const tag = new WeaponEquipment({
            id: 'TAG',
            name: 'TAG',
            type: 'weapon',
            flags: ['F_TAG'],
            weapon: { damage: 0 }
        });
        const ams = new WeaponEquipment({
            id: 'AMS',
            name: 'AMS',
            type: 'weapon',
            flags: ['F_AMS'],
            weapon: { damage: 2 }
        });

        expect(tag.damage).toBe('');
        expect(ams.damage).toBe('');
    });

    it('derives ammo types from munition types', () => {
        const flak = new AmmoEquipment({
            id: 'Sniper Flak Ammo',
            name: 'Sniper Flak Ammo',
            type: 'ammo',
            ammo: { type: 'SNIPER_CANNON', munitionType: ['M_FLAK'] }
        });
        const cluster = new AmmoEquipment({
            id: 'Sniper Cluster Ammo',
            name: 'Sniper Cluster Ammo',
            type: 'ammo',
            ammo: { type: 'SNIPER_CANNON', munitionType: ['M_CLUSTER'] }
        });

        expect(flak.getWeaponTypes()).toEqual(['AE', 'F']);
        expect(cluster.getWeaponTypes()).toEqual(['AE', 'C']);
    });

    it('applies the LB-X cluster ammunition to-hit modifier', () => {
        const lbxCluster = new AmmoEquipment({
            id: 'ISLBXAC10Cluster',
            name: 'LB 10-X Cluster Ammo',
            type: 'ammo',
            ammo: { type: 'AC_LBX', rackSize: 10, munitionType: ['M_CLUSTER'] }
        });
        const lbxSlug = new AmmoEquipment({
            id: 'ISLBXAC10Slug',
            name: 'LB 10-X Slug Ammo',
            type: 'ammo',
            ammo: { type: 'AC_LBX', rackSize: 10, munitionType: ['M_STANDARD'] }
        });
        const artilleryCluster = new AmmoEquipment({
            id: 'SniperCluster',
            name: 'Sniper Cluster Ammo',
            type: 'ammo',
            ammo: { type: 'SNIPER', munitionType: ['M_CLUSTER'] }
        });

        expect(lbxCluster.toHitModifier).toBe(-1);
        expect(lbxSlug.toHitModifier).toBe(0);
        expect(artilleryCluster.toHitModifier).toBe(0);
    });

    it('combines mounted weapon and ammo types without duplicates', () => {
        const weapon = new WeaponEquipment({
            id: 'Sniper Artillery Cannon',
            name: 'Sniper Artillery Cannon',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE', 'F_ARTILLERY'],
            weapon: { ammoType: 'SNIPER_CANNON', damage: 10 }
        });
        const flak = new AmmoEquipment({
            id: 'Sniper Flak Ammo',
            name: 'Sniper Flak Ammo',
            type: 'ammo',
            ammo: { type: 'SNIPER_CANNON', munitionType: ['M_FLAK'] }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });

        expect(mounted.getWeaponTypes(flak)).toEqual(['AE', 'DB', 'F']);
    });

    it('does not infer mounted weapon types from hidden persisted ammo state', () => {
        const weapon = new WeaponEquipment({
            id: 'Sniper Artillery Cannon',
            name: 'Sniper Artillery Cannon',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE', 'F_ARTILLERY'],
            weapon: { ammoType: 'SNIPER_CANNON', damage: 10 }
        });
        const flak = new AmmoEquipment({
            id: 'Sniper Flak Ammo',
            name: 'Sniper Flak Ammo',
            type: 'ammo',
            ammo: { type: 'SNIPER_CANNON', munitionType: ['M_FLAK'] }
        });
        const owner = {
            getInventoryControlEntryAmmoOption: () => `${flak.internalName}:Front`,
            getAvailableEquipment: () => ({ [flak.internalName]: flak })
        } as unknown as CBTForceUnit;
        const mounted = new MountedWeapon({ owner, id: weapon.id, name: weapon.name, equipment: weapon });

        expect(mounted.getWeaponTypes()).toEqual(['DB', 'F']);
        expect(mounted.getWeaponTypes(flak)).toEqual(['AE', 'DB', 'F']);
    });

});
