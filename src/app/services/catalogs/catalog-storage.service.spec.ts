// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitProviderId } from '../unit-catalog/unit-catalog.types';
import { ASSET_CATALOG_DATABASE_NAME, CatalogStorage, fluffImageCatalogKey } from './catalog-storage.service';

describe('CatalogStorage', () => {
  const hash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA';
  let storage: CatalogStorage;

  beforeEach(async () => {
    storage = new CatalogStorage();
    await storage.clear();
  });

  function settled<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** The unit-icon storage used this database name up to version 2 and never deleted it. */
  async function createRetiredUnitIconDatabase(): Promise<void> {
    await settled(indexedDB.deleteDatabase(ASSET_CATALOG_DATABASE_NAME));
    const request = indexedDB.open(ASSET_CATALOG_DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('unitIcons');
      request.result.createObjectStore('metadata');
    };
    (await settled(request)).close();
  }

  it('takes over the database name from the retired unit-icon storage', async () => {
    await createRetiredUnitIconDatabase();
    storage = new CatalogStorage();

    await storage.put('equipment', hash, { value: 1 });
    expect(await storage.get('equipment')).toEqual({ value: 1 });
  });

  it('stores repository catalogs by their SHA-1 asset hash', async () => {
    const payload = { assetHash: hash, value: 1 };
    await storage.put('equipment', hash, payload, 'online-assets/static/equipment.json');
    expect(await storage.get('equipment')).toEqual(payload);
    expect(await storage.getAssetsManifest()).toEqual({
      'online-assets/static/equipment.json': hash,
    });
  });

  it('keeps catalogs in independent rows and skips unchanged hashes', async () => {
    const otherHash = 'BBBBBBBBBBBBBBBBBBBBBBBBBBB';
    await storage.putMany([
      { key: 'equipment', hash, payload: { value: 'first' } },
      { key: 'sheets', hash: otherHash, payload: { value: 'sheet index' } },
    ]);
    await storage.putMany([
      { key: 'equipment', hash, payload: { value: 'must not overwrite' } },
    ]);

    expect(await storage.get('equipment')).toEqual({ value: 'first' });
    expect(await storage.get('sheets')).toEqual({ value: 'sheet index' });
  });

  it('stores the validated fluff-image response and ETag', async () => {
    const provider = asUnitProviderId('mm-data');
    const record = {
      key: fluffImageCatalogKey(provider),
      provider,
      baseUrl: 'https://fluff.example.test',
      wireJson: '["Mek/Atlas.png"]',
      etag: 'v1',
    };
    await storage.putFluffImages(record);
    expect(await storage.getFluffImages(provider)).toEqual(record);
  });
});
