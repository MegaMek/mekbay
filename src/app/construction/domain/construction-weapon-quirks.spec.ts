// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { createConstructionEntity } from './construction-factory';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { weaponQuirkAddress, weaponQuirkMount } from '../../models/entity/utils/weapon-quirks';
import { captureConstructionWeaponQuirks, reconcileConstructionWeaponQuirks, constructionWeaponQuirkApplies } from './construction-weapon-quirks';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { uninstallConstructionEquipment } from './construction-rules';

describe('construction weapon quirks', () => {
    const laser = new WeaponEquipment({ id: 'Quirk Test Laser', name: 'Quirk Test Laser', type: 'weapon',
        flags: ['F_ENERGY', 'F_LASER'], stats: { tonnage: 1, criticalSlots: 1 }, weapon: { heat: 3, damage: 5, ammoType: 'NA' } });
    const registry = createTestEquipmentRegistry({ [laser.id]: laser });
    const design = () => createConstructionEntity('Biped', registry);
    it('distinguishes identical weapons and follows moves, reordered criticals, and removals', () => {
        const entity = design();
        const first = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] } });
        const second = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 1 }] } });
        entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
        const previous = captureConstructionWeaponQuirks(entity);
        const moved = entity.moveEquipment(second, 'RT', [{ location: 'RT', slotIndex: 4 }]);
        reconcileConstructionWeaponQuirks(entity, previous);
        expect(weaponQuirkMount(entity, entity.weaponQuirks()[0])?.mountId).toBe(moved.mountId);
        expect(entity.weaponQuirks()[0]).toEqual({ name: 'accurate', weaponName: laser.id, location: 'RT', slot: 4 });
        const beforeRemoval = captureConstructionWeaponQuirks(entity);
        entity.removeEquipment(moved);
        reconcileConstructionWeaponQuirks(entity, beforeRemoval);
        expect(entity.weaponQuirks()).toEqual([]);
        expect(entity.equipment().some(mount => mount.mountId === first.mountId)).toBeTrue();
    });
    it('round-trips the native MTF weapon slot and BLK location equipment order', () => {
        for (const kind of ['Biped', 'Tank', 'ProtoMek', 'Aero', 'BattleArmor'] as const) {
            const entity = createConstructionEntity(kind, registry);
            if (kind === 'BattleArmor') entity.techBase.set('Clan');
            const location = { Biped: 'LT', Tank: 'Front', ProtoMek: 'Right Arm', Aero: 'Nose', BattleArmor: 'Squad' }[kind];
            const mount = addTestEquipment(entity, laser, { allocation: { kind: 'location', location,
                ...(kind === 'Biped' ? { placements: [{ location, slotIndex: 0 }] } : {}) } });
            entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, mount) }]);
            expect(entity.weaponQuirks()[0].location).toBe({ Biped: 'LT', Tank: 'FR', ProtoMek: 'RA', Aero: 'NOS', BattleArmor: 'Point' }[kind]);
            const parsed = parseEntity(encodeNativeEntity(entity), kind === 'Biped' ? 'test.mtf' : 'test.blk', registry).entity;
            expect(parsed.weaponQuirks()).withContext(kind).toEqual(entity.weaponQuirks());
            expect(weaponQuirkMount(parsed, parsed.weaponQuirks()[0])?.equipmentId).withContext(kind).toBe(laser.id);
        }
    });
    it('counts the native bay controller slot when addressing a DropShip weapon', () => {
        const entity = createConstructionEntity('DropShip', registry);
        const first = addTestEquipment(entity, laser, { location: 'Nose' });
        const second = addTestEquipment(entity, laser, { location: 'Nose' });
        entity.addEquipmentBay('weapon-bay', { mounts: [first, second] });
        entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
        expect(entity.weaponQuirks()[0]).toEqual({ name: 'accurate', weaponName: laser.id, location: 'NOS', slot: 2 });
        const parsed = parseEntity(encodeNativeEntity(entity), 'ship.blk', registry).entity;
        expect(weaponQuirkMount(parsed, parsed.weaponQuirks()[0])).toBe(parsed.equipmentBays()[0].weapons[1]);
    });
    it('keeps two identical weapons distinct while unallocated and when reinstalled', () => {
        const entity = design();
        let first = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] } });
        let second = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 0 }] } });
        entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, first) }, { name: 'inaccurate', ...weaponQuirkAddress(entity, second) }]);
        let previous = captureConstructionWeaponQuirks(entity);
        first = uninstallConstructionEquipment(entity, first);
        second = uninstallConstructionEquipment(entity, second);
        reconcileConstructionWeaponQuirks(entity, previous);
        expect(entity.weaponQuirks().map(entry => weaponQuirkMount(entity, entry)?.mountId)).toEqual([first.mountId, second.mountId]);
        previous = captureConstructionWeaponQuirks(entity);
        second = entity.moveEquipment(second, 'RA', [{ location: 'RA', slotIndex: 4 }]);
        reconcileConstructionWeaponQuirks(entity, previous);
        expect(weaponQuirkMount(entity, entity.weaponQuirks()[1])?.mountId).toBe(second.mountId);
        expect(entity.weaponQuirks()[1].location).toBe('RA');
    });
    it('filters ammunition, cooling and directional mount quirks using weapon and chassis facts', () => {
        const entity = design();
        const mount = addTestEquipment(entity, laser, { location: 'LT' });
        expect(constructionWeaponQuirkApplies(entity, mount, 'imp_cooling')).toBeTrue();
        expect(constructionWeaponQuirkApplies(entity, mount, 'ammo_feed_problems')).toBeFalse();
        expect(constructionWeaponQuirkApplies(entity, mount, 'direct_torso_mount')).toBeTrue();
        expect(constructionWeaponQuirkApplies(entity, mount, 'direct_torso_mount_quad')).toBeFalse();
        const tank = createConstructionEntity('Tank', registry);
        const tankMount = addTestEquipment(tank, laser, { location: 'Front' });
        expect(constructionWeaponQuirkApplies(tank, tankMount, 'imp_cooling')).toBeFalse();
        expect(constructionWeaponQuirkApplies(tank, tankMount, 'direct_torso_mount')).toBeFalse();
    });
});
