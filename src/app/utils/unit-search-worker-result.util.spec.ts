// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { asUnitUuid, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { UnitSearchWorkerResultMessage } from './unit-search-worker-protocol.util';
import { hydrateWorkerSearchResult } from './unit-search-worker-result.util';

function createResult(entries: UnitSearchWorkerResultMessage['entries']): UnitSearchWorkerResultMessage {
    return {
        type: 'result',
        revision: 1,
        corpusVersion: 'v1',
        telemetryQuery: '',
        entries,
        stages: [],
        totalMs: 0,
        unitCount: entries.length,
        isComplex: false,
    };
}

describe('hydrateWorkerSearchResult', () => {
    const alpha = { uuid: asUnitUuid('01900000-0000-7000-8000-000000000001'), name: 'Alpha' } as UnitSummary;
    const beta = { uuid: asUnitUuid('01900000-0000-7000-8000-000000000002'), name: 'Beta' } as UnitSummary;
    const otherAlpha = { uuid: asUnitUuid('01900000-0000-7000-8000-000000000003'), name: 'Alpha' } as UnitSummary;
    const units = new Map([
        [alpha.uuid, alpha],
        [beta.uuid, beta],
        [otherAlpha.uuid, otherAlpha],
    ]);
    const resolve = (unitUuid: UnitUuid) => units.get(unitUuid);
    const entry = (unit: UnitSummary) => ({ unitUuid: unit.uuid });

    it('hydrates known units and their matching normalization metadata atomically', () => {
        const match = { kind: 'bv' as const, adjustedValue: 1995, gunnery: 3, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([{ ...entry(alpha), match }, entry(beta)]),
            resolve,
        );

        expect(hydrated.units).toEqual([alpha, beta]);
        expect(hydrated.normalizationMatchesByUnitUuid.get(alpha.uuid)).toEqual(match);
        expect(hydrated.normalizationMatchesByUnitUuid.has(beta.uuid)).toBeFalse();
    });

    it('drops unknown units together with their metadata and preserves known ordering', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                {
                    unitUuid: asUnitUuid('01900000-0000-7000-8000-000000000099'),
                    match: { kind: 'bv', adjustedValue: 1, gunnery: 4, piloting: 5 },
                },
                entry(beta),
                entry(alpha),
            ]),
            resolve,
        );

        expect(hydrated.units).toEqual([beta, alpha]);
        expect(hydrated.normalizationMatchesByUnitUuid.size).toBe(0);
    });

    it('keeps only the first duplicate identity entry to avoid metadata drift', () => {
        const firstMatch = { kind: 'bv' as const, adjustedValue: 1900, gunnery: 4, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                { ...entry(alpha), match: firstMatch },
                { ...entry(alpha), match: { kind: 'bv', adjustedValue: 2000, gunnery: 3, piloting: 4 } },
            ]),
            resolve,
        );

        expect(hydrated.units).toEqual([alpha]);
        expect(hydrated.normalizationMatchesByUnitUuid.get(alpha.uuid)).toEqual(firstMatch);
    });

    it('preserves same-named units with distinct UUIDs', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([entry(alpha), entry(otherAlpha)]),
            resolve,
        );

        expect(hydrated.units).toEqual([alpha, otherAlpha]);
    });
});
