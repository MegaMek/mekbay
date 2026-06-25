import { SvgExportUtil } from './svg-export.util';

describe('SvgExportUtil', () => {
    function pngBlob(): Blob {
        return new Blob(['png'], { type: 'image/png' });
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

    function addFluffImage(svg: SVGSVGElement, src = 'https://db.mekbay.com/images/fluff/Mek/Atlas.png'): void {
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

        const blob = await withFakeSvgImage(() => SvgExportUtil.renderPngBlob([makeSvg(), makeSvg(50, 300)]));

        expect(blob).toEqual(jasmine.any(Blob));
        expect(canvasWidth).toBe(450);
        expect(canvasHeight).toBe(900);
        const serializedSvg = await (createObjectUrl.calls.first().args[0] as Blob).text();
        expect(serializedSvg).toContain('@font-face');
        expect(serializedSvg).toContain("font-family: 'Roboto';");
        expect(serializedSvg).toContain('data:font/ttf;base64,AQID');
        expect(serializedSvg).toContain('font-family="Roboto"');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg-1');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg-2');
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

        await withFakeSvgImage(() => SvgExportUtil.renderPngBlob([svg]));

        const serializedSvg = await (createObjectUrl.calls.first().args[0] as Blob).text();
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

        await withFakeSvgImage(() => SvgExportUtil.renderPngBlob([svg]));

        const serializedSvg = await (createObjectUrl.calls.first().args[0] as Blob).text();
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
        const open = spyOn(window, 'open').and.returnValue({} as Window);
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let canvasWidth = 0;
        let canvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            canvasWidth = this.width;
            canvasHeight = this.height;
            callback(pngBlob());
        });

        await withFakeSvgImage(() => SvgExportUtil.openPng([makeSvg()]));

        expect(canvasWidth).toBe(300);
        expect(canvasHeight).toBe(600);
        expect(open).toHaveBeenCalledWith('blob:png', '_blank', 'noopener');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg');
    });

    it('shares rendered SVGs as a 3x PNG file', async () => {
        mockFontFetch();
        const originalCanShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'canShare') ?? Object.getOwnPropertyDescriptor(navigator, 'canShare');
        const originalShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'share') ?? Object.getOwnPropertyDescriptor(navigator, 'share');
        const canShare = jasmine.createSpy('canShare').and.returnValue(true);
        const share = jasmine.createSpy('share').and.resolveTo();
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let canvasWidth = 0;
        let canvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            canvasWidth = this.width;
            canvasHeight = this.height;
            callback(pngBlob());
        });

        try {
            await withFakeSvgImage(() => SvgExportUtil.sharePng([makeSvg()], 'record-sheet'));

            expect(canvasWidth).toBe(300);
            expect(canvasHeight).toBe(600);
            expect(canShare).toHaveBeenCalledWith({ files: [jasmine.any(File)] });
            expect(share).toHaveBeenCalledWith({ files: [jasmine.any(File)], title: 'record-sheet' });
            expect(share.calls.mostRecent().args[0].files?.[0].name).toBe('record-sheet.png');
        } finally {
            if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
            if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
        }
    });

    it('copies rendered SVGs to the clipboard as a 5x PNG', async () => {
        mockFontFetch();
        const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard') ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const originalClipboardItem = window.ClipboardItem;
        const clipboardWrite = jasmine.createSpy('write').and.resolveTo();
        class FakeClipboardItem {
            constructor(public readonly items: Record<string, Blob>) { }
        }
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
            await withFakeSvgImage(() => SvgExportUtil.copyPngToClipboard([makeSvg()]));

            expect(canvasWidth).toBe(500);
            expect(canvasHeight).toBe(1000);
            expect(clipboardWrite).toHaveBeenCalledWith([jasmine.any(FakeClipboardItem)]);
            const clipboardItem = clipboardWrite.calls.mostRecent().args[0][0] as FakeClipboardItem;
            expect(clipboardItem.items['image/png']).toEqual(jasmine.any(Blob));
        } finally {
            if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
            Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: originalClipboardItem });
        }
    });

    it('copies PNG blobs directly through the async image clipboard API', async () => {
        const originalCanShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'canShare') ?? Object.getOwnPropertyDescriptor(navigator, 'canShare');
        const originalShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'share') ?? Object.getOwnPropertyDescriptor(navigator, 'share');
        const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard') ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');
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
            if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
            if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
            if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
            Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: originalClipboardItem });
        }
    });

    it('shares PNG blobs before trying clipboard when file sharing works', async () => {
        const originalCanShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'canShare') ?? Object.getOwnPropertyDescriptor(navigator, 'canShare');
        const originalShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'share') ?? Object.getOwnPropertyDescriptor(navigator, 'share');
        const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard') ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');
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
            if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
            if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
            if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
        }
    });

    it('falls back to execCommand when share and async clipboard are unavailable', async () => {
        const originalCanShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'canShare') ?? Object.getOwnPropertyDescriptor(navigator, 'canShare');
        const originalShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'share') ?? Object.getOwnPropertyDescriptor(navigator, 'share');
        const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard') ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');
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
            if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
            if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
            if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
        }
    });
});
