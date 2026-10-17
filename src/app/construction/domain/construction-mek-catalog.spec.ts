// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { createConstructionEntity } from './construction-factory';
import {
    constructionSharedMekSlots,
    installConstructionEquipment,
    planConstructionEquipmentInsertion,
    validateConstruction,
} from './construction-rules';

const registry = createTestEquipmentRegistry();
const mek = () => createConstructionEntity('Biped', registry) as MekEntity;

describe('Mek catalog construction validation', () => {
    it('accepts the native slotless robotic controller location', () => {
        const entity = mek();
        addTestEquipment(entity, new MiscEquipment({ id: 'SRCS', name: 'SRCS', type: 'misc',
            flags: ['F_MEK_EQUIPMENT', 'F_SRCS'], stats: { criticalSlots: 0, tonnage: 1 } }), { location: 'None' });
        expect(validateConstruction(entity).messages.filter(message => message.code === 'MOUNT_PLACEMENT')).toEqual([]);
    });

    it('compresses a superheavy targeting computer without reducing its tonnage', () => {
        const entity = mek();
        const weapon = new WeaponEquipment({ id: 'direct gun', name: 'direct gun', type: 'weapon',
            flags: ['F_MEK_WEAPON', 'F_DIRECT_FIRE'], stats: { tonnage: 16, criticalSlots: 1 } });
        const computer = new MiscEquipment({ id: 'IS targeting computer', name: 'IS targeting computer', type: 'misc',
            flags: ['F_MEK_EQUIPMENT', 'F_TARGETING_COMPUTER'], tech: { base: 'IS' },
            stats: { criticalSlots: 'variable', tonnage: 'variable' } });
        addTestEquipment(entity, weapon, { allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 4 }] } });
        const mount = addTestEquipment(entity, computer, { allocation: { kind: 'location', location: 'RT',
            placements: [0, 1].map(slotIndex => ({ location: 'RT', slotIndex })) } });
        expect(getNumCriticalSlots(entity, computer)).toBe(4);
        entity.setTonnage(150);
        expect(getNumCriticalSlots(entity, computer)).toBe(2);
        expect(mount.getTonnage(entity)).toBe(4);
        expect(validateConstruction(entity).messages.some(message => message.code === 'CRIT_ALLOCATION_COUNT'
            && message.message.includes(computer.name))).toBeFalse();
    });

    it('recognizes an installed shared ammo slot when a superheavy location is full', () => {
        const entity = mek();
        entity.setTonnage(150);
        const ammo = new AmmoEquipment({ id: 'ammo', name: 'ammo', type: 'ammo', stats: { criticalSlots: 1 },
            ammo: { type: 'AC', rackSize: 5, shots: 20 } });
        addTestEquipment(entity, new WeaponEquipment({ id: 'AC5', name: 'AC5', type: 'weapon',
            flags: ['F_MEK_WEAPON'], stats: { criticalSlots: 1, tonnage: 1 }, weapon: { ammoType: 'AC', rackSize: 5 } }),
            { allocation: { kind: 'location', location: 'LA', placements: [{ location: 'LA', slotIndex: 4 }] } });
        for (let index = 0; index < 2; index++) addTestEquipment(entity, ammo,
            { allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 4 }] } });
        const filler = new MiscEquipment({ id: 'filler', name: 'filler', type: 'misc',
            flags: ['F_MEK_EQUIPMENT'], stats: { criticalSlots: 1, tonnage: 0 } });
        for (let slotIndex = 5; slotIndex < 12; slotIndex++) addTestEquipment(entity, filler,
            { allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex }] } });
        expect(validateConstruction(entity).messages.filter(message => ['MOUNT_PLACEMENT', 'CRIT_SLOT_SHARING_INVALID'].includes(message.code))).toEqual([]);
        entity.setTonnage(100);
        expect(validateConstruction(entity).messages.some(message => message.code === 'CRIT_SLOT_SHARING_INVALID')).toBeTrue();
    });

    it('joins a superheavy ammo slot when targeted, or once the location has no empty slot', () => {
        const entity = mek();
        entity.setTonnage(150);
        const tech = { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
        const ammo = (id: string, rackSize: number) => new AmmoEquipment({ id, name: id, type: 'ammo', tech,
            stats: { criticalSlots: 1, tonnage: 1 }, ammo: { type: 'AC_LBX', rackSize, shots: 10 } });
        addTestEquipment(entity, new WeaponEquipment({ id: 'LB 10-X AC', name: 'LB 10-X AC', type: 'weapon', tech,
            flags: ['F_MEK_WEAPON'], stats: { criticalSlots: 1, tonnage: 1 }, weapon: { ammoType: 'AC_LBX', rackSize: 10 } }),
            { allocation: { kind: 'location', location: 'LA', placements: [{ location: 'LA', slotIndex: 4 }] } });
        const standard = ammo('LB 10-X AC Ammo', 10);
        const cluster = ammo('LB 10-X Cluster Ammo', 10);
        const slotOf = (mountId: string) => entity.equipment().find(mount => mount.mountId === mountId)!.placements![0].slotIndex;
        const occupants = (slotIndex: number) => {
            const slot = entity.criticalSlotGrid().get('RA')![slotIndex];
            return slot.type === 'equipment' ? slot.mounts.map(mount => mount.mountId) : [];
        };

        const first = installConstructionEquipment(entity, standard, 'RA');
        const firstSlot = slotOf(first.mountId);
        expect(constructionSharedMekSlots(entity, cluster, 'RA')).toEqual([firstSlot]);
        expect(constructionSharedMekSlots(entity, ammo('LB 20-X AC Ammo', 20), 'RA')).toEqual([]);

        const separate = installConstructionEquipment(entity, cluster, 'RA');
        expect(slotOf(separate.mountId)).not.toBe(firstSlot);
        const joined = installConstructionEquipment(entity, cluster, 'RA', firstSlot);
        expect(occupants(firstSlot)).toEqual([first.mountId, joined.mountId]);

        const filler = new MiscEquipment({ id: 'filler', name: 'filler', type: 'misc',
            flags: ['F_MEK_EQUIPMENT'], stats: { criticalSlots: 1, tonnage: 0 } });
        entity.criticalSlotGrid().get('RA')!.forEach((slot, slotIndex) => {
            if (slot.type === 'empty' && slotIndex < 12) addTestEquipment(entity, filler,
                { allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex }] } });
        });
        const full = installConstructionEquipment(entity, standard, 'RA');
        expect(occupants(slotOf(separate.mountId))).toEqual([separate.mountId, full.mountId]);

        // Reordering and drop previews move both loads of a slot as one block.
        const order = [...new Set(entity.equipment().filter(mount => mount.location === 'RA')
            .sort((left, right) => slotOf(left.mountId) - slotOf(right.mountId)).map(mount => mount.mountId))].reverse();
        entity.arrangeEquipment('RA', order);
        expect(slotOf(first.mountId)).toBe(slotOf(joined.mountId));
        expect(slotOf(separate.mountId)).toBe(slotOf(full.mountId));
        const preview = planConstructionEquipmentInsertion(entity, cluster, 'RA',
            [{ location: 'RA', slotIndex: slotOf(first.mountId) }], entity.equipment().find(mount => mount.mountId === joined.mountId), first.mountId);
        expect(preview.arrangement.get(joined.mountId)).toEqual(preview.arrangement.get(first.mountId));
        expect(validateConstruction(entity).messages.filter(message => message.code === 'CRIT_SLOT_SHARING_INVALID')).toEqual([]);
    });

    it('lets two heat sinks share a superheavy slot only as two singles or up to four compacts', () => {
        const entity = mek();
        entity.setTonnage(150);
        const sink = (id: string, flags: ConstructorParameters<typeof MiscEquipment>[0]['flags']) =>
            new MiscEquipment({ id, name: id, type: 'misc', flags, stats: { criticalSlots: 1 } });
        const single = sink('Heat Sink', ['F_HEAT_SINK']);
        const compactOne = sink('1 Compact Heat Sink', ['F_HEAT_SINK', 'F_COMPACT_HEAT_SINK']);
        const compactTwo = sink('2 Compact Heat Sinks', ['F_DOUBLE_HEAT_SINK', 'F_COMPACT_HEAT_SINK']);
        const clanDouble = sink('CLDoubleHeatSink', ['F_DOUBLE_HEAT_SINK']);
        const mount = (equipment: MiscEquipment, location = 'RT') => addTestEquipment(entity, equipment,
            { allocation: { kind: 'location', location, placements: [{ location, slotIndex: 6 }] } });
        const canShare = (occupant: MiscEquipment, incoming: MiscEquipment, location = 'RT') =>
            entity.canShareCriticalSlot(location, mount(occupant, location), mount(incoming, location));

        expect(canShare(single, single)).toBeTrue();
        expect(canShare(compactTwo, compactTwo)).toBeTrue();
        expect(canShare(compactOne, compactTwo)).toBeTrue();
        expect(canShare(single, compactOne)).toBeFalse();
        expect(canShare(clanDouble, clanDouble)).toBeFalse();
        expect(canShare(single, single, 'HD')).toBeFalse();
    });
});
