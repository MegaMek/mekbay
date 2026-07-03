import { MountedEquipment } from '../force-serialization';
import type { AmmoEquipment, Equipment } from '../equipment.model';
import { computeLinkedModifiers, resolveHitModifier } from './hit-modifier.util';

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

function unavailable(entry: MountedEquipment): MountedEquipment {
    entry.owner = owner(entry);
    return entry;
}

describe('hit modifier utilities', () => {
    it('does not offset intact Artemis V or Apollo linked equipment bonuses', () => {
        expect(computeLinkedModifiers(weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'])]))).toBe(0);
        expect(computeLinkedModifiers(weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'])]))).toBe(0);
    });

    it('offsets Artemis V and Apollo linked equipment bonuses when their enhancement is destroyed', () => {
        expect(computeLinkedModifiers(weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'], true)]))).toBe(1);
        expect(computeLinkedModifiers(weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], true)]))).toBe(1);
    });

    it('offsets Artemis V and Apollo linked equipment bonuses when their enhancement is disabled', () => {
        const artemis = unavailable(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']));
        const apollo = unavailable(entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']));

        expect(computeLinkedModifiers(weapon([artemis]))).toBe(1);
        expect(computeLinkedModifiers(weapon([apollo]))).toBe(1);
    });

    it('offsets intact Artemis V linked equipment when selected ammo is not Artemis V-capable', () => {
        const artemisVWeapon = weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'])]);

        expect(computeLinkedModifiers(artemisVWeapon, ammo(['M_ARTEMIS_V_CAPABLE']))).toBe(0);
        expect(computeLinkedModifiers(artemisVWeapon, ammo(['M_ARTEMIS_CAPABLE']))).toBe(1);
        expect(computeLinkedModifiers(artemisVWeapon, null)).toBe(1);
    });

    it('does not make Apollo ammo-sensitive', () => {
        const apolloWeapon = weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'])]);

        expect(computeLinkedModifiers(apolloWeapon, ammo())).toBe(0);
    });

    it('does not offset destroyed linked enhancements without equipment to-hit bonuses', () => {
        expect(computeLinkedModifiers(weapon([entry(['F_ARTEMIS'], true)]))).toBe(0);
        expect(computeLinkedModifiers(weapon([entry(['F_WEAPON_ENHANCEMENT'], true)]))).toBe(0);
        expect(computeLinkedModifiers(weapon([entry(['F_APOLLO'], true)]))).toBe(0);
    });

    it('resolves Artemis V linked equipment bonuses with selected ammo context', () => {
        const artemisVWeapon = weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V'])]);

        expect(resolveHitModifier(artemisVWeapon, 0, null, ammo(['M_ARTEMIS_V_CAPABLE']))).toBe(-1);
        expect(resolveHitModifier(artemisVWeapon, 0, null, ammo(['M_ARTEMIS_CAPABLE']))).toBe(0);
        expect(resolveHitModifier(artemisVWeapon, 0, null, null)).toBe(0);
    });

    it('resolves Apollo linked equipment bonuses without ammo sensitivity', () => {
        const apolloWeapon = weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'])]);
        const destroyedApolloWeapon = weapon([entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], true)]);

        expect(resolveHitModifier(apolloWeapon, 0, null, ammo())).toBe(-1);
        expect(resolveHitModifier(destroyedApolloWeapon, 0, null, ammo())).toBe(0);
    });

    it('resolves disabled linked equipment bonuses as unavailable', () => {
        const artemis = unavailable(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']));
        const artemisVWeapon = weapon([artemis]);

        expect(resolveHitModifier(artemisVWeapon, 0, null, ammo(['M_ARTEMIS_V_CAPABLE']))).toBe(0);
    });
});