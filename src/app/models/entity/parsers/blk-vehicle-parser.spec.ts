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
});

function vehicleBlk(extraSeats: string): string {
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
20
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
1
1
1
1
</armor>
${extraSeats}`;
}
