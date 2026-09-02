// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitSummary } from '../../models/unit-summary.model';
import {
    SUMMARY_DEPENDENCY_NAMES,
    type SummaryDependencyName,
} from './application-catalog-dependency-bundle';
import {
    parseCoreUnitsManifest,
    type StoredCoreUnitsManifest,
} from './core-unit-manifest';
import type { CatalogActivationId, SourceHash } from './unit-catalog.types';

export const UNIT_CATALOG_DATABASE_NAME = 'mekbay-units';
export const UNIT_CATALOG_DATABASE_VERSION = 1;
export const UNIT_CATALOG_STORE = 'units';
export const UNIT_CATALOG_ROWS = Object.freeze({
    archive: 'archive',
    catalog: 'catalog',
    unitsManifest: 'units-manifest',
} as const);

export type SummaryDependencyHashes = Readonly<Record<SummaryDependencyName, string>>;

export interface StoredUnitSummaries<TSummary = readonly UnitSummary[]> {
    readonly activationId: CatalogActivationId;
    readonly summaryVersion: number;
    readonly payload: TSummary;
}

export interface PublishedCatalogGeneration<TSummary = readonly UnitSummary[]> {
    readonly activationId: CatalogActivationId;
    readonly manifest: StoredCoreUnitsManifest;
    readonly summary: StoredUnitSummaries<TSummary>;
    readonly summaryDependencyHashes: SummaryDependencyHashes;
}

interface StoredUnitCatalog<TSummary = readonly UnitSummary[]> {
    readonly key: typeof UNIT_CATALOG_ROWS.catalog;
    readonly activationId: CatalogActivationId;
    readonly summaryVersion: number;
    readonly payload: TSummary;
    readonly summaryDependencyHashes: SummaryDependencyHashes;
}

interface StoredUnitsManifest {
    readonly key: typeof UNIT_CATALOG_ROWS.unitsManifest;
    readonly hash: SourceHash;
    readonly json: string;
}

export interface StoredCoreSourceArchive {
    readonly key: typeof UNIT_CATALOG_ROWS.archive;
    readonly unitsManifestHash: SourceHash;
    readonly blob: Blob;
}

export interface UnitCatalogDatabaseOptions {
    readonly databaseName?: string;
    readonly indexedDb?: IDBFactory;
}

export class UnitCatalogDatabaseOpenBlockedError extends Error {
    public constructor(public readonly databaseName: string) {
        super('The unit catalog database is blocked by another MekBay tab. Close the other tab and reload.');
        this.name = 'UnitCatalogDatabaseOpenBlockedError';
    }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        transaction.onerror = () => undefined;
    });
}

function openDatabase(options: UnitCatalogDatabaseOptions): Promise<IDBDatabase> {
    const factory = options.indexedDb ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));
    const databaseName = options.databaseName ?? UNIT_CATALOG_DATABASE_NAME;
    const request = factory.open(databaseName, UNIT_CATALOG_DATABASE_VERSION);
    return new Promise<IDBDatabase>((resolve, reject) => {
        let settled = false;
        const rejectOnce = (error: unknown): void => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(UNIT_CATALOG_STORE)) {
                database.createObjectStore(UNIT_CATALOG_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => {
            if (settled) {
                request.result.close();
                return;
            }
            settled = true;
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => rejectOnce(request.error ?? new Error('Failed to open unit catalog database'));
        request.onblocked = () => rejectOnce(new UnitCatalogDatabaseOpenBlockedError(databaseName));
    });
}

export class UnitCatalogDatabase {
    private constructor(private readonly database: IDBDatabase) {}

    public static async open(options: UnitCatalogDatabaseOptions = {}): Promise<UnitCatalogDatabase> {
        return new UnitCatalogDatabase(await openDatabase(options));
    }

    public get objectStoreNames(): readonly string[] {
        return Array.from(this.database.objectStoreNames);
    }

    public close(): void {
        this.database.close();
    }

    /** The three unit rows switch together; unchanged native data does not rewrite the ZIP. */
    public async writeActiveCatalog(
        generation: PublishedCatalogGeneration,
        archiveBlob: Blob,
    ): Promise<void> {
        assertGeneration(generation);
        if (archiveBlob.size < 22) throw new Error('Core unit ZIP is empty or incomplete');

        const catalog: StoredUnitCatalog = {
            key: UNIT_CATALOG_ROWS.catalog,
            activationId: generation.activationId,
            summaryVersion: generation.summary.summaryVersion,
            payload: generation.summary.payload,
            summaryDependencyHashes: generation.summaryDependencyHashes,
        };
        const manifest: StoredUnitsManifest = {
            key: UNIT_CATALOG_ROWS.unitsManifest,
            hash: generation.manifest.hash,
            json: generation.manifest.json,
        };
        const archive: StoredCoreSourceArchive = {
            key: UNIT_CATALOG_ROWS.archive,
            unitsManifestHash: generation.manifest.hash,
            blob: archiveBlob,
        };

        const transaction = this.database.transaction(UNIT_CATALOG_STORE, 'readwrite');
        const completion = transactionCompletion(transaction);
        try {
            const store = transaction.objectStore(UNIT_CATALOG_STORE);
            const previousManifest = await requestResult(
                store.get(UNIT_CATALOG_ROWS.unitsManifest),
            ) as StoredUnitsManifest | undefined;
            const writes: Promise<unknown>[] = [requestResult(store.put(catalog))];
            if (previousManifest?.hash !== generation.manifest.hash) {
                writes.push(requestResult(store.put(manifest)));
                writes.push(requestResult(store.put(archive)));
            }
            await Promise.all(writes);
            await completion;
        } catch (error) {
            try { transaction.abort(); } catch {}
            try { await completion; } catch {}
            throw error;
        }
    }

    public async readActiveCatalog<TSummary = readonly UnitSummary[]>(): Promise<
        PublishedCatalogGeneration<TSummary> | undefined
    > {
        const transaction = this.database.transaction(UNIT_CATALOG_STORE, 'readonly');
        const completion = transactionCompletion(transaction);
        const store = transaction.objectStore(UNIT_CATALOG_STORE);
        const [catalog, manifest, archive] = await Promise.all([
            requestResult(store.get(UNIT_CATALOG_ROWS.catalog)),
            requestResult(store.get(UNIT_CATALOG_ROWS.unitsManifest)),
            requestResult(store.get(UNIT_CATALOG_ROWS.archive)),
        ]) as [
            StoredUnitCatalog<TSummary> | undefined,
            StoredUnitsManifest | undefined,
            StoredCoreSourceArchive | undefined,
        ];
        await completion;
        if (!catalog || !manifest || archive?.unitsManifestHash !== manifest.hash) return undefined;
        const parsedManifest = parseCoreUnitsManifest(manifest.json, manifest.hash);
        return {
            activationId: catalog.activationId,
            manifest: parsedManifest,
            summary: {
                activationId: catalog.activationId,
                summaryVersion: catalog.summaryVersion,
                payload: catalog.payload,
            },
            summaryDependencyHashes: catalog.summaryDependencyHashes,
        };
    }

    public async readSourceArchive(unitsManifestHash: SourceHash): Promise<Blob | undefined> {
        const transaction = this.database.transaction(UNIT_CATALOG_STORE, 'readonly');
        const completion = transactionCompletion(transaction);
        const row = await requestResult(
            transaction.objectStore(UNIT_CATALOG_STORE).get(UNIT_CATALOG_ROWS.archive),
        ) as StoredCoreSourceArchive | undefined;
        await completion;
        return row?.unitsManifestHash === unitsManifestHash ? row.blob : undefined;
    }

}

function assertGeneration(generation: PublishedCatalogGeneration): void {
    if (generation.summary.activationId !== generation.activationId
        || generation.manifest.hash.length !== 27
        || generation.summary.summaryVersion < 1
        || !Array.isArray(generation.summary.payload)
        || SUMMARY_DEPENDENCY_NAMES.some(name => (
            typeof generation.summaryDependencyHashes[name] !== 'string'
            || generation.summaryDependencyHashes[name].length !== 27
        ))) {
        throw new Error('Core catalog generation is incomplete');
    }
}

export async function deleteUnitCatalogDatabase(options: UnitCatalogDatabaseOptions = {}): Promise<void> {
    const factory = options.indexedDb ?? globalThis.indexedDB;
    if (!factory) return;
    const databaseName = options.databaseName ?? UNIT_CATALOG_DATABASE_NAME;
    await new Promise<void>((resolve, reject) => {
        const request = factory.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Failed to delete unit catalog database'));
        request.onblocked = () => reject(new UnitCatalogDatabaseOpenBlockedError(databaseName));
    });
}
