// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import {
    UNIT_CATALOG_ROWS,
    UNIT_CATALOG_STORE,
    UnitCatalogDatabase,
    deleteUnitCatalogDatabase,
    type PublishedCatalogGeneration,
} from './unit-catalog-database';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asCatalogActivationId,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
} from './unit-catalog.types';

describe('UnitCatalogDatabase', () => {
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const hash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
    let databaseName: string;
    let database: UnitCatalogDatabase;

    beforeEach(async () => {
        databaseName = `mekbay-unit-catalog-test-${crypto.randomUUID()}`;
        database = await UnitCatalogDatabase.open({ databaseName });
    });

    afterEach(async () => {
        database.close();
        await deleteUnitCatalogDatabase({ databaseName });
    });

    it('stores exactly the archive, catalog, and units-manifest rows', async () => {
        const generation = publishedGeneration();
        const archive = new Blob(['complete archive bytes for the fixture']);

        await database.writeActiveCatalog(generation, archive);

        const rows = await rawRows(databaseName);
        expect(rows.map(row => String(row['key'])).sort()).toEqual([
            UNIT_CATALOG_ROWS.archive,
            UNIT_CATALOG_ROWS.catalog,
            UNIT_CATALOG_ROWS.unitsManifest,
        ]);
        const storedManifest = rows.find(row => row['key'] === UNIT_CATALOG_ROWS.unitsManifest);
        expect(Object.keys(storedManifest!).sort()).toEqual(['hash', 'json', 'key']);
        const storedCatalog = rows.find(row => row['key'] === UNIT_CATALOG_ROWS.catalog);
        expect(storedCatalog).not.toEqual(jasmine.objectContaining({
            assetsManifest: jasmine.anything(),
            dependencyBundle: jasmine.anything(),
            manifest: jasmine.anything(),
        }));
        expect(await database.readActiveCatalog()).toEqual(generation);
        expect((await database.readSourceArchive(hash))?.size).toBe(archive.size);
        expect(await database.readActiveCatalogActivationId()).toBe(generation.activationId);
    });

    it('updates summaries without rewriting an unchanged source ZIP', async () => {
        const firstArchive = new Blob(['complete archive bytes for the first fixture']);
        await database.writeActiveCatalog(publishedGeneration(), firstArchive);

        const nextActivationId = asCatalogActivationId(`${hash}:${UNIT_SUMMARY_VERSION}:next`);
        const current = publishedGeneration();
        await database.writeActiveCatalog({
            ...current,
            activationId: nextActivationId,
            summary: { ...current.summary, activationId: nextActivationId },
        }, new Blob(['a different complete archive that must not replace the first one']));

        expect((await database.readSourceArchive(hash))?.size).toBe(firstArchive.size);
        expect(await database.readActiveCatalogActivationId()).toBe(nextActivationId);
    });

    it('does not return the ZIP for another units-manifest hash', async () => {
        await database.writeActiveCatalog(
            publishedGeneration(),
            new Blob(['complete archive bytes for the fixture']),
        );

        expect(await database.readSourceArchive(asSourceHash('EEEEEEEEEEEEEEEEEEEEEEEEEEA')))
            .toBeUndefined();
    });

    it('rejects an incomplete archive before writing', async () => {
        await expectAsync(database.writeActiveCatalog(publishedGeneration(), new Blob(['short'])))
            .toBeRejectedWithError(/empty or incomplete/u);
        expect(await database.readActiveCatalog()).toBeUndefined();
    });

    function publishedGeneration(): PublishedCatalogGeneration {
        const activationId = asCatalogActivationId(`${hash}:${UNIT_SUMMARY_VERSION}`);
        const file = makeUnitFileName(uuid, 'mtf');
        const summary = {
            uuid,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            origin: 'megamek',
            hash,
            summaryVersion: UNIT_SUMMARY_VERSION,
        } as unknown as UnitSummary;
        return {
            activationId,
            manifest: {
                hash,
                json: JSON.stringify({ [file]: hash }),
                manifest: {
                    units: {
                        [uuid]: { file, hash, format: 'mtf' },
                    },
                },
            },
            summary: { activationId, summaryVersion: UNIT_SUMMARY_VERSION, payload: [summary] },
            summaryDependencyHashes: {
                equipment: hash, quirks: hash, sourcebooks: hash, sprites: hash,
            },
        };
    }
});

async function rawRows(databaseName: string): Promise<Record<string, unknown>[]> {
    const request = indexedDB.open(databaseName);
    const rawDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        const rowsRequest = rawDatabase
            .transaction(UNIT_CATALOG_STORE, 'readonly')
            .objectStore(UNIT_CATALOG_STORE)
            .getAll();
        return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
            rowsRequest.onsuccess = () => resolve(rowsRequest.result as Record<string, unknown>[]);
            rowsRequest.onerror = () => reject(rowsRequest.error);
        });
    } finally {
        rawDatabase.close();
    }
}
