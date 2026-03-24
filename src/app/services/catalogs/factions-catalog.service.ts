import { Injectable, inject } from '@angular/core';

import { REMOTE_HOST } from '../../models/common.model';
import type { Faction, Factions } from '../../models/factions.model';
import { normalizeLooseText } from '../../utils/string.util';
import { naturalCompare } from '../../utils/sort.util';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class FactionsCatalogService extends CatalogBaseService<Factions, Factions> {
    private readonly dbService = inject(DbService);

    private factions: Faction[] = [];
    private factionNameMap = new Map<string, Faction>();
    private normalizedFactionNameMap = new Map<string, Faction>();
    private factionIdMap = new Map<number, Faction>();

    protected override get catalogKey(): string {
        return 'factions';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/factions.json`;
    }

    public getFactions(): Faction[] {
        return this.factions;
    }

    public getFactionByName(name: string): Faction | undefined {
        return this.factionNameMap.get(name)
            ?? this.normalizedFactionNameMap.get(normalizeLooseText(name));
    }

    public getFactionById(id: number): Faction | undefined {
        return this.factionIdMap.get(id);
    }

    protected override hasHydratedData(): boolean {
        return this.factions.length > 0;
    }

    protected override async loadFromCache(): Promise<Factions | undefined> {
        return await this.dbService.getFactions() ?? undefined;
    }

    protected override saveToCache(data: Factions): Promise<void> {
        return this.dbService.saveFactions(data);
    }

    protected override hydrate(data: Factions): void {
        const factions = [...data.factions].sort((left, right) => naturalCompare(left.name, right.name));

        this.factions = factions;
        this.factionNameMap.clear();
        this.normalizedFactionNameMap.clear();
        this.factionIdMap.clear();

        for (const faction of factions) {
            this.factionNameMap.set(faction.name, faction);

            const normalizedName = normalizeLooseText(faction.name);
            if (normalizedName && !this.normalizedFactionNameMap.has(normalizedName)) {
                this.normalizedFactionNameMap.set(normalizedName, faction);
            }

            this.factionIdMap.set(faction.id, faction);
            for (const eraId of Object.keys(faction.eras)) {
                faction.eras[Number(eraId)] = new Set(faction.eras[Number(eraId)] as Iterable<number>) as any;
            }
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Factions, etag: string): Factions {
        return {
            ...data,
            etag,
        };
    }
}