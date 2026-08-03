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

import {
    createEmptyPilotNameCatalog,
    type CompactNameGroups,
    type CompactPilotNameCatalog,
    type CompactWeightedString,
    type PilotNameCatalog,
    type PilotNameCatalogData,
    type WeightedValue,
} from '../../models/pilot-name-catalog.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

type PilotNameRemoteBody = PilotNameCatalogData | CompactPilotNameCatalog;

function isStoredCatalog(value: PilotNameRemoteBody): value is PilotNameCatalogData {
    return 'etag' in value && 'catalog' in value;
}

function requireCurrentCatalog(value: unknown): CompactPilotNameCatalog {
    if (!value || typeof value !== 'object' || (value as { v?: unknown }).v !== 1) {
        throw new Error('pilot name catalog uses an unsupported version');
    }
    return value as CompactPilotNameCatalog;
}

function expandWeightedStrings(entries: CompactWeightedString[]): WeightedValue<string>[] {
    return entries.map((entry) => typeof entry === 'string'
        ? { value: entry, weight: 1 }
        : { value: entry[0], weight: entry[1] });
}

function expandNameGroups(groups: CompactNameGroups): Record<number, WeightedValue<string>[]> {
    return Object.fromEntries(groups
        .map((entries, index) => [index + 1, expandWeightedStrings(entries)] as const)
        .filter(([, entries]) => entries.length > 0));
}

export function expandCompactPilotNameCatalog(compact: CompactPilotNameCatalog): PilotNameCatalog {
    const factions = Object.fromEntries(compact.f.map(([generator, surnameWeights, givenNameWeights]) => [generator, {
        surnameEthnicities: surnameWeights
            .map((weight, index) => ({ value: index + 1, weight }))
            .filter((entry) => entry.weight > 0),
        givenNameEthnicities: Object.fromEntries(givenNameWeights
            .map((weights, surnameIndex) => [surnameIndex + 1, weights
                .map((weight, givenIndex) => ({ value: givenIndex + 1, weight }))
                .filter((entry) => entry.weight > 0)] as const)
            .filter(([, entries]) => entries.length > 0)),
    }]));

    const bloodnameClans = Object.fromEntries(compact.bc.map(([code, generationCode, start, end, homeClan, rivals]) => [code, {
        code,
        generationCode: generationCode || code,
        start,
        end,
        homeClan: homeClan === 1,
        rivals: rivals.map(([rivalCode, rivalStart, rivalEnd]) => ({ code: rivalCode, start: rivalStart, end: rivalEnd })),
    }]));

    return {
        maleGivenNames: expandNameGroups(compact.n[0]),
        femaleGivenNames: expandNameGroups(compact.n[1]),
        surnames: expandNameGroups(compact.n[2]),
        callsigns: expandWeightedStrings(compact.c),
        factions,
        factionProfiles: Object.fromEntries(compact.m.map(([mulId, factionIndex, isClan, bloodnameClan]) => [mulId, {
            generator: compact.f[factionIndex][0],
            isClan: isClan === 1,
            ...(bloodnameClan ? { bloodnameClan } : {}),
        }])),
        bloodnameClans,
        bloodnames: compact.b.map(([name, clan, phenotype, flags, start, inactive, abjured, reactivated, postReaving, acquired, absorbed]) => ({
            name, clan, phenotype,
            exclusive: (flags & 1) !== 0,
            limited: (flags & 2) !== 0,
            start, inactive, abjured, reactivated, postReaving,
            acquired: acquired.map(([acquiredClan, year]) => ({ clan: acquiredClan, year })),
            ...(absorbed ? { absorbed: { clan: absorbed[0], year: absorbed[1] } } : {}),
        })),
    };
}

export function normalizePilotNameCatalog(value: unknown): PilotNameCatalog {
    return expandCompactPilotNameCatalog(requireCurrentCatalog(value));
}

function unwrapCatalog(data: PilotNameRemoteBody): CompactPilotNameCatalog {
    return isStoredCatalog(data) ? data.catalog : data;
}

function normalizeData(data: PilotNameRemoteBody, etag: string): PilotNameCatalogData {
    const rawCatalog = unwrapCatalog(data);
    return { etag: isStoredCatalog(data) ? data.etag || etag : etag, catalog: requireCurrentCatalog(rawCatalog) };
}

@Injectable({ providedIn: 'root' })
export class PilotNameCatalogService extends CatalogBaseService<PilotNameRemoteBody, PilotNameCatalogData, PilotNameRemoteBody> {
    private readonly dbService = inject(DbService);
    private catalog = createEmptyPilotNameCatalog();
    private hydrated = false;

    protected override get catalogKey(): string { return 'pilot_names'; }
    protected override get remoteUrl(): string { return 'assets/pilot-names.json'; }

    public getCatalog(): PilotNameCatalog {
        return this.catalog;
    }

    protected override hasHydratedData(): boolean {
        return this.hydrated;
    }

    protected override async loadFromCache(): Promise<PilotNameCatalogData | undefined> {
        return await this.dbService.getPilotNames() ?? undefined;
    }

    protected override saveToCache(data: PilotNameCatalogData): Promise<void> {
        return this.dbService.savePilotNames(data);
    }

    protected override hydrate(data: PilotNameRemoteBody): void {
        const rawCatalog = unwrapCatalog(data);
        this.catalog = normalizePilotNameCatalog(rawCatalog);
        this.hydrated = true;
        this.etag = isStoredCatalog(data) ? data.etag : '';
    }

    protected override normalizeFetchedData(data: PilotNameRemoteBody, etag: string): PilotNameCatalogData {
        return normalizeData(data, etag);
    }

}