import type { ListRange } from '@angular/cdk/collections';
import type { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { VariableSizeVirtualScrollStrategy } from './variable-size-virtual-scroll.directive';

interface ViewportHarness {
    viewport: CdkVirtualScrollViewport;
    getRange(): ListRange;
    getTotalSize(): number;
    getContentOffset(): number;
    getScrollOffset(): number;
    setScrollOffset(value: number): void;
    setDataLength(value: number): void;
    scrollToOffset: jasmine.Spy;
}

function createViewportHarness(dataLength: number, viewportSize = 300): ViewportHarness {
    let currentDataLength = dataLength;
    let renderedRange: ListRange = { start: 0, end: 0 };
    let totalSize = 0;
    let contentOffset = 0;
    let scrollOffset = 0;
    const scrollToOffset = jasmine.createSpy('scrollToOffset').and.callFake((offset: number) => {
        scrollOffset = offset;
    });

    const viewport = {
        getDataLength: () => currentDataLength,
        getViewportSize: () => viewportSize,
        getRenderedRange: () => renderedRange,
        measureScrollOffset: () => scrollOffset,
        setRenderedRange: (range: ListRange) => { renderedRange = { ...range }; },
        setRenderedContentOffset: (offset: number) => { contentOffset = offset; },
        setTotalContentSize: (size: number) => { totalSize = size; },
        scrollToOffset,
    } as unknown as CdkVirtualScrollViewport;

    return {
        viewport,
        getRange: () => renderedRange,
        getTotalSize: () => totalSize,
        getContentOffset: () => contentOffset,
        getScrollOffset: () => scrollOffset,
        setScrollOffset: value => { scrollOffset = value; },
        setDataLength: value => { currentDataLength = value; },
        scrollToOffset,
    };
}

describe('VariableSizeVirtualScrollStrategy', () => {
    it('uses estimates for unmeasured items and renders through the viewport buffer', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();
        const harness = createViewportHarness(10, 250);
        strategy.updateConfig(100, 100, 200);
        strategy.setDataKeys(Array.from({ length: 10 }, (_, index) => `unit-${index}`));

        strategy.attach(harness.viewport);

        expect(harness.getTotalSize()).toBe(1_000);
        expect(harness.getRange()).toEqual({ start: 0, end: 5 });
        expect(harness.getContentOffset()).toBe(0);
    });

    it('builds exact prefix offsets from independently measured row heights', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();
        const harness = createViewportHarness(4, 200);
        strategy.updateConfig(100, 0, 100);
        strategy.setDataKeys(['a', 'b', 'c', 'd']);
        strategy.attach(harness.viewport);

        strategy.updateItemSizes([
            { index: 0, size: 80 },
            { index: 1, size: 140 },
            { index: 2, size: 60 },
        ]);

        expect(strategy.getOffsetForIndex(0)).toBe(0);
        expect(strategy.getOffsetForIndex(1)).toBe(80);
        expect(strategy.getOffsetForIndex(2)).toBe(220);
        expect(strategy.getOffsetForIndex(3)).toBe(280);
        expect(strategy.getTotalContentSize()).toBe(380);
        expect(harness.getTotalSize()).toBe(380);
    });

    it('scrolls to the measured offset for the requested index', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();
        const harness = createViewportHarness(3);
        strategy.updateConfig(100, 0, 100);
        strategy.setDataKeys(['a', 'b', 'c']);
        strategy.attach(harness.viewport);
        strategy.updateItemSizes([{ index: 0, size: 75 }, { index: 1, size: 180 }]);

        strategy.scrollToIndex(2, 'smooth');

        expect(harness.scrollToOffset).toHaveBeenCalledWith(255, 'smooth');
    });

    it('preserves the visible row anchor when earlier row measurements change', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();
        const harness = createViewportHarness(5, 200);
        strategy.updateConfig(100, 0, 100);
        strategy.setDataKeys(['a', 'b', 'c', 'd', 'e']);
        strategy.attach(harness.viewport);
        harness.setScrollOffset(250); // 50px into row c using estimates.

        strategy.updateItemSizes([{ index: 0, size: 150 }, { index: 1, size: 80 }]);

        expect(harness.getScrollOffset()).toBe(280);
        expect(harness.scrollToOffset).toHaveBeenCalledWith(280, 'auto');
    });

    it('keeps measured heights with their keys after data reordering', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();
        const harness = createViewportHarness(3);
        strategy.updateConfig(100, 0, 100);
        strategy.setDataKeys(['short', 'tall', 'other']);
        strategy.attach(harness.viewport);
        strategy.updateItemSizes([{ index: 0, size: 70 }, { index: 1, size: 190 }]);

        strategy.setDataKeys(['tall', 'short', 'other']);

        expect(strategy.getOffsetForIndex(1)).toBe(190);
        expect(strategy.getOffsetForIndex(2)).toBe(260);
    });

    it('ignores invalid measurements and clamps out-of-range scroll targets', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();
        const harness = createViewportHarness(2);
        strategy.updateConfig(100, 0, 100);
        strategy.setDataKeys(['a', 'b']);
        strategy.attach(harness.viewport);

        strategy.updateItemSizes([
            { index: -1, size: 50 },
            { index: 0, size: 0 },
            { index: 5, size: 500 },
        ]);
        strategy.scrollToIndex(99, 'auto');

        expect(strategy.getTotalContentSize()).toBe(200);
        expect(harness.scrollToOffset).toHaveBeenCalledWith(100, 'auto');
    });

    it('rejects invalid strategy configuration', () => {
        const strategy = new VariableSizeVirtualScrollStrategy();

        expect(() => strategy.updateConfig(0, 100, 200)).toThrowError(/estimatedItemSize/);
        expect(() => strategy.updateConfig(100, -1, 200)).toThrowError(/minBufferPx/);
        expect(() => strategy.updateConfig(100, 200, 100)).toThrowError(/maxBufferPx/);
    });
});
