// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit } from '../models/units.model';
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
    const alpha = { name: 'Alpha' } as Unit;
    const beta = { name: 'Beta' } as Unit;
    const units = new Map([[alpha.name, alpha], [beta.name, beta]]);

    it('hydrates known units and their matching normalization metadata atomically', () => {
        const match = { kind: 'bv' as const, adjustedValue: 1995, gunnery: 3, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([{ unitName: 'Alpha', match }, { unitName: 'Beta' }]),
            name => units.get(name),
        );

        expect(hydrated.units).toEqual([alpha, beta]);
        expect(hydrated.normalizationMatchesByUnitName.get('Alpha')).toEqual(match);
        expect(hydrated.normalizationMatchesByUnitName.has('Beta')).toBeFalse();
    });

    it('drops unknown units together with their metadata and preserves known ordering', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                { unitName: 'Missing', match: { kind: 'bv', adjustedValue: 1, gunnery: 4, piloting: 5 } },
                { unitName: 'Beta' },
                { unitName: 'Alpha' },
            ]),
            name => units.get(name),
        );

        expect(hydrated.units).toEqual([beta, alpha]);
        expect(hydrated.normalizationMatchesByUnitName.size).toBe(0);
    });

    it('keeps only the first duplicate entry to avoid metadata drift', () => {
        const firstMatch = { kind: 'bv' as const, adjustedValue: 1900, gunnery: 4, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                { unitName: 'Alpha', match: firstMatch },
                { unitName: 'Alpha', match: { kind: 'bv', adjustedValue: 2000, gunnery: 3, piloting: 4 } },
            ]),
            name => units.get(name),
        );

        expect(hydrated.units).toEqual([alpha]);
        expect(hydrated.normalizationMatchesByUnitName.get('Alpha')).toEqual(firstMatch);
    });
});
