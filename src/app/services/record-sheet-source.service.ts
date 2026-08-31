// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';

import type { BaseEntity } from '../models/entity/base-entity';
import type { DesignIdentity } from './unit-catalog/unit-catalog.types';
import {
    RecordSheetSvgGenerator,
    type RecordSheetSvgGeneratorOptions,
} from '../utils/sheets/record-sheet-svg-generator';
import { OptionsService } from './options.service';
import { UnitFluffImageService } from './catalogs/unit-fluff-image.service';

export interface RecordSheetSourceResult {
    readonly svgs: readonly SVGSVGElement[];
}

export interface RecordSheetEntitySourceContext {
    readonly design?: DesignIdentity;
}

/** Generates a record sheet from the admitted Entity. */
@Injectable({ providedIn: 'root' })
export class RecordSheetSourceService {
    private readonly options = inject(OptionsService);
    private readonly fluffImages = inject(UnitFluffImageService);

    async load(
        entity: BaseEntity,
        generatorOptions: RecordSheetSvgGeneratorOptions = {},
        context: RecordSheetEntitySourceContext = {},
    ): Promise<RecordSheetSourceResult> {
        const currentOptions = this.options.options();
        const svgs = await RecordSheetSvgGenerator.generatePages(entity, {
            ...generatorOptions,
            ruleset: generatorOptions.ruleset ?? currentOptions.CBTRules,
            fluffImageUrl: generatorOptions.fluffImageUrl
                ?? this.fluffImages.resolveEntityUrl(entity, context.design),
        });
        svgs.forEach(svg => { svg.dataset['mekbaySheetSource'] = 'generated'; });
        return Object.freeze({ svgs });
    }
}
