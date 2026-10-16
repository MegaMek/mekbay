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

/** Turn columns the record sheet provides. */
export const VELOCITY_RECORD_TURNS = 20;
const MAX_VALUE = 99;

/** One value a player wrote into the velocity record. */
export interface VelocityRecordEntry {
    readonly turn: number;
    readonly field: VelocityRecordField;
    readonly value: number;
}

/** Why an entry cannot be recorded, or null when it fits the sheet. */
export function velocityRecordEntryIssue(entry: VelocityRecordEntry): string | null {
    if (!Number.isSafeInteger(entry.turn) || entry.turn < 1 || entry.turn > VELOCITY_RECORD_TURNS) {
        return `Velocity record turns run from 1 to ${VELOCITY_RECORD_TURNS}.`;
    }
    if (!VELOCITY_RECORD_FIELDS.includes(entry.field)) return `Unknown velocity record field ${entry.field}.`;
    if (!Number.isSafeInteger(entry.value) || entry.value < 0 || entry.value > MAX_VALUE) {
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
): readonly VelocityRecordEntry[] {
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
): number {
    const current = velocityRecordValue(entries, turn, field);
    if (current !== undefined) return current;
    if (field === 'effectiveVelocity') {
        const velocity = velocityRecordValue(entries, turn, 'velocity');
        if (velocity !== undefined) return velocity;
    }
    return entries.filter(entry => entry.field === field && entry.turn < turn).at(-1)?.value ?? 0;
}
