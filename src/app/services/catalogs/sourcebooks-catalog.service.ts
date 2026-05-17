/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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

    protected override getDatasetSize(data: Sourcebooks | Sourcebook[]): number {
        return this.wrapData(data, '').sourcebooks.length;
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