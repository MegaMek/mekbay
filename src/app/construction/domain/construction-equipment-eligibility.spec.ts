// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { AmmoEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { MountedEngine, MountedStructure } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createConstructionEntity, type ConstructionUnitKind } from './construction-factory';
import { constructionEquipmentChassisMessages } from './construction-family-rules';
import { constructionEquipmentApplies, constructionEquipmentEligibilityIssues, equipmentPlacementIssues, installConstructionEquipment } from './construction-rules';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';

const technology = { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
const design = (kind: ConstructionUnitKind = 'Biped') => createConstructionEntity(kind, createTestEquipmentRegistry());
const gear = (flags: EquipmentFlag[], tonnage = 1) => new MiscEquipment({ id: flags.join(' '), name: flags.join(' '),
  type: 'misc', tech: technology, flags, stats: { tonnage, criticalSlots: 1 } });
const eligible = (entity: ReturnType<typeof design>, item: MiscEquipment | WeaponEquipment | AmmoEquipment) =>
  constructionEquipmentEligibilityIssues(entity, item).length === 0;

describe('MML construction equipment catalog applicability', () => {
  it('permits flotation hulls on conventional fighters', () => {
    const flotation = gear(['F_TANK_EQUIPMENT', 'F_FLOTATION_HULL']);
    expect(constructionEquipmentApplies(design('ConvFighter'), flotation)).toBeTrue();
    expect(constructionEquipmentApplies(design('Aero'), flotation)).toBeFalse();
  });

  it('filters LAM-only and conversion-incompatible equipment before choosing a location', () => {
    const mek = design(), lam = design('LAM');
    const bay = gear(['F_MEK_EQUIPMENT', 'F_BOMB_BAY']);
    expect(eligible(mek, bay)).toBeFalse();
    expect(eligible(lam, bay)).toBeTrue();
    for (const flag of ['F_NULL_SIG', 'F_VOID_SIG', 'F_MODULAR_ARMOR', 'F_PARTIAL_WING'] as const) {
      const item = gear(['F_MEK_EQUIPMENT', flag]);
      expect(eligible(mek, item)).toBeTrue();
      expect(eligible(lam, item)).toBeFalse();
    }
    expect(() => installConstructionEquipment(mek, bay, 'RT')).toThrowError(/requires a LAM/);
    expect(mek.equipment()).toEqual([]);
  });

  it('uses chassis shape for turrets and drapes', () => {
    const biped = design(), quad = design('Quad');
    const turret = gear(['F_MEK_EQUIPMENT', 'F_QUAD_TURRET']);
    const shoulder = gear(['F_MEK_EQUIPMENT', 'F_SHOULDER_TURRET']);
    const poncho = gear(['F_MEK_EQUIPMENT', 'F_CHAIN_DRAPE_PONCHO']);
    expect(eligible(biped, turret)).toBeFalse();
    expect(eligible(quad, turret)).toBeTrue();
    for (const item of [shoulder, poncho]) {
      expect(eligible(biped, item)).toBeTrue();
      expect(eligible(quad, item)).toBeFalse();
    }
  });

  it('shares superheavy exclusion with installed-equipment validation', () => {
    const mek = design() as MekEntity;
    const item = gear(['F_MEK_EQUIPMENT', 'F_MODULAR_ARMOR']);
    expect(eligible(mek, item)).toBeTrue();
    addTestEquipment(mek, item, { location: 'RT' });
    mek.setTonnage(105);
    const messages = constructionEquipmentChassisMessages(mek, item);
    expect(messages.map(message => message.code)).toEqual(['MEK_SUPERHEAVY_EQUIPMENT']);
    expect(constructionEquipmentEligibilityIssues(mek, item)).toContain(messages[0].message);
    expect(constructionAdvancedMekMessages(mek).filter(message => message.code === 'MEK_SUPERHEAVY_EQUIPMENT').length).toBe(1);
  });

  it('keeps industrial fuel, myomer and heat-sink choices tied to their chassis', () => {
    const mek = design() as MekEntity;
    const fuel = gear(['F_MEK_EQUIPMENT', 'F_FUEL']);
    const tsm = gear(['F_MEK_EQUIPMENT', 'F_TSM']);
    const industrialTsm = gear(['F_MEK_EQUIPMENT', 'F_INDUSTRIAL_TSM']);
    const doubles = gear(['F_DOUBLE_HEAT_SINK']);
    expect(eligible(mek, fuel)).toBeFalse();
    expect(eligible(mek, tsm)).toBeTrue();
    expect(eligible(mek, industrialTsm)).toBeFalse();
    const structure = new StructureEquipment({ id: 'Industrial', name: 'Industrial', type: 'structure',
      flags: ['F_INDUSTRIAL_STRUCTURE'], structure: { typeId: 1 } });
    mek.setUniformStructure(new MountedStructure({ structure, techBase: 'IS', tonnage: 50 }));
    expect(eligible(mek, fuel)).toBeFalse();
    mek.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 200, techBase: 'IS' }));
    expect(eligible(mek, fuel)).toBeTrue();
    expect(eligible(mek, industrialTsm)).toBeTrue();
    expect(eligible(mek, tsm)).toBeFalse();
    expect(eligible(mek, doubles)).toBeFalse();
    mek.heatSinkEquipment.set(doubles);
    expect(constructionAdvancedMekMessages(mek).some(message => message.code === 'INDUSTRIAL_HEAT_SINK')).toBeTrue();
    const primitive = design() as MekEntity;
    primitive.cockpitType.set('Primitive');
    expect(eligible(primitive, doubles)).toBeFalse();
    expect(eligible(primitive, tsm)).toBeFalse();
  });

  it('filters vehicle equipment by movement and compatible powered engines', () => {
    const vehicle = design('Tank');
    const bulldozer = gear(['F_TANK_EQUIPMENT', 'F_BULLDOZER']);
    expect(eligible(vehicle, bulldozer)).toBeTrue();
    vehicle.motiveType.set('Hover');
    expect(eligible(vehicle, bulldozer)).toBeFalse();
    const fuel = gear(['F_TANK_EQUIPMENT', 'F_FUEL']);
    expect(eligible(vehicle, fuel)).toBeFalse();
    vehicle.mountedEngine.set(new MountedEngine({ type: 'Fuel Cell', rating: 200, techBase: 'IS' }));
    expect(eligible(vehicle, fuel)).toBeTrue();
    const booster = gear(['F_TANK_EQUIPMENT', 'F_MASC', 'S_SUPERCHARGER']);
    expect(eligible(vehicle, booster)).toBeTrue();
    vehicle.mountedEngine.set(new MountedEngine({ type: 'Solar', rating: 200, techBase: 'IS' }));
    expect(eligible(vehicle, booster)).toBeFalse();
  });

  it('applies the five-ton small-support equipment boundary without checking free slots', () => {
    const support = design('SupportTank');
    support.setTonnage(4);
    expect(eligible(support, gear(['F_SUPPORT_TANK_EQUIPMENT'], 4.99))).toBeTrue();
    expect(eligible(support, gear(['F_SUPPORT_TANK_EQUIPMENT'], 5))).toBeFalse();
    support.setTonnage(5);
    expect(eligible(support, gear(['F_SUPPORT_TANK_EQUIPMENT'], 5))).toBeTrue();
    const large = new MiscEquipment({ id: 'Many slots', name: 'Many slots', type: 'misc', tech: technology,
      flags: ['F_MEK_EQUIPMENT'], stats: { tonnage: 1, criticalSlots: 100 } });
    const mek = design();
    expect(eligible(mek, large)).toBeTrue();
    expect(equipmentPlacementIssues(mek, large, 'RT').some(issue => issue.includes('critical slots'))).toBeTrue();
  });

  it('offers only eligible infantry weapons in battle-armor AP mounts', () => {
    const ba = design('BattleArmor');
    const weapon = (flags: EquipmentFlag[], crew = 1) => new WeaponEquipment({ id: flags.join(' '), name: 'AP weapon',
      type: 'weapon', tech: technology, flags: ['F_INFANTRY', ...flags], infantry: { crew }, stats: { tonnage: 0.01 } });
    expect(eligible(ba, weapon([]))).toBeTrue();
    expect(eligible(ba, weapon([], 2))).toBeFalse();
    expect(eligible(ba, weapon(['F_INF_ARCHAIC']))).toBeFalse();
    expect(eligible(ba, weapon(['F_INF_POINT_BLANK']))).toBeFalse();
  });

  it('filters nonstandard missile sizes consistently for Mek, vehicle and fighter catalogs', () => {
    const weapon = (rackSize: number) => new WeaponEquipment({ id: `LRM ${rackSize}`, name: `LRM ${rackSize}`,
      type: 'weapon', tech: technology, flags: ['F_MEK_WEAPON', 'F_TANK_WEAPON', 'F_AERO_WEAPON', 'F_LRM'],
      stats: { tonnage: 1 }, weapon: { ammoType: 'LRM', rackSize } });
    for (const kind of ['Biped', 'Tank', 'Aero'] as const) {
      expect(constructionEquipmentApplies(design(kind), weapon(5))).toBeTrue();
      expect(constructionEquipmentApplies(design(kind), weapon(3))).toBeFalse();
    }
  });

  it('shows ammunition only for a usable installed weapon and exempts coolant pods', () => {
    const mek = design();
    const ammo = new AmmoEquipment({ id: 'AC5 ammo', name: 'AC5 ammo', type: 'ammo', tech: technology,
      ammo: { type: 'AC', rackSize: 5, shots: 20, munitionType: ['M_STANDARD'] } });
    const weapon = (oneShot: boolean) => new WeaponEquipment({ id: `AC5 ${oneShot}`, name: 'AC5', type: 'weapon', tech: technology,
      flags: ['F_MEK_WEAPON', ...(oneShot ? ['F_ONE_SHOT' as const] : [])], stats: { tonnage: 8 }, weapon: { ammoType: 'AC', rackSize: 5 } });
    expect(eligible(mek, ammo)).toBeFalse();
    addTestEquipment(mek, weapon(true), { location: 'RT' });
    expect(eligible(mek, ammo)).toBeFalse();
    addTestEquipment(mek, weapon(false), { location: 'LT' });
    expect(eligible(mek, ammo)).toBeTrue();
    const coolant = new AmmoEquipment({ id: 'Coolant', name: 'Coolant', type: 'ammo', tech: technology,
      ammo: { type: 'COOLANT_POD', munitionType: ['M_STANDARD'] } });
    expect(eligible(design(), coolant)).toBeTrue();
  });
});
