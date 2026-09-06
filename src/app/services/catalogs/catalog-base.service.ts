// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, Injectable, inject, signal } from '@angular/core';

import { LoggerService } from '../logger.service';
import { RepositoryAssetManifestService } from './repository-asset-manifest.service';
import { CatalogStorage } from './catalog-storage.service';

type CatalogDataSource = 'cache' | 'remote' | 'bundle';

export interface PreparedCatalogTransport<TData> {
    readonly source: CatalogDataSource;
    readonly data: TData;
}

@Injectable({ providedIn: 'root' })
export class CatalogDownloadTrackerService {
    private readonly activeDownloadCount = signal(0);
    public readonly isDownloading = computed(() => this.activeDownloadCount() > 0);

    public async trackDownload<T>(download: () => Promise<T>): Promise<T> {
        this.activeDownloadCount.update((count) => count + 1);
        try {
            return await download();
        } finally {
            this.activeDownloadCount.update((count) => Math.max(0, count - 1));
        }
    }
}

export abstract class CatalogBaseService<THydrateInput, TStored extends THydrateInput, TRemoteBody = TStored> {
    protected readonly logger = inject(LoggerService);
    private readonly downloadTracker = inject(CatalogDownloadTrackerService);
    private readonly repositoryAssets = inject(RepositoryAssetManifestService);
    private readonly catalogStorage = inject(CatalogStorage);
    protected transportRevision = '';
    private initialized = false;
    private initializationPromise: Promise<void> | null = null;
    private cachedHydrationPromise: Promise<THydrateInput | undefined> | null = null;

    public initialize(): Promise<void> {
        if (this.initialized) {
            return Promise.resolve();
        }
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this.performInitialization()
            .then(() => {
                this.initialized = true;
            })
            .finally(() => {
                this.initializationPromise = null;
            });
        return this.initializationPromise;
    }

    /**
     * Hydrates a validated saved catalog without performing any network work.
     * A later initialize() reuses this exact cache read and only revalidates it
     * against the remote revision.
     */
    public async hydrateFromCache(): Promise<boolean> {
        return await this.loadAndHydrateCachedData() !== undefined;
    }

    /**
     * Revision supplied by the repository manifest or authored catalog payload.
     */
    public getCatalogRevision(): string {
        return this.transportRevision || 'unversioned';
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    /** Fetch and validate a detached remote transport candidate; never hydrate or persist it. */
    public async prepareRemoteTransport(
        previous?: PreparedCatalogTransport<TStored>,
        signal?: AbortSignal,
    ): Promise<PreparedCatalogTransport<TStored>> {
        const assetPath = this.repositoryAssetPath;
        const descriptor = await this.repositoryAssets.descriptor(assetPath, signal);
        const previousRevision = previous ? this.getTransportRevision(previous.data) : '';
        if (previous && previousRevision === descriptor.hash) return previous;
        return this.downloadTracker.trackDownload(async () => {
            this.logger.info(`Downloading changed repository asset ${assetPath}...`);
            const asset = await this.repositoryAssets.readJson<TRemoteBody>(assetPath, signal);
            const data = this.normalizeFetchedData(asset.value, asset.descriptor.hash);
            this.validateData(data);
            return { source: 'remote', data };
        });
    }

    /** Called by an assignment-only subclass commit after its detached state is complete. */
    protected markPreparedCatalogCommitted(data: TStored): void {
        this.transportRevision = this.getTransportRevision(data);
        this.initialized = true;
    }

    protected async afterInitialize(): Promise<void> {}

    protected getTransportRevision(data: THydrateInput): string {
        if (typeof data === 'object' && data !== null) {
            if ('assetHash' in data) {
                const value = (data as { readonly assetHash?: unknown }).assetHash;
                if (typeof value === 'string') return value;
            }
        }
        return '';
    }

    private async performInitialization(): Promise<void> {
        const validLocalData = await this.loadAndHydrateCachedData();

        await this.initializeRepositoryAsset(validLocalData);
        await this.afterInitialize();
    }

    private loadAndHydrateCachedData(): Promise<THydrateInput | undefined> {
        if (this.cachedHydrationPromise) return this.cachedHydrationPromise;
        const loading = this.loadFromCache()
            .then(localData => {
                const validLocalData = localData && this.tryHydrateData(localData, 'cache')
                    ? localData
                    : undefined;
                this.transportRevision = validLocalData ? this.getTransportRevision(validLocalData) : '';
                return validLocalData;
            })
            .catch(error => {
                if (this.cachedHydrationPromise === loading) this.cachedHydrationPromise = null;
                throw error;
            });
        this.cachedHydrationPromise = loading;
        return loading;
    }

    protected abstract get catalogKey(): string;
    /** Relative deploy path whose authority comes from assets-manifest.json. */
    protected abstract get repositoryAssetPath(): string;
    protected abstract hasHydratedData(): boolean;
    protected async loadFromCache(): Promise<THydrateInput | undefined> {
        return await this.catalogStorage.get<TStored>(this.catalogKey) as THydrateInput | undefined;
    }
    protected saveToCache(data: TStored): Promise<void> {
        const contentHash = this.getTransportRevision(data);
        if (!contentHash) {
            throw new Error(`Refusing to cache ${this.catalogKey} without a content hash`);
        }
        return this.catalogStorage.put(this.catalogKey, contentHash, data, this.repositoryAssetPath);
    }
    protected abstract hydrate(data: THydrateInput): void;
    protected abstract normalizeFetchedData(data: TRemoteBody, assetHash: string): TStored;

    private async initializeRepositoryAsset(previousData?: THydrateInput): Promise<void> {
        const assetPath = this.repositoryAssetPath;
        let descriptor;
        try {
            descriptor = await this.repositoryAssets.descriptor(assetPath);
        } catch (error) {
            if (this.hasHydratedData()) {
                this.logger.warn(`${this.catalogKey} loaded from cache because the repository asset manifest is unavailable.`);
                return;
            }
            throw error;
        }
        if (this.transportRevision === descriptor.hash && this.hasHydratedData()) {
            return;
        }
        await this.downloadTracker.trackDownload(async () => {
            this.logger.info(`Downloading changed repository asset ${assetPath}...`);
            const asset = await this.repositoryAssets.readJson<TRemoteBody>(assetPath);
            const wrappedData = this.normalizeFetchedData(asset.value, asset.descriptor.hash);
            try {
                this.validateData(wrappedData);
                this.hydrate(wrappedData);
                this.ensureHydratedData('remote');
            } catch (error) {
                this.handleRejectedRemoteUpdate(error, previousData);
                return;
            }
            // Parsed bytes and authored hash are persisted as one IndexedDB
            // value: no separate validator row can get ahead of the content.
            await this.saveToCache(wrappedData);
            this.transportRevision = asset.descriptor.hash;
            this.logger.info(`${this.catalogKey} updated. (repository hash: ${asset.descriptor.hash})`);
        });
    }

    protected getDatasetSize(_data: THydrateInput): number | undefined {
        return undefined;
    }

    /** Minimum catalog size required by the owning domain. */
    protected getMinimumDatasetSize(): number {
        return 1;
    }

    private handleRejectedRemoteUpdate(error: unknown, previousData?: THydrateInput): void {
        let restoredPreviousData = false;
        if (previousData) {
            try {
                this.hydrate(previousData);
                this.ensureHydratedData('cache');
                restoredPreviousData = true;
                this.logger.warn(`Preserved cached ${this.catalogKey} after rejecting the remote update.`);
            } catch (restoreError) {
                this.logger.error(`Failed to restore cached ${this.catalogKey}: ${this.describeError(restoreError)}`);
            }
        }

        const message = `Rejected ${this.catalogKey} update: ${this.describeError(error)}`;
        this.logger.error(message);
        if (!restoredPreviousData) throw new Error(message);
    }

    private tryHydrateData(data: THydrateInput, source: CatalogDataSource): boolean {
        try {
            this.validateData(data);
            this.hydrate(data);
            this.ensureHydratedData(source);
            return true;
        } catch (error) {
            this.logger.warn(`Ignoring invalid ${source} ${this.catalogKey} dataset: ${this.describeError(error)}`);
            return false;
        }
    }

    private validateData(data: THydrateInput): void {
        const size = this.getDatasetSize(data);
        if (size === undefined) {
            return;
        }

        const minimumDatasetSize = this.getMinimumDatasetSize();
        if (size < minimumDatasetSize) {
            throw new Error(`expected at least ${minimumDatasetSize} entries, received ${size}`);
        }
    }

    private ensureHydratedData(source: CatalogDataSource): void {
        if (this.hasHydratedData()) {
            return;
        }

        throw new Error(`${source} ${this.catalogKey} dataset hydrated to an empty catalog`);
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }

        return String(error);
    }
}
