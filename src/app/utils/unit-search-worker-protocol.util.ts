// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { UnitSearchNormalization, UnitSearchNormalizationMatch } from '../models/unit-search-result.model';
import type { SearchTelemetryStage } from '../services/unit-search-filters.model';

export type UnitSearchWorkerCorpusVersion = string;

/** Search-only projection transferred to the worker instead of the runtime Unit graph. */
export interface UnitSearchWorkerUnit {
    readonly uuid: UnitSummary['uuid'];
    readonly name: UnitSummary['name'];
    readonly id: UnitSummary['id'];
    readonly chassis: UnitSummary['chassis'];
    readonly model: UnitSummary['model'];
    readonly year: UnitSummary['year'];
    readonly weightClass: UnitSummary['weightClass'];
    readonly tons: UnitSummary['tons'];
    readonly bv: UnitSummary['bv'];
    readonly cost: UnitSummary['cost'];
    readonly level: UnitSummary['level'];
    readonly type: UnitSummary['type'];
    readonly subtype: UnitSummary['subtype'];
    readonly omni: UnitSummary['omni'];
    readonly source: string[];
    readonly published: string[];
    readonly rulesRefs: UnitSummary['rulesRefs'];
    readonly canon: UnitSummary['canon'];
    readonly canAntiMech: UnitSummary['canAntiMech'];
    readonly role: UnitSummary['role'];
    readonly armor: UnitSummary['armor'];
    readonly armorPer: UnitSummary['armorPer'];
    readonly internal: UnitSummary['internal'];
    readonly heat: UnitSummary['heat'];
    readonly dissipation: UnitSummary['dissipation'];
    readonly moveType: UnitSummary['moveType'];
    readonly walk: UnitSummary['walk'];
    readonly run: UnitSummary['run'];
    readonly jump: UnitSummary['jump'];
    readonly umu: UnitSummary['umu'];
    readonly c3: UnitSummary['c3'];
    readonly dpt: UnitSummary['dpt'];
    readonly quirks: string[];
    readonly features: string[];
    readonly _searchKey: string;
    readonly _searchKeyAlphanumeric?: string;
    readonly _techBaseDisplay: string;
    readonly _maxRange: number;
    readonly _dissipationEfficiency: number;
    readonly _mdSumNoPhysical: number;
    readonly _weaponTypes: string[];
    readonly _weaponTypeCounts: Readonly<Record<string, number>>;
    readonly _componentNameCounts: Readonly<Record<string, number>>;
    readonly _searchTags: string[];
    readonly as: {
        readonly TP: UnitSummary['as']['TP'];
        readonly PV: UnitSummary['as']['PV'];
        readonly SZ: UnitSummary['as']['SZ'];
        readonly TMM: UnitSummary['as']['TMM'];
        readonly OV: UnitSummary['as']['OV'];
        readonly MVm: Record<string, number>;
        readonly Th: UnitSummary['as']['Th'];
        readonly Arm: UnitSummary['as']['Arm'];
        readonly Str: UnitSummary['as']['Str'];
        readonly specials: string[];
        readonly dmg: {
            readonly _dmgS?: number;
            readonly _dmgM?: number;
            readonly _dmgL?: number;
            readonly _dmgE?: number;
        };
    };
}

/** The exact union accepted by the shared search kernel. */
export type UnitSearchRecord = UnitSummary | UnitSearchWorkerUnit;

export interface UnitSearchWorkerIndexSnapshot {
    [filterKey: string]: {
        /** Unit UUIDs. */
        [value: string]: string[];
    };
}

/**
 * Compact exact availability authority for the search worker.
 *
 * Do not expand every faction/era membership to UUID strings on the
 * main thread. That representation repeats long identity strings millions of
 * times for the full catalog and is then duplicated again by structured clone.
 * The worker resolves MUL ids lazily for only the faction/era pairs a query
 * actually touches.
 */
export interface UnitSearchWorkerFactionEraSnapshot {
    readonly unitUuidsByMulId: {
        readonly [mulId: string]: readonly string[];
    };
    readonly referenceIdsByEraAndFaction: {
        readonly [eraName: string]: {
            readonly [factionName: string]: readonly number[];
        };
    };
}

export interface UnitSearchWorkerCorpusSnapshot {
    corpusVersion: UnitSearchWorkerCorpusVersion;
    units: UnitSearchWorkerUnit[];
    indexes: UnitSearchWorkerIndexSnapshot;
    factionEraIndex: UnitSearchWorkerFactionEraSnapshot;
}

export interface UnitSearchWorkerQueryRequest {
    revision: number;
    corpusVersion: UnitSearchWorkerCorpusVersion;
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

export interface UnitSearchWorkerResultEntry {
    unitUuid: string;
    match?: UnitSearchNormalizationMatch;
}

export interface UnitSearchWorkerInitMessage {
    type: 'init';
    snapshot: UnitSearchWorkerCorpusSnapshot;
}

export interface UnitSearchWorkerReadyMessage {
    type: 'ready';
    corpusVersion: UnitSearchWorkerCorpusVersion;
}

export interface UnitSearchWorkerProgressMessage {
    type: 'progress';
    corpusVersion: UnitSearchWorkerCorpusVersion;
    completed: number;
    total: number;
    detail: string;
}

export interface UnitSearchWorkerExecuteMessage {
    type: 'execute';
    request: UnitSearchWorkerQueryRequest;
}

export interface UnitSearchWorkerResultMessage {
    type: 'result';
    revision: number;
    corpusVersion: UnitSearchWorkerCorpusVersion;
    telemetryQuery: string;
    entries: UnitSearchWorkerResultEntry[];
    stages: SearchTelemetryStage[];
    totalMs: number;
    unitCount: number;
    isComplex: boolean;
}

export interface UnitSearchWorkerErrorMessage {
    type: 'error';
    revision?: number;
    corpusVersion?: UnitSearchWorkerCorpusVersion;
    message: string;
}

export type UnitSearchWorkerRequestMessage =
    | UnitSearchWorkerInitMessage
    | UnitSearchWorkerExecuteMessage;

export type UnitSearchWorkerResponseMessage =
    | UnitSearchWorkerProgressMessage
    | UnitSearchWorkerReadyMessage
    | UnitSearchWorkerResultMessage
    | UnitSearchWorkerErrorMessage;
