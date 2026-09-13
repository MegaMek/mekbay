// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { forceMemberModel, forceMemberPresentationUnit, isCBTForceMember, type ForceMember } from '../models/force-member.model';
import type { DisplayUnitNameFormat } from '../models/options.model';
import type { PrintAllOptions } from '../models/print-options.model';
import type { SpriteStorageService } from '../services/sprite-storage.service';
import { MM_DATA_UNIT_PROVIDER_ID } from '../services/unit-catalog/unit-catalog.types';
import { printRecordSheetPages } from './record-sheet-print.util';
import { recordSheetPageProfile } from './sheets/record-sheet-layout';
import { addLine, addText, addWrappedText, createRoot, setAttributes, svgElement } from './sheets/record-sheet-svg-rendering';
import { TABLETOP_HEX_CORNERS, TABLETOP_HEX_FLAT_TO_FLAT, TABLETOP_HEX_RADIUS } from './tabletop-hex';
import { formatUnitChassis } from './unit-display-name.util';
import { resolveUnitSpritePath } from './unit-sprite-resolver';

/** Full-size tabletop counters, sharing flat edges in vertical cutting strips. */
export async function printUnitTiles(
    members: readonly ForceMember[],
    sprites: Pick<SpriteStorageService, 'getVerifiedAssignmentContext' | 'getExtractedIconUrl'>,
    options: Pick<PrintAllOptions, 'paperSize' | 'printMargin'>,
    nameFormat: DisplayUnitNameFormat = 'innerSphereClan',
    triggerPrint = true,
): Promise<void> {
    if (members.length === 0) return;
    const context = members.some(isCBTForceMember)
        ? await sprites.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID) : null;
    const icons = await Promise.all(members.map(async member => {
        const path = isCBTForceMember(member)
            ? resolveUnitSpritePath(member.entity, context?.assignments) : member.getSummary().icon;
        return (path ? await sprites.getExtractedIconUrl(path) : null) ?? '/images/unknown.png';
    }));

    const page = recordSheetPageProfile(options.paperSize);
    const width = TABLETOP_HEX_RADIUS * 2;
    const height = TABLETOP_HEX_FLAT_TO_FLAT;
    const stripGap = 8;
    const columns = Math.floor((page.contentWidth + stripGap) / (width + stripGap));
    const rows = Math.floor(page.contentHeight / height);
    const perPage = columns * rows;
    const left = (page.width - columns * width - (columns - 1) * stripGap) / 2;
    const points = TABLETOP_HEX_CORNERS.map(corner => corner.join(',')).join(' ');
    const sheets: SVGSVGElement[] = [];

    for (let offset = 0; offset < members.length; offset += perPage) {
        const svg = createRoot(page.width, page.height, 'unit-tiles');
        const clip = svgElement('clipPath');
        clip.id = `unit-tile-clip-${sheets.length}`;
        const outline = svgElement('polygon');
        setAttributes(outline, { points });
        clip.appendChild(outline);
        svg.querySelector('defs')!.appendChild(clip);

        for (let column = 0; column < columns && offset + column * rows < members.length; column++) {
            const strip = svgElement('g');
            setAttributes(strip, {
                class: 'unit-tile-strip',
                transform: `translate(${left + column * (width + stripGap)} ${page.margin})`,
            });
            svg.appendChild(strip);
            const count = Math.min(rows, members.length - offset - column * rows);
            if (column > 0) {
                const x = -stripGap / 2;
                addLine(strip, x, 0, x, rows * height, '#999', 0.3).setAttribute('stroke-dasharray', '2 2');
            }

            for (let row = 0; row < count; row++) {
                const index = offset + column * rows + row;
                const member = members[index];
                const tile = svgElement('g');
                setAttributes(tile, {
                    class: 'unit-tile', 'data-unit-id': member.id,
                    transform: `translate(${width / 2} ${(row + 0.5) * height})`,
                });
                strip.appendChild(tile);
                const hex = svgElement('polygon');
                setAttributes(hex, { points, fill: '#fff', stroke: '#333', 'stroke-width': 0.5 });
                tile.appendChild(hex);
                const facing = svgElement('path');
                setAttributes(facing, {
                    class: 'unit-tile-facing', d: 'M 0 -42 L 5 -36 H -5 Z', fill: '#333',
                });
                tile.appendChild(facing);
                const icon = svgElement('image');
                setAttributes(icon, {
                    href: icons[index], x: -36, y: -41, width: 72, height: 60,
                    preserveAspectRatio: 'xMidYMid meet', 'clip-path': `url(#${clip.id})`,
                });
                tile.appendChild(icon);
                addText(tile, forceMemberModel(member), 0, 26, { size: 6.5, anchor: 'middle', maxWidth: 64 });
                const chassis = svgElement('g');
                setAttributes(chassis, { 'text-anchor': 'middle', 'font-weight': 700 });
                tile.appendChild(chassis);
                addWrappedText(chassis, formatUnitChassis(forceMemberPresentationUnit(member), nameFormat), 0, 33, 55,
                    { size: 7, lineHeight: 7.5, maxLines: 2 });
            }
        }
        sheets.push(svg);
    }

    await printRecordSheetPages(sheets, options, triggerPrint);
}
