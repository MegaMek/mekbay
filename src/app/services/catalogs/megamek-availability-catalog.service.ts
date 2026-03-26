/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import type { Era } from '../../models/eras.model';
import {
    isMegaMekFactionActiveInYearRange,
    type MegaMekFactionRecord,
} from '../../models/megamek/factions.model';
import type { Unit } from '../../models/units.model';
import { naturalCompare } from '../../utils/sort.util';
import { ErasCatalogService } from './eras-catalog.service';
import { MegaMekFactionsCatalogService } from './megamek-factions-catalog.service';
import { FactionId } from '../../models/factions.model';

@Injectable({
    providedIn: 'root'
})
export class MegaMekAvailabilityCatalogService {
    private readonly erasCatalog = inject(ErasCatalogService);
    private readonly megaMekFactionsCatalog = inject(MegaMekFactionsCatalogService);

    private factions: MegaMekFactionRecord[] = [];
    private factionNameMap = new Map<string, MegaMekFactionRecord>();
    private factionIdMap = new Map<string, MegaMekFactionRecord>();
    private factionEraIds = new Map<string, ReadonlySet<number>>();
    private cacheKey = '';

    public getFactions(): MegaMekFactionRecord[] {
        this.ensureIndexes();
        return this.factions;
    }

    public getFactionByName(name: string): MegaMekFactionRecord | undefined {
        this.ensureIndexes();
        return this.factionNameMap.get(name);
    }

    public getFactionById(id: FactionId): MegaMekFactionRecord | undefined {
        if (typeof id !== 'string') {
            return undefined;
        }

        this.ensureIndexes();
        return this.factionIdMap.get(id);
    }

    public isFactionAvailableInEra(faction: MegaMekFactionRecord, eraId: number): boolean {
        this.ensureIndexes();
        return this.factionEraIds.get(faction.id)?.has(eraId) ?? false;
    }

    public getEraUnitIds(era: Era, units: readonly Unit[]): Set<number> {
        const startYear = era.years.from ?? Number.NEGATIVE_INFINITY;
        const endYear = era.years.to ?? Number.POSITIVE_INFINITY;
        return new Set(
            units
                .filter(unit => unit.year >= startYear && unit.year <= endYear)
                .map(unit => unit.id)
        );
    }

    public getFactionEraMembership(
        faction: MegaMekFactionRecord,
        era: Era,
        units: readonly Unit[],
    ): ReadonlySet<number> | undefined {
        if (!this.isFactionAvailableInEra(faction, era.id)) {
            return undefined;
        }

        return this.getEraUnitIds(era, units);
    }

    public getFactionEraMembershipEntries(
        faction: MegaMekFactionRecord,
        eras: readonly Era[],
        units: readonly Unit[],
    ): Array<[number, ReadonlySet<number>]> {
        return eras
            .filter(era => this.isFactionAvailableInEra(faction, era.id))
            .map(era => [era.id, this.getEraUnitIds(era, units)]);
    }

    public getFactionUnitIds(
        faction: MegaMekFactionRecord,
        eras: readonly Era[],
        units: readonly Unit[],
        contextEraIds?: ReadonlySet<number>,
    ): Set<number> {
        const unitIds = new Set<number>();

        for (const [eraId, eraUnits] of this.getFactionEraMembershipEntries(faction, eras, units)) {
            if (contextEraIds && !contextEraIds.has(eraId)) {
                continue;
            }

            for (const unitId of eraUnits) {
                unitIds.add(unitId);
            }
        }

        return unitIds;
    }

    private ensureIndexes(): void {
        const eras = this.erasCatalog.getEras();
        const factions = Object.values(this.megaMekFactionsCatalog.getFactions());
        const nextCacheKey = `${eras.map(era => `${era.id}:${era.years.from ?? ''}:${era.years.to ?? ''}`).join('|')}::${factions.length}`;
        if (this.cacheKey === nextCacheKey) {
            return;
        }

        const sortedFactions = [...factions].sort((left, right) => naturalCompare(left.name, right.name));

        this.factions = sortedFactions;
        this.factionNameMap.clear();
        this.factionIdMap.clear();
        this.factionEraIds.clear();

        for (const faction of sortedFactions) {
            this.factionNameMap.set(faction.name, faction);
            this.factionIdMap.set(faction.id, faction);
            this.factionEraIds.set(
                faction.id,
                new Set(
                    eras
                        .filter(era => isMegaMekFactionActiveInYearRange(faction, era.years.from, era.years.to))
                        .map(era => era.id)
                )
            );
        }

        this.cacheKey = nextCacheKey;
    }
}