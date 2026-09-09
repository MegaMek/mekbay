// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { WeaponEquipment } from '../../equipment.model';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { TankEntity } from '../entities/vehicle/tank-entity';
import { DropShipEntity } from '../entities/aero/dropship-entity';
import { parseEntity } from '../parse-entity';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { addTestEquipment } from '../testing/test-mounted-equipment';
import { encodeNativeEntity } from '../write-entity';
import { matchNativeMounts } from './native-mount-correspondence';
import { MountedEngine } from '../components';

const laser = new WeaponEquipment({ id: 'Test Correspondence Laser', name: 'Test Correspondence Laser', type: 'weapon', flags: ['F_LASER'], stats: { criticalSlots: 1 } });
const registry = createTestEquipmentRegistry({ [laser.id]: laser });

describe('native equipment mount correspondence', () => {
    it('matches identity when BLK location order differs from original inventory order', () => {
        const original = new TankEntity(registry);
        const rear = addTestEquipment(original, laser, { location: 'Rear' });
        const front = addTestEquipment(original, laser, { location: 'Front' });
        const detached = parseEntity(encodeNativeEntity(original), 'test.blk', registry).entity;
        const correspondence = matchNativeMounts(original, detached);
        expect(detached.equipment().map(mount => mount.location)).toEqual(['Front', 'Rear']);
        expect(correspondence.get(detached.equipment()[0].mountId)).toBe(front.mountId);
        expect(correspondence.get(detached.equipment()[1].mountId)).toBe(rear.mountId);
    });

    it('pairs indistinguishable duplicate mounts one-to-one by native occurrence', () => {
        const original = new TankEntity(registry);
        const first = addTestEquipment(original, laser, { location: 'Front' });
        const second = addTestEquipment(original, laser, { location: 'Front' });
        const detached = parseEntity(encodeNativeEntity(original), 'test.blk', registry).entity;
        const added = addTestEquipment(detached, laser, { location: 'Front' });
        const correspondence = matchNativeMounts(original, detached);
        expect([...correspondence.values()]).toEqual([first.mountId, second.mountId]);
        expect(correspondence.has(added.mountId)).toBeFalse();
    });

    it('uses physical placements instead of inventory occurrence to match identical Mek equipment', () => {
        const original = new BipedMekEntity(registry);
        original.configureEngine(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'IS' }));
        const atFour = addTestEquipment(original, laser, { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] } });
        const atTwo = addTestEquipment(original, laser, { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 2 }] } });
        const detached = parseEntity(encodeNativeEntity(original), 'test.mtf', registry).entity;
        const correspondence = matchNativeMounts(original, detached);
        const first = detached.equipment().find(mount => mount.placements?.[0].slotIndex === 2)!;
        const second = detached.equipment().find(mount => mount.placements?.[0].slotIndex === 4)!;
        expect(correspondence.get(first.mountId)).toBe(atTwo.mountId);
        expect(correspondence.get(second.mountId)).toBe(atFour.mountId);
    });

    it('matches identical spacecraft weapons by authored bay emission order', () => {
        const original = new DropShipEntity(registry);
        const first = addTestEquipment(original, laser, { location: 'Nose' });
        const second = addTestEquipment(original, laser, { location: 'Nose' });
        original.replaceEquipmentBays('weapon-bay', [{ mounts: [second, first] }]);
        const detached = parseEntity(encodeNativeEntity(original), 'test.blk', registry).entity;
        const correspondence = matchNativeMounts(original, detached);
        expect(correspondence.get(detached.equipment()[0].mountId)).toBe(second.mountId);
        expect(correspondence.get(detached.equipment()[1].mountId)).toBe(first.mountId);
        expect(original.equipment()).toEqual([first, second]);
    });
});
