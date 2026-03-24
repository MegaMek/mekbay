import { Injectable, inject } from '@angular/core';

import { DbService } from '../db.service';
import type { Quirk, Quirks } from '../../models/quirks.model';
import { naturalCompare } from '../../utils/sort.util';
import { REMOTE_HOST } from '../../models/common.model';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class QuirksCatalogService extends CatalogBaseService<Quirks, Quirks> {
    private readonly dbService = inject(DbService);

    private quirks = new Map<string, Quirk>();

    protected override get catalogKey(): string {
        return 'quirks';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/quirks.json`;
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirks.get(name);
    }

    protected override hasHydratedData(): boolean {
        return this.quirks.size > 0;
    }

    protected override async loadFromCache(): Promise<Quirks | undefined> {
        return await this.dbService.getQuirks() ?? undefined;
    }

    protected override saveToCache(data: Quirks): Promise<void> {
        return this.dbService.saveQuirks(data);
    }

    protected override hydrate(data: Quirks): void {
        const quirks = [...data.quirks].sort((left, right) => naturalCompare(left.name, right.name));

        this.quirks.clear();
        for (const quirk of quirks) {
            this.quirks.set(quirk.name, quirk);
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Quirks, etag: string): Quirks {
        return {
            ...data,
            etag,
        };
    }
}