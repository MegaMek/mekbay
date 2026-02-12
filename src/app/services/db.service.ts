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

import { inject, Injectable } from '@angular/core';
import { Units } from '../models/units.model';
import { Eras } from '../models/eras.model';
import { Factions } from '../models/factions.model';
import { Options } from '../models/options.model';
import { Quirks } from '../models/quirks.model';
import { Sourcebooks } from '../models/sourcebook.model';
import { MULUnitSources } from '../models/mul-unit-sources.model';
import { EquipmentData } from '../models/equipment.model';
import { SerializedForce, SerializedGroup, SerializedUnit } from '../models/force-serialization';
import { DataService } from './data.service';
import { UnitInitializerService } from './unit-initializer.service';
import { Injector } from '@angular/core';
import { DialogsService } from './dialogs.service';
import { SerializedSearchFilter } from './unit-search-filters.service';
import { LoadForceEntry, LoadForceGroup, LoadForceUnit } from '../models/load-force-entry.model';
import { LoggerService } from './logger.service';


/*
 * Author: Drake
 */
const DB_NAME = 'mekbay';
const DB_VERSION = 10;
const DB_STORE = 'store';
const UNITS_KEY = 'units';
const EQUIPMENT_KEY = 'equipment';
const FACTIONS_KEY = 'factions';
const ERAS_KEY = 'eras';
const SOURCEBOOKS_KEY = 'sourcebooks';
const SHEETS_STORE = 'sheetsStore';
const CANVAS_STORE = 'canvasStore';
const FORCE_STORE = 'forceStore';
const TAGS_STORE = 'tagsStore';
const SAVED_SEARCHES_STORE = 'savedSearchesStore';
const PUBLIC_TAGS_STORE = 'publicTagsStore';
const OPTIONS_KEY = 'options';
const USER_KEY = 'user';
const QUIRKS_KEY = 'quirks';
const MUL_UNIT_SOURCES_KEY = 'mulUnitSources';

const MAX_SHEET_CACHE_COUNT = 5000; // Max number of sheets to cache

export interface StoredSheet {
    key: string;
    timestamp: number; // Timestamp of when the sheet was saved
    etag: string; // ETag for the sheet content for cache validation
    content: Blob; // The compressed XML content of the sheet
    size: number; // Size of the blob in bytes
}

/**
 * Tag data keyed by tag name -> unit names array (V2 format)
 * Previously was unit name -> tags array (V1 format)
 */
export interface StoredTags {
    [tagName: string]: string[];
}

/**
 * Chassis tags keyed by tag name -> chassis key array (V2 format)
 * Previously was chassis|type key -> tags array (V1 format)
 */
export interface StoredChassisTags {
    [tagName: string]: string[];
}

/**
 * Minimal tag operation for incremental sync.
 * Uses short property names for wire efficiency.
 */
export interface TagOp {
    /** Key: unit name (for name tags) or chassis|type (for chassis tags). Empty for rename. */
    k: string;
    /** Tag name (original tag name for rename) */
    t: string;
    /** Category: 0=name, 1=chassis */
    c: 0 | 1;
    /** Action: 0=remove, 1=add, 2=rename */
    a: 0 | 1 | 2;
    /** Timestamp in milliseconds */
    ts: number;
    /** New tag name (only for rename action) */
    n?: string;
    /** Quantity (only for add, if > 1) */
    q?: number;
}

/**
 * Data attached to a unit/chassis within a tag.
 * Currently supports quantity, extensible for future properties.
 */
export interface UnitTagData {
    /** Quantity, only present if > 1 */
    q?: number;
}

/**
 * A single tag entry containing its display label and associated units/chassis.
 * Keys in units/chassis objects are the unit/chassis names.
 */
export interface TagEntry {
    /** Display name with original case (e.g., "My Favorites") */
    label: string;
    /** Map of unit names to their tag data */
    units: Record<string, UnitTagData>;
    /** Map of chassis keys to their tag data */
    chassis: Record<string, UnitTagData>;
}

/**
 * V3 Tag data format - uses lowercase tag IDs as keys.
 * This is the current storage format.
 */
export interface TagData {
    /** Map of lowercase tagId -> TagEntry */
    tags: Record<string, TagEntry>;
    /** Format version: 3 for V3 format */
    formatVersion: 3;
    /** Timestamp of last modification for sync purposes */
    timestamp: number;
}

/**
 * Legacy V1/V2 tag data format for migration.
 * V1: nameTags = { unitName: [tags] }, chassisTags = { chassisKey: [tags] }
 * V2: nameTags = { tag: [unitNames] }, chassisTags = { tag: [chassisKeys] }
 */
export interface TagDataLegacy {
    nameTags: Record<string, string[]>;
    chassisTags: Record<string, string[]>;
    formatVersion?: number;
    timestamp: number;
}

/**
 * Public tag data from another user (subscribed or temporary)
 */
export interface PublicTagData {
    /** The publicId of the tag owner */
    publicId: string;
    /** Tag name */
    tagName: string;
    /** Unit names with this tag */
    unitNames: string[];
    /** Chassis keys with this tag */
    chassisKeys: string[];
    /** Whether this is a permanent subscription */
    subscribed: boolean;
    /** Timestamp of last sync for incremental updates */
    timestamp?: number;
}

/**
 * Local tag sync state stored in IndexedDB.
 */
export interface TagSyncState {
    /** Pending operations not yet confirmed by server */
    pendingOps: TagOp[];
    /** Timestamp of last successful sync with server */
    lastSyncTs: number;
}

/**
 * Saved search operation for incremental sync.
 */
export interface SavedSearchOp {
    /** Saved search ID */
    id: string;
    /** Action: 0=delete, 1=add/update */
    a: 0 | 1;
    /** The filter data (only for add/update) */
    data?: SerializedSearchFilter;
    /** Timestamp in milliseconds */
    ts: number;
}

/**
 * All saved searches keyed by ID.
 */
export interface StoredSavedSearches {
    [id: string]: SerializedSearchFilter;
}

/**
 * Saved search sync state stored in IndexedDB.
 */
export interface SavedSearchSyncState {
    /** Pending operations not yet confirmed by server */
    pendingOps: SavedSearchOp[];
    /** Timestamp of last successful sync with server */
    lastSyncTs: number;
}

export interface UserData {
    uuid: string;
    publicId?: string;
    tabSubs?: string[];
    /** Tag subscriptions: "publicId:tagName" pairs */
    tagSubscriptions?: string[];
}

@Injectable({
    providedIn: 'root'
})
export class DbService {
    private dbPromise: Promise<IDBDatabase | null>;
    private logger = inject(LoggerService);
    private dialogsService = inject(DialogsService);
    
    /** Whether the database is in a degraded state (failed to initialize) */
    private degradedMode = false;
    
    /** Whether blob storage is unavailable (iOS Safari Private Mode) */
    private blobStorageUnavailable = false;

    constructor() {
        this.dbPromise = this.initIndexedDbWithRecovery();
    }

    /**
     * Initialize IndexedDB with error recovery dialog.
     * Returns null if the user chooses to continue without storage.
     */
    private async initIndexedDbWithRecovery(): Promise<IDBDatabase | null> {
        try {
            return await this.initIndexedDb();
        } catch (error) {
            this.logger.error('IndexedDB initialization failed: ' + error);
            return await this.handleDbInitFailure(error);
        }
    }

    /**
     * Handle database initialization failure with user options.
     */
    private async handleDbInitFailure(error: unknown): Promise<IDBDatabase | null> {
        const choice = await this.dialogsService.choose<'retry' | 'reset' | 'continue'>(
            'Database Error',
            '',
            [
                { label: 'RETRY', value: 'retry' },
                { label: 'RESET DATABASE', value: 'reset', class: 'danger' },
                { label: 'CONTINUE WITHOUT STORAGE', value: 'continue' }
            ],
            'continue',
            {
                panelClass: 'danger',
                messageHtml: `
                    <p>Failed to open the local database. This may be due to storage corruption or browser issues.</p>
                    <p style="margin-top: 1em;"><strong>Your options:</strong></p>
                    <ul style="margin: 0.5em 0 1.5em 1.5em; padding: 0;">
                        <li><strong>RETRY</strong> – Try opening the database again</li>
                        <li><strong>RESET DATABASE</strong> – Delete and recreate the database (loses local-only data)</li>
                        <li><strong>CONTINUE WITHOUT STORAGE</strong> – Use the app without local storage (data won't persist)</li>
                    </ul>
                `
            }
        );

        if (choice === 'retry') {
            try {
                return await this.initIndexedDb();
            } catch (retryError) {
                this.logger.error('IndexedDB retry failed: ' + retryError);
                return await this.handleDbInitFailure(retryError);
            }
        }

        if (choice === 'reset') {
            try {
                await this.deleteDatabase();
                return await this.initIndexedDb();
            } catch (resetError) {
                this.logger.error('IndexedDB reset failed: ' + resetError);
                await this.dialogsService.showError(
                    'Failed to reset the database. Continuing without local storage.',
                    'Reset Failed'
                );
                this.degradedMode = true;
                return null;
            }
        }

        // choice === 'continue'
        this.degradedMode = true;
        return null;
    }

    /**
     * Delete the entire database for recovery purposes.
     */
    private deleteDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
                this.logger.warn('Database deletion blocked - other tabs may be open');
                // Still resolve after a delay, deletion will complete when tabs close
                setTimeout(resolve, 1000);
            };
        });
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
                this.createStoreIfMissing(db, transaction, TAGS_STORE);
                this.createStoreIfMissing(db, transaction, SAVED_SEARCHES_STORE);
                this.createStoreIfMissing(db, transaction, CANVAS_STORE);
                this.createStoreIfMissing(db, transaction, PUBLIC_TAGS_STORE);
            };

            request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
            request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
            request.onblocked = async () => {
                await this.dialogsService.showError('Database upgrade blocked. Please close other tabs of this app and reload.', 'Database Upgrade Blocked');
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

    /** Check if database is in degraded mode (no storage available) */
    public isDegraded(): boolean {
        return this.degradedMode;
    }

    private async getDataFromGeneralStore<T>(key: string): Promise<T | null> {
        const db = await this.dbPromise;
        if (!db) return null; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readonly');
            const store = transaction.objectStore(DB_STORE);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result as T | null);
            };

            request.onerror = () => {
                this.logger.error(`Error getting ${key} from IndexedDB: ${request.error}`);
                reject(request.error);
            };
        });
    }

    private async saveDataFromGeneralStore<T>(data: T, key: string): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode - silently skip
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite');
            const store = transaction.objectStore(DB_STORE);
            const request = store.put(data, key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                this.logger.error(`Error saving ${key} to IndexedDB: ${request.error}`);
                reject(request.error);
            };
        });
    }

    private async getDataFromStore<T>(key: string, storeName: string): Promise<T | null> {
        const db = await this.dbPromise;
        if (!db) return null; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result as T | null);
            };

            request.onerror = () => {
                this.logger.error(`Error getting ${key} from IndexedDB ${storeName}: ${request.error}`);
                reject(request.error);
            };
        });
    }

    private async saveDataToStore<T>(data: T, key: string, storeName: string): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode - silently skip
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data, key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                const errorMsg = request.error?.message || String(request.error);
                // Detect iOS Safari Private Mode blob storage failure
                if (errorMsg.includes('Blob') || errorMsg.includes('File')) {
                    this.blobStorageUnavailable = true;
                    this.logger.warn('Blob storage unavailable - operating in degraded mode');
                    resolve();
                    return;
                }
                this.logger.error(`Error saving ${key} to IndexedDB ${storeName}: ${request.error}`);
                reject(request.error);
            };
        });
    }

    private async deleteDataFromStore(key: string, storeName: string): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode - silently skip
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    public async getUnits(): Promise<Units | null> {
        return await this.getDataFromGeneralStore<Units>(UNITS_KEY);
    }

    public async saveEquipment(equipmentData: EquipmentData): Promise<void> {
        return await this.saveDataFromGeneralStore(equipmentData, EQUIPMENT_KEY);
    }

    public async getEquipments(): Promise<EquipmentData | null> {
        return await this.getDataFromGeneralStore<EquipmentData>(EQUIPMENT_KEY);
    }

    public async saveUnits(unitsData: Units): Promise<void> {
        return await this.saveDataFromGeneralStore(unitsData, UNITS_KEY);
    }

    public async getFactions(): Promise<Factions | null> {
        return await this.getDataFromGeneralStore<Factions>(FACTIONS_KEY);
    }

    public async saveFactions(factionsData: Factions): Promise<void> {
        return await this.saveDataFromGeneralStore(factionsData, FACTIONS_KEY);
    }

    public async getEras(): Promise<Eras | null> {
        return await this.getDataFromGeneralStore<Eras>(ERAS_KEY);
    }

    public async saveEras(erasData: Eras): Promise<void> {
        return await this.saveDataFromGeneralStore(erasData, ERAS_KEY);
    }

    public async getOptions(): Promise<Options | null> {
        return await this.getDataFromGeneralStore<Options>(OPTIONS_KEY);
    }
    
    public async saveOptions(options: Options): Promise<void> {
        return await this.saveDataFromGeneralStore(options, OPTIONS_KEY);
    }

    public async getUserData(): Promise<UserData | null> {
        return await this.getDataFromGeneralStore<UserData>(USER_KEY);
    }

    public async saveUserData(userData: UserData): Promise<void> {
        return await this.saveDataFromGeneralStore(userData, USER_KEY);
    }

    public async getQuirks(): Promise<Quirks | null> {
        return await this.getDataFromGeneralStore<Quirks>(QUIRKS_KEY);
    }

    public async saveQuirks(quirksData: Quirks): Promise<void> {
        return await this.saveDataFromGeneralStore(quirksData, QUIRKS_KEY);
    }

    public async getSourcebooks(): Promise<Sourcebooks | null> {
        return await this.getDataFromGeneralStore<Sourcebooks>(SOURCEBOOKS_KEY);
    }

    public async saveSourcebooks(sourcebooksData: Sourcebooks): Promise<void> {
        return await this.saveDataFromGeneralStore(sourcebooksData, SOURCEBOOKS_KEY);
    }

    public async getMULUnitSources(): Promise<MULUnitSources | null> {
        return await this.getDataFromGeneralStore<MULUnitSources>(MUL_UNIT_SOURCES_KEY);
    }

    public async saveMULUnitSources(data: MULUnitSources): Promise<void> {
        return await this.saveDataFromGeneralStore(data, MUL_UNIT_SOURCES_KEY);
    }

    public async getTags(): Promise<StoredTags | null> {
        return await this.getDataFromStore<StoredTags>('main', TAGS_STORE);
    }

    public async saveTags(tags: StoredTags): Promise<void> {
        return await this.saveDataToStore(tags, 'main', TAGS_STORE);
    }

    public async getChassisTags(): Promise<StoredChassisTags | null> {
        return await this.getDataFromStore<StoredChassisTags>('chassis', TAGS_STORE);
    }

    public async saveChassisTags(tags: StoredChassisTags): Promise<void> {
        return await this.saveDataToStore(tags, 'chassis', TAGS_STORE);
    }

    public async getTagsTimestamp(): Promise<number | null> {
        return await this.getDataFromStore<number>('timestamp', TAGS_STORE);
    }

    public async saveTagsTimestamp(timestamp: number): Promise<void> {
        return await this.saveDataToStore(timestamp, 'timestamp', TAGS_STORE);
    }

    /**
     * Get all tag data in a single read transaction.
     * Reads V3 format ('tags' key) if available, otherwise reads legacy V1 format ('main', 'chassis' keys).
     * Returns null if no data exists, or TagData | TagDataLegacy depending on what's stored.
     */
    public async getAllTagData(): Promise<TagData | TagDataLegacy | null> {
        const db = await this.dbPromise;
        if (!db) return null; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readonly');
            const store = transaction.objectStore(TAGS_STORE);

            // Try V3 format first
            const tagsRequest = store.get('tags');
            // Also read legacy keys for migration
            const mainRequest = store.get('main');
            const chassisRequest = store.get('chassis');
            const timestampRequest = store.get('timestamp');
            const formatVersionRequest = store.get('formatVersion');

            transaction.oncomplete = () => {
                // If we have V3 'tags' key, return V3 format
                if (tagsRequest.result) {
                    resolve({
                        tags: tagsRequest.result,
                        timestamp: timestampRequest.result || 0,
                        formatVersion: 3
                    } as TagData);
                } else if (mainRequest.result || chassisRequest.result) {
                    // Legacy V1 format
                    resolve({
                        nameTags: mainRequest.result || {},
                        chassisTags: chassisRequest.result || {},
                        timestamp: timestampRequest.result || 0,
                        formatVersion: formatVersionRequest.result
                    } as TagDataLegacy);
                } else {
                    resolve(null);
                }
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Save V3 tag data and clean up legacy keys.
     */
    public async saveAllTagData(data: TagData): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(TAGS_STORE);

            // Save V3 format
            store.put(data.tags, 'tags');
            store.put(data.timestamp, 'timestamp');
            store.put(3, 'formatVersion');

            // Delete legacy keys (migration cleanup)
            store.delete('main');
            store.delete('chassis');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Get tag sync state (pending operations and last sync timestamp).
     */
    public async getTagSyncState(): Promise<TagSyncState> {
        const db = await this.dbPromise;
        if (!db) return { pendingOps: [], lastSyncTs: 0 }; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readonly');
            const store = transaction.objectStore(TAGS_STORE);

            const pendingRequest = store.get('pendingOps');
            const lastSyncRequest = store.get('lastSyncTs');

            transaction.oncomplete = () => {
                resolve({
                    pendingOps: pendingRequest.result || [],
                    lastSyncTs: lastSyncRequest.result || 0
                });
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Save tag sync state.
     */
    public async saveTagSyncState(state: TagSyncState): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(TAGS_STORE);

            store.put(state.pendingOps, 'pendingOps');
            store.put(state.lastSyncTs, 'lastSyncTs');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Append operations to pending queue and update V3 tag data atomically.
     */
    public async appendTagOps(ops: TagOp[], tagData: TagData): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(TAGS_STORE);

            // Get current pending ops
            const pendingRequest = store.get('pendingOps');

            pendingRequest.onsuccess = () => {
                const currentPending: TagOp[] = pendingRequest.result || [];
                const newPending = [...currentPending, ...ops];
                
                // Save V3 format
                store.put(tagData.tags, 'tags');
                store.put(tagData.timestamp, 'timestamp');
                store.put(3, 'formatVersion');
                store.put(newPending, 'pendingOps');
                
                // Clean up legacy keys if they exist
                store.delete('main');
                store.delete('chassis');
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Clear pending operations after successful sync.
     */
    public async clearPendingTagOps(syncTs: number): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(TAGS_STORE);

            store.put([], 'pendingOps');
            store.put(syncTs, 'lastSyncTs');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // ================== Saved Searches Methods ==================

    /**
     * Get all saved searches.
     */
    public async getSavedSearches(): Promise<StoredSavedSearches | null> {
        return await this.getDataFromStore<StoredSavedSearches>('main', SAVED_SEARCHES_STORE);
    }

    /**
     * Save all saved searches.
     */
    public async saveSavedSearches(searches: StoredSavedSearches): Promise<void> {
        return await this.saveDataToStore(searches, 'main', SAVED_SEARCHES_STORE);
    }

    /**
     * Get saved search sync state.
     */
    public async getSavedSearchSyncState(): Promise<SavedSearchSyncState> {
        const db = await this.dbPromise;
        if (!db) return { pendingOps: [], lastSyncTs: 0 }; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SAVED_SEARCHES_STORE, 'readonly');
            const store = transaction.objectStore(SAVED_SEARCHES_STORE);

            const pendingRequest = store.get('pendingOps');
            const lastSyncRequest = store.get('lastSyncTs');

            transaction.oncomplete = () => {
                resolve({
                    pendingOps: pendingRequest.result || [],
                    lastSyncTs: lastSyncRequest.result || 0
                });
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Append saved search operations to pending queue.
     */
    public async appendSavedSearchOps(ops: SavedSearchOp[], searches: StoredSavedSearches): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SAVED_SEARCHES_STORE, 'readwrite');
            const store = transaction.objectStore(SAVED_SEARCHES_STORE);

            const pendingRequest = store.get('pendingOps');

            pendingRequest.onsuccess = () => {
                const currentPending: SavedSearchOp[] = pendingRequest.result || [];
                const newPending = [...currentPending, ...ops];
                
                store.put(searches, 'main');
                store.put(newPending, 'pendingOps');
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Clear pending saved search operations after successful sync.
     */
    public async clearPendingSavedSearchOps(syncTs: number): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SAVED_SEARCHES_STORE, 'readwrite');
            const store = transaction.objectStore(SAVED_SEARCHES_STORE);

            store.put([], 'pendingOps');
            store.put(syncTs, 'lastSyncTs');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Get all saved search data (searches and sync state) in a single transaction.
     */
    public async getAllSavedSearchData(): Promise<{ searches: StoredSavedSearches; pendingOps: SavedSearchOp[]; lastSyncTs: number }> {
        const db = await this.dbPromise;
        if (!db) return { searches: {}, pendingOps: [], lastSyncTs: 0 }; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SAVED_SEARCHES_STORE, 'readonly');
            const store = transaction.objectStore(SAVED_SEARCHES_STORE);

            const mainRequest = store.get('main');
            const pendingRequest = store.get('pendingOps');
            const lastSyncRequest = store.get('lastSyncTs');

            transaction.oncomplete = () => {
                resolve({
                    searches: mainRequest.result || {},
                    pendingOps: pendingRequest.result || [],
                    lastSyncTs: lastSyncRequest.result || 0
                });
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Save all saved search data in a single transaction.
     */
    public async saveAllSavedSearchData(searches: StoredSavedSearches, syncTs: number): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(SAVED_SEARCHES_STORE, 'readwrite');
            const store = transaction.objectStore(SAVED_SEARCHES_STORE);

            store.put(searches, 'main');
            store.put([], 'pendingOps');
            store.put(syncTs, 'lastSyncTs');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // ================== Public Tags (Subscribed) ==================

    /**
     * Get all subscribed public tags from IndexedDB.
     * Returns a map of subKey -> PublicTagData
     */
    public async getSubscribedPublicTags(): Promise<Map<string, PublicTagData>> {
        const db = await this.dbPromise;
        if (!db) return new Map(); // Degraded mode
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(PUBLIC_TAGS_STORE, 'readonly');
            const store = transaction.objectStore(PUBLIC_TAGS_STORE);
            const request = store.get('subscribed');

            request.onsuccess = () => {
                const data = request.result as Record<string, PublicTagData> | undefined;
                if (data) {
                    resolve(new Map(Object.entries(data)));
                } else {
                    resolve(new Map());
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save all subscribed public tags to IndexedDB.
     */
    public async saveSubscribedPublicTags(tags: Map<string, PublicTagData>): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(PUBLIC_TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(PUBLIC_TAGS_STORE);
            
            // Convert Map to plain object for storage
            const data: Record<string, PublicTagData> = {};
            for (const [key, value] of tags) {
                data[key] = value;
            }
            
            store.put(data, 'subscribed');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Clear all subscribed public tags from IndexedDB.
     */
    public async clearSubscribedPublicTags(): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(PUBLIC_TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(PUBLIC_TAGS_STORE);
            store.delete('subscribed');

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    public async getForce(instanceId: string): Promise<SerializedForce | null> {
        return await this.getDataFromStore<SerializedForce>(instanceId, FORCE_STORE);
    }

    public async saveForce(force: SerializedForce): Promise<void> {
        if (!force.instanceId) {
            throw new Error('Force instance ID is required for saving.');
        }
        return await this.saveDataToStore(force, force.instanceId, FORCE_STORE);
    }
    
    /**
     * Retrieves all forces from IndexedDB, sorted by timestamp descending.
     */
    public async listForces(dataService: DataService, unitInitializer: UnitInitializerService, injector: Injector): Promise<LoadForceEntry[]> {
        const db = await this.dbPromise;
        if (!db) return []; // Degraded mode
        return new Promise<LoadForceEntry[]>((resolve, reject) => {
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
                        const result: LoadForceEntry[] = [];
                        for (const raw of forces) {
                            const groups: LoadForceGroup[] = [];
                            if (raw.groups && Array.isArray(raw.groups)) {
                                for (const group of raw.groups as SerializedGroup[]) {
                                    const loadGroup: LoadForceGroup = {
                                        name: group.name ?? 'Group',
                                        units: []
                                    };
                                    for (const unit of group.units as SerializedUnit[]) {
                                        const loadUnit: LoadForceUnit = {
                                            unit: dataService.getUnitByName(unit.unit),
                                            alias: unit.alias,
                                            destroyed: unit.state.destroyed ?? false
                                        };
                                        loadGroup.units.push(loadUnit);
                                    }
                                    groups.push(loadGroup);
                                }
                            } else if (raw.units && Array.isArray(raw.units)) {
                                const loadUnits: LoadForceUnit[] = [];
                                for (const unit of raw.units as SerializedUnit[]) {
                                    const loadUnit: LoadForceUnit = {
                                        unit: dataService.getUnitByName(unit.unit),
                                        alias: unit.alias,
                                        destroyed: unit.state.destroyed ?? false
                                    }
                                    loadUnits.push(loadUnit);
                                };
                                groups.push({
                                    name: '',
                                    units: loadUnits
                                });
                            }
                            const entry: LoadForceEntry = new LoadForceEntry({
                                cloud: false,
                                instanceId: raw.instanceId,
                                name: raw.name,
                                type: raw.type,
                                bv: raw.bv ?? undefined,
                                pv: raw.pv ?? undefined,
                                timestamp: raw.timestamp, 
                                groups: groups
                            });
                            result.push(entry);
                        }
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

    private async deleteForceCanvasData(instanceId: string): Promise<void> {
        const force = await this.getForce(instanceId);
        if (!force) return;
        if (force.groups) {
            for (const group of force.groups) {
                const unitIds = group.units.map(unit => unit.id).filter(id => id);
                await Promise.all(unitIds.map(id => this.deleteCanvasData(id)));
            }
        }
    }

    public async deleteCanvasData(unitId: string): Promise<void> {
        await this.deleteDataFromStore(unitId, CANVAS_STORE);
    }

    public async deleteForce(instanceId: string): Promise<void> {
        await this.deleteForceCanvasData(instanceId);
        await this.deleteDataFromStore(instanceId, FORCE_STORE);
    }

    public async getCanvasData(unitId: string): Promise<Blob | null> {
        const storedData = await this.getDataFromStore<Blob>(unitId, CANVAS_STORE);
        if (!storedData) {
            return null;
        }
        return storedData;
    }

    public async saveCanvasData(unitId: string, img: Blob): Promise<void> {
        // Skip saving if blob storage is unavailable
        if (this.blobStorageUnavailable) return;
        try {
            await this.saveDataToStore(img, unitId, CANVAS_STORE);
        } catch {
            // Silently ignore
        }
    }

    /**
     * Get sheet metadata (timestamp, etag) without decompressing content.
     */
    public async getSheetMeta(key: string): Promise<{ timestamp: number; etag: string } | null> {
        const storedData = await this.getDataFromStore<StoredSheet>(key, SHEETS_STORE);
        if (!storedData) return null;
        return { timestamp: storedData.timestamp, etag: storedData.etag };
    }

    /**
     * Get the decompressed sheet content from cache.
     */
    public async getSheet(key: string): Promise<SVGSVGElement | null> {
        const storedData = await this.getDataFromStore<StoredSheet>(key, SHEETS_STORE);
        if (!storedData) return null;
        try {
            const decompressedStream = storedData.content.stream().pipeThrough(new DecompressionStream('gzip'));
            const decompressedString = await new Response(decompressedStream).text();
            const parser = new DOMParser();
            const content = parser.parseFromString(decompressedString, 'image/svg+xml');
            return content.documentElement as unknown as SVGSVGElement;
        } catch (error) {
            this.logger.error(`Error retrieving sheet ${key}: ${error}`);
            return null;
        }
    }

    /**
     * Update the timestamp of a cached sheet (to mark it as recently validated).
     */
    public async touchSheet(key: string): Promise<void> {
        const storedData = await this.getDataFromStore<StoredSheet>(key, SHEETS_STORE);
        if (!storedData) return;
        storedData.timestamp = Date.now();
        try {
            await this.saveDataToStore(storedData, key, SHEETS_STORE);
        } catch {
            // Silently ignore - not critical
        }
    }

    public async saveSheet(key: string, sheet: SVGSVGElement, etag: string): Promise<void> {
        // Skip saving if blob storage is unavailable
        if (this.blobStorageUnavailable) return;
        
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
        try {
            await this.saveDataToStore(data, key, SHEETS_STORE);
            if (!this.blobStorageUnavailable) {
                this.cullOldSheets();
            }
        } catch {
            // Silently ignore cache failures - sheets will be refetched as needed
        }
    }

    private async clearStore(storeName: string): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    public async clearSheetsStore(): Promise<void> {
        await this.clearStore(SHEETS_STORE);
    }

    public async clearCanvasStore(): Promise<void> {
        await this.clearStore(CANVAS_STORE);
    }

    private async getStoreSize(storeName: string): Promise<number> {
        const db = await this.dbPromise;
        if (!db) return 0; // Degraded mode
        return new Promise<number>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.openCursor();
            let totalSize = 0;
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const value = cursor.value;
                    if (value && typeof value === 'object') {
                        if ('size' in value && typeof value.size === 'number') {
                            totalSize += value.size;
                        }
                    }
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

    private async getStoreCount(storeName: string): Promise<number> {
        const db = await this.dbPromise;
        if (!db) return 0; // Degraded mode
        return new Promise<number>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    public async getSheetsStoreSize(): Promise<{memorySize: number, count: number}> {
        const [memorySize, count] = await Promise.all([
            this.getStoreSize(SHEETS_STORE),
            this.getStoreCount(SHEETS_STORE)
        ]);
        return { memorySize, count };
    }

    public async getCanvasStoreSize(): Promise<number> {
        return await this.getStoreSize(CANVAS_STORE);
    }

    private async cullOldSheets(): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
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