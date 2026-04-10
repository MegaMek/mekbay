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

import type { GameSystem } from '../models/common.model';
import type { MegaMekAvailabilityFrom, MegaMekAvailabilityRarity } from '../models/megamek/availability.model';
import type { AvailabilitySource } from '../models/options.model';
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

export interface UnitSearchWorkerMegaMekAvailabilityBucketSnapshot {
    unitNames: string[];
    bySource: Partial<Record<MegaMekAvailabilityFrom, string[]>>;
    byRarity: Partial<Record<MegaMekAvailabilityFrom, Partial<Record<MegaMekAvailabilityRarity, string[]>>>>;
}

export interface UnitSearchWorkerMegaMekAvailabilitySnapshot {
    all: UnitSearchWorkerMegaMekAvailabilityBucketSnapshot;
    knownUnitNames: string[];
    eras: Record<string, UnitSearchWorkerMegaMekAvailabilityBucketSnapshot>;
    factions: Record<string, UnitSearchWorkerMegaMekAvailabilityBucketSnapshot>;
    eraFactions: Record<string, Record<string, UnitSearchWorkerMegaMekAvailabilityBucketSnapshot>>;
    extinctFactionName?: string;
    extinctUnitNames: string[];
    extinctByEra: Record<string, string[]>;
}

export interface UnitSearchWorkerCorpusSnapshot {
    corpusVersion: UnitSearchWorkerCorpusVersion;
    units: import('../models/units.model').Unit[];
    indexes: UnitSearchWorkerIndexSnapshot;
    factionEraIndex: UnitSearchWorkerFactionEraSnapshot;
    megaMekAvailability: UnitSearchWorkerMegaMekAvailabilitySnapshot;
}

export interface UnitSearchWorkerQueryRequest {
    revision: number;
    corpusVersion: UnitSearchWorkerCorpusVersion;
    executionQuery: string;
    telemetryQuery: string;
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    bvPvLimit: number;
    forceTotalBvPv: number;
    pilotGunnerySkill: number;
    pilotPilotingSkill: number;
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
    unitNames: string[];
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