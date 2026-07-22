import { WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { type CriticalSlot } from '../models/force-serialization';
import { CORE_2026_GAME_RULES } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from '../models/rules/unit-type-rules';
import { createCBTForceUnitTestHarness } from './unit-test-helpers';

describe('CBTForceUnitTestHarness', () => {
    it('adds mounted components and registers their equipment', () => {
        const harness = createCBTForceUnitTestHarness();
        const weapon = new WeaponEquipment({ id: 'TestLaser', name: 'Test Laser', type: 'weapon' });

        const mounted = harness.addComponent({ id: 'laser', name: 'Test Laser', equipment: weapon });

        expect(mounted).toBeInstanceOf(MountedEquipment);
        expect(mounted.owner).toBe(harness.unit);
        expect(harness.unit.getInventory()).toEqual([mounted]);
        expect(harness.unit.getAvailableEquipment()[weapon.internalName]).toBe(weapon);
    });

    it('adds critical slots and exposes inventory-control runtime state', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({ id: 'laser', name: 'Test Laser' });
        const slot = harness.addCriticalSlot({ id: 'slot', loc: 'RA', slot: 0 } as CriticalSlot);

        harness.unit.setInventoryControlEntrySelected(mounted, true);

        expect(harness.unit.getCritSlots()).toEqual([slot]);
        expect(harness.unit.isInventoryControlEntrySelected(mounted.id)).toBeTrue();
    });

    it('provides production-default game rules and equipment disabled state', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({
            id: 'disabled-laser',
            name: 'Disabled Laser',
            states: new Map([[ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE]])
        });

        expect(harness.unit.gameRules).toBe(CORE_2026_GAME_RULES);
        expect(harness.unit.rules.computeEntryState(mounted).isDisabled).toBeTrue();
    });
});