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
}