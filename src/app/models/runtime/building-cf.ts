// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTNonMekUnitSnapshot } from '../cbt-unit-snapshot';
import { parseBuildingLocation } from '../entity/types/building';

export interface BuildingChargeHex {
    readonly location: string;
    readonly label: string;
    readonly cf: number;
}

/** TW p. 148. A charge strikes one hex, whose floors all share its current CF (p. 166). */
export function buildingChargeHexes(locations: readonly Readonly<{ code: string; previewRemainingInternal: number }>[]): BuildingChargeHex[] {
    const hexes = new Map<string, BuildingChargeHex>();
    for (const row of locations) {
        const entry = parseBuildingLocation(row.code);
        if (!entry) continue;
        const label = `${entry.hex.q}, ${entry.hex.r}`;
        const previous = hexes.get(label);
        hexes.set(label, { label, location: previous?.location ?? row.code,
            cf: Math.min(previous?.cf ?? Infinity, row.previewRemainingInternal) });
    }
    return [...hexes.values()].filter(hex => hex.cf > 0);
}

/** TW p. 166. All floors share hex CF, including older saves with damage recorded on only one floor. */
export function buildingCfLosses(snapshot: CBTNonMekUnitSnapshot, location: string, damage: number,
    perspective: 'committed' | 'preview') {
    const struck = parseBuildingLocation(location)?.hex;
    if (!struck || ![...snapshot.index.locations.values()].some(row => row.code === location)) return null;
    const floors = [...snapshot.index.locations.values()].filter(row => {
        const hex = parseBuildingLocation(row.code)?.hex;
        return hex?.q === struck.q && hex.r === struck.r;
    }).map(row => ({ locationId: row.id, current: snapshot.query.remainingInternal(row.id, perspective) }));
    const remaining = Math.max(0, Math.min(...floors.map(row => row.current)) - damage);
    return floors.filter(row => row.current > remaining)
        .map(row => ({ locationId: row.locationId, amount: row.current - remaining }));
}
