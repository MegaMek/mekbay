// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Rows of the aerospace record sheet's velocity record, in sheet order. */
export const VELOCITY_RECORD_FIELDS = ['thrust', 'velocity', 'effectiveVelocity', 'altitude'] as const;
export type VelocityRecordField = typeof VELOCITY_RECORD_FIELDS[number];

export const VELOCITY_RECORD_LABELS: Readonly<Record<VelocityRecordField, string>> = Object.freeze({
    thrust: 'Thrust',
    velocity: 'Velocity',
    effectiveVelocity: 'Effective Velocity',
    altitude: 'Altitude',
});

/** Turn columns the record sheet provides: two tables of ten. */
export const VELOCITY_RECORD_TURNS = 20;
const MAX_VALUE = 99;

/** One value a player wrote into the velocity record. */
export interface VelocityRecordEntry {
    readonly turn: number;
    readonly field: VelocityRecordField;
    readonly value: number;
}

/** Why an entry cannot be recorded, or null when it fits the sheet. */
export function isAirshipSpeed(field: VelocityRecordField): boolean {
    return field === 'velocity' || field === 'effectiveVelocity';
}

/** Whole thrust available on one turn of the four-turn Airship Velocity Table (TW p. 205). */
export function airshipThrust(velocity: number, turn: number): number {
    const turnInCycle = (turn - 1) % 4;
    const extraTurns = [0, 2, 3];
    return Math.floor(velocity) + Number(extraTurns.slice(0, (velocity % 1) * 4).includes(turnInCycle));
}

export function velocityRecordEntryIssue(entry: VelocityRecordEntry, airship = false): string | null {
    if (!Number.isSafeInteger(entry.turn) || entry.turn < 1) return 'Velocity record turns start at 1.';
    if (!VELOCITY_RECORD_FIELDS.includes(entry.field)) return `Unknown velocity record field ${entry.field}.`;
    if (!Number.isSafeInteger(entry.value * (airship && isAirshipSpeed(entry.field) ? 4 : 1)) || entry.value < 0 || entry.value > MAX_VALUE) {
        return `Velocity record values run from 0 to ${MAX_VALUE}.`;
    }
    return null;
}

/** Canonical order: by turn, then sheet row. */
export function compareVelocityRecordEntries(left: VelocityRecordEntry, right: VelocityRecordEntry): number {
    return left.turn - right.turn
        || VELOCITY_RECORD_FIELDS.indexOf(left.field) - VELOCITY_RECORD_FIELDS.indexOf(right.field);
}

export function velocityRecordValue(
    entries: readonly VelocityRecordEntry[],
    turn: number,
    field: VelocityRecordField,
): number | undefined {
    return entries.find(entry => entry.turn === turn && entry.field === field)?.value;
}

/** The record with one cell set, or cleared with null, in canonical order. */
export function withVelocityRecordValue(
    entries: readonly VelocityRecordEntry[],
    turn: number,
    field: VelocityRecordField,
    value: number | null,
    airship = false,
): readonly VelocityRecordEntry[] {
    if (airship && field === 'velocity') {
        const first = turn - (turn - 1) % 4;
        let result = entries;
        for (let n = first; n < first + 4; n++) result = withVelocityRecordValue(result, n, field, value);
        return result;
    }
    const kept = entries.filter(entry => entry.turn !== turn || entry.field !== field);
    return value === null ? kept : [...kept, { turn, field, value }].sort(compareVelocityRecordEntries);
}

/**
 * A starting value for an empty cell, so most turns take one quick confirmation: the latest earlier value of the
 * row, or this turn's velocity for an unset effective velocity.
 */
export function suggestedVelocityRecordValue(
    entries: readonly VelocityRecordEntry[],
    turn: number,
    field: VelocityRecordField,
    airship = false,
): number {
    const current = velocityRecordValue(entries, turn, field);
    if (current !== undefined) return current;
    if (airship && field === 'thrust') {
        const velocity = velocityRecordValue(entries, turn, 'velocity');
        if (velocity !== undefined) return airshipThrust(velocity, turn);
    }
    if (field === 'effectiveVelocity') {
        const velocity = velocityRecordValue(entries, turn, 'velocity');
        if (velocity !== undefined) return velocity;
    }
    return entries.filter(entry => entry.field === field && entry.turn < turn).at(-1)?.value ?? 0;
}
