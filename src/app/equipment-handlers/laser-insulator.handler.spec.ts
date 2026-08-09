// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { LaserInsulatorHandler } from './laser-insulator.handler';

function fixture(insulatorDestroyed = false) {
    const ownerFixture = createTestEquipmentOwner();
    const linked = new MountedEquipment({
        owner: ownerFixture.owner,
        id: 'insulator',
        name: 'Laser Insulator',
        destroyed: insulatorDestroyed,
        equipment: new MiscEquipment({ id: 'insulator', name: 'Laser Insulator', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR'] })
    });
    const parent = new MountedEquipment({
        owner: ownerFixture.owner,
        id: 'laser',
        name: 'Laser',
        equipment: new WeaponEquipment({ id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_ENERGY', 'F_LASER'], weapon: { ammoType: 'NA', heat: 3 } }),
        linkedWith: [linked],
    });
    ownerFixture.inventory.push(parent, linked);
    return { linked, parent };
}

describe('LaserInsulatorHandler', () => {
    const handler = new LaserInsulatorHandler();
    const context = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);

    it('reduces model heat while the insulator is available', () => {
        const { linked, parent } = fixture();

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, parent, { value: 3, weakened: false }, context))
            .toEqual({ value: 2, weakened: false, suffix: '*' });
    });

    it('does not reduce heat when the linked insulator is unavailable', () => {
        const { linked, parent } = fixture(true);

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, parent, { value: 3, weakened: false }, context))
            .toEqual({ value: 3, weakened: true });
    });

    it('does not reduce heat below one', () => {
        const { linked, parent } = fixture();

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, parent, { value: 1, weakened: false }, context))
            .toEqual({ value: 1, weakened: false, suffix: '*' });
    });

    it('does not affect non-laser weapons', () => {
        const { linked, parent } = fixture();
        parent.equipment!.flags.delete('F_LASER');

        expect(handler.applyLinkedInventoryControlHeatEffects(linked, parent, { value: 3, weakened: false }, context))
            .toEqual({ value: 3, weakened: false });
    });
});
