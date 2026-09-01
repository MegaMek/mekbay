// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { SpotWelderHandler } from './spot-welder.handler';

describe('SpotWelderHandler', () => {
    const handler = new SpotWelderHandler();
    const context = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);

    function fixture() {
        const removeFiredHeat = jasmine.createSpy('removeFiredHeat');
        const { owner } = createTestEquipmentOwner();
        Object.assign(owner, { turnState: () => ({ removeFiredHeat }) });
        const equipment = new MiscEquipment({
            id: 'ISSpotWelder',
            name: 'Spot Welder',
            type: 'misc',
            flags: ['F_CLUB', 'S_SPOT_WELDER'],
        });
        const mounted = new MountedEquipment({
            owner,
            id: equipment.id,
            name: equipment.name,
            equipment,
        });
        owner.setInventoryEntry(mounted);
        return { mounted, removeFiredHeat };
    }

    it('displays two heat and moves fired heat into grouped Equipment heat', () => {
        const { mounted, removeFiredHeat } = fixture();

        expect(handler.getInventoryControlHeatEffect())
            .toEqual({ value: 2, weakened: false });
        handler.afterInventoryControlFire(mounted);

        expect(removeFiredHeat).toHaveBeenCalledOnceWith(2);
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, context)).toEqual([{
            id: `spot-welder:${mounted.id}`,
            label: 'Spot Welder',
            value: 2,
            group: 'Equipment',
        }]);
    });

    it('counts repeated uses and clears only the per-turn heat state', () => {
        const { mounted } = fixture();
        handler.afterInventoryControlFire(mounted);
        handler.afterInventoryControlFire(mounted);
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, context)[0].value).toBe(4);

        handler.onEndTurn(mounted);
        expect(handler.getInventoryHeatSources(mounted, {} as TurnState, context)).toEqual([]);
    });
});
