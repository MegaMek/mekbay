// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
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
import { renderGeneratedRecordSheetControls } from './generated-record-sheet-controls';

export type { RecordSheetSvgFormat } from './layouts/record-sheet-layout';

export interface RecordSheetSvgGeneratorOptions {
    readonly format?: RecordSheetSvgFormat;
    readonly pageFormat?: RecordSheetPageFormat;
    readonly ruleset?: CBTRuleset;
    readonly fluffImageUrl?: string | null;
}

/** Thin entry point: family layout classes own all sheet composition. */
export class RecordSheetSvgGenerator {
    public static async generate(
        entity: BaseEntity,
        options: RecordSheetSvgGeneratorOptions = {},
    ): Promise<SVGSVGElement> {
        const pages = await this.generatePages(entity, options);
        const primary = pages[0];
        if (!primary) throw new Error(`No record sheet was generated for ${entity.displayName()}`);
        return primary;
    }

    public static async generatePages(
        entity: BaseEntity,
        options: RecordSheetSvgGeneratorOptions = {},
    ): Promise<readonly SVGSVGElement[]> {
        const format = options.format ?? 'letter';
        const pageFormat = options.pageFormat ?? (format === 'a4' ? 'a4' : 'letter');
        const page = recordSheetPageProfile(pageFormat);
        const layout = resolveRecordSheetLayout(entity);
        const profile = layout.profile(entity, pageFormat);
        const request = { format, page, profile } as const;
        const pages = layout.generatePages
            ? [...await layout.generatePages(entity, request)]
            : [await layout.generate(entity, request)];
        const primary = pages[0];
        if (!primary) throw new Error(`No record sheet was generated for ${entity.displayName()}`);
        renderGeneratedRecordSheetControls(primary, entity, options);
        return Object.freeze(pages.map((svg, index) => {
            svg.setAttribute('data-mekbay-layout', layout.id);
            svg.setAttribute('data-mekbay-page-format', page.format);
            svg.setAttribute('data-mekbay-page-index', String(index));
            svg.setAttribute('data-mekbay-page-count', String(pages.length));
            svg.setAttribute('data-mekbay-page-role', index === 0 ? 'primary' : 'supplemental');
            return optimizeGeneratedSvg(svg);
        }));
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
