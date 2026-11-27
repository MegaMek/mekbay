// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ArmorEquipment, StructureEquipment, createEquipment } from '../../../equipment.model';
import { MountedArmor, MountedStructure } from '../../components';
import { TestSupportTankEntity, TestTankEntity } from '../../testing/test-entities';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import {
  calculateVehicleArmorWeight,
  calculateVehicleStructureWeight,
  calculateVehicleTurretWeight,
  calculateVehicleWeightBreakdown,
} from './vehicle-weight';

describe('combat vehicle construction mass', () => {
  it('rounds standard structure and controls upward to half tons', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(27);
    const standard = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      structure: { typeId: 0 },
    });
    entity.setUniformStructure(new MountedStructure({ tonnage: 27, structure: standard }));

    expect(calculateVehicleStructureWeight(entity)).toBe(3);
    expect(calculateVehicleWeightBreakdown(entity).controls).toBe(1.5);
  });

  it('doubles superheavy structure except for naval and submarine vehicles', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(120);
    expect(calculateVehicleStructureWeight(entity)).toBe(24);
    entity.motiveType.set('Naval');
    entity.setTonnage(350);
    expect(calculateVehicleStructureWeight(entity)).toBe(35);
  });

  it('calculates uniform and patchwork armor from points-per-ton multipliers', () => {
    const entity = new TestTankEntity();
    const standard = new ArmorEquipment({
      id: 'Standard Armor', name: 'Standard Armor', type: 'armor',
      stats: { tonnage: 'variable' }, armor: { type: 'Standard', pptMultiplier: 1 },
    });
    entity.setUniformArmor(new MountedArmor({ armor: standard, techBase: 'IS' }));
    entity.armorValues.set(new Map([
      ['Front', { front: 17, rear: 0 }],
      ['Rear', { front: 0, rear: 0 }],
    ]));
    expect(calculateVehicleArmorWeight(entity)).toBe(1.5);
  });

  it('uses IS armor mass when BLK armor technology was unresolved', () => {
    const innerSphereArmor = new ArmorEquipment({
      id: 'IS Ferro-Fibrous', name: 'Ferro-Fibrous', type: 'armor',
      armor: { type: 'FERRO_FIBROUS', pptMultiplier: 1.12 }, tech: { base: 'IS' },
    });
    const clanArmor = new ArmorEquipment({
      id: 'Clan Ferro-Fibrous', name: 'Ferro-Fibrous', type: 'armor',
      armor: { type: 'FERRO_FIBROUS', pptMultiplier: 1.2 }, tech: { base: 'Clan' },
    });
    const entity = new TestTankEntity(createTestEquipmentRegistry({
      [innerSphereArmor.id]: innerSphereArmor,
      [clanArmor.id]: clanArmor,
    }));
    entity.armorValues.set(new Map([['Front', { front: 124, rear: 0 }]]));
    entity.setUniformArmor(new MountedArmor({
      armor: clanArmor,
      techBase: 'Clan',
      technology: { level: 'Standard', scope: 'Unknown' },
    }));

    expect(calculateVehicleArmorWeight(entity)).toBe(7);

    entity.armorValues.set(new Map([['Front', { front: 134, rear: 0 }]]));
    expect(calculateVehicleArmorWeight(entity)).toBe(7.5);
  });

  it('omits controls when the chassis has no control systems', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(100);
    entity.hasNoControlSystems.set(true);
    expect(calculateVehicleWeightBreakdown(entity).controls).toBe(0);
  });

  it('leaves Modular Armor and heat sinks out of either turret\'s mass on combat and support vehicles (TM p. 241)', () => {
    const laser = createEquipment({ id: 'Large Laser', name: 'Large Laser', type: 'weapon', stats: { tonnage: 5 } });
    const modular = createEquipment({ id: 'Modular Armor', name: 'Modular Armor', type: 'misc', flags: ['F_MODULAR_ARMOR'], stats: { tonnage: 1 } });
    const sink = createEquipment({ id: 'Heat Sink', name: 'Heat Sink', type: 'misc', flags: ['F_HEAT_SINK'], stats: { tonnage: 1 } });
    for (const entity of [new TestTankEntity(), new TestSupportTankEntity()]) {
      entity.setTonnage(50);
      entity.hasTurret.set(true);
      entity.hasDualTurret.set(true);
      for (const location of ['Rear Turret', 'Front Turret'])
        for (const item of [laser, modular, sink]) addTestEquipment(entity, item, { location });
      // 5 t of laser, not 7 t with its armor and heat sink: 0.5 t per turret, not 1 t.
      expect(calculateVehicleTurretWeight(entity, false)).withContext(entity.entityType).toBe(0.5);
      expect(calculateVehicleTurretWeight(entity, true)).withContext(entity.entityType).toBe(0.5);
    }
  });
});