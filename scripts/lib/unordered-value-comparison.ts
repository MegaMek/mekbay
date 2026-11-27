// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Structural equality for JSON-like values where every array is an unordered
 * multiset. Object keys remain significant and duplicate array values count.
 */
export function unorderedStructuralEqual(left: unknown, right: unknown): boolean {
    return canonicalUnorderedValue(left) === canonicalUnorderedValue(right);
}

/** Keep long-running comparison reports useful without retaining whole unit graphs. */
export function formatBoundedDiagnosticValue(value: unknown, maxLength = 2_000): string {
    const serialized = diagnosticJson(value);
    if (serialized.length <= maxLength) return serialized;
    return `${serialized.slice(0, maxLength)}... <${serialized.length - maxLength} chars omitted>`;
}

function canonicalUnorderedValue(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'undefined': return 'undefined';
        case 'boolean': return value ? 'boolean:true' : 'boolean:false';
        case 'number': return `number:${numberToken(value)}`;
        case 'bigint': return `bigint:${value.toString()}`;
        case 'string': return `string:${JSON.stringify(value)}`;
        case 'symbol': return `symbol:${String(value.description)}`;
        case 'function': return `function:${String(value)}`;
        case 'object': break;
    }

    if (Array.isArray(value)) {
        const items = value.map(canonicalUnorderedValue).sort(compareText);
        return `array:[${items.join(',')}]`;
    }

    const entries = Object.keys(value)
        .sort(compareText)
        .map(key => `${JSON.stringify(key)}:${canonicalUnorderedValue(
            (value as Record<string, unknown>)[key],
        )}`);
    return `object:{${entries.join(',')}}`;
}

function numberToken(value: number): string {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Number.POSITIVE_INFINITY) return 'Infinity';
    if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
    if (Object.is(value, -0)) return '-0';
    return String(value);
}

function diagnosticJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
