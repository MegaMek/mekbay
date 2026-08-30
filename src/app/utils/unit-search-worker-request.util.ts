// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSearchNormalization } from '../models/unit-search-result.model';
import type { UnitSummary, UnitSummaryComponent } from '../models/unit-summary.model';
import { getUnitTechBaseDisplay } from '../models/tech.model';
import { filterStateToSemanticText } from './semantic-filter.util';
import { removeAccents } from './string.util';
import { getMaxRangeFromComponents } from './unit-range.util';
import { parseASDamageValue } from './as-damage.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerFactionEraSnapshot,
    UnitSearchWorkerIndexSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerUnit,
} from './unit-search-worker-protocol.util';
import type { FilterState } from '../services/unit-search-filters.model';

interface UnitSearchWorkerCorpusCache {
    version: string | null;
    snapshot: UnitSearchWorkerCorpusSnapshot | null;
}

interface BuildWorkerExecutionQueryArgs {
    effectiveFilterState: FilterState;
    effectiveTextSearch: string;
    /** Original committed clauses, preserved so repeated constraints are not flattened. */
    semanticTokenTexts?: readonly string[];
    gameSystem: GameSystem;
    totalRangesCache: Record<string, [number, number]>;
}

interface BuildWorkerSearchRequestArgs {
    revision: number;
    corpusVersion: string;
    executionQuery: string;
    telemetryQuery: string;
    gameSystem: GameSystem;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    bvPvLimit: number;
    forceTotalBvPv: number;
    pilotGunnerySkill: number;
    pilotPilotingSkill: number;
    normalization: UnitSearchNormalization | null;
}

const SEMANTIC_TEXT_ESCAPE_PATTERN = /([()=><!"'&\\])/g;

function escapePlainTextForWorkerExecutionQuery(text: string): string {
    return text.replace(SEMANTIC_TEXT_ESCAPE_PATTERN, '\\$1');
}

export function getWorkerCorpusVersion(searchCorpusVersion: string | number, tagsVersion: number): string {
    return `${searchCorpusVersion}:${tagsVersion}`;
}

export interface UnitSearchWorkerTransientFacts {
    readonly tags: readonly string[];
    readonly weaponTypes: readonly string[];
    readonly weaponTypeCounts: Readonly<Record<string, number>>;
}

/**
 * Own only facts read by the shared search kernel. In particular, do not retain
 * component/equipment instances, record-sheet data, fluff, images or cargo in
 * the structured-clone payload.
 */
function sumWeaponDamageNoPhysical(
    summary: UnitSummary,
    components: readonly UnitSummaryComponent[],
): number {
    let sum = 0;
    for (const weapon of components) {
        if (weapon.md && weapon.t !== 'P') {
            let maxDamage = Number.parseFloat(weapon.md) || 0;
            if (summary.subtype === 'Battle Armor' && weapon.l !== 'SSW' && weapon.p < 1) {
                maxDamage *= summary.internal;
            }
            sum += maxDamage * (weapon.q || 1);
        }
        if (weapon.bay) sum += sumWeaponDamageNoPhysical(summary, weapon.bay);
    }
    return Math.round(sum);
}

export function projectUnitSearchWorkerUnit(
    summary: UnitSummary,
    transient: UnitSearchWorkerTransientFacts,
): UnitSearchWorkerUnit {
    const componentNameCounts: Record<string, number> = {};
    for (const component of summary.comp) {
        const name = component.n.toLowerCase();
        componentNameCounts[name] = (componentNameCounts[name] ?? 0) + component.q;
    }

    const movement = { ...summary.as.MVm };
    if (movement['j'] !== undefined && movement[''] === undefined) {
        const modes = Object.keys(movement);
        if (summary.as.TP === 'BM' || (modes.length === 1 && modes[0] === 'j')) {
            movement[''] = movement['j'];
        }
    }

    return {
        uuid: summary.uuid,
        provider: summary.provider,
        name: summary.name,
        id: summary.id,
        chassis: summary.chassis,
        model: summary.model,
        year: summary.year,
        weightClass: summary.weightClass,
        tons: summary.tons,
        bv: summary.bv,
        cost: summary.cost,
        level: summary.level,
        type: summary.type,
        subtype: summary.subtype,
        omni: summary.omni,
        source: [...summary.source],
        published: [...summary.published],
        canon: summary.canon,
        canAntiMech: summary.canAntiMech,
        role: summary.role,
        armor: summary.armor,
        armorPer: summary.armorPer,
        internal: summary.internal,
        heat: summary.heat,
        dissipation: summary.dissipation,
        moveType: summary.moveType,
        walk: summary.walk,
        run: summary.run,
        jump: summary.jump,
        umu: summary.umu,
        c3: summary.c3,
        dpt: summary.dpt,
        quirks: [...summary.quirks],
        features: [...summary.features],
        _searchKey: `${removeAccents(summary.chassis.toLowerCase())} ${removeAccents(summary.model.toLowerCase())}`,
        _techBaseDisplay: getUnitTechBaseDisplay(summary),
        _maxRange: getMaxRangeFromComponents(summary.comp as UnitSummaryComponent[]),
        _dissipationEfficiency: summary.heat && summary.dissipation
            ? summary.dissipation - summary.heat
            : 0,
        _mdSumNoPhysical: sumWeaponDamageNoPhysical(summary, summary.comp),
        _weaponTypes: [...transient.weaponTypes],
        _weaponTypeCounts: { ...transient.weaponTypeCounts },
        _componentNameCounts: componentNameCounts,
        _searchTags: [...transient.tags],
        as: {
            TP: summary.as.TP,
            PV: summary.as.PV,
            SZ: summary.as.SZ,
            TMM: summary.as.TMM,
            OV: summary.as.OV,
            MVm: movement,
            Th: summary.as.Th,
            Arm: summary.as.Arm,
            Str: summary.as.Str,
            specials: [...summary.as.specials],
            dmg: {
                _dmgS: parseASDamageValue(summary.as.dmg.dmgS) ?? 0,
                _dmgM: parseASDamageValue(summary.as.dmg.dmgM) ?? 0,
                _dmgL: parseASDamageValue(summary.as.dmg.dmgL) ?? 0,
                _dmgE: parseASDamageValue(summary.as.dmg.dmgE) ?? 0,
            },
        },
    };
}

export function getWorkerCorpusSnapshot(
    cache: UnitSearchWorkerCorpusCache,
    corpusVersion: string,
    summaries: readonly UnitSummary[],
    getTransientFacts: (summary: UnitSummary) => UnitSearchWorkerTransientFacts,
    indexes: UnitSearchWorkerIndexSnapshot,
    factionEraIndex: UnitSearchWorkerFactionEraSnapshot,
): { snapshot: UnitSearchWorkerCorpusSnapshot; cache: UnitSearchWorkerCorpusCache } {
    if (cache.snapshot && cache.version === corpusVersion) {
        return { snapshot: cache.snapshot, cache };
    }

    const snapshot: UnitSearchWorkerCorpusSnapshot = {
        corpusVersion,
        units: summaries.map(summary => projectUnitSearchWorkerUnit(summary, getTransientFacts(summary))),
        indexes,
        factionEraIndex,
    };

    return {
        snapshot,
        cache: {
            version: corpusVersion,
            snapshot,
        },
    };
}

export function buildWorkerExecutionQuery({
    effectiveFilterState,
    effectiveTextSearch,
    semanticTokenTexts = [],
    gameSystem,
    totalRangesCache,
}: BuildWorkerExecutionQueryArgs): string {
    const uiFilterText = filterStateToSemanticText(
        effectiveFilterState,
        escapePlainTextForWorkerExecutionQuery(effectiveTextSearch),
        gameSystem,
        totalRangesCache,
    ).trim();

    return [uiFilterText, ...semanticTokenTexts]
        .map(part => part.trim())
        .filter(Boolean)
        .join(' ');
}

export function buildWorkerSearchRequest(args: BuildWorkerSearchRequestArgs): UnitSearchWorkerQueryRequest {
    return {
        revision: args.revision,
        corpusVersion: args.corpusVersion,
        executionQuery: args.executionQuery,
        telemetryQuery: args.telemetryQuery,
        gameSystem: args.gameSystem,
        sortKey: args.sortKey,
        sortDirection: args.sortDirection,
        bvPvLimit: args.bvPvLimit,
        forceTotalBvPv: args.forceTotalBvPv,
        pilotGunnerySkill: args.pilotGunnerySkill,
        pilotPilotingSkill: args.pilotPilotingSkill,
        normalization: args.normalization,
    };
}
