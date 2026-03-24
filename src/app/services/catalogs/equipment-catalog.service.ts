import { Injectable, inject } from '@angular/core';

import { REMOTE_HOST } from '../../models/common.model';
import { type Equipment, type EquipmentData, type EquipmentMap, type RawEquipmentData, createEquipment } from '../../models/equipment.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class EquipmentCatalogService extends CatalogBaseService<EquipmentData, EquipmentData, RawEquipmentData> {
    private readonly dbService = inject(DbService);
    private readonly catalogLogger = inject(LoggerService);

    private equipment: EquipmentMap = {};

    protected override get catalogKey(): string {
        return 'equipment';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/equipment2.json`;
    }

    public getEquipments(): EquipmentMap {
        return this.equipment;
    }

    public getEquipmentByName(internalName: string): Equipment | undefined {
        return this.equipment[internalName];
    }

    protected override hasHydratedData(): boolean {
        return Object.keys(this.equipment).length > 0;
    }

    protected override async loadFromCache(): Promise<EquipmentData | undefined> {
        return await this.dbService.getEquipments() ?? undefined;
    }

    protected override saveToCache(data: EquipmentData): Promise<void> {
        return this.dbService.saveEquipment(data);
    }

    protected override hydrate(data: EquipmentData): void {
        this.equipment = data.equipment;
        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: RawEquipmentData, etag: string): EquipmentData {
        const normalized: EquipmentData = {
            version: data.version,
            etag,
            equipment: {}
        };

        for (const [internalName, rawEquipment] of Object.entries(data.equipment)) {
            try {
                normalized.equipment[internalName] = createEquipment(rawEquipment);
            } catch (error) {
                this.catalogLogger.error(`Failed to create equipment ${internalName}: ${error}`);
            }
        }

        return normalized;
    }
}