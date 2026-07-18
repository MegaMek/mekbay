import { AmmoEquipment, ArmorEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { writeBlkProtoMek } from '../writers/blk-protomek-writer';
import { BuildingBlock } from './building-block';
import { parseBlkProtoMek } from './blk-protomek-parser';
import { ParseContext } from './parse-context';

describe('BLK ProtoMek codec', () => {
  it('parses parenthesized ammo shots into typed mount state and round trips them', () => {
    const ammo = new AmmoEquipment({
      id: 'Clan Ammo SRM-2',
      name: 'SRM 2 Ammo',
      type: 'ammo',
      ammo: { type: 'SRM', rackSize: 2, shots: 50 },
    });
    const armor = new ArmorEquipment({
      id: 'Clan ProtoMek Armor',
      name: 'ProtoMek Armor',
      type: 'armor',
      armor: { type: 'STANDARD_PROTOMEK' },
      tech: { base: 'Clan' },
    });
    const standardArmor = new ArmorEquipment({
      id: 'Standard Armor',
      name: 'Standard',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All' },
    });
    const registry = new EquipmentRegistry({
      [ammo.id]: ammo,
      [armor.id]: armor,
      [standardArmor.id]: standardArmor,
    });
    const context = new ParseContext('protomek.blk', registry);
    const entity = parseBlkProtoMek(new BuildingBlock(protoMekBlk(
      '<Body Equipment>\nClan Ammo SRM-2 (10)\n</Body Equipment>',
    )), context);

    expect(context.errors).toEqual([]);
    expect(entity.equipment()).toHaveSize(1);
    expect(entity.equipment()[0]).toEqual(jasmine.objectContaining({
      equipmentId: 'Clan Ammo SRM-2',
      equipment: ammo,
      shotsCount: 10,
    }));
    expect(entity.equipment()[0].getAmmoShots()).toBe(10);

    const written = writeBlkProtoMek(entity);
    expect(written).toContain('<Body Equipment>\nClan Ammo SRM-2 (10)\n</Body Equipment>');

    const reparsedContext = new ParseContext('protomek-round-trip.blk', registry);
    const reparsed = parseBlkProtoMek(new BuildingBlock(written), reparsedContext);
    expect(reparsedContext.errors).toEqual([]);
    expect(reparsed.equipment()[0].equipment).toBe(ammo);
    expect(reparsed.equipment()[0].shotsCount).toBe(10);
  });
});

function protoMekBlk(equipment: string): string {
  return `<UnitType>
ProtoMek
</UnitType>
<Name>
Test ProtoMek
</Name>
<year>
3070
</year>
<type>
Clan Level 2
</type>
<motion_type>
Biped
</motion_type>
<cruiseMP>
5
</cruiseMP>
<engine_type>
0
</engine_type>
<armor_type>
0
</armor_type>
<armor>
1
5
1
1
3
</armor>
<tonnage>
5
</tonnage>
${equipment}
`;
}