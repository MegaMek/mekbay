// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ArmorEquipment, StructureEquipment } from '../../models/equipment.model';
import { MountedArmor, MountedStructure } from '../../models/entity/components';
import { MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { createConstructionEntity } from './construction-factory';
import { constructionMaterialMessages, getConstructionArmorOptions, getConstructionStructureOptions } from './construction-material-rules';
import { setConstructionArmorMaterial, setConstructionStructure, validateConstruction } from './construction-rules';

describe('construction material eligibility', () => {
  const tech = { base: 'All', level: 'Standard', rating: 'D', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
  const hardened = new ArmorEquipment({ type: 'armor', id: 'Hardened', name: 'Hardened', tech,
    flags: ['F_MEK_EQUIPMENT', 'F_TANK_EQUIPMENT'], armor: { type: 'HARDENED' } });
  const historical = new ArmorEquipment({ type: 'armor', id: 'Historical', name: 'Historical',
    tech: { ...tech, base: 'Clan', advancement: { clan: { common: '2700', extinct: '2800' } } },
    flags: ['F_MEK_EQUIPMENT'], armor: { type: 'STANDARD' } });
  const industrial = new StructureEquipment({ type: 'structure', id: 'Industrial', name: 'Industrial', tech,
    flags: ['F_INDUSTRIAL_STRUCTURE'], structure: { typeId: 1 } });
  const composite = new StructureEquipment({ type: 'structure', id: 'Composite', name: 'Composite', tech,
    flags: ['F_COMPOSITE'], structure: { typeId: 4 } });
  const registry = createTestEquipmentRegistry({ Hardened: hardened, Historical: historical, Industrial: industrial, Composite: composite });

  it('checks standard structure dates only for Meks, whose structure is a construction choice', () => {
    const mek = createConstructionEntity('Biped', registry);
    mek.year.set(2300);
    const standard = mek.structureAt('CT').structure;
    expect(constructionMaterialMessages(mek, standard).map(issue => issue.code)).toContain('MATERIAL_TECH_UNAVAILABLE');
    for (const family of ['Tank', 'SupportTank', 'Aero', 'DropShip', 'WarShip', 'SpaceStation', 'BuildingEntity'] as const) {
      const entity = createConstructionEntity(family, registry);
      entity.year.set(2300);
      expect(constructionMaterialMessages(entity, standard)).withContext(family).toEqual([]);
    }
  });

  it('uses the same OEM/base rules for choices, installation and validation', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.year.set(3000); entity.originalBuildYear.set(2600);
    expect(getConstructionArmorOptions(entity)).not.toContain(historical);
    entity.mixedTech.set(true);
    expect(getConstructionArmorOptions(entity)).toContain(historical);
    setConstructionArmorMaterial(entity, historical);
    expect(validateConstruction(entity).messages.some(message => message.code === 'MATERIAL_TECH_UNAVAILABLE')).toBeFalse();
    entity.originalBuildYear.set(-1);
    expect(getConstructionArmorOptions(entity)).not.toContain(historical);
    expect(getConstructionArmorOptions(entity, true)).toContain(historical);
    expect(() => setConstructionArmorMaterial(entity, historical)).toThrowError(/unavailable/);
    expect(entity.uniformArmor()?.armor).toBe(historical);
  });

  it('filters hardened armor for LAM and hover/VTOL chassis but permits tracked vehicles', () => {
    for (const kind of ['LAM', 'VTOL', 'Tank'] as const) {
      const entity = createConstructionEntity(kind, registry);
      if (kind === 'Tank') entity.motiveType.set('Hover');
      expect(getConstructionArmorOptions(entity)).not.toContain(hardened);
    }
    expect(getConstructionArmorOptions(createConstructionEntity('Tank', registry))).toContain(hardened);
  });

  it('permits Reactive fighter armor despite its missing native flag without permitting it on larger craft', () => {
    for (const base of ['IS', 'Clan'] as const) {
      const reactive = new ArmorEquipment({ type: 'armor', id: `${base} Reactive`, name: 'Reactive',
        tech: { ...tech, base }, flags: ['F_REACTIVE', 'F_MEK_EQUIPMENT', 'F_TANK_EQUIPMENT'],
        armor: { type: 'REACTIVE' } });
      const armorRegistry = createTestEquipmentRegistry({ [reactive.id]: reactive });
      for (const kind of ['Aero', 'ConvFighter'] as const) {
        const entity = createConstructionEntity(kind, armorRegistry);
        entity.techBase.set(base); entity.year.set(3150);
        expect(getConstructionArmorOptions(entity)).withContext(`${base} ${kind}`).toContain(reactive);
        setConstructionArmorMaterial(entity, reactive);
        expect(constructionMaterialMessages(entity, reactive).map(issue => issue.code)).not.toContain('ARMOR_PLATFORM');
      }
      for (const kind of ['SmallCraft', 'DropShip'] as const) {
        const entity = createConstructionEntity(kind, armorRegistry);
        entity.techBase.set(base); entity.year.set(3150);
        expect(getConstructionArmorOptions(entity)).withContext(`${base} ${kind}`).not.toContain(reactive);
        expect(constructionMaterialMessages(entity, reactive).map(issue => issue.code)).toContain('ARMOR_PLATFORM');
      }
    }
  });

  it('preserves the structure transition out of IndustrialMek status and rejects superheavy composite', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    const standard = entity.structureAt('CT').structure;
    setConstructionStructure(entity, industrial);
    expect(entity.isIndustrial()).toBeTrue();
    expect(getConstructionStructureOptions(entity)).toContain(standard);
    setConstructionStructure(entity, standard);
    expect(entity.isIndustrial()).toBeFalse();
    expect(getConstructionStructureOptions(entity)).toContain(composite);
    entity.setTonnage(150);
    expect(getConstructionStructureOptions(entity)).not.toContain(composite);
  });

  it('uses the actual mounted support armor rating in validation', () => {
    const armor = new ArmorEquipment({ type: 'armor', id: 'Rated BAR', name: 'Rated BAR', tech,
      flags: ['F_SUPPORT_TANK_EQUIPMENT', 'F_SUPPORT_VEE_BAR_ARMOR'],
      armor: { type: 'SV_BAR_10', bar: 10, weightPerPointSV: { D: 0.1, F: 0.04 } } });
    const entity = createConstructionEntity('SupportTank', registry);
    if (entity.isSupportVehicle()) entity.structuralTechRating.set(3);
    expect(constructionMaterialMessages(entity, armor).some(issue => issue.code === 'SUPPORT_ARMORED_CHASSIS_REQUIRED')).toBeTrue();
    entity.setUniformArmor(new MountedArmor({ armor, techRating: 'F' }));
    expect(validateConstruction(entity).messages.some(issue => issue.code === 'SUPPORT_ARMORED_CHASSIS_REQUIRED')).toBeFalse();
  });

  it('allows an independent donor-tonnage correction while preserving an incompatible installed material', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    entity.setStructureAt('RA', new MountedStructure({ structure: composite, tonnage: 55, techBase: 'Clan' }));
    entity.year.set(2400);
    setConstructionStructure(entity, composite, 'RA', 60);
    expect(entity.structureAt('RA').tonnage).toBe(60);
    expect(entity.structureAt('RA').techBase).toBe('Clan');
  });
});
