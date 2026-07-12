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

    protected override getDatasetSize(data: RawEquipmentData): number {
        return Object.keys(data.equipment ?? {}).length;
    }

    protected override getMinimumDatasetSize(): number {
        return 4000;
    }
}