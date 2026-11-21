// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type EquipmentRowOrderGroup = 'ranged' | 'physical';

/** Sparse presentation-only order over the Entity-projected canonical rows. */
export interface EquipmentRowOrderState {
    readonly ranged?: readonly number[];
    readonly physical?: readonly number[];
}

/** Stores the user's order as given: the default order differs from Entity order, so even Entity order is a choice. */
export function setEquipmentRowOrder(
    current: EquipmentRowOrderState | undefined,
    group: EquipmentRowOrderGroup,
    permutation: readonly number[],
    rowCount: number,
): EquipmentRowOrderState | undefined {
    assertPermutation(permutation, rowCount);
    const normalized = Object.freeze([...permutation]);
    if (sameOrder(current?.[group], normalized)) return current;
    const ranged = group === 'ranged' ? normalized : current?.ranged;
    const physical = group === 'physical' ? normalized : current?.physical;
    if (ranged === undefined && physical === undefined) return undefined;
    return Object.freeze({
        ...(ranged === undefined ? {} : { ranged }),
        ...(physical === undefined ? {} : { physical }),
    });
}

/**
 * Applies a valid saved permutation of the rows in Entity order; without one (or after topology drift) the rows take
 * their default order. The permutation always indexes the Entity order, so a new default never moves a saved row.
 */
export function applyEquipmentRowOrder<T>(
    rows: readonly T[],
    permutation: readonly number[] | undefined,
    defaultOrder: (rows: readonly T[]) => T[] = defaultRows => [...defaultRows],
): T[] {
    if (permutation === undefined || !isPermutation(permutation, rows.length)) return defaultOrder(rows);
    return permutation.map(index => rows[index]!);
}

/** Validates and freezes sparse row-order state at runtime and persistence boundaries. */
export function freezeEquipmentRowOrder(
    value: EquipmentRowOrderState | undefined,
): EquipmentRowOrderState | undefined {
    if (value === undefined) return undefined;
    const keys = Object.keys(value);
    if (keys.some(key => key !== 'ranged' && key !== 'physical')) {
        throw new Error('Equipment row order contains an unknown group');
    }
    const ranged = normalizePermutation(value.ranged);
    const physical = normalizePermutation(value.physical);
    if (ranged === undefined && physical === undefined) return undefined;
    return Object.freeze({
        ...(ranged === undefined ? {} : { ranged }),
        ...(physical === undefined ? {} : { physical }),
    });
}

function normalizePermutation(value: readonly number[] | undefined): readonly number[] | undefined {
    if (value === undefined) return undefined;
    assertPermutation(value, value.length);
    return Object.freeze([...value]);
}

function assertPermutation(value: readonly number[], rowCount: number): void {
    if (!Number.isSafeInteger(rowCount) || rowCount < 0 || !isPermutation(value, rowCount)) {
        throw new Error('Equipment row order must be a complete canonical-row permutation');
    }
}

function isPermutation(value: readonly number[], rowCount: number): boolean {
    if (!Array.isArray(value) || value.length !== rowCount) return false;
    const seen = new Set<number>();
    for (const index of value) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= rowCount || seen.has(index)) return false;
        seen.add(index);
    }
    return true;
}

function sameOrder(
    left: readonly number[] | undefined,
    right: readonly number[] | undefined,
): boolean {
    return left === right || (left !== undefined && right !== undefined
        && left.length === right.length
        && left.every((value, index) => value === right[index]));
}
