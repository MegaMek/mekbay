import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData } from '../utils/inventory-control.util';
import { LaserInsulatorHandler } from './laser-insulator.handler';

function owner(unavailableEntry?: MountedEquipment) {
    return {
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) }
    } as never;
}

function laser(insulator: MountedEquipment): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: 'laser', name: 'Laser', equipment: new WeaponEquipment({ id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_ENERGY', 'F_LASER'], weapon: { ammoType: 'NA', heat: 4 } }), linkedWith: [insulator] });
}

function insulator(): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: 'insulator', name: 'Laser Insulator', equipment: new MiscEquipment({ id: 'insulator', name: 'Laser Insulator', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'] }) });
}

describe('LaserInsulatorHandler', () => {
    const handler = new LaserInsulatorHandler();
    const context = {} as HandlerContext;
    const display: InventoryControlDisplayData = { name: 'Laser', location: 'RA', heat: '3*', damage: '5', hit: '+0', min: '—', short: '3', medium: '6', long: '9' };

    it('keeps precomputed heat while the insulator is available', () => {
        const linked = insulator();

        expect(handler.applyInventoryControlDisplayEffects(laser(linked), display, { selectedRange: null, additionalHitModifier: 0 }, context).heat).toBe('3*');
    });

    it('adds heat back when the linked insulator is unavailable', () => {
        const linked = insulator();
        linked.owner = owner(linked);

        expect(handler.applyInventoryControlDisplayEffects(laser(linked), display, { selectedRange: null, additionalHitModifier: 0 }, context).heat).toBe('4');
    });
});