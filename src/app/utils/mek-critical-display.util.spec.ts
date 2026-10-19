// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment } from '../models/equipment.model';
import { TestBipedMekEntity } from '../models/entity/testing/test-entities';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../models/entity/testing/test-mounted-equipment';
import type { CriticalSlotView } from '../models/entity/types';
import {
    formatMekCriticalSlotLines,
    mekCriticalCaseLabel,
    mekCriticalEquipmentRuns,
    mekCriticalSlotLines,
} from './mek-critical-display.util';

describe('Mek critical display', () => {
    it('finds multi-slot equipment runs that empty slots break and shared slots join', () => {
        const slots: (readonly string[] | undefined)[] = [];
        slots[0] = ['lrm'];
        slots[1] = ['lrm'];
        slots[2] = ['lrm', 'heat-sink'];
        slots[3] = ['heat-sink'];
        slots[4] = ['laser'];
        slots[6] = ['laser'];
        expect(mekCriticalEquipmentRuns(slots)).toEqual([
            { first: 0, last: 2 },
            { first: 2, last: 3 },
        ]);
    });

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

        expect(mekCriticalSlotLines(slot, entity, 'LT', 0)).toEqual(['Ammo (AC/20) 5']);
    });

    it('sums superheavy bins of one ammo into a single line', () => {
        const entity = new TestBipedMekEntity();
        entity.setTonnage(135);
        const ammo = new AmmoEquipment({
            id: 'Clan Streak SRM 6 Ammo',
            name: 'Streak SRM 6 Ammo',
            shortName: 'Streak SRM 6',
            type: 'ammo',
            ammo: { type: 'SRM_STREAK', shots: 15 },
        });
        const slot: CriticalSlotView = {
            type: 'equipment',
            mounts: [addTestEquipment(entity, ammo, { location: 'RA' }), addTestEquipment(entity, ammo, { location: 'RA' })],
            armored: false,
            omniPod: true,
        };

        expect(mekCriticalSlotLines(slot, entity, 'RA', 0)).toEqual(['Ammo (Streak SRM 6) 30']);
    });

    it('gives each munition sharing a superheavy slot its own line and counts shared heat sinks', () => {
        expect(formatMekCriticalSlotLines([
            { ammo: { name: 'LB 10-X AC', shots: 10 } },
            { ammo: { name: 'LB 10-X Cluster', shots: 10 } },
        ])).toEqual(['Ammo (LB 10-X AC) 10', 'Ammo (LB 10-X Cluster) 10']);
        expect(formatMekCriticalSlotLines([
            { ammo: { name: 'LRM 20', shots: 6 } },
            { ammo: { name: 'LRM 20 Swarm', shots: 3, custom: true } },
        ])).toEqual(['Ammo (LRM 20) 6', '*Ammo (LRM 20 Swarm) 3']);
        expect(formatMekCriticalSlotLines([{ label: 'Heat Sink' }, { label: 'Heat Sink' }])).toEqual(['2 Heat Sinks']);
        expect(formatMekCriticalSlotLines([])).toEqual(['Roll Again']);
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
