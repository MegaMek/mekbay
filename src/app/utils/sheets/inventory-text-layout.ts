// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { measureSvgTextCanvas } from '../svg-text.util';
import { addText, formatNumber, setAttributes, svgElement, transparentRect } from './record-sheet-svg-rendering';
import { INVENTORY_BADGE, RECORD_SHEET_FONT } from './record-sheet-typography';

export const MIN_INVENTORY_FONT = 4.5;
export const MIN_INVENTORY_LINE_RATIO = 0.93;
/** The wrap width addInventoryText laid a cell out at. */
export const INVENTORY_TEXT_WIDTH_ATTRIBUTE = 'data-mekbay-max-width';

/** Match MegaMekLab: tighten line spacing, then reduce type, preserving a readable minimum. */
export function fitInventoryText<T>(height: number,
    measure: (fontSize: number) => { lineCount: number; content: T; badgeRows?: readonly number[] }) {
    let fontSize: number = RECORD_SHEET_FONT.inventory;
    while (true) {
        const { lineCount, content, badgeRows = [] } = measure(fontSize);
        const minimumStep = fontSize * MIN_INVENTORY_LINE_RATIO;
        const maximumStep = fontSize * 1.35;
        const requiredHeight = (step: number) => lineCount * step
            + badgeRows.reduce((extra, lines) => extra + Math.max(0, INVENTORY_BADGE.minimumHeight - lines * step), 0);
        if (requiredHeight(minimumStep) <= height || fontSize <= MIN_INVENTORY_FONT) {
            let lineStep = maximumStep;
            if (requiredHeight(maximumStep) > height) {
                let low = minimumStep;
                let high = maximumStep;
                for (let i = 0; i < 24; i++) {
                    const middle = (low + high) / 2;
                    if (requiredHeight(middle) <= height) low = middle;
                    else high = middle;
                }
                lineStep = low;
            }
            return { fontSize, lineStep, content, fits: requiredHeight(lineStep) <= height };
        }
        fontSize = Math.max(MIN_INVENTORY_FONT, Number((fontSize - 0.05).toFixed(2)));
    }
}

/** Keep enough leading for the fixed-size badge text after its background gets shorter. */
export function inventoryRowSpan(lines: number, lineStep: number): number {
    return Math.max(lines, INVENTORY_BADGE.minimumHeight / lineStep);
}

/** Wrap at word boundaries, splitting a long identifier only when it cannot fit by itself. */
export function inventoryCellLines(value: string, width: number, fontSize: number = RECORD_SHEET_FONT.inventory): string[] {
    if (!value) return [''];
    const probe = svgElement('text');
    probe.setAttribute('font-size', String(fontSize));
    probe.setAttribute('font-family', 'Roboto, Arial, sans-serif');
    const fits = (text: string) => measureSvgTextCanvas(probe, text) <= width;
    const lines: string[] = [];
    let line = '';
    for (const word of value.trim().split(/\s+/u)) {
        if (fits(line ? `${line} ${word}` : word)) { line = line ? `${line} ${word}` : word; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const character of word) {
            if (line && !fits(line + character)) { lines.push(line); line = ''; }
            line += character;
        }
    }
    if (line) lines.push(line);
    return lines;
}

export function inventoryRowLineCount(cells: readonly (readonly [string, number])[], fontSize: number = RECORD_SHEET_FONT.inventory): number {
    return Math.max(1, ...cells.map(([value, width]) => inventoryCellLines(value, width, fontSize).length));
}

/** Inventory cells always wrap; textLength must never squeeze their glyphs. */
export function addInventoryText(parent: SVGElement, value: string, x: number, y: number,
    options: Parameters<typeof addText>[4] & { readonly lineHeight?: number } = {}): SVGTextElement {
    const { maxWidth, lineHeight = (options.size ?? RECORD_SHEET_FONT.inventory) * 1.35, ...style } = options;
    const text = addText(parent, '', x, y, { ...style, size: style.size ?? RECORD_SHEET_FONT.inventory });
    // Binders rewrap live values at this width, so they keep the lines laid out here.
    if (maxWidth) text.setAttribute(INVENTORY_TEXT_WIDTH_ATTRIBUTE, formatNumber(maxWidth));
    const lines = maxWidth ? inventoryCellLines(value, maxWidth, style.size) : [value];
    if (lines.length === 1) text.textContent = lines[0];
    else {
        let sourceOffset = 0;
        const source = value.trim().replace(/\s+/gu, ' ');
        lines.forEach((line, index) => {
            const span = svgElement('tspan');
            setAttributes(span, { x, y: y + index * lineHeight, 'font-size': style.size ?? RECORD_SHEET_FONT.inventory });
            span.textContent = line;
            text.appendChild(span);
            sourceOffset += line.length;
            if (index < lines.length - 1 && source[sourceOffset] === ' ') {
                text.appendChild(document.createTextNode(' '));
                sourceOffset++;
            }
        });
    }
    return text;
}

const RANGE_BOX_WIDTH = 12.4;
const RANGE_BOX_GAP = 1.4;
/** The widest value a range column prints before it wraps. */
export const INVENTORY_RANGE_VALUE_WIDTH = 12;

/** An inventory's row band and Min/Sht/Med/Lng columns, in its template units. */
export interface InventoryRangeColumns {
    readonly bandLeft: number;
    readonly bandRight: number;
    /** Centres of the Min, Sht, Med and Lng columns. */
    readonly ranges: readonly number[];
}

/**
 * Min/Sht/Med/Lng columns whose Lng box ends at `lngRight`: equal range boxes a constant gap apart, and the row band
 * from `bandLeft` to that gap before Min, so every inventory spaces its ranges alike.
 */
export function inventoryRangeColumns(bandLeft: number, lngRight: number): InventoryRangeColumns {
    const pitch = RANGE_BOX_WIDTH + RANGE_BOX_GAP;
    const ranges = [3, 2, 1, 0].map(step => lngRight - RANGE_BOX_WIDTH / 2 - step * pitch);
    return Object.freeze({
        bandLeft,
        bandRight: ranges[0] - RANGE_BOX_WIDTH / 2 - RANGE_BOX_GAP,
        ranges: Object.freeze(ranges),
    });
}

/** The full-width ('Mek and vehicle) inventory, its Lng box close to the frame. */
export const STANDARD_INVENTORY_COLUMNS = inventoryRangeColumns(6, 221.6);

/** Min/Sht/Med/Lng headings centred on their columns. */
export function inventoryRangeHeadings(columns: InventoryRangeColumns): readonly (readonly [string, number, 'middle'])[] {
    return (['Min', 'Sht', 'Med', 'Lng'] as const).map((label, index) => [label, columns.ranges[index], 'middle'] as const);
}

/** The row band and Sht/Med/Lng boxes through a layout's template-to-sheet x scale. */
export function inventoryRangeButtons(columns: InventoryRangeColumns, x: (value: number) => number): Readonly<{
    band: readonly [x: number, width: number];
    ranges: readonly (readonly [className: string, x: number, width: number])[];
}> {
    return Object.freeze({
        band: [x(columns.bandLeft), x(columns.bandRight - columns.bandLeft)] as const,
        ranges: (['shrButton', 'medButton', 'lngButton'] as const).map((className, index) =>
            [className, x(columns.ranges[index + 1] - RANGE_BOX_WIDTH / 2), x(RANGE_BOX_WIDTH)] as const),
    });
}

/** Vertical middle of an inventory line's text, shared by its badges and click targets. */
function inventoryLineMiddle(baseline: number, scale: number): number {
    return baseline - 2.5 * scale;
}

/**
 * An inventory row's click targets: the main (or alternative-mode) button and the range buttons, each a band of whole
 * line pitches centred on the row's text like its badges, so the selection highlight sits on the row in every layout.
 */
export function appendInventoryRowButtons(
    row: SVGElement,
    baseline: number,
    scale: number,
    lineHeight: number,
    lines: number,
    main: readonly [x: number, width: number],
    ranges: readonly (readonly [className: string, x: number, width: number])[] = [],
    mainClass: 'mainButton' | 'alternativeModeButton' = 'mainButton',
): void {
    const top = inventoryLineMiddle(baseline, scale) - lineHeight / 2;
    const height = lines * lineHeight;
    row.appendChild(transparentRect(main[0], top, main[1], height, `inventoryEntryButton ${mainClass}`));
    for (const [className, x, width] of ranges) {
        row.appendChild(transparentRect(x, top, width, height, `inventoryEntryButton ${className}`));
    }
}

/**
 * A row's weapon to-hit modifier and selected-target number, sharing one slot centred on the frame's left border: the
 * target number takes the modifier's place while a target is selected.
 */
export function appendInventoryBadges(parent: SVGElement, baseline: number, scale = 1, lineHeight = 9 * scale): void {
    appendInventoryBadge(parent, 'hitMod', baseline, scale, lineHeight);
    appendInventoryBadge(parent, 'targetTn', baseline, scale, lineHeight);
}

/** Mek-reference width and type stay fixed; only the background height follows dense leading. */
function appendInventoryBadge(parent: SVGElement, kind: 'hitMod' | 'targetTn', baseline: number, scale: number,
    lineHeight: number): void {
    const height = Math.min(INVENTORY_BADGE.height * scale, Math.max(INVENTORY_BADGE.minimumHeight * scale, lineHeight));
    const center = inventoryLineMiddle(baseline, scale);
    const hitModifier = kind === 'hitMod';
    const rect = svgElement('rect');
    setAttributes(rect, { x: -INVENTORY_BADGE.width * scale / 2, y: center - height / 2,
        width: INVENTORY_BADGE.width * scale, height,
        fill: hitModifier ? '#000' : '#fff', stroke: hitModifier ? undefined : '#000',
        'stroke-width': hitModifier ? undefined : 0.8 * scale, class: `${kind}-rect`, display: 'none' });
    parent.appendChild(rect);
    const text = addText(parent, '', 0, center + INVENTORY_BADGE.fontSize * scale / 3, {
        class: `${kind}-text`, size: INVENTORY_BADGE.fontSize * scale, weight: 700,
        fill: hitModifier ? '#fff' : undefined, anchor: 'middle' });
    text.setAttribute('font-family', 'monospace');
    text.setAttribute('display', 'none');
}
