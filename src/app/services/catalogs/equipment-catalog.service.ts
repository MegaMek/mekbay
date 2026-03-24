import { Injectable, inject } from '@angular/core';

import { REMOTE_HOST } from '../../models/common.model';
import { type Equipment, type EquipmentMap, type RawEquipmentData, createEquipment } from '../../models/equipment.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class EquipmentCatalogService extends CatalogBaseService<RawEquipmentData, RawEquipmentData, RawEquipmentData> {
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

    protected override async loadFromCache(): Promise<RawEquipmentData | undefined> {
        return await this.dbService.getEquipments() ?? undefined;
    }

    protected override saveToCache(data: RawEquipmentData): Promise<void> {
        return this.dbService.saveEquipment(data);
    }

    protected override hydrate(data: RawEquipmentData): void {
        const normalizedEquipment: EquipmentMap = {};

        for (const [internalName, cachedEquipment] of Object.entries(data.equipment ?? {})) {
            try {
                normalizedEquipment[internalName] = createEquipment(cachedEquipment);
            } catch (error) {
                this.catalogLogger.error(`Failed to hydrate cached equipment ${internalName}: ${error}`);
            }
        }

        this.equipment = normalizedEquipment;
        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: RawEquipmentData, etag: string): RawEquipmentData {
        return {
            ...data,
            etag,
        };
    }
}