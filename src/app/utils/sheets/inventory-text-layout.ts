// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { measureSvgTextCanvas } from '../svg-text.util';
import { addText, setAttributes, svgElement } from './record-sheet-svg-rendering';
import { INVENTORY_BADGE, RECORD_SHEET_FONT } from './record-sheet-typography';

export const MIN_INVENTORY_FONT = 4.5;
export const MIN_INVENTORY_LINE_RATIO = 0.93;

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

/** Mek-reference width and type stay fixed; only the background height follows dense leading. */
export function appendInventoryHitModifier(parent: SVGElement, baseline: number, scale = 1, lineHeight = 9 * scale): void {
    const height = Math.min(INVENTORY_BADGE.height * scale, Math.max(INVENTORY_BADGE.minimumHeight * scale, lineHeight));
    const rect = svgElement('rect');
    setAttributes(rect, { x: -INVENTORY_BADGE.width * scale / 2, y: baseline - 2.5 * scale - height / 2,
        width: INVENTORY_BADGE.width * scale, height,
        fill: '#000', class: 'hitMod-rect', display: 'none' });
    parent.appendChild(rect);
    const text = addText(parent, '', 0, baseline - 7 * scale + INVENTORY_BADGE.height * scale / 2
        + INVENTORY_BADGE.fontSize * scale / 3, {
        class: 'hitMod-text', size: INVENTORY_BADGE.fontSize * scale, weight: 700, fill: '#fff', anchor: 'middle' });
    text.setAttribute('font-family', 'monospace');
    text.setAttribute('display', 'none');
}
