// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MM_DATA_UNIT_PROVIDER_ID } from '../unit-catalog/unit-catalog.types';
import { buildFluffImageCatalog } from './presentation-catalog-builders';

describe('presentation catalog builders', () => {
  it('parses paths and normalizes the provider base URL', () => {
    const catalog = buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl: 'https://fluff.example.test/path///',
      wireJson: '["Mek/Atlas.png"]',
    });
    expect(catalog.baseUrl).toBe('https://fluff.example.test/path');
    expect(catalog.paths[0]).toBe('Mek/Atlas.png');
  });

  it('rejects credentialed or non-HTTP asset URLs', () => {
    expect(() => buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl: 'https://user@example.test',
      wireJson: '["Mek/Atlas.png"]',
    })).toThrowError(/uncredentialed HTTP/u);
    expect(() => buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl: 'file:///tmp',
      wireJson: '["Mek/Atlas.png"]',
    })).toThrowError(/uncredentialed HTTP/u);
  });
});
