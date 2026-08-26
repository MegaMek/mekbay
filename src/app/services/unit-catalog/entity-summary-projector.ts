// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../../models/unit-summary.model';
import { EquipmentRegistry } from '../../models/equipment-lookup';
import { parseEntity } from '../../models/entity/parse-entity';
import type { ParseContextOptions, EntityLoadIssue } from '../../models/entity/parsers/parse-context';
import { UnitSummaryBuilder } from '../../utils/unit-summary-builder';
import {
    CoreCatalogEntryKey,
    NativeUnitFormat,
    UnitFileName,
} from './unit-catalog.types';

export interface CoreUnitProjectionInput {
    readonly entryKey: CoreCatalogEntryKey;
    readonly format: NativeUnitFormat;
    readonly file: UnitFileName;
    readonly bytes: ArrayBuffer;
}

export interface ProjectedCoreUnitSummary {
    readonly summary: UnitSummary;
    readonly diagnostics: readonly EntityLoadIssue[];
}

export interface CoreUnitSummaryProjector {
    project(input: CoreUnitProjectionInput): Promise<ProjectedCoreUnitSummary>;
}

export class EntitySummaryProjectionError extends Error {
    public constructor(
        message: string,
        public readonly diagnostics: readonly EntityLoadIssue[] = [],
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'EntitySummaryProjectionError';
    }
}

export interface EntityCoreUnitSummaryProjectorOptions {
    readonly parseOptions?: ParseContextOptions;
    readonly summaryBuilder?: UnitSummaryBuilder;
}

/** The single native parser/domain/summary path used by catalog installation. */
export class EntityCoreUnitSummaryProjector implements CoreUnitSummaryProjector {
    private readonly parseOptions: ParseContextOptions;
    private readonly summaryBuilder: UnitSummaryBuilder;

    public constructor(
        private readonly equipmentRegistry: EquipmentRegistry,
        options: EntityCoreUnitSummaryProjectorOptions = {},
    ) {
        this.parseOptions = options.parseOptions ?? {};
        this.summaryBuilder = options.summaryBuilder ?? new UnitSummaryBuilder();
    }

    public async project(input: CoreUnitProjectionInput): Promise<ProjectedCoreUnitSummary> {
        let raw: string;
        try {
            raw = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
        } catch (error) {
            throw new EntitySummaryProjectionError(`Native unit ${input.file} is not UTF-8`, [], { cause: error });
        }

        try {
            const parsed = parseEntity(raw, input.file, this.equipmentRegistry, this.parseOptions);
            const base = this.summaryBuilder.build(parsed.entity, {
                entryKey: input.entryKey,
                format: input.format,
            });
            return {
                summary: base,
                diagnostics: Object.freeze([...parsed.diagnostics]),
            };
        } catch (error) {
            if (error instanceof EntitySummaryProjectionError) {
                throw error;
            }
            throw new EntitySummaryProjectionError(`Failed to project native unit ${input.file}`, [], {
                cause: error,
            });
        }
    }
}
