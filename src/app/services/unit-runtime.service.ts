import { Injectable, inject } from '@angular/core';

import type { Era } from '../models/eras.model';
import type { Unit, UnitComponent } from '../models/units.model';
import type { EquipmentMap } from '../models/equipment.model';
import type { TagData } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';
import { MulUnitSourcesCatalogService } from './catalogs/mul-unit-sources-catalog.service';
import { UnitSearchIndexService } from './unit-search-index.service';

@Injectable({
    providedIn: 'root'
})
export class UnitRuntimeService {
    private readonly tagsService = inject(TagsService);
    private readonly publicTagsService = inject(PublicTagsService);
    private readonly mulUnitSourcesCatalog = inject(MulUnitSourcesCatalogService);
    private readonly unitSearchIndexService = inject(UnitSearchIndexService);

    private unitNameMap = new Map<string, Unit>();

    public preprocessUnits(units: Unit[]): void {
        this.unitNameMap.clear();
        for (const unit of units) {
            this.unitNameMap.set(unit.name, unit);
        }
        this.unitSearchIndexService.prepareUnits(units);
    }

    public postprocessUnits(units: Unit[], eras: Era[]): void {
        for (const unit of units) {
            unit._era = this.findEraForYear(unit.year, eras);
            unit.source = this.mergeUnitSources(unit.source, this.mulUnitSourcesCatalog.getUnitSourcesByMulId(unit.id));
        }

        void this.loadUnitTags(units);
    }

    public linkEquipmentToUnits(units: Unit[], equipment: EquipmentMap): void {
        for (const unit of units) {
            if (!unit.comp) {
                continue;
            }

            this.linkEquipmentToComponents(unit.comp, equipment);
        }
    }

    public async loadUnitTags(units: Unit[]): Promise<void> {
        const tagData = await this.tagsService.getTagData();
        this.applyTagDataToUnits(units, tagData);
    }

    public applyTagDataToUnits(units: Unit[], tagData: TagData | null): void {
        const tags = tagData?.tags || {};

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);
            unit._nameTags = Object.values(tags)
                .filter(entry => entry.units[unit.name] !== undefined)
                .map(entry => entry.label);
            unit._chassisTags = Object.values(tags)
                .filter(entry => entry.chassis[chassisKey] !== undefined)
                .map(entry => entry.label);
        }

        this.unitSearchIndexService.rebuildTagSearchIndex(units);
    }

    public applyPublicTagsToUnits(units: Unit[]): void {
        for (const unit of units) {
            unit._publicTags = this.publicTagsService.getPublicTagsForUnit(unit);
        }

        this.unitSearchIndexService.rebuildTagSearchIndex(units);
    }

    public getUnitByName(name: string): Unit | undefined {
        return this.unitNameMap.get(name);
    }

    private findEraForYear(year: number, eras: Era[]): Era | undefined {
        for (const era of eras) {
            const from = era.years.from ?? Number.MIN_SAFE_INTEGER;
            const to = era.years.to ?? Number.MAX_SAFE_INTEGER;
            if (year >= from && year <= to) {
                return era;
            }
        }

        return undefined;
    }

    private mergeUnitSources(originalSource: string | string[] | undefined, mulSources: string[] | undefined): string[] {
        const sourcesSet = new Set<string>();

        if (Array.isArray(originalSource)) {
            originalSource.forEach(source => sourcesSet.add(source));
        } else if (originalSource) {
            sourcesSet.add(originalSource);
        }

        mulSources?.forEach(source => sourcesSet.add(source));

        return Array.from(sourcesSet);
    }

    private linkEquipmentToComponents(components: UnitComponent[], equipment: EquipmentMap): void {
        for (const component of components) {
            if (component.id) {
                component.eq = equipment[component.id];
            }
            if (component.bay) {
                this.linkEquipmentToComponents(component.bay, equipment);
            }
        }
    }
}