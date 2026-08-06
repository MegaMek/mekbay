// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { InjectionToken } from '@angular/core';
import { isIOS } from './platform.util';
import type { SearchWorkerLike } from './unit-search-worker-client.util';

export type SearchWorkerFactory = (() => SearchWorkerLike) | null;

export interface SearchWorkerSupportOptions {
    workerAvailable: boolean;
    iOS: boolean;
}

export function shouldUseSearchWorker(options: SearchWorkerSupportOptions = {
    workerAvailable: typeof Worker !== 'undefined',
    iOS: isIOS(),
}): boolean {
    return options.workerAvailable; // && !options.iOS; // Disable service worker on iOS.
}

export const SEARCH_WORKER_FACTORY = new InjectionToken<SearchWorkerFactory>('SEARCH_WORKER_FACTORY', {
    providedIn: 'root',
    factory: () => {
        if (!shouldUseSearchWorker()) {
            return null;
        }

        return () => new Worker(new URL('../unit-search.worker', import.meta.url), { type: 'module' });
    },
});