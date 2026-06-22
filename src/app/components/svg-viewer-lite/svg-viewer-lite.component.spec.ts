import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { OptionsService } from '../../services/options.service';
import { SheetService } from '../../services/sheet.service';
import { LoggerService } from '../../services/logger.service';
import { SvgViewerLiteComponent } from './svg-viewer-lite.component';

function makeSvg(width = 100, height = 200): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'source-sheet');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());
    return svg;
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
    let sheetService: jasmine.SpyObj<Pick<SheetService, 'getSheet'>>;
    let logger: jasmine.SpyObj<Pick<LoggerService, 'error'>>;
    let originalResizeObserver: typeof ResizeObserver | undefined;
    let triggerResize: (() => void) | null;
    const options = signal({ recordSheetCenterPanelContent: 'clusterTable' });

    beforeEach(() => {
        sheetService = jasmine.createSpyObj<Pick<SheetService, 'getSheet'>>('SheetService', ['getSheet']);
        logger = jasmine.createSpyObj<Pick<LoggerService, 'error'>>('LoggerService', ['error']);
        options.set({ recordSheetCenterPanelContent: 'clusterTable' });
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
                { provide: SheetService, useValue: sheetService },
                { provide: LoggerService, useValue: logger },
                { provide: OptionsService, useValue: { options } },
            ],
        });
    });

    afterEach(() => {
        window.ResizeObserver = originalResizeObserver!;
    });

    async function settle(): Promise<void> {
        for (let index = 0; index < 3; index += 1) {
            await Promise.resolve();
        }
    }

    async function createViewer(zoomable = true, controls = false, sheets = ['atlas.svg']) {
        sheetService.getSheet.and.callFake(async (sheetName) => sheetName.includes('wide') ? makeSvg(50, 300) : makeSvg());

        const fixture = TestBed.createComponent(SvgViewerLiteComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ sheets }));
        fixture.componentRef.setInput('zoomable', zoomable);
        fixture.componentRef.setInput('controls', controls);
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

    it('loads cloned sheets into the content surface at fit-width scale', async () => {
        const { container, content, svg } = await createViewer();

        expect(sheetService.getSheet).toHaveBeenCalledOnceWith('atlas.svg');
        expect(svg.id).toBe('');
        expect(svg.style.width).toBe('100%');
        expect(content.style.width).toBe('100%');
        expect(container.classList).toContain('zoomable');
    });

    it('does not consume wheel events when zoomable is false', async () => {
        const { container } = await createViewer(false);
        let prevented = false;
        container.addEventListener('wheel', (event) => { prevented = event.defaultPrevented; });

        wheel(container, { deltaY: 200 });

        expect(container.scrollTop).toBe(0);
        expect(prevented).toBeFalse();
    });

    it('pans vertically with mousewheel and horizontally with shift mousewheel', async () => {
        const { container } = await createViewer();

        wheel(container, { deltaY: 180 });
        expect(container.scrollTop).toBe(180);

        setLayout(container, { scrollWidth: 1600 });
        wheel(container, { shiftKey: true, deltaY: 120 });
        expect(container.scrollLeft).toBe(120);
    });

    it('zooms around the cursor and creates horizontal overflow on ctrl mousewheel', async () => {
        const { container, content } = await createViewer();

        wheel(container, { ctrlKey: true, clientX: 760, clientY: 270, deltaY: -240 });
        const scale = parseFloat(content.style.width) / 100;
        setLayout(container, {
            scrollWidth: Math.round(1000 * scale),
            scrollHeight: Math.round(1400 * scale),
        });
        wheel(container, { ctrlKey: true, clientX: 760, clientY: 270, deltaY: -1 });

        expect(scale).toBeGreaterThan(1);
        expect(container.scrollWidth).toBeGreaterThan(container.clientWidth);
        expect(container.scrollLeft).toBeGreaterThan(0);
        expect(container.scrollTop).toBeGreaterThan(0);
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

        expect(container.scrollLeft).toBe(0);
        expect(container.scrollTop).toBeLessThanOrEqual(200);
    });

    it('pans with one touch while zoomed in and emits zoom-pan activity', async () => {
        const { container, content, fixture } = await createViewer();
        const activity = jasmine.createSpy('zoomPanActiveChange');
        fixture.componentInstance.zoomPanActiveChange.subscribe(activity);

        wheel(container, { ctrlKey: true, deltaY: -240 });
        const scale = parseFloat(content.style.width) / 100;
        setLayout(container, { scrollWidth: Math.round(1000 * scale), scrollHeight: Math.round(1400 * scale) });

        const startTop = container.scrollTop;
        pointer(container, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 300 });
        pointer(container, 'pointermove', { pointerId: 1, clientX: 500, clientY: 220 });
        pointer(container, 'pointerup', { pointerId: 1, clientX: 500, clientY: 220 });

        expect(container.scrollTop).toBeGreaterThan(startTop);
        expect(activity).toHaveBeenCalledWith(true);
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

        wheel(container, { ctrlKey: true, deltaY: -120 });
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

    it('renders bottom controls only when requested', async () => {
        const withoutControls = await createViewer();
        expect(withoutControls.element.querySelector('.svgl-controls')).toBeNull();

        const withControls = await createViewer(true, true);
        const controls = withControls.element.querySelector('.svgl-controls');

        expect(controls).not.toBeNull();
        expect(controls?.querySelector('button.bt-button')?.textContent?.trim()).toBe('RESET');
        expect(controls?.textContent).toContain('100%');
    });

    it('changes zoom with the slider and resets it from the controls', async () => {
        const { container, content, element, fixture } = await createViewer(true, true);
        const slider = element.querySelector<HTMLInputElement>('.zoom-control input')!;
        const reset = Array.from(element.querySelectorAll<HTMLButtonElement>('.svgl-controls button'))
            .find((button) => button.textContent?.trim() === 'RESET')!;
        const originalRequestAnimationFrame = window.requestAnimationFrame;
        const originalCancelAnimationFrame = window.cancelAnimationFrame;
        window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame;
        window.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;

        try {
            slider.value = '200';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            fixture.detectChanges();

            expect(element.querySelector('output')?.textContent?.trim()).toBe('200%');

            await settle();
            fixture.detectChanges();

            expect(content.style.width).toBe('200%');
            expect(element.querySelector('output')?.textContent?.trim()).toBe('200%');

            setLayout(container, { scrollWidth: 2000, scrollHeight: 2800 });
            reset.click();
            fixture.detectChanges();

            expect(content.style.width).toBe('100%');
            expect(container.scrollLeft).toBe(0);
            expect(container.scrollTop).toBe(0);
            expect(element.querySelector('output')?.textContent?.trim()).toBe('100%');
        } finally {
            window.requestAnimationFrame = originalRequestAnimationFrame;
            window.cancelAnimationFrame = originalCancelAnimationFrame;
        }
    });

    it('exports all SVGs horizontally as a high-resolution PNG from the controls', async () => {
        const { element } = await createViewer(true, true, ['atlas.svg', 'atlas-wide.svg']);
        const exportButton = Array.from(element.querySelectorAll<HTMLButtonElement>('.svgl-controls button'))
            .find((button) => button.textContent?.trim() === 'EXPORT PNG')!;
        const originalImage = window.Image;
        const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValues('blob:svg-1', 'blob:svg-2', 'blob:png');
        const revokeObjectUrl = spyOn(URL, 'revokeObjectURL').and.stub();
        const click = spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
        spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
        let exportedCanvasWidth = 0;
        let exportedCanvasHeight = 0;
        spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback: BlobCallback) {
            exportedCanvasWidth = this.width;
            exportedCanvasHeight = this.height;
            callback(new Blob(['png'], { type: 'image/png' }));
        });
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        window.Image = FakeImage as unknown as typeof Image;

        try {
            exportButton.click();
            await settle();
        } finally {
            window.Image = originalImage;
        }

        expect(createObjectUrl).toHaveBeenCalledTimes(3);
        expect(exportedCanvasWidth).toBe(450);
        expect(exportedCanvasHeight).toBe(900);
        expect(click).toHaveBeenCalled();
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg-1');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg-2');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:png');
    });
});
