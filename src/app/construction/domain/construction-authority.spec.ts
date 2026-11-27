// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { BattleArmorEntity, MekEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { parseEntity } from '../../models/entity/parse-entity';
import { encodeNativeEntity, nativeEntityFormat } from '../../models/entity/write-entity';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity, getConstructionMassCapacity } from './construction-factory';
import { battleArmorSuitMassCapacity } from './construction-family-rules';
import { maximizeConstructionArmor } from './construction-armor-allocation';
import { constructionSlotCapacity, getConstructionLocations, validateConstruction } from './construction-rules';

describe('construction uses native entity authorities', () => {
  const registry = createTestEquipmentRegistry();

  for (const { id } of CONSTRUCTION_UNIT_TYPES) {
    it(`round trips ${id} through the format used by editor snapshots and saves`, () => {
      const entity = createConstructionEntity(id, registry);
      const format = nativeEntityFormat(entity);
      const parsed = parseEntity(encodeNativeEntity(entity), `design.${format}`, registry).entity;
      expect(parsed.entityType).toBe(entity.entityType);
      expect(parsed.uuid()).toBe(entity.uuid());
      expect(parsed.chassis()).toBe(entity.chassis());
      if (entity instanceof MekEntity) expect((parsed as MekEntity).chassisConfig).toBe(entity.chassisConfig);
    });
  }

  it('keeps suit limits, squad totals, controls and validation consistent as class and squad size change', () => {
    const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
    for (const [weightClass, perSuit, tons] of [['Ultra Light', 2, 0.4], ['Light', 6, 0.75], ['Medium', 10, 1], ['Heavy', 14, 1.5], ['Assault', 18, 2]] as const) {
      entity.declaredWeightClass.set(weightClass);
      for (const troopers of [1, 4, 6]) {
        entity.trooperCount.set(troopers);
        maximizeConstructionArmor(entity);
        expect(entity.getArmorValue('Squad')).toBe(perSuit);
        expect(entity.maximumArmorPoints()).toBe(perSuit * troopers);
        expect(entity.totalArmorPoints()).toBe(perSuit * troopers);
        expect(battleArmorSuitMassCapacity(entity)).toBe(tons);
        expect(getConstructionMassCapacity(entity)).toBe(tons * troopers);
        expect(getConstructionLocations(entity).every(location => location.maxArmor === perSuit)).toBeTrue();
        expect(validateConstruction(entity).messages.filter(message => ['BA_ARMOR_MAXIMUM', 'ARMOR_TOTAL_EXCEEDED'].includes(message.code))).toEqual([]);
        entity.setArmorValue('Squad', 'front', perSuit + 1);
        const messages = validateConstruction(entity).messages;
        expect(messages.some(message => message.code === 'BA_ARMOR_MAXIMUM')).toBeTrue();
        expect(messages.find(message => message.code === 'ARMOR_TOTAL_EXCEEDED')?.message)
          .toBe(`Total armor ${(perSuit + 1) * troopers} exceeds ${perSuit * troopers} points.`);
      }
    }
  });

  it('retains native battle-armor errors outside the specialized squad-limit diagnostic', () => {
    const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
    entity.setArmorValue('Squad', 'rear', 1);
    expect(entity.validationResult().messages.some(message => message.code === 'ARMOR_REAR_INVALID')).toBeTrue();
    expect(validateConstruction(entity).messages.some(message => message.code === 'ARMOR_REAR_INVALID')).toBeTrue();
  });

  for (const kind of ['Biped', 'Quad', 'Tripod', 'LAM', 'QuadVee'] as const) {
    it(`uses physical ${kind} slot limits without exposing padded native rows`, () => {
      const entity = createConstructionEntity(kind, registry) as MekEntity;
      expect(constructionSlotCapacity(entity, 'HD')).toBe(6);
      expect(constructionSlotCapacity(entity, 'CT')).toBe(12);
      for (const location of getConstructionLocations(entity)) {
        const expected = location.id === 'HD' || entity.locationIsLeg(location.id) ? 6 : 12;
        expect(location.slotCapacity).withContext(location.id).toBe(expected);
        expect(location.slots.length).withContext(location.id).toBe(expected);
      }
      expect(constructionSlotCapacity(entity, 'Body')).toBe(0);
      expect(constructionSlotCapacity(entity, kind === 'Quad' || kind === 'QuadVee' ? 'LA' : 'FLL')).toBe(0);
    });
  }
});
