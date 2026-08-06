// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import type { Era } from '../models/eras.model';
import type { Unit, UnitComponent, UnitTagEntry } from '../models/units.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import type { TagData, UnitTagData } from './db.service';
import { TagsService } from './tags.service';
import { PublicTagsService } from './public-tags.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { getUnitTechBaseDisplay } from '../models/tech.model';

@Injectable({
    providedIn: 'root'
})
export class UnitRuntimeService {
    private readonly tagsService = inject(TagsService);
    private readonly publicTagsService = inject(PublicTagsService);
    private readonly unitSearchIndexService = inject(UnitSearchIndexService);

    private unitNameMap = new Map<string, Unit>();

    private static getUnitNameKey(name: string): string {
        return name.toLowerCase();
    }

    public preprocessUnits(units: Unit[]): void {
        this.unitNameMap.clear();
        for (const unit of units) {
            unit._techBaseDisplay = getUnitTechBaseDisplay(unit);
            this.unitNameMap.set(UnitRuntimeService.getUnitNameKey(unit.name), unit);
        }
        this.unitSearchIndexService.prepareUnits(units);
    }

    public postprocessUnits(units: Unit[], eras: Era[]): void {
        for (const unit of units) {
            unit._era = this.findEraForYear(unit.year, eras);
        }

        void this.loadUnitTags(units);
    }

    public linkEquipmentToUnits(units: Unit[], equipmentRegistry: EquipmentRegistry): void {
        for (const unit of units) {
            if (!unit.comp) {
                continue;
            }

            this.linkEquipmentToComponents(unit.comp, equipmentRegistry);
        }
    }

    public async loadUnitTags(units: Unit[]): Promise<void> {
        const tagData = await this.tagsService.migrateChassisTagsToVariantGroups(units);
        this.applyTagDataToUnits(units, tagData);
    }

    public applyTagDataToUnits(
        units: Unit[],
        tagData: TagData | null,
        options?: { rebuildTagSearchIndex?: boolean }
    ): void {
        if (tagData) {
            void this.tagsService.migrateChassisTagsToVariantGroups(units, tagData);
        }

        void this.tagsService.fixNameTagsCoveredByChassis(units, tagData);
        const tags = tagData?.tags || {};

        for (const unit of units) {
            const chassisKey = TagsService.getChassisTagKey(unit);
            unit._nameTags = Object.values(tags)
                .filter(entry => entry.units[unit.name] !== undefined)
                .map(entry => ({
                    tag: entry.label,
                    quantity: this.getTagQuantity(entry.units[unit.name])
                } as UnitTagEntry));
            unit._chassisTags = Object.values(tags)
                .filter(entry => entry.chassis[chassisKey] !== undefined)
                .map(entry => ({
                    tag: entry.label,
                    quantity: this.getTagQuantity(entry.chassis[chassisKey])
                } as UnitTagEntry));
        }

        if (options?.rebuildTagSearchIndex ?? true) {
            this.unitSearchIndexService.rebuildTagSearchIndex(units);
        }
    }

    private getTagQuantity(unitTagData: UnitTagData | undefined): number {
        const quantity = unitTagData?.q;
        return quantity && quantity > 0 ? quantity : 1;
    }

    public applyPublicTagsToUnits(units: Unit[]): void {
        for (const unit of units) {
            unit._publicTags = this.publicTagsService.getPublicTagsForUnit(unit);
        }

        this.unitSearchIndexService.rebuildTagSearchIndex(units);
    }

    public getUnitByName(name: string): Unit | undefined {
        return this.unitNameMap.get(UnitRuntimeService.getUnitNameKey(name));
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

    private linkEquipmentToComponents(components: UnitComponent[], equipmentRegistry: EquipmentRegistry): void {
        for (const component of components) {
            if (component.id) {
                component.eq = equipmentRegistry.findEquipment(component.id) ?? undefined;
            }
            if (component.bay) {
                this.linkEquipmentToComponents(component.bay, equipmentRegistry);
            }
        }
    }
}