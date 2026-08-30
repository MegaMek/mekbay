// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentPanelSnapshot } from './equipment-panel';
import { selectedWeaponHeat } from './equipment-panel';

describe('selectedWeaponHeat', () => {
    it('sums only available selected ranged weapons', () => {
        const row = (
            id: string,
            firingHeat: number,
            selected: boolean,
            status: 'available' | 'destroyed' = 'available',
            selectable = true,
        ) => ({
            componentId: id as ComponentId,
            label: id,
            locations: [],
            status,
            modes: [],
            jammed: false,
            weapon: {
                firingHeat,
                selectable,
                ...(selected ? { selection: { kind: 'manual-range', range: 'short' } } : {}),
            },
        });
        const snapshot = {
            components: [
                row('selected', 3, true),
                row('unselected', 5, false),
                row('destroyed', 7, true, 'destroyed'),
                row('powered-down', 11, true, 'available', false),
            ],
            physicalAttacks: [],
        } as unknown as EquipmentPanelSnapshot;

        expect(selectedWeaponHeat(snapshot)).toEqual({ hasSelection: true, value: 3 });
    });
});
