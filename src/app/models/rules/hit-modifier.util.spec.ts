import { MountedEquipment } from '../force-serialization';
import { WeaponEquipment, type AmmoEquipment, type Equipment } from '../equipment.model';
import { resolveHitModifier } from './hit-modifier.util';

let entryId = 0;

function owner(unavailableEntry?: MountedEquipment) {
    return {
        ...(unavailableEntry && { isEquipmentUnavailable: (candidate: MountedEquipment) => candidate === unavailableEntry }),
        rules: {
            computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate.committedDestroyed(), isDisabled: candidate === unavailableEntry, hitMod: 0 }),
            computeAllEntryStates: () => new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>(),
            heatDissipation: () => null
        }
    } as never;
}

function entry(flags: string[] = [], destroyed = false): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `entry-${entryId++}`,
        name: 'Entry',
        equipment: { flags: new Set(flags) } as Equipment,
        destroyed,
    });
}

function weapon(linkedWith: MountedEquipment[], baseHitMod = '-1'): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `weapon-${entryId++}`,
        name: 'Weapon',
        baseHitMod,
        equipment: { flags: new Set<string>() } as Equipment,
        linkedWith
    });
}

function ammo(munitionTypes: string[] = []): AmmoEquipment {
    return {
        hasMunitionType: (munitionType: string) => munitionTypes.includes(munitionType),
    } as AmmoEquipment;
}

function serializedWeapon(toHitModifier: number | number[], baseHitMod = '-4'): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `serialized-weapon-${entryId++}`,
        name: 'Serialized weapon',
        baseHitMod,
        equipment: new WeaponEquipment({
            id: 'SerializedWeapon',
            name: 'Serialized weapon',
            type: 'weapon',
            stats: { toHitModifier },
            weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] }
        })
    });
}

describe('hit modifier utilities', () => {
    it('uses a scalar weapon modifier from equipment data', () => {
        expect(resolveHitModifier(serializedWeapon(-2), 0)).toBe(-2);
    });

    it('uses range-specific weapon modifiers from equipment data', () => {
        const weapon = serializedWeapon([-3, -2, -1]);

        expect(resolveHitModifier(weapon, 0, 'short')).toBe(-3);
        expect(resolveHitModifier(weapon, 0, 'medium')).toBe(-2);
        expect(resolveHitModifier(weapon, 0, 'long')).toBe(-1);
        expect(resolveHitModifier(weapon, 0, 'extreme')).toBe(-1);
    });

    it('resolves wildcard weapons from equipment data by range', () => {
        const weapon = serializedWeapon([-3, -2, -1], '*');

        expect(resolveHitModifier(weapon, 0)).toBe(-3);
        expect(resolveHitModifier(weapon, 0, 'short')).toBe(-3);
        expect(resolveHitModifier(weapon, 0, 'medium')).toBe(-2);
        expect(resolveHitModifier(weapon, 0, 'long')).toBe(-1);
    });

    it('falls back for a missing base override but preserves an explicit zero', () => {
        const weapon = serializedWeapon(-2);

        expect(resolveHitModifier(weapon, 0, null, null, undefined, () => null)).toBe(-2);
        expect(resolveHitModifier(weapon, 0, null, null, undefined, () => 0)).toBe(0);
    });

    it('resolves scalar and range-specific modifiers through the equipment model', () => {
        const equipment = serializedWeapon([-3, -2, -1]).equipment as WeaponEquipment;

        expect(equipment.getToHitModifier('short')).toBe(-3);
        expect(equipment.getToHitModifier('medium')).toBe(-2);
        expect(equipment.getToHitModifier('long')).toBe(-1);
        expect(equipment.getToHitModifier('extreme')).toBe(-1);
        expect(equipment.getToHitModifiers()).toEqual([-3, -2, -1]);
    });

    it('includes resolved linked modifiers in final hit modifiers', () => {
        const launcher = weapon([entry(['F_WEAPON_ENHANCEMENT'])]);

        expect(resolveHitModifier(launcher, 0, null, ammo(), () => 1)).toBe(0);
    });
});