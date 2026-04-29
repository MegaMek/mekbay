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
import type { Era } from '../models/eras.model';
import type { Unit, UnitComponent, UnitTagEntry } from '../models/units.model';
import type { EquipmentMap } from '../models/equipment.model';
import type { TagData, UnitTagData } from './db.service';
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

    private static getUnitNameKey(name: string): string {
        return name.toLowerCase();
    }

    public preprocessUnits(units: Unit[]): void {
        this.unitNameMap.clear();
        for (const unit of units) {
            this.unitNameMap.set(UnitRuntimeService.getUnitNameKey(unit.name), unit);
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

    public applyTagDataToUnits(
        units: Unit[],
        tagData: TagData | null,
        options?: { rebuildTagSearchIndex?: boolean }
    ): void {
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