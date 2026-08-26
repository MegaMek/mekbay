// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import {
    buildCoreCatalogGeneration,
    isReusableCoreSummary,
    isUnitSummaryArray,
    prepareUnitSummaryArray,
} from './core-catalog-generation';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asSourceHash,
    asUnitUuid,
    type UnitUuid,
} from './unit-catalog.types';

describe('core catalog generation', () => {
    const firstUuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const secondUuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
    const manifestHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');

    it('sorts summaries without cloning or mutating them', () => {
        const first = summary(firstUuid, manifestHash);
        const second = summary(secondUuid, asSourceHash('EEEEEEEEEEEEEEEEEEEEEEEEEEA'));
        const input = [second, first];

        const sorted = prepareUnitSummaryArray(input);

        expect(input).toEqual([second, first]);
        expect(sorted.map(unit => unit.uuid)).toEqual([firstUuid, secondUuid]);
        expect(sorted[0]).toBe(first);
        expect(isUnitSummaryArray(sorted)).toBeTrue();
    });

    it('uses the units manifest, summary version, and catalog hashes for activation', () => {
        const built = buildCoreCatalogGeneration({
            unitsManifestHash: manifestHash,
            summaryDependencyHashes,
            units: [summary(firstUuid, manifestHash)],
        });

        expect(built.activationId).toBe([
            manifestHash,
            UNIT_SUMMARY_VERSION,
            ...Object.values(summaryDependencyHashes),
        ].join(':'));
    });

    it('reuses only the exact provider, UUID, hash, and summary version', () => {
        const unit = summary(firstUuid, manifestHash);
        const entry = {
            origin: 'megamek' as const,
            design: { provider: unit.provider, uuid: unit.uuid },
            sourceRevision: asSourceHash(unit.hash),
        };

        expect(isReusableCoreSummary(unit, entry)).toBeTrue();
        expect(isReusableCoreSummary(
            { ...unit, summaryVersion: UNIT_SUMMARY_VERSION - 1 },
            entry,
        )).toBeFalse();
    });

    it('accepts stale positive summary versions as local data without reusing them', () => {
        const unit = summary(firstUuid, manifestHash);
        const stale = { ...unit, summaryVersion: UNIT_SUMMARY_VERSION - 1 };

        expect(isUnitSummaryArray([stale])).toBeTrue();
        expect(isUnitSummaryArray([{ ...unit, summaryVersion: 0 }])).toBeFalse();
    });

    it('rejects duplicate catalog entries', () => {
        const unit = summary(firstUuid, manifestHash);
        expect(() => prepareUnitSummaryArray([unit, unit])).toThrowError(/Duplicate catalog summary/u);
    });
});

const summaryDependencyHashes = Object.freeze({
    equipment: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    quirks: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    sourcebooks: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    sprites: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

function summary(uuid: UnitUuid, hash: ReturnType<typeof asSourceHash>): UnitSummary {
    return {
        uuid,
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek',
        hash,
        summaryVersion: UNIT_SUMMARY_VERSION,
        entityType: 'Mek',
        loadIssues: [],
        rulesRefs: [],
        name: uuid,
    } as unknown as UnitSummary;
}
