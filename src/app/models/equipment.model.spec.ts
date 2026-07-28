import { MountedWeapon } from './mounted-equipment.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { MML_LRM_PROFILE, MML_SRM_PROFILE } from './ammo-weapon-profile.model';
import {
    AmmoEquipment,
    ArmorEquipment,
    type AmmoType,
    Equipment,
    EquipmentMap,
    findStandardAmmoForWeapon,
    findIntrinsicAmmoForWeapon,
    isBombEquipment,
    MiscEquipment,
    resolveWeaponDamage,
    StructureEquipment,
    WeaponEquipment,
    createEquipment,
} from './equipment.model';
import { getStructureByName, getStructureByTypeId } from './entity/components';
import { EquipmentFlag } from './equipment-flags.type';
import { EquipmentRegistry } from './equipment-lookup';

function catalog(equipment: EquipmentMap = {}): EquipmentRegistry {
    return new EquipmentRegistry(equipment);
}

describe('equipment model', () => {
    it('identifies fixed and variable equipment stats in one place', () => {
        const fixed = createEquipment({
            id: 'fixed', name: 'Fixed', type: 'misc',
            stats: { tonnage: 1, cost: 2, bv: 3, criticalSlots: 4 },
        });
        const variable = createEquipment({
            id: 'variable', name: 'Variable', type: 'misc',
            stats: {
                tonnage: 'variable', cost: 'variable', bv: 'variable', criticalSlots: 'variable',
            },
        });

        expect([
            fixed.hasFixedTonnage(),
            fixed.hasFixedCost(),
            fixed.hasFixedBV(),
            fixed.hasFixedCriticalSlots(),
        ]).toEqual([true, true, true, true]);
        expect([
            variable.hasFixedTonnage(),
            variable.hasFixedCost(),
            variable.hasFixedBV(),
            variable.hasFixedCriticalSlots(),
        ]).toEqual([false, false, false, false]);
    });

    it('deserializes structure records as StructureEquipment', () => {
        const equipment = createEquipment({
            id: 'IS Endo-Composite',
            name: 'Endo-Composite',
            type: 'structure',
            structure: { typeId: 6 },
            tech: { base: 'IS' },
        });

        expect(equipment).toBeInstanceOf(StructureEquipment);
        expect(equipment).not.toBeInstanceOf(MiscEquipment);
        expect(equipment.type).toBe('structure');
        expect((equipment as StructureEquipment).structureTypeId).toBe(6);
        expect(equipment.techBase).toBe('IS');
    });

    it('models armor separately from miscellaneous equipment', () => {
        const equipment = createEquipment({
            id: 'Standard Armor', name: 'Standard Armor', type: 'armor',
            armor: { type: 'STANDARD' },
        });

        expect(equipment).toBeInstanceOf(ArmorEquipment);
        expect(equipment).not.toBeInstanceOf(MiscEquipment);
        expect(equipment.type).toBe('armor');
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

        const equipmentCatalog = catalog(equipmentDb);

        expect(getStructureByTypeId(2, 'IS', equipmentCatalog)?.id).toBe('IS Endo Steel');
        expect(getStructureByName('Endo Steel', 'Clan', equipmentCatalog)?.id).toBe('Clan Endo Steel');
        expect(getStructureByTypeId(0, 'Clan', equipmentCatalog)?.id).toBe('Standard');
    });

    it('derives intrinsic weapon categories and damage profiles', () => {
        const srm = weapon('srm-6', 'SRM 6', 'SRM', 'cluster', 6, ['F_MISSILE', 'F_SRM']);
        const srmAmmo = new AmmoEquipment({
            id: 'srm-ammo', name: 'SRM Ammo', type: 'ammo',
            ammo: { type: 'SRM', rackSize: 6, damagePerShot: 2, munitionType: ['M_STANDARD'] },
        });
        const ultra = weapon('uac-10', 'Ultra AC/10', 'AC_ULTRA', 10, 10, ['F_BALLISTIC']);
        const variable = weapon('variable', 'Variable Laser', 'NA', [10, 8, 5], 0, ['F_ENERGY']);

        expect(srm.getWeaponCategory()).toBe('missile');
        expect(resolveWeaponDamage(srm, catalog({ [srmAmmo.id]: srmAmmo }), { ammo: srmAmmo })).toEqual({
            values: [2], maximum: 12, unit: 'missile',
        });
        expect(ultra.getWeaponCategory()).toBe('ballistic');
        expect(resolveWeaponDamage(ultra, catalog())).toEqual({
            values: [10], maximum: 20, unit: 'shot',
        });
        expect(variable.getWeaponCategory()).toBe('energy');
        expect(resolveWeaponDamage(variable, catalog())).toEqual({
            values: [10, 8, 5], maximum: 10,
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

    it('preserves raw catalog damage for non-damaging UI classifications', () => {
        const ams = weapon('ams', 'AMS', 'NA', 2, 0, ['F_AMS']);
        const tag = weapon('tag', 'TAG', 'NA', 0, 0, ['F_TAG']);

        expect(ams.damage).toBe('');
        expect(resolveWeaponDamage(ams, catalog())).toEqual({ values: [2], maximum: 2 });
        expect(resolveWeaponDamage(tag, catalog())).toEqual({ values: [0], maximum: 0 });
    });

    it('uses standard ammunition damage for large-missile launchers', () => {
        const thunderbolt = weapon('thunderbolt-5', 'Thunderbolt 5', 'TBOLT_5', 'cluster', 1,
            ['F_MISSILE', 'F_LARGE_MISSILE']);
        const ammo = new AmmoEquipment({
            id: 'thunderbolt-5-ammo', name: 'Thunderbolt 5 Ammo', type: 'ammo',
            ammo: { type: 'TBOLT_5', rackSize: 1, damagePerShot: 5, munitionType: ['M_STANDARD'] },
        });

        expect(findIntrinsicAmmoForWeapon(thunderbolt, catalog({ [ammo.id]: ammo }))).toBe(ammo);
        expect(resolveWeaponDamage(thunderbolt, catalog({ [ammo.id]: ammo }))).toEqual({
            values: [5], maximum: 5,
        });
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

        expect(findIntrinsicAmmoForWeapon(mineLauncher, catalog({ wrongRack, alternate, standard }))).toBe(standard);
        expect(resolveWeaponDamage(mineLauncher, catalog({ standard }), { ammo: standard }))
            .toEqual({ values: [4], maximum: 4 });
        expect(resolveWeaponDamage(mineLauncher, catalog()))
            .toEqual({ values: [], maximum: 0, label: 'Special' });

        const repeating = weapon('repeating', 'Repeating', 'MINE', 'special', 1, []);
        expect(findIntrinsicAmmoForWeapon(repeating, catalog({ standard }))).toBeNull();
        expect(resolveWeaponDamage(repeating, catalog({ standard }), { ammo: standard }))
            .toEqual({ values: [], maximum: 0, label: 'Special' });

        const noAmmo = weapon('no-ammo', 'No Ammo', 'NA', 'special', 0, ['F_ONE_SHOT']);
        expect(findIntrinsicAmmoForWeapon(noAmmo, catalog({ standard }))).toBeNull();
        expect(resolveWeaponDamage(noAmmo, catalog({ standard }), { ammo: standard }))
            .toEqual({ values: [], maximum: 0, label: 'Special' });
    });

    it('prefers plain standard intrinsic ammo over modified standard ammunition', () => {
        const launcher = weapon('launcher', 'Launcher', 'LRM', 'cluster', 5, ['F_ONE_SHOT', 'F_BA_WEAPON']);
        const conventionalStandard = new AmmoEquipment({
            id: 'conventional-standard', name: 'Conventional Standard', type: 'ammo',
            ammo: { type: 'LRM', rackSize: 5, munitionType: ['M_STANDARD'] },
        });
        const incendiary = new AmmoEquipment({
            id: 'incendiary', name: 'Incendiary', type: 'ammo', flags: ['F_BATTLEARMOR'],
            ammo: { type: 'LRM', rackSize: 5, munitionType: ['M_STANDARD', 'M_INCENDIARY_LRM'] },
        });
        const standard = new AmmoEquipment({
            id: 'standard', name: 'Standard', type: 'ammo', flags: ['F_BATTLEARMOR'],
            ammo: { type: 'LRM', rackSize: 5, munitionType: ['M_STANDARD'] },
        });

        expect(findIntrinsicAmmoForWeapon(launcher, catalog({ conventionalStandard, incendiary, standard }))).toBe(standard);
    });

    it('resolves cluster damage from catalog ammo when the unit carries none', () => {
        const atm = weapon('atm-6', 'ATM 6', 'ATM', 'cluster', 6, ['F_MISSILE', 'F_ATM']);
        const standard = new AmmoEquipment({
            id: 'atm-standard', name: 'ATM 6 Ammo', type: 'ammo',
            ammo: { type: 'ATM', rackSize: 6, damagePerShot: 2, munitionType: ['M_STANDARD'] },
        });
        const wrongRack = new AmmoEquipment({
            id: 'atm-wrong-rack', name: 'ATM 3 Ammo', type: 'ammo',
            ammo: { type: 'ATM', rackSize: 3, damagePerShot: 9, munitionType: ['M_STANDARD'] },
        });

        expect(findStandardAmmoForWeapon(atm, catalog({ wrongRack, standard }))).toBe(standard);
        expect(resolveWeaponDamage(atm, catalog({ wrongRack, standard }))).toEqual({
            values: [2], maximum: 12, unit: 'missile',
        });
    });

    it('uses compatible selected ammo and rejects incompatible selected ammo', () => {
        const atm = weapon('atm-6', 'ATM 6', 'ATM', 'cluster', 6, ['F_MISSILE', 'F_ATM']);
        const standard = new AmmoEquipment({
            id: 'atm-standard', name: 'ATM 6 Ammo', type: 'ammo',
            ammo: { type: 'ATM', rackSize: 6, damagePerShot: 2, munitionType: ['M_STANDARD'] },
        });
        const selected = new AmmoEquipment({
            id: 'atm-he', name: 'ATM 6 HE Ammo', type: 'ammo',
            ammo: { type: 'ATM', rackSize: 6, damagePerShot: 3, munitionType: ['M_HIGH_EXPLOSIVE'] },
        });
        const wrongRack = new AmmoEquipment({
            id: 'atm-3-he', name: 'ATM 3 HE Ammo', type: 'ammo',
            ammo: { type: 'ATM', rackSize: 3, damagePerShot: 9, munitionType: ['M_HIGH_EXPLOSIVE'] },
        });

        expect(resolveWeaponDamage(atm, catalog({ standard }), { ammo: selected })).toEqual({
            values: [3], maximum: 18, unit: 'missile',
        });
        expect(resolveWeaponDamage(atm, catalog({ standard }), { ammo: wrongRack })).toEqual({
            values: [2], maximum: 12, unit: 'missile',
        });
    });

    it('selects MML catalog damage by firing profile', () => {
        const mml = weapon('mml-7', 'MML 7', 'MML', 'cluster', 7, ['F_MISSILE', 'F_MML']);
        const lrm = new AmmoEquipment({
            id: 'mml-lrm', name: 'MML 7 LRM Ammo', type: 'ammo', flags: ['F_MML_LRM'],
            ammo: { type: 'MML', rackSize: 7, damagePerShot: 1, munitionType: ['M_STANDARD'] },
        });
        const srm = new AmmoEquipment({
            id: 'mml-srm', name: 'MML 7 SRM Ammo', type: 'ammo', flags: ['F_MML_SRM'],
            ammo: { type: 'MML', rackSize: 7, damagePerShot: 2, munitionType: ['M_STANDARD'] },
        });

        expect(resolveWeaponDamage(mml, catalog({ lrm, srm }), { ammoProfile: MML_LRM_PROFILE }))
            .toEqual({ values: [1], maximum: 7, unit: 'missile' });
        expect(resolveWeaponDamage(mml, catalog({ lrm, srm }), { ammoProfile: MML_SRM_PROFILE }))
            .toEqual({ values: [2], maximum: 14, unit: 'missile' });
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

    it('identifies physical shields from club and shield-size semantics', () => {
        const shield = new MiscEquipment({
            id: 'shield', name: 'Shield', type: 'misc', flags: ['F_CLUB', 'S_SHIELD_MEDIUM'],
        });
        const club = new MiscEquipment({
            id: 'club', name: 'Club', type: 'misc', flags: ['F_CLUB'],
        });
        const malformed = new MiscEquipment({
            id: 'malformed-shield', name: 'Malformed Shield', type: 'misc', flags: ['S_SHIELD_MEDIUM'],
        });

        expect(shield.isShield).toBeTrue();
        expect(club.isShield).toBeFalse();
        expect(malformed.isShield).toBeFalse();
    });

    it('identifies bomb ammo and bomb weapons without misclassifying carriers or ordinary ordnance', () => {
        for (const flag of ['F_ALT_BOMB', 'F_DIVE_BOMB', 'F_GROUND_BOMB', 'F_OTHER_BOMB', 'F_SPACE_BOMB'] as const) {
            const bomb = new AmmoEquipment({
                id: flag, name: flag, type: 'ammo', flags: [flag], ammo: { type: 'BOMB' },
            });
            expect(isBombEquipment(bomb)).withContext(flag).toBeTrue();
        }
        const bombWeapon = weapon('bomb-weapon', 'Bomb Weapon', 'BOMB', 10, 1, ['F_BOMB_WEAPON']);
        const ordinaryAmmo = new AmmoEquipment({
            id: 'ordinary-ammo', name: 'Ordinary Ammo', type: 'ammo', ammo: { type: 'LRM' },
        });
        const bombBay = new MiscEquipment({
            id: 'bomb-bay', name: 'Bomb Bay', type: 'misc', flags: ['F_BOMB_BAY'],
        });

        expect(isBombEquipment(bombWeapon)).toBeTrue();
        expect(isBombEquipment(ordinaryAmmo)).toBeFalse();
        expect(isBombEquipment(bombBay)).toBeFalse();
        expect(isBombEquipment(new Equipment({ id: 'plain', name: 'Plain', type: 'misc' }))).toBeFalse();
    });
});

function weapon(
    id: string,
    name: string,
    ammoType: AmmoType,
    damage: string | number | number[],
    rackSize: number,
    flags: EquipmentFlag[],
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
        expect(weapon.supportsSwitchableAmmo).toBeTrue();
    });

    it('identifies switchable ammo independently from one-shot status', () => {
        const oneShotLrm = new WeaponEquipment({
            id: 'ISBALRM5OS', name: 'LRM 5 (OS)', type: 'weapon', flags: ['F_ONE_SHOT'],
            weapon: { ammoType: 'LRM', rackSize: 5, damage: 'cluster' },
        });
        const mineLauncher = new WeaponEquipment({
            id: 'BAMineLauncher', name: 'Pop-up Mine', type: 'weapon', flags: ['F_ONE_SHOT'],
            weapon: { ammoType: 'MINE', rackSize: 1, damage: 'special' },
        });

        expect(oneShotLrm.supportsSwitchableAmmo).toBeTrue();
        expect(oneShotLrm.getWeaponTypes()).toEqual(['C', 'M', 'OS', 'S']);
        expect(mineLauncher.supportsSwitchableAmmo).toBeFalse();
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
            getEquipmentRegistry: () => new EquipmentRegistry({ [flak.internalName]: flak })
        } as unknown as CBTForceUnit;
        const mounted = new MountedWeapon({ owner, id: weapon.id, name: weapon.name, equipment: weapon });

        expect(mounted.getWeaponTypes()).toEqual(['DB', 'F']);
        expect(mounted.getWeaponTypes(flak)).toEqual(['AE', 'DB', 'F']);
    });

});
