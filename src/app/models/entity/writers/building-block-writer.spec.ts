// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { ArmorEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import { MountedArmor } from '../components';
import type { SupportVehicle } from '../entities/support-vehicle';
import {
  BuildingBlockWriter,
  writeEmbeddedImages,
  writeSource,
  writeSupportVehicleBarRating,
  UnrepresentableBlkValueError,
} from './building-block-writer';

describe('BuildingBlockWriter', () => {
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
