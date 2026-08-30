// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UnitSummary } from '../../models/unit-summary.model';
import {
  MM_DATA_UNIT_PROVIDER_ID,
  asUnitProviderId,
  asUnitUuid,
} from '../unit-catalog/unit-catalog.types';
import { buildFluffImageCatalog } from './presentation-catalog-builders';
import { FluffImageCatalogService } from './fluff-image-catalog.service';
import { UnitFluffImageService } from './unit-fluff-image.service';

describe('UnitFluffImageService', () => {
  const uuid = asUnitUuid('019f583e-a182-7f8d-a210-1cb31c1114cb');
  let catalogs: FluffImageCatalogService;
  let service: UnitFluffImageService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    catalogs = TestBed.inject(FluffImageCatalogService);
    service = TestBed.inject(UnitFluffImageService);
  });

  it('uses the provider catalog for units and ignores a stale persisted img field', () => {
    catalogs.publish(buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl: 'https://db.mekbay.com',
      wireJson: '["Mek/Atlas.png"]',
    }));
    const unit = {
      uuid,
      chassis: 'Atlas',
      model: '',
      type: 'Mek',
      subtype: 'BattleMek',
      weightClass: 'Assault',
      fluff: { img: 'Mek/Wrong.png' },
    } as unknown as UnitSummary;

    expect(service.resolveUrl(unit)).toBe('https://db.mekbay.com/images/fluff/Mek/Atlas.png');
  });

  it('does not read inline fluff or server-host fields from a summary', () => {
    const unit = {
      uuid,
      chassis: 'Custom',
      model: '',
      type: 'Mek',
      subtype: 'BattleMek',
      weightClass: 'Medium',
      fluff: { img: 'Mek/Custom Unit.png' },
    } as unknown as UnitSummary;

    expect(service.resolveUrl(unit)).toBeNull();
  });

  it('does not borrow an image for another provider', () => {
    catalogs.publish(buildFluffImageCatalog({
      provider: MM_DATA_UNIT_PROVIDER_ID,
      baseUrl: 'https://db.mekbay.com',
      wireJson: '["Mek/Atlas.png"]',
    }));
    const unit = {
      uuid,
      provider: asUnitProviderId('custom'),
      chassis: 'Atlas',
      baseChassis: 'Atlas',
      model: '',
      type: 'Mek',
      subtype: 'BattleMek',
      entityType: 'Mek',
      weightClass: 'Assault',
    } as unknown as UnitSummary;

    expect(service.resolveUrl(unit)).toBeNull();
  });
});
