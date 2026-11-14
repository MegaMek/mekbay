// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One Elevation recorded for a turn on a flying unit's Elevation Track: players record each VTOL's Elevation at the
 * end of the Movement Phase (TW p. 55).
 */
export interface ElevationRecordEntry {
    readonly turn: number;
    readonly value: number;
}

/** A VTOL may climb to Elevation 500 (TW p. 55). */
export const MAX_NON_MEK_ELEVATION = 500;

/** The VTOL Elevation Track's turn columns: two tables of fifteen. */
export const ELEVATION_TRACK_TURNS = 30;

/** Why an entry cannot be recorded, or null when it fits. */
export function elevationRecordEntryIssue(entry: ElevationRecordEntry): string | null {
    if (!Number.isSafeInteger(entry.turn) || entry.turn < 1) return 'Elevation record turns start at 1.';
    if (!Number.isSafeInteger(entry.value) || entry.value < 0 || entry.value > MAX_NON_MEK_ELEVATION) {
        return `Elevations run from 0 to ${MAX_NON_MEK_ELEVATION}.`;
    }
    return null;
}

/** The Elevation in `turn`: the last one recorded up to it, as the unit stays there until it moves; 0 when none. */
export function elevationAt(record: readonly ElevationRecordEntry[] | undefined, turn: number): number {
    let latest: ElevationRecordEntry | undefined;
    for (const entry of record ?? []) {
        if (entry.turn <= turn && (latest === undefined || entry.turn > latest.turn)) latest = entry;
    }
    return latest?.value ?? 0;
}

/** The record with `turn` set to `value`, or cleared with null, in turn order. */
export function withElevationRecordValue(
    record: readonly ElevationRecordEntry[] | undefined,
    turn: number,
    value: number | null,
): readonly ElevationRecordEntry[] {
    const kept = (record ?? []).filter(entry => entry.turn !== turn);
    return Object.freeze((value === null ? kept : [...kept, Object.freeze({ turn, value })])
        .sort((left, right) => left.turn - right.turn));
}
