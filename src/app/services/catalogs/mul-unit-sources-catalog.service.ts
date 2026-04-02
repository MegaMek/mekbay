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

import { REMOTE_HOST } from '../../models/common.model';
import type { MULUnitSources, MULUnitSourcesData } from '../../models/mul-unit-sources.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

function isMulUnitSourcesData(data: MULUnitSources | MULUnitSourcesData): data is MULUnitSources {
    if (!('etag' in data) || !('sources' in data)) {
        return false;
    }

    return typeof data.etag === 'string'
        && typeof data.sources === 'object'
        && data.sources !== null
        && !Array.isArray(data.sources);
}

@Injectable({
    providedIn: 'root'
})
export class MulUnitSourcesCatalogService extends CatalogBaseService<MULUnitSources | MULUnitSourcesData, MULUnitSources, MULUnitSources | MULUnitSourcesData> {
    private readonly dbService = inject(DbService);

    private sources = new Map<number, string[]>();

    protected override get catalogKey(): string {
        return 'units_sources';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/units_sources.json`;
    }

    public getUnitSourcesByMulId(mulId: number): string[] | undefined {
        return this.sources.get(mulId);
    }

    protected override hasHydratedData(): boolean {
        return this.sources.size > 0;
    }

    protected override async loadFromCache(): Promise<MULUnitSources | MULUnitSourcesData | undefined> {
        return await this.dbService.getMULUnitSources() ?? undefined;
    }

    protected override saveToCache(data: MULUnitSources): Promise<void> {
        return this.dbService.saveMULUnitSources(data);
    }

    protected override hydrate(data: MULUnitSources | MULUnitSourcesData): void {
        const wrappedData = isMulUnitSourcesData(data)
            ? data
            : this.wrapData(data, '');

        this.sources.clear();
        for (const [mulIdStr, sourceAbbrevs] of Object.entries(wrappedData.sources)) {
            const mulId = Number.parseInt(mulIdStr, 10);
            if (Number.isNaN(mulId)) {
                continue;
            }

            const filteredAbbrevs = sourceAbbrevs.filter((abbrev) => abbrev !== 'None');
            if (filteredAbbrevs.length > 0) {
                this.sources.set(mulId, filteredAbbrevs);
            }
        }

        this.etag = wrappedData.etag;
    }

    protected override normalizeFetchedData(data: MULUnitSources | MULUnitSourcesData, etag: string): MULUnitSources {
        return this.wrapData(data, etag);
    }

    private wrapData(data: MULUnitSources | MULUnitSourcesData, etag: string): MULUnitSources {
        if (isMulUnitSourcesData(data)) {
            return {
                etag,
                sources: data.sources,
            };
        }

        return {
            etag,
            sources: data as MULUnitSourcesData,
        };
    }
}