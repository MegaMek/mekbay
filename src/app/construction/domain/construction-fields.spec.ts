// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed } from '@angular/core';
import { MountedEngine } from '../../models/entity/components';
import { InfantryEntity, MekEntity, VehicleEntity } from '../../models/entity/entities';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { validateConstruction } from './construction-rules';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';
import { constructionTechnologyMessages } from './construction-technology-rules';
import { constructionInfantryBaMessages } from './construction-infantry-ba-rules';
import { PREDEFINED_INFANTRY_MOUNTS } from '../../models/entity/types/infantry';
import { CONSTRUCTION_VALIDATE_EXTINCTION } from './construction-config';

const sink = new MiscEquipment({
  id: 'Historical double sink',
  name: 'Historical double sink',
  type: 'misc',
  flags: ['F_DOUBLE_HEAT_SINK'],
  stats: { tonnage: 1, criticalSlots: 3 },
  tech: {
    base: 'IS',
    level: 'Standard',
    advancement: { is: { common: '2700', extinct: '2800', reintroduced: '3100' } },
  },
});
const registry = createTestEquipmentRegistry({ [sink.id]: sink });

describe('construction system choices', () => {
  const design = () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    entity.year.set(3151);
    entity.rulesLevel.set(4);
    return entity;
  };
  const field = (entity: Parameters<typeof getConstructionFields>[0], id: string, showIncompatible = false) =>
    getConstructionFields(entity, showIncompatible).find((item) => item.id === id)!;
  const allowed = (entity: Parameters<typeof getConstructionFields>[0], id: string) =>
    field(entity, id)
      .options!.filter((option) => !option.disabled)
      .map((option) => option.value);

  it('offers the RISC heat sink override kit only where its experimental technology is legal', () => {
    const entity = design();
    expect(field(entity, 'riscHeatSinkOverride').disabled).toBeFalse();
    field(entity, 'riscHeatSinkOverride').set(true);
    expect(entity.hasRiscHeatSinkOverrideKit()).toBeTrue();
    entity.rulesLevel.set(3);
    expect(field(entity, 'riscHeatSinkOverride')).toEqual(jasmine.objectContaining({ disabled: false, invalid: true }));
    field(entity, 'riscHeatSinkOverride').set(false);
    expect(field(entity, 'riscHeatSinkOverride').disabled).toBeTrue();
    expect(() => field(entity, 'riscHeatSinkOverride').set(true)).toThrowError(/unavailable/);
  });

  it('selects Walk MP and derives the displayed engine rating', () => {
    const entity = design();
    field(entity, 'walkMP').set(5);
    expect(entity.originalWalkMP()).toBe(5);
    expect(entity.mountedEngine().rating).toBe(250);
    expect(field(entity, 'walkMP').kind).toBe('select');
    expect(field(entity, 'walkMP').options).toContain({ value: 5, label: '250 · 5 Walk MP', disabled: false });
    expect(getConstructionFields(entity).some((item) => item.id === 'engineRating')).toBeFalse();
    field(entity, 'walkMP').set(6);
    expect(entity.originalWalkMP()).toBe(6);
    expect(entity.mountedEngine().rating).toBe(300);
    expect(
      validateConstruction(entity).messages.filter((message) =>
        ['ENGINE_RATING_MISMATCH', 'MEK_ENGINE_MOVEMENT'].includes(message.code),
      ),
    ).toEqual([]);
  });

  it('derives choices from movement without mutating an imported rating until selection', () => {
    const entity = design();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 210, techBase: 'IS' }));
    expect(allowed(entity, 'walkMP')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(entity.mountedEngine().rating).toBe(210);
    expect(() => field(entity, 'walkMP').set(4.2)).toThrowError();
    expect(entity.originalWalkMP()).toBe(4);
    field(entity, 'walkMP').set(4);
    expect(entity.mountedEngine().rating).toBe(200);
  });

  it('leaves engine ratings whose engine is out of tonnage out of the selector', () => {
    const entity = design();
    expect(field(entity, 'walkMP').options).toContain({ value: 7, label: '350 · 7 Walk MP', disabled: false });
    expect(field(entity, 'walkMP').options!.some((option) => option.value === 8)).toBeFalse();
    expect(() => field(entity, 'walkMP').set(8)).toThrowError();
    field(entity, 'walkMP').set(7);
    expect(entity.mountedEngine().rating).toBe(350);
    expect(entity.loadoutTonnage()).toBeLessThanOrEqual(entity.tonnage());
  });

  it('preserves Walk MP when tonnage changes and updates the available engine ratings', () => {
    const entity = design();
    field(entity, 'tonnage').set(55);
    expect(entity.originalWalkMP()).toBe(4);
    expect(entity.mountedEngine().rating).toBe(220);
    expect(allowed(entity, 'walkMP')).toEqual([1, 2, 3, 4, 5, 6]);
    field(entity, 'walkMP').set(6);
    expect(entity.originalWalkMP()).toBe(6);
    expect(() => field(entity, 'walkMP').set(8)).toThrowError();
    expect(() => field(entity, 'walkMP').set(4.5)).toThrowError();
    expect(() => field(entity, 'walkMP').set(0)).toThrowError();
    expect(() => field(entity, 'tonnage').set(85)).toThrowError(/510/);
    expect(entity.tonnage()).toBe(55);
    expect(entity.originalWalkMP()).toBe(6);
    expect(entity.mountedEngine().rating).toBe(330);
  });

  it('uses primitive rating increments without rounding Walk MP and updates cockpit transitions', () => {
    const entity = design();
    entity.cockpitType.set('Primitive');
    field(entity, 'tonnage').set(55);
    expect(entity.mountedEngine().rating).toBe(265);
    expect(allowed(entity, 'walkMP')).toEqual([1, 2, 3, 4, 5]);
    field(entity, 'walkMP').set(5);
    expect(entity.originalWalkMP()).toBe(5);
    expect(
      validateConstruction(entity).messages.filter((message) =>
        ['ENGINE_RATING_MISMATCH', 'MEK_ENGINE_MOVEMENT'].includes(message.code),
      ),
    ).toEqual([]);
    field(entity, 'cockpit').set('Standard');
    expect(entity.mountedEngine().rating).toBe(275);
    expect(entity.originalWalkMP()).toBe(5);
  });

  it('limits compact engines and preserves engine configuration and heat sinks', () => {
    const entity = design();
    entity.configureEngine(
      new MountedEngine({ type: 'Compact', rating: 200, techBase: 'IS', baseChassisHeatSinks: 8 }),
    );
    entity.configureHeatSinks(sink, 10);
    field(entity, 'walkMP').set(5);
    expect(entity.mountedEngine().type()).toBe('Compact');
    expect(entity.mountedEngine().techBase).toBe('IS');
    expect(entity.mountedEngine().getBaseChassisHeatSinks(false)).toBe(8);
    expect(entity.totalHeatSinks()).toBe(10);
    expect(entity.equipment().filter((mount) => mount.allocation.kind === 'engine').length).toBe(10);
    field(entity, 'walkMP').set(3);
    expect(entity.originalWalkMP()).toBe(3);
    expect(entity.totalHeatSinks()).toBe(10);
    expect(entity.equipment().filter((mount) => mount.allocation.kind === 'engine').length).toBe(6);
    expect(allowed(entity, 'walkMP')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('uses base Walk MP for engine sizing when equipment reduces movement', () => {
    const entity = design();
    addTestEquipmentWithFlags(entity, 'F_MODULAR_ARMOR', { location: 'CT' });
    field(entity, 'walkMP').set(5);
    expect(entity.walkMP()).toBe(4);
    expect(entity.mountedEngine().rating).toBe(250);
    expect(
      validateConstruction(entity).messages.filter((message) =>
        ['ENGINE_RATING_MISMATCH', 'MEK_ENGINE_MOVEMENT'].includes(message.code),
      ),
    ).toEqual([]);
  });

  it('filters technology reactively and retains an incompatible installed value without mutation', () => {
    const entity = design();
    entity.gyroType.set('Compact');
    const fields = computed(() => getConstructionFields(entity));
    expect(fields().find((item) => item.id === 'gyro')!.invalid).toBeFalse();
    entity.year.set(3000);
    const gyro = fields().find((item) => item.id === 'gyro')!;
    expect(gyro.invalid).toBeTrue();
    expect(gyro.options).toContain(
      jasmine.objectContaining({ value: 'Compact', label: 'Compact (incompatible)', disabled: true }),
    );
    expect(entity.gyroType()).toBe('Compact');
    expect(gyro.options?.some((option) => option.value === 'XL')).toBeFalse();
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
    lam.year.set(3151);
    lam.rulesLevel.set(4);
    expect(allowed(lam, 'cockpit')).toEqual(['Standard', 'Small']);
  });

  it('uses interface technology for the optional absent gyro in both choices and validation', () => {
    const entity = design();
    expect(allowed(entity, 'gyro')).not.toContain('None');
    entity.cockpitType.set('Interface');
    expect(allowed(entity, 'gyro')).toContain('None');
    field(entity, 'gyro').set('None');
    expect(
      constructionAdvancedMekMessages(entity).some(
        (message) => message.code === 'MEK_SYSTEM_TECH_DATE' && message.message.startsWith('Gyro'),
      ),
    ).toBeFalse();
  });

  it('can correct an engine base after changing chassis technology and rejects large compact engines', () => {
    const entity = design();
    entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS', installed: true }));
    entity.techBase.set('Clan');
    expect(getConstructionFields(entity).some((item) => item.id === 'engineTechBase')).toBeFalse();
    expect(allowed(entity, 'engineType')).toContain('XL');
    field(entity, 'engineType').set('XL');
    expect(entity.mountedEngine().techBase).toBe('Clan');
    expect(getConstructionFields(entity).some((item) => item.id === 'engineTechBase')).toBeFalse();
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 450, techBase: 'Clan', installed: true }));
    expect(allowed(entity, 'engineType')).not.toContain('Compact');
    expect(allowed(entity, 'engineType')).not.toContain('Light');
  });

  it('uses the OEM interval for heat sinks and keeps the metadata controls unrestricted', () => {
    const entity = design();
    entity.year.set(3050);
    expect(allowed(entity, 'heatSinkType').includes(sink.id)).toBe(!CONSTRUCTION_VALIDATE_EXTINCTION);
    entity.originalBuildYear.set(2750);
    expect(allowed(entity, 'heatSinkType')).toContain(sink.id);
    expect(allowed(entity, 'rulesLevel')).toEqual([1, 2, 3, 4, 5]);
    expect(allowed(entity, 'techBase')).toEqual(['IS', 'Clan']);
    entity.cockpitType.set('Primitive');
    expect(allowed(entity, 'heatSinkType')).not.toContain(sink.id);
  });

  it('offers an empty default role and only the roles MegaMek allows for ground or aerospace units', () => {
    const mek = design();
    expect(field(mek, 'role').get()).toBe('');
    expect(allowed(mek, 'role')).toEqual([
      '', 'None', 'Ambusher', 'Brawler', 'Juggernaut', 'Missile Boat', 'Scout', 'Skirmisher', 'Sniper', 'Striker',
    ]);
    const fighter = createConstructionEntity('Aero', registry);
    expect(allowed(fighter, 'role')).toEqual([
      '', 'None', 'Attack Fighter', 'Dogfighter', 'Fast Dogfighter', 'Fire Support', 'Interceptor', 'Transport',
    ]);
    mek.role.set('Interceptor');
    expect(field(mek, 'role').invalid).toBeTrue();
    expect(() => field(mek, 'role').set('Interceptor')).toThrowError(/incompatible/);
    field(mek, 'role').set('');
    expect(mek.role()).toBe('');
  });

  it('only offers an independent engine base on mixed-tech designs', () => {
    const entity = design();
    field(entity, 'techBase').set('Clan');
    expect(entity.mountedEngine().techBase).toBe('Clan');
    expect(getConstructionFields(entity).some((item) => item.id === 'engineTechBase')).toBeFalse();
    field(entity, 'mixedTech').set(true);
    field(entity, 'engineTechBase').set('IS');
    field(entity, 'walkMP').set(5);
    field(entity, 'engineType').set('XL');
    expect(entity.mountedEngine().techBase).toBe('IS');
    field(entity, 'mixedTech').set(false);
    expect(entity.mountedEngine().techBase).toBe('Clan');
    expect(entity.mountedEngine().rating).toBe(250);
    expect(getConstructionFields(entity).some((item) => item.id === 'engineTechBase')).toBeFalse();
  });

  it('preserves an independent engine base when a mixed-tech unit changes base', () => {
    const entity = design();
    field(entity, 'mixedTech').set(true);
    field(entity, 'techBase').set('Clan');
    expect(entity.mountedEngine().techBase).toBe('IS');
  });

  it('keeps movement selected when chassis tonnage changes from 50 to 70', () => {
    const entity = design();
    field(entity, 'walkMP').set(4);
    field(entity, 'tonnage').set(70);
    expect(field(entity, 'walkMP').get()).toBe(4);
    expect(entity.mountedEngine().rating).toBe(280);
    expect(field(entity, 'walkMP').options).toContain({ value: 4, label: '280 · 4 Walk MP', disabled: false });
  });

  it('offers five-ton Mek chassis choices and gates superheavies at Advanced', () => {
    const entity = design();
    expect(field(entity, 'tonnage').kind).toBe('select');
    expect(allowed(entity, 'tonnage')).toContain(10);
    expect(allowed(entity, 'tonnage')).toContain(200);
    expect(() => field(entity, 'tonnage').set(30.001)).toThrowError();
    expect(() => field(entity, 'tonnage').set(31)).toThrowError();
    field(entity, 'rulesLevel').set(2);
    expect(allowed(entity, 'tonnage')).toContain(100);
    expect(allowed(entity, 'tonnage')).not.toContain(105);
    expect(() => field(entity, 'tonnage').set(105)).toThrowError();
    field(entity, 'rulesLevel').set(3);
    field(entity, 'walkMP').set(2);
    field(entity, 'tonnage').set(105);
    expect(entity.tonnage()).toBe(105);
    field(entity, 'rulesLevel').set(2);
    expect(field(entity, 'tonnage').invalid).toBeTrue();
  });

  it('uses whole-ton ProtoMek choices and combat-vehicle spinner steps', () => {
    const proto = createConstructionEntity('ProtoMek', registry);
    expect(allowed(proto, 'tonnage')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(() => field(proto, 'tonnage').set(5.5)).toThrowError();
    field(proto, 'tonnage').set(6);
    expect(proto.tonnage()).toBe(6);
    const tank = createConstructionEntity('Tank', registry);
    expect(field(tank, 'tonnage').min).toBe(1);
    expect(field(tank, 'tonnage').step).toBe(1);
    expect(() => field(tank, 'tonnage').set(30.001)).toThrowError();
    field(tank, 'tonnage').set(31);
    expect(tank.tonnage()).toBe(31);
    const support = createConstructionEntity('SupportTank', registry);
    field(support, 'tonnage').set(2.5);
    expect(support.tonnage()).toBe(2.5);
  });

  it('does not let removable loadout mass or an absent engine hide movement choices', () => {
    const entity = design();
    entity.transporters.set([{ id: 'cargo', kind: 'troop-space', omni: false, totalSpace: 50 }]);
    const choices = allowed(entity, 'walkMP');
    expect(choices).toContain(7);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'IS', installed: false }));
    expect(allowed(entity, 'walkMP')).toEqual(choices);
    field(entity, 'walkMP').set(4);
    expect(entity.mountedEngine().installed).toBeTrue();
  });

  it('keeps an oversized current movement visible but rejects excluded movements', () => {
    const entity = design();
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 500, techBase: 'IS' }));
    entity.originalWalkMP.set(10);
    expect(field(entity, 'walkMP').invalid).toBeTrue();
    expect(allowed(entity, 'walkMP')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(() => field(entity, 'walkMP').set(9)).toThrowError();
    expect(entity.mountedEngine().rating).toBe(500);
    field(entity, 'walkMP').set(7);
    expect(entity.mountedEngine().rating).toBe(350);
  });

  it('reserves mandatory chassis mass for a 10-ton XXL engine and XL gyro', () => {
    const entity = design();
    field(entity, 'rulesLevel').set(3);
    field(entity, 'tonnage').set(10);
    field(entity, 'engineType').set('XXL');
    field(entity, 'gyro').set('XL');
    expect(allowed(entity, 'walkMP')).not.toContain(35);
    expect(() => field(entity, 'walkMP').set(35)).toThrowError();
    expect(allowed(entity, 'walkMP').at(-1)).toBe(26);
    field(entity, 'walkMP').set(26);
    expect(entity.mountedEngine().rating).toBe(260);
    expect(entity.loadoutTonnage()).toBe(10);
  });

  it('filters conventional fighter cockpit and engine families', () => {
    const entity = createConstructionEntity('ConvFighter', registry);
    entity.year.set(3151);
    entity.rulesLevel.set(4);
    expect(allowed(entity, 'aeroCockpit')).toEqual(['Standard']);
    expect(allowed(entity, 'engineType')).toContain('ICE');
    expect(allowed(entity, 'engineType')).not.toContain('Compact');
    expect(allowed(entity, 'engineType')).not.toContain('Solar');
  });

  it('offers every support tech rating by letter at any date and limits engine ratings to the engine type', () => {
    const entity = createConstructionEntity('SupportTank', registry);
    // TM p. 122: the Technology Rating Table is a general guide; a 2317 design may be built at rating D or higher.
    entity.year.set(2317);
    entity.rulesLevel.set(2);
    if (entity.isSupportVehicle()) {
      entity.structuralTechRating.set(3);
      entity.engineTechRating.set(3);
    }
    expect(allowed(entity, 'structuralTechRating')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(field(entity, 'structuralTechRating').options!.map((option) => option.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(field(entity, 'structuralTechRating').invalid).toBeFalse();
    expect(constructionTechnologyMessages(entity).filter((message) => message.message.includes('tech rating'))).toEqual([]);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'Clan' }));
    expect(allowed(entity, 'engineTechRating')).not.toContain(0);
    expect(allowed(entity, 'engineTechRating')).not.toContain(1);
    expect(allowed(entity, 'engineTechRating')).toContain(2);
    expect(getConstructionFields(entity).some((item) => item.id === 'engineTechBase')).toBeFalse();
    field(entity, 'engineTechRating').set(2);
    expect(allowed(entity, 'engineType')).toContain('Fission');
  });

  it('offers the three ICE fuels only for an ICE and names factions in the faction list', () => {
    const entity = createConstructionEntity('Tank', registry);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'IS' }));
    expect(getConstructionFields(entity).some((item) => item.id === 'fuelType')).toBeFalse();
    entity.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 100, techBase: 'IS' }));
    // TM p. 127: an ICE burns petrochemicals unless it is built for alcohol or natural gas.
    expect(field(entity, 'fuelType').get()).toBe('PETROCHEMICALS');
    expect(field(entity, 'fuelType').options!.map((option) => option.label)).toEqual([
      'Petrochemicals',
      'Alcohol',
      'Natural gas',
    ]);
    field(entity, 'fuelType').set('NATURAL_GAS');
    expect((entity as VehicleEntity).fuelType()).toBe('NATURAL_GAS');
    const factions = field(entity, 'faction').options!;
    expect(factions[0]).toEqual(jasmine.objectContaining({ value: 'None', label: 'None' }));
    expect(factions.find((option) => option.value === 'DC')!.label).toBe('Draconis Combine');
  });

  it('shows the support vehicle fuel allocation only for engines that carry fuel', () => {
    const entity = createConstructionEntity('SupportTank', registry);
    if (!entity.isSupportVehicle()) throw new Error('Fixture must be a support vehicle.');
    const shown = () => getConstructionFields(entity).some((item) => item.id === 'fuel');
    // TM p. 127: Steam, ICE, Battery and Fuel Cell list a fuel percentage; Solar, Fission and Fusion list NA.
    for (const type of ['Steam', 'ICE', 'Battery', 'Fuel Cell'] as const) {
      entity.mountedEngine.set(new MountedEngine({ type, rating: 100, techBase: 'IS' }));
      expect(shown()).withContext(type).toBeTrue();
    }
    entity.fuel.set(0);
    for (const type of ['Solar', 'Fission', 'Fusion'] as const) {
      entity.mountedEngine.set(new MountedEngine({ type, rating: 100, techBase: 'IS' }));
      expect(shown()).withContext(type).toBeFalse();
    }
    entity.fuel.set(0.5);
    expect(shown()).toBeTrue();
  });

  it('shows a base chassis sponson or pintle weight only on an Omni with that mount, empty meaning automatic', () => {
    const entity = createConstructionEntity('Tank', registry) as VehicleEntity;
    const shown = () => getConstructionFields(entity).some((item) => item.id === 'baseSponsonMass');
    expect(shown()).toBeFalse();
    addTestEquipmentWithFlags(entity, 'F_SPONSON_TURRET', { location: 'Left' });
    // TM p. 137: only an OmniVehicle fixes its turret weights in the base chassis.
    expect(shown()).toBeFalse();
    entity.omni.set(true);
    const sponson = () => field(entity, 'baseSponsonMass');
    expect(sponson().label).toBe('Base sponson tons');
    expect(sponson().placeholder).toBe('Automatic');
    expect(sponson().get()).toBeNull();
    sponson().set(1.5);
    expect(entity.baseChassisSponsonPintleWeight()).toBe(1.5);
    expect(sponson().get()).toBe(1.5);
    sponson().set(null);
    expect(entity.baseChassisSponsonPintleWeight()).toBe(-1);
  });

  it('uses aerospace engine technology while still enforcing the selected engine introduction date', () => {
    const entity = createConstructionEntity('Aero', registry);
    entity.rulesLevel.set(2);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 450, techBase: 'IS' }));
    for (const year of [2629, 3000, 3151]) {
      entity.year.set(year);
      expect(field(entity, 'engineType').invalid).withContext(String(year)).toBeFalse();
      expect(constructionTechnologyMessages(entity).filter((message) => message.message.startsWith('Engine')))
        .withContext(String(year))
        .toEqual([]);
    }
    entity.mountedEngine.set(new MountedEngine({ type: 'XL', rating: 450, techBase: 'IS' }));
    entity.year.set(2500);
    expect(field(entity, 'engineType').invalid).toBeTrue();
    expect(
      constructionTechnologyMessages(entity).some(
        (message) => message.code === 'SYSTEM_TECH_DATE' && message.message.startsWith('Engine'),
      ),
    ).toBeTrue();
    entity.year.set(2750);
    expect(field(entity, 'engineType').invalid).toBeFalse();
  });

  it('keeps ultra-light and quad battle armor mutually exclusive without trapping either control', () => {
    const entity = createConstructionEntity('BattleArmor', registry);
    entity.year.set(3151);
    entity.rulesLevel.set(4);
    const suit = entity as import('../../models/entity/entities').BattleArmorEntity;
    suit.chassisType.set('Quad');
    expect(allowed(suit, 'weightClass')).not.toContain('Ultra Light');
    field(suit, 'chassisType').set('Biped');
    expect(allowed(suit, 'weightClass')).toContain('Ultra Light');
    field(suit, 'weightClass').set('Ultra Light');
    expect(allowed(suit, 'chassisType')).not.toContain('Quad');
  });

  it('keeps infantry support weapons in the secondary selector and marks imported primary support weapons invalid', () => {
    const support = new WeaponEquipment({
      id: 'Support rifle',
      name: 'Support rifle',
      type: 'weapon',
      flags: ['F_INFANTRY', 'F_INF_SUPPORT'],
      infantry: { crew: 2 },
      tech: { base: 'All', level: 'Standard' },
    });
    const entity = createConstructionEntity(
      'Infantry',
      createTestEquipmentRegistry({ [support.id]: support }),
    ) as InfantryEntity;
    expect(allowed(entity, 'primaryWeapon')).not.toContain(support.id);
    expect(allowed(entity, 'secondaryWeapon')).toContain(support.id);
    if (!support.isInfantryWeapon()) throw new Error('Fixture must be an infantry weapon.');
    entity.setPlatoonWeapon('primary', support);
    expect(field(entity, 'primaryWeapon').invalid).toBeTrue();
    expect(
      constructionInfantryBaMessages(entity).some((message) => message.code === 'INFANTRY_PRIMARY_SUPPORT'),
    ).toBeTrue();
  });

  it('shares the zero-secondary limit for microlites, engineers and large beasts, including augmentation adjustments', () => {
    const support = new WeaponEquipment({
      id: 'Support rifle',
      name: 'Support rifle',
      type: 'weapon',
      flags: ['F_INFANTRY', 'F_INF_SUPPORT'],
      infantry: { crew: 2 },
      tech: { base: 'All', level: 'Standard' },
    });
    const entity = createConstructionEntity(
      'Infantry',
      createTestEquipmentRegistry({ [support.id]: support }),
    ) as InfantryEntity;
    entity.motiveType.set('VTOL');
    entity.isMicrolite.set(true);
    expect(allowed(entity, 'secondaryWeapon')).toEqual(['']);
    if (!support.isInfantryWeapon()) throw new Error('Fixture must be an infantry weapon.');
    entity.setPlatoonWeapon('secondary', support);
    entity.secondaryCount.set(1);
    expect(field(entity, 'secondaryWeapon').invalid).toBeTrue();
    expect(
      constructionInfantryBaMessages(entity).some((message) => message.code === 'INFANTRY_SECONDARY_LIMIT'),
    ).toBeTrue();
    expect(() => field(entity, 'secondaryWeapon', true).set(support.id)).toThrowError(/incompatible/);
    entity.motiveType.set('Leg');
    entity.specializations.set(new Set(['bridge-engineers']));
    expect(allowed(entity, 'secondaryWeapon')).toEqual(['']);
    entity.specializations.set(new Set());
    entity.mount.set(PREDEFINED_INFANTRY_MOUNTS.get('Horse')!);
    expect(allowed(entity, 'secondaryWeapon')).toEqual(['']);
    entity.augmentations.set(['dermal_armor']);
    expect(allowed(entity, 'secondaryWeapon')).toContain(support.id);
    expect(
      constructionInfantryBaMessages(entity).some((message) => message.code === 'INFANTRY_SECONDARY_LIMIT'),
    ).toBeFalse();
  });
});
