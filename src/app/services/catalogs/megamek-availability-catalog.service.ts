// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { UnitSummary } from '../../models/unit-summary.model';
import {
    type MegaMekAvailabilityData,
    type MegaMekWeightedAvailabilityRecord,
    type MegaMekWeightedAvailabilityValue,
} from '../../models/megamek/availability.model';
import { CatalogBaseService } from './catalog-base.service';

function isMegaMekAvailabilityData(
    data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[],
): data is MegaMekAvailabilityData {
    return 'assetHash' in data && 'records' in data;
}

@Injectable({
    providedIn: 'root'
})
export class MegaMekAvailabilityCatalogService extends CatalogBaseService<MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[], MegaMekAvailabilityData, MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[]> {
    private records: MegaMekWeightedAvailabilityRecord[] = [];
    private recordsByUnitName = new Map<string, MegaMekWeightedAvailabilityRecord>();

    protected override get catalogKey(): string {
        return 'megamek_availability';
    }

    protected override get remoteUrl(): string {
        return 'online-assets/generated/mulized_availability_weighted.json';
    }

    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

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

        this.transportRevision = wrappedData.assetHash;
    }

    protected override normalizeFetchedData(
        data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[],
        assetHash: string,
    ): MegaMekAvailabilityData {
        return this.wrapData(data, assetHash);
    }

    protected override getDatasetSize(data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[]): number {
        return this.wrapData(data, '').records.length;
    }

    private wrapData(
        data: MegaMekAvailabilityData | MegaMekWeightedAvailabilityRecord[],
        assetHash: string,
    ): MegaMekAvailabilityData {
        if (isMegaMekAvailabilityData(data)) {
            return {
                assetHash,
                records: data.records,
            };
        }

        return {
            assetHash,
            records: data,
        };
    }
}
