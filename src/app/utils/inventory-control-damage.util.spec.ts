import { AmmoEquipment, EquipmentMap, StructureEquipment, WeaponEquipment, type AmmoType } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import {
    resolveDefaultWeaponDamageText,
    resolveInventoryControlDamageText,
    resolveInventoryControlWeaponDamage,
} from './inventory-control-damage.util';
import { MML_LRM_PROFILE, MML_SRM_PROFILE } from '../models/ammo-weapon-profile.model';

function catalog(equipment: EquipmentMap = {}): EquipmentRegistry {
    return new EquipmentRegistry(equipment);
}

describe('inventory-control damage resolution', () => {
    const mount = (weapon: WeaponEquipment) =>
        new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });

    it('resolves range damage and applies damage modifiers once', () => {
        const weapon = new WeaponEquipment({
            id: 'VariableLaser',
            name: 'Variable Laser',
            type: 'weapon',
            flags: ['F_ENERGY'],
            weapon: { damage: [10, 8, 5] },
        });
        const applyDamageEffects = jasmine.createSpy('applyDamageEffects').and.callFake((_entry, damage: any) => ({
            ...damage,
            values: damage.values.map((value: number) => value + 1),
            maximum: damage.maximum + 1,
        }));

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: 'medium',
            selectedAmmo: null,
            equipmentCatalog: catalog(),
        }, {
            applyDamageEffects,
        })).toBe('9 [V]');
        expect(applyDamageEffects).toHaveBeenCalledTimes(1);
    });

    it('formats non-damaging weapon classifications without a zero', () => {
        const tag = new WeaponEquipment({
            id: 'TAG',
            name: 'TAG',
            type: 'weapon',
            flags: ['F_TAG'],
            weapon: { damage: 0 },
        });
        const ams = new WeaponEquipment({
            id: 'AMS',
            name: 'AMS',
            type: 'weapon',
            flags: ['F_AMS'],
            weapon: { damage: 2 },
        });

        expect(resolveDefaultWeaponDamageText(tag, catalog())).toBe('[E]');
        expect(resolveDefaultWeaponDamageText(ams, catalog())).toBe('[PB]');
    });

    it('preserves fractional catalog damage precision', () => {
        const infantryWeapon = new WeaponEquipment({
            id: 'rifle',
            name: 'Rifle',
            type: 'weapon',
            weapon: { damage: 0.52 },
        });

        expect(resolveDefaultWeaponDamageText(infantryWeapon, catalog())).toBe('0.52');
    });

    it('uses mounted ammunition when it is compatible', () => {
        const weapon = missile('ATM6', 'ATM', 6);
        const ammo = ammunition('ATM6HE', 'ATM', 6, 3, ['M_HIGH_EXPLOSIVE']);

        const resolution = resolveInventoryControlWeaponDamage(mount(weapon), {
            selectedRange: null,
            selectedAmmo: ammo,
            equipmentCatalog: catalog(),
        });

        expect(resolution?.text).toBe('3/Msl [C6,M,S]');
        expect(resolution?.damageTypes).toEqual(['C', 'M', 'S']);
        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: null,
            selectedAmmo: ammo,
            equipmentCatalog: catalog(),
        })).toBe('3/Msl [C6,M,S]');
    });

    it('falls back to catalog ammunition when mounted ammo is absent', () => {
        const weapon = missile('ATM6', 'ATM', 6);
        const standard = ammunition('ATM6Standard', 'ATM', 6, 2, ['M_STANDARD']);

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog: catalog({ [standard.id]: standard }),
        })).toBe('2/Msl [C6,M,S]');
    });

    it('falls back to catalog ammunition when mounted ammo is incompatible', () => {
        const weapon = missile('ATM6', 'ATM', 6);
        const wrongRack = ammunition('ATM3HE', 'ATM', 3, 9, ['M_HIGH_EXPLOSIVE']);
        const standard = ammunition('ATM6Standard', 'ATM', 6, 2, ['M_STANDARD']);

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: null,
            selectedAmmo: wrongRack,
            equipmentCatalog: catalog({ [standard.id]: standard }),
        })).toBe('2/Msl [C6,M,S]');
    });

    it('uses the selected catalog profile for an unloaded MML', () => {
        const weapon = missile('MML9', 'MML', 9);
        const lrm = ammunition('MML9LRM', 'MML', 9, 1, ['M_STANDARD'], ['F_MML_LRM']);
        const srm = ammunition('MML9SRM', 'MML', 9, 2, ['M_STANDARD'], ['F_MML_SRM']);
        const equipmentCatalog = catalog({ [lrm.id]: lrm, [srm.id]: srm });

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog,
            ammoProfile: MML_LRM_PROFILE,
        })).toBe('1/Msl [C5,M,S]');
        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog,
            ammoProfile: MML_SRM_PROFILE,
        })).toBe('2/Msl [C2,M,S]');
    });

    it('uses loaded MML ammunition without requiring a weapon mode', () => {
        const weapon = missile('MML9', 'MML', 9);
        const srmAmmo = ammunition('MML9SRMAmmo', 'MML', 9, 4, ['M_STANDARD'], ['F_MML_SRM']);

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: null,
            selectedAmmo: srmAmmo,
            equipmentCatalog: catalog(),
        })).toBe('4/Msl [C2,M,S]');
    });

    it('formats rapid-fire, HAG, Mek Mortar, and BA Tube semantics', () => {
        const ultra = new WeaponEquipment({
            id: 'UAC5',
            name: 'UAC/5',
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType: 'AC_ULTRA', damage: 5 },
        });
        const hag = missile('HAG20', 'HAG', 20, ['F_HAG']);
        const mortar = missile('Mortar4', 'MEK_MORTAR', 4);
        const tube = missile('ISBATubeArtillery', 'BA_TUBE', 3, ['F_ARTILLERY', 'F_MEK_MORTAR']);

        expect(resolveDefaultWeaponDamageText(ultra, catalog())).toBe('5/Sht [DB,R2]');
        expect(resolveDefaultWeaponDamageText(hag, catalog())).toBe('20 [C5,M]');
        expect(resolveDefaultWeaponDamageText(mortar, catalog())).toBe('special [C,M,S]');
        expect(resolveDefaultWeaponDamageText(tube, catalog())).toBe('Cluster [AE,C,F,M,S]');
    });

    it('returns null for non-weapon entries', () => {
        const equipment = new StructureEquipment({ id: 'structure', name: 'Structure', type: 'structure' });
        const mounted = new MountedEquipment({ owner: {} as CBTForceUnit, id: equipment.id, name: equipment.name, equipment });

        expect(resolveInventoryControlDamageText(mounted, {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog: catalog(),
        })).toBeNull();
    });
});

function missile(
    id: string,
    ammoType: AmmoType,
    rackSize: number,
    extraFlags: EquipmentFlag[] = [],
): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        flags: ['F_MISSILE', ...extraFlags],
        weapon: { ammoType, rackSize, damage: 'cluster' },
    });
}

function ammunition(
    id: string,
    type: AmmoType,
    rackSize: number,
    damagePerShot: number,
    munitionType: AmmoMunitionFlag[],
    flags: EquipmentFlag[] = [],
): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        type: 'ammo',
        flags,
        ammo: { type, rackSize, damagePerShot, munitionType },
    });
}