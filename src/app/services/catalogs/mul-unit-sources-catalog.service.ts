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