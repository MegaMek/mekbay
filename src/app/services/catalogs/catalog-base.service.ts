// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, fromEvent, type Observable, takeUntil } from 'rxjs';

import { LoggerService } from '../logger.service';
import { withServiceWorkerBypass } from '../../utils/service-worker-bypass.util';
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
    protected readonly http = inject(HttpClient);
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

    /**
     * Read and structurally validate durable transport data without mutating
     * the live catalog. Essential catalogs add their own pure state builder on
     * top of this seam before a bundle can be considered sufficient.
     */
    public async prepareCachedTransport(): Promise<PreparedCatalogTransport<TStored> | undefined> {
        const data = await this.loadFromCache();
        if (!data) return undefined;
        try {
            this.validateData(data, 'cache');
            return { source: 'cache', data: this.normalizeCachedData(data) };
        } catch (error) {
            this.logger.warn(`Ignoring invalid cache ${this.catalogKey} dataset: ${this.describeError(error)}`);
            return undefined;
        }
    }

    /** Fetch and validate a detached remote transport candidate; never hydrate or persist it. */
    public async prepareRemoteTransport(
        previous?: PreparedCatalogTransport<TStored>,
        signal?: AbortSignal,
    ): Promise<PreparedCatalogTransport<TStored>> {
        const assetPath = this.repositoryAssetPath;
        if (assetPath !== undefined) {
            const descriptor = await this.repositoryAssets.descriptor(assetPath, signal);
            const previousRevision = previous ? this.getTransportRevision(previous.data) : '';
            if (previous && previousRevision === descriptor.hash) return previous;
            return this.downloadTracker.trackDownload(async () => {
                this.logger.info(`Downloading changed repository asset ${assetPath}...`);
                const asset = await this.repositoryAssets.readJson<TRemoteBody>(assetPath, signal);
                const data = this.normalizeFetchedData(asset.value, asset.descriptor.hash);
                this.validateData(data, 'remote', previous?.data);
                return { source: 'remote', data };
            });
        }

        return this.downloadTracker.trackDownload(async () => {
            this.logger.info(`Downloading ${this.catalogKey}...`);
            const response = await firstValueFromWithSignal(this.http.get<TRemoteBody>(withServiceWorkerBypass(this.remoteUrl), {
                observe: 'response',
                reportProgress: false,
            }), signal);
            const body = response.body;
            if (!body) throw new Error(`No body received for ${this.catalogKey}`);
            const revision = providedCatalogRevision(body);
            const previousRevision = previous ? this.getTransportRevision(previous.data) : '';
            if (previous && previousRevision === revision) return previous;
            const data = this.normalizeFetchedData(body, revision);
            this.validateData(data, 'remote', previous?.data);
            return { source: 'remote', data };
        });
    }

    /** Called by an assignment-only subclass commit after its detached state is complete. */
    protected markPreparedCatalogCommitted(data: TStored): void {
        this.transportRevision = this.getTransportRevision(data);
        this.initialized = true;
    }

    protected async afterInitialize(): Promise<void> {}

    protected normalizeCachedData(data: THydrateInput): TStored {
        return data as TStored;
    }

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

        if (this.repositoryAssetPath !== undefined) {
            await this.initializeRepositoryAsset(validLocalData);
            await this.afterInitialize();
            return;
        }

        try {
            await this.fetchRemote(validLocalData);
        } catch (error) {
            if (!(error instanceof HttpErrorResponse) || !this.hasHydratedData()) throw error;
            this.logger.info(`${this.catalogKey} loaded from cache (offline or remote unavailable).`);
        }

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
    protected abstract get remoteUrl(): string;
    /** Relative deploy path whose authority comes from assets-manifest.json. */
    protected get repositoryAssetPath(): string | undefined { return undefined; }
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
        const assetPath = this.repositoryAssetPath!;
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
                this.validateData(wrappedData, 'remote', previousData);
                this.hydrate(wrappedData);
                this.ensureHydratedData('remote');
            } catch (error) {
                if (previousData) {
                    try {
                        this.hydrate(previousData);
                        this.ensureHydratedData('cache');
                    } catch (restoreError) {
                        this.logger.error(`Failed to restore cached ${this.catalogKey}: ${this.describeError(restoreError)}`);
                    }
                }
                throw new Error(`Rejected ${this.catalogKey} update: ${this.describeError(error)}`);
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

    /**
     * This method is used to determine the minimum acceptable size of a newly fetched remote dataset. If the size of the new dataset is below this threshold, it will be rejected as invalid. 
     * This is to prevent loading incomplete or corrupted datasets that could break the application.
     */
    protected getMinimumDatasetSize(): number {
        return 1;
    }

    /**
     * This method is used to determine the minimum acceptable size of a newly fetched remote dataset relative to the previously loaded dataset. 
     * It is only applied if the previous dataset size is above the threshold defined by `getMinimumRelativeComparisonSize()`.
     */
    protected getMinimumRelativeDatasetSize(): number | undefined {
        return 0.75;
    }

    /**
     * This method defines the minimum size a previously loaded dataset must have for the relative size check to be applied when validating a newly fetched remote dataset. 
     * This is to avoid rejecting new datasets that are legitimately smaller than the previous one when the previous dataset is too small to be a reliable reference for comparison.
     * For example, if the previous dataset has only 10 entries, it might be normal for a new dataset to have only 7 entries after an update, and rejecting it for being below 75% of the previous size would be too strict.
     */
    protected getMinimumRelativeComparisonSize(): number {
        return 100;
    }

    protected async fetchRemote(previousData?: THydrateInput): Promise<void> {
        await this.downloadTracker.trackDownload(async () => {
            this.logger.info(`Downloading ${this.catalogKey}...`);

            const response = await firstValueFrom(this.http.get<TRemoteBody>(withServiceWorkerBypass(this.remoteUrl), {
                observe: 'response',
                reportProgress: false,
            }));

            const body = response.body;
            if (!body) {
                throw new Error(`No body received for ${this.catalogKey}`);
            }

            const revision = providedCatalogRevision(body);
            if (this.transportRevision === revision && this.hasHydratedData()) return;
            const wrappedData = this.normalizeFetchedData(body, revision);

            try {
                this.validateData(wrappedData, 'remote', previousData);
                this.hydrate(wrappedData);
                this.ensureHydratedData('remote');
            } catch (error) {
                if (previousData) {
                    try {
                        this.hydrate(previousData);
                        this.ensureHydratedData('cache');
                        this.logger.warn(`Preserved cached ${this.catalogKey} after rejecting the remote update.`);
                    } catch (restoreError) {
                        this.logger.error(`Failed to restore cached ${this.catalogKey}: ${this.describeError(restoreError)}`);
                    }
                }

                const message = `Rejected ${this.catalogKey} update: ${this.describeError(error)}`;
                this.logger.error(message);
                throw new Error(message);
            }

            await this.saveToCache(wrappedData);
            this.transportRevision = revision;
            this.logger.info(`${this.catalogKey} updated. (revision: ${revision})`);
        });
    }

    private tryHydrateData(data: THydrateInput, source: CatalogDataSource): boolean {
        try {
            this.validateData(data, source);
            this.hydrate(data);
            this.ensureHydratedData(source);
            return true;
        } catch (error) {
            this.logger.warn(`Ignoring invalid ${source} ${this.catalogKey} dataset: ${this.describeError(error)}`);
            return false;
        }
    }

    protected validateData(data: THydrateInput, source: CatalogDataSource, previousData?: THydrateInput): void {
        const size = this.getDatasetSize(data);
        if (size === undefined) {
            return;
        }

        const minimumDatasetSize = this.getMinimumDatasetSize();
        if (size < minimumDatasetSize) {
            throw new Error(`expected at least ${minimumDatasetSize} entries, received ${size}`);
        }

        if (source !== 'remote' || !previousData) {
            return;
        }

        const previousSize = this.getDatasetSize(previousData);
        const minimumRelativeDatasetSize = this.getMinimumRelativeDatasetSize();
        if (
            previousSize === undefined
            || minimumRelativeDatasetSize === undefined
            || previousSize < this.getMinimumRelativeComparisonSize()
        ) {
            return;
        }

        const minimumAcceptedSize = Math.max(
            minimumDatasetSize,
            Math.ceil(previousSize * minimumRelativeDatasetSize),
        );

        if (size < minimumAcceptedSize) {
            throw new Error(
                `received only ${size} entries after previously loading ${previousSize}`,
            );
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

function providedCatalogRevision(value: unknown): string {
    if (typeof value === 'object' && value !== null && 'assetHash' in value) {
        const revision = (value as { readonly assetHash?: unknown }).assetHash;
        if (typeof revision === 'string' && revision.length > 0) return revision;
    }
    throw new Error('Remote catalog did not provide an assetHash revision');
}

async function firstValueFromWithSignal<T>(source: Observable<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return firstValueFrom(source);
    if (signal.aborted) throw catalogPreparationCancelledError();
    try {
        return await firstValueFrom(source.pipe(takeUntil(fromEvent(signal, 'abort'))));
    } catch (error) {
        if (signal.aborted) throw catalogPreparationCancelledError();
        throw error;
    }
}

function catalogPreparationCancelledError(): DOMException {
    return new DOMException('Catalog preparation was cancelled', 'AbortError');
}
