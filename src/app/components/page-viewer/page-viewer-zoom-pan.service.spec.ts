import { TestBed } from '@angular/core/testing';
import type { ElementRef } from '@angular/core';

import { LayoutService } from '../../services/layout.service';
import { PAGE_GAP, PAGE_WIDTH, PageViewerZoomPanService } from './page-viewer-zoom-pan.service';

describe('PageViewerZoomPanService', () => {
    let service: PageViewerZoomPanService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                PageViewerZoomPanService,
                {
                    provide: LayoutService,
                    useValue: {
                        isMenuDragging: () => false
                    }
                }
            ]
        });

        service = TestBed.inject(PageViewerZoomPanService);
    });

    it('skips scale-dependent target writes during translate-only updates', () => {
        const content = createTrackedElement();
        const wrapper = createTrackedElement();
        const rootSvg = createTrackedElement();
        const overlay = createTrackedElement();

        wrapper.element.dataset['originalLeft'] = '12';
        overlay.element.dataset['originalLeft'] = '18';

        (service as never as { contentRef: unknown }).contentRef = { nativeElement: content.element };
        service.setTransformTargets([
            { wrapper: wrapper.element as unknown as HTMLElement, rootSvg: rootSvg.element as unknown as SVGSVGElement }
        ], [overlay.element as unknown as HTMLElement]);

        service.scale.set(1);
        service.translate.set({ x: 10, y: 20 });
        service.applyCurrentTransform();

        expect(wrapper.counts['left']).toBe(1);
        expect(wrapper.counts['width']).toBe(1);
        expect(wrapper.counts['height']).toBe(1);
        expect(rootSvg.counts['transform']).toBe(1);
        expect(overlay.counts['left']).toBe(1);
        expect(content.counts['transform']).toBe(1);

        service.translate.set({ x: 25, y: 35 });
        service.applyCurrentTransform();

        expect(content.counts['transform']).toBe(2);
        expect(wrapper.counts['left']).toBe(1);
        expect(wrapper.counts['width']).toBe(1);
        expect(wrapper.counts['height']).toBe(1);
        expect(rootSvg.counts['transform']).toBe(1);
        expect(overlay.counts['left']).toBe(1);
    });

    it('reapplies scale-dependent target writes when scale changes or targets refresh', () => {
        const content = createTrackedElement();
        const wrapper = createTrackedElement();
        const rootSvg = createTrackedElement();
        const overlay = createTrackedElement();

        wrapper.element.dataset['originalLeft'] = '12';
        overlay.element.dataset['originalLeft'] = '18';

        (service as never as { contentRef: unknown }).contentRef = { nativeElement: content.element };
        service.setTransformTargets([
            { wrapper: wrapper.element as unknown as HTMLElement, rootSvg: rootSvg.element as unknown as SVGSVGElement }
        ], [overlay.element as unknown as HTMLElement]);

        service.scale.set(1);
        service.applyCurrentTransform();

        service.scale.set(1.5);
        service.applyCurrentTransform();

        expect(wrapper.counts['left']).toBe(2);
        expect(rootSvg.counts['transform']).toBe(2);
        expect(overlay.counts['left']).toBe(2);

        service.setTransformTargets([
            { wrapper: wrapper.element as unknown as HTMLElement, rootSvg: rootSvg.element as unknown as SVGSVGElement }
        ], [overlay.element as unknown as HTMLElement]);
        service.applyCurrentTransform();

        expect(wrapper.counts['left']).toBe(3);
        expect(rootSvg.counts['transform']).toBe(3);
        expect(overlay.counts['left']).toBe(3);
    });

    it('pans horizontally with Shift+wheel without changing zoom', () => {
        const { container } = setupGestureDom(service);
        service.setDisplayedPages(1);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: 0, y: 0 });

        dispatchWheel(container, { deltaY: 120, shiftKey: true });

        expect(service.scale()).toBe(1);
        expect(service.translate()).toEqual({ x: -120, y: 0 });
    });

    it('pans vertically with Ctrl+wheel without changing zoom', () => {
        const { container } = setupGestureDom(service);
        service.setDisplayedPages(1);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: 0, y: 0 });

        dispatchWheel(container, { deltaY: 120, ctrlKey: true });

        expect(service.scale()).toBe(1);
        expect(service.translate()).toEqual({ x: 0, y: -120 });
    });

    it('keeps Shift+wheel horizontal panning within pan bounds', () => {
        const { container } = setupGestureDom(service);
        const minTranslateX = 300 - PAGE_WIDTH;
        service.setDisplayedPages(1);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: minTranslateX, y: 0 });

        dispatchWheel(container, { deltaY: 120, shiftKey: true });

        expect(service.translate()).toEqual({ x: minTranslateX, y: 0 });
    });

    it('resets to fit-to-screen on a non-interactive page double-tap', () => {
        const { pageWrapper } = setupGestureDom(service);
        service.setDoubleTapZoomResetMode('fit-to-screen');
        service.updateDimensions(612, 396, 1);
        service.scale.set(1.5);
        service.translate.set({ x: -40, y: -50 });
        spyOn(document, 'elementFromPoint').and.returnValue(pageWrapper);

        doubleTap(service);

        expect(service.scale()).toBe(service.minScale());
        expect(service.translate()).toEqual({ x: 153, y: 0 });
    });

    it('resets to the tapped page full width on a non-interactive page double-tap', () => {
        const { secondPageWrapper } = setupGestureDom(service);
        const secondPageLeft = PAGE_WIDTH + PAGE_GAP;
        secondPageWrapper.dataset['originalLeft'] = String(secondPageLeft);
        service.setDoubleTapZoomResetMode('full-width');
        service.setDisplayedPages(2);
        service.updateDimensions(612, 396, 2);
        service.scale.set(service.minScale());
        service.translate.set({ x: 153, y: 0 });
        spyOn(document, 'elementFromPoint').and.returnValue(secondPageWrapper);

        doubleTap(service);

        expect(service.scale()).toBe(1);
        expect(service.translate()).toEqual({ x: -secondPageLeft, y: -2 });
    });

    it('centers a full-width reset toward the double-tapped vertical sheet location', () => {
        const { pageWrapper } = setupGestureDom(service);
        service.setDoubleTapZoomResetMode('full-width');
        service.updateDimensions(612, 396, 1);
        service.scale.set(service.minScale());
        service.translate.set({ x: 153, y: 0 });
        spyOn(document, 'elementFromPoint').and.returnValue(pageWrapper);

        doubleTap(service, { clientY: 350 });

        expect(service.scale()).toBe(1);
        expect(service.translate()).toEqual({ x: 0, y: -396 });
    });

    it('contextually resets to fit-to-screen when the page is zoomed in', () => {
        const { pageWrapper } = setupGestureDom(service);
        service.setDoubleTapZoomResetMode('contextual');
        service.updateDimensions(612, 396, 1);
        service.scale.set(1.5);
        service.translate.set({ x: -40, y: -50 });
        spyOn(document, 'elementFromPoint').and.returnValue(pageWrapper);

        doubleTap(service);

        expect(service.scale()).toBe(service.minScale());
        expect(service.translate()).toEqual({ x: 153, y: 0 });
    });

    it('contextually resets to full width when the page is already fit-to-screen', () => {
        const { pageWrapper } = setupGestureDom(service);
        service.setDoubleTapZoomResetMode('contextual');
        service.updateDimensions(612, 396, 1);
        service.scale.set(service.minScale());
        service.translate.set({ x: 153, y: 0 });
        spyOn(document, 'elementFromPoint').and.returnValue(pageWrapper);

        doubleTap(service, { clientY: 350 });

        expect(service.scale()).toBe(1);
        expect(service.translate()).toEqual({ x: 0, y: -396 });
    });

    it('does not reset when double-tapping an interactive SVG control', () => {
        const { interactiveControl } = setupGestureDom(service);
        service.setDoubleTapZoomResetMode('fit-to-screen');
        service.updateDimensions(612, 396, 1);
        service.scale.set(1.5);
        service.translate.set({ x: -40, y: -50 });
        spyOn(document, 'elementFromPoint').and.returnValue(interactiveControl);

        doubleTap(service);

        expect(service.scale()).toBe(1.5);
        expect(service.translate()).toEqual({ x: -40, y: -50 });
    });
});

function setupGestureDom(service: PageViewerZoomPanService): {
    container: HTMLDivElement;
    content: HTMLDivElement;
    pageWrapper: HTMLDivElement;
    secondPageWrapper: HTMLDivElement;
    interactiveControl: HTMLDivElement;
} {
    const container = document.createElement('div');
    const content = document.createElement('div');
    const pageWrapper = document.createElement('div');
    const secondPageWrapper = document.createElement('div');
    const interactiveControl = document.createElement('div');

    pageWrapper.classList.add('page-wrapper');
    secondPageWrapper.classList.add('page-wrapper');
    interactiveControl.classList.add('interactive');

    pageWrapper.appendChild(interactiveControl);
    content.append(pageWrapper, secondPageWrapper);
    container.appendChild(content);

    service.initialize(
        { nativeElement: container } as ElementRef<HTMLDivElement>,
        { nativeElement: content } as ElementRef<HTMLDivElement>,
        undefined,
        { selectors: ['.interactive'] }
    );

    return { container, content, pageWrapper, secondPageWrapper, interactiveControl };
}

function dispatchWheel(
    target: HTMLElement,
    options: { deltaY: number; shiftKey?: boolean; ctrlKey?: boolean }
): void {
    target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: options.deltaY,
        shiftKey: options.shiftKey ?? false,
        ctrlKey: options.ctrlKey ?? false
    }));
}

function doubleTap(service: PageViewerZoomPanService, options: { clientX?: number; clientY?: number } = {}): void {
    const doubleTapService = service as unknown as { checkDoubleTap(event: PointerEvent): void };
    doubleTapService.checkDoubleTap(createTapEvent(options));
    doubleTapService.checkDoubleTap(createTapEvent(options));
}

function createTapEvent(options: { clientX?: number; clientY?: number } = {}): PointerEvent {
    return {
        clientX: options.clientX ?? 100,
        clientY: options.clientY ?? 100,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation')
    } as unknown as PointerEvent;
}

function createTrackedElement(): {
    element: { style: Record<string, string>; dataset: Record<string, string> };
    counts: Record<string, number>;
} {
    const counts: Record<string, number> = {};
    const values: Record<string, string> = {};
    const style = {} as Record<string, string>;

    for (const key of ['transform', 'transformOrigin', 'left', 'width', 'height']) {
        Object.defineProperty(style, key, {
            get: () => values[key] ?? '',
            set: (value: string) => {
                values[key] = value;
                counts[key] = (counts[key] ?? 0) + 1;
            },
            enumerable: true,
            configurable: true
        });
    }

    return {
        element: {
            style,
            dataset: {}
        },
        counts
    };
}