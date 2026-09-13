// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { parseEntity } from '../../models/entity/parse-entity';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { DropShipEntity } from '../../models/entity/entities/aero/dropship-entity';

describe('construction native metadata', () => {
  const registry = createTestEquipmentRegistry();
  for (const kind of ['Biped', 'Tank', 'Aero', 'BattleArmor', 'Infantry', 'DropShip', 'JumpShip', 'BuildingEntity'] as const) {
    it(`normalizes absent MUL IDs and preserves positive IDs for ${kind}`, () => {
      const entity = createConstructionEntity(kind, registry);
      const field = getConstructionFields(entity).find(field => field.id === 'mulId')!;
      for (const value of [null, '', 0, -1, -20, 1.5, 321]) {
        field.set(value);
        expect(entity.mulId()).toBe(value === 321 ? 321 : null);
        const native = encodeNativeEntity(entity);
        expect(native.includes('mul id:')).toBe(value === 321);
        expect(parseEntity(native, kind === 'Biped' ? 'id.mtf' : 'id.blk', registry).entity.mulId()).toBe(entity.mulId());
      }
      field.set(321);
      const native = encodeNativeEntity(entity);
      for (const invalid of ['-1', '-42', '0', '', '1.5']) {
        const input = kind === 'Biped' ? native.replace('mul id:321', 'mul id:' + invalid) : native.replace('<mul id:>\n321', '<mul id:>\n' + invalid);
        expect(parseEntity(input, kind === 'Biped' ? 'id.mtf' : 'id.blk', registry).entity.mulId()).withContext(invalid).toBeNull();
      }
    });
  }

  it('keeps the compatibility K-F boom marker synchronized with the native collar', () => {
    const entity = createConstructionEntity('DropShip', registry) as DropShipEntity;
    for (const collar of ['Standard', 'Prototype', 'No Boom'] as const) {
      entity.collarType.set(collar);
      const native = encodeNativeEntity(entity);
      expect(native).toContain('<kf_boom>\n' + (collar === 'No Boom' ? '0' : '1') + '\n</kf_boom>');
      const loaded = parseEntity(native, 'boom.blk', registry).entity as DropShipEntity;
      expect(loaded.collarType()).toBe(collar);
      expect(loaded.kfBoomAttached()).toBe(collar !== 'No Boom');
    }
    const markerOnly = encodeNativeEntity(entity).replace(/<collartype>[\s\S]*?<\/collartype>\n/, '');
    expect((parseEntity(markerOnly, 'boom.blk', registry).entity as DropShipEntity).collarType()).toBe('No Boom');
  });
});
