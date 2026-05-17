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
import { REMOTE_HOST } from '../../models/common.model';
import type { Unit, Units } from '../../models/units.model';
import { DbService } from '../db.service';
import { UnitRuntimeService } from '../unit-runtime.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class UnitsCatalogService extends CatalogBaseService<Units, Units> {
    private readonly dbService = inject(DbService);
    private readonly unitRuntimeService = inject(UnitRuntimeService);

    private units: Unit[] = [];

    protected override get catalogKey(): string {
        return 'units';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/units.json`;
    }

    public getUnits(): Unit[] {
        return this.units;
    }

    protected override hasHydratedData(): boolean {
        return this.units.length > 0;
    }

    protected override async loadFromCache(): Promise<Units | undefined> {
        return await this.dbService.getUnits() ?? undefined;
    }

    protected override saveToCache(data: Units): Promise<void> {
        return this.dbService.saveUnits(data);
    }

    protected override hydrate(data: Units): void {
        this.units = data.units;
        this.unitRuntimeService.preprocessUnits(this.units);
        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Units, etag: string): Units {
        return {
            ...data,
            etag,
        };
    }

    protected override getDatasetSize(data: Units): number {
        return Array.isArray(data.units) ? data.units.length : 0;
    }

    protected override getMinimumDatasetSize(): number {
        return 9000;
    }
}