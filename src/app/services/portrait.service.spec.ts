// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { PortraitManifest } from '../models/portrait.model';
import { CatalogStorage } from './catalogs/catalog-storage.service';
import { RepositoryAssetManifestService } from './catalogs/repository-asset-manifest.service';
import { LoggerService } from './logger.service';
import { PortraitService } from './portrait.service';

const MANIFEST: PortraitManifest = {
    width: 128, height: 160,
    sheets: {
        'male-1': { url: 'online-assets/generated/portraits/male-1.hash.webp', hash: 'male-hash', width: 260, height: 162 },
        'female-1': { url: 'online-assets/generated/portraits/female-1.hash.webp', hash: 'female-hash', width: 130, height: 162 },
    },
    portraits: {
        Doctor_M_8: { set: 'Male', category: 'Doctor', sheet: 'male-1', x: 1, y: 1 },
        Doctor_M_9: { set: 'Male', category: 'Doctor', sheet: 'male-1', x: 131, y: 1 },
        Doctor_F_1: { set: 'Female', category: 'Doctor', sheet: 'female-1', x: 1, y: 1 },
    },
};

describe('PortraitService IndexedDB sheets', () => {
    let storage: jasmine.SpyObj<CatalogStorage>;
    let assets: jasmine.SpyObj<RepositoryAssetManifestService>;
    let service: PortraitService;
    beforeEach(() => {
        storage = jasmine.createSpyObj('CatalogStorage', ['get', 'getEntry', 'put']);
        storage.get.and.resolveTo({ assetHash: 'catalog-hash', manifest: MANIFEST });
        storage.getEntry.and.resolveTo(undefined);
        storage.put.and.resolveTo();
        assets = jasmine.createSpyObj('RepositoryAssetManifestService', ['descriptor', 'read', 'readJson']);
        assets.descriptor.and.resolveTo({ hash: 'catalog-hash' });
        assets.read.and.callFake(async path => ({ path, descriptor: { hash: path.includes('female') ? 'female-hash' : 'male-hash' }, bytes: new ArrayBuffer(8) }));
        TestBed.configureTestingModule({ providers: [provideHttpClient(),
            { provide: CatalogStorage, useValue: storage }, { provide: RepositoryAssetManifestService, useValue: assets },
            { provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error']) },
        ] });
        service = TestBed.inject(PortraitService);
        spyOn(URL, 'createObjectURL').and.returnValue('blob:portrait-test');
        spyOn(URL, 'revokeObjectURL');
    });

    it('does not load on construction and downloads only the requested sheet once for concurrent portraits', async () => {
        expect(storage.get).not.toHaveBeenCalled();
        await service.initialize();
        expect(assets.read).not.toHaveBeenCalled();
        await Promise.all([service.loadPortrait('Doctor_M_8'), service.loadPortrait('Doctor_M_9'), service.loadPortrait('Doctor_M_8')]);
        expect(assets.read).toHaveBeenCalledOnceWith(MANIFEST.sheets['male-1'].url);
        expect(storage.put).toHaveBeenCalledOnceWith('portrait-sheet-male-1', 'male-hash', { blob: jasmine.any(Blob) }, MANIFEST.sheets['male-1'].url);
        expect(service.sheetUrl(MANIFEST.sheets['female-1'])).toBeUndefined();
        await service.loadPortrait('Doctor_M_9');
        expect(assets.read).toHaveBeenCalledTimes(1);
    });

    it('uses a matching IndexedDB blob without downloading, including while offline', async () => {
        assets.descriptor.and.rejectWith(new Error('offline'));
        storage.getEntry.and.resolveTo({ key: 'portrait-sheet-male-1', hash: 'male-hash', payload: { blob: new Blob(['cached']) } });
        await service.loadPortrait('Doctor_M_8');
        expect(assets.read).not.toHaveBeenCalled();
        expect(storage.put).not.toHaveBeenCalled();
        expect(service.sheetUrl(MANIFEST.sheets['male-1'])).toBe('blob:portrait-test');
    });

    it('replaces an outdated cached sheet and retries a failed download', async () => {
        storage.getEntry.and.resolveTo({ key: 'portrait-sheet-male-1', hash: 'old', payload: { blob: new Blob(['old']) } });
        assets.read.and.rejectWith(new Error('offline'));
        await expectAsync(service.loadPortrait('Doctor_M_8')).toBeRejected();
        expect(service.sheetUrl(MANIFEST.sheets['male-1'])).toBeUndefined();
        assets.read.and.resolveTo({ path: MANIFEST.sheets['male-1'].url, descriptor: { hash: 'male-hash' }, bytes: new ArrayBuffer(8) });
        await service.loadPortrait('Doctor_M_8');
        expect(assets.read).toHaveBeenCalledTimes(2);
        expect(storage.put).toHaveBeenCalledTimes(1);
    });

    it('rejects inconsistent hashes and preserves unknown saved keys without a sheet download', async () => {
        await service.loadPortrait('Missing_M_1');
        expect(assets.read).not.toHaveBeenCalled();
        assets.read.and.resolveTo({ path: MANIFEST.sheets['male-1'].url, descriptor: { hash: 'wrong-hash' }, bytes: new ArrayBuffer(8) });
        await expectAsync(service.loadPortrait('Doctor_M_8')).toBeRejectedWithError(/hash/);
        expect(storage.put).not.toHaveBeenCalled();
    });
});
