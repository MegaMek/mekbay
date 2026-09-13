// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DropShipEntity } from '../entities/aero/dropship-entity';
import { TestDropShipEntity } from '../testing/test-entities';
import { parseEntity } from '../parse-entity';
import { encodeNativeEntity } from '../write-entity';

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
