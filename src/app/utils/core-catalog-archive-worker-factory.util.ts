// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InjectionToken } from '@angular/core';
import type {
    CoreCatalogArchiveWorkerFactory,
} from '../services/unit-catalog/core-catalog-archive-worker-client';

/**
 * Node-safe injection boundary. The browser provider owns `import.meta.url` so
 * CommonJS asset-pipeline graphs can import catalog services without parsing a
 * browser Worker URL.
 */
export const CORE_CATALOG_ARCHIVE_WORKER_FACTORY = new InjectionToken<
    CoreCatalogArchiveWorkerFactory | null
>('CORE_CATALOG_ARCHIVE_WORKER_FACTORY', {
    providedIn: 'root',
    factory: () => null,
});
