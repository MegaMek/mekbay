// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createEquipment, WeaponEquipment } from '../../../equipment.model';
import { SmallCraftEntity } from './small-craft-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { calculateMountedEquipmentCost } from '../../utils/cost/equipment-total';
import { EquipmentFlag } from '../../../equipment-flags.type';

describe('SmallCraftEntity implicit equipment', () => {
  it('derives its automatic ECM from entity state', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({
      [automaticEcm.id]: automaticEcm,
      [weapon.id]: weapon,
    }));

    expect(entity.implicitSystemEquipment()).toEqual([]);

    addTestEquipment(entity, weapon, { location: 'Nose' });
    expect(entity.implicitSystemEquipment()).toEqual([automaticEcm]);

    entity.setEquipment([]);
    expect(entity.implicitSystemEquipment()).toEqual([]);
  });

  it('does not derive automatic ECM when ECM is explicitly mounted', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({ [automaticEcm.id]: automaticEcm }));

    addTestEquipment(entity, weapon, { location: 'Nose' });
    addTestEquipment(entity, automaticEcm, { location: 'Nose' });

    expect(entity.implicitSystemEquipment()).toEqual([]);
  });

  it('charges automatic ECM exactly once for an armed military Small Craft', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
      stats: { cost: 50000 },
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({
      [automaticEcm.id]: automaticEcm,
      [weapon.id]: weapon,
    }));

    addTestEquipment(entity, weapon, { location: 'Nose' });
    expect(calculateMountedEquipmentCost(entity)).toBe(50000);

    addTestEquipment(entity, automaticEcm, { location: 'Nose' });
    expect(calculateMountedEquipmentCost(entity)).toBe(50000);
  });

  it('does not charge automatic ECM for an unarmed civilian Small Craft', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
      stats: { cost: 50000 },
    });
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({ [automaticEcm.id]: automaticEcm }));

    expect(calculateMountedEquipmentCost(entity)).toBe(0);
  });

  it('rejects an unresolved automatic ECM cost', () => {
    const automaticEcm = createEquipment({
      id: 'ISSingle-Hex ECM', name: 'Single-Hex ECM', type: 'misc', flags: ['F_ECM'],
      stats: { cost: 'variable' },
    });
    const weapon = createWeapon('Large Laser', ['F_ENERGY']);
    const entity = new SmallCraftEntity(createTestEquipmentRegistry({
      [automaticEcm.id]: automaticEcm,
      [weapon.id]: weapon,
    }));
    addTestEquipment(entity, weapon, { location: 'Nose' });

    expect(() => calculateMountedEquipmentCost(entity))
      .toThrowError(/Unable to calculate variable cost for ISSingle-Hex ECM/);
  });

  it('materializes and dematerializes auto-filled crew across the tonnage threshold', () => {
    const entity = new SmallCraftEntity(createTestEquipmentRegistry());
    entity.crew.set(1);
    entity.transporters.set([cargoBay()]);

    entity.setTonnage(5);
    expect(crewAndQuarters(entity)).toEqual({ crew: 1, officers: 0, gunners: 0, quarters: 0 });

    entity.setTonnage(30);
    expect(crewAndQuarters(entity)).toEqual({ crew: 3, officers: 1, gunners: 0, quarters: 3 });

    entity.setTonnage(5);
    expect(crewAndQuarters(entity)).toEqual({ crew: 1, officers: 0, gunners: 0, quarters: 0 });
  });
});

function createWeapon(id: string, flags: EquipmentFlag[] = []): WeaponEquipment {
  return createEquipment({
    id, name: id, type: 'weapon', flags,
    weapon: { damage: 10, ranges: [5, 10, 15, 20] },
  }) as WeaponEquipment;
}

function cargoBay() {
  return {
    id: 'transporter-1', kind: 'bay' as const, configuration: { type: 'cargo' as const },
    capacity: 0.48, doors: 0, bayNumber: 0, omni: false,
  };
}

function crewAndQuarters(entity: SmallCraftEntity) {
  return {
    crew: entity.crew(),
    officers: entity.officers(),
    gunners: entity.gunners(),
    quarters: entity.transporters().filter(transporter => transporter.kind === 'bay'
      && ['first-class-quarters', 'second-class-quarters', 'crew-quarters', 'steerage-quarters']
        .includes(transporter.configuration.type)).length,
  };
}
