// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { OptionsService } from '../../services/options.service';
import { LoggerService } from '../../services/logger.service';
import { NativeEntityService } from '../../services/native-entity.service';
import type { LoadedEntity } from '../../models/entity/entity-repository';
import { TestTankEntity } from '../../models/entity/testing/test-entities';
import { RecordSheetSourceService } from '../../services/record-sheet-source.service';
import type { RecordSheetPipLayout } from '../../models/options.model';
import { SvgViewerLiteComponent } from './svg-viewer-lite.component';
import { SvgExportUtil } from '../../utils/svg-export.util';

function loadedEntity(entity: TestTankEntity): LoadedEntity {
    return { entity, source: {} } as unknown as LoadedEntity;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type LayoutState = {
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
    scrollLeft: number;
    scrollTop: number;
    offsetLeft: number;
    offsetTop: number;
    rect: { left: number; top: number; width: number; height: number };
};

const layouts = new WeakMap<HTMLElement, Partial<LayoutState>>();

describe('SvgViewerLiteComponent', () => {
    let logger: jasmine.SpyObj<Pick<LoggerService, 'error'>>;
    let nativeEntities: jasmine.SpyObj<Pick<NativeEntityService, 'canLoad' | 'load'>>;
    let recordSheets: jasmine.SpyObj<Pick<RecordSheetSourceService, 'load'>>;
    let originalResizeObserver: typeof ResizeObserver | undefined;
    let triggerResize: (() => void) | null;
    const options = signal({ CBTOptionalRules: { quirks: true }, recordSheetPipLayout: 'classic' as RecordSheetPipLayout,
        printAllOptions: { paperSize: 'letter' as 'a4' | 'letter', recordSheetCenterPanelContent: 'clusterTable' } });

    beforeEach(() => {
        logger = jasmine.createSpyObj<Pick<LoggerService, 'error'>>('LoggerService', ['error']);
        nativeEntities = jasmine.createSpyObj<Pick<NativeEntityService, 'canLoad' | 'load'>>(
            'NativeEntityService', ['canLoad', 'load'],
        );
        nativeEntities.canLoad.and.returnValue(true);
        nativeEntities.load.and.resolveTo(loadedEntity(new TestTankEntity()));
        recordSheets = jasmine.createSpyObj<Pick<RecordSheetSourceService, 'load'>>(
            'RecordSheetSourceService', ['load'],
        );
        recordSheets.load.and.callFake(async () => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.dataset['mekbayGenerated'] = '1';
            svg.setAttribute('viewBox', '0 0 612 792');
            return { svgs: [svg] };
        });
        options.set({ CBTOptionalRules: { quirks: true }, recordSheetPipLayout: 'classic', printAllOptions: { paperSize: 'letter' as 'a4' | 'letter', recordSheetCenterPanelContent: 'clusterTable' } });
        triggerResize = null;
        originalResizeObserver = window.ResizeObserver;
        window.ResizeObserver = class implements ResizeObserver {
            constructor(private readonly callback: ResizeObserverCallback) {
                triggerResize = () => this.callback([], this);
            }

            observe(): void { }
            unobserve(): void { }
            disconnect(): void { }
        };

        TestBed.configureTestingModule({
            imports: [SvgViewerLiteComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LoggerService, useValue: logger },
                { provide: NativeEntityService, useValue: nativeEntities },
                { provide: RecordSheetSourceService, useValue: recordSheets },
                { provide: OptionsService, useValue: { options } },
            ],
        });
    });

    afterEach(() => {
        window.ResizeObserver = originalResizeObserver!;
        window.dispatchEvent(new Event('afterprint'));
    });

    it('follows global paper size changes and respects an explicit preview override', async () => {
        const { fixture } = await createViewer();
        options.update(value => ({ ...value, printAllOptions: { ...value.printAllOptions, paperSize: 'a4' } }));
        fixture.detectChanges();
        await settle();
        fixture.detectChanges();
        expect(recordSheets.load.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ format: 'a4', pageFormat: 'a4' }));
        fixture.componentRef.setInput('paperSize', 'letter');
        fixture.detectChanges();
        await settle();
        expect(recordSheets.load.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ format: 'letter', pageFormat: 'letter' }));
    });

    it('regenerates an open preview when the Quirks option changes', async () => {
        const { fixture } = await createViewer();
        expect(recordSheets.load.calls.mostRecent().args[1]?.showQuirks).toBeTrue();
        const previousCalls = recordSheets.load.calls.count();
        options.update(value => ({ ...value, CBTOptionalRules: { quirks: false } }));
        fixture.detectChanges();
        await settle();
        expect(recordSheets.load.calls.count()).toBeGreaterThan(previousCalls);
        expect(recordSheets.load.calls.mostRecent().args[1]?.showQuirks).toBeFalse();
    });

    async function settle(): Promise<void> {
        for (let index = 0; index < 3; index += 1) {
            await Promise.resolve();
        }
    }

    async function createViewer(zoomable = true) {
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.componentRef.setInput('zoomable', zoomable);
        fixture.detectChanges();
        await settle();
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const container = element.querySelector<HTMLElement>('.svgl-container')!;
        const content = element.querySelector<HTMLElement>('.svgl-content')!;
        const svg = element.querySelector<SVGSVGElement>('svg')!;

        setLayout(container, {
            clientWidth: 1000,
            clientHeight: 500,
            scrollWidth: 1000,
            scrollHeight: 1400,
            rect: { left: 10, top: 20, width: 1000, height: 500 },
        });
        setLayout(content, {
            offsetLeft: 0,
            offsetTop: 0,
            rect: { left: 10, top: 20, width: 1000, height: 1400 },
        });

        return { fixture, element, container, content, svg };
    }

    function setLayout(element: HTMLElement, layout: {
        clientWidth?: number;
        clientHeight?: number;
        scrollWidth?: number;
        scrollHeight?: number;
        scrollLeft?: number;
        scrollTop?: number;
        offsetLeft?: number;
        offsetTop?: number;
        rect?: { left: number; top: number; width: number; height: number };
    }): void {
        const state = { ...layouts.get(element), ...layout };
        layouts.set(element, state);

        if (layout.clientWidth !== undefined) element.style.width = `${layout.clientWidth}px`;
        if (layout.clientHeight !== undefined) element.style.height = `${layout.clientHeight}px`;

        for (const key of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'offsetLeft', 'offsetTop'] as const) {
            Object.defineProperty(element, key, { configurable: true, get: () => layouts.get(element)?.[key] ?? 0 });
        }

        for (const key of ['scrollLeft', 'scrollTop'] as const) {
            Object.defineProperty(element, key, {
                configurable: true,
                get: () => layouts.get(element)?.[key] ?? 0,
                set: (value: number) => {
                    const current = layouts.get(element) ?? {};
                    current[key] = value;
                    layouts.set(element, current);
                },
            });
        }

        if (layout.rect) {
            element.getBoundingClientRect = () => ({
                x: layouts.get(element)?.rect?.left ?? 0,
                y: layouts.get(element)?.rect?.top ?? 0,
                left: layouts.get(element)?.rect?.left ?? 0,
                top: layouts.get(element)?.rect?.top ?? 0,
                width: layouts.get(element)?.rect?.width ?? 0,
                height: layouts.get(element)?.rect?.height ?? 0,
                right: (layouts.get(element)?.rect?.left ?? 0) + (layouts.get(element)?.rect?.width ?? 0),
                bottom: (layouts.get(element)?.rect?.top ?? 0) + (layouts.get(element)?.rect?.height ?? 0),
                toJSON: () => layouts.get(element)?.rect,
            } as DOMRect);
        }
    }

    function wheel(container: HTMLElement, init: WheelEventInit): void {
        container.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: 510,
            clientY: 270,
            ...init,
        }));
    }

    function pointer(container: HTMLElement, type: string, init: PointerEventInit): void {
        const event = typeof PointerEvent === 'undefined'
            ? new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY })
            : new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', ...init });
        container.dispatchEvent(event);
    }

    function doubleClick(container: HTMLElement, init: MouseEventInit = {}): void {
        container.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            clientX: 510,
            clientY: 270,
            ...init,
        }));
    }

    it('loads a generated sheet into the content surface at fit-width scale', async () => {
        const { container, content, svg } = await createViewer();

        expect(nativeEntities.load).toHaveBeenCalledTimes(1);
        expect(recordSheets.load).toHaveBeenCalledTimes(1);
        expect(svg.dataset['mekbayGenerated']).toBe('1');
        expect(svg.id).toBe('');
        expect(svg.style.width).toBe('100%');
        expect(content.style.width).toBe('100%');
        expect(container.classList).toContain('zoomable');
    });

    it('fits an entire page, retains zoom on resize, and switches back to width without reloading', async () => {
        const { fixture, container, content, svg } = await createViewer();
        expect(content.style.width).toBe('100%');
        fixture.componentRef.setInput('fitMode', 'page');
        fixture.detectChanges();
        const fittedWidth = 500 * 612 / 792;
        expect(parseFloat(content.style.width)).toBeCloseTo(fittedWidth, 2);
        expect(parseFloat(content.style.width) * 792 / 612).toBeCloseTo(500, 2);
        expect(recordSheets.load).toHaveBeenCalledTimes(1);
        expect(fixture.nativeElement.querySelector('svg')).toBe(svg);

        fixture.componentInstance.setZoomPercent(200);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(parseFloat(content.style.width)).toBeCloseTo(fittedWidth * 2, 2);
        setLayout(container, { clientWidth: 200, clientHeight: 500 });
        triggerResize?.();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(content.style.width).toBe('400px');
        expect(fixture.componentInstance.zoomPercent()).toBe(200);

        fixture.componentRef.setInput('fitMode', 'width');
        fixture.detectChanges();
        expect(content.style.width).toBe('100%');
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
        expect(recordSheets.load).toHaveBeenCalledTimes(1);
        expect(nativeEntities.load).toHaveBeenCalledTimes(1);
    });

    it('can fit pages with intrinsic dimensions when no viewBox is present', async () => {
        const { fixture, content, svg } = await createViewer();
        svg.removeAttribute('viewBox');
        svg.setAttribute('width', '600');
        svg.setAttribute('height', '800');
        fixture.componentRef.setInput('fitMode', 'page');
        fixture.detectChanges();
        expect(content.style.width).toBe('375px');
        expect(recordSheets.load).toHaveBeenCalledTimes(1);
    });

    it('shows every page returned for a multi-page unit', async () => {
        recordSheets.load.and.callFake(async () => {
            const front = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const reverse = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            front.dataset['mekbayPageRole'] = 'primary';
            reverse.dataset['mekbayPageRole'] = 'reverse';
            return { svgs: [front, reverse] };
        });

        const { element } = await createViewer();
        const pages = [...element.querySelectorAll<SVGSVGElement>('svg')];

        expect(pages.map(page => page.dataset['mekbayPageRole'])).toEqual(['primary', 'reverse']);
        expect(pages.every(page => page.style.width === '100%')).toBeTrue();
    });

    it('renders the admitted native design even when its catalog entry was deleted', async () => {
        const admitted = new TestTankEntity();
        nativeEntities.canLoad.and.returnValue(false);
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.componentRef.setInput('nativeEntity', admitted);
        fixture.detectChanges();
        await settle();
        fixture.detectChanges();

        expect(nativeEntities.canLoad).not.toHaveBeenCalled();
        expect(nativeEntities.load).not.toHaveBeenCalled();
        expect(recordSheets.load.calls.mostRecent().args[0]).toBe(admitted);
        expect(fixture.nativeElement.querySelector('svg')).not.toBeNull();
    });

    it('ignores an older pending sheet when the admitted design changes under the same UUID', async () => {
        const previous = new TestTankEntity();
        const replacement = new TestTankEntity();
        const oldSheet = deferred<{ svgs: SVGSVGElement[] }>();
        const newSheet = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        newSheet.dataset['design'] = 'replacement';
        recordSheets.load.and.callFake(entity => entity === previous
            ? oldSheet.promise : Promise.resolve({ svgs: [newSheet] }));
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.componentRef.setInput('nativeEntity', previous);
        fixture.detectChanges();
        await settle();
        fixture.componentRef.setInput('nativeEntity', replacement);
        fixture.detectChanges();
        await settle();
        oldSheet.resolve({ svgs: [document.createElementNS('http://www.w3.org/2000/svg', 'svg')] });
        await settle();
        fixture.detectChanges();

        expect(nativeEntities.load).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('svg')).toBe(newSheet);
    });

    it('regenerates on pip layout changes while unrelated presentation options keep the sheet', async () => {
        const { fixture, svg } = await createViewer();
        options.update(current => ({ ...current,
            printAllOptions: { paperSize: 'letter' as 'a4' | 'letter', recordSheetCenterPanelContent: 'fluffImage' } }));
        await fixture.whenStable();
        expect(recordSheets.load).toHaveBeenCalledTimes(1);
        options.update(current => ({ ...current, recordSheetPipLayout: 'rail' }));
        await fixture.whenStable();
        expect(recordSheets.load).toHaveBeenCalledTimes(2);
        expect(recordSheets.load.calls.mostRecent().args[1]).toEqual({ pipLayout: 'rail', showQuirks: true, format: 'letter', pageFormat: 'letter' });
        expect(nativeEntities.load).toHaveBeenCalledTimes(2);
        expect(fixture.nativeElement.querySelector('svg')).not.toBe(svg);
    });

    it('reports loading until all generated pages are attached and regenerates for A4', async () => {
        const pending = deferred<{ svgs: SVGSVGElement[] }>();
        recordSheets.load.and.returnValue(pending.promise);
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.detectChanges();

        expect(fixture.componentInstance.loading()).toBeTrue();
        expect(fixture.componentInstance.ready()).toBeFalse();
        expect(fixture.componentInstance.loadError()).toBeNull();
        pending.resolve({ svgs: [document.createElementNS('http://www.w3.org/2000/svg', 'svg')] });
        await settle();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(fixture.componentInstance.loading()).toBeFalse();
        expect(fixture.componentInstance.ready()).toBeTrue();

        fixture.componentRef.setInput('paperSize', 'a4');
        fixture.detectChanges();
        expect(fixture.componentInstance.ready()).toBeFalse();
        await settle();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(fixture.componentInstance.ready()).toBeTrue();
        expect(recordSheets.load.calls.mostRecent().args[1]).toEqual({ pipLayout: 'classic', showQuirks: true, format: 'a4', pageFormat: 'a4' });
        expect(nativeEntities.load).not.toHaveBeenCalled();
    });

    it('exposes render failures and clears the error for a replacement draft', async () => {
        recordSheets.load.and.rejectWith(new Error('Invalid armor allocation'));
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.detectChanges();
        await settle();
        expect(fixture.componentInstance.loading()).toBeFalse();
        expect(fixture.componentInstance.ready()).toBeFalse();
        expect(fixture.componentInstance.loadError()).toBe('Invalid armor allocation');
        await expectAsync(fixture.componentInstance.downloadPng(true)).toBeRejectedWithError('Invalid armor allocation');
        await expectAsync(fixture.componentInstance.print()).toBeRejectedWithError('Invalid armor allocation');

        recordSheets.load.and.resolveTo({ svgs: [document.createElementNS('http://www.w3.org/2000/svg', 'svg')] });
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.detectChanges();
        expect(fixture.componentInstance.loadError()).toBeNull();
        await settle();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(fixture.componentInstance.ready()).toBeTrue();
    });

    it('does not replace a newer ready draft with an old render error', async () => {
        const pending = deferred<{ svgs: SVGSVGElement[] }>();
        recordSheets.load.and.returnValues(pending.promise,
            Promise.resolve({ svgs: [document.createElementNS('http://www.w3.org/2000/svg', 'svg')] }));
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.detectChanges();
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.detectChanges();
        await settle();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        pending.reject(new Error('Obsolete failure'));
        await settle();
        expect(fixture.componentInstance.ready()).toBeTrue();
        expect(fixture.componentInstance.loadError()).toBeNull();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('propagates strict PNG failures while preserving best-effort details exports', async () => {
        const { fixture } = await createViewer();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const exportError = new Error('PNG export failed');
        spyOn(SvgExportUtil, 'downloadPng').and.rejectWith(exportError);
        spyOn(SvgExportUtil, 'openPng').and.rejectWith(exportError);
        await expectAsync(fixture.componentInstance.downloadPng(true)).toBeRejectedWith(exportError);
        await expectAsync(fixture.componentInstance.openPng(true)).toBeRejectedWith(exportError);
        await expectAsync(fixture.componentInstance.downloadPng()).toBeResolved();
        await expectAsync(fixture.componentInstance.openPng()).toBeResolved();
    });

    it('snapshots PNG pages before asynchronous rendering so later edits cannot change the export', async () => {
        const { fixture, svg } = await createViewer();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        svg.setAttribute('data-design', 'exported draft');
        const exported = deferred<void>();
        const download = spyOn(SvgExportUtil, 'downloadPng').and.returnValue(exported.promise);
        const action = fixture.componentInstance.downloadPng(true);
        svg.setAttribute('data-design', 'later draft');
        const captured = download.calls.mostRecent().args[0][0];
        expect(captured).not.toBe(svg);
        expect(captured.getAttribute('data-design')).toBe('exported draft');
        exported.resolve();
        await action;
    });

    it('treats an empty generated page list as a failed preview', async () => {
        recordSheets.load.and.resolveTo({ svgs: [] });
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.detectChanges();
        await settle();
        expect(fixture.componentInstance.ready()).toBeFalse();
        expect(fixture.componentInstance.loading()).toBeFalse();
        expect(fixture.componentInstance.loadError()).toBe('No record sheet pages were generated.');
    });

    it('prints the attached unsaved draft pages without loading a catalog or force design', async () => {
        const primary = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        primary.dataset['design'] = 'unsaved';
        const supplemental = primary.cloneNode(true) as SVGSVGElement;
        supplemental.dataset['page'] = 'supplemental';
        recordSheets.load.and.resolveTo({ svgs: [primary, supplemental] });
        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('nativeEntity', new TestTankEntity());
        fixture.componentRef.setInput('paperSize', 'a4');
        fixture.detectChanges();
        await settle();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const print = spyOn(window, 'print').and.stub();
        await fixture.componentInstance.print();
        const printed = document.querySelectorAll('#record-sheet-print-container svg');
        expect(print).toHaveBeenCalledOnceWith();
        expect(printed.length).toBe(2);
        expect(printed[0].getAttribute('data-design')).toBe('unsaved');
        expect(printed[1].getAttribute('data-page')).toBe('supplemental');
        expect(document.querySelector('#record-sheet-print-container style')!.textContent).toContain('size: A4 portrait');
        expect(recordSheets.load).toHaveBeenCalledTimes(1);
        expect(nativeEntities.load).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('svg')).toBe(primary);
    });

    it('ignores stale sheet loads when the unit changes before a previous request resolves', async () => {
        const atlasLoad = deferred<LoadedEntity>();
        const marauderLoad = deferred<LoadedEntity>();
        nativeEntities.load.and.returnValues(atlasLoad.promise, marauderLoad.promise);

        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.componentRef.setInput('zoomable', true);
        fixture.detectChanges();
        await settle();

        fixture.componentRef.setInput('unit', createEmptyUnit({ name: 'Marauder' }));
        fixture.detectChanges();
        await settle();

        marauderLoad.resolve(loadedEntity(new TestTankEntity()));
        await settle();
        fixture.detectChanges();

        atlasLoad.resolve(loadedEntity(new TestTankEntity()));
        await settle();
        fixture.detectChanges();

        const svgs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<SVGSVGElement>('svg'));
        expect(svgs.length).toBe(1);
        expect(svgs[0].hasAttribute('aria-label')).toBeFalse();
    });

    it('does not consume wheel events when zoomable is false', async () => {
        const { container } = await createViewer(false);
        let prevented = false;
        container.addEventListener('wheel', (event) => { prevented = event.defaultPrevented; });

        wheel(container, { deltaY: 200 });

        expect(container.scrollTop).toBe(0);
        expect(prevented).toBeFalse();
    });

    it('pans vertically with Ctrl+wheel and horizontally with Shift+wheel without changing zoom', async () => {
        const { container, fixture } = await createViewer();

        wheel(container, { ctrlKey: true, deltaY: 180 });
        expect(container.scrollTop).toBe(180);

        setLayout(container, { scrollWidth: 1600 });
        wheel(container, { shiftKey: true, deltaY: 120 });
        expect(container.scrollLeft).toBe(120);
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
    });

    it('zooms around the cursor and creates horizontal overflow on an unmodified wheel', async () => {
        const { container, content } = await createViewer();

        wheel(container, { clientX: 760, clientY: 270, deltaY: -240 });
        const scale = parseFloat(content.style.width) / 100;
        setLayout(container, {
            scrollWidth: Math.round(1000 * scale),
            scrollHeight: Math.round(1400 * scale),
        });
        wheel(container, { clientX: 760, clientY: 270, deltaY: -1 });

        expect(scale).toBeGreaterThan(1);
        expect(container.scrollWidth).toBeGreaterThan(container.clientWidth);
        expect(container.scrollLeft).toBeGreaterThan(0);
        expect(container.scrollTop).toBeGreaterThan(0);
    });

    it('matches page-viewer modifier priority, delta normalization and pan bounds', async () => {
        const { container, fixture } = await createViewer();
        setLayout(container, { scrollWidth: 2000, scrollHeight: 3000, scrollLeft: 500, scrollTop: 800 });

        wheel(container, { shiftKey: true, ctrlKey: true, deltaY: 120, deltaX: 40 });
        expect(container.scrollLeft).toBe(620);
        expect(container.scrollTop).toBe(800);

        wheel(container, { ctrlKey: true, deltaY: 0, deltaX: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
        expect(container.scrollTop).toBe(832);
        wheel(container, { shiftKey: true, deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
        expect(container.scrollLeft).toBe(1000);
        wheel(container, { ctrlKey: true, deltaY: -10, deltaMode: WheelEvent.DOM_DELTA_PAGE });
        expect(container.scrollTop).toBe(0);
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
    });

    it('keeps Meta+wheel on the default zoom path and clamps zoom-out at fit', async () => {
        const { container, fixture } = await createViewer();
        wheel(container, { metaKey: true, deltaY: -120 });
        expect(fixture.componentInstance.zoomPercent()).toBeGreaterThan(100);
        wheel(container, { deltaY: 10000 });
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
    });

    it('toggles zoom on mouse double-click at the input position', async () => {
        const { container, content } = await createViewer();
        setLayout(container, { scrollWidth: 2500, scrollHeight: 3500 });

        doubleClick(container, { clientX: 760, clientY: 270 });

        expect(content.style.width).toBe('250%');
        expect(container.scrollLeft).toBeGreaterThan(0);

        doubleClick(container, { clientX: 760, clientY: 270 });

        expect(content.style.width).toBe('100%');
        expect(container.scrollLeft).toBe(0);
        expect(container.scrollTop).toBe(0);
    });

    it('clamps scroll when the container resizes', async () => {
        const { container } = await createViewer();
        container.scrollLeft = 500;
        container.scrollTop = 1200;
        setLayout(container, { scrollWidth: 1000, scrollHeight: 700 });
        triggerResize?.();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

        expect(container.scrollLeft).toBe(0);
        expect(container.scrollTop).toBeLessThanOrEqual(200);
    });

    it('pans with one touch while zoomed in and reports live zoom-pan activity', async () => {
        const { container, content, fixture } = await createViewer();

        wheel(container, { deltaY: -240 });
        const scale = parseFloat(content.style.width) / 100;
        setLayout(container, { scrollWidth: Math.round(1000 * scale), scrollHeight: Math.round(1400 * scale) });

        const startTop = container.scrollTop;
        pointer(container, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 1, clientX: 500, clientY: 220 });
        pointer(container, 'pointerup', { pointerId: 1, clientX: 500, clientY: 220 });

        expect(container.scrollTop).toBeGreaterThan(startTop);
        expect(fixture.componentInstance.isZoomPanActive()).toBeTrue();
    });

    it('toggles zoom on touch double-tap', async () => {
        const { container, content } = await createViewer();

        pointer(container, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 2, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 2, clientX: 500, clientY: 300 });
        setLayout(container, { scrollWidth: 2500, scrollHeight: 3500 });

        expect(content.style.width).toBe('250%');

        pointer(container, 'pointerdown', { pointerId: 3, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 3, clientX: 500, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 4, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 4, clientX: 500, clientY: 300 });

        expect(content.style.width).toBe('100%');
        expect(container.scrollLeft).toBe(0);
        expect(container.scrollTop).toBe(0);
    });

    it('does not immediately toggle back from one touch double-tap', async () => {
        const { container, content } = await createViewer();

        pointer(container, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 2, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 2, clientX: 500, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 3, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 3, clientX: 500, clientY: 300 });

        expect(content.style.width).toBe('250%');
    });

    it('ignores synthetic mouse double-click after touch double-tap zooms in', async () => {
        const { container, content } = await createViewer();

        pointer(container, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 2, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 2, clientX: 500, clientY: 300 });
        doubleClick(container, { clientX: 500, clientY: 300 });

        expect(content.style.width).toBe('250%');
    });

    it('ignores synthetic mouse double-click after touch double-tap resets zoom', async () => {
        const { container, content } = await createViewer();

        doubleClick(container, { clientX: 500, clientY: 300 });
        expect(content.style.width).toBe('250%');

        pointer(container, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 2, clientX: 500, clientY: 300 });
        pointer(container, 'pointerup', { pointerId: 2, clientX: 500, clientY: 300 });
        doubleClick(container, { clientX: 500, clientY: 300 });

        expect(content.style.width).toBe('100%');
    });

    it('pans vertically with mouse drag at minimum zoom', async () => {
        const { container } = await createViewer();
        const startTop = container.scrollTop;

        pointer(container, 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500, clientY: 220 });
        pointer(container, 'pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500, clientY: 220 });

        expect(container.scrollTop).toBeGreaterThan(startTop);
    });

    it('switches cleanly between one-finger pan and two-finger pinch', async () => {
        const { container, content } = await createViewer();

        wheel(container, { deltaY: -120 });
        let scale = parseFloat(content.style.width) / 100;
        setLayout(container, { scrollWidth: Math.round(1000 * scale), scrollHeight: Math.round(1400 * scale) });

        pointer(container, 'pointerdown', { pointerId: 1, clientX: 400, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 1, clientX: 400, clientY: 250 });
        const afterPan = container.scrollTop;

        pointer(container, 'pointerdown', { pointerId: 2, clientX: 600, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 1, clientX: 350, clientY: 250 });
        pointer(container, 'pointermove', { pointerId: 2, clientX: 650, clientY: 300 });
        const afterPinchScale = parseFloat(content.style.width) / 100;
        setLayout(container, { scrollWidth: Math.round(1000 * afterPinchScale), scrollHeight: Math.round(1400 * afterPinchScale) });

        pointer(container, 'pointerup', { pointerId: 2, clientX: 650, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 1, clientX: 350, clientY: 200 });

        expect(afterPan).toBeGreaterThan(0);
        expect(afterPinchScale).toBeGreaterThan(scale);
        expect(container.scrollTop).toBeGreaterThan(afterPan);
    });

    it('clears stale touch pointers when a new primary touch gesture starts', async () => {
        const { container, content } = await createViewer();

        wheel(container, { deltaY: -120 });
        const scale = parseFloat(content.style.width) / 100;
        setLayout(container, { scrollWidth: Math.round(1000 * scale), scrollHeight: Math.round(1400 * scale) });

        pointer(container, 'pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 300, clientY: 300 });
        pointer(container, 'pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false, clientX: 700, clientY: 300 });

        const startTop = container.scrollTop;
        pointer(container, 'pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 500, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 500, clientY: 220 });
        pointer(container, 'pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 500, clientY: 220 });

        expect(container.scrollTop).toBeGreaterThan(startTop);
        expect(parseFloat(content.style.width)).toBeCloseTo(scale * 100, 3);
    });

    it('changes zoom from the public zoom API and resets it', async () => {
        const { container, content, fixture } = await createViewer();
        const originalRequestAnimationFrame = window.requestAnimationFrame;
        const originalCancelAnimationFrame = window.cancelAnimationFrame;
        window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame;
        window.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;

        try {
            fixture.componentInstance.setZoomPercent(200);
            fixture.detectChanges();

            expect(fixture.componentInstance.zoomPercent()).toBe(200);

            await settle();
            fixture.detectChanges();

            expect(content.style.width).toBe('200%');
            expect(fixture.componentInstance.zoomPercent()).toBe(200);

            setLayout(container, { scrollWidth: 2000, scrollHeight: 2800 });
            fixture.componentInstance.resetZoom();
            fixture.detectChanges();

            expect(content.style.width).toBe('100%');
            expect(container.scrollLeft).toBe(0);
            expect(container.scrollTop).toBe(0);
            expect(fixture.componentInstance.zoomPercent()).toBe(100);
        } finally {
            window.requestAnimationFrame = originalRequestAnimationFrame;
            window.cancelAnimationFrame = originalCancelAnimationFrame;
        }
    });
});
