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
    SARNA_PAGE_TITLE_LOOKUP_TYPE_BY_UNIT_TYPE,
    SARNA_PAGE_TITLE_LOOKUP_TYPES,
    type SarnaLookupUnit,
    type SarnaPageTitleLookupType,
    type SarnaPageTitlesByType,
    type SarnaPageTitlesData,
} from '../../models/sarna-page-titles.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

type TitleCandidateIndex = Map<string, string[]>;

const NON_ALIAS_PARENTHESES = [
    'aerospacefighter',
    'battlearmor',
    'battlemech',
    'battlemek',
    'class',
    'combatvehicle',
    'conventionalfighter',
    'dropship',
    'dropshuttle',
    'exoskeleton',
    'industrialmech',
    'industrialmek',
    'infantryunit',
    'jumpship',
    'navalvessel',
    'omnifighter',
    'omnimech',
    'omnimek',
    'omnivehicle',
    'protomek',
    'smallcraft',
    'spacestation',
    'supportvehicle',
    'warship',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isWrappedSarnaPageTitlesData(value: unknown): value is SarnaPageTitlesData {
    return isRecord(value) && isRecord(value['titlesByType']);
}

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’`]/g, "'")
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeCompact(value: string): string {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function getLookupTokens(value: string): string[] {
    return normalizeText(value)
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean);
}

function getTokenSignature(value: string): string | undefined {
    const tokens = getLookupTokens(value).sort((left, right) => left.localeCompare(right));
    return tokens.length > 0 ? tokens.join('|') : undefined;
}

function getTitleBase(title: string): string {
    let baseTitle = title.trim();
    let strippedTitle = baseTitle.replace(/\s+\([^()]*\)\s*$/g, '').trim();

    while (strippedTitle && strippedTitle !== baseTitle) {
        baseTitle = strippedTitle;
        strippedTitle = baseTitle.replace(/\s+\([^()]*\)\s*$/g, '').trim();
    }

    return baseTitle;
}

function isTitleParentheticalAlias(value: string): boolean {
    const normalizedValue = normalizeCompact(value);
    return normalizedValue.length > 0
        && !NON_ALIAS_PARENTHESES.some(descriptor => normalizedValue.includes(descriptor));
}

function getTitleParentheticalAliases(title: string): string[] {
    const aliases = new Set<string>();
    let remainingTitle = title.trim();
    let match = remainingTitle.match(/\s+\(([^()]*)\)\s*$/);

    while (match) {
        const alias = match[1].trim();
        if (isTitleParentheticalAlias(alias)) {
            aliases.add(alias);
        }

        remainingTitle = remainingTitle.slice(0, match.index).trim();
        match = remainingTitle.match(/\s+\(([^()]*)\)\s*$/);
    }

    return [...aliases];
}

function addExactTitle(exactTitles: Map<string, string>, titleKey: string, title: string): void {
    const normalizedTitleKey = normalizeText(titleKey);
    if (normalizedTitleKey && !exactTitles.has(normalizedTitleKey)) {
        exactTitles.set(normalizedTitleKey, title);
    }
}

function addBaseCandidate(baseCandidates: TitleCandidateIndex, candidateKey: string, title: string): void {
    const normalizedCandidateKey = normalizeText(candidateKey);
    if (!normalizedCandidateKey) return;

    const candidates = baseCandidates.get(normalizedCandidateKey) ?? [];
    if (!candidates.includes(title)) {
        candidates.push(title);
        baseCandidates.set(normalizedCandidateKey, candidates);
    }
}

function addTokenCandidate(tokenCandidates: TitleCandidateIndex, candidateKey: string, title: string): void {
    const tokenSignature = getTokenSignature(candidateKey);
    if (!tokenSignature) return;

    const candidates = tokenCandidates.get(tokenSignature) ?? [];
    if (!candidates.includes(title)) {
        candidates.push(title);
        tokenCandidates.set(tokenSignature, candidates);
    }
}

function isUnitOmni(unit: SarnaLookupUnit): boolean {
    return Number(unit.omni ?? 0) > 0 || normalizeCompact(String(unit.subtype ?? '')).includes('omni');
}

function isOmniTitle(title: string): boolean {
    const titleKey = normalizeCompact(title);
    return titleKey.includes('omnimech')
        || titleKey.includes('omnimek')
        || titleKey.includes('omnifighter')
        || titleKey.includes('omnivehicle');
}

function getSubtypeTitleHints(unit: SarnaLookupUnit): string[] {
    const subtypeKey = normalizeCompact(String(unit.subtype ?? ''));
    const unitOmni = isUnitOmni(unit);
    const hints = new Set<string>();

    if (subtypeKey.includes('aerospacefighter')) hints.add(unitOmni ? 'omnifighter' : 'aerospacefighter');
    if (subtypeKey.includes('conventionalfighter')) hints.add('conventionalfighter');
    if (subtypeKey.includes('dropship')) hints.add('dropship');
    if (subtypeKey.includes('smallcraft')) hints.add('smallcraft');
    if (subtypeKey.includes('jumpship')) hints.add('jumpship');
    if (subtypeKey.includes('warship')) hints.add('warship');
    if (subtypeKey.includes('spacestation')) hints.add('spacestation');
    if (subtypeKey.includes('battlemek') || subtypeKey.includes('battlemech')) hints.add(unitOmni ? 'omnimech' : 'battlemech');
    if (subtypeKey.includes('industrialmek') || subtypeKey.includes('industrialmech')) hints.add('industrialmech');
    if (subtypeKey.includes('combatvehicle') || subtypeKey.includes('hovercraft')) hints.add(unitOmni ? 'omnivehicle' : 'combatvehicle');
    if (subtypeKey.includes('supportvehicle')) hints.add(unitOmni ? 'omnivehicle' : 'supportvehicle');
    if (subtypeKey.includes('navalvessel')) hints.add('navalvessel');
    if (subtypeKey.includes('battlearmor')) hints.add('battlearmor');
    if (subtypeKey.includes('protomek')) hints.add('protomek');

    return [...hints];
}

@Injectable({
    providedIn: 'root'
})
export class SarnaPageTitlesCatalogService extends CatalogBaseService<SarnaPageTitlesData | SarnaPageTitlesByType, SarnaPageTitlesData, SarnaPageTitlesData | SarnaPageTitlesByType> {
    private readonly dbService = inject(DbService);

    private titleCount = 0;
    private exactTitleByType = new Map<SarnaPageTitleLookupType, Map<string, string>>();
    private baseCandidatesByType = new Map<SarnaPageTitleLookupType, TitleCandidateIndex>();
    private tokenCandidatesByType = new Map<SarnaPageTitleLookupType, TitleCandidateIndex>();

    protected override get catalogKey(): string {
        return 'sarna_page_titles';
    }

    protected override get remoteUrl(): string {
        return 'assets/sarna-page-titles.json';
    }

    public getPageTitleForUnit(unit: SarnaLookupUnit | null | undefined): string | undefined {
        if (!unit) return undefined;

        const chassis = unit.chassis?.trim();
        if (!chassis) return undefined;

        const lookupType = SARNA_PAGE_TITLE_LOOKUP_TYPE_BY_UNIT_TYPE[unit.type];
        const normalizedChassis = normalizeText(chassis);
        const exactTitle = this.exactTitleByType.get(lookupType)?.get(normalizedChassis);
        if (exactTitle) return exactTitle;

        const baseCandidates = this.baseCandidatesByType.get(lookupType)?.get(normalizedChassis);
        if (baseCandidates?.length) {
            return this.selectBestCandidate(baseCandidates, unit);
        }

        const tokenSignature = getTokenSignature(chassis);
        const tokenCandidates = tokenSignature
            ? this.tokenCandidatesByType.get(lookupType)?.get(tokenSignature)
            : undefined;

        return tokenCandidates?.length ? this.selectBestCandidate(tokenCandidates, unit) : undefined;
    }

    public hasPageForUnit(unit: SarnaLookupUnit | null | undefined): boolean {
        return this.getPageTitleForUnit(unit) !== undefined;
    }

    protected override hasHydratedData(): boolean {
        return this.titleCount > 0;
    }

    protected override async loadFromCache(): Promise<SarnaPageTitlesData | undefined> {
        return await this.dbService.getSarnaPageTitles() ?? undefined;
    }

    protected override saveToCache(data: SarnaPageTitlesData): Promise<void> {
        return this.dbService.saveSarnaPageTitles(data);
    }

    protected override hydrate(data: SarnaPageTitlesData | SarnaPageTitlesByType): void {
        const wrappedData = this.wrapData(data, isWrappedSarnaPageTitlesData(data) ? data.etag : '');

        this.titleCount = 0;
        this.exactTitleByType.clear();
        this.baseCandidatesByType.clear();
        this.tokenCandidatesByType.clear();

        for (const lookupType of SARNA_PAGE_TITLE_LOOKUP_TYPES) {
            const exactTitles = new Map<string, string>();
            const baseCandidates = new Map<string, string[]>();
            const tokenCandidates = new Map<string, string[]>();

            for (const title of wrappedData.titlesByType[lookupType] ?? []) {
                addExactTitle(exactTitles, title, title);

                const baseTitle = getTitleBase(title);
                addBaseCandidate(baseCandidates, baseTitle, title);
                addTokenCandidate(tokenCandidates, baseTitle, title);

                const aliases = getTitleParentheticalAliases(title);
                if (aliases.length > 0) {
                    addTokenCandidate(tokenCandidates, title, title);
                }

                for (const alias of aliases) {
                    addExactTitle(exactTitles, `${alias} (${baseTitle})`, title);
                    addBaseCandidate(baseCandidates, alias, title);
                    addTokenCandidate(tokenCandidates, alias, title);
                    addTokenCandidate(tokenCandidates, `${alias} ${baseTitle}`, title);
                }

                this.titleCount += 1;
            }

            this.exactTitleByType.set(lookupType, exactTitles);
            this.baseCandidatesByType.set(lookupType, baseCandidates);
            this.tokenCandidatesByType.set(lookupType, tokenCandidates);
        }

        this.etag = wrappedData.etag;
    }

    protected override normalizeFetchedData(data: SarnaPageTitlesData | SarnaPageTitlesByType, etag: string): SarnaPageTitlesData {
        return this.wrapData(data, etag);
    }

    protected override getDatasetSize(data: SarnaPageTitlesData | SarnaPageTitlesByType): number {
        const wrappedData = this.wrapData(data, '');
        return SARNA_PAGE_TITLE_LOOKUP_TYPES.reduce((count, lookupType) => count + (wrappedData.titlesByType[lookupType]?.length ?? 0), 0);
    }

    private wrapData(data: SarnaPageTitlesData | SarnaPageTitlesByType, etag: string): SarnaPageTitlesData {
        const source = isWrappedSarnaPageTitlesData(data) ? data.titlesByType : data;
        const titlesByType: SarnaPageTitlesByType = {};

        for (const lookupType of SARNA_PAGE_TITLE_LOOKUP_TYPES) {
            const titles = isRecord(source) ? source[lookupType] : undefined;
            titlesByType[lookupType] = Array.isArray(titles)
                ? titles
                    .filter((title): title is string => typeof title === 'string' && title.trim().length > 0)
                    .map(title => title.trim())
                : [];
        }

        return {
            etag: isWrappedSarnaPageTitlesData(data) && typeof data.etag === 'string' ? data.etag : etag,
            titlesByType,
        };
    }

    private selectBestCandidate(candidates: readonly string[], unit: SarnaLookupUnit): string {
        const unitOmni = isUnitOmni(unit);
        const subtypeHints = getSubtypeTitleHints(unit);
        let bestCandidate = candidates[0];
        let bestScore = Number.NEGATIVE_INFINITY;

        for (const candidate of candidates) {
            const titleKey = normalizeCompact(candidate);
            const titleOmni = isOmniTitle(candidate);
            let score = 0;

            if (unitOmni && titleOmni) {
                score += 100;
            } else if (!unitOmni && !titleOmni) {
                score += 40;
            }

            for (const hint of subtypeHints) {
                if (titleKey.includes(hint)) {
                    score += 10;
                }
            }

            if (score > bestScore) {
                bestCandidate = candidate;
                bestScore = score;
            }
        }

        return bestCandidate;
    }
}