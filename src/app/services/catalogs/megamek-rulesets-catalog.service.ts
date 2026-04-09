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
        const wrappedData = isMegaMekRulesetsData(data)
            ? data
            : this.wrapData(data, '');

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
        return this.wrapData(data, etag);
    }

    private wrapData(
        data: MegaMekRulesetsData | MegaMekRulesetRecord[],
        etag: string,
    ): MegaMekRulesetsData {
        if (isMegaMekRulesetsData(data)) {
            return {
                etag,
                rulesets: data.rulesets,
            };
        }

        return {
            etag,
            rulesets: data,
        };
    }
}