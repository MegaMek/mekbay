// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, effect, inject, signal, untracked, type ElementRef } from '@angular/core';

type Point = { x: number; y: number };

type PointerGesture = {
    count: number;
    center: Point;
    distance: number;
};

/** Shared scrolling and zoom gestures for the sheet and card preview surfaces. */
export class SvgViewerZoomPan {
    readonly maxZoomPercent = 300;
    readonly zoomPercent = signal(100);

    private scale = 1;
    private readonly minScale = signal(1);
    private readonly horizontalOverflow = signal(false);
    private readonly maxScale = this.maxZoomPercent / 100;
    private readonly doubleTapZoomScale = 2.5;
    private readonly doubleTapMaxMs = 300;
    private readonly tapMaxDistance = 12;
    private readonly syntheticMouseAfterTouchMs = 800;
    private readonly zoomEpsilon = 0.001;
    private readonly activePointers = new Map<number, Point>();
    private readonly pointerStarts = new Map<number, Point>();
    private lastTap: { time: number; point: Point } | null = null;
    private ignoreMouseDoubleClickUntil = 0;
    private pointerGesture: PointerGesture | null = null;
    private pendingSliderZoomPercent: number | null = null;
    private sliderZoomFrameId: number | null = null;

    constructor(
        private readonly containerRef: () => ElementRef<HTMLDivElement>,
        private readonly contentRef: () => ElementRef<HTMLDivElement>,
        private readonly zoomable: () => boolean,
        private readonly fitMode: () => 'width' | 'page',
        private readonly options: { autoLayout?: boolean } = {},
    ) {
        effect((onCleanup) => {
            const container = this.containerRef().nativeElement;
            container.addEventListener('wheel', this.onWheel, { passive: false });
            container.addEventListener('pointerdown', this.onPointerDown);
            container.addEventListener('pointermove', this.onPointerMove);
            container.addEventListener('pointerup', this.onPointerEnd);
            container.addEventListener('pointercancel', this.onPointerEnd);
            container.addEventListener('dblclick', this.onDoubleClick);

            let resizeFrameId: number | null = null;
            const resizeObserver = typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(() => {
                    if (resizeFrameId !== null) return;
                    resizeFrameId = requestAnimationFrame(() => {
                        resizeFrameId = null;
                        this.refreshLayout();
                    });
                });
            resizeObserver?.observe(container);

            onCleanup(() => {
                container.removeEventListener('wheel', this.onWheel);
                container.removeEventListener('pointerdown', this.onPointerDown);
                container.removeEventListener('pointermove', this.onPointerMove);
                container.removeEventListener('pointerup', this.onPointerEnd);
                container.removeEventListener('pointercancel', this.onPointerEnd);
                container.removeEventListener('dblclick', this.onDoubleClick);
                resizeObserver?.disconnect();
                if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
            });
        });
        effect(() => {
            this.zoomable();
            this.fitMode();
            untracked(() => this.resetZoom());
        });
        inject(DestroyRef).onDestroy(() => this.cancelPendingSliderZoom());
    }

    get minZoomPercent(): number {
        return Math.round(this.minScale() * 100);
    }

    private readonly onWheel = (event: WheelEvent): void => {
        if (!this.zoomable()) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.shiftKey || event.ctrlKey) {
            const delta = this.normalizeWheelDelta(event.deltaY || event.deltaX, event.deltaMode);
            this.panBy(event.shiftKey ? delta : 0, event.shiftKey ? 0 : delta);
            return;
        }

        const delta = this.normalizeWheelDelta(event.deltaY, event.deltaMode);
        this.zoomAt(this.localPoint(event), this.scale * Math.exp(-delta * 0.002));
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (!this.zoomable() || !this.canStartPan(event)) return;

        if (event.pointerType === 'touch' && event.isPrimary && this.activePointers.size > 0) {
            this.clearPointerState();
        }

        const container = this.containerRef().nativeElement;
        this.activePointers.set(event.pointerId, this.clientPoint(event));
        this.pointerStarts.set(event.pointerId, this.clientPoint(event));
        this.resetPointerGesture();

        try {
            container.setPointerCapture(event.pointerId);
        } catch { /* ignore capture errors */ }

        if (this.isZoomPanActive()) {
            this.consumePointer(event, true);
        }
    };

    private clearPointerState(): void {
        this.activePointers.clear();
        this.pointerStarts.clear();
        this.pointerGesture = null;
    }

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.zoomable() || !this.activePointers.has(event.pointerId)) return;

        this.activePointers.set(event.pointerId, this.clientPoint(event));

        if (event.pointerType === 'touch' && this.activePointers.size > 1) {
            event.preventDefault();
            this.handlePinch();
            return;
        }

        this.handlePointerPan(event);
    };

    private readonly onPointerEnd = (event: PointerEvent): void => {
        if (!this.activePointers.has(event.pointerId)) return;

        this.handleTouchTap(event);
        this.activePointers.delete(event.pointerId);
        this.pointerStarts.delete(event.pointerId);

        try {
            this.containerRef().nativeElement.releasePointerCapture(event.pointerId);
        } catch { /* ignore release errors */ }

        this.resetPointerGesture();

        if (this.isZoomPanActive()) {
            this.consumePointer(event, true);
        }
    };

    private readonly onDoubleClick = (event: MouseEvent): void => {
        if (!this.zoomable()) return;

        this.consumePointer(event, true);
        if (Date.now() < this.ignoreMouseDoubleClickUntil) return;

        this.toggleZoomAt(this.localPoint(event));
    };

    private handlePinch(): void {
        const nextGesture = this.currentPointerGesture();
        if (!nextGesture) return;

        if (!this.pointerGesture || this.pointerGesture.count < 2) {
            this.pointerGesture = nextGesture;
            return;
        }

        const previous = this.pointerGesture;
        this.panBy(previous.center.x - nextGesture.center.x, previous.center.y - nextGesture.center.y);

        if (previous.distance > 0) {
            this.zoomAt(nextGesture.center, this.scale * (nextGesture.distance / previous.distance));
        } else {
            this.clampScroll();
        }

        this.pointerGesture = this.currentPointerGesture();
    }

    private handlePointerPan(event: PointerEvent): void {
        const nextGesture = this.currentPointerGesture();
        if (!nextGesture) return;

        if (!this.pointerGesture || this.pointerGesture.count !== 1) {
            this.pointerGesture = nextGesture;
            return;
        }

        const dx = this.pointerGesture.center.x - nextGesture.center.x;
        const dy = this.pointerGesture.center.y - nextGesture.center.y;
        if (!this.isZoomedIn() && !this.canScrollBy(dx, dy)) {
            this.pointerGesture = nextGesture;
            return;
        }

        this.consumePointer(event, this.isZoomPanActive());
        this.panBy(dx, dy);
        this.pointerGesture = this.currentPointerGesture();
    }

    private panBy(dx: number, dy: number): void {
        const container = this.containerRef().nativeElement;
        container.scrollLeft += dx;
        container.scrollTop += dy;
        this.clampScroll();
    }

    private canStartPan(event: PointerEvent): boolean {
        if (event.pointerType === 'touch') return true;
        if (event.pointerType !== 'mouse' || event.button !== 0) return false;

        const container = this.containerRef().nativeElement;
        return this.isZoomedIn()
            || container.scrollHeight > container.clientHeight
            || container.scrollWidth > container.clientWidth;
    }

    private handleTouchTap(event: PointerEvent): void {
        if (event.pointerType !== 'touch' || this.activePointers.size !== 1) return;

        const start = this.pointerStarts.get(event.pointerId);
        if (!start) return;

        const point = this.clientPoint(event);
        if (Math.hypot(point.x - start.x, point.y - start.y) > this.tapMaxDistance) return;

        const now = Date.now();
        const previousTap = this.lastTap;
        const isDoubleTap = previousTap
            && now - previousTap.time <= this.doubleTapMaxMs
            && Math.hypot(point.x - previousTap.point.x, point.y - previousTap.point.y) <= this.tapMaxDistance;

        if (!isDoubleTap) {
            this.lastTap = { time: now, point };
            return;
        }

        this.lastTap = null;
        this.consumePointer(event, true);
        this.ignoreMouseDoubleClickUntil = now + this.syntheticMouseAfterTouchMs;
        this.toggleZoomAt(this.toLocalPoint(point));
    }

    private toggleZoomAt(point: Point): void {
        if (Math.round(this.scale * 100) !== 100) {
            this.resetZoom();
            return;
        }

        this.zoomAt(point, this.doubleTapZoomScale);
    }

    private zoomAt(point: Point, nextScale: number): void {
        const container = this.containerRef().nativeElement;
        const minScale = this.minScale();
        const scale = this.clamp(nextScale, minScale, this.maxScale);
        if (scale === this.scale || (scale > minScale && Math.abs(scale - this.scale) < this.zoomEpsilon)) return;

        const content = this.contentRef().nativeElement;
        const contentX = (container.scrollLeft + point.x - content.offsetLeft) / this.scale;
        const contentY = (container.scrollTop + point.y - content.offsetTop) / this.scale;

        this.scale = scale;
        this.applyScale();
        this.syncZoomPercent();
        content.getBoundingClientRect();
        container.scrollLeft = contentX * this.scale + content.offsetLeft - point.x;
        container.scrollTop = contentY * this.scale + content.offsetTop - point.y;
        this.clampScroll();
    }

    resetZoom(): void {
        this.cancelPendingSliderZoom();
        this.scale = 1;
        this.clearPointerState();
        this.lastTap = null;
        this.refreshLayout();

        const container = this.containerRef().nativeElement;
        container.scrollLeft = 0;
        container.scrollTop = 0;
    }

    setZoomPercent(value: number): void {
        if (!Number.isFinite(value)) return;

        const percent = this.clamp(value, this.minZoomPercent, this.maxZoomPercent);
        this.zoomPercent.set(percent);
        this.pendingSliderZoomPercent = percent;

        if (this.sliderZoomFrameId !== null) return;

        this.sliderZoomFrameId = requestAnimationFrame(() => {
            this.sliderZoomFrameId = null;
            const nextPercent = this.pendingSliderZoomPercent;
            this.pendingSliderZoomPercent = null;
            if (nextPercent === null) return;

            const container = this.containerRef().nativeElement;
            // The slider displays whole percentages, but its minimum must fit the cards exactly.
            const scale = nextPercent === this.minZoomPercent ? this.minScale() : nextPercent / 100;
            this.zoomAt({ x: container.clientWidth / 2, y: container.clientHeight / 2 }, scale);
        });
    }

    private applyScale(): void {
        const content = this.contentRef().nativeElement;
        if (untracked(this.fitMode) === 'page') {
            const container = this.containerRef().nativeElement;
            const svg = content.querySelector('svg');
            const viewBox = svg?.viewBox.baseVal;
            const width = viewBox && viewBox.width > 0 ? viewBox.width : svg?.width.baseVal.value;
            const height = viewBox && viewBox.height > 0 ? viewBox.height : svg?.height.baseVal.value;
            if (width && height && Number.isFinite(width) && Number.isFinite(height)
                && container.clientWidth > 0 && container.clientHeight > 0) {
                // Measure before scrollbars so the minimum stays stable while zooming.
                const style = getComputedStyle(container);
                const viewportWidth = parseFloat(style.width);
                const viewportHeight = parseFloat(style.height);
                let columns = 1;
                if (this.options.autoLayout) {
                    const count = content.children.length;
                    const rowWidth = Math.min(viewportWidth / count, viewportHeight * width / height);
                    const columnWidth = Math.min(viewportWidth, viewportHeight * width / height / count);
                    columns = rowWidth > columnWidth ? count : 1;
                    content.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
                    const singleCardWidth = Math.min(viewportWidth, viewportHeight * width / height);
                    const minScale = Math.max(rowWidth, columnWidth) / singleCardWidth;
                    this.minScale.set(minScale);
                    this.scale = Math.max(this.scale, minScale);
                }
                // clientWidth/Height round fractional pixels up and can create a scrollbar at 100%.
                const fittedWidth = Math.min(
                    viewportWidth - (container.offsetWidth - container.clientWidth),
                    (viewportHeight - (container.offsetHeight - container.clientHeight)) * width / height,
                );
                content.style.width = `${fittedWidth * this.scale * columns}px`;
                return;
            }
        }
        content.style.width = `${this.scale * 100}%`;
    }

    private syncZoomPercent(): void {
        this.zoomPercent.set(Math.round(this.scale * 100));
    }

    private cancelPendingSliderZoom(): void {
        this.pendingSliderZoomPercent = null;
        if (this.sliderZoomFrameId === null) return;

        cancelAnimationFrame(this.sliderZoomFrameId);
        this.sliderZoomFrameId = null;
    }

    refreshLayout(): void {
        this.applyScale();
        this.syncZoomPercent();
        this.clampScroll();
    }

    private clampScroll(): void {
        const container = this.containerRef().nativeElement;
        this.horizontalOverflow.set(container.scrollWidth > container.clientWidth);
        container.scrollLeft = this.clamp(container.scrollLeft, 0, Math.max(0, container.scrollWidth - container.clientWidth));
        container.scrollTop = this.clamp(container.scrollTop, 0, Math.max(0, container.scrollHeight - container.clientHeight));
    }

    private canScrollBy(dx: number, dy: number): boolean {
        const container = this.containerRef().nativeElement;
        const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        return maxLeft > 0 && ((dx < 0 && container.scrollLeft > 0) || (dx > 0 && container.scrollLeft < maxLeft))
            || maxTop > 0 && ((dy < 0 && container.scrollTop > 0) || (dy > 0 && container.scrollTop < maxTop));
    }

    private resetPointerGesture(): void {
        this.pointerGesture = this.currentPointerGesture();
    }

    private currentPointerGesture(): PointerGesture | null {
        const points = Array.from(this.activePointers.values()).slice(0, 2).map((point) => this.toLocalPoint(point));
        if (points.length === 0) return null;
        if (points.length === 1) return { count: 1, center: points[0], distance: 0 };

        const [a, b] = points;
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return { count: this.activePointers.size, center, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }

    private localPoint(event: MouseEvent): Point {
        return this.toLocalPoint(this.clientPoint(event));
    }

    private toLocalPoint(point: Point): Point {
        const rect = this.containerRef().nativeElement.getBoundingClientRect();
        return { x: point.x - rect.left, y: point.y - rect.top };
    }

    private clientPoint(event: MouseEvent): Point {
        return { x: event.clientX, y: event.clientY };
    }

    private normalizeWheelDelta(delta: number, deltaMode: number): number {
        if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
        if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * this.containerRef().nativeElement.clientHeight;
        return delta;
    }

    private isZoomedIn(): boolean {
        return this.scale > 1 + this.zoomEpsilon;
    }

    isZoomPanActive(): boolean {
        return this.zoomable() && (this.zoomPercent() > 100 || this.horizontalOverflow());
    }

    private consumePointer(event: Event, stopPropagation: boolean): void {
        event.preventDefault();
        if (stopPropagation) event.stopPropagation();
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
