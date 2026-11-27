// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asSourceHash, asUnitUuid, MM_DATA_UNIT_PROVIDER_ID } from '../unit-catalog/unit-catalog.types';
import { buildFluffImageCatalog } from './presentation-catalog-builders';
import { FluffImageCatalogService } from './fluff-image-catalog.service';

describe('presentation catalog services', () => {
  const uuid = asUnitUuid('019f583e-c1e4-7d03-a9cd-ff4cf5046746');
  const entryKey = {
    origin: 'megamek' as const,
    design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid },
    sourceRevision: asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  };

  it('resolves fluff images from the current provider catalog', () => {
    const service = new FluffImageCatalogService();
    service.publish(buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl: 'https://fluff.example.test',
      wireJson: '["Mek/Atlas.png"]',
    }));
    const result = service.resolveUnitImage(entryKey.design, {
      entityType: 'Mek', baseChassis: 'Atlas', model: '',
    });
    expect(result.status).toBe('matched');
    if (result.status === 'matched') expect(result.asset.path).toBe('Mek/Atlas.png');
  });
});
