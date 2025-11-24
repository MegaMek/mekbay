/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { LoggerService } from './logger.service';

/*
 * Author: Drake
 */

const DB_NAME = 'mekbay-assets';
const DB_VERSION = 2;
const UNIT_ICONS_STORE_NAME = 'unitIcons';
const METADATA_STORE_NAME = 'metadata';

@Injectable({
    providedIn: 'root'
})
export class ImageStorageService {
    private dbPromise: Promise<IDBDatabase>;
    private http = inject(HttpClient);
    private logger = inject(LoggerService);

    public loading$ = new BehaviorSubject<boolean>(false);
    public progress$ = new BehaviorSubject<number>(0);

    private readonly MAX_CACHE_SIZE = 8000;
    private urlCache = new Map<string, string>();
    private pendingRequests = new Map<string, Promise<string | null>>();

    constructor() {
        this.dbPromise = this.initIndexedDb();
        this.checkAndHydrate();
    }

    private initIndexedDb(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (db.objectStoreNames.contains(UNIT_ICONS_STORE_NAME)) {
                    db.deleteObjectStore(UNIT_ICONS_STORE_NAME);
                }
                db.createObjectStore(UNIT_ICONS_STORE_NAME);

                if (db.objectStoreNames.contains(METADATA_STORE_NAME)) {
                    db.deleteObjectStore(METADATA_STORE_NAME);
                }
                db.createObjectStore(METADATA_STORE_NAME);
            };

            request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
            request.onerror = (event) => {
                this.logger.error('ImageStorage DB Error: ' + (event.target as IDBOpenDBRequest).error);
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    private async checkAndHydrate() {
        try {
            const count = await this.getCount();
            const localHash = await this.getLocalHash();
            this.logger.info(`Unit icons in DB: ${count}, local hash: ${localHash || 'none'}`);

            let remoteHash: string | null = null;
            try {
                // Fetch the hash file with a timestamp to prevent caching
                remoteHash = await firstValueFrom(
                    this.http.get('zip/unitIcons.zip.sha256?t=' + Date.now(), { responseType: 'text' })
                );
                remoteHash = remoteHash ? remoteHash.trim() : null;
                if (remoteHash && remoteHash === localHash) {
                    this.logger.info('Icons cache is up to date.');
                    return;
                }
            } catch (e) {
                this.logger.warn('Could not fetch zip/unitIcons.zip.sha256: ' + e);
            }

            // If we have a remote hash or if DB is empty
            if (remoteHash || count === 0) {
                this.logger.info('Icons cache outdated or empty. Downloading unitIcons.zip...');

                await this.loadImagesFromZip(remoteHash);
            }
        } catch (err) {
            this.logger.error('Error checking icons cache: ' + err);
        }
    }

    private async getStorageUsage(): Promise<number> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(UNIT_ICONS_STORE_NAME, 'readonly');
            const store = transaction.objectStore(UNIT_ICONS_STORE_NAME);
            let totalSize = 0;
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    const blob = cursor.value as Blob;
                    if (blob) {
                        totalSize += blob.size;
                    }
                    cursor.continue();
                } else {
                    resolve(totalSize);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    private async getLocalHash(): Promise<string | null> {
        const db = await this.dbPromise;
        return new Promise((resolve) => {
            const transaction = db.transaction(METADATA_STORE_NAME, 'readonly');
            const store = transaction.objectStore(METADATA_STORE_NAME);
            const request = store.get('unitIcons_zip_hash');
            request.onsuccess = () => resolve(request.result as string || null);
            request.onerror = () => resolve(null);
        });
    }

    private async setLocalHash(hash: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(METADATA_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(METADATA_STORE_NAME);
            const request = store.put(hash, 'unitIcons_zip_hash');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    private getCount(): Promise<number> {
        return this.dbPromise.then(db => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(UNIT_ICONS_STORE_NAME, 'readonly');
                const store = transaction.objectStore(UNIT_ICONS_STORE_NAME);
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
    }

    private async loadImagesFromZip(newHash: string | null = null) {
        this.loading$.next(true);
        try {
            // Download
            const zipData = await firstValueFrom(
                this.http.get('zip/unitIcons.zip', { responseType: 'arraybuffer', reportProgress: true })
            );

            // Unzip
            const JSZip = await import('jszip');
            const zip = await JSZip.loadAsync(zipData);
            const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
            
            // Store in DB
            const db = await this.dbPromise;

            let processed = 0;
            const total = files.length;
            const BATCH_SIZE = 50;
            
            // Process in batches to avoid TransactionInactiveError due to async/await in loop
            for (let i = 0; i < total; i += BATCH_SIZE) {
                const batchFiles = files.slice(i, i + BATCH_SIZE);
                const batchData: { name: string, blob: Blob }[] = [];

                // 1. Prepare data (async unzip) - outside transaction
                for (const filename of batchFiles) {
                    const content = await zip.files[filename].async('blob');
                    batchData.push({ name: filename, blob: content });
                }

                // 2. Write batch - inside transaction
                await new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(UNIT_ICONS_STORE_NAME, 'readwrite');
                    const store = transaction.objectStore(UNIT_ICONS_STORE_NAME);

                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);

                    for (const item of batchData) {
                        store.put(item.blob, item.name);
                    }
                });

                processed += batchFiles.length;
                this.progress$.next(Math.round((processed / total) * 100));
            }

            // Cleanup files that are in DB but not in the new Zip
            await this.cleanupObsoleteFiles(db, files);

            if (newHash) {
                await this.setLocalHash(newHash);
            }

            const usage = await this.getStorageUsage();
            this.logger.info(`Hydrated ${processed} icons into ${DB_NAME} (${(usage / (1024 * 1024)).toFixed(2)} MB)`);
        } catch (err) {
            this.logger.error('Failed to load unitIcons.zip: ' + err);
        } finally {
            this.loading$.next(false);
        }
    }

    private async cleanupObsoleteFiles(db: IDBDatabase, keepFiles: string[]): Promise<void> {
        const keepSet = new Set(keepFiles);
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(UNIT_ICONS_STORE_NAME, 'readwrite');
          const store = transaction.objectStore(UNIT_ICONS_STORE_NAME);
          
          const request = store.getAllKeys();
          
          request.onsuccess = () => {
            const keys = request.result as string[];
            const keysToDelete = keys.filter(key => !keepSet.has(key));
            
            if (keysToDelete.length > 0) {
              this.logger.info(`Removing ${keysToDelete.length} obsolete icons.`);
              keysToDelete.forEach(key => store.delete(key));
            }
          };

          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      }

    public async getImage(filename: string): Promise<string | null> {
        if (this.urlCache.has(filename)) {
            this.refreshCacheEntry(filename);
            return this.urlCache.get(filename)!;
        }

        if (this.pendingRequests.has(filename)) {
            return this.pendingRequests.get(filename)!;
        }

        const promise = this.fetchFromDb(filename).finally(() => {
            this.pendingRequests.delete(filename);
        });

        this.pendingRequests.set(filename, promise);
        return promise;
    }

    public getCachedUrl(filename: string): string | undefined {
        if (this.urlCache.has(filename)) {
            this.refreshCacheEntry(filename);
            return this.urlCache.get(filename);
        }
        return undefined;
    }

    private refreshCacheEntry(filename: string) {
        const url = this.urlCache.get(filename);
        if (url) {
            // Delete and re-set to move it to the end of the Map (most recently used)
            this.urlCache.delete(filename);
            this.urlCache.set(filename, url);
        }
    }

    private cacheUrl(filename: string, url: string) {
        if (this.urlCache.size >= this.MAX_CACHE_SIZE) {
            // Map.keys() returns an iterator in insertion order. The first one is the oldest (LRU).
            const oldestKey = this.urlCache.keys().next().value;
            if (oldestKey) {
                const oldestUrl = this.urlCache.get(oldestKey);
                if (oldestUrl) {
                    URL.revokeObjectURL(oldestUrl);
                }
                this.urlCache.delete(oldestKey);
            }
        }
        this.urlCache.set(filename, url);
    }

    private async fetchFromDb(filename: string): Promise<string | null> {
        const db = await this.dbPromise;
        return new Promise((resolve) => {
            const transaction = db.transaction(UNIT_ICONS_STORE_NAME, 'readonly');
            const store = transaction.objectStore(UNIT_ICONS_STORE_NAME);
            const request = store.get(filename);

            request.onsuccess = () => {
                const blob = request.result as Blob;
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    this.cacheUrl(filename, url);
                    resolve(url);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null); // Fail gracefully
        });
    }
}