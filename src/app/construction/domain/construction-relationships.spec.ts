// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createConstructionEntity } from './construction-factory';
import { reconcileConstructionEquipmentRelationships } from './construction-relationships';

const laser = new WeaponEquipment({ id: 'Test Laser', name: 'Test Laser', type: 'weapon', flags: ['F_LASER'],
    stats: { criticalSlots: 1 }, weapon: { ammoType: 'NA' } });
const insulator = new MiscEquipment({ id: 'Test Insulator', name: 'Test Insulator', type: 'misc', flags: ['F_LASER_INSULATOR'],
    stats: { criticalSlots: 1 } });
const registry = createTestEquipmentRegistry({ [laser.id]: laser, [insulator.id]: insulator });

describe('construction native equipment relationships', () => {
    it('relinks a BLK enhancement after installation/removal without changing mount identities', () => {
        const entity = createConstructionEntity('Tank', registry);
        const first = addTestEquipment(entity, laser, { location: 'Front' });
        const second = addTestEquipment(entity, laser, { location: 'Front' });
        const enhancement = addTestEquipment(entity, insulator, { location: 'Front' });
        const inventory = entity.equipment();
        entity.linkEquipment(enhancement, first);

        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(enhancement)).toBe(second);
        expect(entity.equipment()).toEqual(inventory);
        expect(entity.equipment()[0]).toBe(first);

        entity.removeEquipment(second);
        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(enhancement)).toBe(first);
    });

    it('uses physical Mek slot order when it differs from installation order', () => {
        const entity = createConstructionEntity('Biped', registry);
        const installAt = (equipment: WeaponEquipment | MiscEquipment, slotIndex: number) => addTestEquipment(entity, equipment,
            { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex }] } });
        const first = installAt(laser, 2);
        const second = installAt(laser, 4);
        const enhancement = installAt(insulator, 3);
        entity.reconcileEquipmentRelationships();
        expect(entity.getLinkedMount(enhancement)).toBe(second);

        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(enhancement)).toBe(first);
        expect(entity.equipment()).toEqual([first, second, enhancement]);
        expect(first.placements).toEqual([{ location: 'RT', slotIndex: 2 }]);
    });

    it('projects native battle-armor AP attachments onto existing editor mounts', () => {
        const ap = new MiscEquipment({ id: 'Test AP Mount', name: 'Test AP Mount', type: 'misc', flags: ['F_AP_MOUNT'] });
        const rifle = new WeaponEquipment({ id: 'Test Infantry Rifle', name: 'Test Infantry Rifle', type: 'weapon', flags: ['F_INFANTRY'], infantry: {} });
        const baRegistry = createTestEquipmentRegistry({ [ap.id]: ap, [rifle.id]: rifle });
        const entity = createConstructionEntity('BattleArmor', baRegistry);
        const attachment = addTestEquipment(entity, ap, { location: 'Squad', baMountLocation: 'Body' });
        const weapon = addTestEquipment(entity, rifle, { location: 'Squad', baMountLocation: 'Body', isAPM: true });

        reconcileConstructionEquipmentRelationships(entity);
        expect(entity.getLinkedMount(attachment)).toBe(weapon);
        expect(entity.getLinkingMount(weapon)).toBe(attachment);
        expect(entity.equipment()).toEqual([attachment, weapon]);
    });
});
