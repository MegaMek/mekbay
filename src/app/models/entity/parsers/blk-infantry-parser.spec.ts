import { InfantryWeaponEquipment, MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { writeBlkInfantry } from '../writers/blk-infantry-writer';
import { BuildingBlock } from './building-block';
import { parseBlkInfantry } from './blk-infantry-parser';
import { ParseContext } from './parse-context';

describe('BLK conventional infantry codec', () => {
  const primary = infantryWeapon('InfantryRifle');
  const secondary = infantryWeapon('InfantrySupportLaser', ['F_INF_SUPPORT']);
  const armorKit = new MiscEquipment({
    id: 'InfantryArmorKit',
    name: 'Infantry Armor Kit',
    type: 'misc',
    flags: ['F_ARMOR_KIT', 'S_ENCUMBERING', 'S_SPACE_SUIT'],
  });
  const nonInfantryWeapon = new WeaponEquipment({
    id: 'MediumLaser',
    name: 'Medium Laser',
    type: 'weapon',
  });
  const registry = createTestEquipmentRegistry({
    [primary.id]: primary,
    [secondary.id]: secondary,
    [armorKit.id]: armorKit,
    [nonInfantryWeapon.id]: nonInfantryWeapon,
  });

  it('stores primary and secondary weapons as typed equipment only', () => {
    const { entity, context } = parse(`
<Primary>
${primary.id}
</Primary>
<Secondary>
${secondary.id}
</Secondary>
<secondn>
2
</secondn>`);

    expect(context.errors).toEqual([]);
    expect(entity.primaryWeapon()).toBe(primary);
    expect(entity.secondaryWeapon()).toBe(secondary);
    expect(entity.secondaryCount()).toBe(2);
    expect(entity.rangeWeapon()).toBe(secondary);

    const output = writeBlkInfantry(entity);
    expect(output).toContain(`<Primary>\n${primary.id}\n</Primary>`);
    expect(output).toContain(`<Secondary>\n${secondary.id}\n</Secondary>`);
    expect(output).toContain('<secondn>\n2\n</secondn>');
  });

  it('rejects catalog equipment that is not an infantry weapon', () => {
    const { entity, context } = parse(`
<Primary>
${nonInfantryWeapon.id}
</Primary>`);

    expect(entity.primaryWeapon()).toBeNull();
    expect(context.errors).toContain(jasmine.objectContaining({
      field: 'Primary',
      message: jasmine.stringContaining('not an infantry weapon'),
    }));
  });

  it('ignores an orphan secondary count without a secondary weapon', () => {
    const { entity } = parse(`
<Primary>
${primary.id}
</Primary>
<secondn>
2
</secondn>`);

    expect(entity.secondaryCount()).toBe(0);
    expect(writeBlkInfantry(entity)).not.toContain('<secondn>');
  });

  it('migrates a legacy armorKit block into canonical mounted equipment', () => {
    const { entity, context } = parse(`
<Primary>
${primary.id}
</Primary>
<armorKit>
${armorKit.id}
</armorKit>`);

    expect(context.errors).toEqual([]);
    expect(entity.armorKit()).toBe(armorKit);
    expect(entity.equipment()).toHaveSize(1);
    expect(entity.equipment()[0].equipment).toBe(armorKit);
    expect(entity.equipment()[0].location).toBe('Infantry');
    expect(entity.effectiveEncumberingArmor()).toBeTrue();
    expect(entity.effectiveSpaceSuit()).toBeTrue();

    entity.originalWalkMP.set(2);
    expect(entity.walkMP()).toBe(1);

    const output = writeBlkInfantry(entity);
    expect(output).toContain(`<Troopers Equipment>\n${armorKit.id}\n</Troopers Equipment>`);
    expect(output).not.toContain('<armorKit>');
  });

  it('does not duplicate a legacy armorKit already present in Troopers Equipment', () => {
    const { entity, context } = parse(`
<Troopers Equipment>
${armorKit.id}
</Troopers Equipment>
<Primary>
${primary.id}
</Primary>
<armorKit>
${armorKit.id}
</armorKit>`);

    expect(context.errors).toEqual([]);
    expect(entity.equipment().filter(mount => mount.equipment === armorKit)).toHaveSize(1);
  });

  function parse(content: string) {
    const context = new ParseContext('infantry.blk', registry);
    const entity = parseBlkInfantry(new BuildingBlock(content), context);
    return { entity, context };
  }
});

function infantryWeapon(id: string, extraFlags: string[] = []): InfantryWeaponEquipment {
  const weapon = new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags: ['F_INFANTRY', ...extraFlags],
    infantry: {},
  });
  if (!weapon.isInfantryWeapon()) throw new Error(`${id} is not an infantry weapon`);
  return weapon;
}
