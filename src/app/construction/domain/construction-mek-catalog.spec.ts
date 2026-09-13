// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { createConstructionEntity } from './construction-factory';
import { validateConstruction } from './construction-rules';

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
});
