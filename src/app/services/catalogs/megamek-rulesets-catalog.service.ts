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

import type { MegaMekRulesetRecord, MegaMekRulesetsData } from '../../models/megamek/rulesets.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

const CURRENT_RULESET_SCHEMA_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyEchelonToken(value: unknown): value is Record<string, unknown> & { echelon: string } {
    if (!isRecord(value)) {
        return false;
    }

    const keys = Object.keys(value);
    return 'echelon' in value && keys.every((key) => ['echelon', 'modifier', 'augmented'].includes(key));
}

function mapLegacyRulesetKey(key: string): string {
    switch (key) {
        case 'faction':
            return 'factionKey';
        case 'num':
            return 'count';
        case 'asFaction':
            return 'asFactionKey';
        case 'asParent':
            return 'useParentFaction';
        default:
            return key;
    }
}

function normalizeLegacyRulesetValue(value: unknown): unknown {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeLegacyRulesetValue(entry))
            .filter((entry) => entry !== undefined);
    }

    if (isLegacyEchelonToken(value)) {
        return {
            code: String(value.echelon),
            ...(value['modifier'] === undefined ? {} : { modifier: value['modifier'] }),
            ...(value['augmented'] === undefined ? {} : { augmented: value['augmented'] }),
        };
    }

    if (!isRecord(value)) {
        return value;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key === 'parent' || key === 'ratingSystem') {
            continue;
        }

        const nextValue = normalizeLegacyRulesetValue(entry);
        if (nextValue === undefined) {
            continue;
        }

        normalized[mapLegacyRulesetKey(key)] = key === 'asParent'
            ? true
            : nextValue;
    }

    return normalized;
}

function buildRulesetIndexes(forces: MegaMekRulesetRecord['forces']): MegaMekRulesetRecord['indexes'] {
    const forceIndexesByEchelon: Record<string, number[]> = {};

    forces.forEach((force, index) => {
        const code = force.echelon?.code;
        if (!code) {
            return;
        }

        const bucket = forceIndexesByEchelon[code] ?? [];
        bucket.push(index);
        forceIndexesByEchelon[code] = bucket;
    });

    return { forceIndexesByEchelon };
}

function normalizeRulesetRecord(record: MegaMekRulesetRecord | Record<string, unknown>): MegaMekRulesetRecord {
    if ('forces' in record && 'indexes' in record && !('document' in record)) {
        const normalizedRecord = record as MegaMekRulesetRecord;
        return {
            ...normalizedRecord,
            indexes: normalizedRecord.indexes ?? buildRulesetIndexes(normalizedRecord.forces ?? []),
            forces: normalizedRecord.forces ?? [],
        };
    }

    const legacyRecord = record as Record<string, unknown>;
    const normalizedDocument = normalizeLegacyRulesetValue(legacyRecord['document']) as Record<string, unknown> | undefined;
    const forces = Array.isArray(normalizedDocument?.['forces'])
        ? normalizedDocument['forces'] as MegaMekRulesetRecord['forces']
        : [];

    return {
        factionKey: String(legacyRecord['factionKey']),
        parentFactionKey: typeof legacyRecord['parentFactionKey'] === 'string'
            ? legacyRecord['parentFactionKey']
            : typeof legacyRecord['parentFaction'] === 'string'
                ? legacyRecord['parentFaction']
                : undefined,
        ratingSystem: typeof legacyRecord['ratingSystem'] === 'string' ? legacyRecord['ratingSystem'] : undefined,
        assign: isRecord(normalizedDocument?.['assign']) ? normalizedDocument['assign'] as MegaMekRulesetRecord['assign'] : undefined,
        customRanks: isRecord(normalizedDocument?.['customRanks']) ? normalizedDocument['customRanks'] : undefined,
        defaults: isRecord(normalizedDocument?.['defaults']) ? normalizedDocument['defaults'] as MegaMekRulesetRecord['defaults'] : undefined,
        toc: isRecord(normalizedDocument?.['toc']) ? normalizedDocument['toc'] as MegaMekRulesetRecord['toc'] : undefined,
        forces,
        indexes: isRecord(legacyRecord['indexes'])
            ? legacyRecord['indexes'] as unknown as MegaMekRulesetRecord['indexes']
            : buildRulesetIndexes(forces),
        forceCount: typeof legacyRecord['forceCount'] === 'number' ? legacyRecord['forceCount'] : forces.length,
    };
}

function normalizeRulesetsData(
    data: MegaMekRulesetsData | MegaMekRulesetRecord[],
    etag: string,
): MegaMekRulesetsData {
    if (isMegaMekRulesetsData(data)) {
        return {
            etag,
            version: data.version ?? CURRENT_RULESET_SCHEMA_VERSION,
            rulesets: data.rulesets.map((record) => normalizeRulesetRecord(record)),
        };
    }

    return {
        etag,
        version: CURRENT_RULESET_SCHEMA_VERSION,
        rulesets: data.map((record) => normalizeRulesetRecord(record)),
    };
}

function isMegaMekRulesetsData(
    data: MegaMekRulesetsData | MegaMekRulesetRecord[],
): data is MegaMekRulesetsData {
    return 'etag' in data && 'rulesets' in data;
}

@Injectable({
    providedIn: 'root'
})
export class MegaMekRulesetsCatalogService extends CatalogBaseService<MegaMekRulesetsData | MegaMekRulesetRecord[], MegaMekRulesetsData, MegaMekRulesetsData | MegaMekRulesetRecord[]> {
    private readonly dbService = inject(DbService);

    private rulesets: MegaMekRulesetRecord[] = [];
    private rulesetsByFactionKey = new Map<string, MegaMekRulesetRecord>();

    protected override get catalogKey(): string {
        return 'megamek_rulesets';
    }

    protected override get remoteUrl(): string {
        return 'assets/rulesets.json';
    }

    public getRulesets(): readonly MegaMekRulesetRecord[] {
        return this.rulesets;
    }

    public getRulesetByFactionKey(factionKey: string): MegaMekRulesetRecord | undefined {
        return this.rulesetsByFactionKey.get(factionKey);
    }

    protected override hasHydratedData(): boolean {
        return this.rulesets.length > 0;
    }

    protected override async loadFromCache(): Promise<MegaMekRulesetsData | MegaMekRulesetRecord[] | undefined> {
        return await this.dbService.getMegaMekRulesets() ?? undefined;
    }

    protected override saveToCache(data: MegaMekRulesetsData): Promise<void> {
        return this.dbService.saveMegaMekRulesets(data);
    }

    protected override hydrate(data: MegaMekRulesetsData | MegaMekRulesetRecord[]): void {
        const wrappedData = normalizeRulesetsData(data, isMegaMekRulesetsData(data) ? data.etag : '');

        this.rulesets = wrappedData.rulesets;
        this.rulesetsByFactionKey.clear();

        for (const ruleset of wrappedData.rulesets) {
            this.rulesetsByFactionKey.set(ruleset.factionKey, ruleset);
        }

        this.etag = wrappedData.etag;
    }

    protected override normalizeFetchedData(
        data: MegaMekRulesetsData | MegaMekRulesetRecord[],
        etag: string,
    ): MegaMekRulesetsData {
        return normalizeRulesetsData(data, etag);
    }

    protected override getDatasetSize(data: MegaMekRulesetsData | MegaMekRulesetRecord[]): number {
        return normalizeRulesetsData(data, '').rulesets.length;
    }

    private wrapData(
        data: MegaMekRulesetsData | MegaMekRulesetRecord[],
        etag: string,
    ): MegaMekRulesetsData {
        return normalizeRulesetsData(data, etag);
    }
}