// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment } from '../models/equipment.model';
import { TestBipedMekEntity } from '../models/entity/testing/test-entities';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../models/entity/testing/test-mounted-equipment';
import type { CriticalSlotView } from '../models/entity/types';
import { mekCriticalCaseLabel, mekCriticalSlotLabel } from './mek-critical-display.util';

describe('Mek critical display', () => {
    it('formats ammo through its mounted display name and includes the shot count', () => {
        const entity = new TestBipedMekEntity();
        const ammo = addTestEquipment(entity, new AmmoEquipment({
            id: 'IS Ammo AC/20',
            name: 'AC/20 Ammo',
            shortName: 'AC/20',
            type: 'ammo',
            ammo: { type: 'AC', shots: 5 },
        }), { location: 'LT' });
        const slot: CriticalSlotView = {
            type: 'equipment',
            mounts: [ammo],
            armored: false,
            omniPod: false,
        };

        expect(mekCriticalSlotLabel(slot, entity)).toBe('Ammo (AC/20) 5');
    });

    it('uses explicit and entity-derived Clan CASE facts', () => {
        const explicit = new TestBipedMekEntity();
        addTestEquipmentWithFlags(explicit, 'F_CASE', { location: 'LT' });
        expect(mekCriticalCaseLabel(explicit, 'LT')).toBe('CASE');

        const clan = new TestBipedMekEntity();
        clan.techBase.set('Clan');
        addTestEquipment(clan, new AmmoEquipment({
            id: 'Clan Ammo AC/20',
            name: 'AC/20 Ammo',
            shortName: 'AC/20',
            type: 'ammo',
            stats: { explosive: true },
            ammo: { type: 'AC', shots: 5 },
        }), { location: 'RT' });

        expect(clan.automaticClanCaseLocations().has('RT')).toBeTrue();
        expect(mekCriticalCaseLabel(clan, 'RT')).toBe('CASE');
    });
});
