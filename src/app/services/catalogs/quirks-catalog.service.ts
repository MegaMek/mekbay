// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import { DbService } from '../db.service';
import type { Quirk, Quirks } from '../../models/quirks.model';
import { REMOTE_HOST } from '../../models/common.model';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class QuirksCatalogService extends CatalogBaseService<Quirks, Quirks> {
    private readonly dbService = inject(DbService);

    private quirksByKey = new Map<string, Quirk>();
    private quirksByName = new Map<string, Quirk>();

    protected override get catalogKey(): string {
        return 'quirks';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/quirks.json`;
    }

    public getQuirkByKey(key: string): Quirk | undefined {
        return this.quirksByKey.get(key);
    }

    public getQuirkByName(name: string): Quirk | undefined {
        return this.quirksByName.get(name);
    }

    protected override hasHydratedData(): boolean {
        return this.quirksByKey.size > 0;
    }

    protected override async loadFromCache(): Promise<Quirks | undefined> {
        return await this.dbService.getQuirks() ?? undefined;
    }

    protected override saveToCache(data: Quirks): Promise<void> {
        return this.dbService.saveQuirks(data);
    }

    protected override hydrate(data: Quirks): void {
        this.quirksByKey.clear();
        this.quirksByName.clear();
        for (const quirk of data.quirks) {
            this.quirksByKey.set(quirk.key, quirk);
            this.quirksByName.set(quirk.name, quirk);
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Quirks, etag: string): Quirks {
        return {
            ...data,
            etag,
        };
    }

    protected override getDatasetSize(data: Quirks): number {
        return Array.isArray(data.quirks) ? data.quirks.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 70;
    }
}