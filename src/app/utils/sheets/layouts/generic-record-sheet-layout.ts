// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import {
    createRoot,
    drawGenericCrewPanel,
    drawCriticalPanel,
    drawDamagePanel,
    drawGeneratedFooter,
    drawIdentityPanel,
    drawInventoryPanel,
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
        drawInventoryPanel(svg, entity, at({ x: 18, y: 226, width: 220, height: 280 }), 29, false);
        drawGenericCrewPanel(svg, entity, at({ x: 242, y: 62, width: 150, height: 160 }));
        drawCriticalPanel(svg, entity, at({ x: 242, y: 226, width: 150, height: 280 }));
        drawDamagePanel(svg, entity, at({ x: 396, y: 62, width: 198, height: 444 }));
        drawReferencePanel(svg, at({ x: 18, y: 510, width: 282, height: 264 }));
        drawNotesPanel(svg, at({ x: 304, y: 510, width: 290, height: 264 }));
        drawGeneratedFooter(svg, page, { catalystX: 527.13, catalystY: 59.25, catalystScale: 1.015 });
        return svg;
    }
}
