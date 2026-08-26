// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
    MM_DATA_UNIT_PROVIDER_ID,
    asUnitProviderId,
} from './unit-catalog/unit-catalog.types';
import { LoggerService } from './logger.service';
import { SpriteStorageService, type SpriteManifest } from './sprite-storage.service';
import {
    RepositoryAssetManifestService,
    type RepositoryAssetDescriptor,
} from './catalogs/repository-asset-manifest.service';

const SPRITE_MANIFEST_CACHE_KEY = 'sprites_manifest_v4';
const SPRITE_MANIFEST_PATH = 'online-assets/generated/sprites/unit-icons.json';
const TEST_SPRITE_HASH = '2ff4e94f6a8bb270fe01b871826ee3971dfe21a0ddfa512c3cc09bcf2b5de8d2';
const UPDATED_SPRITE_HASH = 'ed5ef49557e97a7d98f5eea62794a131702221722d52b2a9931c2e9c084da7a6';
const OTHER_SPRITE_HASH = 'f108ad7b81547dbb159ad146663c23dbddd62d21042e44c53185e4301bfe2c3e';
const TEST_SPRITE_URL = `online-assets/generated/sprites/mek.1.${TEST_SPRITE_HASH.slice(0, 16)}.webp`;
const UPDATED_SPRITE_URL = `online-assets/generated/sprites/mek.1.${UPDATED_SPRITE_HASH.slice(0, 16)}.webp`;
const TEST_SPRITE_STORAGE_KEY = 'mek';

const TEST_MANIFEST: SpriteManifest = {
    types: {
        mek: {
            url: TEST_SPRITE_URL,
            width: 84,
            height: 72,
            hash: TEST_SPRITE_HASH,
        },
    },
    icons: {
        'units/mek.png': {
            type: 'mek',
            x: 0,
            y: 0,
            w: 84,
            h: 72,
        },
    },
    assignments: {
        exact: { 'ATLAS AS7-D': 'units/mek.png' },
        chassis: { 'ATLAS': 'units/mek.png' },
    },
};

const UPDATED_MANIFEST: SpriteManifest = {
    types: {
        mek: {
            url: UPDATED_SPRITE_URL,
            width: 168,
            height: 72,
            hash: UPDATED_SPRITE_HASH,
        },
    },
    icons: {
        'units/mek.png': {
            type: 'mek',
            x: 84,
            y: 0,
            w: 84,
            h: 72,
        },
    },
    assignments: {
        exact: { 'ATLAS AS7-D': 'units/mek.png' },
        chassis: { 'ATLAS': 'units/mek.png' },
    },
};

// Pretty printing and the trailing newline are deliberate. The cache must
// retain these exact fetched UTF-8 bytes, not JSON.stringify(parsedManifest).
const TEST_MANIFEST_TEXT = `${JSON.stringify(TEST_MANIFEST, null, 2)}\n`;
const UPDATED_MANIFEST_TEXT = JSON.stringify(UPDATED_MANIFEST);
const TEST_BLOB = new Blob(['sprite-bytes'], { type: 'image/webp' });
const UPDATED_BLOB = new Blob(['updated-sprite-bytes'], { type: 'image/webp' });
const OTHER_BLOB = new Blob(['other-sprite-bytes'], { type: 'image/webp' });

function storedSprite(blob: Blob, hash: string): Record<string, unknown> {
    return { blob, size: blob.size, assetHash: repositoryHashFromHex(hash) };
}

interface FakeDb {
    readonly spriteStore: Map<string, unknown>;
    readonly dbPut: jasmine.Spy;
    readonly dbDelete: jasmine.Spy;
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
    );
    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function cachedManifest(manifestText: string, manifestDigest: string): Record<string, unknown> {
    return {
        schemaVersion: 4,
        manifestPath: SPRITE_MANIFEST_PATH,
        assetHash: repositoryHashFromHex(manifestDigest),
        manifestText,
    };
}

async function settleAsyncWork(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
}

function repositoryHashFromHex(hash: string): string {
    const binary = (hash.slice(0, 40).match(/../gu) ?? [])
        .map(byte => String.fromCharCode(Number.parseInt(byte, 16)))
        .join('');
    return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function repositoryDescriptor(hash: string): RepositoryAssetDescriptor {
    return Object.freeze({ hash: repositoryHashFromHex(hash) });
}

async function waitForLoadingToFinish(service: SpriteStorageService): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (!service.loading()) return;
        await settleAsyncWork();
    }
    fail('SpriteStorageService did not finish loading.');
}

function installFakeDb(
    spriteStore = new Map<string, unknown>(),
): FakeDb {
    spyOn<any>(SpriteStorageService.prototype, 'initIndexedDb')
        .and.returnValue(Promise.resolve({} as IDBDatabase));
    spyOn<any>(SpriteStorageService.prototype, 'dbGet')
        .and.callFake(async (store: string, key: string) => {
            if (store === 'sprites') return spriteStore.get(key) ?? null;
            return null;
        });
    const dbPut = spyOn<any>(SpriteStorageService.prototype, 'dbPut')
        .and.callFake(async (store: string, key: string, value: unknown) => {
            if (store === 'sprites') spriteStore.set(key, value);
        });
    const dbDelete = spyOn<any>(SpriteStorageService.prototype, 'dbDelete')
        .and.callFake(async (store: string, key: string) => {
            if (store === 'sprites') spriteStore.delete(key);
        });
    spyOn<any>(SpriteStorageService.prototype, 'dbClear')
        .and.callFake(async (store: string) => {
            if (store === 'sprites') spriteStore.clear();
        });
    return { spriteStore, dbPut, dbDelete };
}

describe('SpriteStorageService direct assets-manifest cache', () => {
    let logger: {
        info: jasmine.Spy;
        warn: jasmine.Spy;
        error: jasmine.Spy;
    };
    let repositoryAssets: jasmine.SpyObj<RepositoryAssetManifestService>;
    let remoteManifestDigest: string | null;
    let remoteManifestText: string;
    let spriteDescriptors: Map<string, RepositoryAssetDescriptor>;
    let spriteBodies: Map<string, Blob | Error>;
    let testDigest: string;
    let updatedDigest: string;

    beforeEach(async () => {
        TestBed.resetTestingModule();
        testDigest = await sha256Hex(TEST_MANIFEST_TEXT);
        updatedDigest = await sha256Hex(UPDATED_MANIFEST_TEXT);
        remoteManifestDigest = testDigest;
        remoteManifestText = TEST_MANIFEST_TEXT;
        spriteDescriptors = new Map([
            [TEST_SPRITE_URL, repositoryDescriptor(TEST_SPRITE_HASH)],
            [UPDATED_SPRITE_URL, repositoryDescriptor(UPDATED_SPRITE_HASH)],
        ]);
        spriteBodies = new Map([
            [TEST_SPRITE_URL, TEST_BLOB],
            [UPDATED_SPRITE_URL, UPDATED_BLOB],
        ]);

        logger = {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };
        repositoryAssets = jasmine.createSpyObj<RepositoryAssetManifestService>(
            'RepositoryAssetManifestService',
            ['descriptor', 'readText', 'read'],
        );
        repositoryAssets.descriptor.and.callFake(async (assetPath: string) => {
            if (assetPath === SPRITE_MANIFEST_PATH) {
                if (!remoteManifestDigest) throw new Error('repository manifest unavailable');
                return repositoryDescriptor(remoteManifestDigest);
            }
            const descriptor = spriteDescriptors.get(assetPath);
            if (!descriptor) throw new Error(`Repository asset is absent: ${assetPath}`);
            return descriptor;
        });
        repositoryAssets.readText.and.callFake(async (assetPath: string) => {
            if (assetPath !== SPRITE_MANIFEST_PATH) {
                throw new Error(`Unexpected text asset: ${assetPath}`);
            }
            const descriptor = await repositoryAssets.descriptor(assetPath);
            const actualHash = repositoryHashFromHex(await sha256Hex(remoteManifestText));
            if (actualHash !== descriptor.hash) {
                throw new Error(`Repository asset ${assetPath} disagrees with its authored SHA-1`);
            }
            return {
                path: assetPath,
                descriptor,
                text: remoteManifestText,
            };
        });
        repositoryAssets.read.and.callFake(async (assetPath: string) => {
            const body = spriteBodies.get(assetPath);
            if (body instanceof Error) throw body;
            if (!body) throw new Error(`Repository asset body is absent: ${assetPath}`);
            return {
                path: assetPath,
                descriptor: await repositoryAssets.descriptor(assetPath),
                bytes: await body.arrayBuffer(),
            };
        });

        spyOn(URL, 'createObjectURL').and.returnValue('blob:mapped-sprite');
        spyOn(URL, 'revokeObjectURL').and.stub();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                SpriteStorageService,
                { provide: LoggerService, useValue: logger },
                { provide: RepositoryAssetManifestService, useValue: repositoryAssets },
            ],
        });
    });

    it('degrades a blocked optional database to memory and closes its late successful connection', async () => {
        const request = {} as IDBOpenDBRequest;
        spyOn(indexedDB, 'open').and.returnValue(request);
        remoteManifestDigest = null;
        const service = TestBed.inject(SpriteStorageService);

        request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
        await settleAsyncWork();
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(
            /Sprite cache will run in memory only: Error: Sprite storage upgrade is blocked/u,
        ));

        const close = jasmine.createSpy('close');
        const lateDatabase = { close } as unknown as IDBDatabase;
        request.onsuccess?.call(request, {
            target: { result: lateDatabase },
        } as unknown as Event);
        expect(close).toHaveBeenCalledTimes(1);

        await waitForLoadingToFinish(service);
        expect(service.loading()).toBeFalse();
    });

    it('stores the direct manifest asset hash and binds parsed assignments to each provider', async () => {
        const db = installFakeDb();
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(repositoryAssets.descriptor).toHaveBeenCalledWith(SPRITE_MANIFEST_PATH, undefined);
        expect(repositoryAssets.descriptor).toHaveBeenCalledWith(TEST_SPRITE_URL, undefined);
        expect(repositoryAssets.readText).toHaveBeenCalledWith(SPRITE_MANIFEST_PATH, undefined);
        expect(repositoryAssets.read).toHaveBeenCalledWith(TEST_SPRITE_URL);

        const stored = db.spriteStore.get(SPRITE_MANIFEST_CACHE_KEY) as Record<string, unknown>;
        expect(stored).toEqual(cachedManifest(TEST_MANIFEST_TEXT, testDigest));
        expect(stored['manifestText']).toBe(TEST_MANIFEST_TEXT);

        const unitSpriteAssignmentContext = await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID);
        const editorProvider = asUnitProviderId('user:local-editor');
        const editor = await service.getVerifiedAssignmentContext(editorProvider);
        expect(unitSpriteAssignmentContext?.provider).toBe(MM_DATA_UNIT_PROVIDER_ID);
        expect(editor?.provider).toBe(editorProvider);
        expect(String(unitSpriteAssignmentContext?.manifestDigest)).toBe(repositoryHashFromHex(testDigest));
        expect(String(editor?.manifestDigest)).toBe(repositoryHashFromHex(testDigest));
        expect(editor?.assignments).toEqual(TEST_MANIFEST.assignments!);
        expect(Object.isFrozen(editor)).toBeTrue();
        expect(Object.isFrozen(editor?.assignments)).toBeTrue();
    });

    it('recreates a missing IndexedDB WebP row when unit-icons.json is unchanged', async () => {
        const spriteStore = new Map<string, unknown>([
            [SPRITE_MANIFEST_CACHE_KEY, cachedManifest(TEST_MANIFEST_TEXT, testDigest)],
        ]);
        installFakeDb(spriteStore);
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(repositoryAssets.readText).not.toHaveBeenCalled();
        expect(repositoryAssets.read).toHaveBeenCalledOnceWith(TEST_SPRITE_URL);
        const repaired = spriteStore.get(TEST_SPRITE_STORAGE_KEY) as Record<string, unknown>;
        expect(repaired['assetHash']).toBe(repositoryHashFromHex(TEST_SPRITE_HASH));
        expect(repaired['size']).toBe(TEST_BLOB.size);
        expect(await (repaired['blob'] as Blob).text()).toBe(await TEST_BLOB.text());
        expect(await service.getSpriteInfo('units/mek.png')).not.toBeNull();
    });

    it('uses the direct assets-manifest hash instead of the JSON generation hash', async () => {
        const db = installFakeDb();
        spriteDescriptors.set(
            TEST_SPRITE_URL,
            repositoryDescriptor(UPDATED_SPRITE_HASH),
        );
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(repositoryAssets.read).toHaveBeenCalledOnceWith(TEST_SPRITE_URL);
        expect(db.spriteStore.has(SPRITE_MANIFEST_CACHE_KEY)).toBeTrue();
        expect((db.spriteStore.get(TEST_SPRITE_STORAGE_KEY) as Record<string, unknown>)['assetHash'])
            .toBe(repositoryHashFromHex(UPDATED_SPRITE_HASH));
        expect(await service.getSpriteInfo('units/mek.png')).not.toBeNull();
    });

    it('uses a valid cached manifest when the repository asset manifest is offline', async () => {
        const spriteStore = new Map<string, unknown>([
            [SPRITE_MANIFEST_CACHE_KEY, cachedManifest(TEST_MANIFEST_TEXT, testDigest)],
            [TEST_SPRITE_STORAGE_KEY, storedSprite(TEST_BLOB, TEST_SPRITE_HASH)],
        ]);
        installFakeDb(spriteStore);
        remoteManifestDigest = null;
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(repositoryAssets.readText).not.toHaveBeenCalled();
        const context = await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID);
        expect(String(context?.manifestDigest)).toBe(repositoryHashFromHex(testDigest));
        expect(context?.assignments).toEqual(TEST_MANIFEST.assignments!);
        expect(await service.getSpriteInfo('units/mek.png')).not.toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            'Repository asset manifest unavailable. Using cached sprite data.'
        );
    });

    it('rejects malformed cached manifest JSON', async () => {
        const spriteStore = new Map<string, unknown>([
            [SPRITE_MANIFEST_CACHE_KEY, cachedManifest('{', testDigest)],
            [TEST_SPRITE_STORAGE_KEY, storedSprite(TEST_BLOB, TEST_SPRITE_HASH)],
        ]);
        installFakeDb(spriteStore);
        remoteManifestDigest = null;
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(await service.getSpriteInfo('units/mek.png')).toBeNull();
        expect(await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID)).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            jasmine.stringMatching(/^Rejected cached sprite manifest: /u)
        );
    });

    it('rejects remote JSON bytes that do not match the authored manifest hash', async () => {
        const db = installFakeDb();
        remoteManifestText = UPDATED_MANIFEST_TEXT;
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(repositoryAssets.read).not.toHaveBeenCalled();
        expect(await service.getSpriteInfo('units/mek.png')).toBeNull();
        expect(await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID)).toBeNull();
        expect(db.spriteStore.has(SPRITE_MANIFEST_CACHE_KEY)).toBeFalse();
        expect(logger.error).toHaveBeenCalledWith(
            jasmine.stringMatching(/^Failed to fetch sprite manifest: Error: Repository asset .* disagrees/u)
        );
    });

    it('keeps the verified LKG context and evidence row when a verified refresh cannot download every sprite', async () => {
        const oldEvidence = cachedManifest(TEST_MANIFEST_TEXT, testDigest);
        const spriteStore = new Map<string, unknown>([
            [SPRITE_MANIFEST_CACHE_KEY, oldEvidence],
            [TEST_SPRITE_STORAGE_KEY, storedSprite(TEST_BLOB, TEST_SPRITE_HASH)],
        ]);
        const db = installFakeDb(spriteStore);
        remoteManifestDigest = updatedDigest;
        remoteManifestText = UPDATED_MANIFEST_TEXT;
        spriteBodies.set(UPDATED_SPRITE_URL, new Error('refresh-failed'));
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        const context = await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID);
        expect(String(context?.manifestDigest)).toBe(repositoryHashFromHex(testDigest));
        expect(await service.getSpriteInfo('units/mek.png')).toEqual({
            url: 'blob:mapped-sprite',
            info: TEST_MANIFEST.icons['units/mek.png'],
        });
        expect(db.spriteStore.get(SPRITE_MANIFEST_CACHE_KEY)).toEqual(oldEvidence);
        expect(db.dbPut).not.toHaveBeenCalledWith(
            'sprites',
            SPRITE_MANIFEST_CACHE_KEY,
            jasmine.objectContaining({ assetHash: repositoryHashFromHex(updatedDigest) }),
        );
    });

    it('downloads only WebP files whose authored hash changed and overwrites that type row', async () => {
        const oldVehicleUrl = `online-assets/generated/sprites/vehicle.1.${OTHER_SPRITE_HASH.slice(0, 16)}.webp`;
        const newVehicleUrl = `online-assets/generated/sprites/vehicle.1.${UPDATED_SPRITE_HASH.slice(0, 16)}.webp`;
        const oldManifest: SpriteManifest = {
            ...TEST_MANIFEST,
            types: {
                ...TEST_MANIFEST.types,
                vehicle: { url: oldVehicleUrl, width: 84, height: 72, hash: OTHER_SPRITE_HASH },
            },
            icons: {
                ...TEST_MANIFEST.icons,
                'units/vehicle.png': { type: 'vehicle', x: 0, y: 0, w: 84, h: 72 },
            },
        };
        const nextManifest: SpriteManifest = {
            ...oldManifest,
            types: {
                ...oldManifest.types,
                vehicle: { url: newVehicleUrl, width: 84, height: 72, hash: UPDATED_SPRITE_HASH },
            },
        };
        const oldText = JSON.stringify(oldManifest);
        const nextText = JSON.stringify(nextManifest);
        const oldDigest = await sha256Hex(oldText);
        const nextDigest = await sha256Hex(nextText);
        const vehicleKey = 'vehicle';
        const spriteStore = new Map<string, unknown>([
            [SPRITE_MANIFEST_CACHE_KEY, cachedManifest(oldText, oldDigest)],
            [TEST_SPRITE_STORAGE_KEY, storedSprite(TEST_BLOB, TEST_SPRITE_HASH)],
            [vehicleKey, storedSprite(OTHER_BLOB, OTHER_SPRITE_HASH)],
        ]);
        const db = installFakeDb(spriteStore);
        remoteManifestDigest = nextDigest;
        remoteManifestText = nextText;
        spriteDescriptors.set(
            oldVehicleUrl,
            repositoryDescriptor(OTHER_SPRITE_HASH),
        );
        spriteDescriptors.set(
            newVehicleUrl,
            repositoryDescriptor(UPDATED_SPRITE_HASH),
        );
        spriteBodies.set(newVehicleUrl, UPDATED_BLOB);
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(repositoryAssets.read).not.toHaveBeenCalledWith(TEST_SPRITE_URL);
        expect(repositoryAssets.read).not.toHaveBeenCalledWith(oldVehicleUrl);
        expect(repositoryAssets.read).toHaveBeenCalledWith(newVehicleUrl);

        expect(db.spriteStore.get(TEST_SPRITE_STORAGE_KEY)).toEqual(
            storedSprite(TEST_BLOB, TEST_SPRITE_HASH),
        );
        const updatedVehicle = db.spriteStore.get(vehicleKey) as Record<string, unknown>;
        expect(updatedVehicle['assetHash']).toBe(repositoryHashFromHex(UPDATED_SPRITE_HASH));
        expect(updatedVehicle['size']).toBe(UPDATED_BLOB.size);
        expect(await (updatedVehicle['blob'] as Blob).text()).toBe(await UPDATED_BLOB.text());
        expect(db.dbDelete).not.toHaveBeenCalledWith('sprites', vehicleKey);
    });

    it('keeps a verified provider context in memory when IndexedDB is unavailable', async () => {
        spyOn<any>(SpriteStorageService.prototype, 'initIndexedDb')
            .and.returnValue(Promise.resolve(null));
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        const context = await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID);
        expect(String(context?.manifestDigest)).toBe(repositoryHashFromHex(testDigest));
        expect(await service.getSpriteInfo('UNITS/MEK.PNG')).toEqual({
            url: 'blob:mapped-sprite',
            info: TEST_MANIFEST.icons['units/mek.png'],
        });
    });

    it('rejects a hash-valid manifest whose sprite sheet URL is not application-relative', async () => {
        const unsafeManifest = {
            ...TEST_MANIFEST,
            types: {
                mek: {
                    ...TEST_MANIFEST.types['mek'],
                    url: 'https://db.mekbay.com/sprites/mek.png',
                },
            },
        } satisfies SpriteManifest;
        const unsafeText = JSON.stringify(unsafeManifest);
        const unsafeDigest = await sha256Hex(unsafeText);
        const db = installFakeDb();
        remoteManifestDigest = unsafeDigest;
        remoteManifestText = unsafeText;
        const service = TestBed.inject(SpriteStorageService);

        await waitForLoadingToFinish(service);

        expect(await service.getVerifiedAssignmentContext(MM_DATA_UNIT_PROVIDER_ID)).toBeNull();
        expect(db.spriteStore.has(SPRITE_MANIFEST_CACHE_KEY)).toBeFalse();
        expect(repositoryAssets.descriptor.calls.allArgs().some(
            args => args[0] === 'https://db.mekbay.com/sprites/mek.png',
        )).toBeFalse();
    });
});
