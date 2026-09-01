// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import {
    asCatalogActivationId,
    type CatalogActivationId,
    type CoreCatalogEntryKey,
    type SourceHash,
} from './unit-catalog.types';
import type { SummaryDependencyHashes } from './unit-catalog-database';

export interface BuiltCoreCatalogGeneration {
    readonly activationId: CatalogActivationId;
    readonly summaries: readonly UnitSummary[];
}

export function isReusableCoreSummary(summary: UnitSummary, desiredEntry: CoreCatalogEntryKey): boolean {
    return summary.origin === 'megamek'
        && summary.uuid === desiredEntry.design.uuid
        && summary.hash === desiredEntry.sourceRevision
        && summary.summaryVersion === UNIT_SUMMARY_VERSION;
}

export function isUnitSummaryArray(value: unknown): value is readonly UnitSummary[] {
    return Array.isArray(value) && value.every(summary => {
        if (summary === null || typeof summary !== 'object') return false;
        const row = summary as Partial<UnitSummary>;
        return Number.isSafeInteger(row.summaryVersion)
            && (row.summaryVersion ?? 0) > 0
            && typeof row.hash === 'string'
            && typeof row.uuid === 'string'
            && typeof row.provider === 'string'
            && (row.origin === 'megamek' || row.origin === 'user');
    });
}

export function prepareUnitSummaryArray(units: readonly UnitSummary[]): readonly UnitSummary[] {
    const sorted = [...units].sort((left, right) => compareText(left.uuid, right.uuid));
    return Object.freeze(sorted);
}

export function buildCoreCatalogGeneration(input: {
    readonly unitsManifestHash: SourceHash;
    readonly summaryDependencyHashes: SummaryDependencyHashes;
    readonly units: readonly UnitSummary[];
}): BuiltCoreCatalogGeneration {
    return Object.freeze({
        activationId: asCatalogActivationId([
            input.unitsManifestHash,
            String(UNIT_SUMMARY_VERSION),
            input.summaryDependencyHashes.equipment,
            input.summaryDependencyHashes.quirks,
            input.summaryDependencyHashes.sourcebooks,
            input.summaryDependencyHashes.sprites,
        ].join(':')),
        summaries: prepareUnitSummaryArray(input.units),
    });
}
