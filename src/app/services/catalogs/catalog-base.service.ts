/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { LoggerService } from '../logger.service';
import { generateUUID } from '../ws.service';

type CatalogDataSource = 'cache' | 'remote';

export abstract class CatalogBaseService<THydrateInput, TStored extends THydrateInput, TRemoteBody = TStored> {
    protected readonly http = inject(HttpClient);
    protected readonly logger = inject(LoggerService);
    protected etag = '';

    public async initialize(): Promise<void> {
        const localData = await this.loadFromCache();
        const validLocalData = localData && this.tryHydrateData(localData, 'cache')
            ? localData
            : undefined;

        if (!validLocalData) {
            this.etag = '';
        }

        const remoteEtag = await this.getRemoteEtag();
        if (!remoteEtag) {
            if (this.hasHydratedData()) {
                this.logger.info(`${this.catalogKey} loaded from cache (offline or remote unavailable).`);
                return;
            }

            await this.fetchRemote();
            return;
        }

        if (this.etag && this.etag === remoteEtag) {
            this.logger.info(`${this.catalogKey} is up to date. (ETag: ${remoteEtag})`);
            return;
        }

        await this.fetchRemote(validLocalData);
    }

    protected abstract get catalogKey(): string;
    protected abstract get remoteUrl(): string;
    protected abstract hasHydratedData(): boolean;
    protected abstract loadFromCache(): Promise<THydrateInput | undefined>;
    protected abstract saveToCache(data: TStored): Promise<void>;
    protected abstract hydrate(data: THydrateInput): void;
    protected abstract normalizeFetchedData(data: TRemoteBody, etag: string): TStored;

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

    protected async getRemoteEtag(): Promise<string> {
        try {
            const response = await firstValueFrom(this.http.head(this.remoteUrl, {
                observe: 'response',
                responseType: 'text',
            }));
            return response.headers.get('ETag') || '';
        } catch (error: any) {
            this.logger.warn(`Failed to fetch ETag for ${this.remoteUrl}: ${error?.message ?? error}`);
            return '';
        }
    }

    protected async fetchRemote(previousData?: THydrateInput): Promise<void> {
        this.logger.info(`Downloading ${this.catalogKey}...`);

        const response = await firstValueFrom(this.http.get<TRemoteBody>(this.remoteUrl, {
            observe: 'response',
            reportProgress: false,
        }));

        const body = response.body;
        if (!body) {
            throw new Error(`No body received for ${this.catalogKey}`);
        }

        const etag = response.headers.get('ETag') || generateUUID();
        const wrappedData = this.normalizeFetchedData(body, etag);

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
        this.logger.info(`${this.catalogKey} updated. (ETag: ${etag})`);
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

    private validateData(data: THydrateInput, source: CatalogDataSource, previousData?: THydrateInput): void {
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