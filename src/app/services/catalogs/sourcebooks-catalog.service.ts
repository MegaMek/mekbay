import { Injectable, inject } from '@angular/core';

import { DbService } from '../db.service';
import type { Sourcebook, Sourcebooks } from '../../models/sourcebook.model';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class SourcebooksCatalogService extends CatalogBaseService<Sourcebooks | Sourcebook[], Sourcebooks, Sourcebooks | Sourcebook[]> {
    private readonly dbService = inject(DbService);

    private sourcebooks = new Map<string, Sourcebook>();

    protected override get catalogKey(): string {
        return 'sourcebooks';
    }

    protected override get remoteUrl(): string {
        return 'assets/sourcebooks.json';
    }

    public getSourcebookByAbbrev(abbrev: string): Sourcebook | undefined {
        return this.sourcebooks.get(abbrev);
    }

    public getSourcebookTitle(abbrev: string): string {
        return this.sourcebooks.get(abbrev)?.title ?? abbrev;
    }

    protected override hasHydratedData(): boolean {
        return this.sourcebooks.size > 0;
    }

    protected override async loadFromCache(): Promise<Sourcebooks | undefined> {
        return await this.dbService.getSourcebooks() ?? undefined;
    }

    protected override saveToCache(data: Sourcebooks): Promise<void> {
        return this.dbService.saveSourcebooks(data);
    }

    protected override hydrate(data: Sourcebooks | Sourcebook[]): void {
        const wrappedData = this.wrapData(data, (data as Partial<Sourcebooks>).etag || '');

        this.sourcebooks.clear();
        for (const sourcebook of wrappedData.sourcebooks) {
            this.sourcebooks.set(sourcebook.abbrev, sourcebook);
        }

        this.etag = wrappedData.etag;
    }

    protected override normalizeFetchedData(data: Sourcebooks | Sourcebook[], etag: string): Sourcebooks {
        return this.wrapData(data, etag);
    }

    private wrapData(data: Sourcebooks | Sourcebook[], etag: string): Sourcebooks {
        if (Array.isArray(data)) {
            return {
                etag,
                sourcebooks: data,
            };
        }

        return {
            etag,
            sourcebooks: data.sourcebooks,
        };
    }
}