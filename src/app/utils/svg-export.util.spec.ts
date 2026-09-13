// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { SvgExportUtil } from './svg-export.util';

describe('SvgExportUtil', () => {
    type MockedNavigatorApi = 'canShare' | 'clipboard' | 'share';
    const fontCache = SvgExportUtil as unknown as { embeddedFontCssPromise: Promise<string> | null };
    let previousFontCache: Promise<string> | null;

    beforeEach(() => {
        previousFontCache = fontCache.embeddedFontCssPromise;
        fontCache.embeddedFontCssPromise = null;
    });

    afterEach(() => {
        fontCache.embeddedFontCssPromise = previousFontCache;
    });

    function pngBlob(): Blob {
        return new Blob(['png'], { type: 'image/png' });
    }

    function exportedSvgBlob(createObjectUrl: jasmine.Spy): Blob {
        const blob = createObjectUrl.calls.allArgs().map(args => args[0])
            .find(value => value instanceof Blob && value.type.startsWith('image/svg+xml'));
        if (!blob) throw new Error('No serialized SVG was exported');
        return blob;
    }

    function getNavigatorPropertyDescriptor(propertyName: MockedNavigatorApi): PropertyDescriptor | undefined {
        return Object.getOwnPropertyDescriptor(Navigator.prototype, propertyName) ?? Object.getOwnPropertyDescriptor(navigator, propertyName);
    }

    function restoreNavigatorPropertyDescriptor(propertyName: MockedNavigatorApi, descriptor: PropertyDescriptor | undefined): void {
        if (descriptor) {
            Object.defineProperty(navigator, propertyName, descriptor);
            return;
        }

        delete (navigator as unknown as Partial<Record<MockedNavigatorApi, unknown>>)[propertyName];
    }

    function makeSvg(width = 100, height = 200): SVGSVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', width.toString());
        svg.setAttribute('height', height.toString());

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('font-family', 'Roboto');
        text.setAttribute('font-weight', '700');
        text.textContent = 'BATTLEMECH RECORD SHEET';
        svg.appendChild(text);

        return svg;
    }

    function addFluffImage(svg: SVGSVGElement, src = 'https://fluff.example.test/images/fluff/Mek/Atlas.png'): void {
        const referenceTable = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        referenceTable.classList.add('referenceTable');
        referenceTable.style.display = 'none';
        svg.appendChild(referenceTable);

        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('id', 'fluff-image-fo');
        foreignObject.style.display = 'block';

        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img') as HTMLImageElement;
        image.setAttribute('id', 'fluff-image-injected');

        image.setAttribute('src', src);
        foreignObject.appendChild(image);
        svg.appendChild(foreignObject);
    }

    function mockFontFetch(): void {
        spyOn(window, 'fetch').and.callFake(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    }

    function mockCanvasPng(): void {
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            callback(pngBlob());
        });
    }

    async function withFakeSvgImage<T>(run: () => Promise<T>): Promise<T> {
        const originalImage = window.Image;
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        window.Image = FakeImage as unknown as typeof Image;
        try {
            return await run();
        } finally {
            window.Image = originalImage;
        }
    }

    it('renders SVGs with embedded Roboto fonts at the default 3x scale', async () => {
        mockFontFetch();
        const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValues('blob:svg-1', 'blob:svg-2');
        const revokeObjectUrl = spyOn(URL, 'revokeObjectURL').and.stub();
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let canvasWidth = 0;
        let canvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            canvasWidth = this.width;
            canvasHeight = this.height;
            callback(pngBlob());
        });
        const download = spyOn(SvgExportUtil, 'downloadPngBlob').and.stub();

        await withFakeSvgImage(() => SvgExportUtil.downloadPng([makeSvg(), makeSvg(50, 300)], 'record-sheet'));

        expect(download).toHaveBeenCalledOnceWith(jasmine.any(Blob), 'record-sheet');
        expect(canvasWidth).toBe(450);
        expect(canvasHeight).toBe(900);
        const serializedSvg = await exportedSvgBlob(createObjectUrl).text();
        expect(serializedSvg).toContain('@font-face');
        expect(serializedSvg).toContain("font-family: 'Roboto';");
        expect(serializedSvg).toContain('data:font/ttf;base64,AQID');
        expect(serializedSvg).toContain('font-family="Roboto"');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg-1');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg-2');
    });

    it('downloads all native SVG card sides in one self-contained document', async () => {
        mockFontFetch();
        const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:svg');
        const revokeObjectUrl = spyOn(URL, 'revokeObjectURL').and.stub();
        const click = spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
        const front = makeSvg(1120, 800);
        const back = makeSvg(1120, 800);
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('href', '/images/weight.svg');
        front.appendChild(image);

        await SvgExportUtil.downloadSvg([front, back], 'alpha-strike');

        const serialized = await exportedSvgBlob(createObjectUrl).text();
        const exported = new DOMParser().parseFromString(serialized, 'image/svg+xml');
        expect(exported.querySelector('parsererror')).toBeNull();
        expect(exported.documentElement.getAttribute('viewBox')).toBe('0 0 2240 800');
        const sides = exported.documentElement.querySelectorAll(':scope > svg');
        expect(sides.length).toBe(2);
        expect(sides[0].getAttribute('x')).toBe('0');
        expect(sides[1].getAttribute('x')).toBe('1120');
        expect(serialized).toContain('@font-face');
        expect(exported.querySelector('image')?.getAttribute('href')).toMatch(/^data:/);
        expect(click).toHaveBeenCalledTimes(1);
        expect(revokeObjectUrl).toHaveBeenCalledOnceWith('blob:svg');
        expect(front.getAttribute('x')).toBeNull();
    });

    it('keeps available fonts when an italic fetch fails and retries incomplete font embedding', async () => {
        let offline = true;
        const failedFont = 'Roboto-Italic-VariableFont_wdth,wght.ttf';
        const fetchFont = spyOn(window, 'fetch').and.callFake((input: RequestInfo | URL) => {
            if (offline && String(input).includes(failedFont)) {
                return Promise.reject(new TypeError('Font is unavailable offline'));
            }
            return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
        });
        const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:svg');
        spyOn(URL, 'revokeObjectURL').and.stub();
        spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

        await SvgExportUtil.downloadSvg([makeSvg()], 'offline-card');

        const partialSvg = await exportedSvgBlob(createObjectUrl).text();
        const partialRules = partialSvg.match(/@font-face \{[^}]*\}/g) ?? [];
        expect(partialRules.length).toBe(3);
        for (const family of ['Roboto', 'Roboto Condensed']) {
            expect(partialRules.some(rule => rule.includes(`font-family: '${family}';`)
                && rule.includes('font-style: normal;'))).toBeTrue();
        }
        expect(fetchFont).toHaveBeenCalledTimes(4);

        offline = false;
        createObjectUrl.calls.reset();
        await SvgExportUtil.downloadSvg([makeSvg()], 'recovered-card');

        const recoveredSvg = await exportedSvgBlob(createObjectUrl).text();
        expect(recoveredSvg.match(/@font-face/g)?.length).toBe(4);
        expect(fetchFont.calls.allArgs().filter(args => String(args[0]).includes(failedFont)).length).toBe(2);
        expect(fetchFont).toHaveBeenCalledTimes(8);

        await SvgExportUtil.downloadSvg([makeSvg()], 'cached-card');
        expect(fetchFont).toHaveBeenCalledTimes(8);
    });

    it('embeds foreignObject fluff images before rendering PNGs', async () => {
        const svg = makeSvg();
        addFluffImage(svg);
        spyOn(window, 'fetch').and.callFake((input: RequestInfo | URL) => {
            if (String(input).includes('/fluff/')) {
                return Promise.resolve(new Response(new Uint8Array([4, 5, 6]), {
                    status: 200,
                    headers: { 'Content-Type': 'image/png' },
                }));
            }

            return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
        });
        const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:svg');
        spyOn(URL, 'revokeObjectURL').and.stub();
        mockCanvasPng();
        spyOn(SvgExportUtil, 'downloadPngBlob').and.stub();

        const rendering = withFakeSvgImage(() => SvgExportUtil.downloadPng([svg], 'record-sheet'));
        // Other services can create object URLs while image embedding awaits fetch/FileReader.
        URL.createObjectURL(pngBlob());
        await rendering;

        const serializedSvg = await exportedSvgBlob(createObjectUrl).text();
        const exportedSvg = new DOMParser().parseFromString(serializedSvg, 'image/svg+xml');
        expect(exportedSvg.getElementById('fluff-image-injected')?.getAttribute('src')).toBe('data:image/png;base64,BAUG');
        expect(exportedSvg.getElementById('fluff-image-fo')?.getAttribute('style')).toContain('display: block');
        expect(exportedSvg.querySelector('.referenceTable')?.getAttribute('style')).toContain('display: none');
    });

    it('falls back to reference tables when a foreignObject fluff image cannot be embedded', async () => {
        const svg = makeSvg();
        addFluffImage(svg);
        spyOn(window, 'fetch').and.callFake((input: RequestInfo | URL) => {
            if (String(input).includes('/fluff/')) {
                return Promise.resolve(new Response('', { status: 404 }));
            }

            return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
        });
        const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:svg');
        spyOn(URL, 'revokeObjectURL').and.stub();
        mockCanvasPng();
        spyOn(SvgExportUtil, 'downloadPngBlob').and.stub();

        await withFakeSvgImage(() => SvgExportUtil.downloadPng([svg], 'record-sheet'));

        const serializedSvg = await exportedSvgBlob(createObjectUrl).text();
        const exportedSvg = new DOMParser().parseFromString(serializedSvg, 'image/svg+xml');
        expect(exportedSvg.getElementById('fluff-image-fo')?.getAttribute('style')).toContain('display: none');
        expect(exportedSvg.querySelector('.referenceTable')?.getAttribute('style')).toContain('display: block');
    });

    it('downloads rendered SVGs as a 3x PNG', async () => {
        mockFontFetch();
        spyOn(URL, 'createObjectURL').and.returnValues('blob:svg', 'blob:png');
        const revokeObjectUrl = spyOn(URL, 'revokeObjectURL').and.stub();
        const click = spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let canvasWidth = 0;
        let canvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            canvasWidth = this.width;
            canvasHeight = this.height;
            callback(pngBlob());
        });

        await withFakeSvgImage(() => SvgExportUtil.downloadPng([makeSvg()], 'record-sheet'));

        expect(canvasWidth).toBe(300);
        expect(canvasHeight).toBe(600);
        expect(click).toHaveBeenCalled();
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:png');
    });

    it('opens rendered SVGs as a 3x PNG in a new tab', async () => {
        mockFontFetch();
        spyOn(URL, 'createObjectURL').and.returnValues('blob:svg', 'blob:png');
        const revokeObjectUrl = spyOn(URL, 'revokeObjectURL').and.stub();
        const opened = { opener: window, location: { href: '' }, closed: false, close: jasmine.createSpy('close') } as unknown as Window;
        const open = spyOn(window, 'open').and.returnValue(opened);
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let canvasWidth = 0;
        let canvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            canvasWidth = this.width;
            canvasHeight = this.height;
            callback(pngBlob());
        });

        let resolveSources!: (sources: SVGSVGElement[]) => void;
        const sources = new Promise<SVGSVGElement[]>(resolve => { resolveSources = resolve; });
        await withFakeSvgImage(async () => {
            const opening = SvgExportUtil.openPng(sources);
            // The window must be reserved while the menu click still has activation.
            expect(open).toHaveBeenCalledWith('', '_blank');
            expect(opened.location.href).toBe('');
            resolveSources([makeSvg()]);
            await opening;
        });

        expect(canvasWidth).toBe(300);
        expect(canvasHeight).toBe(600);
        expect(open).toHaveBeenCalledOnceWith('', '_blank');
        expect(opened.location.href).toBe('blob:png');
        expect(opened.opener).toBeNull();
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg');
        expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:png');
    });

    it('closes the reserved PNG window when the snapshot fails', async () => {
        const close = jasmine.createSpy('close');
        spyOn(window, 'open').and.returnValue({ opener: window, close } as unknown as Window);
        let rejectSources!: (error: Error) => void;
        const sources = new Promise<SVGSVGElement[]>((_resolve, reject) => { rejectSources = reject; });
        const failure = new Error('Card snapshot failed');
        const opening = SvgExportUtil.openPng(sources);

        rejectSources(failure);

        await expectAsync(opening).toBeRejectedWith(failure);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the reserved PNG window when no image can be generated', async () => {
        const close = jasmine.createSpy('close');
        spyOn(window, 'open').and.returnValue({ opener: window, close } as unknown as Window);

        await SvgExportUtil.openPng([]);

        expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the reserved window and releases SVG URLs when rasterization fails', async () => {
        mockFontFetch();
        const close = jasmine.createSpy('close');
        spyOn(window, 'open').and.returnValue({ opener: window, close } as unknown as Window);
        spyOn(URL, 'createObjectURL').and.returnValue('blob:failed-svg');
        const revoke = spyOn(URL, 'revokeObjectURL').and.stub();
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.throwError('Rasterization failed');

        await withFakeSvgImage(async () => {
            await expectAsync(SvgExportUtil.openPng([makeSvg()])).toBeRejectedWithError('Rasterization failed');
        });

        expect(close).toHaveBeenCalledTimes(1);
        expect(revoke).toHaveBeenCalledWith('blob:failed-svg');
    });

    it('releases the generated PNG URL when a popup is actually blocked', () => {
        spyOn(URL, 'createObjectURL').and.returnValue('blob:blocked-png');
        const revoke = spyOn(URL, 'revokeObjectURL').and.stub();
        spyOn(window, 'open').and.returnValue(null);

        expect(() => SvgExportUtil.openPngBlob(pngBlob())).toThrowError('Could not open PNG in a new tab');
        expect(revoke).toHaveBeenCalledOnceWith('blob:blocked-png');
    });

    it('copies rendered SVGs to the clipboard as a 5x PNG', async () => {
        mockFontFetch();
        const originalCanShare = getNavigatorPropertyDescriptor('canShare');
        const originalShare = getNavigatorPropertyDescriptor('share');
        const originalClipboard = getNavigatorPropertyDescriptor('clipboard');
        const originalClipboardItem = window.ClipboardItem;
        const clipboardWrite = jasmine.createSpy('write').and.resolveTo();
        class FakeClipboardItem {
            constructor(public readonly items: Record<string, Blob | Promise<Blob>>) { }
        }
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: clipboardWrite } });
        Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: FakeClipboardItem });
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let canvasWidth = 0;
        let canvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            canvasWidth = this.width;
            canvasHeight = this.height;
            callback(pngBlob());
        });

        try {
            let resolveSources!: (sources: SVGSVGElement[]) => void;
            const sources = new Promise<SVGSVGElement[]>(resolve => { resolveSources = resolve; });
            await withFakeSvgImage(async () => {
                const copying = SvgExportUtil.copyPngToClipboard(sources);
                // Registration must precede snapshot resolution, not just image rendering.
                expect(clipboardWrite).toHaveBeenCalledTimes(1);
                const item = clipboardWrite.calls.mostRecent().args[0][0] as FakeClipboardItem;
                expect(item.items['image/png']).toEqual(jasmine.any(Promise));
                resolveSources([makeSvg()]);
                await copying;
            });

            expect(canvasWidth).toBe(500);
            expect(canvasHeight).toBe(1000);
            expect(clipboardWrite).toHaveBeenCalledWith([jasmine.any(FakeClipboardItem)]);
            const clipboardItem = clipboardWrite.calls.mostRecent().args[0][0] as FakeClipboardItem;
            expect(await clipboardItem.items['image/png']).toEqual(jasmine.any(Blob));
        } finally {
            restoreNavigatorPropertyDescriptor('canShare', originalCanShare);
            restoreNavigatorPropertyDescriptor('share', originalShare);
            restoreNavigatorPropertyDescriptor('clipboard', originalClipboard);
            Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: originalClipboardItem });
        }
    });

    it('propagates snapshot failure without starting clipboard fallbacks', async () => {
        const originalClipboard = getNavigatorPropertyDescriptor('clipboard');
        const originalClipboardItem = window.ClipboardItem;
        class FakeClipboardItem {
            constructor(public readonly items: Record<string, Promise<Blob>>) { }
        }
        const write = jasmine.createSpy('write').and.callFake((items: FakeClipboardItem[]) =>
            items[0].items['image/png'].then(() => undefined));
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
        Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: FakeClipboardItem });
        const fallback = spyOn(SvgExportUtil, 'copyPngBlobToClipboard').and.resolveTo();
        let rejectSources!: (error: Error) => void;
        const sources = new Promise<SVGSVGElement[]>((_resolve, reject) => { rejectSources = reject; });

        try {
            const copying = SvgExportUtil.copyPngToClipboard(sources);
            expect(write).toHaveBeenCalledTimes(1);
            const failure = new Error('Card snapshot failed');
            rejectSources(failure);

            await expectAsync(copying).toBeRejectedWith(failure);
            expect(fallback).not.toHaveBeenCalled();
        } finally {
            restoreNavigatorPropertyDescriptor('clipboard', originalClipboard);
            Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: originalClipboardItem });
        }
    });

    it('copies PNG blobs directly through the async image clipboard API', async () => {
        const originalCanShare = getNavigatorPropertyDescriptor('canShare');
        const originalShare = getNavigatorPropertyDescriptor('share');
        const originalClipboard = getNavigatorPropertyDescriptor('clipboard');
        const originalClipboardItem = window.ClipboardItem;
        const clipboardWrite = jasmine.createSpy('write').and.resolveTo();
        class FakeClipboardItem {
            static supports = jasmine.createSpy('supports').and.returnValue(false);

            constructor(public readonly items: Record<string, Blob>) { }
        }
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: clipboardWrite } });
        Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: FakeClipboardItem });

        try {
            await SvgExportUtil.copyPngBlobToClipboard(pngBlob());

            expect(FakeClipboardItem.supports).not.toHaveBeenCalled();
            expect(clipboardWrite).toHaveBeenCalledWith([jasmine.any(FakeClipboardItem)]);
        } finally {
            restoreNavigatorPropertyDescriptor('canShare', originalCanShare);
            restoreNavigatorPropertyDescriptor('share', originalShare);
            restoreNavigatorPropertyDescriptor('clipboard', originalClipboard);
            Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: originalClipboardItem });
        }
    });

    it('shares PNG blobs before trying clipboard when file sharing works', async () => {
        const originalCanShare = getNavigatorPropertyDescriptor('canShare');
        const originalShare = getNavigatorPropertyDescriptor('share');
        const originalClipboard = getNavigatorPropertyDescriptor('clipboard');
        const canShare = jasmine.createSpy('canShare').and.returnValue(true);
        const share = jasmine.createSpy('share').and.resolveTo();
        const clipboardWrite = jasmine.createSpy('write').and.resolveTo();
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: clipboardWrite } });

        try {
            await SvgExportUtil.copyPngBlobToClipboard(pngBlob(), 'record-sheet');

            expect(canShare).toHaveBeenCalledWith({ files: [jasmine.any(File)] });
            expect(share).toHaveBeenCalledWith({ files: [jasmine.any(File)], title: 'record-sheet' });
            expect(clipboardWrite).not.toHaveBeenCalled();
        } finally {
            restoreNavigatorPropertyDescriptor('canShare', originalCanShare);
            restoreNavigatorPropertyDescriptor('share', originalShare);
            restoreNavigatorPropertyDescriptor('clipboard', originalClipboard);
        }
    });

    it('falls back to execCommand when share and async clipboard are unavailable', async () => {
        const originalCanShare = getNavigatorPropertyDescriptor('canShare');
        const originalShare = getNavigatorPropertyDescriptor('share');
        const originalClipboard = getNavigatorPropertyDescriptor('clipboard');
        const addItem = jasmine.createSpy('add');
        const setData = jasmine.createSpy('setData');
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        spyOn(document, 'execCommand').and.callFake((commandId: string) => {
            expect(commandId).toBe('copy');
            const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
            Object.defineProperty(copyEvent, 'clipboardData', {
                value: { items: { add: addItem }, setData },
            });
            document.dispatchEvent(copyEvent);
            return true;
        });

        try {
            await SvgExportUtil.copyPngBlobToClipboard(pngBlob(), 'record-sheet', { width: 500, height: 1000 });

            const selectedImage = document.querySelector<HTMLImageElement>('div[contenteditable="true"] img');
            expect(selectedImage).toBeNull();
            expect(addItem).toHaveBeenCalledWith(jasmine.any(File));
            expect(setData).toHaveBeenCalledWith('text/html', jasmine.stringMatching(/^<img alt="" src="data:image\/png;base64,/));
            expect(document.execCommand).toHaveBeenCalledOnceWith('copy');
        } finally {
            restoreNavigatorPropertyDescriptor('canShare', originalCanShare);
            restoreNavigatorPropertyDescriptor('share', originalShare);
            restoreNavigatorPropertyDescriptor('clipboard', originalClipboard);
        }
    });
});
