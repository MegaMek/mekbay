// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MountedEngine } from '../../models/entity/components';
import { BipedMekEntity } from '../../models/entity/entities/mek/biped-mek-entity';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { WeaponEquipment } from '../../models/equipment.model';
import { createConstructionEntity } from './construction-factory';
import { constructionSystemSlotKeys, reconcileConstructionSystemSlots } from './construction-system-rules';
import { constructionComponentArmorMessages } from './construction-component-armor';

const weapon = new WeaponEquipment({
  id: 'SRM 6',
  name: 'SRM 6',
  type: 'weapon',
  flags: ['F_MEK_WEAPON'],
  stats: { criticalSlots: 2, tonnage: 3 },
});
const registry = createTestEquipmentRegistry({ [weapon.id]: weapon });
const design = () => createConstructionEntity('Biped', registry) as BipedMekEntity;

describe('construction system slot changes', () => {
  it('drops the armor of system slots the new layout no longer holds', () => {
    const entity = design();
    entity.configureEngine(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS' }));
    const engineSlots = () => [...constructionSystemSlotKeys(entity)].flatMap(([key, system]) => system === 'Engine' ? [key] : []);
    entity.armoredSystemSlots.set(new Set(engineSlots()));
    expect(entity.armoredSystemSlots().size).toBe(12);
    const before = constructionSystemSlotKeys(entity);
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'IS' }));
    reconcileConstructionSystemSlots(entity, before);
    // The side-torso engine slots are gone; the center torso keeps its armored engine.
    expect([...entity.armoredSystemSlots()].sort()).toEqual(engineSlots().sort());
    expect(entity.armoredSystemSlots().size).toBe(6);

    // TO:AUE p. 95: the armored engine covers the slots it gains again.
    const fusion = constructionSystemSlotKeys(entity);
    entity.configureEngine(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS' }));
    reconcileConstructionSystemSlots(entity, fusion);
    expect([...entity.armoredSystemSlots()].sort()).toEqual(engineSlots().sort());
    expect(entity.armoredSystemSlots().size).toBe(12);
  });

  it('reports a system component that is only partly armored', () => {
    const entity = design();
    const engineSlots = [...constructionSystemSlotKeys(entity)].flatMap(([key, system]) => system === 'Engine' ? [key] : []);
    entity.armoredSystemSlots.set(new Set(engineSlots.slice(0, 1)));
    expect(constructionComponentArmorMessages(entity).map(issue => issue.code)).toEqual(['PARTIAL_COMPONENT_ARMOR']);
    entity.armoredSystemSlots.set(new Set(engineSlots));
    expect(constructionComponentArmorMessages(entity)).toEqual([]);
  });

  it('unallocates a whole weapon when a 500-rating engine occupies its two slots', () => {
    const entity = design();
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));
    entity.originalWalkMP.set(6);
    const mount = addTestEquipment(entity, weapon, {
      armored: true,
      rearMounted: true,
      allocation: {
        kind: 'location',
        location: 'CT',
        placements: [10, 11].map((slotIndex) => ({ location: 'CT', slotIndex })),
      },
    });
    const before = constructionSystemSlotKeys(entity);
    // The rating selector cannot offer a 500 engine on a 50 t chassis (its engine outweighs the whole
    // 'Mech), but loaded designs still carry one and its larger footprint must displace equipment.
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 500, techBase: 'IS' }));
    entity.originalWalkMP.set(10);
    expect(
      entity
        .validationResult()
        .messages.filter((message) => message.code === 'CRIT_PLACEMENT_CONFLICT')
        .map((message) => message.message),
    ).toEqual(['"SRM 6" placed on system slot 11 in CT', '"SRM 6" placed on system slot 12 in CT']);
    reconcileConstructionSystemSlots(entity, before);
    const displaced = entity.equipment().find((item) => item.mountId === mount.mountId)!;
    expect(displaced.allocation.kind).toBe('unallocated');
    expect(displaced.placements).toBeUndefined();
    expect(displaced.equipment).toBe(weapon);
    expect(displaced.armored).toBeTrue();
    expect(displaced.rearMounted).toBeTrue();
    expect(
      entity
        .criticalSlotGrid()
        .get('CT')!
        .slice(10, 12)
        .every((slot) => slot.type === 'system'),
    ).toBeTrue();
    expect(
      entity.validationResult().messages.some((message) => message.code === 'CRIT_PLACEMENT_CONFLICT'),
    ).toBeFalse();
  });

  it('moves equipment down when new system slots arrive, keeping its order, a split weapon included', () => {
    const entity = design();
    const placed = (mountId: string) => entity.equipment().find((mount) => mount.mountId === mountId)!.placements;
    const split = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LA', placements: [{ location: 'LA', slotIndex: 4 }, { location: 'LT', slotIndex: 0 }] },
    });
    const right = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'RT', placements: [0, 1].map((slotIndex) => ({ location: 'RT', slotIndex })) },
    });
    const left = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LT', placements: [5, 6].map((slotIndex) => ({ location: 'LT', slotIndex })) },
    });
    const before = constructionSystemSlotKeys(entity);
    // The XL engine takes the first three slots of each side torso.
    entity.configureEngine(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS' }));
    reconcileConstructionSystemSlots(entity, before);
    expect(entity.equipment().filter((mount) => mount.allocation.kind === 'unallocated')).toEqual([]);
    expect(placed(split.mountId)).toEqual([{ location: 'LA', slotIndex: 4 }, { location: 'LT', slotIndex: 3 }]);
    expect(placed(left.mountId)).toEqual([4, 5].map((slotIndex) => ({ location: 'LT', slotIndex })));
    expect(placed(right.mountId)).toEqual([3, 4].map((slotIndex) => ({ location: 'RT', slotIndex })));
    expect(
      entity.validationResult().messages.some((message) => message.code === 'CRIT_PLACEMENT_CONFLICT'),
    ).toBeFalse();
  });

  for (const system of ['gyro', 'cockpit', 'actuator'] as const) {
    it(`moves equipment down when ${system} slots are added, or unallocates it when the location is full`, () => {
      const entity = design();
      if (system === 'cockpit') entity.cockpitType.set('Small');
      if (system === 'actuator') entity.hasHandActuator.set({ left: true, right: false });
      const location = system === 'gyro' ? 'CT' : system === 'cockpit' ? 'HD' : 'RA';
      const slotIndex = system === 'gyro' ? 10 : system === 'cockpit' ? 5 : 3;
      const mount = addTestEquipment(entity, weapon, {
        allocation: { kind: 'location', location, placements: [{ location, slotIndex }] },
      });
      const before = constructionSystemSlotKeys(entity);
      expect(before.has(`${location}:${slotIndex}`)).toBeFalse();
      if (system === 'gyro') entity.gyroType.set('XL');
      if (system === 'cockpit') entity.cockpitType.set('Standard');
      if (system === 'actuator') entity.hasHandActuator.set({ left: true, right: true });
      reconcileConstructionSystemSlots(entity, before);
      // An XL gyro fills the center torso; the standard cockpit leaves head slot 4 and the hand pushes the arm down.
      const moved = entity.equipment().find((item) => item.mountId === mount.mountId)!;
      if (system === 'gyro') expect(moved.allocation.kind).toBe('unallocated');
      else expect(moved.placements).toEqual([{ location, slotIndex: system === 'cockpit' ? 3 : 4 }]);
    });
  }

  it('moves equipment up when system slots go, leaving unallocated equipment alone', () => {
    const entity = design();
    const overlapping = addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'CT', placements: [{ location: 'CT', slotIndex: 0 }] },
    });
    const unallocated = addTestEquipment(entity, weapon, { allocation: { kind: 'unallocated' } });
    const before = constructionSystemSlotKeys(entity);
    entity.model.set('Renamed');
    reconcileConstructionSystemSlots(entity, before);
    expect(entity.equipment()).toEqual([overlapping, unallocated]);
    // A compact engine frees the center torso's lower engine slots.
    entity.configureEngine(new MountedEngine({ type: 'Compact', rating: 200, techBase: 'IS' }));
    reconcileConstructionSystemSlots(entity, before);
    expect(entity.equipment().find((mount) => mount.mountId === overlapping.mountId)!.placements)
      .toEqual([{ location: 'CT', slotIndex: 7 }]);
    expect(entity.equipment().find((mount) => mount.mountId === unallocated.mountId)).toBe(unallocated);
  });

  it('uses one-based slot numbers and the overlapping location in sharing diagnostics', () => {
    const entity = design();
    addTestEquipment(entity, weapon, {
      allocation: {
        kind: 'location',
        location: 'LA',
        placements: [
          { location: 'LA', slotIndex: 4 },
          { location: 'LT', slotIndex: 0 },
        ],
      },
    });
    addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    expect(entity.validationResult().messages.find((message) => message.code === 'CRIT_SLOT_SHARING_INVALID')).toEqual(
      jasmine.objectContaining({
        location: 'LT',
        message: 'Critical slot 1 in LT cannot be shared by "SRM 6", "SRM 6"',
      }),
    );
  });
});
