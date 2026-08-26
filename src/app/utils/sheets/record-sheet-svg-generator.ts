// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
    recordSheetPageProfile,
    type RecordSheetPageFormat,
} from './record-sheet-layout';
import {
    resolveCompactRecordSheetLayout,
    resolveRecordSheetLayout,
} from './layouts/record-sheet-layout-resolver';
import {
    composeMixedCompactRecordSheetPage,
    type RecordSheetSvgFormat,
} from './layouts/record-sheet-layout';
import { optimizeGeneratedSvg } from './record-sheet-svg-rendering';

export type { RecordSheetSvgFormat } from './layouts/record-sheet-layout';

export interface RecordSheetSvgGeneratorOptions {
    readonly format?: RecordSheetSvgFormat;
    readonly pageFormat?: RecordSheetPageFormat;
}

/** Thin entry point: family layout classes own all sheet composition. */
export class RecordSheetSvgGenerator {
    public static async generate(
        entity: BaseEntity,
        options: RecordSheetSvgGeneratorOptions = {},
    ): Promise<SVGSVGElement> {
        const format = options.format ?? 'letter';
        const pageFormat = options.pageFormat ?? (format === 'a4' ? 'a4' : 'letter');
        const page = recordSheetPageProfile(pageFormat);
        const layout = resolveRecordSheetLayout(entity);
        const profile = layout.profile(entity, pageFormat);
        const svg = await layout.generate(entity, { format, page, profile });
        svg.setAttribute('data-mekbay-layout', layout.id);
        svg.setAttribute('data-mekbay-page-format', page.format);
        return optimizeGeneratedSvg(svg);
    }

    /** Composes already-generated compact blocks into one printable page. */
    public static composeCompactPage(
        blocks: readonly SVGSVGElement[],
        pageFormat: RecordSheetPageFormat = 'letter',
    ): SVGSVGElement {
        const profile = recordSheetPageProfile(pageFormat);
        const compactLayout = resolveCompactRecordSheetLayout(blocks);
        const page = compactLayout === null
            ? composeMixedCompactRecordSheetPage(blocks, profile)
            : compactLayout.composePage(blocks, profile);
        return optimizeGeneratedSvg(page);
    }
}
