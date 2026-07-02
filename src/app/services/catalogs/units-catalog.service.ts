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

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { REMOTE_HOST, normalizeUnitServerUrl } from '../../models/common.model';
import type { Unit, Units } from '../../models/units.model';
import { DbService } from '../db.service';
import { OptionsService } from '../options.service';
import { UnitRuntimeService } from '../unit-runtime.service';
import { generateUUID } from '../ws.service';
import { CatalogBaseService } from './catalog-base.service';

export function normalizeNullMulUnitIds(units: readonly Unit[]): Unit[] {
    let nextNullMulId = -1;
    return units.map((unit) => unit.id > 0
        ? unit
        : { ...unit, id: nextNullMulId-- });
}

@Injectable({
    providedIn: 'root'
})
export class UnitsCatalogService extends CatalogBaseService<Units, Units> {
    private readonly dbService = inject(DbService);
    private readonly unitRuntimeService = inject(UnitRuntimeService);
    private readonly optionsService = inject(OptionsService);

    private units: Unit[] = [];

    protected override get catalogKey(): string {
        return 'units';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/units.json`;
    }

    /**
     * Loads the primary db.mekbay.com catalog through the base flow, then merges in units
     * from any user-supplied additional unit servers. The primary source always wins on
     * name collisions; additional servers may only contribute new-named units.
     */
    public override async initialize(): Promise<void> {
        await super.initialize();
        await this.loadCustomServers();
    }

    public getUnits(): Unit[] {
        return this.units;
    }

    protected override hasHydratedData(): boolean {
        return this.units.length > 0;
    }

    protected override async loadFromCache(): Promise<Units | undefined> {
        return await this.dbService.getUnits() ?? undefined;
    }

    protected override saveToCache(data: Units): Promise<void> {
        return this.dbService.saveUnits(data);
    }

    protected override hydrate(data: Units): void {
        this.units = normalizeNullMulUnitIds(data.units);
        this.unitRuntimeService.preprocessUnits(this.units);
        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Units, etag: string): Units {
        return {
            ...data,
            etag,
        };
    }

    protected override getDatasetSize(data: Units): number {
        return Array.isArray(data.units) ? data.units.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 9000;
    }

    private async loadCustomServers(): Promise<void> {
        const configured = this.optionsService.options().unitServers ?? [];
        const primaryHost = normalizeUnitServerUrl(REMOTE_HOST);
        const servers = Array.from(new Set(
            configured
                .map(normalizeUnitServerUrl)
                .filter(server => server && server !== primaryHost)
        ));

        if (servers.length === 0) {
            return;
        }

        const usedNames = new Set(this.units.map(unit => unit.name.toLowerCase()));
        const usedIds = new Set(this.units.map(unit => unit.id));
        let nextSyntheticId = this.units.reduce((min, unit) => Math.min(min, unit.id), 0) - 1;

        const customUnits: Unit[] = [];
        for (const server of servers) {
            let data: Units | null = null;
            try {
                data = await this.loadServerUnits(server);
            } catch (error) {
                this.logger.warn(`Failed to load units from additional server ${server}: ${this.describeServerError(error)}`);
                continue;
            }

            if (!data || !Array.isArray(data.units)) {
                continue;
            }

            let added = 0;
            for (const rawUnit of data.units) {
                const nameKey = rawUnit.name?.toLowerCase();
                if (!nameKey || usedNames.has(nameKey)) {
                    continue; // Primary source (or an earlier server) already owns this name.
                }
                usedNames.add(nameKey);

                let id = rawUnit.id;
                if (!(id > 0) || usedIds.has(id)) {
                    id = nextSyntheticId--;
                }
                usedIds.add(id);

                customUnits.push({ ...rawUnit, id, serverHost: server });
                added++;
            }
            this.logger.info(`Loaded ${added} additional unit(s) from ${server}.`);
        }

        if (customUnits.length === 0) {
            return;
        }

        this.units = [...this.units, ...customUnits];
        this.unitRuntimeService.preprocessUnits(this.units);
    }

    private async loadServerUnits(server: string): Promise<Units | null> {
        const url = `${server}/units.json`;
        const cached = await this.dbService.getCustomServerUnits(server);

        if (!navigator.onLine) {
            return cached ?? null;
        }

        const remoteEtag = await this.getRemoteEtagFor(url);
        if (cached && remoteEtag && cached.etag === remoteEtag) {
            return cached;
        }

        try {
            const response = await firstValueFrom(this.http.get<Units>(url, {
                observe: 'response',
                reportProgress: false,
            }));

            const body = response.body;
            if (!body || !Array.isArray(body.units) || body.units.length === 0) {
                this.logger.warn(`Additional server ${server} returned no usable units.`);
                return cached ?? null;
            }

            const etag = response.headers.get('ETag') || remoteEtag || generateUUID();
            const data: Units = { ...body, etag };
            await this.dbService.saveCustomServerUnits(server, data);
            return data;
        } catch (error) {
            this.logger.warn(`Failed to download units from ${server}: ${this.describeServerError(error)}`);
            return cached ?? null;
        }
    }

    private async getRemoteEtagFor(url: string): Promise<string> {
        try {
            const response = await firstValueFrom(this.http.head(url, {
                observe: 'response',
                responseType: 'text',
            }));
            return response.headers.get('ETag') || '';
        } catch {
            return '';
        }
    }

    private describeServerError(error: unknown): string {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        return String(error);
    }
}