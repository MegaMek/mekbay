// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { ProvidedFluffImageService } from './provided-fluff-image.service';

describe('ProvidedFluffImageService', () => {
    const url = 'https://art.example/images/fluff/Mek/Atlas.png';
    let service: ProvidedFluffImageService;
    let rows: Map<string, Blob>;
    let db: jasmine.SpyObj<Pick<DbService, 'listProvidedImages' | 'saveProvidedImage' | 'purgeProvidedImages'>>;
    let download: jasmine.Spy<typeof fetch>;
    const blob = new Blob(['image'], { type: 'image/png' });

    beforeEach(() => {
        rows = new Map();
        db = jasmine.createSpyObj('DbService', ['listProvidedImages', 'saveProvidedImage', 'purgeProvidedImages']);
        db.listProvidedImages.and.callFake(async () => new Map(rows));
        db.saveProvidedImage.and.callFake(async (key, value) => { rows.set(key, value); });
        db.purgeProvidedImages.and.callFake(async () => { rows.clear(); });
        download = spyOn(window, 'fetch').and.callFake(async () => new Response(blob));
        TestBed.configureTestingModule({ providers: [
            { provide: DbService, useValue: db },
            { provide: LoggerService, useValue: { warn: () => undefined } },
        ] });
        service = TestBed.inject(ProvidedFluffImageService);
    });

    it('reads stored art without downloading, including a fresh service instance', async () => {
        rows.set(url, blob);
        const image = await service.loadUrl(url);
        expect(image).toMatch(/^blob:/);
        expect(download).not.toHaveBeenCalled();
        expect(service.count()).toBe(1);
        expect(service.bytes()).toBe(blob.size);
        const fresh = TestBed.runInInjectionContext(() => new ProvidedFluffImageService());
        expect(await fresh.loadUrl(url)).toMatch(/^blob:/);
        expect(download).not.toHaveBeenCalled();
    });

    it('downloads once for concurrent requests and persists before returning the image', async () => {
        const [first, second] = await Promise.all([service.loadUrl(url), service.loadUrl(url)]);
        expect(first).toMatch(/^blob:/);
        expect(second).toBe(first);
        expect(download).toHaveBeenCalledOnceWith(url, { signal: jasmine.any(AbortSignal) });
        expect(db.saveProvidedImage).toHaveBeenCalledTimes(1);
        expect(await rows.get(url)!.text()).toBe('image');
        expect(service.resolveUrl(url)).toBe(first);
        const fresh = TestBed.runInInjectionContext(() => new ProvidedFluffImageService());
        expect(await fresh.loadUrl(url)).toMatch(/^blob:/);
        expect(download).toHaveBeenCalledTimes(1);
    });

    it('does not cache failed downloads and can retry when connectivity returns', async () => {
        download.and.rejectWith(new TypeError('Offline'));
        expect(await service.loadUrl(url)).toBeNull();
        expect(service.resolveUrl(url)).toBeNull();
        expect(db.saveProvidedImage).not.toHaveBeenCalled();
        download.and.callFake(async () => new Response(blob));
        window.dispatchEvent(new Event('online'));
        expect(await service.loadUrl(url)).toMatch(/^blob:/);
    });

    it('displays a downloaded image even if persistence fails', async () => {
        db.saveProvidedImage.and.rejectWith(new Error('Quota exceeded'));
        expect(await service.loadUrl(url)).toMatch(/^blob:/);
        expect(service.resolveUrl(url)).toMatch(/^blob:/);
        expect(download).toHaveBeenCalledTimes(1);
    });

    it('rejects unsuccessful and non-image responses', async () => {
        download.and.resolveTo(new Response('missing', { status: 404 }));
        expect(await service.loadUrl(url)).toBeNull();
        download.and.resolveTo(new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }));
        expect(await service.loadUrl(url)).toBeNull();
        expect(db.saveProvidedImage).not.toHaveBeenCalled();
    });

    it('purges persisted and in-memory art, revokes URLs, and downloads again on demand', async () => {
        const first = await service.loadUrl(url);
        const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
        await service.purge();
        expect(rows.size).toBe(0);
        expect(service.count()).toBe(0);
        expect(revoke).toHaveBeenCalledWith(first!);
        expect(await service.loadUrl(url)).not.toBe(first);
        expect(download).toHaveBeenCalledTimes(2);
    });

    it('does not repopulate the store with a download started before a purge', async () => {
        let finish!: (response: Response) => void;
        download.and.returnValue(new Promise(resolve => { finish = resolve; }));
        await service.initialize();
        const pending = service.loadUrl(url);
        await Promise.resolve();
        const purge = service.purge();
        await Promise.resolve();
        finish(new Response(blob));
        await purge;
        expect(await pending).toBeNull();
        expect(rows.size).toBe(0);
        expect(db.saveProvidedImage).not.toHaveBeenCalled();
    });
});
