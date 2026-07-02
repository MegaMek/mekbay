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
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
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

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { REMOTE_HOST } from '../../models/common.model';
import type {
    Unit,
    UnitFluffCatalog,
    UnitFluffCatalogEntry,
    UnitFluffCatalogMetadata,
    UnitImageFluff,
} from '../../models/units.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { generateUUID } from '../ws.service';
import { CatalogDownloadTrackerService } from './catalog-base.service';

const MINIMUM_FLUFF_ENTRY_COUNT = 100;
const MINIMUM_RELATIVE_FLUFF_SIZE = 0.75;

@Injectable({
    providedIn: 'root'
})
export class UnitsFluffCatalogService {
    private readonly http = inject(HttpClient);
    private readonly dbService = inject(DbService);
    private readonly logger = inject(LoggerService);
    private readonly downloadTracker = inject(CatalogDownloadTrackerService);

    private initialized = false;
    private initializePromise: Promise<void> | null = null;
    private etag = '';
    private inMemoryFluff: Map<string, UnitFluffCatalogEntry> | null = null;

    /** Lazily-loaded fluff maps for additional unit servers, keyed by server base URL. */
    private readonly customServerFluff = new Map<string, Map<string, UnitFluffCatalogEntry>>();
    private readonly customServerLoads = new Map<string, Promise<Map<string, UnitFluffCatalogEntry>>>();

    private get remoteUrl(): string {
        return `${REMOTE_HOST}/units-fluff.json`;
    }

    public async getUnitFluff(unit: Pick<Unit, 'name' | 'fluff' | 'serverHost'>): Promise<UnitFluffCatalogEntry | undefined> {
        try {
            const catalogEntry = unit.serverHost
                ? await this.getCustomServerUnitFluff(unit.serverHost, unit.name)
                : await this.getPrimaryUnitFluff(unit.name);
            return this.buildDisplayFluff(unit.fluff, catalogEntry);
        } catch (error) {
            this.logger.warn(`Failed to load unit fluff for ${unit.name}: ${this.describeError(error)}`);
            return this.getUnitImageFallback(unit.fluff);
        }
    }

    private async getPrimaryUnitFluff(name: string): Promise<UnitFluffCatalogEntry | undefined> {
        await this.ensureInitialized();
        return this.getStoredUnitFluff(name);
    }

    private async getCustomServerUnitFluff(serverHost: string, name: string): Promise<UnitFluffCatalogEntry | undefined> {
        const fluffMap = await this.ensureCustomServerFluff(serverHost);
        return fluffMap.get(name);
    }

    private ensureCustomServerFluff(serverHost: string): Promise<Map<string, UnitFluffCatalogEntry>> {
        const loaded = this.customServerFluff.get(serverHost);
        if (loaded) {
            return Promise.resolve(loaded);
        }

        const inFlight = this.customServerLoads.get(serverHost);
        if (inFlight) {
            return inFlight;
        }

        const load = this.loadCustomServerFluff(serverHost)
            .then((fluffMap) => {
                this.customServerFluff.set(serverHost, fluffMap);
                return fluffMap;
            })
            .finally(() => {
                this.customServerLoads.delete(serverHost);
            });

        this.customServerLoads.set(serverHost, load);
        return load;
    }

    private async loadCustomServerFluff(serverHost: string): Promise<Map<string, UnitFluffCatalogEntry>> {
        const url = `${serverHost}/units-fluff.json`;
        const cached = await this.dbService.getCustomServerFluff(serverHost);
        const cachedEtag = cached?.etag || '';

        if (!navigator.onLine) {
            return this.toFluffMap(cached ?? { version: '', etag: '', fluff: {} });
        }

        const remoteEtag = await this.getRemoteEtag(url);
        if (cached && (!remoteEtag || cachedEtag === remoteEtag)) {
            this.logger.info(`Custom fluff for ${serverHost} loaded from cache.`);
            return this.toFluffMap(cached);
        }

        try {
            const data = await this.fetchRemoteData(remoteEtag, url);
            try {
                await this.dbService.saveCustomServerFluff(serverHost, data);
            } catch (error) {
                this.logger.warn(`Failed to cache custom fluff for ${serverHost}: ${this.describeError(error)}`);
            }
            this.logger.info(`Custom fluff for ${serverHost} updated. (ETag: ${data.etag})`);
            return this.toFluffMap(data);
        } catch (error) {
            this.logger.warn(`Failed to load custom fluff from ${serverHost}: ${this.describeError(error)}`);
            return this.toFluffMap(cached ?? { version: '', etag: '', fluff: {} });
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;

        if (!this.initializePromise) {
            this.initializePromise = this.initialize()
                .then(() => {
                    this.initialized = true;
                })
                .finally(() => {
                    this.initializePromise = null;
                });
        }

        return this.initializePromise;
    }

    private async initialize(): Promise<void> {
        if (this.dbService.isDegraded()) {
            await this.fetchRemoteIntoMemory();
            return;
        }

        const metadata = await this.dbService.getUnitFluffCatalogMetadata();
        this.etag = metadata?.etag || '';

        const remoteEtag = await this.getRemoteEtag();
        if (!metadata) {
            await this.fetchRemoteToStorage(remoteEtag, undefined);
            return;
        }

        if (remoteEtag && metadata.etag !== remoteEtag) {
            await this.fetchRemoteToStorage(remoteEtag, metadata);
            return;
        }

        if (remoteEtag) {
            this.logger.info(`units_fluff is up to date. (ETag: ${remoteEtag})`);
        } else {
            this.logger.info('units_fluff loaded from cache (offline or remote unavailable).');
        }
    }

    private async getStoredUnitFluff(name: string): Promise<UnitFluffCatalogEntry | undefined> {
        if (this.inMemoryFluff) {
            return this.inMemoryFluff.get(name);
        }

        return await this.dbService.getUnitFluff(name) ?? undefined;
    }

    private async fetchRemoteIntoMemory(): Promise<void> {
        const data = await this.fetchRemoteData();
        this.validateData(data);
        this.inMemoryFluff = this.toFluffMap(data);
        this.etag = data.etag || '';
        this.logger.info(`units_fluff loaded in memory because storage is unavailable. (ETag: ${this.etag})`);
    }

    private async fetchRemoteToStorage(remoteEtag: string, previousMetadata: UnitFluffCatalogMetadata | undefined): Promise<void> {
        const data = await this.fetchRemoteData(remoteEtag);
        this.validateData(data, previousMetadata);

        try {
            await this.dbService.saveUnitsFluff(data);
            this.inMemoryFluff = null;
        } catch (error) {
            this.logger.warn(`Failed to cache units_fluff; keeping it in memory for this session: ${this.describeError(error)}`);
            this.inMemoryFluff = this.toFluffMap(data);
        }

        this.etag = data.etag || '';
        this.logger.info(`units_fluff updated. (ETag: ${this.etag})`);
    }

    private async fetchRemoteData(remoteEtag = '', url: string = this.remoteUrl): Promise<UnitFluffCatalog> {
        return await this.downloadTracker.trackDownload(async () => {
            this.logger.info(`Downloading units_fluff from ${url}...`);

            const response = await firstValueFrom(this.http.get<UnitFluffCatalog>(url, {
                observe: 'response',
                reportProgress: false,
            }));

            const body = response.body;
            if (!body) {
                throw new Error('No body received for units_fluff');
            }

            return {
                ...body,
                etag: response.headers.get('ETag') || remoteEtag || generateUUID(),
                fluff: body.fluff ?? {},
            };
        });
    }

    private async getRemoteEtag(url: string = this.remoteUrl): Promise<string> {
        try {
            const response = await firstValueFrom(this.http.head(url, {
                observe: 'response',
                responseType: 'text',
            }));
            return response.headers.get('ETag') || '';
        } catch (error: any) {
            this.logger.warn(`Failed to fetch ETag for ${url}: ${error?.message ?? error}`);
            return '';
        }
    }

    private validateData(data: UnitFluffCatalog, previousMetadata?: UnitFluffCatalogMetadata): void {
        const size = Object.keys(data.fluff ?? {}).length;
        if (size < MINIMUM_FLUFF_ENTRY_COUNT) {
            throw new Error(`expected at least ${MINIMUM_FLUFF_ENTRY_COUNT} fluff entries, received ${size}`);
        }

        if (!previousMetadata || previousMetadata.count < MINIMUM_FLUFF_ENTRY_COUNT) {
            return;
        }

        const minimumAcceptedSize = Math.ceil(previousMetadata.count * MINIMUM_RELATIVE_FLUFF_SIZE);
        if (size < minimumAcceptedSize) {
            throw new Error(`received only ${size} fluff entries after previously loading ${previousMetadata.count}`);
        }
    }

    private toFluffMap(data: UnitFluffCatalog): Map<string, UnitFluffCatalogEntry> {
        return new Map(Object.entries(data.fluff ?? {}));
    }

    private buildDisplayFluff(
        unitImageFluff: UnitImageFluff | undefined,
        catalogEntry: UnitFluffCatalogEntry | undefined,
    ): UnitFluffCatalogEntry | undefined {
        if (!catalogEntry) {
            return this.getUnitImageFallback(unitImageFluff);
        }

        const displayFluff: UnitFluffCatalogEntry = { ...catalogEntry };
        displayFluff.img ||= unitImageFluff?.img;

        return this.hasFluffContent(displayFluff) ? displayFluff : undefined;
    }

    private getUnitImageFallback(fluff: UnitImageFluff | undefined): UnitFluffCatalogEntry | undefined {
        const image = fluff?.img?.trim();
        return image ? { img: image } : undefined;
    }

    private hasFluffContent(fluff: UnitFluffCatalogEntry | undefined): boolean {
        if (!fluff) return false;
        return Object.entries(fluff).some(([key, value]) => {
            if (key === 'img') {
                return typeof value === 'string' && value.trim().length > 0;
            }

            if (Array.isArray(value)) {
                return value.length > 0;
            }

            return typeof value === 'string' && value.trim().length > 0;
        });
    }

    private describeError(error: unknown): string {
        if (error instanceof HttpErrorResponse) {
            if (error.status === 0) {
                return `network/CORS error (status 0). Ensure the server is reachable and sends an 'Access-Control-Allow-Origin' header for units-fluff.json.`;
            }
            return `HTTP ${error.status} ${error.statusText}`.trim();
        }
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }

        return String(error);
    }
}
