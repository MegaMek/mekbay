// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { parseEntity } from '../parse-entity';
import { encodeNativeEntity } from '../write-entity';
import { MountedEngine } from '../components';
import { TestAeroSpaceFighterEntity, TestConvFighterEntity, TestFixedWingSupportEntity } from '../testing/test-entities';
import { UnitMetadataBuilder } from '../../../utils/unit-metadata-builder';

describe('BLK aerospace engine rating', () => {
  for (const { tons, thrust, rating } of [
    { tons: 4.999, thrust: 4, rating: 19.996 },
    { tons: 80, thrust: 5, rating: 400 },
    { tons: 90, thrust: 5, rating: 450 },
    { tons: 200, thrust: 4, rating: 500 },
  ]) {
    it(`loads a ${tons}-ton support aircraft's ${rating} rating without truncation or fighter adjustments`, () => {
      const source = new TestFixedWingSupportEntity();
      source.setTonnage(tons);
      source.originalWalkMP.set(thrust);
      source.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 1, techBase: 'IS' }));
      const entity = parseEntity(encodeNativeEntity(source), 'support.blk', source.getEquipmentRegistry()).entity;
      expect(entity.mountedEngine().rating).toBe(rating);
      expect(new UnitMetadataBuilder().build(entity).engineRating).toBe(rating);
      const reloaded = parseEntity(encodeNativeEntity(entity), 'support.blk', source.getEquipmentRegistry()).entity;
      expect(reloaded.mountedEngine().rating).toBe(rating);
    });
  }

  for (const { source, rating } of [
    { source: new TestAeroSpaceFighterEntity(), rating: 150 },
    { source: new TestConvFighterEntity(), rating: 250 },
  ]) {
    it(`retains the ${source.entityType} engine formula`, () => {
      source.setTonnage(50);
      source.originalWalkMP.set(5);
      const entity = parseEntity(encodeNativeEntity(source), 'fighter.blk', source.getEquipmentRegistry()).entity;
      expect(entity.mountedEngine().rating).toBe(rating);
    });
  }
});
