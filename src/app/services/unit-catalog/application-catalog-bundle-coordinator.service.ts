// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injectable, inject } from '@angular/core';
import { createUnitIconResolver } from '../../utils/unit-sprite-resolver';
import { UnitSummaryBuilder } from '../../utils/unit-summary-builder';
import {
    EquipmentCatalogService,
    type PreparedEquipmentCatalog,
} from '../catalogs/equipment-catalog.service';
import { EraIndexService, type PreparedEraIndex } from '../era-index.service';
import {
    FactionsCatalogService,
    type PreparedFactionsCatalog,
} from '../catalogs/mulfactions-catalog.service';
import { CatalogStorage } from '../catalogs/catalog-storage.service';
import { QuirksCatalogService, type PreparedQuirksCatalog } from '../catalogs/quirks-catalog.service';
import { RepositoryAssetManifestService } from '../catalogs/repository-asset-manifest.service';
import {
    SourcebooksCatalogService,
    type PreparedSourcebooksCatalog,
} from '../catalogs/sourcebooks-catalog.service';
import { LoggerService } from '../logger.service';
import {
    SpriteStorageService,
    type PreparedUnitSpriteManifest,
} from '../sprite-storage.service';
import {
    buildApplicationCatalogDependencyBundle,
    verifyAndNormalizeApplicationCatalogDependencyBundle,
    type ApplicationCatalogDependencyBundle,
} from './application-catalog-dependency-bundle';
import { CORE_UNITS_ARCHIVE_PATH, CORE_UNITS_MANIFEST_PATH } from './core-unit-manifest';
import type { RepositoryAssetsManifest } from '../catalogs/repository-asset-manifest.service';
import type { CoreCatalogSyncProgress } from './core-catalog-synchronizer';
import {
    EntityCoreUnitSummaryProjector,
    type CoreUnitSummaryProjector,
} from './entity-summary-projector';

export const DEPENDENCY_ASSET_PATHS = Object.freeze({
    equipment: 'online-assets/static/equipment.json',
    quirks: 'online-assets/static/quirks.json',
    sourcebooks: 'online-assets/generated/sourcebooks.json',
    factions: 'online-assets/static/factions.json',
    sprites: 'online-assets/generated/sprites/unit-icons.json',
} as const);

export type DependencyAssetName = keyof typeof DEPENDENCY_ASSET_PATHS;
export type DependencyAssetHashes = Readonly<Record<DependencyAssetName, string>>;

/** Detached, fully validated state required to parse and project native units. */
export interface PreparedApplicationCatalogDependencies {
    readonly bundle: ApplicationCatalogDependencyBundle;
    readonly assetHashes: DependencyAssetHashes;
    readonly equipment: PreparedEquipmentCatalog;
    readonly quirks: PreparedQuirksCatalog;
    readonly sourcebooks: PreparedSourcebooksCatalog;
    readonly eras: PreparedEraIndex;
    readonly factions: PreparedFactionsCatalog;
    readonly sprites: PreparedUnitSpriteManifest;
    readonly getProjector: () => Promise<CoreUnitSummaryProjector>;
}

@Injectable({ providedIn: 'root' })
export class ApplicationCatalogBundleCoordinatorService {
    private readonly equipment = inject(EquipmentCatalogService);
    private readonly quirks = inject(QuirksCatalogService);
    private readonly sourcebooks = inject(SourcebooksCatalogService);
    private readonly eraIndex = inject(EraIndexService);
    private readonly factions = inject(FactionsCatalogService);
    private readonly sprites = inject(SpriteStorageService);
    private readonly storage = inject(CatalogStorage);
    private readonly repositoryAssets = inject(RepositoryAssetManifestService);
    private readonly logger = inject(LoggerService);

    public async currentAssetHashes(signal?: AbortSignal): Promise<DependencyAssetHashes> {
        const entries = await Promise.all(Object.entries(DEPENDENCY_ASSET_PATHS).map(
            async ([name, path]) => [name, (await this.repositoryAssets.descriptor(path, signal)).hash] as const,
        ));
        return Object.freeze(Object.fromEntries(entries)) as DependencyAssetHashes;
    }

    /** Loads the five external dependencies from their owning stores. */
    public async prepareCachedDependencies(
        onProgress?: (progress: CoreCatalogSyncProgress) => void,
    ): Promise<PreparedApplicationCatalogDependencies | undefined> {
        const [equipment, quirks, sourcebooks, factions, sprites] = await Promise.all([
            this.storage.getEntry<ApplicationCatalogDependencyBundle['equipment']>('equipment'),
            this.storage.getEntry<ApplicationCatalogDependencyBundle['quirks']>('quirks'),
            this.storage.getEntry<ApplicationCatalogDependencyBundle['sourcebooks']>('sourcebooks'),
            this.storage.getEntry<ApplicationCatalogDependencyBundle['factions']>('factions'),
            this.sprites.prepareCachedAssignmentManifest(),
        ]);
        if (!equipment || !quirks || !sourcebooks || !factions || !sprites) {
            return undefined;
        }
        return this.prepareBundle({
            equipment: equipment.payload,
            quirks: quirks.payload,
            sourcebooks: sourcebooks.payload,
            factions: factions.payload,
            spriteManifest: sprites.evidence,
        }, {
            equipment: equipment.hash,
            quirks: quirks.hash,
            sourcebooks: sourcebooks.hash,
            factions: factions.hash,
            sprites: sprites.assetHash,
        }, onProgress);
    }

    /** Persists only the independently changed catalog rows. */
    public async persistPreparedDependencies(
        candidate: PreparedApplicationCatalogDependencies,
    ): Promise<void> {
        await this.sprites.persistPreparedAssignmentManifest(candidate.sprites);
        await this.storage.putMany([
            { key: 'equipment', hash: candidate.assetHashes.equipment, payload: candidate.bundle.equipment },
            { key: 'quirks', hash: candidate.assetHashes.quirks, payload: candidate.bundle.quirks },
            { key: 'sourcebooks', hash: candidate.assetHashes.sourcebooks, payload: candidate.bundle.sourcebooks },
            { key: 'factions', hash: candidate.assetHashes.factions, payload: candidate.bundle.factions },
        ], Object.fromEntries(Object.entries(DEPENDENCY_ASSET_PATHS).map(([name, path]) => [
            path,
            candidate.assetHashes[name as DependencyAssetName],
        ])));
    }

    public async recordInstalledUnitAssets(assets: RepositoryAssetsManifest): Promise<void> {
        const unitsManifestHash = assets[CORE_UNITS_MANIFEST_PATH];
        const archiveHash = assets[CORE_UNITS_ARCHIVE_PATH];
        if (!unitsManifestHash || !archiveHash) throw new Error('Repository unit asset hashes are unavailable');
        await this.storage.recordInstalledAssets({
            [CORE_UNITS_MANIFEST_PATH]: unitsManifestHash,
            [CORE_UNITS_ARCHIVE_PATH]: archiveHash,
        });
    }

    /** Uses the ZIP bundle only as the first-install seed. */
    public async preparePublishedBundle(
        bundle: ApplicationCatalogDependencyBundle,
        assetHashes: DependencyAssetHashes,
        onProgress?: (progress: CoreCatalogSyncProgress) => void,
    ): Promise<PreparedApplicationCatalogDependencies> {
        const normalized = await verifyAndNormalizeApplicationCatalogDependencyBundle(bundle);
        if (!normalized) throw new Error('Application catalog dependency bundle is invalid');
        return this.prepareBundle(normalized, assetHashes, onProgress);
    }

    /** Fetches only prerequisite assets whose direct assets-manifest hash changed. */
    public async prepareCurrentDependencies(
        previous: PreparedApplicationCatalogDependencies,
        signal: AbortSignal,
        onProgress?: (progress: CoreCatalogSyncProgress) => void,
    ): Promise<PreparedApplicationCatalogDependencies> {
        const nextHashes = await this.currentAssetHashes(signal);
        const dependencyCount = Object.keys(DEPENDENCY_ASSET_PATHS).length;
        let completed = 0;
        const track = async <T>(work: () => Promise<T>): Promise<T> => {
            const value = await work();
            completed += 1;
            emit(onProgress, { phase: 'dependency-fetch', completed, total: dependencyCount });
            return value;
        };
        const prepareIfChanged = <T>(
            name: DependencyAssetName,
            current: T,
            prepare: () => Promise<T>,
        ): Promise<T> => track(() => nextHashes[name] === previous.assetHashes[name]
            ? Promise.resolve(current)
            : prepare());
        emit(onProgress, { phase: 'dependency-fetch', completed, total: dependencyCount });
        const [equipment, quirks, sourcebooks, factions, sprites] = await Promise.all([
            prepareIfChanged('equipment', previous.equipment,
                () => this.equipment.prepareRemoteCatalog(previous.equipment, signal)),
            prepareIfChanged('quirks', previous.quirks,
                () => this.quirks.prepareRemoteCatalog(previous.quirks, signal)),
            prepareIfChanged('sourcebooks', previous.sourcebooks,
                () => this.sourcebooks.prepareRemoteCatalog(previous.sourcebooks, signal)),
            prepareIfChanged('factions', previous.factions,
                () => this.factions.prepareRemoteCatalog(previous.factions, signal)),
            prepareIfChanged('sprites', previous.sprites,
                () => this.sprites.prepareRemoteAssignmentManifest(previous.sprites, signal)),
        ]);
        if (equipment === previous.equipment
            && quirks === previous.quirks
            && sourcebooks === previous.sourcebooks
            && factions === previous.factions
            && sprites === previous.sprites) {
            return previous;
        }

        const bundle = await buildApplicationCatalogDependencyBundle({
            equipment: equipment.transport.data,
            quirks: quirks.transport.data,
            sourcebooks: sourcebooks.transport.data,
            factions: factions.transport.data,
            spriteManifest: sprites.evidence,
        });
        const eras = factions === previous.factions
            ? previous.eras
            : this.eraIndex.prepareFromFactions(factions.factions);
        return this.prepared(
            bundle,
            nextHashes,
            equipment,
            quirks,
            sourcebooks,
            eras,
            factions,
            sprites,
        );
    }

    public commitPreparedDependencies(candidate: PreparedApplicationCatalogDependencies): void {
        this.equipment.commitPreparedCatalog(candidate.equipment);
        this.quirks.commitPreparedCatalog(candidate.quirks);
        this.sourcebooks.commitPreparedCatalog(candidate.sourcebooks);
        this.eraIndex.commitPreparedIndex(candidate.eras);
        this.factions.commitPreparedCatalog(candidate.factions);
        this.sprites.commitPreparedAssignmentManifest(candidate.sprites);
    }

    private async prepareBundle(
        bundle: ApplicationCatalogDependencyBundle,
        assetHashes: DependencyAssetHashes,
        onProgress?: (progress: CoreCatalogSyncProgress) => void,
    ): Promise<PreparedApplicationCatalogDependencies> {
        const dependencyCount = Object.keys(DEPENDENCY_ASSET_PATHS).length;
        let completed = 0;
        const track = async <T>(label: string, work: () => T | Promise<T>): Promise<T> => {
            try {
                const value = await work();
                completed += 1;
                emit(onProgress, { phase: 'dependency-fetch', completed, total: dependencyCount });
                return value;
            } catch (error) {
                this.logger.warn(`Failed to prepare ${label}: ${describeError(error)}`);
                throw error;
            }
        };
        emit(onProgress, { phase: 'dependency-fetch', completed, total: dependencyCount });
        const [equipment, quirks, sourcebooks, factions, sprites] = await Promise.all([
            track('equipment', () => this.equipment.prepareBundledCatalog(bundle.equipment)),
            track('quirks', () => this.quirks.prepareBundledCatalog(bundle.quirks)),
            track('sourcebooks', () => this.sourcebooks.prepareBundledCatalog(bundle.sourcebooks)),
            track('factions', () => this.factions.prepareBundledCatalog(bundle.factions)),
            track('sprites', () => this.sprites.prepareBundledAssignmentManifest(
                bundle.spriteManifest,
                assetHashes.sprites,
            )),
        ]);
        const eras = this.eraIndex.prepareFromFactions(factions.factions);
        return this.prepared(
            bundle,
            assetHashes,
            equipment,
            quirks,
            sourcebooks,
            eras,
            factions,
            sprites,
        );
    }

    private prepared(
        bundle: ApplicationCatalogDependencyBundle,
        assetHashes: DependencyAssetHashes,
        equipment: PreparedEquipmentCatalog,
        quirks: PreparedQuirksCatalog,
        sourcebooks: PreparedSourcebooksCatalog,
        eras: PreparedEraIndex,
        factions: PreparedFactionsCatalog,
        sprites: PreparedUnitSpriteManifest,
    ): PreparedApplicationCatalogDependencies {
        let projector: Promise<CoreUnitSummaryProjector> | undefined;
        return Object.freeze({
            bundle,
            assetHashes: Object.freeze({ ...assetHashes }),
            equipment,
            quirks,
            sourcebooks,
            eras,
            factions,
            sprites,
            getProjector: () => projector ??= Promise.resolve(new EntityCoreUnitSummaryProjector(
                equipment.registry,
                {
                    parseOptions: {
                        sourcebookResolver: abbreviation => sourcebooks.sourcebooksByAbbrev.get(abbreviation),
                        quirkResolver: key => quirks.quirksByKey.get(key),
                    },
                    summaryBuilder: new UnitSummaryBuilder(createUnitIconResolver(
                        sprites.assignmentContext.assignments,
                    )),
                },
            )),
        });
    }
}

function emit(
    listener: ((progress: CoreCatalogSyncProgress) => void) | undefined,
    progress: CoreCatalogSyncProgress,
): void {
    try {
        listener?.(progress);
    } catch {
        // UI progress cannot invalidate catalog data.
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
