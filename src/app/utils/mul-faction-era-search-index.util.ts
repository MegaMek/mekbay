// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSearchWorkerFactionEraSnapshot } from './unit-search-worker-protocol.util';

/**
 * Runtime form of the compact MUL faction/era snapshot.
 *
 * Exact faction/era pairs are expanded to unit UUIDs only when a
 * query touches them. This avoids both a catalog scan and a fully expanded
 * faction-by-era index containing millions of repeated identity strings.
 */
export interface MulFactionEraSearchIndex {
    readonly unitUuidsByMulId: ReadonlyMap<number, readonly string[]>;
    readonly factionEraReferenceIds: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
    readonly factionEraUnitIds: Map<string, Map<string, ReadonlySet<string>>>;
}

export function createMulFactionEraSearchIndex(
    snapshot: UnitSearchWorkerFactionEraSnapshot,
): MulFactionEraSearchIndex {
    return {
        unitUuidsByMulId: new Map(
            Object.entries(snapshot.unitUuidsByMulId)
                .map(([mulId, unitUuids]) => [Number(mulId), unitUuids] as const),
        ),
        factionEraReferenceIds: new Map(
            Object.entries(snapshot.referenceIdsByEraAndFaction)
                .map(([eraName, factionMap]) => [
                    eraName,
                    new Map(Object.entries(factionMap)),
                ] as const),
        ),
        factionEraUnitIds: new Map(),
    };
}

function getExactFactionEraUnitUuids(
    index: MulFactionEraSearchIndex,
    eraName: string,
    factionName: string,
): ReadonlySet<string> {
    let eraFactionUnitIds = index.factionEraUnitIds.get(eraName);
    if (!eraFactionUnitIds) {
        eraFactionUnitIds = new Map();
        index.factionEraUnitIds.set(eraName, eraFactionUnitIds);
    }

    let exactPair = eraFactionUnitIds.get(factionName);
    if (!exactPair) {
        const expanded = new Set<string>();
        const referenceIds = index.factionEraReferenceIds.get(eraName)?.get(factionName) ?? [];
        for (const referenceId of referenceIds) {
            for (const unitUuid of index.unitUuidsByMulId.get(referenceId) ?? []) {
                expanded.add(unitUuid);
            }
        }
        exactPair = expanded;
        eraFactionUnitIds.set(factionName, exactPair);
    }

    return exactPair;
}

export function getMulFactionEraUnitUuids(
    index: MulFactionEraSearchIndex,
    eraNames: readonly string[],
    factionNames: readonly string[],
): ReadonlySet<string> {
    if (eraNames.length === 0 || factionNames.length === 0) {
        return new Set<string>();
    }

    if (eraNames.length === 1 && factionNames.length === 1) {
        return getExactFactionEraUnitUuids(index, eraNames[0], factionNames[0]);
    }

    const unitUuids = new Set<string>();
    for (const eraName of eraNames) {
        for (const factionName of factionNames) {
            for (const unitUuid of getExactFactionEraUnitUuids(index, eraName, factionName)) {
                unitUuids.add(unitUuid);
            }
        }
    }

    return unitUuids;
}
