import { AmmoEquipment, StructureEquipment, WeaponEquipment, createEquipment } from './equipment.model';
import { MountedWeapon } from './mounted-equipment.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { MML_LRM_PROFILE } from './ammo-weapon-profile.model';

describe('equipment damage types', () => {
    it('hydrates structure equipment with its structure type', () => {
        const equipment = createEquipment({
            id: 'ISEndoSteel',
            name: 'Endo Steel',
            type: 'structure',
            structure: { type: 'Endo Steel' }
        });

        expect(equipment).toBeInstanceOf(StructureEquipment);
        expect((equipment as StructureEquipment).structure.type).toBe('Endo Steel');
        expect((equipment as StructureEquipment).structureType).toBe('Endo Steel');
    });

    it('derives weapon types from flags and weapon data', () => {
        const weapon = new WeaponEquipment({
            id: 'Sniper Artillery Cannon',
            name: 'Sniper Artillery Cannon',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE', 'F_ARTILLERY'],
            weapon: { ammoType: 'SNIPER_CANNON', damage: 10 }
        });

        expect(weapon.getWeaponTypes()).toEqual(['DB','S']);
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

        expect(mounted.getWeaponTypes(flak)).toEqual(['AE', 'DB', 'F', 'S']);
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

        expect(mounted.getWeaponTypes()).toEqual(['DB', 'S']);
        expect(mounted.getWeaponTypes(flak)).toEqual(['AE', 'DB', 'F', 'S']);
    });

});
