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
import { DbService } from '../db.service';
import {
    getMegaMekFactionAffiliation,
    hydrateMegaMekFactionRecord,
    type MegaMekFactionAffiliation,
    type MegaMekFactionRecord,
    type MegaMekFactionRecordData,
    type MegaMekFactions,
    type MegaMekFactionsData,
    resolveMegaMekFactionRecord,
} from '../../models/megamek/factions.model';
import { CatalogBaseService } from './catalog-base.service';

function isMegaMekFactionsData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>): data is MegaMekFactionsData {
    if (!('etag' in data) || !('factions' in data)) {
        return false;
    }

    return typeof data.etag === 'string' && typeof data.factions === 'object' && data.factions !== null && !Array.isArray(data.factions);
}

function internalFaction(faction: MegaMekFactionRecord): boolean {
    return faction.tagSet.has('ABANDONED') || (faction.tagSet.has('SPECIAL'));
}

@Injectable({
    providedIn: 'root'
})
export class MegaMekFactionsCatalogService extends CatalogBaseService<MegaMekFactionsData | MegaMekFactions, MegaMekFactionsData, MegaMekFactionsData | Record<string, MegaMekFactionRecordData>> {
    private readonly dbService = inject(DbService);

    private factions = new Map<string, MegaMekFactionRecord>();

    protected override get catalogKey(): string {
        return 'megamek_factions';
    }

    protected override get remoteUrl(): string {
        return 'assets/factions.json';
    }

    public getFactions(): MegaMekFactions {
        return Object.fromEntries(this.factions.entries());
    }

    public getFactionByKey(key: string): MegaMekFactionRecord | undefined {
        return this.factions.get(key);
    }

    public getFactionById(id: string): MegaMekFactionRecord | undefined {
        return this.factions.get(id);
    }

    public getFactionAffiliation(factionKey: string): MegaMekFactionAffiliation {
        const faction = this.getFactionByKey(factionKey);
        if (!faction) {
            return 'Other';
        }

        return getMegaMekFactionAffiliation(faction, this.factions);
    }

    protected override hasHydratedData(): boolean {
        return this.factions.size > 0;
    }

    protected override async loadFromCache(): Promise<MegaMekFactionsData | MegaMekFactions | undefined> {
        return await this.dbService.getMegaMekFactions() ?? undefined;
    }

    protected override saveToCache(data: MegaMekFactionsData): Promise<void> {
        return this.dbService.saveMegaMekFactions(data);
    }

    protected override hydrate(data: MegaMekFactionsData | MegaMekFactions): void {
        const wrappedData = isMegaMekFactionsData(data) ? data : undefined;
        const rawFactions = wrappedData?.factions ?? data;
        const hydratedFactions = new Map<string, MegaMekFactionRecord>();

        this.factions.clear();
        for (const faction of Object.values(rawFactions)) {
            const hydratedFaction = hydrateMegaMekFactionRecord(faction);
            if (internalFaction(hydratedFaction)) {
                continue;
            }
            hydratedFactions.set(hydratedFaction.id, hydratedFaction);
        }

        for (const faction of hydratedFactions.values()) {
            const resolvedFaction = resolveMegaMekFactionRecord(faction, hydratedFactions);
            this.factions.set(resolvedFaction.id, resolvedFaction);
        }

        this.etag = wrappedData?.etag || '';
    }

    protected override normalizeFetchedData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>, etag: string): MegaMekFactionsData {
        return this.wrapData(data, etag);
    }

    private wrapData(data: MegaMekFactionsData | Record<string, MegaMekFactionRecordData>, etag: string): MegaMekFactionsData {
        if (isMegaMekFactionsData(data)) {
            return {
                etag,
                factions: data.factions,
            };
        }

        return {
            etag,
            factions: data,
        };
    }
}