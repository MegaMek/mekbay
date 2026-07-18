import { signal } from '@angular/core';
import { ArmorEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import { MountedArmor } from '../components';
import type { SupportVehicle } from '../entities/support-vehicle';
import { BuildingBlockWriter, writeSupportVehicleBarRating } from './building-block-writer';

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
