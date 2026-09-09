// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildEquipmentRegistry } from '../catalogs/equipment-catalog-builder';
import { createUnitSpriteAssignmentContextFromManifestText } from '../../utils/unit-sprite-assignment-resolver';
import { createUnitIconResolver } from '../../utils/unit-sprite-resolver';
import { UnitSummaryBuilder } from '../../utils/unit-summary-builder';
import { MM_DATA_UNIT_PROVIDER_ID } from './unit-catalog.types';
import { EntityUnitSummaryProjector, type UnitSummaryProjector } from './entity-summary-projector';
import { projectUnitSummary } from './unit-summary-projection';
import type {
    UnitSummaryProjectionDependencies,
    UnitSummaryProjectionWorkerRequest,
    UnitSummaryProjectionWorkerResponse,
} from './unit-summary-projection-worker-protocol';

/** Uses the same equipment hydration, native parser and builder as the main thread. */
export async function createWorkerUnitSummaryProjector(
    dependencies: UnitSummaryProjectionDependencies,
): Promise<UnitSummaryProjector> {
    const registry = buildEquipmentRegistry(dependencies.equipment);
    const quirks = new Map(dependencies.quirks.quirks.map(quirk => [quirk.key, quirk]));
    const sourcebooks = new Map(dependencies.sourcebooks.sourcebooks.map(book => [book.abbrev, book]));
    const sprites = await createUnitSpriteAssignmentContextFromManifestText({
        provider: MM_DATA_UNIT_PROVIDER_ID,
        manifestText: dependencies.spriteManifest.manifestText,
    });
    return new EntityUnitSummaryProjector(registry, {
        parseOptions: {
            quirkResolver: key => quirks.get(key),
            sourcebookResolver: key => sourcebooks.get(key),
        },
        summaryBuilder: new UnitSummaryBuilder(createUnitIconResolver(sprites.assignments)),
    });
}

export class UnitSummaryProjectionWorkerRuntime {
    private projector?: Promise<UnitSummaryProjector>;

    constructor(private readonly send: (response: UnitSummaryProjectionWorkerResponse) => void) {}

    async handleMessage(message: UnitSummaryProjectionWorkerRequest): Promise<void> {
        try {
            if (message.type === 'initialize') {
                this.projector = createWorkerUnitSummaryProjector(message.dependencies);
                await this.projector;
                this.send({ type: 'ready' });
                return;
            }
            if (!this.projector) throw new Error('Unit summary worker is not initialized');
            const projector = await this.projector;
            const outcomes = [];
            for (const unit of message.units) outcomes.push(await projectUnitSummary(projector, unit));
            this.send({ type: 'projected', requestId: message.requestId, outcomes });
        } catch (error) {
            this.send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
