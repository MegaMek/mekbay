import { AmmoEquipment, EquipmentMap, StructureEquipment, WeaponEquipment, type AmmoType } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import {
    inventoryControlDamageRange,
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

    it('preserves Extreme range for its dedicated damage rules', () => {
        expect(inventoryControlDamageRange('extreme')).toBe('extreme');
        expect(inventoryControlDamageRange('medium')).toBe('medium');
        expect(inventoryControlDamageRange(null)).toBeNull();
    });

    it('uses Long variable damage at Extreme range', () => {
        const weapon = new WeaponEquipment({
            id: 'VariableLaser',
            name: 'Variable Laser',
            type: 'weapon',
            weapon: { damage: [10, 8, 5] },
        });

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: 'extreme',
            selectedAmmo: null,
            equipmentCatalog: catalog(),
        })).toBe('5 [V]');
    });

    it('halves Pulse Weapon damage at Extreme range, rounding down', () => {
        const weapon = directWeapon('PulseLaser', 'Pulse Laser', 9, ['F_ENERGY', 'F_PULSE']);

        expect(extremeDamageText(weapon)).toBe('4 [P]');
        expect(damageTextAtRange(weapon, 'long')).toBe('9 [P]');
    });

    it('subtracts one damage from Direct-Fire Energy weapons at Extreme range', () => {
        const weapon = directWeapon('LargeLaser', 'Large Laser', 8, ['F_ENERGY']);

        expect(extremeDamageText(weapon)).toBe('7 [DE]');
    });

    it('subtracts one damage from Gauss weapons except HAGs at Extreme range', () => {
        const gauss = directWeapon('GaussRifle', 'Gauss Rifle', 15, ['F_BALLISTIC', 'F_GAUSS']);
        const hag = new WeaponEquipment({
            id: 'HAG20',
            name: 'HAG/20',
            type: 'weapon',
            flags: ['F_DIRECT_FIRE', 'F_BALLISTIC', 'F_GAUSS', 'F_HAG'],
            weapon: { damage: 20, ammoType: 'HAG', rackSize: 20 },
        });

        expect(extremeDamageText(gauss)).toBe('14 [DB]');
        expect(extremeDamageText(hag)).toBe('20 [C5,DB]');
    });

    it('multiplies non-Gauss Direct-Fire Ballistic damage by 0.75 at Extreme range', () => {
        const weapon = directWeapon('AC10', 'AC/10', 10, ['F_BALLISTIC']);

        expect(extremeDamageText(weapon)).toBe('7 [DB]');
    });

    it('applies Extreme reductions after equipment damage effects', () => {
        const weapon = directWeapon('ModifiedLaser', 'Modified Laser', 8, ['F_ENERGY']);

        expect(resolveInventoryControlDamageText(mount(weapon), {
            selectedRange: 'extreme',
            selectedAmmo: null,
            equipmentCatalog: catalog(),
        }, {
            applyDamageEffects: (_entry, damage) => ({
                ...damage,
                values: damage.values.map(value => value + 5),
                maximum: damage.maximum + 5,
            }),
        })).toBe('12 [DE]');
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

function directWeapon(
    id: string,
    name: string,
    damage: number,
    flags: EquipmentFlag[],
): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name,
        type: 'weapon',
        flags: ['F_DIRECT_FIRE', ...flags],
        weapon: { damage },
    });
}

function extremeDamageText(weapon: WeaponEquipment): string | null {
    return damageTextAtRange(weapon, 'extreme');
}

function damageTextAtRange(
    weapon: WeaponEquipment,
    selectedRange: 'short' | 'medium' | 'long' | 'extreme',
): string | null {
    const mounted = new MountedWeapon({
        owner: {} as CBTForceUnit,
        id: weapon.id,
        name: weapon.name,
        equipment: weapon,
    });
    return resolveInventoryControlDamageText(mounted, {
        selectedRange,
        selectedAmmo: null,
        equipmentCatalog: catalog(),
    });
}