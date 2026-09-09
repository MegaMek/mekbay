// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/// <reference lib="webworker" />

import { UnitSummaryProjectionWorkerRuntime } from './services/unit-catalog/unit-summary-projection-worker-runtime';
import type { UnitSummaryProjectionWorkerRequest } from './services/unit-catalog/unit-summary-projection-worker-protocol';

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    const runtime = new UnitSummaryProjectionWorkerRuntime(response => postMessage(response));
    addEventListener('message', ({ data }: MessageEvent<UnitSummaryProjectionWorkerRequest>) => {
        void runtime.handleMessage(data);
    });
}
