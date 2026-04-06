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

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from './logger.service';

/*
 * Author: Drake
 */

const SPRITES_DISABLED = false;
const DOWNLOAD_CONCURRENCY = 3;
const DB_NAME = 'mekbay-sprites';
const DB_VERSION = 1;
const SPRITES_STORE = 'sprites';
const METADATA_STORE = 'metadata';
const MANIFEST_KEY = 'sprites_manifest';

/** Sprite position info for a single icon */
export interface SpriteIconInfo {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Sprite sheet metadata for a unit type */
export interface SpriteTypeInfo {
    url: string;
    width: number;
    height: number;
}

/** The full manifest structure from unit-icons.json */
export interface SpriteManifest {
    types: { [unitType: string]: SpriteTypeInfo };
    icons: { [iconPath: string]: SpriteIconInfo };
}

interface SpriteDownloadResult {
    blobs: Map<string, Blob>;
    failedTypes: string[];
}

@Injectable({
    providedIn: 'root'
})
export class SpriteStorageService {
    private dbPromise!: Promise<IDBDatabase | null>;
    private http = inject(HttpClient);
    private logger = inject(LoggerService);

    // Loading state - starts true until sprites are ready
    private _loading = signal<boolean>(true);
    public loading = this._loading.asReadonly();

    // In-memory cache for sprite sheet object URLs
    private spriteUrlCache = new Map<string, string>();
    private typeLookup = new Map<string, SpriteTypeInfo>();
    private iconLookup = new Map<string, SpriteIconInfo>();

    // Manifest data (loaded once)
    private manifest: SpriteManifest | null = null;
    private manifestPromise: Promise<SpriteManifest | null> | null = null;

    constructor() {
        if (SPRITES_DISABLED) {
            this._loading.set(false);
            return;
        }
        this.dbPromise = this.initIndexedDb();
        this.initializeSprites();
    }

    private initIndexedDb(): Promise<IDBDatabase | null> {
        return new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') {
                this.logger.warn('IndexedDB unavailable; sprite cache will run in memory only.');
                resolve(null);
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (!db.objectStoreNames.contains(SPRITES_STORE)) {
                    db.createObjectStore(SPRITES_STORE);
                }

                if (!db.objectStoreNames.contains(METADATA_STORE)) {
                    db.createObjectStore(METADATA_STORE);
                }
            };

            request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
            request.onerror = (event) => {
                this.logger.error('SpriteStorage DB Error: ' + (event.target as IDBOpenDBRequest).error);
                resolve(null);
            };
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

    private resetManifestLookups(): void {
        this.typeLookup.clear();
        this.iconLookup.clear();
    }

    private setManifest(manifest: SpriteManifest | null): void {
        this.manifest = manifest;
        this.resetManifestLookups();

        if (!manifest) {
            return;
        }

        for (const [unitType, typeInfo] of Object.entries(manifest.types)) {
            this.typeLookup.set(this.normalizeLookupKey(unitType), typeInfo);
        }

        for (const [iconPath, iconInfo] of Object.entries(manifest.icons)) {
            this.iconLookup.set(this.normalizeLookupKey(iconPath), iconInfo);
        }
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

    private async getStoredSpriteBlob(unitType: string): Promise<Blob | null> {
        const normalizedUnitType = this.getSpriteCacheKey(unitType);
        const normalizedBlob = await this.dbGet<Blob>(SPRITES_STORE, normalizedUnitType);
        if (normalizedBlob) {
            return normalizedBlob;
        }

        if (normalizedUnitType !== unitType) {
            return this.dbGet<Blob>(SPRITES_STORE, unitType);
        }

        return null;
    }

    /**
     * Initialize sprites on service creation.
     */
    private async initializeSprites(): Promise<void> {
        try {
            const [remoteHash, localHash, storedManifest] = await Promise.all([
                this.fetchRemoteHash(),
                this.getStoredHash(),
                this.getStoredManifest()
            ]);

            if (remoteHash && remoteHash === localHash && storedManifest) {
                this.setManifest(storedManifest);
                this.logger.info('Sprites cache is up to date.');
                await this.loadAllSpritesToCache(storedManifest);
                return;
            }

            if (!remoteHash && storedManifest) {
                this.setManifest(storedManifest);
                this.logger.warn('Sprite hash unavailable. Using cached sprite data.');
                await this.loadAllSpritesToCache(storedManifest);
                return;
            }

            const remoteManifest = await this.fetchRemoteManifest();
            if (!remoteManifest) {
                if (storedManifest) {
                    this.setManifest(storedManifest);
                    this.logger.warn('Sprite manifest unavailable. Using cached sprite data.');
                    await this.loadAllSpritesToCache(storedManifest);
                }
                return;
            }

            this.setManifest(remoteManifest);

            if (remoteHash && remoteHash === localHash) {
                this.logger.info('Sprites cache is up to date.');
                if (!storedManifest) {
                    await this.storeManifest(remoteManifest);
                }
                await this.loadAllSpritesToCache(remoteManifest);
                return;
            }

            this.logger.info(storedManifest ? 'Sprites cache outdated. Downloading...' : 'Sprites cache empty or unavailable. Downloading...');
            const result = await this.downloadAllSprites(remoteManifest);

            if (result.failedTypes.length === 0) {
                await this.commitDownloadedSprites(result.blobs);
                await this.storeManifest(remoteManifest);

                if (remoteHash) {
                    await this.storeHash(remoteHash);
                }
                return;
            }

            const failedPreview = result.failedTypes.slice(0, 5).join(', ');
            const failedSuffix = result.failedTypes.length > 5 ? '...' : '';

            if (storedManifest) {
                this.logger.warn(
                    `Sprite refresh incomplete (${result.failedTypes.length} failed: ${failedPreview}${failedSuffix}). Using cached sprite data.`
                );
                this.manifest = storedManifest;
                await this.loadAllSpritesToCache(storedManifest);
                return;
            }

            this.logger.warn(
                `Sprite download incomplete (${result.failedTypes.length} failed: ${failedPreview}${failedSuffix}). Using partial in-memory sprite data.`
            );
            await this.commitDownloadedSprites(result.blobs, false);
        } catch (err) {
            this.logger.error('Failed to initialize sprites: ' + err);
        } finally {
            this._loading.set(false);
        }
    }

    /**
     * Fetch the remote hash file.
     */
    private async fetchRemoteHash(): Promise<string | null> {
        try {
            const hash = await firstValueFrom(
                this.http.get('sprites/unit-icons.hash', { responseType: 'text' })
            );
            return hash?.trim() || null;
        } catch {
            return null;
        }
    }

    /**
     * Get stored hash from IndexedDB.
     */
    private getStoredHash(): Promise<string | null> {
        return this.dbGet<string>(METADATA_STORE, 'sprites_hash');
    }

    /**
     * Get stored manifest from IndexedDB.
     */
    private getStoredManifest(): Promise<SpriteManifest | null> {
        return this.dbGet<SpriteManifest>(METADATA_STORE, MANIFEST_KEY);
    }

    /**
     * Store hash in IndexedDB.
     */
    private storeHash(hash: string): Promise<void> {
        return this.dbPut(METADATA_STORE, 'sprites_hash', hash);
    }

    /**
     * Store manifest in IndexedDB.
     */
    private storeManifest(manifest: SpriteManifest): Promise<void> {
        return this.dbPut(METADATA_STORE, MANIFEST_KEY, manifest);
    }

    /**
     * Get the sprite manifest. Fetches and caches it on first call.
     */
    public async getManifest(): Promise<SpriteManifest | null> {
        if (this.manifest) return this.manifest;

        if (!this.manifestPromise) {
            this.manifestPromise = this.fetchManifestWithFallback();
        }

        const manifest = await this.manifestPromise;
        this.setManifest(manifest);

        if (!manifest) {
            this.manifestPromise = null;
        }

        return this.manifest;
    }

    private async fetchManifestWithFallback(): Promise<SpriteManifest | null> {
        const remoteManifest = await this.fetchRemoteManifest();
        if (remoteManifest) {
            return remoteManifest;
        }

        return this.getStoredManifest();
    }

    private async fetchRemoteManifest(): Promise<SpriteManifest | null> {
        try {
            const manifest = await firstValueFrom(
                this.http.get<SpriteManifest>('sprites/unit-icons.json')
            );
            return manifest;
        } catch (err) {
            this.logger.error('Failed to fetch sprite manifest: ' + err);
            return null;
        }
    }

    /**
     * Load all sprites from IndexedDB into memory cache.
     */
    private async loadAllSpritesToCache(manifest: SpriteManifest): Promise<void> {
        const types = Object.keys(manifest.types);
        await Promise.all(types.map(type => this.loadSpriteToCache(type)));
    }

    /**
     * Download all sprite sheets and store in IndexedDB.
     * Uses controlled concurrency to balance speed vs server load.
     */
    private async downloadAllSprites(manifest: SpriteManifest): Promise<SpriteDownloadResult> {
        const entries = Object.entries(manifest.types);
        const blobs = new Map<string, Blob>();
        const failedTypes: string[] = [];
        
        // Process in batches for controlled concurrency
        for (let i = 0; i < entries.length; i += DOWNLOAD_CONCURRENCY) {
            const batch = entries.slice(i, i + DOWNLOAD_CONCURRENCY);
            const results = await Promise.all(
                batch.map(async ([unitType, typeInfo]) => ({
                    unitType,
                    blob: await this.fetchSpriteBlob(unitType, typeInfo.url)
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
    private async fetchSpriteBlob(unitType: string, url: string): Promise<Blob | null> {
        try {
            const blob = await firstValueFrom(
                this.http.get(url, { responseType: 'blob' })
            );

            return blob ?? null;
        } catch (err) {
            this.logger.error(`Failed to download sprite ${unitType}: ${err}`);
            return null;
        }
    }

    /**
     * Commit fetched sprite sheets to memory cache and, when available, IndexedDB.
     */
    private async commitDownloadedSprites(blobs: Map<string, Blob>, persistToDb = true): Promise<void> {
        for (const [unitType, blob] of blobs) {
            const spriteCacheKey = this.getSpriteCacheKey(unitType);

            if (persistToDb) {
                await this.dbPut(SPRITES_STORE, spriteCacheKey, blob);
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
    private async loadSpriteToCache(unitType: string): Promise<void> {
        if (this.hasSpriteUrl(unitType)) return;

        const blob = await this.getStoredSpriteBlob(unitType);
        if (blob) {
            this.setSpriteUrl(unitType, URL.createObjectURL(blob));
        }
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
        if (!this.hasSpriteUrl(unitType)) {
            await this.loadSpriteToCache(unitType);
        }

        let url = this.getSpriteUrl(unitType);
        if (url || !typeInfo) {
            return url;
        }

        const blob = await this.fetchSpriteBlob(unitType, typeInfo.url);
        if (!blob) {
            return null;
        }

        await this.commitDownloadedSprites(new Map([[unitType, blob]]));
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
     * Reinitialize sprites (re-download if needed).
     */
    public async reinitialize(): Promise<void> {
        this._loading.set(true);
        
        // Revoke all existing object URLs to prevent memory leaks
        for (const url of this.spriteUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.spriteUrlCache.clear();
        this.spriteImageCache.clear();
        this.extractedIconCache.clear();
        this.setManifest(null);
        this.manifestPromise = null;
        
        await this.initializeSprites();
    }

    /**
     * Clear all stored sprites and metadata.
     */
    public async clearSpritesStore(): Promise<void> {
        // Revoke all object URLs
        for (const url of this.spriteUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.spriteUrlCache.clear();
        this.spriteImageCache.clear();
        this.extractedIconCache.clear();

        this.setManifest(null);
        this.manifestPromise = null;

        await Promise.all([
            this.dbClear(SPRITES_STORE),
            this.dbClear(METADATA_STORE)
        ]);
    }
}
