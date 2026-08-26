// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable } from '@angular/core';
import type { UnitProviderId } from '../unit-catalog/unit-catalog.types';
import type { RepositoryAssetsManifest } from './repository-asset-manifest.service';

export interface StoredFluffImageCatalog {
  readonly key: string;
  readonly provider: UnitProviderId;
  readonly baseUrl: string;
  readonly wireJson: string;
  readonly etag: string;
}

export interface StoredAssetCatalog<T = unknown> {
  readonly key: string;
  readonly hash: string;
  readonly payload: T;
}

export type AssetCatalogWrite<T = unknown> = StoredAssetCatalog<T>;

interface StoredAssetsManifest {
  readonly key: typeof ASSETS_MANIFEST_KEY;
  readonly assets: RepositoryAssetsManifest;
}

export const ASSET_CATALOG_DATABASE_NAME = 'mekbay-assets';
export const ASSET_CATALOG_DATABASE_VERSION = 1;
export const ASSET_CATALOG_STORE = 'assets';
export const ASSETS_MANIFEST_KEY = 'assets-manifest';

const SHA1_PATTERN = /^[A-Za-z0-9_-]{27}$/u;
const CATALOG_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
export const MAX_PRESENTATION_CATALOG_WIRE_LENGTH = 16 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class CatalogStorage {
  private readonly database = openDatabase();

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.getEntry<T>(key))?.payload;
  }

  async getEntry<T>(key: string): Promise<StoredAssetCatalog<T> | undefined> {
    assertCatalogKey(key);
    const value = await this.read(key);
    return isStoredAssetCatalog(value, key) ? value as StoredAssetCatalog<T> : undefined;
  }

  async getAssetsManifest(): Promise<RepositoryAssetsManifest | undefined> {
    const value = await this.read(ASSETS_MANIFEST_KEY);
    return isStoredAssetsManifest(value) ? value.assets : undefined;
  }

  async put<T>(key: string, hash: string, payload: T, assetPath?: string): Promise<void> {
    await this.putMany(
      [{ key, hash, payload }],
      assetPath ? { [assetPath]: hash } : {},
    );
  }

  /** Writes changed catalog rows and their installed hashes in one transaction. */
  async putMany(
    entries: readonly AssetCatalogWrite[],
    installedAssets: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    const records = entries.map(entry => {
      const key = entry.key;
      assertCatalogKey(key);
      if (!isStoredAssetCatalog(entry, key)) {
        throw new Error(`Invalid catalog cache entry: ${key}`);
      }
      return entry;
    });
    for (const [path, hash] of Object.entries(installedAssets)) {
      if (!path || !SHA1_PATTERN.test(hash)) throw new Error(`Invalid installed asset entry: ${path}`);
    }

    const database = await this.database;
    if (!database) return;
    const transaction = database.transaction(ASSET_CATALOG_STORE, 'readwrite');
    const store = transaction.objectStore(ASSET_CATALOG_STORE);
    const requests = [
      store.get(ASSETS_MANIFEST_KEY),
      ...records.map(record => store.get(record.key)),
    ];
    const values = new Array<unknown>(requests.length);
    let remaining = requests.length;
    requests.forEach((request, index) => {
      request.onsuccess = () => {
        values[index] = request.result;
        remaining -= 1;
        if (remaining !== 0) return;
        const stored = isStoredAssetsManifest(values[0])
          ? values[0].assets
          : {};
        for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
          const record = records[recordIndex];
          const previous = values[recordIndex + 1];
          if (!isStoredAssetCatalog(previous, record.key) || previous.hash !== record.hash) {
            store.put(record);
          }
        }
        if (Object.keys(installedAssets).length > 0) {
          store.put({
            key: ASSETS_MANIFEST_KEY,
            assets: Object.freeze({ ...stored, ...installedAssets }),
          } satisfies StoredAssetsManifest);
        }
      };
      request.onerror = () => transaction.abort();
    });
    await transactionComplete(transaction);
  }

  async recordInstalledAssets(assets: Readonly<Record<string, string>>): Promise<void> {
    await this.putMany([], assets);
  }

  async getFluffImages(provider: UnitProviderId): Promise<StoredFluffImageCatalog | undefined> {
    const value = await this.read(fluffImageCatalogKey(provider));
    return isStoredFluffImageCatalog(value, provider) ? value : undefined;
  }

  async putFluffImages(record: StoredFluffImageCatalog): Promise<void> {
    if (!isStoredFluffImageCatalog(record, record.provider)) {
      throw new Error('Invalid fluff-image catalog cache entry');
    }
    await this.write(record);
  }

  async clear(): Promise<void> {
    const database = await this.database;
    if (!database) return;
    const transaction = database.transaction(ASSET_CATALOG_STORE, 'readwrite');
    transaction.objectStore(ASSET_CATALOG_STORE).clear();
    await transactionComplete(transaction);
  }

  private async read(key: string): Promise<unknown> {
    const database = await this.database;
    return database
      ? requestResult(database.transaction(ASSET_CATALOG_STORE, 'readonly').objectStore(ASSET_CATALOG_STORE).get(key))
      : undefined;
  }

  private async write(value: StoredFluffImageCatalog): Promise<void> {
    const database = await this.database;
    if (!database) return;
    const transaction = database.transaction(ASSET_CATALOG_STORE, 'readwrite');
    transaction.objectStore(ASSET_CATALOG_STORE).put(value);
    await transactionComplete(transaction);
  }
}

export function fluffImageCatalogKey(provider: UnitProviderId): string {
  return `${provider}:fluff-images`;
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_CATALOG_DATABASE_NAME, ASSET_CATALOG_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_CATALOG_STORE)) {
        database.createObjectStore(ASSET_CATALOG_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open asset catalog cache'));
    request.onblocked = () => reject(new Error('Asset catalog cache is blocked by another MekBay tab'));
  });
}

function requestResult(request: IDBRequest<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Asset catalog cache request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Asset catalog cache transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Asset catalog cache transaction aborted'));
  });
}

function isStoredAssetCatalog(value: unknown, key: string): value is StoredAssetCatalog {
  return isObject(value)
    && value['key'] === key
    && typeof value['hash'] === 'string'
    && SHA1_PATTERN.test(value['hash'])
    && 'payload' in value;
}

function isStoredAssetsManifest(value: unknown): value is StoredAssetsManifest {
  return isObject(value)
    && value['key'] === ASSETS_MANIFEST_KEY
    && isObject(value['assets'])
    && Object.entries(value['assets']).every(([path, hash]) => (
      path.length > 0 && typeof hash === 'string' && SHA1_PATTERN.test(hash)
    ));
}

function isStoredFluffImageCatalog(
  value: unknown,
  provider: UnitProviderId,
): value is StoredFluffImageCatalog {
  return isObject(value)
    && value['key'] === fluffImageCatalogKey(provider)
    && value['provider'] === provider
    && typeof value['baseUrl'] === 'string'
    && typeof value['etag'] === 'string'
    && typeof value['wireJson'] === 'string'
    && value['wireJson'].length > 0
    && value['wireJson'].length <= MAX_PRESENTATION_CATALOG_WIRE_LENGTH;
}

function assertCatalogKey(key: string): void {
  if (!CATALOG_KEY_PATTERN.test(key)) throw new Error(`Invalid catalog cache key: ${key}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
