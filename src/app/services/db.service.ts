// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { Options } from '../models/options.model';
import type { SerializedForce } from '../models/force-serialization';
import { decodeRemoteLoadForceEntry, type RemoteLoadForceEntry } from '../models/remote-load-force-entry.model';
import { DialogsService } from './dialogs.service';
import type { SerializedSearchFilter } from './unit-search-filters.model';
import { LoggerService } from './logger.service';
import type { SerializedOperation } from '../models/operation.model';
import type { SerializedOrganization } from '../models/organization.model';
import type { LinkedOAuthProvider } from '../models/account-auth.model';
import {
    decodeForceFromStorage,
    encodeForceForStorage,
    type StoredForceRecord,
} from '../models/runtime/force-storage-codec';

const DB_NAME = 'mekbay';
const DB_VERSION = 18;
const DB_STORE = 'store';
const EQUIPMENT_KEY = 'equipment';
const FACTIONS_KEY = 'factions';
const MEGAMEK_FACTIONS_KEY = 'megamekFactions';
const MEGAMEK_AVAILABILITY_KEY = 'megamekAvailability';
const MEGAMEK_RULESETS_KEY = 'megamekRulesets';
const ERAS_KEY = 'eras';
const SOURCEBOOKS_KEY = 'sourcebooks';
const CANVAS_STORE = 'canvasStore';
const OPERATIONS_STORE = 'operationsStore';
const FORCE_STORE = 'forceStore';
const TAGS_STORE = 'tagsStore';
const SAVED_SEARCHES_STORE = 'savedSearchesStore';
const PUBLIC_TAGS_STORE = 'publicTagsStore';
const ORGANIZATIONS_STORE = 'organizationsStore';
const OPTIONS_KEY = 'options';
const USER_KEY = 'user';
const QUIRKS_KEY = 'quirks';
const SARNA_PAGE_TITLES_KEY = 'sarnaPageTitles';
const FORCE_NAME_WORDS_KEY = 'forceNameWords';
const PILOT_NAMES_KEY = 'pilotNames';

const CATALOG_GENERAL_STORE_KEYS = [
    EQUIPMENT_KEY,
    FACTIONS_KEY,
    MEGAMEK_FACTIONS_KEY,
    MEGAMEK_AVAILABILITY_KEY,
    MEGAMEK_RULESETS_KEY,
    ERAS_KEY,
    SOURCEBOOKS_KEY,
    QUIRKS_KEY,
    SARNA_PAGE_TITLES_KEY,
    FORCE_NAME_WORDS_KEY,
    PILOT_NAMES_KEY,
] as const;

class IndexedDbUpgradeBlockedError extends Error {
    constructor() {
        super('The local database upgrade is blocked by another MekBay tab. '
            + 'Close the other tab, then retry or reload this one.');
        this.name = 'IndexedDbUpgradeBlockedError';
    }
}

/** Tag data keyed by tag label -> unit names array. */
export interface StoredTags {
    [tagName: string]: string[];
}

/** Chassis tags keyed by tag label -> chassis key array. */
export interface StoredChassisTags {
    [tagName: string]: string[];
}

/**
 * Minimal tag operation for incremental sync.
 * Uses short property names for wire efficiency.
 */
export interface TagOp {
    /** Key: unit name (for name tags) or variant group key (for chassis tags). Empty for rename. */
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
 * V4 Tag data format - uses lowercase tag IDs as keys.
 * This is the current storage format.
 */
export interface TagData {
    /** Map of lowercase tagId -> TagEntry */
    tags: Record<string, TagEntry>;
    /** Format version: 4 uses variant group keys for chassis tags. */
    formatVersion: 3 | 4;
    /** Timestamp of last modification for sync purposes */
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
    displayName?: string;
    hasOAuth?: boolean;
    oauthProviderCount?: number;
    oauthProviders?: LinkedOAuthProvider[];
    accountProtectionPromptDismissed?: boolean;
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
        const blockedGuidance = error instanceof IndexedDbUpgradeBlockedError
            ? '<p><strong>Another MekBay tab is blocking the database upgrade.</strong> '
                + 'Close every other MekBay tab before retrying.</p>'
            : '<p>Failed to open the local database. This may be due to storage corruption or browser issues.</p>';
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
                    ${blockedGuidance}
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
                return null;
            }
        }

        // choice === 'continue'
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
            let settled = false;
            const rejectOnce = (error: unknown): void => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                const transaction = (event.target as IDBOpenDBRequest).transaction;
                this.createStoreIfMissing(db, transaction, DB_STORE);
                this.createStoreIfMissing(db, transaction, FORCE_STORE, 'timestamp');
                this.createStoreIfMissing(db, transaction, TAGS_STORE);
                this.createStoreIfMissing(db, transaction, SAVED_SEARCHES_STORE);
                this.createStoreIfMissing(db, transaction, CANVAS_STORE);
                this.createStoreIfMissing(db, transaction, PUBLIC_TAGS_STORE);
                this.createStoreIfMissing(db, transaction, OPERATIONS_STORE);
                this.createStoreIfMissing(db, transaction, ORGANIZATIONS_STORE);

                if (db.objectStoreNames.contains('forceV2Store')) {
                    // Schema 18 stores one complete force object. The V1 copy in
                    // forceStore remains sufficient for one-way load conversion.
                    db.deleteObjectStore('forceV2Store');
                }

                // Schema 14 removes the pre-generated units-fluff.json cache. Prose is
                // read from the native MTF/BLK only while Intel is open; art is resolved
                // independently through images.json.
                if (db.objectStoreNames.contains('unitFluffStore')) {
                    db.deleteObjectStore('unitFluffStore');
                }
                if (transaction && db.objectStoreNames.contains(DB_STORE)) {
                    const generalStore = transaction.objectStore(DB_STORE);
                    generalStore.delete('unitsFluff');
                    // Schema 15 removes the obsolete units.json snapshot.
                    // Provider-specific legacy caches use a different prefix and are preserved.
                    generalStore.delete('units');
                    if (event.oldVersion < 17) {
                        // Catalog caches are disposable application data. Do not
                        // migrate old-webapp payloads into the user-data database.
                        for (const key of CATALOG_GENERAL_STORE_KEYS) {
                            generalStore.delete(key);
                        }
                    }
                }
            };

            request.onsuccess = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (settled) {
                    db.close();
                    return;
                }
                settled = true;
                db.onversionchange = () => {
                    this.logger.warn('IndexedDB schema changed in another tab; closing this stale connection.');
                    db.close();
                };
                resolve(db);
            };
            request.onerror = (event) => rejectOnce((event.target as IDBOpenDBRequest).error);
            // Reject the open before any recovery UI is awaited. The outer
            // recovery path owns exactly one actionable dialog.
            request.onblocked = () => rejectOnce(new IndexedDbUpgradeBlockedError());
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

            request.onerror = () => {
                this.logger.error(`Error saving ${key} to IndexedDB: ${request.error}`);
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error ?? request.error);
            transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error(`Saving ${key} was aborted.`));
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

    /**
     * Get all tag data in a single read transaction.
     * Returns null if no tag data exists.
     */
    public async getAllTagData(): Promise<TagData | null> {
        const db = await this.dbPromise;
        if (!db) return null; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readonly');
            const store = transaction.objectStore(TAGS_STORE);

            const tagsRequest = store.get('tags');
            const timestampRequest = store.get('timestamp');
            const formatVersionRequest = store.get('formatVersion');

            transaction.oncomplete = () => {
                if (tagsRequest.result) {
                    resolve({
                        tags: tagsRequest.result,
                        timestamp: timestampRequest.result || 0,
                        formatVersion: formatVersionRequest.result || 3
                    } as TagData);
                } else {
                    resolve(null);
                }
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /** Save tag data. */
    public async saveAllTagData(data: TagData): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TAGS_STORE, 'readwrite');
            const store = transaction.objectStore(TAGS_STORE);

            // Save tag data
            store.put(data.tags, 'tags');
            store.put(data.timestamp, 'timestamp');
            store.put(data.formatVersion, 'formatVersion');

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
                
                // Save tag data
                store.put(tagData.tags, 'tags');
                store.put(tagData.timestamp, 'timestamp');
                store.put(tagData.formatVersion, 'formatVersion');
                store.put(newPending, 'pendingOps');
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
        const stored = await this.readForceRecord(instanceId);
        return stored === undefined ? null : decodeForceFromStorage(stored);
    }

    public async getForcePreview(instanceId: string): Promise<RemoteLoadForceEntry | null> {
        const stored = await this.readForceRecord(instanceId);
        return stored === undefined ? null : decodeRemoteLoadForceEntry(stored);
    }

    private async readForceRecord(instanceId: string): Promise<StoredForceRecord | undefined> {
        const db = await this.dbPromise;
        if (!db) return undefined;
        return new Promise<StoredForceRecord | undefined>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readonly');
            const request = transaction.objectStore(FORCE_STORE).get(instanceId);
            transaction.oncomplete = () => {
                resolve(request.result as StoredForceRecord | undefined);
            };
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error ?? new Error('Force read was aborted'));
        });
    }

    public async countForces(): Promise<number> {
        const db = await this.dbPromise;
        if (!db) return 0;

        return new Promise<number>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readonly');
            const request = transaction.objectStore(FORCE_STORE).count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    public async getExistingForceIds(instanceIds: readonly string[]): Promise<ReadonlySet<string>> {
        const existingIds = new Set<string>();
        if (instanceIds.length === 0) return existingIds;
        const db = await this.dbPromise;
        if (!db) return existingIds;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readonly');
            const store = transaction.objectStore(FORCE_STORE);
            for (const instanceId of instanceIds) {
                const request = store.getKey(instanceId);
                request.onsuccess = () => {
                    if (request.result !== undefined) existingIds.add(instanceId);
                };
            }
            transaction.oncomplete = () => resolve(existingIds);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error ?? new Error('Force presence query was aborted'));
        });
    }

    public async saveForce(force: SerializedForce): Promise<void> {
        if (!force.instanceId) {
            throw new Error('Force instance ID is required for saving.');
        }
        // Live owners save V2. Background downloads may cache an intact V1
        // source until an explicit load can warn about best-effort conversion.
        const stored = encodeForceForStorage(force);
        const db = await this.dbPromise;
        if (!db) return;
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readwrite');
            transaction.objectStore(FORCE_STORE).put(stored, force.instanceId);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error ?? new Error('Force save was aborted'));
        });
    }

    public async updateForceTags(instanceId: string, tags: readonly string[]): Promise<SerializedForce | null> {
        const db = await this.dbPromise;
        if (!db) return null;

        return new Promise<SerializedForce | null>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readwrite');
            const store = transaction.objectStore(FORCE_STORE);
            const request = store.get(instanceId);
            let updatedForce: SerializedForce | null = null;

            request.onsuccess = () => {
                const stored = request.result as StoredForceRecord | undefined;
                // Loaded force ownership must reseal V2 records.
                if (!stored || stored['cbt'] !== undefined) return;
                try {
                    const force = decodeForceFromStorage(stored);
                    updatedForce = { ...force };
                    if (tags.length > 0) {
                        updatedForce.tags = [...tags];
                    } else {
                        delete updatedForce.tags;
                    }
                    updatedForce.timestamp = new Date().toISOString();
                    store.put(encodeForceForStorage(updatedForce), instanceId);
                } catch (error) {
                    reject(error);
                    transaction.abort();
                }
            };

            transaction.oncomplete = () => {
                resolve(updatedForce);
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };
            transaction.onabort = () => reject(transaction.error ?? new Error('Force tag update was aborted'));
        });
    }
    
    /**
     * Retrieves all forces from IndexedDB, sorted by timestamp descending.
     */
    public async listForces(): Promise<RemoteLoadForceEntry[]> {
        const db = await this.dbPromise;
        if (!db) return []; // Degraded mode
        return new Promise<RemoteLoadForceEntry[]>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readonly');
            const store = transaction.objectStore(FORCE_STORE);
            // Use index if available, otherwise iterate and sort manually
            const forces: RemoteLoadForceEntry[] = [];
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
                    // Drop gameplay state as each cursor row arrives. Listing
                    // never decodes unit state or promotes a legacy record.
                    try {
                        forces.push(decodeRemoteLoadForceEntry(cursor.value));
                    } catch (error) {
                        this.logger.warn(`Skipping unreadable saved force: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    cursor.continue();
                } else {
                    // V1 records use ISO strings while current records use epoch
                    // numbers. IndexedDB orders those as different key types, so
                    // normalize before comparing.
                    forces.sort((left, right) => forceTimestamp(right) - forceTimestamp(left));
                    resolve(forces);
                }
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    private async deleteForceCanvasData(unitIds: readonly string[]): Promise<void> {
        await Promise.all(unitIds.map(unitId => this.deleteCanvasData(unitId)));
    }

    public async deleteCanvasData(unitId: string): Promise<void> {
        await this.deleteDataFromStore(unitId, CANVAS_STORE);
    }

    public async deleteForce(instanceId: string, unitIds: readonly string[] = []): Promise<void> {
        await this.deleteForceCanvasData(unitIds);
        const db = await this.dbPromise;
        if (!db) return;
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(FORCE_STORE, 'readwrite');
            transaction.objectStore(FORCE_STORE).delete(instanceId);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error ?? new Error('Force deletion was aborted'));
        });
    }

    /* ----------------------------------------------------------
     * Operations (multi-force compositions)
     */

    public async saveOperation(op: SerializedOperation): Promise<void> {
        return await this.saveDataToStore(op, op.operationId, OPERATIONS_STORE);
    }

    public async getOperation(operationId: string): Promise<SerializedOperation | null> {
        return await this.getDataFromStore<SerializedOperation>(operationId, OPERATIONS_STORE);
    }

    public async deleteOperation(operationId: string): Promise<void> {
        return await this.deleteDataFromStore(operationId, OPERATIONS_STORE);
    }

    public async listOperations(): Promise<SerializedOperation[]> {
        const db = await this.dbPromise;
        if (!db) return []; // Degraded mode
        return new Promise<SerializedOperation[]>((resolve, reject) => {
            const transaction = db.transaction(OPERATIONS_STORE, 'readonly');
            const store = transaction.objectStore(OPERATIONS_STORE);
            const request = store.openCursor();
            const ops: SerializedOperation[] = [];
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    ops.push(cursor.value);
                    cursor.continue();
                } else {
                    ops.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
                    resolve(ops);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /* ----------------------------------------------------------
     * Organizations (force org-chart layouts)
     */

    public async saveOrganization(org: SerializedOrganization): Promise<void> {
        return await this.saveDataToStore(org, org.organizationId, ORGANIZATIONS_STORE);
    }

    public async getOrganization(organizationId: string): Promise<SerializedOrganization | null> {
        return await this.getDataFromStore<SerializedOrganization>(organizationId, ORGANIZATIONS_STORE);
    }

    public async deleteOrganization(organizationId: string): Promise<void> {
        return await this.deleteDataFromStore(organizationId, ORGANIZATIONS_STORE);
    }

    public async listOrganizations(): Promise<SerializedOrganization[]> {
        const db = await this.dbPromise;
        if (!db) return [];
        return new Promise<SerializedOrganization[]>((resolve, reject) => {
            const transaction = db.transaction(ORGANIZATIONS_STORE, 'readonly');
            const store = transaction.objectStore(ORGANIZATIONS_STORE);
            const request = store.openCursor();
            const orgs: SerializedOrganization[] = [];
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    orgs.push(cursor.value);
                    cursor.continue();
                } else {
                    orgs.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
                    resolve(orgs);
                }
            };
            request.onerror = () => reject(request.error);
        });
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

    public async clearCanvasStore(): Promise<void> {
        await this.clearStore(CANVAS_STORE);
    }

    public async clearCatalogCaches(): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode

        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite');
            const store = transaction.objectStore(DB_STORE);

            for (const key of CATALOG_GENERAL_STORE_KEYS) {
                store.delete(key);
            }

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Clear all local per-user object stores while preserving shared data kept in the general store.
     * The persisted USER_KEY entry is removed as part of the reset.
     */
    public async clearLocalUserStores(): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return; // Degraded mode

        const storesToClear = Array.from(db.objectStoreNames).filter(storeName => storeName !== DB_STORE);
        const transactionStores = [DB_STORE, ...storesToClear];

        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(transactionStores, 'readwrite');

            transaction.objectStore(DB_STORE).delete(USER_KEY);

            for (const storeName of storesToClear) {
                transaction.objectStore(storeName).clear();
            }

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
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

    public async getCanvasStoreSize(): Promise<number> {
        return await this.getStoreSize(CANVAS_STORE);
    }

}

function forceTimestamp(value: unknown): number {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 0;
    const timestamp = (value as Record<string, unknown>)['timestamp'];
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp;
    if (typeof timestamp !== 'string') return 0;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
}
