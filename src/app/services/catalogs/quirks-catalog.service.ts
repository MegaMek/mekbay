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

    protected override getDatasetSize(data: Quirks): number {
        return Array.isArray(data.quirks) ? data.quirks.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 70;
    }
}