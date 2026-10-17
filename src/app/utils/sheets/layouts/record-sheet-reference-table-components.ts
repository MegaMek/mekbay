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
    const scale = Math.min(1, box.width / canonicalWidth, box.height / canonicalHeight);
    content.setAttribute('transform', `scale(${scale})`);
    group.appendChild(content);
    return content;
}

/**
 * One row of a turn track: numbered turns above, the player's value per turn below, as on
 * MegaMekLab's submarine depth and VTOL elevation tracks. Templates differ only in their grid.
 */
export function drawTurnTrack(
    parent: SVGGElement,
    { x, y, font }: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
    track: {
        readonly top: number;
        readonly height: number;
        readonly right: number;
        readonly firstColumnX: number;
        readonly columnWidth: number;
        readonly firstTurn: number;
        readonly turns: number;
        readonly valueLabel: string;
        /** Gap between each text baseline and the rule beneath it. */
        readonly textInset: number;
        readonly turnClass?: string;
    },
): void {
    const middle = track.top + track.height / 2;
    const outline = svgElement('rect');
    setAttributes(outline, {
        x: x(4.5), y: y(track.top), width: x(track.right - 4.5), height: y(track.height), rx: font(1.315),
        fill: 'none', stroke: '#000', 'stroke-width': font(1),
    });
    parent.appendChild(outline);
    const rule = (x1: number, y1: number, x2: number, y2: number): void => {
        const line = svgElement('line');
        setAttributes(line, { x1: x(x1), y1: y(y1), x2: x(x2), y2: y(y2), stroke: '#000', 'stroke-width': font(0.58) });
        parent.appendChild(line);
    };
    rule(4.5, middle, track.right, middle);
    for (let column = 0; column <= track.turns; column++) {
        const columnX = track.firstColumnX + column * track.columnWidth;
        rule(columnX, track.top, columnX, track.top + track.height);
    }
    const bold = { size: font(6.76), weight: 700 } as const;
    addText(parent, 'Turn', x(7.5), y(middle - track.textInset), bold);
    addText(parent, track.valueLabel, x(7.5), y(track.top + track.height - track.textInset), bold);
    for (let turn = 0; turn < track.turns; turn++) {
        addText(parent, String(track.firstTurn + turn), x(track.firstColumnX + (turn + 0.5) * track.columnWidth),
            y(middle - track.textInset), {
                ...bold, anchor: 'middle', class: track.turnClass, maxWidth: x(track.columnWidth - 1.2),
            });
    }
}
