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
import type { Unit } from '../models/units.model';
import type { SearchTelemetrySnapshot } from '../services/unit-search-filters.model';
import type { UnitSearchWorkerResultMessage } from './unit-search-worker-protocol.util';

export interface WorkerResultTelemetryContext {
    timestamp: number;
    gameSystem: GameSystem;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    resultCount: number;
}

export function hydrateWorkerResultUnits(
    result: UnitSearchWorkerResultMessage,
    getUnitByName: (unitName: string) => Unit | undefined,
): Unit[] {
    return result.unitNames
        .map(unitName => getUnitByName(unitName))
        .filter((unit): unit is Unit => unit !== undefined);
}

export function buildWorkerSearchTelemetrySnapshot(
    result: UnitSearchWorkerResultMessage,
    context: WorkerResultTelemetryContext,
): SearchTelemetrySnapshot {
    return {
        timestamp: context.timestamp,
        query: result.telemetryQuery,
        gameSystem: context.gameSystem,
        unitCount: result.unitCount,
        resultCount: context.resultCount,
        sortKey: context.sortKey,
        sortDirection: context.sortDirection,
        isComplex: result.isComplex,
        stages: result.stages,
        totalMs: result.totalMs,
    };
}