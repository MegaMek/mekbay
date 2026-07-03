import { MountedEquipment } from '../models/force-serialization';
import type { Equipment } from '../models/equipment.model';
import { ApolloHandler } from './apollo.handler';

function owner(unavailableEntry?: MountedEquipment) {
    return {
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) }
    } as never;
}

function entry(flags: string[] = [], destroyed = false): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: flags.join('-') || 'entry', name: 'Entry', equipment: { flags: new Set(flags) } as Equipment, destroyed });
}

describe('ApolloHandler', () => {
    const handler = new ApolloHandler();

    it('does not offset intact Apollo linked equipment', () => {
        expect(handler.getLinkedEquipmentHitModifier(entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']), entry())).toBe(0);
    });

    it('offsets unavailable Apollo linked equipment', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner = owner(apollo);

        expect(handler.getLinkedEquipmentHitModifier(apollo, entry())).toBe(1);
    });
});