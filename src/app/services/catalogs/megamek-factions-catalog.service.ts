// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';
import {
    hydrateMegaMekFactionRecord,
    type MegaMekFactionRecord,
    type MegaMekFactionRecordData,
    type MegaMekFactions,
    type MegaMekFactionsData,
    resolveMegaMekFactionRecord,
} from '../../models/megamek/factions.model';
import { CatalogBaseService } from './catalog-base.service';

function isMegaMekFactionsData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>): data is MegaMekFactionsData {
    if (!('assetHash' in data) || !('factions' in data)) {
        return false;
    }

    return typeof data.assetHash === 'string' && typeof data.factions === 'object' && data.factions !== null && !Array.isArray(data.factions);
}

@Injectable({
    providedIn: 'root'
})
export class MegaMekFactionsCatalogService extends CatalogBaseService<MegaMekFactionsData | MegaMekFactions, MegaMekFactionsData, MegaMekFactionsData | Record<string, MegaMekFactionRecordData>> {
    private factions = new Map<string, MegaMekFactionRecord>();
    private factionsByMulId = new Map<number, MegaMekFactionRecord[]>();

    protected override get catalogKey(): string {
        return 'megamek_factions';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/generated/factions-lite.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

    public getFactions(): MegaMekFactions {
        return Object.fromEntries(this.factions.entries());
    }

    public getFactionByKey(key: string): MegaMekFactionRecord | undefined {
        return this.factions.get(key);
    }

    public getFactionById(id: string): MegaMekFactionRecord | undefined {
        return this.factions.get(id);
    }

    public getFactionsByMulId(mulId: number): MegaMekFactionRecord[] {
        return this.factionsByMulId.get(mulId) ?? [];
    }

    protected override hasHydratedData(): boolean {
        return this.factions.size > 0;
    }

    protected override hydrate(data: MegaMekFactionsData | MegaMekFactions): void {
        const wrappedData = isMegaMekFactionsData(data) ? data : undefined;
        const rawFactions = wrappedData?.factions ?? data;
        const hydratedFactions = new Map<string, MegaMekFactionRecord>();

        this.factions.clear();
        this.factionsByMulId.clear();
        for (const faction of Object.values(rawFactions)) {
            const hydratedFaction = hydrateMegaMekFactionRecord(faction);
            hydratedFactions.set(hydratedFaction.id, hydratedFaction);
        }

        for (const faction of hydratedFactions.values()) {
            const resolvedFaction = resolveMegaMekFactionRecord(faction, hydratedFactions);
            if (resolvedFaction.mulId.length === 0) {
                continue;
            }

            this.factions.set(resolvedFaction.id, resolvedFaction);

            for (const mulId of resolvedFaction.mulId) {
                const factionsForMulId = this.factionsByMulId.get(mulId) ?? [];
                factionsForMulId.push(resolvedFaction);
                this.factionsByMulId.set(mulId, factionsForMulId);
            }
        }

        this.transportRevision = wrappedData?.assetHash || '';
    }

    protected override normalizeFetchedData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>, assetHash: string): MegaMekFactionsData {
        return this.wrapData(data, assetHash);
    }

    protected override getDatasetSize(data: MegaMekFactionsData | MegaMekFactions): number {
        return Object.keys(this.wrapData(data, '').factions).length;
    }

    private wrapData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>, assetHash: string): MegaMekFactionsData {
        if (isMegaMekFactionsData(data)) {
            return {
                assetHash,
                factions: data.factions,
            };
        }

        return {
            assetHash,
            factions: data,
        };
    }
}
