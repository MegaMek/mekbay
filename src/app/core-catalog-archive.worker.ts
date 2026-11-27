// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/// <reference lib="webworker" />

import {
    CoreCatalogArchiveWorkerRuntime,
} from './services/unit-catalog/core-catalog-archive-worker-runtime';
import type {
    CoreCatalogArchiveWorkerRequest,
    CoreCatalogArchiveWorkerResponse,
} from './services/unit-catalog/core-catalog-archive-worker-protocol';
import {
    openCoreUnitRelease,
    openStoredCoreUnitArchive,
} from './services/unit-catalog/core-unit-archive';

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    const runtime = new CoreCatalogArchiveWorkerRuntime({
        openRelease: openCoreUnitRelease,
        openSourceArchive: openStoredCoreUnitArchive,
        sink: {
            postMessage: (message: CoreCatalogArchiveWorkerResponse, transfer?: Transferable[]): void => {
                postMessage(message, transfer ?? []);
            },
        },
    });
    addEventListener('message', ({ data }: MessageEvent<CoreCatalogArchiveWorkerRequest>) => {
        runtime.handleMessage(data);
    });
}
