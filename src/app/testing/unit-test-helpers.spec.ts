// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
        expect(harness.unit.getEquipmentRegistry().findEquipment(weapon.internalName)).toBe(weapon);
    });

    it('does not expose dissipation when the unit does not track heat', () => {
        const harness = createCBTForceUnitTestHarness({ tracksHeat: false, heatDissipation: 10 });

        expect(harness.unit.rules.heatDissipation()).toBeNull();
        expect(harness.turnState.heatDissipationBalance()).toBe(0);
        expect(harness.turnState.effectiveHeatDissipation()).toBe(0);
    });

    it('preserves switched-off heat sinks and tracks fired heat', () => {
        const harness = createCBTForceUnitTestHarness({
            heat: { heatsinksOff: 3 },
            heatDissipation: 10
        });

        harness.turnState.addFiredHeat(4);
        harness.turnState.addFiredHeat(-1);

        expect(harness.unit.rules.heatDissipation()?.heatsinksOff).toBe(3);
        expect(harness.turnState.heatSources()).toContain(jasmine.objectContaining({ id: 'weapons', value: 4 }));
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
        expect(harness.unit.rules.getEquipmentStatus(mounted)).toBe('disabled');
    });

    it('reports no active conditions by default', () => {
        const harness = createCBTForceUnitTestHarness();

        expect(harness.unit.getCondition('jammed')).toBeFalse();
        expect(harness.unit.getConditions().has('jammed')).toBeFalse();
    });

    it('reports configured active conditions', () => {
        const harness = createCBTForceUnitTestHarness({ conditions: ['jammed'] });

        expect(harness.unit.getCondition('jammed')).toBeTrue();
        expect(harness.unit.getCondition('shutdown')).toBeFalse();
        expect(harness.unit.getConditions().has('jammed')).toBeTrue();
    });
});