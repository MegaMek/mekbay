// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import { MULFACTION_NONE, type FactionEraMembership, type MULFaction, type MULFactions, type RawFactionEraMembership, type RawMULFactions } from '../../models/mulfactions.model';
import { normalizeLooseText } from '../../utils/string.util';
import { naturalCompare } from '../../utils/sort.util';
import {
    CatalogBaseService,
    type PreparedCatalogTransport,
} from './catalog-base.service';

export interface PreparedFactionsCatalog {
    readonly transport: PreparedCatalogTransport<RawMULFactions>;
    readonly factions: MULFaction[];
    readonly factionNameMap: ReadonlyMap<string, MULFaction>;
    readonly normalizedFactionNameMap: ReadonlyMap<string, MULFaction>;
    readonly factionIdMap: ReadonlyMap<number, MULFaction>;
}

@Injectable({
    providedIn: 'root'
})
export class FactionsCatalogService extends CatalogBaseService<MULFactions | RawMULFactions, RawMULFactions, RawMULFactions> {
    private factions: MULFaction[] = [];
    private factionNameMap: ReadonlyMap<string, MULFaction> = new Map();
    private normalizedFactionNameMap: ReadonlyMap<string, MULFaction> = new Map();
    private factionIdMap: ReadonlyMap<number, MULFaction> = new Map();

    protected override get catalogKey(): string {
        return 'factions';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/generated/factions.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

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

    public async prepareCachedCatalog(): Promise<PreparedFactionsCatalog | undefined> {
        const transport = await this.prepareCachedTransport();
        return transport ? this.prepareCatalog(transport) : undefined;
    }

    public async prepareRemoteCatalog(
        previous?: PreparedFactionsCatalog,
        signal?: AbortSignal,
    ): Promise<PreparedFactionsCatalog> {
        return this.prepareCatalog(await this.prepareRemoteTransport(previous?.transport, signal));
    }

    /** Rebuilds exact runtime state from an immutable application bundle. */
    public prepareBundledCatalog(data: RawMULFactions): PreparedFactionsCatalog {
        return this.prepareCatalog({ source: 'bundle', data: this.normalizeRawFactions(data) });
    }

    public commitPreparedCatalog(candidate: PreparedFactionsCatalog): void {
        this.factions = candidate.factions;
        this.factionNameMap = candidate.factionNameMap;
        this.normalizedFactionNameMap = candidate.normalizedFactionNameMap;
        this.factionIdMap = candidate.factionIdMap;
        this.markPreparedCatalogCommitted(candidate.transport.data);
    }

    protected override hasHydratedData(): boolean {
        return this.factions.length > 0;
    }

    protected override hydrate(data: MULFactions | RawMULFactions): void {
        const prepared = this.prepareCatalog({ source: 'cache', data: this.normalizeRawFactions(data) });
        this.factions = prepared.factions;
        this.factionNameMap = new Map(prepared.factionNameMap);
        this.normalizedFactionNameMap = new Map(prepared.normalizedFactionNameMap);
        this.factionIdMap = new Map(prepared.factionIdMap);
        this.transportRevision = data.assetHash || '';
    }

    protected override normalizeCachedData(data: MULFactions | RawMULFactions): RawMULFactions {
        return this.normalizeRawFactions(data);
    }

    private prepareCatalog(transport: PreparedCatalogTransport<RawMULFactions>): PreparedFactionsCatalog {
        const rawFactions = transport.data.factions.some((faction) => faction.id === MULFACTION_NONE)
            ? [...transport.data.factions]
            : [...transport.data.factions, this.createNoneFaction()];
        const ids = new Set<number>();
        const names = new Set<string>();
        const factions = rawFactions
            .sort((left, right) => naturalCompare(left.name, right.name))
            .map((faction) => {
                if (!faction?.name || !Number.isSafeInteger(faction.id)
                    || ids.has(faction.id) || names.has(faction.name)) {
                    throw new Error(`Invalid or duplicate faction catalog entry: ${faction?.id ?? '<missing>'}`);
                }
                ids.add(faction.id);
                names.add(faction.name);
                return {
                    ...faction,
                    eras: Object.fromEntries(
                        Object.entries(faction.eras).map(([eraId, units]) => [
                            Number(eraId),
                            this.hydrateEraMembership(units),
                        ]),
                    ) as Record<number, FactionEraMembership>,
                };
            });
        const factionNameMap = new Map<string, MULFaction>();
        const normalizedFactionNameMap = new Map<string, MULFaction>();
        const factionIdMap = new Map<number, MULFaction>();
        for (const faction of factions) {
            factionNameMap.set(faction.name, faction);

            const normalizedName = normalizeLooseText(faction.name);
            if (normalizedName && !normalizedFactionNameMap.has(normalizedName)) {
                normalizedFactionNameMap.set(normalizedName, faction);
            }

            factionIdMap.set(faction.id, faction);
        }
        if (factions.length === 0) throw new Error('Faction catalog prepared to an empty array');
        return Object.freeze({
            transport,
            factions,
            factionNameMap,
            normalizedFactionNameMap,
            factionIdMap,
        });
    }

    protected override normalizeFetchedData(data: RawMULFactions, assetHash: string): RawMULFactions {
        return {
            version: String(data.version),
            assetHash,
            factions: data.factions,
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

    private normalizeRawFactions(data: MULFactions | RawMULFactions): RawMULFactions {
        return {
            version: data.version,
            assetHash: data.assetHash,
            factions: data.factions.map(faction => ({
                ...faction,
                eras: Object.fromEntries(
                    Object.entries(faction.eras).map(([eraId, units]) => [
                        Number(eraId),
                        Array.from(units),
                    ]),
                ),
            })),
        };
    }
}
