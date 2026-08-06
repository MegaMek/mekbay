// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSearchNormalization, UnitSearchNormalizationMatch } from '../models/unit-search-result.model';
import type { SearchTelemetryStage } from '../services/unit-search-filters.model';

export type UnitSearchWorkerCorpusVersion = string;

export interface UnitSearchWorkerIndexSnapshot {
    [filterKey: string]: {
        [value: string]: string[];
    };
}

export interface UnitSearchWorkerFactionEraSnapshot {
    [eraName: string]: {
        [factionName: string]: string[];
    };
}

export interface UnitSearchWorkerCorpusSnapshot {
    corpusVersion: UnitSearchWorkerCorpusVersion;
    units: import('../models/units.model').Unit[];
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
    unitName: string;
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
    | UnitSearchWorkerReadyMessage
    | UnitSearchWorkerResultMessage
    | UnitSearchWorkerErrorMessage;