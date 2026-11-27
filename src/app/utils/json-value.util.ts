// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Accepts ordinary object literals and records deliberately created without a prototype. */
export function isPlainRecord<T extends object>(value: T): boolean;
export function isPlainRecord(value: unknown): value is Record<string, unknown>;
export function isPlainRecord(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** Accepts only an ordinary object literal; null-prototype records are excluded. */
export function isObjectLiteralRecord(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Structural equality for JSON-compatible values without serialization. */
export function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== typeof right) return false;

    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => jsonValuesEqual(value, right[index]));
    }
    if (typeof left !== 'object') return false;

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length
        && leftKeys.every(key => Object.prototype.hasOwnProperty.call(rightRecord, key)
            && jsonValuesEqual(leftRecord[key], rightRecord[key]));
}
