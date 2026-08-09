// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import { RISC_LASER_PULSE_MODE, RISC_LASER_STANDARD_MODE, RiscLaserPulseModuleHandler } from './risc-laser-pulse-module.handler';

function fixture(moduleDestroyed = false, states = new Map<string, string>()) {
    const ownerFixture = createTestEquipmentOwner();
    const { owner } = ownerFixture;
    const linked = new MountedEquipment({
        owner,
        id: 'risc',
        name: 'RISC Laser Pulse Module',
        destroyed: moduleDestroyed,
        equipment: new MiscEquipment({ id: 'risc', name: 'RISC Laser Pulse Module', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'] })
    });
    const entry = new MountedEquipment({
        owner,
        id: 'laser',
        name: 'Medium Laser',
        states,
        equipment: new WeaponEquipment({ id: 'laser', name: 'Medium Laser', type: 'weapon', flags: ['F_ENERGY', 'F_LASER'], weapon: { ammoType: 'NA', heat: 3 } }),
        linkedWith: [linked]
    });
    ownerFixture.inventory.push(entry, linked);
    return { entry, linked };
}

describe('RiscLaserPulseModuleHandler', () => {
    const handler = new RiscLaserPulseModuleHandler();
    const context = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    it('offers STD and PULSE modes from the linked laser row', () => {
        const { entry } = fixture();

        const choice = handler.getChoices(entry, context)[0];

        expect(choice.label).toBe('Mode');
        expect(choice.value).toBe(RISC_LASER_STANDARD_MODE);
        expect(choice.choices).toEqual([
            { label: 'STD', value: RISC_LASER_STANDARD_MODE },
            { label: 'PULSE', value: RISC_LASER_PULSE_MODE }
        ]);
    });

    it('adds pulse heat and linked hit modifier only in pulse mode', () => {
        const { linked, entry } = fixture(false, new Map([[INVENTORY_CONTROL_MODE_STATE, RISC_LASER_PULSE_MODE]]));

        expect(handler.applyInventoryControlHeatEffects(entry, { value: 3, weakened: false }, context))
            .toEqual({ value: 5, weakened: false });
        expect(handler.getToHitAdjustments(linked, { parent: entry }, context)).toEqual([{
            kind: 'add', label: 'RISC Laser Pulse Module', modifier: -2
        }]);

        entry.states.set(INVENTORY_CONTROL_MODE_STATE, RISC_LASER_STANDARD_MODE);
        expect(handler.applyInventoryControlHeatEffects(entry, { value: 3, weakened: false }, context))
            .toEqual({ value: 3, weakened: false });
        expect(handler.getToHitAdjustments(linked, { parent: entry }, context)).toEqual([{
            kind: 'add', label: 'RISC Laser Pulse Module Inactive', modifier: 0
        }]);
    });

    it('falls back to STD and allows aimed shots when the module is unavailable', () => {
        const { linked, entry } = fixture(true, new Map([[INVENTORY_CONTROL_MODE_STATE, RISC_LASER_PULSE_MODE]]));

        expect(handler.getChoices(entry, context)).toEqual([]);
        expect(handler.applyInventoryControlHeatEffects(entry, { value: 3, weakened: false }, context))
            .toEqual({ value: 3, weakened: false });
        expect(handler.getToHitAdjustments(linked, { parent: entry }, context)).toEqual([{
            kind: 'add', label: 'RISC Laser Pulse Module Inactive', modifier: 0
        }]);
        expect(handler.canPerformAimedShot(entry, context)).toBeNull();
    });

    it('vetoes aimed shots in pulse mode', () => {
        const { entry } = fixture(false, new Map([[INVENTORY_CONTROL_MODE_STATE, RISC_LASER_PULSE_MODE]]));

        expect(handler.canPerformAimedShot(entry, context)).toBeFalse();
    });

});
