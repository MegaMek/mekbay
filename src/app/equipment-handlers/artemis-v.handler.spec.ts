import { MountedEquipment } from '../models/mounted-equipment.model';
import type { AmmoEquipment, Equipment } from '../models/equipment.model';
import { ArtemisVHandler } from './artemis-v.handler';
import { EquipmentFlag } from '../models/equipment-flags.type';
import { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';

function owner(unavailableEntry?: MountedEquipment) {
    return {
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) }
    } as never;
}

function entry(flags: EquipmentFlag[] = [], destroyed = false): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: flags.join('-') || 'entry', name: 'Entry', equipment: { flags: new Set(flags) } as Equipment, destroyed });
}

function ammo(munitionTypes: AmmoMunitionFlag[] = []): AmmoEquipment {
    return { hasMunitionType: (munitionType: AmmoMunitionFlag) => munitionTypes.includes(munitionType) } as AmmoEquipment;
}

describe('ArtemisVHandler', () => {
    const handler = new ArtemisVHandler();

    it('does not offset intact Artemis V when Artemis V-capable ammo is selected', () => {
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) })).toEqual([{ kind: 'add', value: 0 }]);
    });

    it('offsets Artemis V when selected ammo is not Artemis V-capable', () => {
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(), selectedAmmo: ammo(['M_ARTEMIS_CAPABLE']) })).toEqual([{ kind: 'add', value: 1 }]);
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(), selectedAmmo: null })).toEqual([{ kind: 'add', value: 1 }]);
    });

    it('offsets Artemis V when the linked enhancement is unavailable', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']);
        artemis.owner = owner(artemis);

        expect(handler.getToHitAdjustments(artemis, { parent: entry(), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) })).toEqual([{ kind: 'add', value: 1 }]);
    });
});