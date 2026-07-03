import { MountedEquipment } from '../models/force-serialization';
import type { AmmoEquipment, Equipment } from '../models/equipment.model';
import { ArtemisVHandler } from './artemis-v.handler';

function owner(unavailableEntry?: MountedEquipment) {
    return {
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) }
    } as never;
}

function entry(flags: string[] = [], destroyed = false): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: flags.join('-') || 'entry', name: 'Entry', equipment: { flags: new Set(flags) } as Equipment, destroyed });
}

function ammo(munitionTypes: string[] = []): AmmoEquipment {
    return { hasMunitionType: (munitionType: string) => munitionTypes.includes(munitionType) } as AmmoEquipment;
}

describe('ArtemisVHandler', () => {
    const handler = new ArtemisVHandler();

    it('does not offset intact Artemis V when Artemis V-capable ammo is selected', () => {
        expect(handler.getLinkedEquipmentHitModifier(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), entry(), ammo(['M_ARTEMIS_V_CAPABLE']))).toBe(0);
    });

    it('offsets Artemis V when selected ammo is not Artemis V-capable', () => {
        expect(handler.getLinkedEquipmentHitModifier(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), entry(), ammo(['M_ARTEMIS_CAPABLE']))).toBe(1);
        expect(handler.getLinkedEquipmentHitModifier(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), entry(), null)).toBe(1);
    });

    it('offsets Artemis V when the linked enhancement is unavailable', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']);
        artemis.owner = owner(artemis);

        expect(handler.getLinkedEquipmentHitModifier(artemis, entry(), ammo(['M_ARTEMIS_V_CAPABLE']))).toBe(1);
    });
});