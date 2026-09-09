// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { unitSummaryProjectionWorkerCount } from './unit-summary-projection-worker-factory.util';

describe('unit summary worker budget', () => {
    it('limits desktop CPU use and caps touch devices and low-memory devices', () => {
        expect(unitSummaryProjectionWorkerCount({ hardwareConcurrency: 16, coarsePointer: false })).toBe(4);
        expect(unitSummaryProjectionWorkerCount({ hardwareConcurrency: 8, coarsePointer: true })).toBe(2);
        expect(unitSummaryProjectionWorkerCount({ hardwareConcurrency: 8, coarsePointer: true, deviceMemory: 4 })).toBe(1);
        expect(unitSummaryProjectionWorkerCount({ hardwareConcurrency: 2, coarsePointer: false })).toBe(1);
        expect(unitSummaryProjectionWorkerCount({ hardwareConcurrency: NaN, coarsePointer: false })).toBe(1);
    });
});
