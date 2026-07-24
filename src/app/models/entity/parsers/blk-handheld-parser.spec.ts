import { EquipmentRegistry } from '../../equipment-lookup';
import { ArmorEquipment, WeaponEquipment } from '../../equipment.model';
import { writeBlkHandheld } from '../writers/blk-handheld-writer';
import { BuildingBlock } from './building-block';
import { parseBlkHandheld } from './blk-handheld-parser';
import { ParseContext } from './parse-context';

describe('BLK HandheldWeapon codec', () => {
  it('retains Java armor defaults and ignores contradictory armor metadata', () => {
    const weapon = new WeaponEquipment({
      id: 'MediumLaser',
      name: 'Medium Laser',
      type: 'weapon',
    });
    const standardArmor = new ArmorEquipment({
      id: 'Standard Armor',
      name: 'Standard',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All' },
    });
    const registry = new EquipmentRegistry({
      [standardArmor.id]: standardArmor,
      [weapon.id]: weapon,
    });
    const context = new ParseContext('test.blk', registry);
    const entity = parseBlkHandheld(new BuildingBlock(`
<UnitType>
HandheldWeapon
</UnitType>
<armor_type>
2
</armor_type>
<armor_tech_rating>
5
</armor_tech_rating>
<armor_tech_level>
12
</armor_tech_level>
<armor>
7
</armor>
<Gun Equipment>
${weapon.id}
</Gun Equipment>
`), context);

    expect(context.errors).toEqual([]);
    expect(entity.locationOrder).toEqual(['Gun']);
    expect(entity.uniformArmor()?.type).toBe('STANDARD');
    expect(entity.uniformArmor()?.technology).toEqual({
      level: 'Introductory',
      scope: 'IS',
    });
    expect(entity.uniformArmor()?.techRating).toBe('A');
    expect(entity.getArmorValue('Gun')).toBe(7);
    expect(entity.equipment()[0].location).toBe('Gun');

    const output = writeBlkHandheld(entity);
    expect(output).toContain('<armor_type>\n0\n</armor_type>');
    expect(output).toContain('<armor_tech_rating>\n0\n</armor_tech_rating>');
    expect(output).toContain('<armor_tech_level>\n0\n</armor_tech_level>');
    expect(output).toContain('<internal_type>\n-1\n</internal_type>');
    expect(output).toContain(`<Gun Equipment>\n${weapon.id}\n</Gun Equipment>`);
  });
});
