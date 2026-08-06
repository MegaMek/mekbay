// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ArmorEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { writeBlkSmallCraft } from '../writers/blk-smallcraft-writer';
import { BuildingBlock } from './building-block';
import { parseBlkSmallCraft } from './blk-smallcraft-parser';
import { ParseContext } from './parse-context';

describe('BLK Small Craft parser', () => {
  for (const { name, cargoCapacity } of [
    { name: 'Escape Pod', cargoCapacity: 0.48 },
    { name: 'Life Boat', cargoCapacity: 1.85 },
  ]) {
    it(`preserves ${name}'s declared crew and cargo transporter`, () => {
      const standardArmor = new ArmorEquipment({
        id: 'Standard Armor', name: 'Standard', type: 'armor',
        armor: { type: 'STANDARD' }, tech: { base: 'All' },
      });
      const context = new ParseContext('escape-pod.blk', new EquipmentRegistry({
        [standardArmor.id]: standardArmor,
      }));

      const entity = parseBlkSmallCraft(new BuildingBlock(smallCraftBlk(cargoCapacity)), context);

      expect(entity.crew()).toBe(1);
      expect(entity.officers()).toBe(0);
      expect(entity.transporters()).toEqual([jasmine.objectContaining({
        kind: 'bay', configuration: { type: 'cargo' }, capacity: cargoCapacity,
      })]);

      const written = writeBlkSmallCraft(entity);
      expect(written).toContain(`<transporters>\ncargobay:${cargoCapacity}:0:1::-1:0\n</transporters>`);
      expect(written).not.toContain('1stclassquarters');
      expect(written).not.toContain('2ndclassquarters');
      expect(written).not.toContain('crewquarters');
    });
  }

  it('materializes the standard crew and quarters when parsing a craft above 25 tons', () => {
    const standardArmor = new ArmorEquipment({
      id: 'Standard Armor', name: 'Standard', type: 'armor',
      armor: { type: 'STANDARD' }, tech: { base: 'All' },
    });
    const context = new ParseContext('small-craft.blk', new EquipmentRegistry({
      [standardArmor.id]: standardArmor,
    }));

    const entity = parseBlkSmallCraft(new BuildingBlock(smallCraftBlk(0.48, 30)), context);

    expect(entity.crew()).toBe(3);
    expect(entity.officers()).toBe(1);
    expect(entity.transporters().filter(transporter => transporter.kind === 'bay').map(transporter =>
      transporter.kind === 'bay' ? [transporter.configuration.type, transporter.capacity] : [])).toEqual([
      ['cargo', 0.48],
      ['first-class-quarters', 1],
      ['second-class-quarters', 0],
      ['crew-quarters', 2],
    ]);
  });
});

function smallCraftBlk(cargoCapacity: number, tonnage = 5): string {
  return `<UnitType>
SmallCraft
</UnitType>
<Name>
Test Escape Pod
</Name>
<year>
2647
</year>
<type>
IS Level 2
</type>
<motion_type>
Aerodyne
</motion_type>
<transporters>
cargobay:${cargoCapacity}:0:1::-1:0
</transporters>
<SafeThrust>
4
</SafeThrust>
<heatsinks>
0
</heatsinks>
<sink_type>
0
</sink_type>
<fuel>
10
</fuel>
<engine_type>
1
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
<structural_integrity>
1
</structural_integrity>
<tonnage>
${tonnage}
</tonnage>
<crew>
1
</crew>
<officers>
0
</officers>`;
}