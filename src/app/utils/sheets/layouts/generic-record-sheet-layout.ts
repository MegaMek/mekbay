// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { addInventoryText, fitInventoryText, inventoryRowLineCount } from '../inventory-text-layout';
import type { BaseEntity } from '../../../models/entity/base-entity';
import {
    createRoot,
    drawGenericCrewPanel,
    drawCriticalPanel,
    drawDamagePanel,
    drawGeneratedFooter,
    drawIdentityPanel,
    addFrame, setAttributes, svgElement, transparentRect, type Box,
    drawNotesPanel,
    drawPageChrome,
    drawReferencePanel,
    scalePageBox,
} from '../record-sheet-svg-rendering';
import type { RecordSheetLayout, RecordSheetLayoutRequest } from './record-sheet-layout';
import {
    fullRecordSheetLayoutProfile,
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
} from '../record-sheet-layout';

/** Safe fallback for entity families that do not yet have a specialized sheet. */
export class GenericRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'generic';

    public matches(_entity: BaseEntity): boolean {
        return true;
    }

    public profile(
        _entity: BaseEntity,
        pageFormat: RecordSheetPageFormat = 'letter',
    ): RecordSheetLayoutProfile {
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<SVGSVGElement> {
        const page = request.page;
        const svg = createRoot(page.width, page.height, entity.entityType.toLowerCase());
        const at = (box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) =>
            scalePageBox(page, box);
        drawPageChrome(svg, `${entity.unitSubtype().toUpperCase()} RECORD SHEET`, page, false);
        drawIdentityPanel(svg, entity, at({ x: 18, y: 62, width: 220, height: 160 }));
        drawInventoryPanel(svg, entity, at({ x: 18, y: 226, width: 220, height: 280 }));
        drawGenericCrewPanel(svg, entity, at({ x: 242, y: 62, width: 150, height: 160 }));
        drawCriticalPanel(svg, entity, at({ x: 242, y: 226, width: 150, height: 280 }));
        drawDamagePanel(svg, entity, at({ x: 396, y: 62, width: 198, height: 444 }));
        drawReferencePanel(svg, at({ x: 18, y: 510, width: 282, height: 264 }));
        drawNotesPanel(svg, at({ x: 304, y: 510, width: 290, height: 264 }));
        const catalyst = at({ x: 527.13, y: 59.25, width: 0, height: 0 });
        drawGeneratedFooter(svg, page, { catalystX: catalyst.x, catalystY: catalyst.y, catalystScale: 1.015 });
        return svg;
    }
}

function drawInventoryPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
    const group = addFrame(svg, 'WEAPONS & EQUIPMENT', box);
    const rows = Array.from({ length: Math.max(29, entity.equipment().length) }, (_, index) => {
        const mount = entity.equipment()[index];
        return { mount, name: mount?.displayName() ?? '',
            location: mount?.getOccupiedLocations().map(location => entity.componentLocationLabel(location)).join('/') ?? '' };
    });
    const nameWidth = Math.max(25, box.width - 70);
    const metrics = fitInventoryText(box.height - 27, fontSize => {
        const lineCounts = rows.map(row => inventoryRowLineCount([[row.name, nameWidth], [row.location, 48]], fontSize));
        return { lineCount: lineCounts.reduce((sum, count) => sum + count, 0), content: lineCounts };
    });
    let offset = 0;
    rows.forEach((row, index) => {
        const entry = svgElement('g');
        setAttributes(entry, { class: 'inventoryEntry', id: (row.mount?.equipmentId ?? 'unused') + '@' + index });
        group.appendChild(entry);
        const y = 22 + offset * metrics.lineStep;
        const height = metrics.content[index] * metrics.lineStep;
        entry.appendChild(transparentRect(7, y, box.width - 14, height, 'inventoryEntryButton mainButton'));
        addInventoryText(entry, row.name, 10, y + metrics.fontSize, {
            class: 'name', size: metrics.fontSize, maxWidth: nameWidth, lineHeight: metrics.lineStep });
        addInventoryText(entry, row.location, box.width - 7, y + metrics.fontSize, {
            class: 'location', size: metrics.fontSize, maxWidth: 48, anchor: 'end', lineHeight: metrics.lineStep });
        offset += metrics.content[index];
    });
}
