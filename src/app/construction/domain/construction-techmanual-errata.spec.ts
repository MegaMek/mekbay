// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { MountedArmor, MountedEngine } from '../../models/entity/components';
import { BattleArmorEntity, SupportTankEntity } from '../../models/entity/entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { getEquipmentEngineWeight } from '../../models/entity/utils/equipment-engine-weight';
import { calculateTransportBayPersonnel } from '../../models/entity/utils/crew-requirements';
import { INFANTRY_TRANSPORT_WEIGHTS } from '../../models/entity/types';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { constructionSupportSlots } from './construction-support-vessel-rules';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';
import { constructionMaterialMessages } from './construction-material-rules';
import { constructionEquipmentEligibilityIssues, equipmentPlacementIssues, validateConstruction } from './construction-rules';

const registry = createTestEquipmentRegistry();
const codes = (entity: Parameters<typeof validateConstruction>[0]) => validateConstruction(entity).messages.map(message => message.code);
const bar10 = new ArmorEquipment({ id: 'BAR 10', name: 'BAR 10', type: 'armor',
  flags: ['F_SUPPORT_VEE_BAR_ARMOR', 'F_SUPPORT_TANK_EQUIPMENT'], armor: { type: 'SV_BAR_10' },
  stats: { criticalSlots: 0, svSlots: 0 } });
const camo = new MiscEquipment({ id: 'Camo System', name: 'Camo System', type: 'misc',
  flags: ['F_BA_EQUIPMENT', 'F_VISUAL_CAMO', 'F_STEALTH'], stats: { criticalSlots: 2, tonnage: .2 } });
const mimetic = new ArmorEquipment({ id: 'Mimetic', name: 'Mimetic', type: 'armor',
  flags: ['F_BA_EQUIPMENT', 'F_VISUAL_CAMO'], armor: { type: 'BA_MIMETIC' } });

describe('TechManual errata v8 construction corrections', () => {
  for (const [rating, expected] of [['D', 0], ['E', 2], ['F', 1]] as const) {
    it(`reserves ${expected} support vehicle slots for BAR 10 armor at rating ${rating}`, () => {
      const entity = createConstructionEntity('SupportTank', registry) as SupportTankEntity;
      entity.setUniformArmor(new MountedArmor({ armor: bar10, techRating: rating }));
      expect(getNumCriticalSlots(entity, bar10)).toBe(expected);
      expect(constructionSupportSlots(entity).used).toBe(expected);
    });
  }

  it('uses each patchwork location’s armor rating for its slot reservation', () => {
    const entity = createConstructionEntity('SupportTank', registry) as SupportTankEntity;
    entity.setUniformArmor(new MountedArmor({ armor: bar10, techRating: 'D' }));
    entity.setArmorAt('Front', new MountedArmor({ armor: bar10, techRating: 'E' }));
    entity.setArmorAt('Rear', new MountedArmor({ armor: bar10, techRating: 'F' }));
    expect(constructionSupportSlots(entity).used).toBe(3);
  });

  it('rounds the support hover engine minimum upward even when normal rounding would be lower', () => {
    const entity = createConstructionEntity('SupportTank', registry) as SupportTankEntity;
    entity.setTonnage(5.5); entity.motiveType.set('Hover'); entity.originalWalkMP.set(0);
    entity.engineTechRating.set(5);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 0, techBase: 'IS' }));
    expect(getEquipmentEngineWeight(entity)).toBe(1.5); // 20% = 1.1 tons, minimum rounds UP.
    entity.setTonnage(1.001);
    expect(getEquipmentEngineWeight(entity)).toBeGreaterThanOrEqual(.201);
  });

  for (const kind of ['SupportTank', 'FixedWingSupport'] as const) it(`caps derived engine rating at 500 for ${kind}`, () => {
    const entity = createConstructionEntity(kind, registry);
    entity.setTonnage(200); entity.originalWalkMP.set(10);
    getConstructionFields(entity).find(field => field.id === 'mixedTech')!.set(true);
    expect(entity.mountedEngine().rating).toBe(500);
    entity.setTonnage(2.5); entity.originalWalkMP.set(3);
    getConstructionFields(entity).find(field => field.id === 'mixedTech')!.set(false);
    expect(entity.mountedEngine().rating).toBe(7.5);
  });

  it('excludes camo and mimetic armor in either selection order and diagnoses imported combinations', () => {
    const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
    const mount = addTestEquipment(entity, camo, { location: 'Squad', baMountLocation: 'Body' });
    expect(constructionMaterialMessages(entity, mimetic).map(message => message.code)).toContain('BA_CAMO_MIMETIC_CONFLICT');
    entity.removeEquipment(mount);
    entity.setUniformArmor(new MountedArmor({ armor: mimetic }));
    const issue = constructionEquipmentConflictMessages(entity, camo).find(message => message.code === 'BA_CAMO_MIMETIC_CONFLICT')!;
    expect(constructionEquipmentEligibilityIssues(entity, camo)).toContain(issue.message);
    addTestEquipment(entity, camo, { location: 'Squad', baMountLocation: 'Body' });
    expect(codes(entity)).toContain('BA_CAMO_MIMETIC_CONFLICT');
  });

  it('limits camo systems per suit while allowing different troopers their own system', () => {
    const entity = createConstructionEntity('BattleArmor', registry);
    for (const location of ['Trooper 1', 'Trooper 2']) addTestEquipment(entity, camo, { location, baMountLocation: 'Body' });
    expect(codes(entity)).not.toContain('BA_CAMO_LIMIT');
    expect(equipmentPlacementIssues(entity, camo, 'Squad')).toContain('Only one camo system is permitted on a suit.');
    expect(equipmentPlacementIssues(entity, camo, 'Trooper 3')).not.toContain('Only one camo system is permitted on a suit.');
    addTestEquipment(entity, camo, { location: 'Squad', baMountLocation: 'Body' });
    expect(codes(entity)).toContain('BA_CAMO_LIMIT');
  });

  it('counts a squad support weapon against every suit’s anti-Mek weapon allowance', () => {
    const entity = createConstructionEntity('BattleArmor', registry);
    const weapon = new WeaponEquipment({ id: 'BA gun', name: 'BA gun', type: 'weapon', flags: ['F_BA_WEAPON'] });
    addTestEquipment(entity, weapon, { location: 'Trooper 1', baMountLocation: 'Body', isSSWM: true });
    for (let i = 0; i < 2; i++) addTestEquipment(entity, weapon, { location: 'Trooper 2', baMountLocation: 'Body' });
    expect(validateConstruction(entity).messages).toContain(jasmine.objectContaining({ code: 'BA_ANTI_MEK_WEAPON_LIMIT', message: 'Too many anti-Mek weapons on trooper 2 Body.' }));
  });

  it('permits one 1–15 ton communications set and flags fractional, oversized or duplicate sets', () => {
    const entity = createConstructionEntity('Tank', registry);
    const comms = new MiscEquipment({ id: 'Comms', name: 'Comms', type: 'misc', flags: ['F_COMMUNICATIONS', 'F_TANK_EQUIPMENT'] });
    const mount = addTestEquipment(entity, comms, { location: 'Body', size: 15 });
    expect(codes(entity)).not.toContain('COMMUNICATIONS_SIZE');
    expect(constructionEquipmentConflictMessages(entity, comms).map(message => message.code)).toContain('COMMUNICATIONS_SET_LIMIT');
    for (const size of [.5, 15.5, 16]) {
      entity.updateEquipment(mounts => mounts.map(current => current.mountId === mount.mountId ? current.clone({ size }) : current));
      expect(codes(entity)).toContain('COMMUNICATIONS_SIZE');
    }
  });

  for (const infantryType of ['Foot', 'Jump', 'Motorized', 'Mechanized'] as const) it(`uses the corrected ${infantryType} bay personnel capacity for both tech bases`, () => {
    const entity = createConstructionEntity('DropShip', registry);
    entity.transporters.set([{ id: 'infantry', kind: 'bay', configuration: { type: 'infantry', infantryType },
      capacity: INFANTRY_TRANSPORT_WEIGHTS[infantryType], bayNumber: 1, doors: 0, omni: false }]);
    for (const tech of ['IS', 'Clan'] as const) {
      entity.techBase.set(tech);
      expect(calculateTransportBayPersonnel(entity)).toBe(infantryType === 'Mechanized' ? 7 : 30);
    }
  });
});
