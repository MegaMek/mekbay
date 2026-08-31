// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import {
    RepositoryAssetManifestService,
    type RepositoryAssetDescriptor,
} from './catalogs/repository-asset-manifest.service';
import {
    asUnitSpriteManifestDigest,
    createUnitSpriteAssignmentContext,
    type UnitSpriteAssignmentContext,
    type UnitSpriteAssignments,
    type UnitSpriteManifestEvidence,
} from '../utils/unit-sprite-assignment-resolver';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asUnitProviderId,
    type UnitProviderId,
} from './unit-catalog/unit-catalog.types';



const SPRITES_DISABLED = false;
const DOWNLOAD_CONCURRENCY = 3;
const DB_NAME = 'mekbay-sprites';
const DB_VERSION = 4;
const SPRITES_STORE = 'sprites';
const SPRITE_MANIFEST_CACHE_KEY = 'sprites_manifest_v4';
const LEGACY_SPRITE_MANIFEST_CACHE_KEY = 'sprites_verified_manifest_v3';
const SPRITE_MANIFEST_CACHE_SCHEMA_VERSION = 4 as const;
const UNIT_SPRITE_MANIFEST_PATH = 'online-assets/generated/sprites/unit-icons.json';

function describeSpriteStorageError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Sprite position info for a single icon */
export interface SpriteIconInfo {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Sprite sheet metadata for a unit type */
interface SpriteTypeInfo {
    url: string;
    width: number;
    height: number;
    /** Complete lowercase SHA-256 hex digest of the exact WebP bytes. */
    hash: string;
}

/** The full manifest structure from unit-icons.json */
export interface SpriteManifest {
    types: { [unitType: string]: SpriteTypeInfo };
    icons: { [iconPath: string]: SpriteIconInfo };
    assignments?: UnitSpriteAssignments;
}

interface SpriteDownloadResult {
    blobs: Map<string, Blob>;
    failedTypes: string[];
}

interface StoredSprite {
    readonly blob: Blob;
    readonly size: number;
    readonly assetHash: string;
}

/** Cached unit-icons.json bytes keyed by their direct assets-manifest hash. */
interface StoredSpriteManifest {
    readonly schemaVersion: typeof SPRITE_MANIFEST_CACHE_SCHEMA_VERSION;
    readonly manifestPath: typeof UNIT_SPRITE_MANIFEST_PATH;
    readonly assetHash: string;
    readonly manifestText: string;
}

interface LoadedSpriteManifest {
    readonly cache: StoredSpriteManifest;
    readonly manifest: SpriteManifest;
    readonly assignmentContext: UnitSpriteAssignmentContext;
}

export interface PreparedUnitSpriteManifest {
    readonly assetHash: string;
    readonly evidence: UnitSpriteManifestEvidence;
    readonly manifest: SpriteManifest;
    readonly assignmentContext: UnitSpriteAssignmentContext;
    readonly typeLookup: ReadonlyMap<string, SpriteTypeInfo>;
    readonly iconLookup: ReadonlyMap<string, SpriteIconInfo>;
}

@Injectable({
    providedIn: 'root'
})
export class SpriteStorageService {
    private dbPromise: Promise<IDBDatabase | null> = Promise.resolve(null);
    private logger = inject(LoggerService);
    private repositoryAssets = inject(RepositoryAssetManifestService);

    // Loading state - starts true until sprites are ready
    private _loading = signal<boolean>(true);
    public loading = this._loading.asReadonly();

    // In-memory cache for sprite sheet object URLs
    private spriteUrlCache = new Map<string, string>();
    private spriteDescriptorLookup = new Map<string, RepositoryAssetDescriptor>();
    private typeLookup: ReadonlyMap<string, SpriteTypeInfo> = new Map();
    private iconLookup: ReadonlyMap<string, SpriteIconInfo> = new Map();

    // Active parsed manifest and provider-specific assignment views.
    private manifest: SpriteManifest | null = null;
    private activeManifestCache: StoredSpriteManifest | null = null;
    private assignmentContexts = new Map<string, UnitSpriteAssignmentContext>();
    private initializationPromise: Promise<void> = Promise.resolve();

    constructor() {
        if (SPRITES_DISABLED) {
            this._loading.set(false);
            return;
        }
        this.dbPromise = this.initIndexedDb();
        this.initializationPromise = this.initializeSprites();
    }

    private initIndexedDb(): Promise<IDBDatabase | null> {
        const opening = new Promise<IDBDatabase>((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB is unavailable'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);
            let settled = false;
            const rejectOnce = (error: unknown): void => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // V4 keeps every cache row in one store: one self-describing row
                // per sprite type plus one reserved manifest row.
                if (event.oldVersion < 4 && db.objectStoreNames.contains(SPRITES_STORE)) {
                    db.deleteObjectStore(SPRITES_STORE);
                }
                if (event.oldVersion < 4 && db.objectStoreNames.contains('metadata')) {
                    db.deleteObjectStore('metadata');
                }
                if (!db.objectStoreNames.contains(SPRITES_STORE)) {
                    db.createObjectStore(SPRITES_STORE);
                }
            };

            request.onsuccess = (event) => {
                const database = (event.target as IDBOpenDBRequest).result;
                if (settled) {
                    database.close();
                    return;
                }
                settled = true;
                database.onversionchange = () => database.close();
                resolve(database);
            };
            request.onerror = (event) => {
                rejectOnce((event.target as IDBOpenDBRequest).error
                    ?? new Error('Failed to open sprite storage'));
            };
            request.onblocked = () => rejectOnce(
                new Error('Sprite storage upgrade is blocked by another MekBay tab'),
            );
        });
        return opening.catch(error => {
            this.logger.warn(`Sprite cache will run in memory only: ${describeSpriteStorageError(error)}`);
            return null;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IndexedDB Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private async dbGet<T>(store: string, key: string): Promise<T | null> {
        const db = await this.dbPromise;
        if (!db) return null;

        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const request = tx.objectStore(store).get(key);
            request.onsuccess = () => resolve((request.result as T) || null);
            request.onerror = () => resolve(null);
        });
    }

    private async dbPut(store: string, key: string, value: unknown): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    private async dbClear(store: string): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const request = tx.objectStore(store).clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    private normalizeLookupKey(key: string): string {
        return key.toLowerCase();
    }

    private setManifest(manifest: SpriteManifest | null): void {
        this.manifest = manifest;
        const lookups = this.buildManifestLookups(manifest);
        this.typeLookup = lookups.typeLookup;
        this.iconLookup = lookups.iconLookup;
    }

    private async dbDelete(store: string, key: string): Promise<void> {
        const db = await this.dbPromise;
        if (!db) return;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    private clearManifestState(): void {
        this.activeManifestCache = null;
        this.assignmentContexts.clear();
    }

    private clearActiveManifest(): void {
        this.clearManifestState();
        this.spriteDescriptorLookup.clear();
        this.setManifest(null);
    }

    private activateManifest(
        loaded: LoadedSpriteManifest,
        descriptors: ReadonlyMap<string, RepositoryAssetDescriptor> = new Map(),
    ): void {
        this.setManifest(loaded.manifest);
        this.spriteDescriptorLookup = new Map(descriptors);
        this.activeManifestCache = loaded.cache;
        this.assignmentContexts.clear();
        this.assignmentContexts.set(
            MM_DATA_UNIT_PROVIDER_ID,
            loaded.assignmentContext,
        );
    }

    private getIconInfo(iconPath: string): SpriteIconInfo | null {
        return this.iconLookup.get(this.normalizeLookupKey(iconPath)) ?? null;
    }

    private getTypeInfo(unitType: string): SpriteTypeInfo | null {
        return this.typeLookup.get(this.normalizeLookupKey(unitType)) ?? null;
    }

    private getSpriteCacheKey(unitType: string): string {
        return this.normalizeLookupKey(unitType);
    }

    private getIconCacheKey(iconPath: string): string {
        return this.normalizeLookupKey(iconPath);
    }

    private getSpriteUrl(unitType: string): string | null {
        return this.spriteUrlCache.get(this.getSpriteCacheKey(unitType)) ?? null;
    }

    private setSpriteUrl(unitType: string, objectUrl: string): void {
        this.spriteUrlCache.set(this.getSpriteCacheKey(unitType), objectUrl);
    }

    private hasSpriteUrl(unitType: string): boolean {
        return this.spriteUrlCache.has(this.getSpriteCacheKey(unitType));
    }

    private async getStoredSpriteBlob(
        unitType: string,
        descriptor?: RepositoryAssetDescriptor,
    ): Promise<Blob | null> {
        const stored = storedSpriteFromUnknown(
            await this.dbGet<unknown>(SPRITES_STORE, this.getSpriteCacheKey(unitType)),
        );
        if (!stored) return null;
        return descriptor === undefined || stored.assetHash === descriptor.hash ? stored.blob : null;
    }

    /**
     * Initialize sprites on service creation.
     */
    private async initializeSprites(): Promise<void> {
        try {
            const [remoteDescriptor, storedManifestCache] = await Promise.all([
                this.fetchRemoteManifestDescriptor(),
                this.getStoredManifest(),
            ]);
            const cachedManifest = storedManifestCache
                ? this.parseManifest(storedManifestCache, 'cached')
                : null;

            if (!remoteDescriptor) {
                if (cachedManifest) {
                    this.activateManifest(cachedManifest);
                    this.logger.warn('Repository asset manifest unavailable. Using cached sprite data.');
                    await this.loadAllSpritesToCache(cachedManifest.manifest);
                    return;
                }

                return;
            }

            const manifestChanged = !cachedManifest
                || storedManifestCache?.assetHash !== remoteDescriptor.hash;
            const remoteManifestAsset = manifestChanged
                ? await this.fetchRemoteManifestText()
                : null;
            const currentManifest = manifestChanged
                ? (remoteManifestAsset
                    ? this.parseManifest(
                        createStoredSpriteManifest(
                            remoteManifestAsset.text,
                            remoteManifestAsset.descriptor.hash,
                        ),
                        'remote',
                    )
                    : null)
                : cachedManifest;
            if (!currentManifest) {
                await this.activateStoredFallback(
                    cachedManifest,
                    remoteManifestAsset
                        ? 'Sprite manifest parsing failed.'
                        : 'Sprite manifest unavailable.',
                );
                return;
            }

            let descriptors: ReadonlyMap<string, RepositoryAssetDescriptor>;
            try {
                descriptors = await this.verifySpriteAssetDescriptors(currentManifest.manifest);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                await this.activateStoredFallback(
                    cachedManifest,
                    `Sprite WebP descriptors failed repository-manifest verification: ${detail}.`,
                );
                return;
            }

            const requiredTypes = await this.spriteTypesNeedingDownload(
                currentManifest.manifest,
                descriptors,
            );
            if (requiredTypes.length > 0) {
                this.logger.info(
                    `Sprite cache requires ${requiredTypes.length} changed or missing WebP file(s). Downloading...`,
                );
            }
            const result = await this.downloadSprites(
                currentManifest.manifest,
                requiredTypes,
                descriptors,
            );

            if (result.failedTypes.length === 0) {
                await this.commitDownloadedSprites(result.blobs, currentManifest.manifest, descriptors);
                this.activateManifest(currentManifest, descriptors);
                if (manifestChanged) await this.persistManifestCache(currentManifest);
                await this.loadAllSpritesToCache(currentManifest.manifest, descriptors);
                if (manifestChanged) {
                    await this.deleteRemovedSpriteRecords(cachedManifest?.manifest, currentManifest.manifest);
                }
                return;
            }

            const failedPreview = result.failedTypes.slice(0, 5).join(', ');
            const failedSuffix = result.failedTypes.length > 5 ? '...' : '';

            if (!manifestChanged && cachedManifest) {
                // The active manifest is still authoritative. Keep every
                // successful repair and let an individual icon access retry a
                // WebP whose startup download failed.
                await this.commitDownloadedSprites(result.blobs, currentManifest.manifest, descriptors);
                this.activateManifest(currentManifest, descriptors);
                await this.loadAllSpritesToCache(currentManifest.manifest, descriptors);
                this.logger.warn(
                    `Sprite cache repair incomplete (${result.failedTypes.length} failed: ${failedPreview}${failedSuffix}).`
                );
                return;
            }

            if (cachedManifest) {
                this.logger.warn(
                    `Sprite refresh incomplete (${result.failedTypes.length} failed: ${failedPreview}${failedSuffix}). Using cached sprite data.`
                );
                this.activateManifest(cachedManifest);
                await this.loadAllSpritesToCache(cachedManifest.manifest);
                return;
            }

            this.logger.warn(
                `Sprite download incomplete (${result.failedTypes.length} failed: ${failedPreview}${failedSuffix}).`
            );
        } catch (err) {
            this.logger.error('Failed to initialize sprites: ' + err);
        } finally {
            this._loading.set(false);
        }
    }

    private async fetchRemoteManifestDescriptor(
        signal?: AbortSignal,
    ): Promise<RepositoryAssetDescriptor | null> {
        try {
            return await this.repositoryAssets.descriptor(
                UNIT_SPRITE_MANIFEST_PATH,
                signal,
            );
        } catch (error) {
            if (signal?.aborted) throw spritePreparationCancelledError();
            this.logger.warn(`Sprite manifest descriptor is unavailable: ${describeSpriteStorageError(error)}`);
            return null;
        }
    }

    private async getStoredManifest(): Promise<StoredSpriteManifest | null> {
        const stored = await this.dbGet<unknown>(SPRITES_STORE, SPRITE_MANIFEST_CACHE_KEY);
        return storedSpriteManifestFromUnknown(stored);
    }

    private async storeManifest(
        cache: StoredSpriteManifest,
    ): Promise<void> {
        await this.dbPut(SPRITES_STORE, SPRITE_MANIFEST_CACHE_KEY, cache);
        await this.dbDelete(SPRITES_STORE, LEGACY_SPRITE_MANIFEST_CACHE_KEY);
    }

    private async persistManifestCache(loaded: LoadedSpriteManifest): Promise<void> {
        await this.storeManifest(loaded.cache);
    }

    /** Get the active manifest after initialization. */
    private async getManifest(): Promise<SpriteManifest | null> {
        await this.initializationPromise;
        return this.manifest;
    }

    private async fetchRemoteManifestText(signal?: AbortSignal): Promise<{
        readonly descriptor: RepositoryAssetDescriptor;
        readonly text: string;
    } | null> {
        try {
            const asset = await this.repositoryAssets.readText(UNIT_SPRITE_MANIFEST_PATH, signal);
            return Object.freeze({ descriptor: asset.descriptor, text: asset.text });
        } catch (err) {
            if (signal?.aborted) throw spritePreparationCancelledError();
            this.logger.error('Failed to fetch sprite manifest: ' + err);
            return null;
        }
    }

    private parseManifest(
        cache: StoredSpriteManifest,
        sourceLabel: 'cached' | 'remote',
    ): LoadedSpriteManifest | null {
        try {
            const parsed: unknown = JSON.parse(cache.manifestText);
            const manifest = spriteManifestFromUnknown(parsed);
            if (!manifest?.assignments) {
                throw new Error('Unit sprite manifest types, icons, or assignments are invalid');
            }
            const assignmentContext = createUnitSpriteAssignmentContext({
                provider: MM_DATA_UNIT_PROVIDER_ID,
                manifestDigest: asUnitSpriteManifestDigest(cache.assetHash),
                assignments: manifest.assignments,
            });
            return Object.freeze({
                cache,
                manifest,
                assignmentContext,
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const message = `Rejected ${sourceLabel} sprite manifest: ${detail}`;
            if (sourceLabel === 'cached') {
                this.logger.warn(message);
            } else {
                this.logger.error(message);
            }
            return null;
        }
    }

    /**
     * Bind every URL declared by unit-icons.json to its direct authored entry
     * in assets-manifest.json. IndexedDB stores and compares those direct
     * repository hashes; the JSON's own hashes are generation metadata.
     */
    private async verifySpriteAssetDescriptors(
        manifest: SpriteManifest,
        signal?: AbortSignal,
    ): Promise<ReadonlyMap<string, RepositoryAssetDescriptor>> {
        const entries = await Promise.all(Object.entries(manifest.types).map(
            async ([unitType, typeInfo]) => {
                const descriptor = await this.repositoryAssets.descriptor(typeInfo.url, signal);
                return [this.getSpriteCacheKey(unitType), descriptor] as const;
            },
        ));
        return new Map(entries);
    }

    private async getVerifiedSpriteDescriptor(
        unitType: string,
        typeInfo: SpriteTypeInfo,
    ): Promise<RepositoryAssetDescriptor | null> {
        const cacheKey = this.getSpriteCacheKey(unitType);
        const cached = this.spriteDescriptorLookup.get(cacheKey);
        if (cached) return cached;
        try {
            const descriptor = await this.repositoryAssets.descriptor(typeInfo.url);
            this.spriteDescriptorLookup.set(cacheKey, descriptor);
            return descriptor;
        } catch (error) {
            this.logger.error(
                `Failed to verify sprite descriptor ${unitType}: ${describeSpriteStorageError(error)}`,
            );
            return null;
        }
    }

    private async activateStoredFallback(
        cachedManifest: LoadedSpriteManifest | null,
        reason: string,
    ): Promise<void> {
        if (cachedManifest) {
            this.activateManifest(cachedManifest);
            this.logger.warn(`${reason} Using cached sprite data.`);
            await this.loadAllSpritesToCache(cachedManifest.manifest);
            return;
        }
    }

    /**
     * Load all sprites from IndexedDB into memory cache.
     */
    private async loadAllSpritesToCache(
        manifest: SpriteManifest,
        descriptors: ReadonlyMap<string, RepositoryAssetDescriptor> = new Map(),
    ): Promise<void> {
        await Promise.all(Object.entries(manifest.types)
            .map(([type, typeInfo]) => this.loadSpriteToCache(
                type,
                typeInfo,
                descriptors.get(this.getSpriteCacheKey(type)),
            )));
    }

    /**
     * Resolve only exact hashes absent from the local per-type sprite rows.
     * A manifest-only assignment/coordinate change downloads no
     * WebP files, while one changed sheet downloads exactly one.
     * Uses controlled concurrency to balance speed vs server load.
     */
    private async spriteTypesNeedingDownload(
        manifest: SpriteManifest,
        descriptors: ReadonlyMap<string, RepositoryAssetDescriptor>,
    ): Promise<string[]> {
        const required: string[] = [];
        for (const [unitType, typeInfo] of Object.entries(manifest.types)) {
            const descriptor = descriptors.get(this.getSpriteCacheKey(unitType));
            if (!descriptor) throw new Error(`No authored descriptor for sprite type ${unitType}`);
            if (!await this.getStoredSpriteBlob(unitType, descriptor)) required.push(unitType);
        }
        return required;
    }

    private async downloadSprites(
        manifest: SpriteManifest,
        unitTypes: readonly string[],
        descriptors: ReadonlyMap<string, RepositoryAssetDescriptor>,
    ): Promise<SpriteDownloadResult> {
        const entries = unitTypes.map(unitType => [unitType, manifest.types[unitType]!] as const);
        const blobs = new Map<string, Blob>();
        const failedTypes: string[] = [];
        
        // Process in batches for controlled concurrency
        for (let i = 0; i < entries.length; i += DOWNLOAD_CONCURRENCY) {
            const batch = entries.slice(i, i + DOWNLOAD_CONCURRENCY);
            const results = await Promise.all(
                batch.map(async ([unitType, typeInfo]) => ({
                    unitType,
                    blob: await this.fetchSpriteBlob(
                        unitType,
                        typeInfo,
                        descriptors.get(this.getSpriteCacheKey(unitType)),
                    )
                }))
            );

            for (const result of results) {
                if (result.blob) {
                    blobs.set(result.unitType, result.blob);
                } else {
                    failedTypes.push(result.unitType);
                }
            }
        }

        return { blobs, failedTypes };
    }

    /**
     * Fetch a single sprite sheet.
     */
    private async fetchSpriteBlob(
        unitType: string,
        typeInfo: SpriteTypeInfo,
        descriptor?: RepositoryAssetDescriptor,
    ): Promise<Blob | null> {
        try {
            descriptor = descriptor ?? await this.getVerifiedSpriteDescriptor(unitType, typeInfo) ?? undefined;
            if (!descriptor) return null;
            const asset = await this.repositoryAssets.read(typeInfo.url);
            if (asset.descriptor.hash !== descriptor.hash) {
                throw new Error('fetched descriptor changed during sprite download');
            }
            return new Blob([asset.bytes], { type: 'image/webp' });
        } catch (err) {
            this.logger.error(`Failed to download sprite ${unitType}: ${err}`);
            return null;
        }
    }

    /**
     * Commit fetched sprite sheets to memory cache and, when available, IndexedDB.
     */
    private async commitDownloadedSprites(
        blobs: Map<string, Blob>,
        manifest: SpriteManifest,
        descriptors: ReadonlyMap<string, RepositoryAssetDescriptor>,
        persistToDb = true,
    ): Promise<void> {
        for (const [unitType, blob] of blobs) {
            const spriteCacheKey = this.getSpriteCacheKey(unitType);
            const typeInfo = manifest.types[unitType];
            if (!typeInfo) throw new Error(`Downloaded sprite ${unitType} is absent from its manifest`);
            const descriptor = descriptors.get(spriteCacheKey);
            if (!descriptor) throw new Error(`Downloaded sprite ${unitType} has no asset descriptor`);

            if (persistToDb) {
                await this.dbPut(
                    SPRITES_STORE,
                    spriteCacheKey,
                    createStoredSprite(blob, descriptor.hash),
                );
            }

            const oldUrl = this.spriteUrlCache.get(spriteCacheKey);
            if (oldUrl) {
                URL.revokeObjectURL(oldUrl);
            }

            const objectUrl = URL.createObjectURL(blob);
            this.spriteUrlCache.set(spriteCacheKey, objectUrl);
            this.logger.info(`Downloaded sprite: ${unitType} (${(blob.size / 1024).toFixed(1)} KB)`);
        }
    }

    /**
     * Load a sprite from IndexedDB into memory cache.
     */
    private async loadSpriteToCache(
        unitType: string,
        typeInfo: SpriteTypeInfo,
        descriptor?: RepositoryAssetDescriptor,
    ): Promise<void> {
        if (this.hasSpriteUrl(unitType)) return;

        const blob = await this.getStoredSpriteBlob(unitType, descriptor);
        if (blob) {
            this.setSpriteUrl(unitType, URL.createObjectURL(blob));
        }
    }

    private async deleteRemovedSpriteRecords(
        previous: SpriteManifest | undefined,
        current: SpriteManifest,
    ): Promise<void> {
        if (!previous) return;
        const currentTypes = new Set(Object.keys(current.types).map(type => this.getSpriteCacheKey(type)));
        await Promise.all(Object.keys(previous.types).map(async unitType => {
            const key = this.getSpriteCacheKey(unitType);
            if (!currentTypes.has(key)) await this.dbDelete(SPRITES_STORE, key);
        }));
    }

    /**
     * Get the sprite URL and position for an icon.
     * Returns null if the icon is not found.
     */
    public async getSpriteInfo(iconPath: string): Promise<{ url: string; info: SpriteIconInfo } | null> {
        const manifest = await this.getManifest();
        if (!manifest) return null;

        const iconInfo = this.getIconInfo(iconPath);
        if (!iconInfo) return null;

        const url = await this.ensureSpriteAvailable(iconInfo.type, this.getTypeInfo(iconInfo.type) ?? undefined);
        if (!url) return null;

        return { url, info: iconInfo };
    }

    /**
     * Ensure a sprite sheet is available either from IndexedDB or a direct download.
     */
    private async ensureSpriteAvailable(unitType: string, typeInfo: SpriteTypeInfo | undefined): Promise<string | null> {
        let descriptor = typeInfo
            ? this.spriteDescriptorLookup.get(this.getSpriteCacheKey(unitType))
            : undefined;
        if (!this.hasSpriteUrl(unitType)) {
            if (typeInfo) await this.loadSpriteToCache(unitType, typeInfo, descriptor);
        }

        let url = this.getSpriteUrl(unitType);
        if (url || !typeInfo) {
            return url;
        }

        const blob = await this.fetchSpriteBlob(unitType, typeInfo, descriptor);
        if (!blob) {
            return null;
        }
        descriptor ??= this.spriteDescriptorLookup.get(this.getSpriteCacheKey(unitType));
        if (!descriptor) return null;

        await this.commitDownloadedSprites(
            new Map([[unitType, blob]]),
            { types: { [unitType]: typeInfo }, icons: {} },
            new Map([[this.getSpriteCacheKey(unitType), descriptor]]),
        );
        url = this.getSpriteUrl(unitType);
        return url;
    }

    /**
     * Get cached sprite info synchronously.
     * Returns null if not yet loaded.
     */
    public getCachedSpriteInfo(iconPath: string): { url: string; info: SpriteIconInfo } | null {
        if (!this.manifest) return null;

        const iconInfo = this.getIconInfo(iconPath);
        if (!iconInfo) return null;

        const url = this.getSpriteUrl(iconInfo.type);
        if (!url) return null;

        return { url, info: iconInfo };
    }

    // Cache for loaded HTMLImageElement objects (for canvas extraction)
    private spriteImageCache = new Map<string, HTMLImageElement>();
    // Cache for extracted individual icon data URLs
    private extractedIconCache = new Map<string, string>();

    /**
     * Extract a single icon from the sprite sheet as a data URL.
     * Used for Safari-compatible SVG rendering where we need individual images.
     * Results are cached, so extraction only happens once per icon path.
     */
    public async getExtractedIconUrl(iconPath: string): Promise<string | null> {
        const iconCacheKey = this.getIconCacheKey(iconPath);

        // Check cache first
        if (this.extractedIconCache.has(iconCacheKey)) {
            return this.extractedIconCache.get(iconCacheKey)!;
        }

        const spriteInfo = await this.getSpriteInfo(iconPath);
        if (!spriteInfo) return null;

        const { url, info } = spriteInfo;
        const spriteCacheKey = this.getSpriteCacheKey(info.type);

        try {
            // Get or load the sprite image (cached per sprite type)
            let img = this.spriteImageCache.get(spriteCacheKey);
            if (!img) {
                img = await this.loadImage(url);
                this.spriteImageCache.set(spriteCacheKey, img);
            }

            // Extract the icon portion using canvas
            const canvas = document.createElement('canvas');
            canvas.width = info.w;
            canvas.height = info.h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.drawImage(img, info.x, info.y, info.w, info.h, 0, 0, info.w, info.h);
            const dataUrl = canvas.toDataURL('image/png');

            // Cache the result
            this.extractedIconCache.set(iconCacheKey, dataUrl);
            return dataUrl;
        } catch (e) {
            this.logger.error(`Failed to extract icon: ${iconPath} - ${e}`);
            return null;
        }
    }

    private loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    /**
     * Get the count of icons in the manifest.
     */
    public async getIconCount(): Promise<number> {
        const manifest = await this.getManifest();
        return manifest ? Object.keys(manifest.icons).length : 0;
    }

    /**
     * Return the active parsed assignments under an explicit provider ID.
     */
    public async getVerifiedAssignmentContext(
        provider: UnitProviderId,
    ): Promise<UnitSpriteAssignmentContext | null> {
        await this.initializationPromise;
        if (!this.activeManifestCache) return null;

        const canonicalProvider = asUnitProviderId(provider);
        const cached = this.assignmentContexts.get(canonicalProvider);
        if (cached) return cached;

        try {
            const unitSpriteAssignmentContext = this.assignmentContexts.get(MM_DATA_UNIT_PROVIDER_ID);
            if (!unitSpriteAssignmentContext) return null;
            const context = createUnitSpriteAssignmentContext({
                provider: canonicalProvider,
                manifestDigest: unitSpriteAssignmentContext.manifestDigest,
                assignments: unitSpriteAssignmentContext.assignments,
            });
            this.assignmentContexts.set(canonicalProvider, context);
            return context;
        } catch (error) {
            this.logger.error(
                'Failed to bind verified sprite assignments to provider: '
                + (error instanceof Error ? error.message : String(error))
            );
            return null;
        }
    }

    /** Prepare assignment state from an already-verified dependency bundle. */
    public async prepareCachedAssignmentManifest(): Promise<PreparedUnitSpriteManifest | undefined> {
        const stored = await this.getStoredManifest();
        const loaded = stored ? this.parseManifest(stored, 'cached') : null;
        return loaded ? this.toPreparedManifest(loaded) : undefined;
    }

    public prepareBundledAssignmentManifest(
        evidence: UnitSpriteManifestEvidence,
        assetHash: string = evidence.manifestDigest,
    ): PreparedUnitSpriteManifest {
        const loaded = this.parseManifest(
            createStoredSpriteManifest(
                evidence.manifestText,
                assetHash,
            ),
            'cached',
        );
        if (!loaded) throw new Error('Bundled sprite manifest is invalid');
        return this.toPreparedManifest(loaded);
    }

    public async prepareRemoteAssignmentManifest(
        previous?: PreparedUnitSpriteManifest,
        signal?: AbortSignal,
    ): Promise<PreparedUnitSpriteManifest> {
        const descriptor = await this.repositoryAssets.descriptor(UNIT_SPRITE_MANIFEST_PATH, signal);
        if (previous?.assetHash === descriptor.hash) return previous;
        const asset = await this.repositoryAssets.readText(UNIT_SPRITE_MANIFEST_PATH, signal);
        const loaded = this.parseManifest(
            createStoredSpriteManifest(asset.text, asset.descriptor.hash),
            'remote',
        );
        if (!loaded) throw new Error('Repository sprite manifest is invalid');
        return this.toPreparedManifest(loaded);
    }

    /** Assignment-only commit used by the atomic application catalog switch. */
    public commitPreparedAssignmentManifest(candidate: PreparedUnitSpriteManifest): void {
        this.manifest = candidate.manifest;
        this.typeLookup = candidate.typeLookup;
        this.iconLookup = candidate.iconLookup;
        this.spriteDescriptorLookup.clear();
        this.activeManifestCache = createStoredSpriteManifest(
            candidate.evidence.manifestText,
            candidate.assetHash,
        );
        this.assignmentContexts = new Map([
            [MM_DATA_UNIT_PROVIDER_ID, candidate.assignmentContext],
        ]);
    }

    public async persistPreparedAssignmentManifest(candidate: PreparedUnitSpriteManifest): Promise<void> {
        await this.storeManifest(createStoredSpriteManifest(
            candidate.evidence.manifestText,
            candidate.assetHash,
        ));
    }

    private toPreparedManifest(loaded: LoadedSpriteManifest): PreparedUnitSpriteManifest {
        const lookups = this.buildManifestLookups(loaded.manifest);
        return Object.freeze({
            assetHash: loaded.cache.assetHash,
            evidence: Object.freeze({
                manifestDigest: loaded.assignmentContext.manifestDigest,
                manifestText: loaded.cache.manifestText,
            }),
            manifest: loaded.manifest,
            assignmentContext: loaded.assignmentContext,
            typeLookup: lookups.typeLookup,
            iconLookup: lookups.iconLookup,
        });
    }

    private buildManifestLookups(manifest: SpriteManifest | null): {
        readonly typeLookup: ReadonlyMap<string, SpriteTypeInfo>;
        readonly iconLookup: ReadonlyMap<string, SpriteIconInfo>;
    } {
        const typeLookup = new Map<string, SpriteTypeInfo>();
        const iconLookup = new Map<string, SpriteIconInfo>();
        if (manifest) {
            for (const [unitType, typeInfo] of Object.entries(manifest.types)) {
                typeLookup.set(this.normalizeLookupKey(unitType), typeInfo);
            }
            for (const [iconPath, iconInfo] of Object.entries(manifest.icons)) {
                iconLookup.set(this.normalizeLookupKey(iconPath), iconInfo);
            }
        }
        return Object.freeze({ typeLookup, iconLookup });
    }

    /**
     * Reinitialize sprites (re-download if needed).
     */
    public async reinitialize(): Promise<void> {
        await this.initializationPromise;
        this._loading.set(true);
        
        // Revoke all existing object URLs to prevent memory leaks
        for (const url of this.spriteUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.spriteUrlCache.clear();
        this.spriteImageCache.clear();
        this.extractedIconCache.clear();
        this.clearActiveManifest();
        
        this.initializationPromise = this.initializeSprites();
        await this.initializationPromise;
    }

    /**
     * Clear the complete sprite cache.
     */
    public async clearSpritesStore(): Promise<void> {
        await this.initializationPromise;
        // Revoke all object URLs
        for (const url of this.spriteUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.spriteUrlCache.clear();
        this.spriteImageCache.clear();
        this.extractedIconCache.clear();

        this.clearActiveManifest();

        await this.dbClear(SPRITES_STORE);
    }
}

function spritePreparationCancelledError(): DOMException {
    return new DOMException('Sprite manifest preparation was cancelled', 'AbortError');
}

function createStoredSprite(blob: Blob, assetHash: string): StoredSprite {
    if (!isRepositoryAssetHash(assetHash)) {
        throw new Error(`Invalid stored sprite asset hash: ${assetHash}`);
    }
    return Object.freeze({ blob, size: blob.size, assetHash });
}

function storedSpriteFromUnknown(value: unknown): StoredSprite | null {
    if (!isPlainRecord(value)
        || !(value['blob'] instanceof Blob)
        || typeof value['size'] !== 'number'
        || !Number.isSafeInteger(value['size'])
        || value['size'] < 0
        || value['size'] !== value['blob'].size
        || !isRepositoryAssetHash(value['assetHash'])) {
        return null;
    }
    return createStoredSprite(value['blob'], value['assetHash']);
}

function createStoredSpriteManifest(
    manifestText: string,
    assetHash: string,
): StoredSpriteManifest {
    if (!isRepositoryAssetHash(assetHash)) {
        throw new Error(`Invalid unit-icons.json asset hash: ${assetHash}`);
    }
    return Object.freeze({
        schemaVersion: SPRITE_MANIFEST_CACHE_SCHEMA_VERSION,
        manifestPath: UNIT_SPRITE_MANIFEST_PATH,
        assetHash,
        manifestText,
    });
}

function storedSpriteManifestFromUnknown(
    value: unknown,
): StoredSpriteManifest | null {
    if (!isPlainRecord(value)
        || value['schemaVersion'] !== SPRITE_MANIFEST_CACHE_SCHEMA_VERSION
        || value['manifestPath'] !== UNIT_SPRITE_MANIFEST_PATH
        || !isRepositoryAssetHash(value['assetHash'])
        || typeof value['manifestText'] !== 'string') {
        return null;
    }
    return createStoredSpriteManifest(value['manifestText'], value['assetHash']);
}

function spriteManifestFromUnknown(
    value: unknown,
): SpriteManifest | null {
    if (!isPlainRecord(value)
        || !isPlainRecord(value['types'])
        || !isPlainRecord(value['icons'])
        || !isPlainRecord(value['assignments'])) {
        return null;
    }

    const exact = spriteAssignmentMapFromUnknown(value['assignments']['exact']);
    const chassis = spriteAssignmentMapFromUnknown(value['assignments']['chassis']);
    if (!exact || !chassis) return null;

    const types: Record<string, SpriteTypeInfo> = {};
    for (const [unitType, candidate] of Object.entries(value['types'])) {
        if (unitType.length === 0
            || !isPlainRecord(candidate)
            || !isSafeRelativeSpriteUrl(candidate['url'])
            || !isSpriteContentHash(candidate['hash'])
            || !candidate['url'].endsWith(`.${candidate['hash'].slice(0, 16)}.webp`)
            || !isPositiveInteger(candidate['width'])
            || !isPositiveInteger(candidate['height'])) {
            return null;
        }
        types[unitType] = Object.freeze({
            url: candidate['url'],
            width: candidate['width'],
            height: candidate['height'],
            hash: candidate['hash'],
        });
    }

    const availableTypes = new Set(Object.keys(types).map(key => key.toLowerCase()));
    const icons: Record<string, SpriteIconInfo> = {};
    for (const [iconPath, candidate] of Object.entries(value['icons'])) {
        if (iconPath.length === 0
            || !isPlainRecord(candidate)
            || typeof candidate['type'] !== 'string'
            || !availableTypes.has(candidate['type'].toLowerCase())
            || !isNonNegativeInteger(candidate['x'])
            || !isNonNegativeInteger(candidate['y'])
            || !isPositiveInteger(candidate['w'])
            || !isPositiveInteger(candidate['h'])) {
            return null;
        }
        icons[iconPath] = Object.freeze({
            type: candidate['type'],
            x: candidate['x'],
            y: candidate['y'],
            w: candidate['w'],
            h: candidate['h'],
        });
    }

    return Object.freeze({
        types: Object.freeze(types),
        icons: Object.freeze(icons),
        assignments: Object.freeze({ exact, chassis }),
    });
}

function spriteAssignmentMapFromUnknown(value: unknown): Readonly<Record<string, string>> | null {
    if (!isPlainRecord(value)) return null;
    const output: Record<string, string> = {};
    for (const [key, path] of Object.entries(value)) {
        if (typeof path !== 'string') return null;
        output[key] = path;
    }
    return Object.freeze(output);
}

function isSafeRelativeSpriteUrl(value: unknown): value is string {
    if (typeof value !== 'string'
        || !value.startsWith('online-assets/generated/sprites/')
        || value.includes('\\')
        || value.includes('?')
        || value.includes('#')) {
        return false;
    }
    return value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isSpriteContentHash(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isRepositoryAssetHash(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{27}$/u.test(value);
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
