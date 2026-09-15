// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { createConstructionEntity } from './construction-factory';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import {
  weaponQuirkApplies,
  weaponQuirkAddress,
  weaponQuirkMount,
  weaponQuirkTarget,
  withWeaponQuirkReconciliation,
} from '../../models/entity/utils/weapon-quirks';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { uninstallConstructionEquipment } from './construction-rules';

describe('construction weapon quirks', () => {
  const laser = new WeaponEquipment({
    id: 'Quirk Test Laser',
    name: 'Quirk Test Laser',
    type: 'weapon',
    flags: ['F_ENERGY', 'F_LASER'],
    stats: { tonnage: 1, criticalSlots: 1 },
    weapon: { heat: 3, damage: 5, ammoType: 'NA', atClass: 'LASER' },
  });
  const registry = createTestEquipmentRegistry({ [laser.id]: laser });
  const design = () => createConstructionEntity('Biped', registry);
  it('suppresses an incompatible quirk on a retained weapon and restores it after moving back', () => {
    const entity = design();
    let mount = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    entity.weaponQuirks.set([{ name: 'direct_torso_mount', ...weaponQuirkAddress(entity, mount) }]);
    for (const location of ['LT', 'LA', 'LT']) {
      mount = withWeaponQuirkReconciliation(entity, () =>
        entity.moveEquipment(mount, location, [{ location, slotIndex: 4 }]),
      );
      expect(entity.applicableWeaponQuirks().length).toBe(location === 'LT' ? 1 : 0);
      const parsed = parseEntity(encodeNativeEntity(entity), 'weapon.mtf', registry).entity;
      expect(parsed.weaponQuirks()).toEqual(entity.weaponQuirks());
      expect(parsed.applicableWeaponQuirks().length).toBe(location === 'LT' ? 1 : 0);
    }
  });

  it('saves an incompatible quirk on an installed vehicle weapon without applying it', () => {
    const entity = createConstructionEntity('Tank', registry);
    const mount = addTestEquipment(entity, laser, { location: 'Front' });
    entity.weaponQuirks.set([{ name: 'imp_cooling', ...weaponQuirkAddress(entity, mount) }]);
    const parsed = parseEntity(encodeNativeEntity(entity), 'weapon.blk', registry).entity;
    expect(parsed.weaponQuirks()).toEqual(entity.weaponQuirks());
    expect(parsed.applicableWeaponQuirks()).toEqual([]);
  });

  it('distinguishes identical weapons and follows moves, reordered criticals, and removals', () => {
    const entity = design();
    const first = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    const second = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 1 }] },
    });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
    const moved = withWeaponQuirkReconciliation(entity, () =>
      entity.moveEquipment(second, 'RT', [{ location: 'RT', slotIndex: 4 }]),
    );
    expect(weaponQuirkMount(entity, entity.weaponQuirks()[0])?.mountId).toBe(moved.mountId);
    expect(entity.weaponQuirks()[0]).toEqual({ name: 'accurate', weaponName: laser.id, location: 'RT', slot: 4 });
    withWeaponQuirkReconciliation(entity, () => entity.removeEquipment(moved));
    expect(entity.weaponQuirks()).toEqual([]);
    expect(entity.applicableWeaponQuirks()).toEqual([]);
    addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] },
    });
    expect(entity.applicableWeaponQuirks()).toEqual([]);
    expect(entity.equipment().some((mount) => mount.mountId === first.mountId)).toBeTrue();
  });
  it('drops the assignments of a structurally removed weapon without a reconcile pass', () => {
    const entity = design();
    const mount = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, mount) }]);
    entity.removeEquipment(mount);
    expect(entity.weaponQuirks()).toEqual([]);
    expect(encodeNativeEntity(entity)).not.toContain('weaponquirk');
  });
  it('keeps the middle weapon quirk when surrounding BLK weapons are removed in one edit', () => {
    const entity = createConstructionEntity('Tank', registry);
    const first = addTestEquipment(entity, laser, { location: 'Front' });
    const second = addTestEquipment(entity, laser, { location: 'Front' });
    const third = addTestEquipment(entity, laser, { location: 'Front' });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
    withWeaponQuirkReconciliation(entity, () => {
      entity.removeEquipment(first);
      entity.removeEquipment(third);
    });
    expect(entity.weaponQuirks()).toHaveSize(1);
    expect(weaponQuirkMount(entity, entity.weaponQuirks()[0])?.mountId).toBe(second.mountId);
  });
  it('keeps a weapon quirk attached when removal precedes a move in one edit', () => {
    const entity = createConstructionEntity('Tank', registry);
    const first = addTestEquipment(entity, laser, { location: 'Front' });
    const second = addTestEquipment(entity, laser, { location: 'Front' });
    addTestEquipment(entity, laser, { location: 'Front' });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
    withWeaponQuirkReconciliation(entity, () => {
      entity.removeEquipment(first);
      entity.moveEquipment(second, 'Rear');
    });
    expect(entity.weaponQuirks()).toHaveSize(1);
    expect(weaponQuirkMount(entity, entity.weaponQuirks()[0])?.mountId).toBe(second.mountId);
  });
  it('keeps a moved weapon quirk when another weapon is removed afterwards', () => {
    const entity = createConstructionEntity('Tank', registry);
    const first = addTestEquipment(entity, laser, { location: 'Front' });
    const second = addTestEquipment(entity, laser, { location: 'Front' });
    addTestEquipment(entity, laser, { location: 'Front' });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
    withWeaponQuirkReconciliation(entity, () => {
      entity.moveEquipment(second, 'Rear');
      entity.removeEquipment(first);
    });
    expect(entity.weaponQuirks()).toHaveSize(1);
    expect(weaponQuirkMount(entity, entity.weaponQuirks()[0])?.mountId).toBe(second.mountId);
  });
  it('reconciles partial edits and releases ownership when an action throws', () => {
    const entity = createConstructionEntity('Tank', registry);
    const first = addTestEquipment(entity, laser, { location: 'Front' });
    const second = addTestEquipment(entity, laser, { location: 'Front' });
    entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, second) }]);
    expect(() =>
      withWeaponQuirkReconciliation(entity, () => {
        entity.removeEquipment(first);
        entity.moveEquipment(second, 'Rear');
        throw new Error('Interrupted edit');
      }),
    ).toThrowError('Interrupted edit');
    expect(weaponQuirkMount(entity, entity.weaponQuirks()[0])?.mountId).toBe(second.mountId);
    entity.removeEquipment(second);
    expect(entity.weaponQuirks()).toEqual([]);
  });
  it('keeps a bay quirk when its leading weapon is removed before a location move', () => {
    const entity = createConstructionEntity('DropShip', registry);
    const first = addTestEquipment(entity, laser, { location: 'Nose' });
    const second = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [first, second] });
    entity.weaponQuirks.set([{ name: 'mod_weapons', weaponName: 'Laser Bay', location: 'NOS', slot: 1 }]);
    withWeaponQuirkReconciliation(entity, () => {
      entity.removeEquipment(first);
      entity.moveEquipment(second, 'Aft');
    });
    const target = weaponQuirkTarget(entity, entity.weaponQuirks()[0]);
    expect(target?.kind).toBe('bay');
    expect(target?.kind === 'bay' && target.bay.weapons[0].mountId).toBe(second.mountId);
    expect(entity.weaponQuirks()[0].location).toBe('AFT');
  });
  it('round-trips the native MTF weapon slot and BLK location equipment order', () => {
    for (const kind of ['Biped', 'Tank', 'ProtoMek', 'Aero', 'BattleArmor'] as const) {
      const entity = createConstructionEntity(kind, registry);
      if (kind === 'BattleArmor') entity.techBase.set('Clan');
      const location = { Biped: 'LT', Tank: 'Front', ProtoMek: 'Right Arm', Aero: 'Nose', BattleArmor: 'Squad' }[kind];
      const mount = addTestEquipment(entity, laser, {
        allocation: {
          kind: 'location',
          location,
          ...(kind === 'Biped' ? { placements: [{ location, slotIndex: 0 }] } : {}),
        },
      });
      entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, mount) }]);
      expect(entity.weaponQuirks()[0].location).toBe(
        { Biped: 'LT', Tank: 'FR', ProtoMek: 'RA', Aero: 'NOS', BattleArmor: 'Point' }[kind],
      );
      const parsed = parseEntity(
        encodeNativeEntity(entity),
        kind === 'Biped' ? 'test.mtf' : 'test.blk',
        registry,
      ).entity;
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
  it('resolves and preserves a quirk addressed to a weapon bay itself', () => {
    const entity = createConstructionEntity('DropShip', registry);
    const first = addTestEquipment(entity, laser, { location: 'Nose' });
    const second = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [first, second] });
    const bayQuirk = { name: 'mod_weapons', weaponName: 'Laser Bay', location: 'NOS', slot: 1 };
    entity.weaponQuirks.set([bayQuirk]);

    expect(weaponQuirkTarget(entity, bayQuirk)).toEqual(jasmine.objectContaining({ kind: 'bay' }));
    expect(entity.applicableWeaponQuirks()).toEqual([bayQuirk]);

    const parsed = parseEntity(encodeNativeEntity(entity), 'ship.blk', registry).entity;
    expect(parsed.weaponQuirks()).toEqual([bayQuirk]);
    expect(parsed.applicableWeaponQuirks()).toEqual([bayQuirk]);
    expect(encodeNativeEntity(parsed)).toContain('mod_weapons:NOS:1:Laser Bay');
  });
  it('drops a deleted bay quirk instead of transferring it to the next bay', () => {
    const entity = createConstructionEntity('DropShip', registry);
    const first = addTestEquipment(entity, laser, { location: 'Nose' });
    const second = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [first] });
    entity.addEquipmentBay('weapon-bay', { mounts: [second] });
    entity.weaponQuirks.set([{ name: 'mod_weapons', weaponName: 'Laser Bay', location: 'NOS', slot: 1 }]);
    withWeaponQuirkReconciliation(entity, () => entity.removeEquipment(first));
    expect(entity.weaponQuirks()).toEqual([]);
  });
  it('follows a retained bay when earlier equipment is removed', () => {
    const entity = createConstructionEntity('DropShip', registry);
    const first = addTestEquipment(entity, laser, { location: 'Nose' });
    const second = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [first] });
    entity.addEquipmentBay('weapon-bay', { mounts: [second] });
    entity.weaponQuirks.set([{ name: 'mod_weapons', weaponName: 'Laser Bay', location: 'NOS', slot: 3 }]);
    withWeaponQuirkReconciliation(entity, () => entity.removeEquipment(first));
    expect(entity.weaponQuirks()).toEqual([{ name: 'mod_weapons', weaponName: 'Laser Bay', location: 'NOS', slot: 1 }]);
    expect(entity.applicableWeaponQuirks()).toEqual(entity.weaponQuirks());
  });
  it('rejects a missing weapon or a different bay type at an occupied bay slot', () => {
    const entity = createConstructionEntity('DropShip', registry);
    const mount = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [mount] });
    for (const weaponName of ['Missing PPC', 'PPC Bay']) {
      const entry = { name: 'mod_weapons', weaponName, location: 'NOS', slot: 1 };
      expect(weaponQuirkTarget(entity, entry)).toBeUndefined();
      entity.weaponQuirks.set([entry]);
      expect(parseEntity(encodeNativeEntity(entity), 'ship.blk', registry).entity.weaponQuirks()).toEqual([]);
    }
  });
  it('keeps two identical weapons distinct while unallocated and when reinstalled', () => {
    const entity = design();
    let first = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    let second = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 0 }] },
    });
    entity.weaponQuirks.set([
      { name: 'accurate', ...weaponQuirkAddress(entity, first) },
      { name: 'inaccurate', ...weaponQuirkAddress(entity, second) },
    ]);
    withWeaponQuirkReconciliation(entity, () => {
      first = uninstallConstructionEquipment(entity, first);
      second = uninstallConstructionEquipment(entity, second);
    });
    expect(entity.weaponQuirks().map((entry) => weaponQuirkMount(entity, entry)?.mountId)).toEqual([
      first.mountId,
      second.mountId,
    ]);
    expect(entity.applicableWeaponQuirks()).toEqual([]);
    second = withWeaponQuirkReconciliation(entity, () =>
      entity.moveEquipment(second, 'RA', [{ location: 'RA', slotIndex: 4 }]),
    );
    expect(weaponQuirkMount(entity, entity.weaponQuirks()[1])?.mountId).toBe(second.mountId);
    expect(entity.weaponQuirks()[1].location).toBe('RA');
    expect(entity.applicableWeaponQuirks()).toEqual([entity.weaponQuirks()[1]]);
  });
  it('filters ammunition, cooling and directional mount quirks using weapon and chassis facts', () => {
    const entity = design();
    const mount = addTestEquipment(entity, laser, { location: 'LT' });
    expect(weaponQuirkApplies(entity, mount, 'imp_cooling')).toBeTrue();
    expect(weaponQuirkApplies(entity, mount, 'ammo_feed_problems')).toBeFalse();
    expect(weaponQuirkApplies(entity, mount, 'direct_torso_mount')).toBeTrue();
    expect(weaponQuirkApplies(entity, mount, 'direct_torso_mount_quad')).toBeFalse();
    const tank = createConstructionEntity('Tank', registry);
    const tankMount = addTestEquipment(tank, laser, { location: 'Front' });
    expect(weaponQuirkApplies(tank, tankMount, 'imp_cooling')).toBeFalse();
    expect(weaponQuirkApplies(tank, tankMount, 'direct_torso_mount')).toBeFalse();
  });
});
