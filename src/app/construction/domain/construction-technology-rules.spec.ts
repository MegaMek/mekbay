// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MountedArmor, MountedEngine } from '../../models/entity/components';
import { AeroEntity, MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { approx } from '../../models/entity/types';
import { createConstructionEntity } from './construction-factory';
import { constructionEngineTechnology, constructionTechnologyEligibility, constructionTechnologyMessages } from './construction-technology-rules';
import { constructionEngineCompatible } from './construction-system-rules';
import { constructionEquipmentEligibilityIssues, equipmentPlacementIssues, installConstructionEquipment, setConstructionArmorMaterial, validateConstruction } from './construction-rules';
import { getConstructionArmorOptions } from './construction-material-rules';

const registry = createTestEquipmentRegistry({});
describe('construction system technology', () => {
  it('accepts KGC-000 Star League equipment at its static Standard rules level without duplicate warnings', () => {
    const caseEquipment = new MiscEquipment({ id: 'ISCASE', name: 'CASE', type: 'misc',
      flags: ['F_MEK_EQUIPMENT', 'F_CASE'], stats: { tonnage: 0.5, criticalSlots: 1 },
      tech: { base: 'IS', level: 'Standard', advancement: { is: {
        prototype: '2452', production: '2476', common: '3045', extinct: '2840', reintroduced: '3036',
      } } } });
    const ferro = new ArmorEquipment({ id: 'IS Ferro-Fibrous', name: 'Ferro-Fibrous', type: 'armor',
      flags: ['F_MEK_EQUIPMENT', 'F_FERRO_FIBROUS'], stats: { criticalSlots: 'variable', spreadable: true },
      armor: { type: 'FERRO_FIBROUS', pptMultiplier: 1.12 },
      tech: { base: 'All', level: 'Standard', advancement: {
        is: { prototype: '2557', production: '2571', common: '3055', extinct: '~2810', reintroduced: '3040' },
        clan: { prototype: '2557', production: '2571', common: '~2820' },
      } } });
    const entity = createConstructionEntity('Biped', createTestEquipmentRegistry({ [caseEquipment.id]: caseEquipment, [ferro.id]: ferro }));
    entity.year.set(2743);
    entity.rulesLevel.set(2);
    for (const equipment of [caseEquipment, ferro]) {
      expect(equipment.getTechLevel(2743, 'IS')).toBe('Advanced');
      expect(constructionTechnologyEligibility(entity, equipment.tech)).toEqual({ techBase: true, available: true, rulesLevel: true });
    }
    expect(constructionEquipmentEligibilityIssues(entity, caseEquipment)).toEqual([]);
    expect(getConstructionArmorOptions(entity)).toContain(ferro);
    installConstructionEquipment(entity, caseEquipment, 'LT');
    installConstructionEquipment(entity, caseEquipment, 'RT');
    setConstructionArmorMaterial(entity, ferro);
    const technologyIssues = () => validateConstruction(entity).messages.filter(message => message.message.includes('rules level'));
    expect(technologyIssues()).toEqual([]);

    entity.rulesLevel.set(1);
    expect(technologyIssues().map(message => [message.code, message.location])).toEqual([
      ['MATERIAL_TECH_LEVEL', undefined], ['TECH_LEVEL_EXCEEDED', 'LT'], ['TECH_LEVEL_EXCEEDED', 'RT'],
    ]);
    expect(equipmentPlacementIssues(entity, caseEquipment, 'LA')).toContain('Requires a torso.');
    expect(equipmentPlacementIssues(entity, caseEquipment, 'LA')).toContain('Exceeds the selected rules level.');
  });

  it('checks a vehicle engine technology base independently of its chassis', () => {
    const entity = createConstructionEntity('Tank', registry);
    entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 200, techBase: 'Clan', installed: true }));
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_BASE')).toBeTrue();
    entity.mixedTech.set(true);
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_BASE')).toBeFalse();
  });

  it('accepts shared engine technology on Clan chassis regardless of the native engine flag', () => {
    for (const family of ['Tank', 'ProtoMek', 'Aero', 'Biped'] as const) {
      const entity = createConstructionEntity(family, registry);
      entity.techBase.set('Clan');
      entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'IS', installed: true }));
      expect(constructionEngineCompatible(entity, 'Fusion', 'IS')).withContext(family).toBeTrue();
      expect(validateConstruction(entity).messages.some(message =>
        message.code.endsWith('TECH_BASE') && message.message.startsWith('Engine'))).withContext(family).toBeFalse();

      expect(constructionEngineCompatible(entity, 'XL', 'IS')).withContext(family).toBeFalse();
      entity.mixedTech.set(true);
      expect(constructionEngineCompatible(entity, 'XL', 'IS')).withContext(family).toBeTrue();
    }
  });

  it('uses aerospace engine technology for large craft while retaining large ground-engine restrictions', () => {
    for (const family of ['SmallCraft', 'DropShip', 'JumpShip', 'WarShip'] as const) {
      const entity = createConstructionEntity(family, registry);
      entity.rulesLevel.set(2);
      entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 3000, techBase: 'IS', installed: true }));
      expect(constructionEngineTechnology(entity, 'Fusion', 'IS').level).withContext(family).toBe('Introductory');
      expect(constructionEngineCompatible(entity, 'Fusion', 'IS')).withContext(family).toBeTrue();
      expect(constructionTechnologyMessages(entity).filter(message => message.message.startsWith('Engine')))
        .withContext(family).toEqual([]);
    }
    for (const family of ['Biped', 'Tank'] as const) {
      const entity = createConstructionEntity(family, registry);
      entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 450, techBase: 'IS', installed: true }));
      entity.rulesLevel.set(2);
      expect(constructionEngineCompatible(entity, 'Fusion', 'IS')).withContext(family).toBeFalse();
      entity.rulesLevel.set(4);
      expect(constructionEngineCompatible(entity, 'Fusion', 'IS')).withContext(family).toBeTrue();
    }
  });

  it('checks fighter cockpit introduction dates', () => {
    const entity = createConstructionEntity('Aero', registry) as AeroEntity;
    entity.cockpitType.set('Small');
    entity.year.set(3000);
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_DATE' && message.message.startsWith('Cockpit'))).toBeTrue();
    entity.year.set(3151);
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_DATE' && message.message.startsWith('Cockpit'))).toBeFalse();
  });

  it('uses the ProtoMek built-in EI exception consistently with static metadata', () => {
    const ei = new MiscEquipment({ id: 'EIInterface', name: 'Enhanced Imaging (EI) Interface', type: 'misc',
      flags: ['F_EI_INTERFACE', 'F_PROTOMEK_EQUIPMENT', 'F_MEK_EQUIPMENT'],
      stats: { tonnage: 0, criticalSlots: 0 },
      tech: { base: 'Clan', level: 'Experimental', advancement: { clan: { common: '3050' } } } });
    const entity = createConstructionEntity('ProtoMek', createTestEquipmentRegistry({ [ei.id]: ei }));
    entity.techBase.set('Clan');
    entity.rulesLevel.set(2);
    expect(constructionEquipmentEligibilityIssues(entity, ei)).toEqual([]);
    installConstructionEquipment(entity, ei, 'Body');
    expect(validateConstruction(entity).messages.filter(message => message.category === 'tech' && message.message.includes(ei.name)))
      .toEqual([]);

    const mek = createConstructionEntity('Biped', registry);
    mek.techBase.set('Clan');
    mek.rulesLevel.set(2);
    expect(constructionEquipmentEligibilityIssues(mek, ei)).toContain('Exceeds the selected rules level.');
  });

  it('checks selected Mek auxiliary systems and context-free experimental construction', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    entity.hasFullHeadEjectionSystem.set(true);
    entity.year.set(3000);
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_DATE')).toBeTrue();
    entity.year.set(3151);
    entity.configureEngine(new MountedEngine({ type: 'ICE', rating: 200, techBase: 'IS', installed: true }));
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_LEVEL' && message.message.includes('experimental'))).toBeTrue();
  });

  it('validates selected quirks without blanket coverage warnings', () => {
    const entity = createConstructionEntity('Tank', registry);
    expect(validateConstruction(entity).messages.some(message => message.code === 'QUIRK_ELIGIBILITY_METADATA')).toBeFalse();
    entity.quirks.set([{ quirk: { key: 'easy_maintain', name: 'Easy to Maintain', description: '', type: 'positive' } }]);
    expect(validateConstruction(entity).messages.some(message => message.code === 'QUIRK_ELIGIBILITY_METADATA')).toBeFalse();
    expect(validateConstruction(entity).messages.some(message => message.code === 'QUIRK_NOT_APPLICABLE')).toBeFalse();
    expect(validateConstruction(entity).messages.some(message => message.code === 'CONSTRUCTION_RULE_COVERAGE')).toBeFalse();
  });
});

describe('OEM technology interval', () => {
  const history = { base: 'IS', level: 'Standard', advancement: { is: {
    prototype: '2700', production: '2710', common: '2720', extinct: '2800', reintroduced: '3100',
  } } } as const;
  const laser = new WeaponEquipment({ id: 'Historical laser', name: 'Historical laser', type: 'weapon', tech: history,
    flags: ['F_MEK_WEAPON', 'F_ENERGY'], stats: { tonnage: 1, criticalSlots: 1 }, weapon: { damage: 5, heat: 3 } });
  const armor = new ArmorEquipment({ id: 'Historical armor', name: 'Historical armor', type: 'armor', tech: history,
    flags: ['F_MEK_EQUIPMENT'], armor: { type: 'STANDARD' } });
  const equipment = createTestEquipmentRegistry({ [laser.id]: laser, [armor.id]: armor });
  const design = () => {
    const entity = createConstructionEntity('Biped', equipment);
    entity.year.set(3050);
    entity.originalBuildYear.set(2690);
    return entity;
  };

  it('admits a technology available only inside the inclusive OEM/introduction interval', () => {
    const entity = design();
    expect(laser.isAvailableIn(2690, 'IS')).toBeFalse();
    expect(laser.isAvailableIn(3050, 'IS')).toBeFalse();
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toEqual([]);
    expect(equipmentPlacementIssues(entity, laser, 'RA')).toEqual([]);
    installConstructionEquipment(entity, laser, 'RA');
    expect(validateConstruction(entity).messages.filter(message => message.code.startsWith('TECH_'))).toEqual([]);
  });

  it('respects extinction boundaries and later reintroduction', () => {
    const entity = design();
    entity.originalBuildYear.set(2800);
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toEqual([]);
    entity.originalBuildYear.set(2801);
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toContain('Not available in 2801–3050.');
    entity.year.set(3100);
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toEqual([]);
    entity.originalBuildYear.set(-1);
    entity.year.set(3050);
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toContain('Not available in 3050.');
  });

  it('enforces the static rules level even after a technology becomes common', () => {
    const entity = design();
    const technology = { ...laser.tech, level: 'Advanced' as const };
    expect(constructionTechnologyEligibility(entity, technology)).toEqual({ techBase: true, available: true, rulesLevel: false });
    entity.rulesLevel.set(3);
    expect(constructionTechnologyEligibility(entity, technology)).toEqual({ techBase: true, available: true, rulesLevel: true });
  });

  it('requires availability for an eligible mixed-tech base or the explicitly selected base', () => {
    const entity = design();
    entity.mixedTech.set(true);
    const technology = { ...laser.tech, base: 'All' as const, advancement: {
      is: { prototype: 2700 }, clan: { common: 2600, extinct: 2650 },
    } };
    expect(constructionTechnologyEligibility(entity, technology)).toEqual({ techBase: true, available: true, rulesLevel: true });
    expect(constructionTechnologyEligibility(entity, technology, 'Clan')).toEqual({ techBase: true, available: false, rulesLevel: true });
    expect(constructionTechnologyEligibility(entity, { ...technology, advancement: {
      ...technology.advancement, is: { prototype: 3100 },
    } }).available).toBeFalse();
  });

  it('uses canonical approximation and faction dissemination dates as interval boundaries', () => {
    const entity = design();
    entity.faction.set('FS');
    entity.originalBuildYear.set(2790);
    entity.year.set(2802);
    const technology = { ...laser.tech, advancement: { is: { prototype: approx(2800), production: 2810, common: 2850 } },
      factions: { prototype: ['DC'], production: ['DC'] } };
    expect(constructionTechnologyEligibility(entity, technology)).toEqual({ techBase: true, available: false, rulesLevel: true });
    entity.year.set(2803);
    expect(constructionTechnologyEligibility(entity, technology)).toEqual({ techBase: true, available: true, rulesLevel: true });
  });

  it('keeps the warehouse independent of free slots and rejects wrong platforms and tech bases', () => {
    const entity = design();
    const huge = new WeaponEquipment({ id: 'Huge laser', name: 'Huge laser', type: 'weapon', tech: history,
      flags: ['F_MEK_WEAPON'], stats: { criticalSlots: 100 } });
    expect(constructionEquipmentEligibilityIssues(entity, huge)).toEqual([]);
    expect(equipmentPlacementIssues(entity, huge, 'RA').some(issue => issue.includes('critical slots'))).toBeTrue();
    expect(constructionEquipmentEligibilityIssues(createConstructionEntity('Tank', equipment), laser).some(issue => issue.includes('unit family'))).toBeTrue();
    entity.techBase.set('Clan');
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toContain('Requires mixed technology.');
    entity.mixedTech.set(true);
    expect(constructionEquipmentEligibilityIssues(entity, laser)).toEqual([]);
  });

  it('applies the same interval to material and chassis-system validation', () => {
    const entity = design();
    entity.setUniformArmor(new MountedArmor({ armor, techBase: 'IS' }));
    spyOn(entity, 'entityTechAdvancements').and.returnValue([laser.tech]);
    const unavailable = () => validateConstruction(entity).messages.filter(message => message.code === 'SYSTEM_TECH_DATE'
      || message.code === 'MATERIAL_TECH_UNAVAILABLE' && message.message.startsWith(armor.name));
    expect(unavailable()).toEqual([]);
    entity.originalBuildYear.set(-1);
    const codes = unavailable().map(message => message.code);
    expect(codes).toContain('MATERIAL_TECH_UNAVAILABLE');
    expect(codes).toContain('SYSTEM_TECH_DATE');
  });
});
