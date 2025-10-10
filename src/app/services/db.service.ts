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

import { Injectable, signal } from '@angular/core';
import { Unit, Units } from '../models/units.model';
import { Eras } from '../models/eras.model';
import { Factions } from '../models/factions.model';
import { Options } from '../models/options.model';
import { Quirks } from '../models/quirks.model';
import { EquipmentData } from '../models/equipment.model';
import { Force } from '../models/force-unit.model';
import { DataService } from './data.service';
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { Injector } from '@angular/core';

/*
 * Author: Drake
 */
const DB_NAME = 'mekbay';
const DB_VERSION = 6;
const DB_STORE = 'store';
const UNITS_KEY = 'units';
const EQUIPMENT_KEY = 'equipment';
const FACTIONS_KEY = 'factions';
const ERAS_KEY = 'eras';
const SHEETS_STORE = 'sheetsStore';
const FORCE_STORE = 'forceStore';
const OPTIONS_KEY = 'options';
const QUIRKS_KEY = 'quirks';

const MAX_SHEET_CACHE_COUNT = 2000; // Max number of sheets to cache

export interface StoredSheet {
    key: string;
    timestamp: number; // Timestamp of when the sheet was saved
    etag: string; // ETag for the sheet content for cache validation
    content: Blob; // The compressed XML content of the sheet
    size: number; // Size of the blob in bytes
}

@Injectable({
    providedIn: 'root'
})
export class DbService {
    private dbPromise: Promise<IDBDatabase>;

    constructor() {
        this.dbPromise = this.initIndexedDb();
    }

    private initIndexedDb(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                const transaction = (event.target as IDBOpenDBRequest).transaction;
                this.createStoreIfMissing(db, transaction, DB_STORE);
                this.createStoreIfMissing(db, transaction, SHEETS_STORE, 'timestamp');
                this.createStoreIfMissing(db, transaction, FORCE_STORE, 'timestamp');
            };

            request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
            request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
            request.onblocked = () => {
                alert('Database upgrade blocked. Please close other tabs of this app and reload.');
                reject('IndexedDB upgrade blocked');
            };
        });
    }

    private createStoreIfMissing(db: IDBDatabase, transaction: IDBTransaction | null, storeName: string, indexName?: string) {
        let store;
        if (!db.objectStoreNames.contains(storeName)) {
            store = db.createObjectStore(storeName);
        } else if (transaction) {
            store = transaction.objectStore(storeName);
        }
        if (store && indexName && !store.indexNames.contains(indexName)) {
            store.createIndex(indexName, indexName, { unique: false });
        }
    }

    public async waitForDbReady(): Promise<void> {
        await this.dbPromise;
    }

    private async getDataFromDBStore<T>(key: string): Promise<T | null> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readonly');
            const store = transaction.objectStore(DB_STORE);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result as T | null);
            };

            request.onerror = () => {
                console.error(`Error getting ${key} from IndexedDB:`, request.error);
                reject(request.error);
            };
        });
    }

    private async saveDataFromDBStore<T>(data: T, key: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite');
            const store = transaction.objectStore(DB_STORE);
            const request = store.put(data, key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error(`Error saving ${key} to IndexedDB:`, request.error);
                reject(request.error);
            };
        });
    }

    private async getDataFromStore<T>(key: string, storeName: string): Promise<T | null> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result as T | null);
            };

            request.onerror = () => {
                console.error(`Error getting ${key} from IndexedDB ${storeName}:`, request.error);
                reject(request.error);
            };
        });
    }

    private async saveDataToStore<T>(data: T, key: string, storeName: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data, key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error(`Error saving ${key} to IndexedDB ${storeName}:`, request.error);
                reject(request.error);
            };
        });
    }

    public async getUnits(): Promise<Units | null> {
        return await this.getDataFromDBStore<Units>(UNITS_KEY);
    }

    public async saveEquipment(equipmentData: EquipmentData): Promise<void> {
        return await this.saveDataFromDBStore(equipmentData, EQUIPMENT_KEY);
    }

    public async getEquipment(): Promise<EquipmentData | null> {
        return await this.getDataFromDBStore<EquipmentData>(EQUIPMENT_KEY);
    }

    public async saveUnits(unitsData: Units): Promise<void> {
        return await this.saveDataFromDBStore(unitsData, UNITS_KEY);
    }

    public async getFactions(): Promise<Factions | null> {
        return await this.getDataFromDBStore<Factions>(FACTIONS_KEY);
    }

    public async saveFactions(factionsData: Factions): Promise<void> {
        return await this.saveDataFromDBStore(factionsData, FACTIONS_KEY);
    }

    public async getEras(): Promise<Eras | null> {
        return await this.getDataFromDBStore<Eras>(ERAS_KEY);
    }

    public async saveEras(erasData: Eras): Promise<void> {
        return await this.saveDataFromDBStore(erasData, ERAS_KEY);
    }

    public async getOptions(): Promise<Options | null> {
        return await this.getDataFromDBStore<Options>(OPTIONS_KEY);
    }
    
    public async saveOptions(options: Options): Promise<void> {
        return await this.saveDataFromDBStore(options, OPTIONS_KEY);
    }

    public async getQuirks(): Promise<Quirks | null> {
        return await this.getDataFromDBStore<Quirks>(QUIRKS_KEY);
    }

    public async saveQuirks(quirksData: Quirks): Promise<void> {
        return await this.saveDataFromDBStore(quirksData, QUIRKS_KEY);
    }

    public async getForce(instanceId: string): Promise<Force | null> {
        return await this.getDataFromStore<Force>(instanceId, FORCE_STORE);
    }

    public async saveForce(force: Force): Promise<void> {
        if (!force.instanceId) {
            throw new Error('Force instance ID is required for saving.');
        }
        return await this.saveDataToStore(force, force.instanceId, FORCE_STORE);
    }
    
    /**
     * Retrieves all forces from IndexedDB, sorted by timestamp descending.
     */
    public async listForces(dataService: DataService, unitInitializer: UnitInitializerService, injector: Injector): Promise<Force[]> {
        const db = await this.dbPromise;
        return new Promise<Force[]>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readonly');
            const store = transaction.objectStore(FORCE_STORE);
            // Use index if available, otherwise iterate and sort manually
            let forces: any[] = [];
            let request: IDBRequest;
            if (store.indexNames.contains('timestamp')) {
                const index = store.index('timestamp');
                // Open cursor descending
                request = index.openCursor(null, 'prev');
            } else {
                request = store.openCursor();
            }
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    forces.push(cursor.value);
                    cursor.continue();
                } else {
                    // If not using index, sort manually
                    if (!store.indexNames.contains('timestamp')) {
                        forces.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
                    }
                    // Deserialize each force
                    try {
                        const result = forces.map(raw => Force.deserialize(raw, dataService, unitInitializer, injector));
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                }
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    public async deleteForce(instanceId: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readwrite');
            const store = transaction.objectStore(FORCE_STORE);
            const request = store.delete(instanceId);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    public async getSheet(key: string, etag: string): Promise<SVGSVGElement | null> {
        const storedData = await this.getDataFromStore<StoredSheet>(key, SHEETS_STORE);
        if (!storedData) {
            return null;
        }
        const isSameEtag = storedData.etag === etag;
        if (isSameEtag || !navigator.onLine) {
            try {
                const decompressedStream = storedData.content.stream().pipeThrough(new DecompressionStream('gzip'));
                const decompressedString = await new Response(decompressedStream).text();
                const parser = new DOMParser();
                const content = parser.parseFromString(decompressedString, 'image/svg+xml');
                const svg: SVGSVGElement | null = content.documentElement as unknown as SVGSVGElement;
                return svg;
            } catch (error) {
                console.error(`Error retrieving sheet ${key}:`, error);
                return null;
            }
        }
        return null; // If we detect that we are online and the etag is different, return null to force a refresh
    }

    public async saveSheet(key: string, sheet: SVGSVGElement, etag: string): Promise<void> {
        const serializer = new XMLSerializer();
        const contentString = serializer.serializeToString(sheet);
        const compressedStream = new Blob([contentString]).stream().pipeThrough(new CompressionStream('gzip'));
        const compressedBlob = await new Response(compressedStream).blob();
        const data: StoredSheet = {
            key: key,
            timestamp: Date.now(),
            etag: etag,
            content: compressedBlob,
            size: compressedBlob.size,
        };
        this.saveDataToStore(data, key, SHEETS_STORE).then(() => {
            this.cullOldSheets();
        });
    }

    public async clearSheetsStore(): Promise<void> {
        const db = await this.dbPromise;
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(SHEETS_STORE, 'readwrite');
            const store = transaction.objectStore(SHEETS_STORE);
            const request = store.clear();

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    public async getSheetsStoreSize(): Promise<number> {
        const db = await this.dbPromise;
        return new Promise<number>((resolve, reject) => {
            const transaction = db.transaction(SHEETS_STORE, 'readonly');
            const store = transaction.objectStore(SHEETS_STORE);
            const request = store.openCursor();
            let totalSize = 0;

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const storedSheet = cursor.value as StoredSheet;
                    totalSize += storedSheet.size || 0;
                    cursor.continue();
                } else {
                    resolve(totalSize);
                }
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    private async cullOldSheets(): Promise<void> {
        const db = await this.dbPromise;
        const transaction = db.transaction(SHEETS_STORE, 'readwrite');
        const store = transaction.objectStore(SHEETS_STORE);
        const countRequest = store.count();
        countRequest.onsuccess = () => {
            let itemsToDelete = countRequest.result - MAX_SHEET_CACHE_COUNT;
            if (itemsToDelete <= 0) return;
            const index = store.index('timestamp');
            const cursorRequest = index.openCursor(); // Iterates from oldest to newest
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (cursor && itemsToDelete > 0) {
                    cursor.delete(); // Deletes the current (oldest) item
                    itemsToDelete--;
                    cursor.continue(); // Move to the next item
                }
            };
        };
    }

}