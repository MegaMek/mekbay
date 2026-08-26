// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { EquipmentRegistry } from '../equipment-lookup';
import { ArmorEquipment, StructureEquipment } from '../equipment.model';
import { parseEntity } from './parse-entity';
import { encodeNativeEntity } from './write-entity';

describe('native entity writer', () => {
  it('writes Meks as MTF and non-Meks as BLK', () => {
    const equipment = registry();
    const mek = parseEntity(MINIMAL_MTF, 'test.mtf', equipment).entity;
    const tank = parseEntity(MINIMAL_BLK, 'test.blk', equipment).entity;

    const mtf = encodeNativeEntity(mek);
    const blk = encodeNativeEntity(tank);

    expect(mtf).toContain('\nConfig:Biped\n');
    expect(mtf).not.toContain('<UnitType>');
    expect(blk).toContain('<UnitType>\nTank\n</UnitType>');
    expect(blk).not.toContain('Config:Biped');
  });

  it('uses the requested line ending', () => {
    const mek = parseEntity(MINIMAL_MTF, 'test.mtf', registry()).entity;
    const output = encodeNativeEntity(mek, 'crlf');

    expect(output).toContain('\r\n');
    expect(output.replace(/\r\n/gu, '')).not.toContain('\n');
  });
});

const MINIMAL_MTF = `chassis:Test
model:TST-1
Config:Biped
mass:20
engine:100 Fusion Engine
structure:Standard
heat sinks:10 Single
walk mp:5
jump mp:0
armor:Standard(Inner Sphere)
`;

const MINIMAL_BLK = `<UUID>
019f583e-e22d-792e-a947-44695aae9a03
</UUID>
<UnitType>
Tank
</UnitType>
<Name>
Test Tank
</Name>
<Model>
T-1
</Model>
<year>
3075
</year>
<type>
IS Level 2
</type>
<motion_type>
Tracked
</motion_type>
<cruiseMP>
4
</cruiseMP>
<engine_type>
0
</engine_type>
<armor_type>
0
</armor_type>
<armor_tech_rating>
0
</armor_tech_rating>
<armor_tech_level>
1
</armor_tech_level>
<armor>
10
10
10
10
</armor>
<tonnage>
20.0
</tonnage>
`;

function registry(): EquipmentRegistry {
  const armor = new ArmorEquipment({
    id: 'Standard Armor', name: 'Standard', type: 'armor',
    armor: { type: 'STANDARD' }, tech: { base: 'All', level: 'Introductory' },
  });
  const structure = new StructureEquipment({
    id: 'Standard', name: 'Standard', type: 'structure',
    structure: { typeId: 0 }, tech: { base: 'All', level: 'Introductory' },
  });
  return new EquipmentRegistry({ [armor.id]: armor, [structure.id]: structure });
}
