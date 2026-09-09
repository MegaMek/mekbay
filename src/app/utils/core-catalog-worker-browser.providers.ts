// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type {
    CoreCatalogArchiveWorkerFactory,
} from '../services/unit-catalog/core-catalog-archive-worker-client';
import {
    CORE_CATALOG_ARCHIVE_WORKER_FACTORY,
} from './core-catalog-archive-worker-factory.util';
import { UNIT_SUMMARY_PROJECTION_WORKERS, unitSummaryProjectionWorkerCount } from './unit-summary-projection-worker-factory.util';
import type { UnitSummaryProjectionWorkers } from '../services/unit-catalog/unit-summary-projection';

/** Browser-only providers keep static Angular Worker URLs out of Node graphs. */
export function provideCoreCatalogWorkers(): EnvironmentProviders {
    return makeEnvironmentProviders([
        {
            provide: CORE_CATALOG_ARCHIVE_WORKER_FACTORY,
            useFactory: createArchiveWorkerFactory,
        },
        { provide: UNIT_SUMMARY_PROJECTION_WORKERS, useFactory: createSummaryProjectionWorkers },
    ]);
}

function createSummaryProjectionWorkers(): UnitSummaryProjectionWorkers | null {
    if (typeof Worker === 'undefined') return null;
    return {
        count: unitSummaryProjectionWorkerCount({
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
            coarsePointer: globalThis.matchMedia('(pointer: coarse)').matches,
        }),
        createWorker: () => new Worker(new URL('../unit-summary-projection.worker', import.meta.url), {
            type: 'module', name: 'unit-summary-projection',
        }),
    };
}

function createArchiveWorkerFactory(): CoreCatalogArchiveWorkerFactory | null {
    if (typeof Worker === 'undefined') return null;
    return () => new Worker(new URL('../core-catalog-archive.worker', import.meta.url), {
        type: 'module',
        name: 'core-catalog-archive',
    });
}
