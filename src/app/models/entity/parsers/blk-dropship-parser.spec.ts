// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildEquipmentRegistry } from '../../../services/catalogs/equipment-catalog-builder';
import type { EquipmentRegistry } from '../../equipment-lookup';
import { DropShipEntity } from '../entities/aero/dropship-entity';
import { TestDropShipEntity } from '../testing/test-entities';
import { parseEntity } from '../parse-entity';
import { encodeNativeEntity } from '../write-entity';

describe('DropShip weapon bay enhancements', () => {
  let catalog: EquipmentRegistry;
  beforeAll(async () => {
    catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  it('writes each enhancement right after its weapon, which it links to again on reading', () => {
    const bay = '<Nose Equipment>\n(B) LRM 15\nISArtemisIV\nLRM 20\n</Nose Equipment>\n';
    const artemisWeapon = (source: string) => {
      const entity = parseEntity(source, 'bay.blk', catalog).entity;
      const artemis = entity.equipment().find(mount => mount.equipment?.id === 'ISArtemisIV')!;
      return entity.getLinkedMount(artemis)?.equipment?.id;
    };
    const source = encodeNativeEntity(new TestDropShipEntity(catalog)) + bay;
    expect(artemisWeapon(source)).toBe('LRM 15');

    const written = encodeNativeEntity(parseEntity(source, 'bay.blk', catalog).entity);
    expect(written).toContain('(B) LRM 15\nISArtemisIV\nLRM 20');
    expect(artemisWeapon(written)).toBe('LRM 15');
  });
});

describe('DropShip native collar round trip', () => {
  for (const collar of ['Unspecified', 'Standard', 'Prototype', 'No Boom'] as const) {
    it(`preserves ${collar} without introducing a second boom marker`, () => {
      const entity = new TestDropShipEntity();
      entity.setTonnage(6000);
      entity.collarType.set(collar);
      const first = encodeNativeEntity(entity);
      const parsed = parseEntity(first, 'dropship.blk', entity.getEquipmentRegistry()).entity as DropShipEntity;
      const second = encodeNativeEntity(parsed);

      expect(first).not.toContain('<kf_boom>');
      expect(parsed.collarType()).toBe(collar);
      expect(parsed.kfBoomAttached()).toBe(collar !== 'No Boom');
      expect(second).toBe(first);
    });
  }

  it('retains an absent boom from the legacy marker through the canonical collar field', () => {
    const entity = new TestDropShipEntity();
    entity.setTonnage(6000);
    const legacy = `${encodeNativeEntity(entity)}\n<kf_boom>\n0\n</kf_boom>\n`;
    const parsed = parseEntity(legacy, 'legacy.blk', entity.getEquipmentRegistry()).entity as DropShipEntity;
    const written = encodeNativeEntity(parsed);
    expect(parsed.kfBoomAttached()).toBeFalse();
    expect(written).toContain('<collartype>\n2\n</collartype>');
    expect(written).not.toContain('<kf_boom>');
    expect((parseEntity(written, 'legacy.blk', entity.getEquipmentRegistry()).entity as DropShipEntity)
      .kfBoomAttached()).toBeFalse();
  });
});
