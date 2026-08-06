// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import type { MegaMekRulesetRecord, MegaMekRulesetsData } from '../../models/megamek/rulesets.model';
import { DbService } from '../db.service';
import { CatalogBaseService } from './catalog-base.service';

const CURRENT_RULESET_SCHEMA_VERSION = 2;

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

function normalizeRulesetRecord(record: MegaMekRulesetRecord): MegaMekRulesetRecord {
    const forces = record.forces ?? [];
    return {
        ...record,
        forces,
        indexes: record.indexes ?? buildRulesetIndexes(forces),
        forceCount: typeof record.forceCount === 'number' ? record.forceCount : forces.length,
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
}