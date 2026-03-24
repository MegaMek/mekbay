import { Injectable, inject } from '@angular/core';
import { DbService } from '../db.service';
import {
    getMegaMekFactionAffiliation,
    hydrateMegaMekFactionRecord,
    type MegaMekFactionAffiliation,
    type MegaMekFactionRecord,
    type MegaMekFactionRecordData,
    type MegaMekFactions,
    type MegaMekFactionsData,
} from '../../models/megamek/factions.model';
import { CatalogBaseService } from './catalog-base.service';

function isMegaMekFactionsData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>): data is MegaMekFactionsData {
    if (!('etag' in data) || !('factions' in data)) {
        return false;
    }

    return typeof data.etag === 'string' && typeof data.factions === 'object' && data.factions !== null && !Array.isArray(data.factions);
}

@Injectable({
    providedIn: 'root'
})
export class MegaMekFactionsCatalogService extends CatalogBaseService<MegaMekFactionsData | MegaMekFactions, MegaMekFactionsData, MegaMekFactionsData | Record<string, MegaMekFactionRecordData>> {
    private readonly dbService = inject(DbService);

    private factions = new Map<string, MegaMekFactionRecord>();

    protected override get catalogKey(): string {
        return 'megamek_factions';
    }

    protected override get remoteUrl(): string {
        return 'assets/factions.json';
    }

    public getFactions(): MegaMekFactions {
        return Object.fromEntries(this.factions.entries());
    }

    public getFactionByKey(key: string): MegaMekFactionRecord | undefined {
        return this.factions.get(key);
    }

    public getFactionAffiliation(factionKey: string): MegaMekFactionAffiliation {
        const faction = this.getFactionByKey(factionKey);
        if (!faction) {
            return 'Other';
        }

        return getMegaMekFactionAffiliation(faction, this.factions);
    }

    protected override hasHydratedData(): boolean {
        return this.factions.size > 0;
    }

    protected override async loadFromCache(): Promise<MegaMekFactionsData | MegaMekFactions | undefined> {
        return await this.dbService.getMegaMekFactions() ?? undefined;
    }

    protected override saveToCache(data: MegaMekFactionsData): Promise<void> {
        return this.dbService.saveMegaMekFactions(data);
    }

    protected override hydrate(data: MegaMekFactionsData | MegaMekFactions): void {
        const wrappedData = isMegaMekFactionsData(data) ? data : undefined;
        const rawFactions = wrappedData?.factions ?? data;

        this.factions.clear();
        for (const faction of Object.values(rawFactions)) {
            const hydratedFaction = hydrateMegaMekFactionRecord(faction);
            this.factions.set(hydratedFaction.key, hydratedFaction);
        }

        this.etag = wrappedData?.etag || '';
    }

    protected override normalizeFetchedData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>, etag: string): MegaMekFactionsData {
        return this.wrapData(data, etag);
    }

    private wrapData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>, etag: string): MegaMekFactionsData {
        if (isMegaMekFactionsData(data)) {
            return {
                etag,
                factions: data.factions,
            };
        }

        return {
            etag,
            factions: data,
        };
    }
}