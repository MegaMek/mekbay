// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import { TestBipedMekEntity as BipedMekEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { ArmorEquipment } from '../models/equipment.model';
import {
  MM_DATA_UNIT_PROVIDER_ID,
  asSourceHash,
  asUnitUuid,
  type CatalogEntryKey,
} from '../services/unit-catalog/unit-catalog.types';
import { UnitSummaryBuilder } from './unit-summary-builder';

describe('UnitSummaryBuilder', () => {
  const uuid = asUnitUuid('019f583e-a182-7f8d-a210-1cb31c1114cb');
  const sourceHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const entryKey: CatalogEntryKey = {
    origin: 'megamek',
    design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid },
    sourceRevision: sourceHash,
  };

  function mek() {
    const entity = new BipedMekEntity();
    entity.uuid.set(uuid);
    return entity;
  }

  function staticEntity() {
    const entity = new StaticEmplacementEntity('GunEmplacement', createTestEquipmentRegistry());
    entity.uuid.set(uuid);
    entity.chassis.set('Fortress Turret');
    entity.model.set('Heavy');
    entity.setTonnage(35);
    entity.equipmentLocations.set(['Guns']);
    entity.constructionFactor.set(20);
    return entity;
  }

  it('builds a gameplay-ready Mek summary from the canonical entity', () => {
    const summary = new UnitSummaryBuilder().build(mek(), {
      entryKey,
      format: 'mtf',
    });
    expect(summary.uuid).toBe(uuid);
    expect(summary.entityType).toBe('Mek');
  });

  it('persists optional per-location material layouts', () => {
    const entity = mek();
    entity.setArmorEquipmentAt('LA', new ArmorEquipment({
      id: 'Impact-Resistant Armor',
      name: 'Impact-Resistant',
      type: 'armor',
      armor: { type: 'IMPACT_RESISTANT' },
    }), 'Clan');

    const summary = new UnitSummaryBuilder().build(entity, {
      entryKey,
      format: 'mtf',
    });

    expect(summary.patchworkLayout?.['LA']).toEqual({ type: 25, clan: true });
    expect(summary.hybridLayout).toBeUndefined();
  });

  it('keeps a native Mek runtime-ready while exposing its load errors', () => {
    const entity = mek();
    entity.setLoadIssues([{
      code: 'EQUIPMENT_NOT_FOUND',
      severity: 'error',
      field: 'RA',
      message: 'Equipment not found: "Missing Test Equipment"',
    }]);

    const summary = new UnitSummaryBuilder().build(entity, {
      entryKey,
      format: 'mtf',
    });

    expect(summary.loadIssues).toEqual(entity.loadIssues());
  });

  it('rejects identity and native-format mismatches', () => {
    const builder = new UnitSummaryBuilder();
    expect(() => builder.build(staticEntity(), {
      entryKey: { ...entryKey, design: { ...entryKey.design, uuid: asUnitUuid('019f583e-a185-783a-a706-48217ac1f149') } },
      format: 'blk',
    })).toThrowError(/does not match catalog UUID/u);
    expect(() => builder.build(staticEntity(), {
      entryKey,
      format: 'mtf',
    })).toThrowError(/requires native BLK/u);
    expect(() => builder.build(staticEntity(), {
      entryKey,
    })).toThrowError(/MegaMek summary entries require/u);
  });

  it('summarizes static families as native entity runtimes without persisting source fluff', () => {
    const entity = staticEntity();
    entity.fluff.set({ overview: 'Catalog prose remains available.' });

    const summary = new UnitSummaryBuilder().build(entity, {
      entryKey,
      format: 'blk',
    });
    expect(summary.type).toBe('Gun Emplacement');
    expect(summary.subtype).toBe('Gun Emplacement');
    expect(summary.entityType).toBe('GunEmplacement');
    expect(summary.weightClass).toBe('Medium');
    expect(summary.bv).toBe(0);
    expect(summary.cost).toBe(0);
    expect(summary.as.TP).toBe('XX');
    expect(entity.fluff().overview).toBe('Catalog prose remains available.');
    expect(Object.prototype.hasOwnProperty.call(summary, 'fluff')).toBeFalse();
  });
});
