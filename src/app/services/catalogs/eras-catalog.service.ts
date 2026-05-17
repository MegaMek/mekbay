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
import type { Era, EraMembership, Eras } from '../../models/eras.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class ErasCatalogService extends CatalogBaseService<Eras, Eras> {
    private readonly dbService = inject(DbService);

    private eras: Era[] = [];
    private eraNameMap = new Map<string, Era>();
    private eraIdMap = new Map<number, Era>();

    protected override get catalogKey(): string {
        return 'eras';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/eras.json`;
    }

    public getEras(): Era[] {
        return this.eras;
    }

    public getEraByName(name: string): Era | undefined {
        return this.eraNameMap.get(name);
    }

    public getEraById(id: number): Era | undefined {
        return this.eraIdMap.get(id);
    }

    protected override hasHydratedData(): boolean {
        return this.eras.length > 0;
    }

    protected override async loadFromCache(): Promise<Eras | undefined> {
        return await this.dbService.getEras() ?? undefined;
    }

    protected override saveToCache(data: Eras): Promise<void> {
        return this.dbService.saveEras(data);
    }

    protected override hydrate(data: Eras): void {
        const eras = [...data.eras]
            .sort((left, right) => this.compareEras(left, right))
            .map((era) => ({
                ...era,
                factions: this.hydrateMembership(era.factions),
                units: this.hydrateMembership(era.units),
            }));

        this.eras = eras;
        this.eraNameMap.clear();
        this.eraIdMap.clear();

        for (const era of eras) {
            this.eraNameMap.set(era.name, era);
            this.eraIdMap.set(era.id, era);
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Eras, etag: string): Eras {
        return {
            ...data,
            etag,
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
}