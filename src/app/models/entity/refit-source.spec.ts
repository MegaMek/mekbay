// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { createConstructionEntity } from '../../construction/domain';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { createTestEquipmentRegistry } from './testing/test-equipment-registry';
import { parseEntity } from './parse-entity';
import { encodeNativeEntity } from './write-entity';

describe('Native refit source', () => {
  const sourceUuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
  for (const type of ['Biped', 'Tank'] as const) {
    it(`round-trips an optional refitFromUUID and removes it when unlinked (${type})`, () => {
      const registry = createTestEquipmentRegistry();
      const entity = createConstructionEntity(type, registry);
      const format = type === 'Biped' ? 'mtf' : 'blk';
      const read = (source: string) => parseEntity(source, `refit.${format}`, registry).entity;
      expect(read(encodeNativeEntity(entity)).refitFromUUID()).toBeUndefined();
      entity.refitFromUUID.set(sourceUuid);
      const source = encodeNativeEntity(entity);
      expect(source).toContain(
        format === 'mtf' ? `refitfromuuid:${sourceUuid}` : `<refitFromUUID>\n${sourceUuid}\n</refitFromUUID>`,
      );
      const loaded = read(source);
      expect(loaded.refitFromUUID()).toBe(sourceUuid);
      expect(read(encodeNativeEntity(loaded)).refitFromUUID()).toBe(sourceUuid);
      loaded.refitFromUUID.set(undefined);
      const unlinked = encodeNativeEntity(loaded);
      expect(unlinked).not.toContain('refitFromUUID');
      expect(read(unlinked).refitFromUUID()).toBeUndefined();
    });
  }
});
