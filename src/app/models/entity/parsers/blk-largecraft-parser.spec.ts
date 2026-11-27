// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment } from '../../equipment.model';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { writeBlkLargeCraft } from '../writers/blk-largecraft-writer';
import { BuildingBlock } from './building-block';
import { parseBlkLargeCraft } from './blk-largecraft-parser';
import { ParseContext } from './parse-context';

describe('BLK large-craft parser', () => {
  it('maps MegaMek armor values in Nose/FLS/FRS/Aft/ALS/ARS order', () => {
    const aerospaceArmor = new ArmorEquipment({
      id: 'Aerospace', name: 'Aerospace', type: 'armor',
      armor: { type: 'AEROSPACE' }, tech: { base: 'All' },
    });
    const registry = createTestEquipmentRegistry({ [aerospaceArmor.id]: aerospaceArmor });
    const entity = parseBlkLargeCraft(
      new BuildingBlock(largeCraftBlk()),
      new ParseContext('armor-order.blk', registry),
    );

    expect(entity.armorValues().get('Nose')?.front).toBe(100);
    expect(entity.armorValues().get('FLS')?.front).toBe(90);
    expect(entity.armorValues().get('FRS')?.front).toBe(80);
    expect(entity.armorValues().get('Aft')?.front).toBe(70);
    expect(entity.armorValues().get('ALS')?.front).toBe(60);
    expect(entity.armorValues().get('ARS')?.front).toBe(50);
    expect(writeBlkLargeCraft(entity)).toContain('<armor>\n100\n90\n80\n70\n60\n50\n</armor>');
  });
});

function largeCraftBlk(): string {
  return `<UnitType>
Warship
</UnitType>
<Name>
Armor Order Test
</Name>
<year>
3067
</year>
<type>
IS Level 2
</type>
<motion_type>
Aerodyne
</motion_type>
<tonnage>
100000
</tonnage>
<SafeThrust>
3
</SafeThrust>
<heatsinks>
10
</heatsinks>
<sink_type>
0
</sink_type>
<fuel>
100
</fuel>
<engine_type>
1
</engine_type>
<armor_type>
0
</armor_type>
<armor>
100
90
80
70
60
50
</armor>
<structural_integrity>
10
</structural_integrity>`;
}
