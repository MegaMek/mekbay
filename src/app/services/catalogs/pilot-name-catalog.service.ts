// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import {
    createEmptyPilotNameCatalog,
    type CompactNameGroups,
    type CompactPilotNameCatalog,
    type CompactWeightedString,
    type PilotNameCatalog,
    type PilotNameCatalogData,
    type WeightedValue,
} from '../../models/pilot-name-catalog.model';
import { CatalogBaseService } from './catalog-base.service';

type PilotNameRemoteBody = PilotNameCatalogData | CompactPilotNameCatalog;

function isStoredCatalog(value: PilotNameRemoteBody): value is PilotNameCatalogData {
    return 'assetHash' in value && 'catalog' in value;
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

function normalizeData(data: PilotNameRemoteBody, assetHash: string): PilotNameCatalogData {
    const rawCatalog = unwrapCatalog(data);
    return { assetHash: isStoredCatalog(data) ? data.assetHash || assetHash : assetHash, catalog: requireCurrentCatalog(rawCatalog) };
}

@Injectable({ providedIn: 'root' })
export class PilotNameCatalogService extends CatalogBaseService<PilotNameRemoteBody, PilotNameCatalogData, PilotNameRemoteBody> {
    private catalog = createEmptyPilotNameCatalog();
    private hydrated = false;

    protected override get catalogKey(): string { return 'pilot_names'; }
    protected override get remoteUrl(): string { return 'online-assets/generated/pilot-names.json'; }
    protected override get repositoryAssetPath(): string { return this.remoteUrl; }

    public getCatalog(): PilotNameCatalog {
        return this.catalog;
    }

    protected override hasHydratedData(): boolean {
        return this.hydrated;
    }

    protected override hydrate(data: PilotNameRemoteBody): void {
        const rawCatalog = unwrapCatalog(data);
        this.catalog = normalizePilotNameCatalog(rawCatalog);
        this.hydrated = true;
        this.transportRevision = isStoredCatalog(data) ? data.assetHash : '';
    }

    protected override normalizeFetchedData(data: PilotNameRemoteBody, assetHash: string): PilotNameCatalogData {
        return normalizeData(data, assetHash);
    }

}
