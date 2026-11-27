// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export function recordSheetAmmoName(value: string): string {
    return value
        .replace(/\s*\(Clan\)\s*/gu, ' ')
        .replace(/\s+Ammo$/u, '')
        .trim();
}

/** Keep ammo entries together and use one horizontal scale for the entire profile. */
export function layoutRecordSheetAmmo(
    entries: readonly string[],
    maxWidth: number,
    measure: (text: string) => number,
    prefix = 'Ammo:',
): { readonly lines: readonly string[]; readonly widths: readonly number[]; readonly scale: number } {
    if (entries.length === 0) return { lines: [], widths: [], scale: 1 };

    const naturalWidthLimit = maxWidth / 0.82;
    const parts = entries.map((entry, index) =>
        `${index === 0 && prefix ? `${prefix} ` : ''}${entry}${index < entries.length - 1 ? ',' : ''}`);
    const text = parts.join(' ');
    const breaks = [0];
    let offset = 0;
    for (const part of parts) {
        // Only an entry that cannot fit on its own may be split internally.
        // The prefix belongs to the first entry when checking that first row.
        if (measure(part) > naturalWidthLimit) {
            for (const word of part.matchAll(/\S+/gu)) {
                if (measure(word[0]) > naturalWidthLimit) {
                    let characterEnd = offset + word.index;
                    for (const character of word[0]) {
                        characterEnd += character.length;
                        breaks.push(characterEnd);
                    }
                } else {
                    breaks.push(offset + word.index + word[0].length);
                }
            }
        } else {
            breaks.push(offset + part.length);
        }
        offset += part.length + 1;
    }

    const rowCounts = Array<number>(breaks.length).fill(Infinity);
    const widestRows = Array<number>(breaks.length).fill(Infinity);
    const previousBreaks = Array<number>(breaks.length).fill(-1);
    const rowWidths = Array<number>(breaks.length).fill(0);
    rowCounts[0] = 0;
    widestRows[0] = 0;
    for (let end = 1; end < breaks.length; end++) {
        for (let start = 0; start < end; start++) {
            if (!Number.isFinite(rowCounts[start])) continue;
            const width = measure(text.slice(breaks[start], breaks[end]).trim());
            if (width > naturalWidthLimit) continue;
            const rowCount = rowCounts[start] + 1;
            const widestRow = Math.max(widestRows[start], width);
            if (rowCount < rowCounts[end]
                || (rowCount === rowCounts[end] && widestRow < widestRows[end])) {
                rowCounts[end] = rowCount;
                widestRows[end] = widestRow;
                previousBreaks[end] = start;
                rowWidths[end] = width;
            }
        }
    }

    const lines: string[] = [];
    const widths: number[] = [];
    for (let end = breaks.length - 1; end > 0; end = previousBreaks[end]) {
        lines.push(text.slice(breaks[previousBreaks[end]], breaks[end]).trim());
        widths.push(rowWidths[end]);
    }
    lines.reverse();
    widths.reverse();
    return { lines, widths, scale: Math.min(1, maxWidth / Math.max(...widths)) };
}
