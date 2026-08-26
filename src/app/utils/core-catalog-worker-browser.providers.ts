// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type {
    CoreCatalogArchiveWorkerFactory,
} from '../services/unit-catalog/core-catalog-archive-worker-client';
import {
    CORE_CATALOG_ARCHIVE_WORKER_FACTORY,
} from './core-catalog-archive-worker-factory.util';

/** Browser-only providers keep static Angular Worker URLs out of Node graphs. */
export function provideCoreCatalogWorkers(): EnvironmentProviders {
    return makeEnvironmentProviders([
        {
            provide: CORE_CATALOG_ARCHIVE_WORKER_FACTORY,
            useFactory: createArchiveWorkerFactory,
        },
    ]);
}

function createArchiveWorkerFactory(): CoreCatalogArchiveWorkerFactory | null {
    if (typeof Worker === 'undefined') return null;
    return () => new Worker(new URL('../core-catalog-archive.worker', import.meta.url), {
        type: 'module',
        name: 'core-catalog-archive',
    });
}
