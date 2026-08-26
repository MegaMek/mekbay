// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { EquipmentCatalogService } from '../catalogs/equipment-catalog.service';
import { ErasCatalogService } from '../catalogs/eras-catalog.service';
import { FactionsCatalogService } from '../catalogs/mulfactions-catalog.service';
import { CatalogStorage } from '../catalogs/catalog-storage.service';
import { QuirksCatalogService } from '../catalogs/quirks-catalog.service';
import { RepositoryAssetManifestService } from '../catalogs/repository-asset-manifest.service';
import { SourcebooksCatalogService } from '../catalogs/sourcebooks-catalog.service';
import { LoggerService } from '../logger.service';
import { SpriteStorageService } from '../sprite-storage.service';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import {
    ApplicationCatalogBundleCoordinatorService,
    type DependencyAssetHashes,
    type PreparedApplicationCatalogDependencies,
} from './application-catalog-bundle-coordinator.service';

describe('ApplicationCatalogBundleCoordinatorService', () => {
    const hashes = Object.freeze({
        equipment: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        quirks: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        sourcebooks: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        eras: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        factions: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        sprites: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    }) satisfies DependencyAssetHashes;
    let equipment: jasmine.SpyObj<EquipmentCatalogService>;
    let quirks: jasmine.SpyObj<QuirksCatalogService>;
    let sourcebooks: jasmine.SpyObj<SourcebooksCatalogService>;
    let eras: jasmine.SpyObj<ErasCatalogService>;
    let factions: jasmine.SpyObj<FactionsCatalogService>;
    let sprites: jasmine.SpyObj<SpriteStorageService>;
    let storage: jasmine.SpyObj<CatalogStorage>;
    let repositoryAssets: jasmine.SpyObj<RepositoryAssetManifestService>;
    let service: ApplicationCatalogBundleCoordinatorService;

    beforeEach(() => {
        equipment = jasmine.createSpyObj<EquipmentCatalogService>('EquipmentCatalogService', [
            'prepareBundledCatalog', 'prepareRemoteCatalog', 'commitPreparedCatalog',
        ]);
        quirks = jasmine.createSpyObj<QuirksCatalogService>('QuirksCatalogService', [
            'prepareBundledCatalog', 'prepareRemoteCatalog', 'commitPreparedCatalog',
        ]);
        sourcebooks = jasmine.createSpyObj<SourcebooksCatalogService>('SourcebooksCatalogService', [
            'prepareBundledCatalog', 'prepareRemoteCatalog', 'commitPreparedCatalog',
        ]);
        eras = jasmine.createSpyObj<ErasCatalogService>('ErasCatalogService', [
            'prepareBundledCatalog', 'prepareRemoteCatalog', 'commitPreparedCatalog',
        ]);
        factions = jasmine.createSpyObj<FactionsCatalogService>('FactionsCatalogService', [
            'prepareBundledCatalog', 'prepareRemoteCatalog', 'commitPreparedCatalog',
        ]);
        sprites = jasmine.createSpyObj('SpriteStorageService', [
            'prepareCachedAssignmentManifest', 'prepareBundledAssignmentManifest',
            'prepareRemoteAssignmentManifest', 'persistPreparedAssignmentManifest',
            'commitPreparedAssignmentManifest',
        ]);
        storage = jasmine.createSpyObj<CatalogStorage>('CatalogStorage', [
            'getEntry', 'putMany', 'recordInstalledAssets',
        ]);
        storage.putMany.and.resolveTo();
        storage.recordInstalledAssets.and.resolveTo();
        sprites.persistPreparedAssignmentManifest.and.resolveTo();
        repositoryAssets = jasmine.createSpyObj<RepositoryAssetManifestService>(
            'RepositoryAssetManifestService',
            ['descriptor'],
        );
        repositoryAssets.descriptor.and.resolveTo({ hash: hashes.equipment });
        TestBed.configureTestingModule({
            providers: [
                ApplicationCatalogBundleCoordinatorService,
                { provide: EquipmentCatalogService, useValue: equipment },
                { provide: QuirksCatalogService, useValue: quirks },
                { provide: SourcebooksCatalogService, useValue: sourcebooks },
                { provide: ErasCatalogService, useValue: eras },
                { provide: FactionsCatalogService, useValue: factions },
                { provide: SpriteStorageService, useValue: sprites },
                { provide: CatalogStorage, useValue: storage },
                { provide: RepositoryAssetManifestService, useValue: repositoryAssets },
                { provide: LoggerService, useValue: { warn() {} } },
            ],
        });
        service = TestBed.inject(ApplicationCatalogBundleCoordinatorService);
    });

    it('prepares all six members from the ZIP seed without network access', async () => {
        const source = bundle();
        const preparedMembers = installBundledResults();

        const prepared = await service.preparePublishedBundle(source, hashes);

        expect(prepared.bundle).toBe(source);
        expect(prepared.assetHashes).toEqual(hashes);
        expect(prepared.equipment).toBe(preparedMembers.equipment);
        expect(prepared.sprites).toBe(preparedMembers.sprites);
        expect(equipment.prepareBundledCatalog).toHaveBeenCalledOnceWith(source.equipment);
        expect(sprites.prepareBundledAssignmentManifest)
            .toHaveBeenCalledOnceWith(source.spriteManifest, hashes.sprites);
    });

    it('returns the same dependency object when every repository hash is unchanged', async () => {
        const previous = preparedDependencies();

        const result = await service.prepareCurrentDependencies(previous, new AbortController().signal);

        expect(result).toBe(previous);
        expect(equipment.prepareRemoteCatalog).not.toHaveBeenCalled();
        expect(quirks.prepareRemoteCatalog).not.toHaveBeenCalled();
        expect(sourcebooks.prepareRemoteCatalog).not.toHaveBeenCalled();
        expect(eras.prepareRemoteCatalog).not.toHaveBeenCalled();
        expect(factions.prepareRemoteCatalog).not.toHaveBeenCalled();
        expect(sprites.prepareRemoteAssignmentManifest).not.toHaveBeenCalled();
    });

    it('loads each cached dependency from its owning row', async () => {
        const source = bundle();
        const preparedMembers = installBundledResults();
        storage.getEntry.and.callFake(async <T>(key: string) => ({
            key,
            hash: hashes[key as keyof DependencyAssetHashes],
            payload: source[key as keyof ApplicationCatalogDependencyBundle] as T,
        }));
        sprites.prepareCachedAssignmentManifest.and.resolveTo({
            ...preparedMembers.sprites,
            assetHash: hashes.sprites,
            evidence: source.spriteManifest,
        });

        const prepared = await service.prepareCachedDependencies();

        expect(prepared?.assetHashes).toEqual(hashes);
        expect(storage.getEntry.calls.allArgs().map(args => args[0])).toEqual([
            'equipment', 'quirks', 'sourcebooks', 'eras', 'factions',
        ]);
    });

    it('persists five catalog rows separately and keeps sprites in the sprite database', async () => {
        const prepared = preparedDependencies();

        await service.persistPreparedDependencies(prepared);

        expect(sprites.persistPreparedAssignmentManifest).toHaveBeenCalledOnceWith(prepared.sprites);
        const [rows, installedAssets] = storage.putMany.calls.mostRecent().args;
        expect(rows.map(row => row.key)).toEqual([
            'equipment', 'quirks', 'sourcebooks', 'eras', 'factions',
        ]);
        expect(installedAssets).toEqual(jasmine.objectContaining({
            'online-assets/generated/sprites/unit-icons.json': hashes.sprites,
        }));
    });

    it('commits every prepared member at one publication boundary', () => {
        const prepared = preparedDependencies();

        service.commitPreparedDependencies(prepared);

        expect(equipment.commitPreparedCatalog).toHaveBeenCalledOnceWith(prepared.equipment);
        expect(quirks.commitPreparedCatalog).toHaveBeenCalledOnceWith(prepared.quirks);
        expect(sourcebooks.commitPreparedCatalog).toHaveBeenCalledOnceWith(prepared.sourcebooks);
        expect(eras.commitPreparedCatalog).toHaveBeenCalledOnceWith(prepared.eras);
        expect(factions.commitPreparedCatalog).toHaveBeenCalledOnceWith(prepared.factions);
        expect(sprites.commitPreparedAssignmentManifest).toHaveBeenCalledOnceWith(prepared.sprites);
    });

    function installBundledResults() {
        const values = members();
        equipment.prepareBundledCatalog.and.returnValue(values.equipment);
        quirks.prepareBundledCatalog.and.returnValue(values.quirks);
        sourcebooks.prepareBundledCatalog.and.returnValue(values.sourcebooks);
        eras.prepareBundledCatalog.and.returnValue(values.eras);
        factions.prepareBundledCatalog.and.returnValue(values.factions);
        sprites.prepareBundledAssignmentManifest.and.returnValue(values.sprites);
        return values;
    }

    function preparedDependencies(): PreparedApplicationCatalogDependencies {
        const values = members();
        return {
            bundle: bundle(),
            assetHashes: hashes,
            ...values,
            getProjector: async () => ({} as never),
        } as unknown as PreparedApplicationCatalogDependencies;
    }
});

function members() {
    return {
        equipment: { registry: {} }, quirks: {}, sourcebooks: {}, eras: {}, factions: {},
        sprites: {},
    } as unknown as Pick<PreparedApplicationCatalogDependencies,
        'equipment' | 'quirks' | 'sourcebooks' | 'eras' | 'factions' | 'sprites'>;
}

function bundle(): ApplicationCatalogDependencyBundle {
    return {
        equipment: {}, quirks: {}, sourcebooks: {}, eras: {}, factions: {},
        spriteManifest: { manifestDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', manifestText: '{}' },
    } as unknown as ApplicationCatalogDependencyBundle;
}
