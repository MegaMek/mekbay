// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity } from '../../construction/domain/construction-factory';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { buildEquipmentRegistry } from '../catalogs/equipment-catalog-builder';
import { sha1Base64Url } from '../../utils/sha1.util';
import { asUnitSpriteManifestDigest } from '../../utils/unit-sprite-assignment-resolver';
import { provideCoreCatalogWorkers } from '../../utils/core-catalog-worker-browser.providers';
import { UNIT_SUMMARY_PROJECTION_WORKERS } from '../../utils/unit-summary-projection-worker-factory.util';
import { createWorkerUnitSummaryProjector } from './unit-summary-projection-worker-runtime';
import { projectUnitSummaryBatches, type UnitSummaryProjectionSource } from './unit-summary-projection';
import type { UnitSummaryProjectionDependencies } from './unit-summary-projection-worker-protocol';
import type { UnitSummaryProjectionInput } from './entity-summary-projector';
import { asSourceHash, asUnitUuid, makeUnitFileName, CUSTOM_UNIT_PROVIDER_ID, MM_DATA_UNIT_PROVIDER_ID } from './unit-catalog.types';

describe('browser unit summary projection workers', () => {
    it('matches complete main-thread summaries across native families and isolates malformed input', async () => {
        TestBed.configureTestingModule({ providers: [provideCoreCatalogWorkers()] });
        const workers = TestBed.inject(UNIT_SUMMARY_PROJECTION_WORKERS);
        expect(workers).not.toBeNull();
        if (!workers) return;
        const response = await fetch('/online-assets/static/equipment.json');
        expect(response.ok).toBeTrue();
        const manifestText = '{"assignments":{"exact":{},"chassis":{}}}';
        const dependencies: UnitSummaryProjectionDependencies = {
            equipment: await response.json(),
            quirks: { version: 'test', assetHash: 'test', quirks: [] },
            sourcebooks: { assetHash: 'test', sourcebooks: [] },
            spriteManifest: { manifestText,
                manifestDigest: asUnitSpriteManifestDigest(await sha1Base64Url(new TextEncoder().encode(manifestText))) },
        };
        const registry = buildEquipmentRegistry(dependencies.equipment);
        // Native fixtures come from tracked source code; this test needs no generated ZIP.
        const fixtures = await Promise.all(CONSTRUCTION_UNIT_TYPES.map(async (kind, index): Promise<UnitSummaryProjectionInput> => {
            const entity = createConstructionEntity(kind.id, registry);
            const uuid = asUnitUuid(`019f6767-0dcb-7bb8-992f-${String(index).padStart(12, '0')}`);
            entity.uuid.set(uuid);
            const format = entity instanceof MekEntity ? 'mtf' : 'blk';
            const bytes = new TextEncoder().encode(encodeNativeEntity(entity)).buffer;
            return {
                entryKey: { origin: 'user', design: { provider: CUSTOM_UNIT_PROVIDER_ID, uuid },
                    sourceRevision: asSourceHash(await sha1Base64Url(bytes)) },
                format, file: makeUnitFileName(uuid, format), bytes,
            };
        }));
        // Multiple batches exercise real parallel workers and both catalog origins.
        const sources: UnitSummaryProjectionSource[] = Array.from({ length: 10 }, () => fixtures).flat()
            .map((unit, index) => async () => ({ ...unit, entryKey: {
                ...unit.entryKey, origin: index % 2 ? 'user' : 'megamek',
                design: { ...unit.entryKey.design, provider: index % 2 ? CUSTOM_UNIT_PROVIDER_ID : MM_DATA_UNIT_PROVIDER_ID },
            } }));
        sources.push(async () => ({ ...(await sources[0]()), bytes: new Uint8Array([255]).buffer }));
        const projector = await createWorkerUnitSummaryProjector(dependencies);
        const options = { signal: new AbortController().signal };
        const expected = await projectUnitSummaryBatches(sources, { projector, dependencies }, options);
        const actual = await projectUnitSummaryBatches(sources, {
            projector, dependencies, workers: { ...workers, count: 4 },
        }, options);
        expect(actual).toEqual(expected);
        expect(actual.filter(outcome => outcome.status === 'projected').length).toBe(fixtures.length * 10);
        expect(actual.at(-1)?.status).toBe('error');
    }, 120_000);
});
