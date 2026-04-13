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

import { REMOTE_HOST } from '../../models/common.model';
import type { FactionEraMembership, MULFaction, MULFactions, RawFactionEraMembership, RawMULFactions } from '../../models/mulfactions.model';
import { normalizeLooseText } from '../../utils/string.util';
import { naturalCompare } from '../../utils/sort.util';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

@Injectable({
    providedIn: 'root'
})
export class FactionsCatalogService extends CatalogBaseService<MULFactions | RawMULFactions, RawMULFactions, RawMULFactions> {
    private readonly dbService = inject(DbService);

    private factions: MULFaction[] = [];
    private factionNameMap = new Map<string, MULFaction>();
    private normalizedFactionNameMap = new Map<string, MULFaction>();
    private factionIdMap = new Map<number, MULFaction>();

    protected override get catalogKey(): string {
        return 'factions';
    }

    protected override get remoteUrl(): string {
        return `${REMOTE_HOST}/factions.json`;
    }

    public getFactions(): MULFaction[] {
        return this.factions;
    }

    public getFactionByName(name: string): MULFaction | undefined {
        return this.factionNameMap.get(name)
            ?? this.normalizedFactionNameMap.get(normalizeLooseText(name));
    }

    public getFactionById(id: number): MULFaction | undefined {
        return this.factionIdMap.get(id);
    }

    protected override hasHydratedData(): boolean {
        return this.factions.length > 0;
    }

    protected override async loadFromCache(): Promise<MULFactions | RawMULFactions | undefined> {
        return await this.dbService.getFactions() ?? undefined;
    }

    protected override saveToCache(data: RawMULFactions): Promise<void> {
        return this.dbService.saveFactions(data);
    }

    protected override hydrate(data: MULFactions | RawMULFactions): void {
        const factions = [...data.factions]
            .sort((left, right) => naturalCompare(left.name, right.name))
            .map((faction) => ({
                ...faction,
                eras: Object.fromEntries(
                    Object.entries(faction.eras).map(([eraId, units]) => [
                        Number(eraId),
                        this.hydrateEraMembership(units),
                    ])
                ) as Record<number, FactionEraMembership>,
            }));

        this.factions = factions;
        this.factionNameMap.clear();
        this.normalizedFactionNameMap.clear();
        this.factionIdMap.clear();

        for (const faction of factions) {
            this.factionNameMap.set(faction.name, faction);

            const normalizedName = normalizeLooseText(faction.name);
            if (normalizedName && !this.normalizedFactionNameMap.has(normalizedName)) {
                this.normalizedFactionNameMap.set(normalizedName, faction);
            }

            this.factionIdMap.set(faction.id, faction);
        }

        this.etag = data.etag || '';
    }

    protected override normalizeFetchedData(data: RawMULFactions, etag: string): RawMULFactions {
        return {
            ...data,
            etag,
        };
    }

    private hydrateEraMembership(units: RawFactionEraMembership): FactionEraMembership {
        return units instanceof Set ? new Set(units) : new Set(units);
    }
}