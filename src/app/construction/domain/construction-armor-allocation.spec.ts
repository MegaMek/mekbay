// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { AeroEntity, BattleArmorEntity, MekEntity, ProtoMekEntity, VehicleEntity } from '../../models/entity/entities';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity, getConstructionMass, getConstructionMassCapacity } from './construction-factory';
import { fillConstructionArmor, maximizeConstructionArmor } from './construction-armor-allocation';
import { WeaponEquipment } from '../../models/equipment.model';

describe('native maximum armor allocation', () => {
  const registry = createTestEquipmentRegistry({});
  it('fills the available tonnage without removing existing armor or leaving room for another point', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    const weight = new WeaponEquipment({ id: 'ballast', name: 'Ballast', type: 'weapon', stats: { tonnage: 29, criticalSlots: 1 } });
    entity.addEquipment({ equipmentId: weight.id, equipment: weight, rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false, allocation: { kind: 'location', location: 'RT' } });
    entity.setArmorValue('CT', 'rear', 8);
    const original = new Map(entity.armorValues());
    fillConstructionArmor(entity);
    expect(getConstructionMass(entity)).toBeLessThanOrEqual(getConstructionMassCapacity(entity));
    expect(entity.totalArmorPoints()).toBeGreaterThan(8);
    expect(entity.totalArmorPoints()).toBeLessThan(entity.maximumArmorPoints());
    for (const [location, armor] of original) {
      expect(entity.getArmorValue(location)).toBeGreaterThanOrEqual(armor.front);
      expect(entity.getArmorValue(location, 'rear')).toBeGreaterThanOrEqual(armor.rear);
    }
    const filled = new Map(entity.armorValues());
    for (const [location, armor] of filled) {
      if (armor.front + armor.rear >= (entity.maxArmorValues().get(location) ?? 0)) continue;
      entity.armorValues.set(new Map(filled).set(location, { ...armor, front: armor.front + 1 }));
      expect(getConstructionMass(entity)).toBeGreaterThan(getConstructionMassCapacity(entity));
    }
  });

  it('leaves an overweight design unchanged', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    const weight = new WeaponEquipment({ id: 'ballast', name: 'Ballast', type: 'weapon', stats: { tonnage: 100, criticalSlots: 1 } });
    entity.addEquipment({ equipmentId: weight.id, equipment: weight, rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false, allocation: { kind: 'location', location: 'RT' } });
    const armor = entity.armorValues();
    expect(() => fillConstructionArmor(entity)).toThrowError(/excess weight/);
    expect(entity.armorValues()).toBe(armor);
  });

  it('respects the vehicle global armor cap when preserving a strongly uneven allocation', () => {
    const entity = createConstructionEntity('Tank', registry);
    entity.setArmorValue('Front', 'front', 180);
    fillConstructionArmor(entity);
    expect(entity.getArmorValue('Front')).toBe(180);
    expect(entity.totalArmorPoints()).toBe(entity.maximumArmorPoints());
    expect(getConstructionMass(entity)).toBeLessThanOrEqual(getConstructionMassCapacity(entity));
  });
  for (const kind of CONSTRUCTION_UNIT_TYPES) {
    it(`reaches the native total budget for ${kind.label}`, () => {
      const entity = createConstructionEntity(kind.id, registry);
      if (!(entity instanceof MekEntity || entity instanceof ProtoMekEntity || entity instanceof VehicleEntity || entity instanceof AeroEntity || entity instanceof BattleArmorEntity)) return;
      maximizeConstructionArmor(entity);
      expect(entity.totalArmorPoints()).toBe(entity.maximumArmorPoints());
      for (const [location, armor] of entity.armorValues()) {
        expect(armor.front + armor.rear).toBeLessThanOrEqual(entity.maxArmorValues().get(location) ?? 0);
      }
    });
  }

  it('maximizes every Mek location including a quarter of torso armor on the rear', () => {
    const entity = createConstructionEntity('Biped', registry);
    maximizeConstructionArmor(entity);
    expect(entity.getArmorValue('HD')).toBe(9);
    expect(entity.getArmorValue('CT')).toBe(24);
    expect(entity.getArmorValue('CT', 'rear')).toBe(8);
    expect(entity.getArmorValue('RA')).toBe(16);
  });

  it('does not limit vehicle armor to twice its internal structure', () => {
    const entity = createConstructionEntity('Tank', registry);
    maximizeConstructionArmor(entity);
    expect(entity.totalArmorPoints()).toBe(215);
    expect(entity.getArmorValue('Front')).toBeGreaterThan(10);
    expect(entity.getArmorValue('Left')).toBe(entity.getArmorValue('Right'));
    expect(entity.getArmorValue('Rear')).toBeGreaterThan(0);
  });

  it('fills the VTOL rotor to two points and distributes the remaining global budget', () => {
    const entity = createConstructionEntity('VTOL', registry);
    maximizeConstructionArmor(entity);
    expect(entity.getArmorValue('Rotor')).toBe(2);
    expect(entity.totalArmorPoints()).toBe(215);
  });

  it('uses the native 30/25/25/20 fighter allocation without an invented per-facing cap', () => {
    const entity = createConstructionEntity('Aero', registry);
    maximizeConstructionArmor(entity);
    expect(entity.getArmorValue('Nose')).toBe(120);
    expect(entity.getArmorValue('Left Wing')).toBe(100);
    expect(entity.getArmorValue('Right Wing')).toBe(100);
    expect(entity.getArmorValue('Aft')).toBe(80);
  });

  it('uses the ProtoMek head, arm and main-gun limits at every legal tonnage', () => {
    const entity = createConstructionEntity('ProtoMek', registry) as ProtoMekEntity;
    for (const quad of [false, true]) for (const mainGun of [false, true]) for (let tons = 2; tons <= 15; tons++) {
      entity.setTonnage(tons); entity.isQuad.set(quad); entity.hasMainGun.set(mainGun);
      maximizeConstructionArmor(entity);
      expect(entity.totalArmorPoints()).withContext(`${quad ? 'quad' : 'biped'} ${tons}t mainGun=${mainGun}`).toBe(entity.maximumArmorPoints());
      expect(entity.getArmorValue('Head')).toBe(2 + Math.floor(tons / 2));
      if (mainGun) expect(entity.getArmorValue('Main Gun')).toBe(tons > 9 ? 6 : 3);
    }
  });
});
