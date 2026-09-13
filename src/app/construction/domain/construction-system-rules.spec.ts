// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MountedEngine } from '../../models/entity/components';
import { BipedMekEntity } from '../../models/entity/entities/mek/biped-mek-entity';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { WeaponEquipment } from '../../models/equipment.model';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { constructionSystemSlotKeys, reconcileConstructionSystemSlots } from './construction-system-rules';

const weapon = new WeaponEquipment({ id: 'SRM 6', name: 'SRM 6', type: 'weapon',
  flags: ['F_MEK_WEAPON'], stats: { criticalSlots: 2, tonnage: 3 } });
const registry = createTestEquipmentRegistry({ [weapon.id]: weapon });
const design = () => createConstructionEntity('Biped', registry) as BipedMekEntity;

describe('construction system slot changes', () => {
  it('unallocates a whole weapon when a 300-to-500 engine change occupies its two slots', () => {
    const entity = design();
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));
    entity.originalWalkMP.set(6);
    const mount = addTestEquipment(entity, weapon, { armored: true, rearMounted: true,
      allocation: { kind: 'location', location: 'CT', placements: [10, 11].map(slotIndex => ({ location: 'CT', slotIndex })) } });
    const before = constructionSystemSlotKeys(entity);
    getConstructionFields(entity).find(field => field.id === 'engineRating')!.set(500);
    expect(entity.validationResult().messages.filter(message => message.code === 'CRIT_PLACEMENT_CONFLICT').map(message => message.message))
      .toEqual(['"SRM 6" placed on system slot 11 in CT', '"SRM 6" placed on system slot 12 in CT']);
    reconcileConstructionSystemSlots(entity, before);
    const displaced = entity.equipment().find(item => item.mountId === mount.mountId)!;
    expect(displaced.allocation.kind).toBe('unallocated');
    expect(displaced.placements).toBeUndefined();
    expect(displaced.equipment).toBe(weapon);
    expect(displaced.armored).toBeTrue();
    expect(displaced.rearMounted).toBeTrue();
    expect(entity.criticalSlotGrid().get('CT')!.slice(10, 12).every(slot => slot.type === 'system')).toBeTrue();
    expect(entity.validationResult().messages.some(message => message.code === 'CRIT_PLACEMENT_CONFLICT')).toBeFalse();
  });

  it('displaces all overlapping mounts together, including every part of a split weapon', () => {
    const entity = design();
    const split = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LA', placements: [{ location: 'LA', slotIndex: 4 }, { location: 'LT', slotIndex: 0 }] } });
    const right = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'RT', placements: [0, 1].map(slotIndex => ({ location: 'RT', slotIndex })) } });
    const safe = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LT', placements: [5, 6].map(slotIndex => ({ location: 'LT', slotIndex })) } });
    const before = constructionSystemSlotKeys(entity);
    entity.configureEngine(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS' }));
    reconcileConstructionSystemSlots(entity, before);
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'unallocated').map(mount => mount.mountId))
      .toEqual([split.mountId, right.mountId]);
    expect(entity.equipment().find(mount => mount.mountId === safe.mountId)).toBe(safe);
    expect(entity.criticalSlotGrid().get('LA')![4].type).toBe('empty');
    expect(entity.validationResult().messages.some(message => message.code === 'CRIT_PLACEMENT_CONFLICT')).toBeFalse();
  });

  for (const system of ['gyro', 'cockpit', 'actuator'] as const) {
    it(`also displaces equipment when ${system} slots are added`, () => {
      const entity = design();
      if (system === 'cockpit') entity.cockpitType.set('Small');
      if (system === 'actuator') entity.hasHandActuator.set({ left: true, right: false });
      const location = system === 'gyro' ? 'CT' : system === 'cockpit' ? 'HD' : 'RA';
      const slotIndex = system === 'gyro' ? 10 : system === 'cockpit' ? 5 : 3;
      const mount = addTestEquipment(entity, weapon, {
        allocation: { kind: 'location', location, placements: [{ location, slotIndex }] } });
      const before = constructionSystemSlotKeys(entity);
      expect(before.has(`${location}:${slotIndex}`)).toBeFalse();
      if (system === 'gyro') entity.gyroType.set('XL');
      if (system === 'cockpit') entity.cockpitType.set('Standard');
      if (system === 'actuator') entity.hasHandActuator.set({ left: true, right: true });
      reconcileConstructionSystemSlots(entity, before);
      expect(entity.equipment().find(item => item.mountId === mount.mountId)!.allocation.kind).toBe('unallocated');
    });
  }

  it('does not change pre-existing overlaps or reallocate equipment when systems shrink', () => {
    const entity = design();
    const invalid = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'CT', placements: [{ location: 'CT', slotIndex: 0 }] } });
    const unallocated = addTestEquipment(entity, weapon, { allocation: { kind: 'unallocated' } });
    const before = constructionSystemSlotKeys(entity);
    entity.model.set('Renamed');
    reconcileConstructionSystemSlots(entity, before);
    expect(entity.equipment()).toEqual([invalid, unallocated]);
    entity.configureEngine(new MountedEngine({ type: 'Compact', rating: 200, techBase: 'IS' }));
    reconcileConstructionSystemSlots(entity, before);
    expect(entity.equipment()).toEqual([invalid, unallocated]);
  });

  it('uses one-based slot numbers and the overlapping location in sharing diagnostics', () => {
    const entity = design();
    addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LA', placements: [{ location: 'LA', slotIndex: 4 }, { location: 'LT', slotIndex: 0 }] } });
    addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] } });
    expect(entity.validationResult().messages.find(message => message.code === 'CRIT_SLOT_SHARING_INVALID'))
      .toEqual(jasmine.objectContaining({ location: 'LT', message: 'Critical slot 1 in LT cannot be shared by "SRM 6", "SRM 6"' }));
  });
});
