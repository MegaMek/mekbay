// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { signal, type ElementRef } from '@angular/core';
import { OptionsService } from '../../services/options.service';
import type { MouseWheelAction } from '../../models/options.model';

import { LayoutService } from '../../services/layout.service';
import { PAGE_GAP, PAGE_WIDTH, PageViewerZoomPanService } from './page-viewer-zoom-pan.service';

describe('PageViewerZoomPanService', () => {
    let service: PageViewerZoomPanService;
    const options = signal({ mouseWheelAction: 'scroll' as MouseWheelAction });

    beforeEach(() => {
        options.set({ mouseWheelAction: 'scroll' });
        TestBed.configureTestingModule({
            providers: [
                PageViewerZoomPanService,
                { provide: OptionsService, useValue: { options } },
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

    it('recalculates page spacing and fit using the selected physical dimensions', () => {
        service.updateDimensions(1000, 700, 1);
        service.setPageFormat('a4');
        expect(service.pageWidth()).toBe(595.276);
        expect(service.pageHeight()).toBe(841.89);
        expect(service.minScale()).toBeCloseTo(700 / 841.89, 6);
        expect(service.getPagePositions(2)).toEqual([0, 595.276 + PAGE_GAP]);
        service.setPageFormat('letter');
        expect(service.minScale()).toBeCloseTo(700 / 792, 6);
        expect(service.getPagePositions(2)).toEqual([0, 612 + PAGE_GAP]);
    });

    it('allows picker interactions to cancel gestures before a page viewer is initialized', () => {
        expect(() => service.cancelGesture()).not.toThrow();
    });

    it('coalesces wheel writes while retaining the accumulated pan', () => {
        const frames: FrameRequestCallback[] = [];
        spyOn(window, 'requestAnimationFrame').and.callFake(callback => { frames.push(callback); return 12345; });
        const { container, content } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: 0, y: 0 });
        dispatchWheel(container, { deltaY: 30, shiftKey: true });
        dispatchWheel(container, { deltaY: 40, shiftKey: true });
        expect(frames.length).toBe(1);
        expect(content.style.transform).toBe('');
        frames[0](0);
        expect(service.translate().x).toBe(-70);
        expect(content.style.transform).toBe('translate(-70px, 0px)');
    });

    it('keeps the last pinch sample received before a frame', () => {
        const frames: FrameRequestCallback[] = [];
        spyOn(window, 'requestAnimationFrame').and.callFake(callback => { frames.push(callback); return 12345; });
        const { container, content } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: -80, y: -80 });
        pointer(container, 'pointerdown', 1, 100);
        pointer(container, 'pointerdown', 2, 200);
        pointer(container, 'pointermove', 1, 90);
        pointer(container, 'pointermove', 2, 220);
        pointer(container, 'pointermove', 2, 240);
        expect(frames.length).toBe(1);
        frames[0](0);
        expect(service.scale()).toBeCloseTo(1.5, 6);
        const transform = new DOMMatrix(content.style.transform);
        expect(transform.m41).toBeCloseTo(service.translate().x, 6);
        expect(transform.m42).toBeCloseTo(service.translate().y, 6);
    });

    it('applies two-finger translation even when pinch scale stays constant', () => {
        const frames: FrameRequestCallback[] = [];
        spyOn(window, 'requestAnimationFrame').and.callFake(callback => { frames.push(callback); return 12345; });
        const { container, content } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: -80, y: -80 });
        pointer(container, 'pointerdown', 1, 100);
        pointer(container, 'pointerdown', 2, 200);
        pointer(container, 'pointermove', 1, 110);
        pointer(container, 'pointermove', 2, 210);
        frames[0](0);
        expect(service.scale()).toBe(1);
        expect(content.style.transform).toBe('translate(-70px, -80px)');
    });

    it('flushes the final pan when the pointer ends before its animation frame', () => {
        spyOn(window, 'requestAnimationFrame').and.returnValue(12345);
        const cancel = spyOn(window, 'cancelAnimationFrame');
        const { container, content } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: -80, y: -80 });
        pointer(container, 'pointerdown', 1, 100);
        pointer(container, 'pointermove', 1, 110);
        pointer(container, 'pointermove', 1, 120);
        pointer(container, 'pointerup', 1, 120);
        expect(content.style.transform).toBe('translate(-70px, -80px)');
        expect(cancel).toHaveBeenCalledWith(12345);
    });

    it('cancels pending transforms when destroyed', () => {
        spyOn(window, 'requestAnimationFrame').and.returnValue(12345);
        const cancel = spyOn(window, 'cancelAnimationFrame');
        const { container } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        dispatchWheel(container, { deltaY: 30, shiftKey: true });
        TestBed.resetTestingModule();
        expect(cancel).toHaveBeenCalledWith(12345);
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

    it('pans vertically with an unmodified wheel without changing zoom', () => {
        const { container } = setupGestureDom(service);
        service.setDisplayedPages(1);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: 0, y: 0 });

        dispatchWheel(container, { deltaY: 120 });

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

    it('zooms at the cursor with Ctrl or Meta, including small trackpad pinch deltas', () => {
        const { container } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
            service.scale.set(1);
            service.translate.set({ x: -100, y: -100 });
            dispatchWheel(container, { ...modifier, deltaY: -2, clientX: 100, clientY: 100 });
            expect(service.scale()).toBeGreaterThan(1);
            expect((100 - service.translate().x) / service.scale()).toBeCloseTo(200, 6);
            expect((100 - service.translate().y) / service.scale()).toBeCloseTo(200, 6);
        }
    });

    it('applies the wheel preference immediately and keeps horizontal gestures as scrolling', () => {
        const { container } = setupGestureDom(service);
        service.updateDimensions(300, 300, 1);
        service.scale.set(1);
        service.translate.set({ x: -100, y: -100 });
        options.set({ mouseWheelAction: 'zoom' });
        dispatchWheel(container, { deltaY: -120 });
        const zoom = service.scale();
        const before = service.translate();
        expect(zoom).toBeGreaterThan(1);
        dispatchWheel(container, { deltaY: 30, ctrlKey: true });
        dispatchWheel(container, { deltaX: 40 });
        expect(service.scale()).toBe(zoom);
        expect(service.translate()).toEqual({ x: before.x - 40, y: before.y - 30 });
        options.set({ mouseWheelAction: 'scroll' });
        dispatchWheel(container, { deltaY: 20 });
        expect(service.scale()).toBe(zoom);
        expect(service.translate().y).toBe(before.y - 50);
    });

    it('preserves diagonal trackpad axes and normalizes line and page scrolling', () => {
        const { container } = setupGestureDom(service);
        service.updateDimensions(300, 200, 1);
        service.scale.set(2);
        service.translate.set({ x: 0, y: 0 });
        dispatchWheel(container, { deltaX: 2, deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
        expect(service.translate()).toEqual({ x: -32, y: -48 });
        dispatchWheel(container, { deltaX: 1, deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
        expect(service.translate()).toEqual({ x: -332, y: -248 });
        dispatchWheel(container, { deltaX: 40, shiftKey: true });
        expect(service.translate()).toEqual({ x: -372, y: -248 });
        dispatchWheel(container, { deltaY: 1, shiftKey: true, deltaMode: WheelEvent.DOM_DELTA_PAGE });
        expect(service.translate()).toEqual({ x: -672, y: -248 });
        dispatchWheel(container, { ctrlKey: true });
        expect(service.scale()).toBe(2);
    });

    it('turns one page after enough horizontal overflow and ignores the rest of the momentum', () => {
        let now = 1000;
        spyOn(performance, 'now').and.callFake(() => now);
        const navigate = jasmine.createSpy('navigate');
        const { container } = setupGestureDom(service, navigate);
        service.updateDimensions(300, 300, 4);
        service.setDisplayedPages(1);
        service.scale.set(service.minScale());
        service.resetView();
        for (let i = 0; i < 3; i++) dispatchWheel(container, { deltaX: 20 });
        expect(navigate).not.toHaveBeenCalled();
        dispatchWheel(container, { deltaX: 20 });
        expect(navigate).toHaveBeenCalledOnceWith('right');
        for (let i = 0; i < 10; i++) { now += 20; dispatchWheel(container, { deltaX: 40 }); }
        expect(navigate).toHaveBeenCalledTimes(1);
        now += 200;
        dispatchWheel(container, { shiftKey: true, deltaY: 120 });
        expect(navigate).toHaveBeenCalledTimes(2);
        dispatchWheel(container, { deltaX: -120 });
        expect(navigate.calls.mostRecent().args).toEqual(['left']);
    });

    it('pans a zoomed page to its edge before navigating, and never navigates from vertical scrolling or zoom', () => {
        const navigate = jasmine.createSpy('navigate');
        const { container } = setupGestureDom(service, navigate);
        service.updateDimensions(300, 300, 4);
        service.setDisplayedPages(1);
        service.scale.set(1);
        service.translate.set({ x: 0, y: 0 });
        dispatchWheel(container, { deltaX: 250 });
        expect(service.translate().x).toBe(-250);
        expect(navigate).not.toHaveBeenCalled();
        dispatchWheel(container, { deltaX: 100 });
        expect(service.translate().x).toBe(300 - PAGE_WIDTH);
        expect(navigate).not.toHaveBeenCalled();
        dispatchWheel(container, { deltaX: 50 });
        expect(navigate).toHaveBeenCalledOnceWith('right');
        navigate.calls.reset();
        dispatchWheel(container, { deltaY: 1000, deltaX: -100 });
        dispatchWheel(container, { deltaY: -120, ctrlKey: true });
        expect(navigate).not.toHaveBeenCalled();
        service.updateDimensions(300, 300, 1);
        service.resetView();
        dispatchWheel(container, { deltaX: 500 });
        expect(navigate).not.toHaveBeenCalled();
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

function pointer(target: HTMLElement, type: string, pointerId: number, clientX: number): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch', clientX, clientY: 100 }));
}

function setupGestureDom(service: PageViewerZoomPanService, navigate?: (direction: 'left' | 'right') => void): {
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
        { selectors: ['.interactive'] },
        false,
        navigate
    );

    return { container, content, pageWrapper, secondPageWrapper, interactiveControl };
}

function dispatchWheel(
    target: HTMLElement,
    options: WheelEventInit
): void {
    target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ...options
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
