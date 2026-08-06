// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import { REMOTE_HOST } from '../../models/common.model';
import { MULFACTION_NONE, type FactionEraMembership, type MULFaction, type MULFactions, type RawFactionEraMembership, type RawMULFactions } from '../../models/mulfactions.model';
import { normalizeLooseText } from '../../utils/string.util';
import { naturalCompare } from '../../utils/sort.util';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class FactionsCatalogService extends CatalogBaseService<MULFactions | RawMULFactions, RawMULFactions, RawMULFactions> {
    private readonly dbService = inject(DbService);

    private factions: MULFaction[] = [];
    private factionNameMap = new Map<string, MULFaction>();
    private normalizedFactionNameMap = new Map<string, MULFaction>();
    private factionIdMap = new Map<number, MULFaction>();

    protected override get catalogKey(): string {
        return 'factions';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/factions.json`;
    }

    public getFactions(): MULFaction[] {
        return this.factions;
    }

    public getFactionByName(name: string): MULFaction | undefined {
        return this.factionNameMap.get(name)
            ?? this.normalizedFactionNameMap.get(normalizeLooseText(name));
    }

    public getFactionById(id: number): MULFaction | undefined {
        return this.factionIdMap.get(id);
    }

    protected override hasHydratedData(): boolean {
        return this.factions.length > 0;
    }

    protected override async loadFromCache(): Promise<MULFactions | RawMULFactions | undefined> {
        return await this.dbService.getFactions() ?? undefined;
    }

    protected override saveToCache(data: RawMULFactions): Promise<void> {
        return this.dbService.saveFactions(data);
    }

    protected override hydrate(data: MULFactions | RawMULFactions): void {
        const rawFactions = data.factions.some((faction) => faction.id === MULFACTION_NONE)
            ? [...data.factions]
            : [...data.factions, this.createNoneFaction()];
        const factions = rawFactions
            .sort((left, right) => naturalCompare(left.name, right.name))
            .map((faction) => ({
                ...faction,
                eras: Object.fromEntries(
                    Object.entries(faction.eras).map(([eraId, units]) => [
                        Number(eraId),
                        this.hydrateEraMembership(units),
                    ])
                ) as Record<number, FactionEraMembership>,
            }));

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
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: RawMULFactions, etag: string): RawMULFactions {
        return {
            ...data,
            etag,
        };
    }

    protected override getDatasetSize(data: MULFactions | RawMULFactions): number {
        return Array.isArray(data.factions) ? data.factions.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 82;
    }

    private hydrateEraMembership(units: RawFactionEraMembership): FactionEraMembership {
        return units instanceof Set ? new Set(units) : new Set(units);
    }

    private createNoneFaction(): MULFaction {
        return {
            id: MULFACTION_NONE,
            name: 'None',
            group: 'Other',
            img: '/images/factions/none.png',
            eras: {},
        };
    }
}