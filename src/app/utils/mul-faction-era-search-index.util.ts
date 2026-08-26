// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSearchWorkerFactionEraSnapshot } from './unit-search-worker-protocol.util';

/**
 * Runtime form of the compact MUL faction/era snapshot.
 *
 * Exact faction/era pairs are expanded to search identity keys only when a
 * query touches them. This avoids both a catalog scan and a fully expanded
 * faction-by-era index containing millions of repeated identity strings.
 */
export interface MulFactionEraSearchIndex {
    readonly unitIdentityKeysByMulId: ReadonlyMap<number, readonly string[]>;
    readonly factionEraReferenceIds: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
    readonly factionEraUnitIds: Map<string, Map<string, ReadonlySet<string>>>;
}

export function createMulFactionEraSearchIndex(
    snapshot: UnitSearchWorkerFactionEraSnapshot,
): MulFactionEraSearchIndex {
    return {
        unitIdentityKeysByMulId: new Map(
            Object.entries(snapshot.unitIdentityKeysByMulId)
                .map(([mulId, identityKeys]) => [Number(mulId), identityKeys] as const),
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

function getExactFactionEraUnitIdentityKeys(
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
            for (const identityKey of index.unitIdentityKeysByMulId.get(referenceId) ?? []) {
                expanded.add(identityKey);
            }
        }
        exactPair = expanded;
        eraFactionUnitIds.set(factionName, exactPair);
    }

    return exactPair;
}

export function getMulFactionEraUnitIdentityKeys(
    index: MulFactionEraSearchIndex,
    eraNames: readonly string[],
    factionNames: readonly string[],
): ReadonlySet<string> {
    if (eraNames.length === 0 || factionNames.length === 0) {
        return new Set<string>();
    }

    if (eraNames.length === 1 && factionNames.length === 1) {
        return getExactFactionEraUnitIdentityKeys(index, eraNames[0], factionNames[0]);
    }

    const unitIdentityKeys = new Set<string>();
    for (const eraName of eraNames) {
        for (const factionName of factionNames) {
            for (const identityKey of getExactFactionEraUnitIdentityKeys(index, eraName, factionName)) {
                unitIdentityKeys.add(identityKey);
            }
        }
    }

    return unitIdentityKeys;
}
