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

import type { Unit } from '../../models/units.model';
import {
    type MegaMekAvailabilityData,
    type MegaMekWeightedAvailabilityRecord,
    type MegaMekWeightedAvailabilityValue,
} from '../../models/megamek/availability.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

function isMegaMekAvailabilityData(
    data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[],
): data is MegaMekAvailabilityData {
    return 'etag' in data && 'records' in data;
}

@Injectable({
    providedIn: 'root'
})
export class MegaMekAvailabilityCatalogService extends CatalogBaseService<MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[], MegaMekAvailabilityData, MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[]> {
    private readonly dbService = inject(DbService);

    private records: MegaMekWeightedAvailabilityRecord[] = [];
    private recordsByUnitName = new Map<string, MegaMekWeightedAvailabilityRecord>();

    protected override get catalogKey(): string {
        return 'megamek_availability';
    }

    protected override get remoteUrl(): string {
        return 'assets/mulized_availability_weighted.json';
    }

    public getRecords(): readonly MegaMekWeightedAvailabilityRecord[] {
        return this.records;
    }

    public getRecordForUnit(unit: Pick<Unit, 'name'>): MegaMekWeightedAvailabilityRecord | undefined {
        return this.recordsByUnitName.get(unit.name);
    }

    public getAvailabilityForUnit(
        unit: Pick<Unit, 'name'>,
        eraId: number,
        factionId: number,
    ): MegaMekWeightedAvailabilityValue | undefined {
        return this.getRecordForUnit(unit)?.e[String(eraId)]?.[String(factionId)];
    }

    protected override hasHydratedData(): boolean {
        return this.records.length > 0;
    }

    protected override async loadFromCache(): Promise<MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[] | undefined> {
        return await this.dbService.getMegaMekAvailability() ?? undefined;
    }

    protected override saveToCache(data: MegaMekAvailabilityData): Promise<void> {
        return this.dbService.saveMegaMekAvailability(data);
    }

    protected override hydrate(data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[]): void {
        const wrappedData = isMegaMekAvailabilityData(data)
            ? data
            : this.wrapData(data, '');

        this.records = wrappedData.records;
        this.recordsByUnitName.clear();

        for (const record of wrappedData.records) {
            if (record.n) {
                this.recordsByUnitName.set(record.n, record);
            }
        }

        this.etag = wrappedData.etag;
    }

    protected override normalizeFetchedData(
        data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[],
        etag: string,
    ): MegaMekAvailabilityData {
        return this.wrapData(data, etag);
    }

    private wrapData(
        data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[],
        etag: string,
    ): MegaMekAvailabilityData {
        if (isMegaMekAvailabilityData(data)) {
            return {
                etag,
                records: data.records,
            };
        }

        return {
            etag,
            records: data,
        };
    }
}