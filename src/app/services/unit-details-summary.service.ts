// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { REBUILD_UNIT_SUMMARY_WHEN_OPENING_DETAILS } from '../app-feature-flags';
import type { UnitSummary } from '../models/unit-summary.model';
import { UnitSummaryBuilder } from '../utils/unit-summary-builder';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { EntityCoreUnitSummaryProjector } from './unit-catalog/entity-summary-projector';
import { asSourceHash, makeUnitFileName } from './unit-catalog/unit-catalog.types';

/** Resolves the active details entry */
@Injectable({ providedIn: 'root' })
export class UnitDetailsSummaryService {
    private readonly data = inject(DataService);
    private readonly logger = inject(LoggerService);

    public async resolve(summary: UnitSummary): Promise<UnitSummary> {
        if (!REBUILD_UNIT_SUMMARY_WHEN_OPENING_DETAILS
            || summary.origin !== 'megamek') {
            return summary;
        }

        try {
            const hash = asSourceHash(summary.hash);
            const format = summary.entityType === 'Mek' ? 'mtf' : 'blk';
            const source = await this.data.readNativeUnitSource(summary.provider, summary.uuid);
            if (!source) throw new Error('native source is not installed');
            if (source.hash !== hash
                || source.format !== format
                || source.file !== makeUnitFileName(summary.uuid, format)) {
                throw new Error('native source does not match the selected catalog summary');
            }

            const projector = new EntityCoreUnitSummaryProjector(
                this.data.getEquipmentRegistry(),
                {
                    parseOptions: {
                        sourcebookResolver: abbreviation => this.data.getSourcebookByAbbrev(abbreviation),
                        quirkResolver: key => this.data.getQuirkByKey(key),
                    },
                    // Sprite assignment is presentation data; retain the catalog row's resolved icon.
                    summaryBuilder: new UnitSummaryBuilder(() => summary.icon),
                },
            );
            const rebuilt = await projector.project({
                entryKey: {
                    origin: 'megamek',
                    design: { provider: summary.provider, uuid: summary.uuid },
                    sourceRevision: hash,
                },
                format: source.format,
                file: source.file,
                bytes: source.bytes,
            });

            // Keep transient search/tag overlays; entity-derived fields come from the fresh parse.
            return { ...summary, ...rebuilt.summary };
        } catch (error) {
            this.logger.warn(
                `Could not rebuild details summary for ${summary.provider}/${summary.uuid}: ${errorMessage(error)}`,
            );
            return summary;
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
