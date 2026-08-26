// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ListRange } from '@angular/cdk/collections';
import {
    CdkVirtualScrollViewport,
    VIRTUAL_SCROLL_STRATEGY,
    type VirtualScrollStrategy,
} from '@angular/cdk/scrolling';
import {
    Directive,
    ElementRef,
    forwardRef,
    inject,
    Input,
    NgZone,
    OnDestroy,
} from '@angular/core';
import { distinctUntilChanged, Subject } from 'rxjs';

const DEFAULT_ESTIMATED_ITEM_SIZE = 280;
const DEFAULT_MIN_BUFFER_PX = 900;
const DEFAULT_MAX_BUFFER_PX = 1600;
const SIZE_EPSILON_PX = 0.5;

/**
 * CDK virtual-scroll strategy for vertically stacked items with measured,
 * variable heights. Unmeasured items use an estimate until rendered.
 */
export class VariableSizeVirtualScrollStrategy implements VirtualScrollStrategy {
    private readonly scrolledIndexSubject = new Subject<number>();
    readonly scrolledIndexChange = this.scrolledIndexSubject.pipe(distinctUntilChanged());

    private viewport: CdkVirtualScrollViewport | null = null;
    private dataKeys: readonly unknown[] = [];
    private readonly measuredSizes = new Map<unknown, number>();
    private offsets: number[] = [0];
    private estimatedItemSize = DEFAULT_ESTIMATED_ITEM_SIZE;
    private minBufferPx = DEFAULT_MIN_BUFFER_PX;
    private maxBufferPx = DEFAULT_MAX_BUFFER_PX;

    attach(viewport: CdkVirtualScrollViewport): void {
        this.viewport = viewport;
        this.rebuildOffsets();
        this.updateViewport();
    }

    detach(): void {
        this.viewport = null;
    }

    onContentScrolled(): void {
        this.updateRenderedRange();
    }

    onDataLengthChanged(): void {
        this.rebuildOffsets();
        this.updateViewport();
    }

    onContentRendered(): void {}

    onRenderedOffsetChanged(): void {}

    scrollToIndex(index: number, behavior: ScrollBehavior): void {
        if (!this.viewport || this.itemCount === 0) return;

        const safeIndex = Math.max(0, Math.min(Math.floor(index), this.itemCount - 1));
        this.viewport.scrollToOffset(this.offsetAt(safeIndex), behavior);
    }

    updateConfig(estimatedItemSize: number, minBufferPx: number, maxBufferPx: number): void {
        const safeEstimate = this.requirePositive(estimatedItemSize, 'estimatedItemSize');
        const safeMinBuffer = this.requireNonNegative(minBufferPx, 'minBufferPx');
        const safeMaxBuffer = this.requireNonNegative(maxBufferPx, 'maxBufferPx');
        if (safeMaxBuffer < safeMinBuffer) {
            throw new Error('Variable virtual scroll: maxBufferPx must be greater than or equal to minBufferPx.');
        }

        const estimateChanged = safeEstimate !== this.estimatedItemSize;
        this.estimatedItemSize = safeEstimate;
        this.minBufferPx = safeMinBuffer;
        this.maxBufferPx = safeMaxBuffer;
        if (estimateChanged) this.measuredSizes.clear();
        this.rebuildOffsets();
        this.updateViewport();
    }

    setDataKeys(keys: readonly unknown[]): void {
        this.dataKeys = keys;
        const activeKeys = new Set(keys);
        for (const key of this.measuredSizes.keys()) {
            if (!activeKeys.has(key)) this.measuredSizes.delete(key);
        }
        this.rebuildOffsets();
        this.updateViewport();
    }

    clearMeasurements(): void {
        if (this.measuredSizes.size === 0) return;
        this.preserveScrollAnchor(() => this.measuredSizes.clear());
    }

    updateItemSizes(measurements: ReadonlyArray<{ index: number; size: number }>): void {
        const changes = measurements.filter(({ index, size }) => {
            if (index < 0 || index >= this.itemCount || !Number.isFinite(size) || size <= 0) return false;
            const key = this.keyAt(index);
            const previousSize = this.measuredSizes.get(key);
            return previousSize === undefined || Math.abs(previousSize - size) >= SIZE_EPSILON_PX;
        });
        if (changes.length === 0) return;

        this.preserveScrollAnchor(() => {
            for (const { index, size } of changes) {
                this.measuredSizes.set(this.keyAt(index), size);
            }
        });
    }

    getOffsetForIndex(index: number): number {
        return this.offsetAt(Math.max(0, Math.min(index, this.itemCount)));
    }

    getTotalContentSize(): number {
        return this.offsetAt(this.itemCount);
    }

    getRenderedRange(): ListRange {
        return this.viewport?.getRenderedRange() ?? { start: 0, end: 0 };
    }

    private get itemCount(): number {
        return this.dataKeys.length;
    }

    private keyAt(index: number): unknown {
        return this.dataKeys[index] ?? index;
    }

    private sizeAt(index: number): number {
        return this.measuredSizes.get(this.keyAt(index)) ?? this.estimatedItemSize;
    }

    private offsetAt(index: number): number {
        return this.offsets[index] ?? this.offsets[this.offsets.length - 1] ?? 0;
    }

    private rebuildOffsets(): void {
        const offsets = new Array<number>(this.itemCount + 1);
        offsets[0] = 0;
        for (let index = 0; index < this.itemCount; index++) {
            offsets[index + 1] = offsets[index] + this.sizeAt(index);
        }
        this.offsets = offsets;
    }

    private updateViewport(): void {
        if (!this.viewport) return;
        this.viewport.setTotalContentSize(this.getTotalContentSize());
        this.updateRenderedRange();
    }

    private updateRenderedRange(): void {
        if (!this.viewport) return;
        const itemCount = this.itemCount;
        if (itemCount === 0) {
            this.viewport.setRenderedRange({ start: 0, end: 0 });
            this.viewport.setRenderedContentOffset(0);
            this.scrolledIndexSubject.next(0);
            return;
        }

        const scrollOffset = Math.max(0, this.viewport.measureScrollOffset());
        const viewportEnd = scrollOffset + this.viewport.getViewportSize();
        const firstVisibleIndex = this.indexAtOffset(scrollOffset);
        const currentRange = this.viewport.getRenderedRange();
        const currentStartOffset = this.offsetAt(currentRange.start);
        const currentEndOffset = this.offsetAt(currentRange.end);
        const startBuffer = scrollOffset - currentStartOffset;
        const endBuffer = currentEndOffset - viewportEnd;

        let range: ListRange = currentRange;
        if (currentRange.end <= currentRange.start
            || startBuffer < this.minBufferPx
            || endBuffer < this.minBufferPx
            || currentRange.end > itemCount) {
            range = {
                start: this.indexAtOffset(Math.max(0, scrollOffset - this.maxBufferPx)),
                end: this.indexAfterOffset(Math.min(this.getTotalContentSize(), viewportEnd + this.maxBufferPx)),
            };
        }

        range.start = Math.max(0, Math.min(range.start, itemCount));
        range.end = Math.max(range.start, Math.min(range.end, itemCount));
        this.viewport.setRenderedRange(range);
        this.viewport.setRenderedContentOffset(this.offsetAt(range.start));
        this.scrolledIndexSubject.next(firstVisibleIndex);
    }

    private indexAtOffset(offset: number): number {
        if (this.itemCount === 0) return 0;
        if (offset <= 0) return 0;
        if (offset >= this.getTotalContentSize()) return this.itemCount - 1;

        let low = 0;
        let high = this.itemCount;
        while (low < high) {
            const middle = Math.floor((low + high + 1) / 2);
            if (this.offsetAt(middle) <= offset) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return Math.min(low, this.itemCount - 1);
    }

    private indexAfterOffset(offset: number): number {
        if (offset <= 0 || this.itemCount === 0) return 0;
        if (offset >= this.getTotalContentSize()) return this.itemCount;
        return Math.min(this.itemCount, this.indexAtOffset(offset) + 1);
    }

    private preserveScrollAnchor(updateMeasurements: () => void): void {
        if (!this.viewport) {
            updateMeasurements();
            this.rebuildOffsets();
            return;
        }

        const previousScrollOffset = Math.max(0, this.viewport.measureScrollOffset());
        const anchorIndex = this.indexAtOffset(previousScrollOffset);
        const offsetWithinAnchor = previousScrollOffset - this.offsetAt(anchorIndex);
        updateMeasurements();
        this.rebuildOffsets();
        this.viewport.setTotalContentSize(this.getTotalContentSize());
        const nextScrollOffset = this.offsetAt(anchorIndex) + offsetWithinAnchor;
        if (Math.abs(nextScrollOffset - previousScrollOffset) >= SIZE_EPSILON_PX) {
            this.viewport.scrollToOffset(nextScrollOffset, 'auto');
        }
        this.updateRenderedRange();
    }

    private requirePositive(value: number, name: string): number {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`Variable virtual scroll: ${name} must be greater than zero.`);
        }
        return value;
    }

    private requireNonNegative(value: number, name: string): number {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Variable virtual scroll: ${name} must not be negative.`);
        }
        return value;
    }
}

function variableSizeVirtualScrollStrategyFactory(
    directive: VariableSizeVirtualScrollDirective,
): VariableSizeVirtualScrollStrategy {
    return directive.scrollStrategy;
}

/** Measures rendered rows and feeds their heights into a variable-size strategy. */
@Directive({
    selector: 'cdk-virtual-scroll-viewport[mbVariableSizeVirtualScroll]',
    standalone: true,
    providers: [{
        provide: VIRTUAL_SCROLL_STRATEGY,
        useFactory: variableSizeVirtualScrollStrategyFactory,
        deps: [forwardRef(() => VariableSizeVirtualScrollDirective)],
    }],
})
export class VariableSizeVirtualScrollDirective implements OnDestroy {
    readonly scrollStrategy = new VariableSizeVirtualScrollStrategy();

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly zone = inject(NgZone);
    private readonly measuredRowHeights = new WeakMap<HTMLElement, number>();
    private readonly rowResizeObserver = new ResizeObserver(entries => this.onRowsResized(entries));
    private readonly viewportResizeObserver = new ResizeObserver(entries => this.onViewportResize(entries));
    private readonly mutationObserver = new MutationObserver(records => this.onRowsMutated(records));
    private readonly observedRows = new Set<HTMLElement>();
    private measurementFrame: number | null = null;
    private estimatedItemSizeValue = DEFAULT_ESTIMATED_ITEM_SIZE;
    private minBufferPxValue = DEFAULT_MIN_BUFFER_PX;
    private maxBufferPxValue = DEFAULT_MAX_BUFFER_PX;
    private viewportWidth = 0;
    private destroyed = false;

    @Input({ required: true })
    set mbVariableSizeVirtualScroll(keys: readonly unknown[]) {
        this.scrollStrategy.setDataKeys(keys ?? []);
        this.scheduleMeasurement();
    }

    @Input()
    set estimatedItemSize(value: number) {
        this.estimatedItemSizeValue = value;
        this.updateConfig();
    }

    @Input()
    set minBufferPx(value: number) {
        this.minBufferPxValue = value;
        this.updateConfig();
    }

    @Input()
    set maxBufferPx(value: number) {
        this.maxBufferPxValue = value;
        this.updateConfig();
    }

    constructor() {
        this.zone.runOutsideAngular(() => {
            this.viewportResizeObserver.observe(this.host.nativeElement);
            this.mutationObserver.observe(this.host.nativeElement, { childList: true, subtree: true });
        });
        this.scheduleMeasurement();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        if (this.measurementFrame !== null) cancelAnimationFrame(this.measurementFrame);
        this.measurementFrame = null;
        this.rowResizeObserver.disconnect();
        this.observedRows.clear();
        this.viewportResizeObserver.disconnect();
        this.mutationObserver.disconnect();
    }

    private updateConfig(): void {
        this.scrollStrategy.updateConfig(
            this.estimatedItemSizeValue,
            this.minBufferPxValue,
            this.maxBufferPxValue,
        );
        this.scheduleMeasurement();
    }

    private onViewportResize(entries: ResizeObserverEntry[]): void {
        const width = entries[0]?.contentRect.width ?? this.host.nativeElement.clientWidth;
        if (width > 0 && this.viewportWidth > 0 && Math.abs(width - this.viewportWidth) >= SIZE_EPSILON_PX) {
            this.scrollStrategy.clearMeasurements();
        }
        if (width > 0) this.viewportWidth = width;
        this.scheduleMeasurement();
    }

    private onRowsResized(entries: ResizeObserverEntry[]): void {
        let changed = false;
        for (const entry of entries) {
            const row = entry.target;
            if (!(row instanceof HTMLElement) || !row.classList.contains('variable-virtual-scroll-item')) continue;
            const height = row.getBoundingClientRect().height;
            const previous = this.measuredRowHeights.get(row);
            if (previous !== undefined && Math.abs(previous - height) < SIZE_EPSILON_PX) continue;
            this.measuredRowHeights.set(row, height);
            changed = true;
        }
        if (changed) this.scheduleMeasurement();
    }

    private onRowsMutated(records: MutationRecord[]): void {
        const changesRenderedRows = records.some(record => (
            [...record.addedNodes, ...record.removedNodes].some(node => (
                node instanceof Element
                && (node.classList.contains('variable-virtual-scroll-item')
                    || node.querySelector('.variable-virtual-scroll-item') !== null)
            ))
        ));
        if (changesRenderedRows) this.scheduleMeasurement();
    }

    private scheduleMeasurement(): void {
        if (this.destroyed || this.measurementFrame !== null) return;
        this.measurementFrame = requestAnimationFrame(() => {
            this.measurementFrame = null;
            this.measureRenderedRows();
        });
    }

    private measureRenderedRows(): void {
        const rows = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.variable-virtual-scroll-item'));
        const renderedRows = new Set(rows);
        for (const observedRow of this.observedRows) {
            if (renderedRows.has(observedRow)) continue;
            this.rowResizeObserver.unobserve(observedRow);
            this.observedRows.delete(observedRow);
        }
        for (const row of rows) {
            if (this.observedRows.has(row)) continue;
            this.rowResizeObserver.observe(row);
            this.observedRows.add(row);
        }

        const rangeStart = this.scrollStrategy.getRenderedRange().start;
        this.scrollStrategy.updateItemSizes(rows.map((row, localIndex) => {
            const size = row.getBoundingClientRect().height;
            this.measuredRowHeights.set(row, size);
            return { index: rangeStart + localIndex, size };
        }));
    }
}
