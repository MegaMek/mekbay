// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import type { UnitSummary } from '../../models/unit-summary.model';
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

    public getRecordForUnit(unit: Pick<UnitSummary, 'name'>): MegaMekWeightedAvailabilityRecord | undefined {
        return this.recordsByUnitName.get(unit.name);
    }

    public getAvailabilityForUnit(
        unit: Pick<UnitSummary, 'name'>,
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

    protected override getDatasetSize(data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[]): number {
        return this.wrapData(data, '').records.length;
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