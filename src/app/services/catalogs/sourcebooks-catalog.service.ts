// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { Sourcebook, Sourcebooks } from '../../models/sourcebook.model';
import {
    CatalogBaseService,
    type PreparedCatalogTransport,
} from './catalog-base.service';
import { ImmutableIndex } from '../../models/entity/immutable-collections';

export interface PreparedSourcebooksCatalog {
    readonly transport: PreparedCatalogTransport<Sourcebooks>;
    readonly sourcebooksByAbbrev: ReadonlyMap<string, Sourcebook>;
    readonly contentRevision: string;
}

@Injectable({
    providedIn: 'root'
})
export class SourcebooksCatalogService extends CatalogBaseService<Sourcebooks | Sourcebook[], Sourcebooks, Sourcebooks | Sourcebook[]> {
    private sourcebooks: ReadonlyMap<string, Sourcebook> = new Map();
    private contentRevision = 'unversioned';

    public override getCatalogRevision(): string {
        return this.contentRevision;
    }

    public getSourcebooks(): ReadonlyMap<string, Sourcebook> {
        return this.sourcebooks;
    }

    public async prepareCachedCatalog(): Promise<PreparedSourcebooksCatalog | undefined> {
        const transport = await this.prepareCachedTransport();
        return transport ? this.prepareCatalog(transport) : undefined;
    }

    public async prepareRemoteCatalog(
        previous?: PreparedSourcebooksCatalog,
        signal?: AbortSignal,
    ): Promise<PreparedSourcebooksCatalog> {
        return this.prepareCatalog(await this.prepareRemoteTransport(previous?.transport, signal));
    }

    /** Rebuilds runtime state from a bundle already verified at its trust boundary. */
    public prepareBundledCatalog(
        data: Sourcebooks,
    ): PreparedSourcebooksCatalog {
        return this.prepareCatalog(Object.freeze({ source: 'bundle' as const, data }));
    }

    public commitPreparedCatalog(candidate: PreparedSourcebooksCatalog): void {
        this.sourcebooks = candidate.sourcebooksByAbbrev;
        this.contentRevision = candidate.contentRevision;
        this.markPreparedCatalogCommitted(candidate.transport.data);
    }

    protected override get catalogKey(): string {
        return 'sourcebooks';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/generated/sourcebooks.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

    public getSourcebookByAbbrev(abbrev: string): Sourcebook | undefined {
        return this.sourcebooks.get(abbrev);
    }

    public getSourcebookTitle(abbrev: string): string {
        return this.sourcebooks.get(abbrev)?.title ?? abbrev;
    }

    protected override hasHydratedData(): boolean {
        return this.sourcebooks.size > 0;
    }

    protected override hydrate(data: Sourcebooks | Sourcebook[]): void {
        const wrappedData = this.wrapData(data, (data as Partial<Sourcebooks>).assetHash || '');

        const sourcebooks = new Map<string, Sourcebook>();
        for (const sourcebook of wrappedData.sourcebooks) {
            sourcebooks.set(sourcebook.abbrev, sourcebook);
        }

        this.sourcebooks = new ImmutableIndex(sourcebooks);

        this.transportRevision = wrappedData.assetHash;
    }

    protected override afterInitialize(): Promise<void> {
        this.contentRevision = this.transportRevision || 'unversioned';
        return Promise.resolve();
    }

    protected override normalizeCachedData(data: Sourcebooks | Sourcebook[]): Sourcebooks {
        return this.wrapData(data, (data as Partial<Sourcebooks>).assetHash || '');
    }

    private prepareCatalog(
        transport: PreparedCatalogTransport<Sourcebooks>,
    ): PreparedSourcebooksCatalog {
        const sourcebooksByAbbrev = new Map<string, Sourcebook>();
        const ids = new Set<number>();
        for (const sourcebook of transport.data.sourcebooks ?? []) {
            if (!sourcebook?.abbrev || !Number.isSafeInteger(sourcebook.id)
                || ids.has(sourcebook.id) || sourcebooksByAbbrev.has(sourcebook.abbrev)) {
                throw new Error(`Invalid or duplicate sourcebook catalog entry: ${sourcebook?.abbrev ?? '<missing>'}`);
            }
            ids.add(sourcebook.id);
            sourcebooksByAbbrev.set(sourcebook.abbrev, sourcebook);
        }
        if (sourcebooksByAbbrev.size === 0) throw new Error('Sourcebook catalog prepared to an empty map');
        return {
            transport,
            sourcebooksByAbbrev: new ImmutableIndex(sourcebooksByAbbrev),
            contentRevision: transport.data.assetHash || 'unversioned',
        };
    }

    protected override normalizeFetchedData(data: Sourcebooks | Sourcebook[], assetHash: string): Sourcebooks {
        return this.wrapData(data, assetHash);
    }

    protected override getDatasetSize(data: Sourcebooks | Sourcebook[]): number {
        return this.wrapData(data, '').sourcebooks.length;
    }

    private wrapData(data: Sourcebooks | Sourcebook[], assetHash: string): Sourcebooks {
        if (Array.isArray(data)) {
            return {
                assetHash,
                sourcebooks: data,
            };
        }

        return {
            assetHash,
            sourcebooks: data.sourcebooks,
        };
    }
}
