// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

const MTF_FLUFF_KEYS = new Set([
    'overview', 'capabilities', 'deployment', 'history', 'manufacturer',
    'primaryfactory', 'notes', 'fluffdate', 'systemmanufacturer', 'systemmode',
]);

const BLK_FLUFF_TAGS = new Set([
    'overview', 'capabilities', 'deployment', 'history', 'manufacturer',
    'primaryfactory', 'notes', 'fluffdate', 'use', 'length', 'width', 'height',
    'systemmanufacturers', 'systemmodels',
]);

/**
 * Rows used by the native round-trip gate. Only the two explicitly ignored
 * row forms are removed. Fluff values are compared after trimming because the
 * native parsers deliberately trim those values on load.
 */
export function nativeEntityComparisonRows(text: string): string[] {
    const rows: string[] = [];
    let fluffBlock: string | undefined;

    for (const line of text.split(/\r?\n/u)) {
        if (line.startsWith('#') || line.startsWith('generator:')) continue;

        const trimmed = line.trim();
        if (fluffBlock !== undefined) {
            const closesBlock = isClosingTag(trimmed, fluffBlock);
            rows.push(closesBlock ? line : trimmed);
            if (closesBlock) fluffBlock = undefined;
            continue;
        }

        const openingTag = getOpeningTag(trimmed);
        if (openingTag !== undefined && BLK_FLUFF_TAGS.has(openingTag)) {
            fluffBlock = openingTag;
            rows.push(line);
            continue;
        }

        rows.push(trimMtfFluffValue(line));
    }

    return rows;
}

function trimMtfFluffValue(line: string): string {
    const separator = line.indexOf(':');
    if (separator <= 0) return line;
    const key = line.slice(0, separator).trim().toLowerCase();
    return MTF_FLUFF_KEYS.has(key)
        ? `${line.slice(0, separator + 1)}${line.slice(separator + 1).trim()}`
        : line;
}

function getOpeningTag(line: string): string | undefined {
    if (!line.startsWith('<') || line.startsWith('</') || !line.endsWith('>')) return undefined;
    return line.slice(1, -1).toLowerCase();
}

function isClosingTag(line: string, tag: string): boolean {
    return line.toLowerCase() === `</${tag}>`;
}
