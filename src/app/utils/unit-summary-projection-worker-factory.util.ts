// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InjectionToken } from '@angular/core';
import type { UnitSummaryProjectionWorkers } from '../services/unit-catalog/unit-summary-projection';

/** Browser URLs remain in the browser provider so Node tooling can use the same domain code. */
export const UNIT_SUMMARY_PROJECTION_WORKERS = new InjectionToken<UnitSummaryProjectionWorkers | null>(
    'UNIT_SUMMARY_PROJECTION_WORKERS', { providedIn: 'root', factory: () => null },
);

export function unitSummaryProjectionWorkerCount(input: {
    readonly hardwareConcurrency: number;
    readonly deviceMemory?: number;
    readonly coarsePointer: boolean;
}): number {
    const cpuLimit = Number.isFinite(input.hardwareConcurrency)
        ? Math.max(1, Math.floor(input.hardwareConcurrency / 2)) : 1;
    const memoryLimit = input.deviceMemory !== undefined && input.deviceMemory <= 4 ? 1 : 4;
    return Math.min(cpuLimit, memoryLimit, input.coarsePointer ? 2 : 4);
}
