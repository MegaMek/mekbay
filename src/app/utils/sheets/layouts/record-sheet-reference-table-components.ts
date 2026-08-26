// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    type Box,
    addText,
    setAttributes,
    svgElement,
} from '../record-sheet-svg-rendering';

/** Scales canonical MegaMekLab table coordinates into the calculated frame. */
export function canonicalReferenceContent(
    group: SVGGElement,
    box: Box,
    canonicalWidth: number,
    canonicalHeight: number,
): SVGGElement {
    const content = svgElement('g');
    content.setAttribute('transform', `scale(${box.width / canonicalWidth} ${box.height / canonicalHeight})`);
    group.appendChild(content);
    return content;
}

export function addReferenceShade(
    parent: SVGGElement,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const shade = svgElement('rect');
    setAttributes(shade, { x, y, width, height, fill: '#bbb', class: 'tableshading' });
    parent.appendChild(shade);
}

export function addExactReferenceText(
    parent: SVGGElement,
    value: string,
    x: number,
    y: number,
    size: number,
    textLength?: number,
): void {
    const text = addText(parent, value, x, y, { size });
    if (textLength !== undefined) {
        text.setAttribute('textLength', String(textLength));
        text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
}
