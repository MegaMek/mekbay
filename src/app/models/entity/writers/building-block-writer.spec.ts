// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { AmmoEquipment, ArmorEquipment, WeaponEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import { MountedArmor } from '../components';
import type { SupportVehicle } from '../entities/support-vehicle';
import { DropShipEntity } from '../entities/aero/dropship-entity';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { TestTankEntity } from '../testing/test-entities';
import { addTestEquipment } from '../testing/test-mounted-equipment';
import { encodeNativeEntity } from '../write-entity';
import { parseEntity } from '../parse-entity';
import {
  BuildingBlockWriter,
  writeEmbeddedImages,
  writeSource,
  writeSupportVehicleBarRating,
  UnrepresentableBlkValueError,
} from './building-block-writer';

describe('BuildingBlockWriter', () => {
  it('round-trips an earlier originalBuildYear and omits one equal to the introduction year', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(55);
    entity.year.set(3050);
    entity.originalBuildYear.set(2750);
    const source = encodeNativeEntity(entity);
    expect(source).toContain('<originalBuildYear>\n2750\n</originalBuildYear>');
    expect(parseEntity(source, 'oem.blk', entity.getEquipmentRegistry()).entity.originalBuildYear()).toBe(2750);
    expect(parseEntity(source.replace('<originalBuildYear>\n2750', '<originalBuildYear>\n3050'),
      'same-year.blk', entity.getEquipmentRegistry()).entity.originalBuildYear()).toBe(-1);
    entity.originalBuildYear.set(entity.year());
    expect(encodeNativeEntity(entity)).not.toContain('<originalBuildYear>');
  });

  it('round-trips authored bay membership independently of inventory order', () => {
    const weapon = new WeaponEquipment({ id: 'Test AC10', name: 'Test AC10', type: 'weapon',
      weapon: { ammoType: 'AC', rackSize: 10, atClass: 'AC', av: [10, 10, 0, 0] } });
    const ammo = new AmmoEquipment({ id: 'Test AC10 Ammo', name: 'Test AC10 Ammo', type: 'ammo',
      ammo: { type: 'AC', rackSize: 10, shots: 10 }, stats: { tonnage: 1 } });
    const registry = createTestEquipmentRegistry({ [weapon.id]: weapon, [ammo.id]: ammo });
    const entity = new DropShipEntity(registry);
    entity.setTonnage(2000);
    const first = addTestEquipment(entity, weapon, { location: 'Nose' });
    const second = addTestEquipment(entity, weapon, { location: 'Nose' });
    const third = addTestEquipment(entity, weapon, { location: 'Nose' });
    const firstAmmo = addTestEquipment(entity, ammo, { location: 'Nose', size: 1 });
    const secondAmmo = addTestEquipment(entity, ammo, { location: 'Nose', size: 2 });
    entity.replaceEquipmentBays('weapon-bay', [
      { mounts: [first, third, firstAmmo] }, { mounts: [second, secondAmmo] },
    ]);
    const inventory = entity.equipment();
    const parsed = parseEntity(encodeNativeEntity(entity), 'regrouped.blk', registry).entity;
    expect(entity.equipment()).toEqual(inventory);
    const bays = parsed.equipmentBays().filter(bay => bay.kind === 'weapon-bay');
    expect(bays.map(bay => bay.weapons.length)).toEqual([2, 1]);
    expect(bays.map(bay => bay.ammo.map(mount => mount.size))).toEqual([[1], [2]]);
  });

  it('writes BAR rating only for installed support-vehicle BAR armor', () => {
    const barArmor = new ArmorEquipment({
      id: 'BAR 2 Armor',
      name: 'BAR 2 Armor',
      type: 'armor',
      flags: ['F_SUPPORT_VEE_BAR_ARMOR'],
      armor: { type: 'SV_BAR_2', bar: 2 },
      tech: { base: 'All' },
    });
    const standardArmor = new ArmorEquipment({
      id: 'Standard Armor',
      name: 'Standard Armor',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All' },
    });

    const barWriter = new BuildingBlockWriter();
    writeSupportVehicleBarRating(barWriter, supportEntity(barArmor, 2));
    expect(barWriter.toString()).toContain('<barrating>\n2\n</barrating>');

    const standardWriter = new BuildingBlockWriter();
    writeSupportVehicleBarRating(standardWriter, supportEntity(standardArmor, 2));
    expect(standardWriter.toString()).not.toContain('<barrating>');
  });

  it('preserves faction and embedded presentation fields through shared BLK helpers', () => {
    const entity = {
      source: () => [],
      published: () => [],
      faction: () => 'DC',
      iconEncoded: () => 'icon-bytes',
      fluffImageEncoded: () => 'fluff-bytes',
    } as unknown as BaseEntity;
    const writer = new BuildingBlockWriter();

    writeSource(writer, entity);
    writeEmbeddedImages(writer, entity);

    expect(writer.toString()).toContain('<faction>\nDC\n</faction>');
    expect(writer.toString()).toContain('<icon>\nicon-bytes\n</icon>');
    expect(writer.toString()).toContain('<fluffimage>\nfluff-bytes\n</fluffimage>');
  });

  it('rejects tag and value injection that BLK cannot represent', () => {
    const writer = new BuildingBlockWriter();

    expect(() => writer.addBlock('bad>\n<injected', 'value'))
      .toThrowError(UnrepresentableBlkValueError);
    expect(() => writer.addBlock('overview', 'safe\n</overview>\n<evil>'))
      .toThrowError(UnrepresentableBlkValueError);
  });
});

function supportEntity(
  armor: ArmorEquipment,
  barRating: number,
): BaseEntity & SupportVehicle {
  return {
    uniformArmor: () => new MountedArmor({ armor }),
    barRating: signal(barRating),
  } as unknown as BaseEntity & SupportVehicle;
}
