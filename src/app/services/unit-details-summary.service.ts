// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { REBUILD_UNIT_SUMMARY_WHEN_OPENING_DETAILS } from '../app-feature-flags';
import type { UnitSummary } from '../models/unit-summary.model';
import type { BaseEntity } from '../models/entity/base-entity';
import type { CBTForceMember } from '../models/force-member.model';
import { UnitSummaryBuilder } from '../utils/unit-summary-builder';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { EntityUnitSummaryProjector } from './unit-catalog/entity-summary-projector';
import { asSourceHash, makeUnitFileName, CUSTOM_UNIT_PROVIDER_ID, MM_DATA_UNIT_PROVIDER_ID } from './unit-catalog/unit-catalog.types';
import { UnitsCatalogService } from './catalogs/units-catalog.service';

/** Resolves the active details entry */
@Injectable({ providedIn: 'root' })
export class UnitDetailsSummaryService {
    private readonly data = inject(DataService);
    private readonly catalog = inject(UnitsCatalogService);
    private readonly logger = inject(LoggerService);
    private readonly forceSummaries = new WeakMap<BaseEntity, {
        readonly catalogSummary: UnitSummary | undefined;
        readonly summary: UnitSummary;
    }>();

    /** A force owns an exact design revision, including after its catalog entry changes or disappears. */
    public resolveForceMember(member: CBTForceMember): UnitSummary {
        const entity = member.entity;
        const catalogSummary = this.data.getUnitByUuid(entity.uuid());
        const cached = this.forceSummaries.get(entity);
        if (cached && cached.catalogSummary === catalogSummary) return cached.summary;

        const snapshot = member.force.getUnitSnapshot(member.id);
        const source = snapshot?.entity === entity ? snapshot.nativeSource : undefined;
        const custom = source?.isCustom === true || catalogSummary?.isCustom === true;
        const rebuilt = new UnitSummaryBuilder(() => catalogSummary?.icon ?? '').build(entity, {
            entryKey: {
                origin: custom ? 'user' : 'megamek',
                design: { provider: custom ? CUSTOM_UNIT_PROVIDER_ID : MM_DATA_UNIT_PROVIDER_ID, uuid: entity.uuid() },
                // Older in-memory handles may lack a full checksum. This projection is never persisted.
                sourceRevision: source?.sourceHash ?? catalogSummary?.hash ?? '',
            },
            format: source?.format ?? (entity.entityType === 'Mek' ? 'mtf' : 'blk'),
        });
        const summary = { ...catalogSummary, ...rebuilt, ...(custom ? { isCustom: true } : {}) };
        this.forceSummaries.set(entity, { catalogSummary, summary });
        return summary;
    }

    public async resolve(summary: UnitSummary): Promise<UnitSummary> {
        if (!REBUILD_UNIT_SUMMARY_WHEN_OPENING_DETAILS
            || summary.origin !== 'megamek') {
            return summary;
        }

        try {
            const hash = asSourceHash(summary.hash);
            const format = summary.entityType === 'Mek' ? 'mtf' : 'blk';
            const source = await this.catalog.readNativeUnitSource(summary.uuid);
            if (!source) throw new Error('native source is not installed');
            if (source.hash !== hash
                || source.format !== format
                || source.file !== makeUnitFileName(summary.uuid, format)) {
                throw new Error('native source does not match the selected catalog summary');
            }

            const projector = new EntityUnitSummaryProjector(
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
                `Could not rebuild details summary for ${summary.uuid}: ${errorMessage(error)}`,
            );
            return summary;
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
