// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DOCUMENT } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { sha1Base64Url } from '../../utils/sha1.util';
import {
        REPOSITORY_ASSET_FETCHER,
        RepositoryAssetManifestService,
        canonicalAssetPath,
        normalizeRepositoryAssetsManifest,
} from './repository-asset-manifest.service';

describe('RepositoryAssetManifestService', () => {
    const assetPath = 'online-assets/static/equipment.json';
    const assetText = JSON.stringify({ version: '1', equipment: {} });

    async function manifestFor(text = assetText) {
        return { [assetPath]: await sha1Base64Url(new TextEncoder().encode(text)) };
    }

    it('fetches one assets manifest and verifies an authored asset by its supplied hash', async () => {
        const manifest = await manifestFor();
        const fetcher = jasmine.createSpy('fetcher').and.callFake(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith('/online-assets/assets-manifest.json')) {
                return new Response(JSON.stringify(manifest), { status: 200 });
            }
            if (url.pathname.endsWith(`/${assetPath}`)) return new Response(assetText, { status: 200 });
            return new Response('', { status: 404 });
        });
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(),
            { provide: DOCUMENT, useValue: { baseURI: 'https://example.test/mekbay/' } },
            { provide: REPOSITORY_ASSET_FETCHER, useValue: fetcher },
        ] });

        const service = TestBed.inject(RepositoryAssetManifestService);
        const [first, second] = await Promise.all([service.loadManifest(), service.loadManifest()]);
        expect(first).toBe(second);
        const asset = await service.readJson<{ version: string }>(assetPath);
        expect(asset.value.version).toBe('1');
        expect(asset.descriptor.hash).toBe(manifest[assetPath]);
        expect(fetcher).toHaveBeenCalledTimes(2);
        for (const call of fetcher.calls.all()) {
            expect(new URL(String(call.args[0])).searchParams.get('ngsw-bypass')).toBe('true');
        }
    });

    it('rejects an asset whose download disagrees with its supplied hash', async () => {
        const manifest = await manifestFor();
        const fetcher = jasmine.createSpy('fetcher').and.callFake(async (input: RequestInfo | URL) => (
            new URL(String(input)).pathname.endsWith('/online-assets/assets-manifest.json')
                ? new Response(JSON.stringify(manifest), { status: 200 })
                : new Response('{"broken":true}', { status: 200 })
        ));
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(),
            { provide: DOCUMENT, useValue: { baseURI: 'https://example.test/' } },
            { provide: REPOSITORY_ASSET_FETCHER, useValue: fetcher },
        ] });

        await expectAsync(TestBed.inject(RepositoryAssetManifestService).read(assetPath))
            .toBeRejectedWithError(/corrupt or incomplete/u);
    });

    it('accepts an unordered direct path-to-hash object and rejects invalid hashes', async () => {
        const hash = await sha1Base64Url(new TextEncoder().encode(assetText));
        expect(normalizeRepositoryAssetsManifest({
            'online-assets/static/quirks.json': hash,
            [assetPath]: hash,
        })).toEqual(jasmine.objectContaining({ [assetPath]: hash }));
        expect(() => normalizeRepositoryAssetsManifest({ [assetPath]: 'not-a-hash' })).toThrowError(/invalid entry/u);
    });

    it('accepts generated sprite filenames containing safe spaces', () => {
        const spritePath = 'online-assets/generated/sprites/Color Archive.1.0123456789abcdef.webp';
        expect(canonicalAssetPath(spritePath)).toBe(spritePath);
    });
});
