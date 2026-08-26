// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';
import type { Quirk, Quirks } from '../../models/quirks.model';
import {
    CatalogBaseService,
    type PreparedCatalogTransport,
} from './catalog-base.service';
import { ImmutableIndex } from '../../models/entity/immutable-collections';

export interface PreparedQuirksCatalog {
    readonly transport: PreparedCatalogTransport<Quirks>;
    readonly quirksByKey: ReadonlyMap<string, Quirk>;
    readonly quirksByName: ReadonlyMap<string, Quirk>;
    readonly contentRevision: string;
}

@Injectable({
    providedIn: 'root'
})
export class QuirksCatalogService extends CatalogBaseService<Quirks, Quirks> {
    private quirksByKey: ReadonlyMap<string, Quirk> = new Map();
    private quirksByName: ReadonlyMap<string, Quirk> = new Map();
    private contentRevision = 'unversioned';

    public override getCatalogRevision(): string {
        return this.contentRevision;
    }

    public getQuirksByKey(): ReadonlyMap<string, Quirk> {
        return this.quirksByKey;
    }

    public async prepareCachedCatalog(): Promise<PreparedQuirksCatalog | undefined> {
        const transport = await this.prepareCachedTransport();
        return transport ? this.prepareCatalog(transport) : undefined;
    }

    public async prepareRemoteCatalog(
        previous?: PreparedQuirksCatalog,
        signal?: AbortSignal,
    ): Promise<PreparedQuirksCatalog> {
        return this.prepareCatalog(await this.prepareRemoteTransport(previous?.transport, signal));
    }

    /** Rebuilds runtime state from a bundle already verified at its trust boundary. */
    public prepareBundledCatalog(
        data: Quirks,
    ): PreparedQuirksCatalog {
        return this.prepareCatalog(Object.freeze({ source: 'bundle' as const, data }));
    }

    public commitPreparedCatalog(candidate: PreparedQuirksCatalog): void {
        this.quirksByKey = candidate.quirksByKey;
        this.quirksByName = candidate.quirksByName;
        this.contentRevision = candidate.contentRevision;
        this.markPreparedCatalogCommitted(candidate.transport.data);
    }

    protected override get catalogKey(): string {
        return 'quirks';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/static/quirks.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

    public getQuirkByKey(key: string): Quirk | undefined {
        return this.quirksByKey.get(key);
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirksByName.get(name);
    }

    protected override hasHydratedData(): boolean {
        return this.quirksByKey.size > 0;
    }

    protected override hydrate(data: Quirks): void {
        const quirksByKey = new Map<string, Quirk>();
        const quirksByName = new Map<string, Quirk>();
        for (const quirk of data.quirks) {
            quirksByKey.set(quirk.key, quirk);
            quirksByName.set(quirk.name, quirk);
        }

        this.quirksByKey = new ImmutableIndex(quirksByKey);
        this.quirksByName = new ImmutableIndex(quirksByName);

        this.transportRevision = data.assetHash || '';
    }

    protected override afterInitialize(): Promise<void> {
        this.contentRevision = this.transportRevision || 'unversioned';
        return Promise.resolve();
    }

    private prepareCatalog(
        transport: PreparedCatalogTransport<Quirks>,
    ): PreparedQuirksCatalog {
        const quirksByKey = new Map<string, Quirk>();
        const quirksByName = new Map<string, Quirk>();
        for (const quirk of transport.data.quirks ?? []) {
            if (!quirk?.key || !quirk.name
                || quirksByKey.has(quirk.key)
                || quirksByName.has(quirk.name)) {
                throw new Error(`Invalid or duplicate quirk catalog entry: ${quirk?.key ?? '<missing>'}`);
            }
            quirksByKey.set(quirk.key, quirk);
            quirksByName.set(quirk.name, quirk);
        }
        if (quirksByKey.size === 0) throw new Error('Quirk catalog prepared to an empty map');
        return {
            transport,
            quirksByKey: new ImmutableIndex(quirksByKey),
            quirksByName: new ImmutableIndex(quirksByName),
            contentRevision: transport.data.assetHash || transport.data.version || 'unversioned',
        };
    }

    protected override normalizeFetchedData(data: Quirks, assetHash: string): Quirks {
        return {
            ...data,
            assetHash,
        };
    }

    protected override getDatasetSize(data: Quirks): number {
        return Array.isArray(data.quirks) ? data.quirks.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 70;
    }
}
