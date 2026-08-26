// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { InjectionToken } from '@angular/core';
import type { SearchWorkerLike } from './unit-search-worker-client.util';

export type SearchWorkerFactory = (() => SearchWorkerLike) | null;

/**
 * Search already consumes the prepared runtime indexes. Building and cloning a
 * second 10k-unit corpus costs substantially more than executing the indexed
 * search, especially on slower phones. Keep the injection seam for isolated
 * experiments, but do not duplicate the catalog in production by default.
 */
export const SEARCH_WORKER_FACTORY = new InjectionToken<SearchWorkerFactory>('SEARCH_WORKER_FACTORY', {
    providedIn: 'root',
    factory: () => null,
});
