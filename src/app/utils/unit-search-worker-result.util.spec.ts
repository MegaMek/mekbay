// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { asUnitProviderId, type UnitProviderId } from '../services/unit-catalog/unit-catalog.types';
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
    const unitProviderId = asUnitProviderId('mm-data');
    const custom = asUnitProviderId('custom:test');
    const alpha = { uuid: '01900000-0000-7000-8000-000000000001', name: 'Alpha' } as UnitSummary;
    const beta = { uuid: '01900000-0000-7000-8000-000000000002', name: 'Beta' } as UnitSummary;
    const customAlpha = { uuid: '01900000-0000-7000-8000-000000000003', name: 'Alpha' } as UnitSummary;
    const identityKey = (provider: UnitProviderId, uuid: string) => `${provider.length}:${provider}${uuid.length}:${uuid}`;
    const units = new Map([
        [identityKey(unitProviderId, alpha.uuid), alpha],
        [identityKey(unitProviderId, beta.uuid), beta],
        [identityKey(custom, customAlpha.uuid), customAlpha],
    ]);
    const resolve = (provider: UnitProviderId, uuid: string) => units.get(identityKey(provider, uuid));
    const entry = (unit: UnitSummary, provider = unitProviderId) => ({ provider, uuid: unit.uuid, unitName: unit.name });

    it('hydrates known units and their matching normalization metadata atomically', () => {
        const match = { kind: 'bv' as const, adjustedValue: 1995, gunnery: 3, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([{ ...entry(alpha), match }, entry(beta)]),
            resolve,
        );

        expect(hydrated.units).toEqual([alpha, beta]);
        expect(hydrated.normalizationMatchesByUnit.get(alpha)).toEqual(match);
        expect(hydrated.normalizationMatchesByUnit.has(beta)).toBeFalse();
    });

    it('drops unknown units together with their metadata and preserves known ordering', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                {
                    provider: unitProviderId,
                    uuid: '01900000-0000-7000-8000-000000000099',
                    unitName: 'Missing',
                    match: { kind: 'bv', adjustedValue: 1, gunnery: 4, piloting: 5 },
                },
                entry(beta),
                entry(alpha),
            ]),
            resolve,
        );

        expect(hydrated.units).toEqual([beta, alpha]);
        expect(hydrated.normalizationMatchesByUnit.size).toBe(0);
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
        expect(hydrated.normalizationMatchesByUnit.get(alpha)).toEqual(firstMatch);
    });

    it('preserves same-named units from different providers by exact identity', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([entry(alpha), entry(customAlpha, custom)]),
            resolve,
        );

        expect(hydrated.units).toEqual([alpha, customAlpha]);
    });

    it('rejects an identity whose presentation name disagrees with the live unit', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([{ ...entry(alpha), unitName: 'Wrong Alpha' }]),
            resolve,
        );

        expect(hydrated.units).toEqual([]);
    });
});
