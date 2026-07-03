import { MountedEquipment } from '../force-serialization';
import type { AmmoEquipment, Equipment } from '../equipment.model';
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

describe('hit modifier utilities', () => {
    it('includes resolved linked modifiers in final hit modifiers', () => {
        const launcher = weapon([entry(['F_WEAPON_ENHANCEMENT'])]);

        expect(resolveHitModifier(launcher, 0, null, ammo(), () => 1)).toBe(0);
    });
});