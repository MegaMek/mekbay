// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed } from '@angular/core';
import { MountedEngine, getSupportComponentTech } from '../../models/entity/components';
import { InfantryEntity, MekEntity } from '../../models/entity/entities';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { validateConstruction } from './construction-rules';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';
import { constructionTechnologyEligibility, constructionTechnologyMessages } from './construction-technology-rules';
import { constructionInfantryBaMessages } from './construction-infantry-ba-rules';
import { PREDEFINED_INFANTRY_MOUNTS } from '../../models/entity/types/infantry';

const sink = new MiscEquipment({ id: 'Historical double sink', name: 'Historical double sink', type: 'misc',
  flags: ['F_DOUBLE_HEAT_SINK'], stats: { tonnage: 1, criticalSlots: 3 },
  tech: { base: 'IS', level: 'Standard', advancement: { is: { common: '2700', extinct: '2800', reintroduced: '3100' } } } });
const registry = createTestEquipmentRegistry({ [sink.id]: sink });

describe('construction system choices', () => {
  const design = () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    entity.year.set(3151);
    entity.rulesLevel.set(4);
    return entity;
  };
  const field = (entity: Parameters<typeof getConstructionFields>[0], id: string, showIncompatible = false) =>
    getConstructionFields(entity, showIncompatible).find(item => item.id === id)!;
  const allowed = (entity: Parameters<typeof getConstructionFields>[0], id: string) =>
    field(entity, id).options!.filter(option => !option.disabled).map(option => option.value);

  it('links Mek Walk MP and engine rating in both directions', () => {
    const entity = design();
    field(entity, 'walkMP').set(5);
    expect(entity.originalWalkMP()).toBe(5);
    expect(entity.mountedEngine().rating).toBe(250);
    expect(field(entity, 'engineRating').kind).toBe('select');
    expect(field(entity, 'engineRating').options).toContain({ value: 250, label: '250 · 5 Walk MP', disabled: false });
    field(entity, 'engineRating').set(300);
    expect(entity.originalWalkMP()).toBe(6);
    expect(entity.mountedEngine().rating).toBe(300);
    expect(validateConstruction(entity).messages.filter(message =>
      ['ENGINE_RATING_MISMATCH', 'MEK_ENGINE_MOVEMENT'].includes(message.code))).toEqual([]);
  });

  it('keeps imported mismatches visible and only offers ratings for whole Walk MP', () => {
    const entity = design();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 210, techBase: 'IS' }));
    expect(field(entity, 'engineRating').invalid).toBeTrue();
    expect(allowed(entity, 'engineRating')).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500]);
    expect(entity.mountedEngine().rating).toBe(210);
    expect(() => field(entity, 'engineRating').set(210)).toThrowError();
    expect(entity.originalWalkMP()).toBe(4);
    field(entity, 'engineRating').set(250);
    expect(field(entity, 'engineRating').invalid).toBeFalse();
    expect(entity.originalWalkMP()).toBe(5);
  });

  it('preserves Walk MP when tonnage changes and updates the available engine ratings', () => {
    const entity = design();
    field(entity, 'tonnage').set(55);
    expect(entity.originalWalkMP()).toBe(4);
    expect(entity.mountedEngine().rating).toBe(220);
    expect(allowed(entity, 'engineRating')).toEqual([55, 110, 165, 220, 275, 330, 385, 440, 495]);
    expect(field(entity, 'walkMP').max).toBe(9);
    field(entity, 'engineRating').set(495);
    expect(entity.originalWalkMP()).toBe(9);
    expect(() => field(entity, 'walkMP').set(10)).toThrowError();
    expect(() => field(entity, 'walkMP').set(4.5)).toThrowError(/whole number/);
    expect(() => field(entity, 'walkMP').set(0)).toThrowError();
    expect(() => field(entity, 'tonnage').set(60)).toThrowError(/540/);
    expect(entity.tonnage()).toBe(55);
    expect(entity.originalWalkMP()).toBe(9);
    expect(entity.mountedEngine().rating).toBe(495);
  });

  it('uses primitive rating increments without rounding Walk MP and updates cockpit transitions', () => {
    const entity = design();
    entity.cockpitType.set('Primitive');
    field(entity, 'tonnage').set(55);
    expect(entity.mountedEngine().rating).toBe(265);
    expect(allowed(entity, 'engineRating')).toEqual([70, 135, 200, 265, 330, 400]);
    field(entity, 'engineRating').set(400);
    expect(entity.originalWalkMP()).toBe(6);
    expect(field(entity, 'walkMP').max).toBe(6);
    expect(validateConstruction(entity).messages.filter(message =>
      ['ENGINE_RATING_MISMATCH', 'MEK_ENGINE_MOVEMENT'].includes(message.code))).toEqual([]);
    field(entity, 'cockpit').set('Standard');
    expect(entity.mountedEngine().rating).toBe(330);
    expect(entity.originalWalkMP()).toBe(6);
  });

  it('limits compact engines and preserves engine configuration and heat sinks', () => {
    const entity = design();
    entity.configureEngine(new MountedEngine({ type: 'Compact', rating: 200, techBase: 'IS', baseChassisHeatSinks: 8 }));
    entity.configureHeatSinks(sink, 10);
    field(entity, 'walkMP').set(5);
    expect(entity.mountedEngine().type()).toBe('Compact');
    expect(entity.mountedEngine().techBase).toBe('IS');
    expect(entity.mountedEngine().getBaseChassisHeatSinks(false)).toBe(8);
    expect(entity.totalHeatSinks()).toBe(10);
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'engine').length).toBe(10);
    field(entity, 'engineRating').set(150);
    expect(entity.originalWalkMP()).toBe(3);
    expect(entity.totalHeatSinks()).toBe(10);
    expect(entity.equipment().filter(mount => mount.allocation.kind === 'engine').length).toBe(6);
    expect(allowed(entity, 'engineRating')).not.toContain(450);
    expect(field(entity, 'walkMP').max).toBe(8);
  });

  it('uses base Walk MP for engine sizing when equipment reduces movement', () => {
    const entity = design();
    addTestEquipmentWithFlags(entity, 'F_MODULAR_ARMOR', { location: 'CT' });
    field(entity, 'walkMP').set(5);
    expect(entity.walkMP()).toBe(4);
    expect(entity.mountedEngine().rating).toBe(250);
    expect(validateConstruction(entity).messages.filter(message =>
      ['ENGINE_RATING_MISMATCH', 'MEK_ENGINE_MOVEMENT'].includes(message.code))).toEqual([]);
  });

  it('filters technology reactively and retains an incompatible installed value without mutation', () => {
    const entity = design();
    entity.gyroType.set('Compact');
    const fields = computed(() => getConstructionFields(entity));
    expect(fields().find(item => item.id === 'gyro')!.invalid).toBeFalse();
    entity.year.set(3000);
    const gyro = fields().find(item => item.id === 'gyro')!;
    expect(gyro.invalid).toBeTrue();
    expect(gyro.options).toContain(jasmine.objectContaining({ value: 'Compact', label: 'Compact (incompatible)', disabled: true }));
    expect(entity.gyroType()).toBe('Compact');
    expect(gyro.options?.some(option => option.value === 'XL')).toBeFalse();
    expect(field(entity, 'gyro', true).options).toContain(jasmine.objectContaining({ value: 'XL', disabled: true }));
    expect(() => field(entity, 'gyro', true).set('XL')).toThrowError(/incompatible/);
  });

  it('uses chassis shape for cockpit choices and preserves primitive-to-modern transitions', () => {
    const entity = design();
    expect(allowed(entity, 'cockpit')).not.toContain('Tripod');
    expect(allowed(entity, 'cockpit')).not.toContain('QuadVee');
    expect(allowed(entity, 'cockpit')).not.toContain('Industrial');
    entity.year.set(2500);
    entity.originalBuildYear.set(2300);
    entity.cockpitType.set('Primitive');
    expect(allowed(entity, 'cockpit')).toContain('Standard');
    field(entity, 'cockpit').set('Standard');
    expect(allowed(entity, 'cockpit')).toContain('Primitive');
    const lam = createConstructionEntity('LAM', registry);
    lam.year.set(3151); lam.rulesLevel.set(4);
    expect(allowed(lam, 'cockpit')).toEqual(['Standard', 'Small']);
  });

  it('uses interface technology for the optional absent gyro in both choices and validation', () => {
    const entity = design();
    expect(allowed(entity, 'gyro')).not.toContain('None');
    entity.cockpitType.set('Interface');
    expect(allowed(entity, 'gyro')).toContain('None');
    field(entity, 'gyro').set('None');
    expect(constructionAdvancedMekMessages(entity).some(message => message.code === 'MEK_SYSTEM_TECH_DATE' && message.message.startsWith('Gyro'))).toBeFalse();
  });

  it('can correct an engine base after changing chassis technology and rejects large compact engines', () => {
    const entity = design();
    entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS', installed: true }));
    entity.techBase.set('Clan');
    expect(field(entity, 'engineTechBase').invalid).toBeTrue();
    expect(allowed(entity, 'engineType')).toContain('XL');
    field(entity, 'engineType').set('XL');
    expect(entity.mountedEngine().techBase).toBe('Clan');
    expect(field(entity, 'engineTechBase').invalid).toBeFalse();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 450, techBase: 'Clan', installed: true }));
    expect(allowed(entity, 'engineType')).not.toContain('Compact');
    expect(allowed(entity, 'engineType')).not.toContain('Light');
  });

  it('uses the OEM interval for heat sinks and keeps the metadata controls unrestricted', () => {
    const entity = design();
    entity.year.set(3050);
    expect(allowed(entity, 'heatSinkType')).not.toContain(sink.id);
    entity.originalBuildYear.set(2750);
    expect(allowed(entity, 'heatSinkType')).toContain(sink.id);
    expect(allowed(entity, 'rulesLevel')).toEqual([1, 2, 3, 4, 5]);
    expect(allowed(entity, 'techBase')).toEqual(['IS', 'Clan']);
    entity.cockpitType.set('Primitive');
    expect(allowed(entity, 'heatSinkType')).not.toContain(sink.id);
  });

  it('filters conventional fighter cockpit and engine families', () => {
    const entity = createConstructionEntity('ConvFighter', registry);
    entity.year.set(3151); entity.rulesLevel.set(4);
    expect(allowed(entity, 'aeroCockpit')).toEqual(['Standard']);
    expect(allowed(entity, 'engineType')).toContain('ICE');
    expect(allowed(entity, 'engineType')).not.toContain('Compact');
    expect(allowed(entity, 'engineType')).not.toContain('Solar');
  });

  it('checks support component histories and engine-rating availability', () => {
    const entity = createConstructionEntity('SupportTank', registry);
    entity.year.set(3000); entity.rulesLevel.set(2);
    expect(allowed(entity, 'structuralTechRating')).not.toContain(5);
    expect(constructionTechnologyEligibility(entity, getSupportComponentTech(5)).available).toBeFalse();
    entity.techBase.set('Clan');
    expect(allowed(entity, 'structuralTechRating')).toContain(5);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'Clan' }));
    expect(allowed(entity, 'engineTechRating')).not.toContain(0);
    expect(allowed(entity, 'engineTechRating')).not.toContain(1);
    expect(allowed(entity, 'engineTechRating')).toContain(2);
    expect(getConstructionFields(entity).some(item => item.id === 'engineTechBase')).toBeFalse();
    field(entity, 'engineTechRating').set(2);
    expect(allowed(entity, 'engineType')).toContain('Fission');
  });

  it('uses aerospace engine technology while still enforcing the selected engine introduction date', () => {
    const entity = createConstructionEntity('Aero', registry);
    entity.rulesLevel.set(2);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 450, techBase: 'IS' }));
    for (const year of [2629, 3000, 3151]) {
      entity.year.set(year);
      expect(field(entity, 'engineType').invalid).withContext(String(year)).toBeFalse();
      expect(constructionTechnologyMessages(entity).filter(message => message.message.startsWith('Engine')))
        .withContext(String(year)).toEqual([]);
    }
    entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 450, techBase: 'IS' }));
    entity.year.set(2500);
    expect(field(entity, 'engineType').invalid).toBeTrue();
    expect(constructionTechnologyMessages(entity).some(message => message.code === 'SYSTEM_TECH_DATE' && message.message.startsWith('Engine'))).toBeTrue();
    entity.year.set(2750);
    expect(field(entity, 'engineType').invalid).toBeFalse();
  });

  it('keeps ultra-light and quad battle armor mutually exclusive without trapping either control', () => {
    const entity = createConstructionEntity('BattleArmor', registry);
    entity.year.set(3151); entity.rulesLevel.set(4);
    const suit = entity as import('../../models/entity/entities').BattleArmorEntity;
    suit.chassisType.set('Quad');
    expect(allowed(suit, 'weightClass')).not.toContain('Ultra Light');
    field(suit, 'chassisType').set('Biped');
    expect(allowed(suit, 'weightClass')).toContain('Ultra Light');
    field(suit, 'weightClass').set('Ultra Light');
    expect(allowed(suit, 'chassisType')).not.toContain('Quad');
  });

  it('keeps infantry support weapons in the secondary selector and marks imported primary support weapons invalid', () => {
    const support = new WeaponEquipment({ id: 'Support rifle', name: 'Support rifle', type: 'weapon',
      flags: ['F_INFANTRY', 'F_INF_SUPPORT'], infantry: { crew: 2 }, tech: { base: 'All', level: 'Standard' } });
    const entity = createConstructionEntity('Infantry', createTestEquipmentRegistry({ [support.id]: support })) as InfantryEntity;
    expect(allowed(entity, 'primaryWeapon')).not.toContain(support.id);
    expect(allowed(entity, 'secondaryWeapon')).toContain(support.id);
    if (!support.isInfantryWeapon()) throw new Error('Fixture must be an infantry weapon.');
    entity.primaryWeapon.set(support);
    expect(field(entity, 'primaryWeapon').invalid).toBeTrue();
    expect(constructionInfantryBaMessages(entity).some(message => message.code === 'INFANTRY_PRIMARY_SUPPORT')).toBeTrue();
  });

  it('shares the zero-secondary limit for microlites, engineers and large beasts, including augmentation adjustments', () => {
    const support = new WeaponEquipment({ id: 'Support rifle', name: 'Support rifle', type: 'weapon',
      flags: ['F_INFANTRY', 'F_INF_SUPPORT'], infantry: { crew: 2 }, tech: { base: 'All', level: 'Standard' } });
    const entity = createConstructionEntity('Infantry', createTestEquipmentRegistry({ [support.id]: support })) as InfantryEntity;
    entity.motiveType.set('VTOL'); entity.isMicrolite.set(true);
    expect(allowed(entity, 'secondaryWeapon')).toEqual(['']);
    if (!support.isInfantryWeapon()) throw new Error('Fixture must be an infantry weapon.');
    entity.secondaryWeapon.set(support); entity.secondaryCount.set(1);
    expect(field(entity, 'secondaryWeapon').invalid).toBeTrue();
    expect(constructionInfantryBaMessages(entity).some(message => message.code === 'INFANTRY_SECONDARY_LIMIT')).toBeTrue();
    expect(() => field(entity, 'secondaryWeapon', true).set(support.id)).toThrowError(/incompatible/);
    entity.motiveType.set('Leg'); entity.specializations.set(new Set(['bridge-engineers']));
    expect(allowed(entity, 'secondaryWeapon')).toEqual(['']);
    entity.specializations.set(new Set()); entity.mount.set(PREDEFINED_INFANTRY_MOUNTS.get('Horse')!);
    expect(allowed(entity, 'secondaryWeapon')).toEqual(['']);
    entity.augmentations.set(['dermal_armor']);
    expect(allowed(entity, 'secondaryWeapon')).toContain(support.id);
    expect(constructionInfantryBaMessages(entity).some(message => message.code === 'INFANTRY_SECONDARY_LIMIT')).toBeFalse();
  });
});
