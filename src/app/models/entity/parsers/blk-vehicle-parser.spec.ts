// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ArmorEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { writeBlkVehicle } from '../writers/blk-vehicle-writer';
import { BuildingBlock } from './building-block';
import { parseBlkVehicle } from './blk-vehicle-parser';
import { ParseContext } from './parse-context';

describe('BLK vehicle parser', () => {
  const standardArmor = new ArmorEquipment({
    id: 'Standard Armor', name: 'Standard', type: 'armor',
    armor: { type: 'STANDARD' }, tech: { base: 'All' },
  });
  const registry = new EquipmentRegistry({ [standardArmor.id]: standardArmor });

  it('reads and writes MegaMek\'s canonical extra_seats key', () => {
    const entity = parseBlkVehicle(
      new BuildingBlock(vehicleBlk('<extra_seats>\n3\n</extra_seats>')),
      new ParseContext('extra-seats.blk', registry),
    );

    expect(entity.extraSeats()).toBe(3);
    expect(writeBlkVehicle(entity)).toContain('<extra_seats>\n3\n</extra_seats>');
  });

  it('accepts the historical camel-case alias but canonicalizes it on write', () => {
    const entity = parseBlkVehicle(
      new BuildingBlock(vehicleBlk('<extraSeats>\n2\n</extraSeats>')),
      new ParseContext('legacy-extra-seats.blk', registry),
    );
    const written = writeBlkVehicle(entity);

    expect(entity.extraSeats()).toBe(2);
    expect(written).toContain('<extra_seats>\n2\n</extra_seats>');
    expect(written).not.toContain('<extraSeats>');
  });

  it('round trips faction and embedded presentation bytes', () => {
    const entity = parseBlkVehicle(
      new BuildingBlock(vehicleBlk('<faction>\nDC\n</faction>\n<icon>\nabc\n</icon>\n<fluffimage>\ndef\n</fluffimage>')),
      new ParseContext('metadata.blk', registry),
    );
    const written = writeBlkVehicle(entity);

    expect(entity.faction()).toBe('DC');
    expect(entity.iconEncoded()).toBe('abc');
    expect(entity.fluffImageEncoded()).toBe('def');
    expect(written).toContain('<faction>\nDC\n</faction>');
    expect(written).toContain('<icon>\nabc\n</icon>');
    expect(written).toContain('<fluffimage>\ndef\n</fluffimage>');
  });

  for (const tonnage of [20, 150]) {
    for (const turrets of [0, 1, 2]) {
      it(`preserves all armor through repeated saves for a ${tonnage}-ton tank with ${turrets} turrets`, () => {
        const armor = Array.from({ length: (tonnage > 100 ? 6 : 4) + turrets }, (_, index) => 10 + index);
        let source = vehicleBlk('', tonnage, armor);
        for (let cycle = 0; cycle < 3; cycle++) {
          const entity = parseBlkVehicle(new BuildingBlock(source), new ParseContext('armor.blk', registry));
          if (turrets === 2) {
            expect(entity.armorValues().get('Rear Turret')?.front).toBe(armor[armor.length - 2]);
            expect(entity.armorValues().get('Front Turret')?.front).toBe(armor[armor.length - 1]);
          }
          source = writeBlkVehicle(entity);
          expect(new BuildingBlock(source).getDataAsInt('armor')).toEqual(armor);
        }
      });
    }
  }
});

function vehicleBlk(extraSeats: string, tonnage = 20, armor: readonly number[] = [1, 1, 1, 1]): string {
  return `<UnitType>
Tank
</UnitType>
<Name>
Test Tank
</Name>
<year>
3075
</year>
<type>
IS Level 2
</type>
<motion_type>
Tracked
</motion_type>
<tonnage>
${tonnage}
</tonnage>
<cruiseMP>
4
</cruiseMP>
<engine_type>
0
</engine_type>
<armor_type>
0
</armor_type>
<armor>
${armor.join('\n')}
</armor>
${extraSeats}`;
}
