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

@Injectable({
    providedIn: 'root'
})
export class SpriteStorageService {
    private dbPromise!: Promise<IDBDatabase>;
    private http = inject(HttpClient);
    private logger = inject(LoggerService);

    // Loading state - starts true until sprites are ready
    private _loading = signal<boolean>(true);
    public loading = this._loading.asReadonly();

    // In-memory cache for sprite sheet object URLs
    private spriteUrlCache = new Map<string, string>();

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

    private initIndexedDb(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
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
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IndexedDB Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private async dbGet<T>(store: string, key: string): Promise<T | null> {
        const db = await this.dbPromise;
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const request = tx.objectStore(store).get(key);
            request.onsuccess = () => resolve((request.result as T) || null);
            request.onerror = () => resolve(null);
        });
    }

    private async dbPut(store: string, key: string, value: unknown): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    private async dbClear(store: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const request = tx.objectStore(store).clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Initialize sprites on service creation.
     */
    private async initializeSprites(): Promise<void> {
        try {
            // 1. Fetch remote hash and local hash in parallel
            const [remoteHash, localHash] = await Promise.all([
                this.fetchRemoteHash(),
                this.getStoredHash()
            ]);

            const manifest = await this.getManifest();
            if (!manifest) return;

            // 2. If hashes match, just load from IndexedDB
            if (remoteHash && remoteHash === localHash) {
                this.logger.info('Sprites cache is up to date.');
                await this.loadAllSpritesToCache(manifest);
                return;
            }

            // 3. Hash mismatch or no cache - download everything
            this.logger.info('Sprites cache outdated or empty. Downloading...');
            await this.downloadAllSprites(manifest);

            // 4. Store the new hash
            if (remoteHash) {
                await this.storeHash(remoteHash);
            }
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
     * Store hash in IndexedDB.
     */
    private storeHash(hash: string): Promise<void> {
        return this.dbPut(METADATA_STORE, 'sprites_hash', hash);
    }

    /**
     * Get the sprite manifest. Fetches and caches it on first call.
     */
    public async getManifest(): Promise<SpriteManifest | null> {
        if (this.manifest) return this.manifest;
        if (this.manifestPromise) return this.manifestPromise;

        this.manifestPromise = this.fetchManifest();
        this.manifest = await this.manifestPromise;
        return this.manifest;
    }

    private async fetchManifest(): Promise<SpriteManifest | null> {
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
    private async downloadAllSprites(manifest: SpriteManifest): Promise<void> {
        const entries = Object.entries(manifest.types);
        
        // Process in batches for controlled concurrency
        for (let i = 0; i < entries.length; i += DOWNLOAD_CONCURRENCY) {
            const batch = entries.slice(i, i + DOWNLOAD_CONCURRENCY);
            await Promise.all(
                batch.map(([unitType, typeInfo]) => this.downloadSprite(unitType, typeInfo.url))
            );
        }
    }

    /**
     * Download a single sprite sheet and store it.
     */
    private async downloadSprite(unitType: string, url: string): Promise<void> {
        try {
            const blob = await firstValueFrom(
                this.http.get(url, { responseType: 'blob' })
            );

            if (!blob) return;

            await this.dbPut(SPRITES_STORE, unitType, blob);

            // Revoke old URL if exists
            const oldUrl = this.spriteUrlCache.get(unitType);
            if (oldUrl) {
                URL.revokeObjectURL(oldUrl);
            }

            // Add to memory cache
            const objectUrl = URL.createObjectURL(blob);
            this.spriteUrlCache.set(unitType, objectUrl);

            this.logger.info(`Downloaded sprite: ${unitType} (${(blob.size / 1024).toFixed(1)} KB)`);
        } catch (err) {
            this.logger.error(`Failed to download sprite ${unitType}: ${err}`);
        }
    }

    /**
     * Load a sprite from IndexedDB into memory cache.
     */
    private async loadSpriteToCache(unitType: string): Promise<void> {
        if (this.spriteUrlCache.has(unitType)) return;

        const blob = await this.dbGet<Blob>(SPRITES_STORE, unitType);
        if (blob) {
            this.spriteUrlCache.set(unitType, URL.createObjectURL(blob));
        }
    }

    /**
     * Get the sprite URL and position for an icon.
     * Returns null if the icon is not found.
     */
    public async getSpriteInfo(iconPath: string): Promise<{ url: string; info: SpriteIconInfo } | null> {
        const manifest = await this.getManifest();
        if (!manifest) return null;

        const iconInfo = manifest.icons[iconPath];
        if (!iconInfo) return null;

        // Ensure sprite is loaded
        if (!this.spriteUrlCache.has(iconInfo.type)) {
            await this.loadSpriteToCache(iconInfo.type);
        }

        const url = this.spriteUrlCache.get(iconInfo.type);
        if (!url) return null;

        return { url, info: iconInfo };
    }

    /**
     * Get cached sprite info synchronously.
     * Returns null if not yet loaded.
     */
    public getCachedSpriteInfo(iconPath: string): { url: string; info: SpriteIconInfo } | null {
        if (!this.manifest) return null;

        const iconInfo = this.manifest.icons[iconPath];
        if (!iconInfo) return null;

        const url = this.spriteUrlCache.get(iconInfo.type);
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
        // Check cache first
        if (this.extractedIconCache.has(iconPath)) {
            return this.extractedIconCache.get(iconPath)!;
        }

        const spriteInfo = await this.getSpriteInfo(iconPath);
        if (!spriteInfo) return null;

        const { url, info } = spriteInfo;

        try {
            // Get or load the sprite image (cached per sprite type)
            let img = this.spriteImageCache.get(info.type);
            if (!img) {
                img = await this.loadImage(url);
                this.spriteImageCache.set(info.type, img);
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
            this.extractedIconCache.set(iconPath, dataUrl);
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

        this.manifest = null;
        this.manifestPromise = null;

        await Promise.all([
            this.dbClear(SPRITES_STORE),
            this.dbClear(METADATA_STORE)
        ]);
    }
}
