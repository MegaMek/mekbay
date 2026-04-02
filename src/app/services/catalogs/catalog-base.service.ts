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

export abstract class CatalogBaseService<THydrateInput, TStored extends THydrateInput, TRemoteBody = TStored> {
    protected readonly http = inject(HttpClient);
    protected readonly logger = inject(LoggerService);
    protected etag = '';

    public async initialize(): Promise<void> {
        const localData = await this.loadFromCache();
        if (localData) {
            this.hydrate(localData);
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

        await this.fetchRemote();
    }

    protected abstract get catalogKey(): string;
    protected abstract get remoteUrl(): string;
    protected abstract hasHydratedData(): boolean;
    protected abstract loadFromCache(): Promise<THydrateInput | undefined>;
    protected abstract saveToCache(data: TStored): Promise<void>;
    protected abstract hydrate(data: THydrateInput): void;
    protected abstract normalizeFetchedData(data: TRemoteBody, etag: string): TStored;

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

    protected async fetchRemote(): Promise<void> {
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
        await this.saveToCache(wrappedData);
        this.hydrate(wrappedData);
        this.logger.info(`${this.catalogKey} updated. (ETag: ${etag})`);
    }
}