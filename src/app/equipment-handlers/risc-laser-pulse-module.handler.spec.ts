import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/force-serialization';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, type InventoryControlDisplayData } from '../utils/inventory-control.util';
import { RISC_LASER_PULSE_MODE, RISC_LASER_STANDARD_MODE, RiscLaserPulseModuleHandler } from './risc-laser-pulse-module.handler';

function owner() {
    return { setInventoryEntry: jasmine.createSpy('setInventoryEntry'), rules: { computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: false, hitMod: 0 }) } } as never;
}

function laser(module: MountedEquipment, states = new Map<string, string>()): MountedEquipment {
    const entry = new MountedEquipment({
        owner: owner(),
        id: 'laser',
        name: 'Medium Laser',
        states,
        equipment: new WeaponEquipment({ id: 'laser', name: 'Medium Laser', type: 'weapon', flags: ['F_ENERGY', 'F_LASER'], weapon: { ammoType: 'NA', heat: 3 } }),
        linkedWith: [module]
    });
    module.parent = entry;
    return entry;
}

function module(destroyed = false): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: 'risc',
        name: 'RISC Laser Pulse Module',
        destroyed,
        equipment: new MiscEquipment({ id: 'risc', name: 'RISC Laser Pulse Module', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'] })
    });
}

describe('RiscLaserPulseModuleHandler', () => {
    const handler = new RiscLaserPulseModuleHandler();
    const context = {} as HandlerContext;
    const display: InventoryControlDisplayData = { name: 'Medium Laser', location: 'RA', heat: '3', damage: '5', hit: '+0', min: '-', short: '3', medium: '6', long: '9' };

    it('offers STD and PULSE modes from the linked laser row', () => {
        const linked = module();
        const entry = laser(linked);

        const choice = handler.getChoices(entry, context)[0];

        expect(choice.label).toBe('Mode');
        expect(choice.value).toBe(RISC_LASER_STANDARD_MODE);
        expect(choice.choices).toEqual([
            { label: 'STD', value: RISC_LASER_STANDARD_MODE },
            { label: 'PULSE', value: RISC_LASER_PULSE_MODE }
        ]);
    });

    it('adds pulse heat and linked hit modifier only in pulse mode', () => {
        const linked = module();
        const entry = laser(linked, new Map([[INVENTORY_CONTROL_MODE_STATE, RISC_LASER_PULSE_MODE]]));

        expect(handler.applyInventoryControlDisplayEffects(entry, display, { selectedRange: null, additionalHitModifier: 0 }, context).heat).toBe('5');
        expect(handler.getLinkedEquipmentHitModifier(linked, entry)).toBe(-2);

        entry.states.set(INVENTORY_CONTROL_MODE_STATE, RISC_LASER_STANDARD_MODE);
        expect(handler.applyInventoryControlDisplayEffects(entry, display, { selectedRange: null, additionalHitModifier: 0 }, context).heat).toBe('3');
        expect(handler.getLinkedEquipmentHitModifier(linked, entry)).toBe(0);
    });

    it('falls back to STD and allows aimed shots when the module is unavailable', () => {
        const linked = module(true);
        const entry = laser(linked, new Map([[INVENTORY_CONTROL_MODE_STATE, RISC_LASER_PULSE_MODE]]));

        expect(handler.getChoices(entry, context)).toEqual([]);
        expect(handler.applyInventoryControlDisplayEffects(entry, display, { selectedRange: null, additionalHitModifier: 0 }, context).heat).toBe('3');
        expect(handler.getLinkedEquipmentHitModifier(linked, entry)).toBe(0);
        expect(handler.canPerformAimedShot(entry, context)).toBeNull();
    });

    it('vetoes aimed shots in pulse mode', () => {
        const linked = module();
        const entry = laser(linked, new Map([[INVENTORY_CONTROL_MODE_STATE, RISC_LASER_PULSE_MODE]]));

        expect(handler.canPerformAimedShot(entry, context)).toBeFalse();
    });

});