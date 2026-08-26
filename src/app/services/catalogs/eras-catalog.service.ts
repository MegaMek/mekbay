// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { Era, EraMembership, Eras } from '../../models/eras.model';
import {
    CatalogBaseService,
    type PreparedCatalogTransport,
} from './catalog-base.service';

export interface PreparedErasCatalog {
    readonly transport: PreparedCatalogTransport<Eras>;
    readonly eras: Era[];
    readonly eraNameMap: ReadonlyMap<string, Era>;
    readonly eraIdMap: ReadonlyMap<number, Era>;
}

@Injectable({
    providedIn: 'root'
})
export class ErasCatalogService extends CatalogBaseService<Eras, Eras> {
    private eras: Era[] = [];
    private eraNameMap: ReadonlyMap<string, Era> = new Map();
    private eraIdMap: ReadonlyMap<number, Era> = new Map();

    protected override get catalogKey(): string {
        return 'eras';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/generated/eras.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

    public getEras(): Era[] {
        return this.eras;
    }

    public getEraByName(name: string): Era | undefined {
        return this.eraNameMap.get(name);
    }

    public getEraById(id: number): Era | undefined {
        return this.eraIdMap.get(id);
    }

    public async prepareCachedCatalog(): Promise<PreparedErasCatalog | undefined> {
        const transport = await this.prepareCachedTransport();
        return transport ? this.prepareCatalog(transport) : undefined;
    }

    public async prepareRemoteCatalog(
        previous?: PreparedErasCatalog,
        signal?: AbortSignal,
    ): Promise<PreparedErasCatalog> {
        return this.prepareCatalog(await this.prepareRemoteTransport(previous?.transport, signal));
    }

    /** Rebuilds exact runtime state from an immutable application bundle. */
    public prepareBundledCatalog(data: Eras): PreparedErasCatalog {
        return this.prepareCatalog({ source: 'bundle', data });
    }

    public commitPreparedCatalog(candidate: PreparedErasCatalog): void {
        this.eras = candidate.eras;
        this.eraNameMap = candidate.eraNameMap;
        this.eraIdMap = candidate.eraIdMap;
        this.markPreparedCatalogCommitted(candidate.transport.data);
    }

    protected override hasHydratedData(): boolean {
        return this.eras.length > 0;
    }

    protected override hydrate(data: Eras): void {
        const prepared = this.prepareCatalogSync({ source: 'cache', data });
        this.eras = prepared.eras;
        this.eraNameMap = new Map(prepared.eraNameMap);
        this.eraIdMap = new Map(prepared.eraIdMap);
        this.transportRevision = data.assetHash || '';
    }

    protected override normalizeFetchedData(data: Eras, assetHash: string): Eras {
        return {
            version: String(data.version),
            assetHash,
            eras: data.eras,
        };
    }

    protected override getDatasetSize(data: Eras): number {
        return Array.isArray(data.eras) ? data.eras.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 12;
    }

    private compareEras(left: Era, right: Era): number {
        const leftFrom = left.years.from ?? 0;
        const rightFrom = right.years.from ?? 0;
        if (leftFrom !== rightFrom) {
            return leftFrom - rightFrom;
        }

        const leftTo = left.years.to ?? Number.MAX_SAFE_INTEGER;
        const rightTo = right.years.to ?? Number.MAX_SAFE_INTEGER;
        if (leftTo !== rightTo) {
            return leftTo - rightTo;
        }

        return left.id - right.id;
    }

    private hydrateMembership(values: EraMembership): EraMembership {
        return values instanceof Set ? new Set(values) : new Set(values);
    }

    private prepareCatalog(transport: PreparedCatalogTransport<Eras>): PreparedErasCatalog {
        return this.prepareCatalogSync(transport);
    }

    private prepareCatalogSync(transport: PreparedCatalogTransport<Eras>): PreparedErasCatalog {
        const ids = new Set<number>();
        const names = new Set<string>();
        const eras = [...(transport.data.eras ?? [])]
            .sort((left, right) => this.compareEras(left, right))
            .map((era) => {
                if (!era?.name || !Number.isSafeInteger(era.id)
                    || ids.has(era.id) || names.has(era.name)) {
                    throw new Error(`Invalid or duplicate era catalog entry: ${era?.id ?? '<missing>'}`);
                }
                ids.add(era.id);
                names.add(era.name);
                return {
                    ...era,
                    factions: this.hydrateMembership(era.factions),
                    units: this.hydrateMembership(era.units),
                };
            });
        if (eras.length === 0) throw new Error('Era catalog prepared to an empty array');
        return Object.freeze({
            transport,
            eras,
            eraNameMap: new Map(eras.map(era => [era.name, era])),
            eraIdMap: new Map(eras.map(era => [era.id, era])),
        });
    }
}
