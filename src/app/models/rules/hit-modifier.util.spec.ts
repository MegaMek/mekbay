import { MountedEquipment } from '../force-serialization';
import { MiscEquipment, WeaponEquipment, type AmmoEquipment, type Equipment } from '../equipment.model';
import { resolveHitModifier } from './hit-modifier.util';
import { TW_RULES_DATA } from './cbt-rules-data';

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

function weapon(linkedWith: MountedEquipment[]): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `weapon-${entryId++}`,
        name: 'Weapon',
        equipment: new WeaponEquipment({
            id: 'LinkedWeapon',
            name: 'Linked weapon',
            type: 'weapon',
            stats: { toHitModifier: -1 },
            weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] }
        }),
        linkedWith
    });
}

function ammo(munitionTypes: string[] = []): AmmoEquipment {
    return {
        hasMunitionType: (munitionType: string) => munitionTypes.includes(munitionType),
    } as AmmoEquipment;
}

function serializedWeapon(toHitModifier: number | number[]): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `serialized-weapon-${entryId++}`,
        name: 'Serialized weapon',
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
        const weapon = serializedWeapon([-3, -2, -1]);

        expect(resolveHitModifier(weapon, 0)).toBe('*');
        expect(resolveHitModifier(weapon, 0, 'short')).toBe(-3);
        expect(resolveHitModifier(weapon, 0, 'medium')).toBe(-2);
        expect(resolveHitModifier(weapon, 0, 'long')).toBe(-1);
    });

    it('falls back for a missing base override but preserves an explicit zero', () => {
        const weapon = serializedWeapon(-2);

        expect(resolveHitModifier(weapon, 0, null, null, undefined, () => null)).toBe(-2);
        expect(resolveHitModifier(weapon, 0, null, null, undefined, () => 0)).toBe(0);
    });

    it('resolves core2026 base physical attack modifiers without SVG data', () => {
        const physical = (name: string) => new MountedEquipment({
            owner: owner(),
            id: name,
            name,
            physical: true,
        });

        expect(resolveHitModifier(physical('punch'), 0)).toBe(-1);
        expect(resolveHitModifier(physical('Punch'), 0)).toBe(-1);
        expect(resolveHitModifier(physical('kick'), 0)).toBe(-1);
        expect(resolveHitModifier(physical('club'), 0)).toBe(-1);
        expect(resolveHitModifier(physical('push'), 0)).toBe(-1);
        expect(resolveHitModifier(physical('charge'), 0)).toBe('Vs');
        expect(resolveHitModifier(physical('death from above'), 0)).toBe('Vs');
        expect(resolveHitModifier(physical('frenzy'), 0)).toBe(0);
    });

    it('overrides changed physical attack modifiers for TW', () => {
        const physical = (name: string) => new MountedEquipment({
            owner: owner(),
            id: name,
            name,
            physical: true,
        });

        expect(resolveHitModifier(physical('punch'), 0, null, null, undefined, undefined, TW_RULES_DATA)).toBe(0);
        expect(resolveHitModifier(physical('kick'), 0, null, null, undefined, undefined, TW_RULES_DATA)).toBe(-2);
    });

    it('uses equipment data for mounted physical weapon modifiers', () => {
        const sword = new MountedEquipment({
            owner: owner(),
            id: 'sword',
            name: 'Sword',
            equipment: new MiscEquipment({
                id: 'Sword',
                name: 'Sword',
                type: 'misc',
                flags: ['F_HAND_WEAPON'],
                stats: { toHitModifier: -2 },
            }),
        });

        expect(resolveHitModifier(sword, 0)).toBe(-2);
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