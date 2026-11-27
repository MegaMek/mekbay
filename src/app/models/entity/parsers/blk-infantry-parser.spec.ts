// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { InfantryWeaponEquipment, MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { writeBlkInfantry } from '../writers/blk-infantry-writer';
import { BuildingBlock } from './building-block';
import { parseBlkInfantry } from './blk-infantry-parser';
import { ParseContext } from './parse-context';
import { EquipmentFlag } from '../../equipment-flags.type';
describe('BLK conventional infantry codec', () => {
  const primary = infantryWeapon('InfantryRifle');
  const secondary = infantryWeapon('InfantrySupportLaser', ['F_INF_SUPPORT']);
  const srmLauncher = infantryWeapon('InfantryStandardSRM', ['F_SRM']);
  const armorKit = new MiscEquipment({
    id: 'InfantryArmorKit',
    name: 'Infantry Armor Kit',
    type: 'misc',
    flags: ['F_ARMOR_KIT', 'S_ENCUMBERING', 'S_SPACE_SUIT'],
  });
  const disposable = new WeaponEquipment({
    id: 'Rocket Launcher (LAW)',
    name: 'Rocket Launcher (LAW)',
    type: 'weapon',
    flags: ['F_INFANTRY', 'F_INF_DISPOSABLE'],
    infantry: { damage: 0.53 },
    stats: { bv: 2.71 },
  }) as InfantryWeaponEquipment;
  const nonInfantryWeapon = new WeaponEquipment({
    id: 'MediumLaser',
    name: 'Medium Laser',
    type: 'weapon',
  });
  const registry = createTestEquipmentRegistry({
    [primary.id]: primary,
    [secondary.id]: secondary,
    [srmLauncher.id]: srmLauncher,
    // The equipment data maps a withdrawn Inferno launcher name to the plain launcher.
    InfantryStandardSRMInferno: srmLauncher,
    [armorKit.id]: armorKit,
    [disposable.id]: disposable,
    [nonInfantryWeapon.id]: nonInfantryWeapon,
  });

  it('mounts primary and secondary weapons after all other equipment and writes them back as fields', () => {
    const { entity, context } = parse(`
<Troopers Equipment>
${armorKit.id}
</Troopers Equipment>
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
    expect(entity.equipment().map(mount => [mount.equipment, mount.location, mount.platoonWeapon])).toEqual([
      [armorKit, 'Infantry', undefined],
      [primary, 'Infantry', 'primary'],
      [secondary, 'Infantry', 'secondary'],
    ]);

    const output = writeBlkInfantry(entity);
    expect(output).toContain(`<Troopers Equipment>\n${armorKit.id}\n</Troopers Equipment>`);
    expect(output).toContain(`<Primary>\n${primary.id}\n</Primary>`);
    expect(output).toContain(`<Secondary>\n${secondary.id}\n</Secondary>`);
    expect(output).toContain('<secondn>\n2\n</secondn>');
  });

  it('keeps the disposable weapon, SRM munition and mission roles', () => {
    const { entity, context } = parse(`
<missionroles>
fire_support
</missionroles>
<squad_size>
7
</squad_size>
<squadn>
4
</squadn>
<Primary>
${srmLauncher.id}
</Primary>
<disposableWeapon>
${disposable.id}
</disposableWeapon>
<srmMunition>
Inferno
</srmMunition>`);

    expect(context.errors).toEqual([]);
    expect(entity.disposableWeapon()).toBe(disposable);
    expect(entity.platoonWeaponTroopers('disposable')).toBe(28);
    expect(entity.infernoSrmsDeclared()).toBeTrue();
    expect(entity.missionRoles()).toBe('fire_support');
    const output = writeBlkInfantry(entity);
    expect(output).toContain(`<disposableWeapon>\n${disposable.id}\n</disposableWeapon>`);
    expect(output).toContain('<srmMunition>\nInferno\n</srmMunition>');
    expect(output).toContain('<missionroles>\nfire_support\n</missionroles>');
    expect(output).not.toContain(`<Troopers Equipment>\n${disposable.id}`);
  });

  it('declares Inferno for a withdrawn Inferno launcher name unless the file declares a munition', () => {
    const withdrawn = `
<Primary>
InfantryStandardSRMInferno
</Primary>`;
    const { entity, context } = parse(withdrawn);
    expect(context.errors).toEqual([]);
    expect(entity.primaryWeapon()).toBe(srmLauncher);
    expect(entity.firesInfernoSrms()).toBeTrue();
    const output = writeBlkInfantry(entity);
    expect(output).toContain(`<Primary>\n${srmLauncher.id}\n</Primary>`);
    expect(output).toContain('<srmMunition>\nInferno\n</srmMunition>');

    expect(parse(`${withdrawn}\n<srmMunition>\nStandard\n</srmMunition>`).entity.infernoSrmsDeclared()).toBeFalse();
    // Without an SRM launcher the declaration has no effect and is not written.
    entity.setPlatoonWeapon('primary', primary);
    expect(entity.firesInfernoSrms()).toBeFalse();
    expect(writeBlkInfantry(entity)).not.toContain('srmMunition');
  });

  it('rejects a disposableWeapon entry that is not a disposable weapon', () => {
    const { entity, context } = parse(`
<Primary>
${primary.id}
</Primary>
<disposableWeapon>
${primary.id}
</disposableWeapon>`);

    expect(entity.disposableWeapon()).toBeNull();
    expect(context.errors).toContain(jasmine.objectContaining({ field: 'disposableWeapon' }));
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
    expect(entity.equipment().map(mount => mount.equipment)).toEqual([armorKit, primary]);
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

function infantryWeapon(id: string, extraFlags: EquipmentFlag[] = []): InfantryWeaponEquipment {
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
