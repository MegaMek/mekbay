// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject, signal, type OnDestroy } from '@angular/core';
import type { PortraitManifest, PortraitSheet } from '../models/portrait.model';
import { CatalogBaseService } from './catalogs/catalog-base.service';
import { CatalogStorage } from './catalogs/catalog-storage.service';
import { RepositoryAssetManifestService } from './catalogs/repository-asset-manifest.service';

interface StoredPortraitCatalog {
    readonly assetHash: string;
    readonly manifest: PortraitManifest;
}

/** Lazy portrait catalog and sheets share the existing IndexedDB asset catalog. */
@Injectable({ providedIn: 'root' })
export class PortraitService extends CatalogBaseService<StoredPortraitCatalog, StoredPortraitCatalog, PortraitManifest> implements OnDestroy {
    private readonly storage = inject(CatalogStorage);
    private readonly assets = inject(RepositoryAssetManifestService);
    private readonly catalog = signal<PortraitManifest | null>(null);
    private readonly sheetUrls = signal<ReadonlyMap<string, string>>(new Map());
    private readonly sheetLoads = new Map<string, Promise<string>>();
    readonly manifest = this.catalog.asReadonly();

    protected override get catalogKey(): string { return 'portraits'; }
    protected override get remoteUrl(): string { return 'online-assets/generated/portraits/portraits.json'; }
    protected override get repositoryAssetPath(): string { return this.remoteUrl; }
    protected override hasHydratedData(): boolean { return this.catalog() !== null; }
    protected override getDatasetSize(data: StoredPortraitCatalog): number { return Object.keys(data.manifest.portraits).length; }

    protected override hydrate(data: StoredPortraitCatalog): void {
        this.catalog.set(data.manifest);
        this.transportRevision = data.assetHash;
    }

    protected override normalizeFetchedData(manifest: PortraitManifest, assetHash: string): StoredPortraitCatalog {
        return { assetHash, manifest };
    }

    sheetUrl(sheet: PortraitSheet): string | undefined { return this.sheetUrls().get(sheet.url); }

    async loadPortrait(name: string): Promise<void> {
        await this.initialize();
        const manifest = this.catalog();
        const portrait = manifest && Object.hasOwn(manifest.portraits, name) ? manifest.portraits[name] : undefined;
        if (portrait) await this.loadSheet(portrait.sheet);
    }

    loadSheet(id: string): Promise<string> {
        const sheet = this.catalog()?.sheets[id];
        if (!sheet) return Promise.reject(new Error(`Unknown portrait sheet: ${id}`));
        const pending = this.sheetLoads.get(sheet.url);
        if (pending) return pending;
        const load = this.readSheet(id, sheet);
        this.sheetLoads.set(sheet.url, load);
        void load.catch(() => this.sheetLoads.delete(sheet.url));
        return load;
    }

    private async readSheet(id: string, sheet: PortraitSheet): Promise<string> {
        const key = `portrait-sheet-${id}`;
        const cached = await this.storage.getEntry<{ readonly blob: Blob }>(key);
        let blob = cached?.hash === sheet.hash && cached.payload?.blob instanceof Blob && cached.payload.blob.size > 0
            ? cached.payload.blob : undefined;
        if (!blob) {
            const asset = await this.assets.read(sheet.url);
            if (asset.descriptor.hash !== sheet.hash) throw new Error(`Portrait sheet hash does not match its catalog: ${id}`);
            blob = new Blob([asset.bytes], { type: 'image/webp' });
            try { await this.storage.put(key, sheet.hash, { blob }, sheet.url); }
            catch (error) { this.logger.warn(`Portrait sheet could not be cached: ${error}`); }
        }
        const url = URL.createObjectURL(blob);
        this.sheetUrls.update(current => new Map(current).set(sheet.url, url));
        return url;
    }

    ngOnDestroy(): void {
        for (const url of this.sheetUrls().values()) URL.revokeObjectURL(url);
    }
}
