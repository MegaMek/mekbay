// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
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
    const alpha = { uuid: 'alpha-uuid', name: 'Alpha' } as UnitSummary;
    const beta = { uuid: 'beta-uuid', name: 'Beta' } as UnitSummary;
    const units = new Map([[alpha.uuid, alpha], [beta.uuid, beta]]);

    it('hydrates known units and their matching normalization metadata atomically', () => {
        const match = { kind: 'bv' as const, adjustedValue: 1995, gunnery: 3, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([{ unitUuid: alpha.uuid, match }, { unitUuid: beta.uuid }]),
            uuid => units.get(uuid),
        );

        expect(hydrated.units).toEqual([alpha, beta]);
        expect(hydrated.normalizationMatchesByUnitUuid.get(alpha.uuid)).toEqual(match);
        expect(hydrated.normalizationMatchesByUnitUuid.has(beta.uuid)).toBeFalse();
    });

    it('drops unknown units together with their metadata and preserves known ordering', () => {
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                { unitUuid: 'missing-uuid', match: { kind: 'bv', adjustedValue: 1, gunnery: 4, piloting: 5 } },
                { unitUuid: beta.uuid },
                { unitUuid: alpha.uuid },
            ]),
            uuid => units.get(uuid),
        );

        expect(hydrated.units).toEqual([beta, alpha]);
        expect(hydrated.normalizationMatchesByUnitUuid.size).toBe(0);
    });

    it('keeps only the first duplicate entry to avoid metadata drift', () => {
        const firstMatch = { kind: 'bv' as const, adjustedValue: 1900, gunnery: 4, piloting: 4 };
        const hydrated = hydrateWorkerSearchResult(
            createResult([
                { unitUuid: alpha.uuid, match: firstMatch },
                { unitUuid: alpha.uuid, match: { kind: 'bv', adjustedValue: 2000, gunnery: 3, piloting: 4 } },
            ]),
            uuid => units.get(uuid),
        );

        expect(hydrated.units).toEqual([alpha]);
        expect(hydrated.normalizationMatchesByUnitUuid.get(alpha.uuid)).toEqual(firstMatch);
    });

    it('keeps distinct UUIDs even when display names collide', () => {
        const duplicateName = { uuid: 'duplicate-uuid', name: alpha.name } as UnitSummary;
        const unitsByUuid = new Map([[alpha.uuid, alpha], [duplicateName.uuid, duplicateName]]);

        const hydrated = hydrateWorkerSearchResult(
            createResult([{ unitUuid: alpha.uuid }, { unitUuid: duplicateName.uuid }]),
            uuid => unitsByUuid.get(uuid),
        );

        expect(hydrated.units).toEqual([alpha, duplicateName]);
    });
});
