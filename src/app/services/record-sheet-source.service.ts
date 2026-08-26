// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, Injector, inject } from '@angular/core';

import type { BaseEntity } from '../models/entity/base-entity';
import type { UnitSummary } from '../models/unit-summary.model';
import {
    RecordSheetSvgGenerator,
    type RecordSheetSvgGeneratorOptions,
} from '../utils/sheets/record-sheet-svg-generator';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { PreGeneratedSheetCatalogService } from './pre-generated-sheet-catalog.service';
import { SheetService } from './sheet.service';

export type RecordSheetSourceMode = 'generated' | 'pre-generated';

export interface RecordSheetSourceResult {
    readonly source: RecordSheetSourceMode;
    readonly svgs: readonly SVGSVGElement[];
}

/** The single source-selection boundary shared by record-sheet viewers and printing. */
@Injectable({ providedIn: 'root' })
export class RecordSheetSourceService {
    private readonly options = inject(OptionsService);
    private readonly logger = inject(LoggerService);
    private readonly injector = inject(Injector);

    mode(): RecordSheetSourceMode {
        return this.options.options().usePreGeneratedRecordSheets ? 'pre-generated' : 'generated';
    }

    async load(
        summary: UnitSummary,
        entity: BaseEntity,
        generatorOptions: RecordSheetSvgGeneratorOptions = {},
        mode: RecordSheetSourceMode = this.mode(),
    ): Promise<RecordSheetSourceResult> {
        if (mode === 'pre-generated') {
            try {
                const assets = await this.injector.get(PreGeneratedSheetCatalogService).resolve(summary);
                if (assets.length > 0) {
                    const sheetService = this.injector.get(SheetService);
                    const svgs = await Promise.all(assets.map(async asset => {
                        const retained = await sheetService.getSheet(asset.fileName, asset.serverHost);
                        const svg = retained.cloneNode(true) as SVGSVGElement;
                        svg.dataset['mekbaySheetSource'] = 'pre-generated';
                        return svg;
                    }));
                    return Object.freeze({ source: 'pre-generated', svgs: Object.freeze(svgs) });
                }
                this.logger.warn(`No pre-generated record sheet is cataloged for ${summary.name}; using the SVG generator.`);
            } catch (error) {
                this.logger.warn(`Could not load the pre-generated record sheet for ${summary.name}; using the SVG generator: ${describeError(error)}`);
            }
        }

        const svg = await RecordSheetSvgGenerator.generate(entity, generatorOptions);
        svg.dataset['mekbaySheetSource'] = 'generated';
        return Object.freeze({ source: 'generated', svgs: Object.freeze([svg]) });
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
