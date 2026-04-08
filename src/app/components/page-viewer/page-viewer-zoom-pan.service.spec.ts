import { TestBed } from '@angular/core/testing';

import { LayoutService } from '../../services/layout.service';
import { PageViewerZoomPanService } from './page-viewer-zoom-pan.service';

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
});

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