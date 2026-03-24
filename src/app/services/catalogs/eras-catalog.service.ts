import { Injectable, inject } from '@angular/core';

import { REMOTE_HOST } from '../../models/common.model';
import type { Era, Eras } from '../../models/eras.model';
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
        const eras = [...data.eras].sort((left, right) => this.compareEras(left, right));

        this.eras = eras;
        this.eraNameMap.clear();
        this.eraIdMap.clear();

        for (const era of eras) {
            this.eraNameMap.set(era.name, era);
            this.eraIdMap.set(era.id, era);
            era.factions = new Set(era.factions as Iterable<number>);
            era.units = new Set(era.units as Iterable<number>);
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: Eras, etag: string): Eras {
        return {
            ...data,
            etag,
        };
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
}