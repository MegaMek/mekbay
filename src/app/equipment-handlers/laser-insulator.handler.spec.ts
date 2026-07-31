import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { LaserInsulatorHandler } from './laser-insulator.handler';

function owner(unavailableEntry?: MountedEquipment) {
    return {
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) }
    } as never;
}

function laser(insulator: MountedEquipment): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: 'laser', name: 'Laser', equipment: new WeaponEquipment({ id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_ENERGY', 'F_LASER'], weapon: { ammoType: 'NA', heat: 3 } }), linkedWith: [insulator] });
}

function insulator(): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: 'insulator', name: 'Laser Insulator', equipment: new MiscEquipment({ id: 'insulator', name: 'Laser Insulator', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'] }) });
}

describe('LaserInsulatorHandler', () => {
    const handler = new LaserInsulatorHandler();
    const context = {} as HandlerContext;

    it('reduces model heat while the insulator is available', () => {
        const linked = insulator();

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, laser(linked), { value: 3, weakened: false }, context))
            .toEqual({ value: 2, weakened: false, suffix: '*' });
    });

    it('does not reduce heat when the linked insulator is unavailable', () => {
        const linked = insulator();
        linked.owner = owner(linked);

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, laser(linked), { value: 3, weakened: false }, context))
            .toEqual({ value: 3, weakened: true });
    });

    it('does not reduce heat below one', () => {
        const linked = insulator();

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, laser(linked), { value: 1, weakened: false }, context))
            .toEqual({ value: 1, weakened: false, suffix: '*' });
    });

    it('does not affect non-laser weapons', () => {
        const linked = insulator();
        const weapon = laser(linked);
        weapon.equipment!.flags.delete('F_LASER');

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, weapon, { value: 3, weakened: false }, context))
            .toEqual({ value: 3, weakened: false });
    });
});