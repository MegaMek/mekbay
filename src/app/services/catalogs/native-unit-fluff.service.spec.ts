// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import type { UnitSummary } from '../../models/unit-summary.model';
import { UNIT_SUMMARY_VERSION } from '../../models/unit-summary.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import {
  MM_DATA_UNIT_PROVIDER_ID,
  asSourceHash,
  asUnitProviderId,
  asUnitUuid,
  makeUnitFileName,
  type NativeUnitFormat,
  type StoredCoreContent,
} from '../unit-catalog/unit-catalog.types';
import { UnitsCatalogService } from './units-catalog.service';
import { NativeUnitFluffLoadError, NativeUnitFluffService } from './native-unit-fluff.service';

describe('NativeUnitFluffService', () => {
  const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
  const hash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
  let catalog: jasmine.SpyObj<Pick<UnitsCatalogService, 'readNativeUnitSource'>>;
  let service: NativeUnitFluffService;

  beforeEach(() => {
    catalog = jasmine.createSpyObj('UnitsCatalogService', ['readNativeUnitSource']);
    TestBed.configureTestingModule({
      providers: [
        NativeUnitFluffService,
        { provide: UnitsCatalogService, useValue: catalog },
      ],
    });
    service = TestBed.inject(NativeUnitFluffService);
  });

  it('loads and freezes MTF fluff on demand', async () => {
    const unit = nativeUnit('mtf');
    catalog.readNativeUnitSource.and.resolveTo(stored(
      'mtf',
      ['Overview: Native overview', 'SystemManufacturer: ENGINE:Vlar'].join('\n'),
    ));

    const fluff = await service.load(unit);

    expect(catalog.readNativeUnitSource).toHaveBeenCalledOnceWith(MM_DATA_UNIT_PROVIDER_ID, uuid);
    expect(fluff).toEqual({
      overview: 'Native overview',
      systems: [{ label: 'Engine', manufacturer: 'Vlar' }],
    });
    expect(Object.isFrozen(fluff)).toBeTrue();
    expect(Object.isFrozen(fluff?.systems)).toBeTrue();
  });

  it('loads multiline BLK fluff', async () => {
    catalog.readNativeUnitSource.and.resolveTo(stored('blk', [
      '<overview>', 'Line one', 'Line two', '</overview>',
      '<deployment>', 'Front line', '</deployment>',
    ].join('\n')));

    await expectAsync(service.load(nativeUnit('blk'))).toBeResolvedTo({
      overview: 'Line one\nLine two',
      deployment: 'Front line',
    });
  });

  it('does not cache fluff or native bytes between requests', async () => {
    const unit = nativeUnit('mtf');
    catalog.readNativeUnitSource.and.resolveTo(stored('mtf', 'Overview: Fresh each time'));

    const first = await service.load(unit);
    const second = await service.load(unit);

    expect(catalog.readNativeUnitSource).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('fails closed for a provider without an authoritative native source', async () => {
    const custom = {
      ...nativeUnit('mtf'),
      provider: asUnitProviderId('custom'),
      origin: 'user',
    } as UnitSummary;

    await expectAsync(service.load(custom)).toBeRejectedWithError(NativeUnitFluffLoadError);
    expect(catalog.readNativeUnitSource).not.toHaveBeenCalled();
  });

  it('rejects source bytes that do not match the selected summary', async () => {
    catalog.readNativeUnitSource.and.resolveTo({
      ...stored('mtf', 'Overview: wrong generation'),
      hash: asSourceHash('BBBBBBBBBBBBBBBBBBBBBBBBBBA'),
    });

    await expectAsync(service.load(nativeUnit('mtf'))).toBeRejectedWithError(
      NativeUnitFluffLoadError,
      'The native source does not match the selected unit',
    );
  });

  function nativeUnit(format: NativeUnitFormat): UnitSummary {
    const empty = createEmptyUnit({ uuid });
    return {
      ...empty,
      uuid,
      provider: MM_DATA_UNIT_PROVIDER_ID,
      origin: 'megamek',
      hash,
      summaryVersion: UNIT_SUMMARY_VERSION,
      entityType: format === 'mtf' ? 'Mek' : 'Tank',
    } as unknown as UnitSummary;
  }

  function stored(format: NativeUnitFormat, text: string): StoredCoreContent {
    return Object.freeze({
      file: makeUnitFileName(uuid, format),
      hash,
      format,
      bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
    });
  }
});
