import { Component, ChangeDetectionStrategy, DestroyRef, signal, effect, input, inject, viewChild, computed, type ElementRef } from '@angular/core';

import type { Unit } from '../../models/units.model';
import { SheetService } from '../../services/sheet.service';
import { OptionsService } from '../../services/options.service';
import { LoggerService } from '../../services/logger.service';
import { getUnitServerHost } from '../../models/common.model';
import { SvgExportUtil } from '../../utils/svg-export.util';

type Point = { x: number; y: number };

type PointerGesture = {
    count: number;
    center: Point;
    distance: number;
};

@Component({
    selector: 'svg-viewer-lite',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './svg-viewer-lite.component.html',
    styleUrls: ['./svg-viewer-lite.component.css']
})
export class SvgViewerLiteComponent {
    logger = inject(LoggerService);
    private destroyRef = inject(DestroyRef);
    private sheetService = inject(SheetService);
    private optionsService = inject(OptionsService);

    unit = input<Unit | null>(null);
    zoomable = input<boolean>(false);
    hasProjectedContent = input<boolean>(false);
    exportSvgs = input<readonly SVGSVGElement[]>([]);
    exportFileName = input<string | null>(null);
    contentBaseWidth = input<number | null>(null);
    centerContent = input<boolean>(false);

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');

    readonly minZoomPercent = input(100);
    readonly maxZoomPercent = input(300);
    readonly zoomPercent = signal(100);

    private svgs = signal<SVGSVGElement[]>([]);
    private readonly exportTargets = computed(() => {
        const projectedSvgs = this.exportSvgs();
        return projectedSvgs.length > 0 ? [...projectedSvgs] : this.svgs();
    });
    private svgsAttached = signal(false);
    private scale = 1;
    private get maxScale(): number {
        return this.maxZoomPercent() / 100;
    }
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
    private sheetLoadGeneration = 0;

    // Reactive effect: load sheet when unit changes
    constructor() {
        effect((onCleanup) => {
            const loadGeneration = ++this.sheetLoadGeneration;
            onCleanup(() => {
                if (this.sheetLoadGeneration === loadGeneration) {
                    this.sheetLoadGeneration += 1;
                }
            });

            const u = this.unit();
            if (this.hasProjectedContent()) {
                this.svgs.set([]);
                this.svgsAttached.set(true);
                this.resetZoom();
                return;
            }

            this.svgs.set([]);
            this.svgsAttached.set(false);
            this.cleanContainer();
            this.resetZoom();

            if (!u || !u.sheets || u.sheets.length === 0) return;

            (async () => {
                try {
                    const svgs: SVGSVGElement[] = [];
                    for (const sheetName of u.sheets) {
                        const svg = await this.sheetService.getSheet(sheetName, u.serverHost);
                        if (!this.isCurrentSheetLoad(loadGeneration)) return;

                        const cloned = svg.cloneNode(true) as SVGSVGElement;
                        cloned.removeAttribute('id');
                        svgs.push(cloned);
                    }
                    if (!this.isCurrentSheetLoad(loadGeneration)) return;

                    this.svgs.set(svgs);
                    this.cleanContainer();
                    this.attachSvgs(loadGeneration);
                } catch (err) {
                    if (!this.isCurrentSheetLoad(loadGeneration)) return;

                    this.logger.error('svg-viewer-lite: failed to load sheet: ' + JSON.stringify(err));
                    this.svgs.set([]);
                }
            })();
        });
        effect(() => {
            if (!this.svgsAttached()) return;
            const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
            const u = this.unit();
            const fluffImage = u?.fluff?.img;
            if (!fluffImage) return; // no fluff image to inject
            if (fluffImage.endsWith('hud.png')) return;
            for (const svg of this.svgs()) {
                if (svg.getElementById('fluff-image')) continue; // already present from the original sheet, we skip
                if (svg.getElementById('fluffImage')) continue; // already present from the original sheet, we skip
                if (centerContent === 'fluffImage') {
                    if (svg.getElementById('fluff-image-injected')) return; // already injected, we skip
                    const fluffImageUrl = `${getUnitServerHost(u)}/images/fluff/${fluffImage}`;
                    this.injectFluffToSvg(svg, fluffImageUrl);
                } else {
                    svg.getElementById('fluff-image-injected')?.remove();
                    svg.querySelectorAll<SVGGraphicsElement>('.referenceTable').forEach((rt) => {
                        rt.style.display = 'block';
                    });
                }
            }
        });
        effect((onCleanup) => {
            const container = this.containerRef().nativeElement;
            container.addEventListener('wheel', this.onWheel, { passive: false });
            container.addEventListener('pointerdown', this.onPointerDown);
            container.addEventListener('pointermove', this.onPointerMove);
            container.addEventListener('pointerup', this.onPointerEnd);
            container.addEventListener('pointercancel', this.onPointerEnd);
            container.addEventListener('dblclick', this.onDoubleClick);

            const resizeObserver = typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(() => this.onResize());
            resizeObserver?.observe(container);

            onCleanup(() => {
                container.removeEventListener('wheel', this.onWheel);
                container.removeEventListener('pointerdown', this.onPointerDown);
                container.removeEventListener('pointermove', this.onPointerMove);
                container.removeEventListener('pointerup', this.onPointerEnd);
                container.removeEventListener('pointercancel', this.onPointerEnd);
                container.removeEventListener('dblclick', this.onDoubleClick);
                resizeObserver?.disconnect();
            });
        });
        effect(() => {
            if (!this.zoomable()) {
                this.resetZoom();
                return;
            }

            this.applyScale();
            this.clampScroll();
        });
        this.destroyRef.onDestroy(() => this.cancelPendingSliderZoom());
    }

    private injectFluffToSvg(svg: SVGSVGElement, imageUrl: string) {
        const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
        if (referenceTables.length === 0) return; // We don't have a place where to put the fluff image
        // We calculate the width/height using all the reference tables and also the top/left most position
        
        const pt = svg.createSVGPoint();
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let topLeftElement: SVGGraphicsElement = referenceTables[0];
        referenceTables.forEach((rt: SVGGraphicsElement) => {
            const bbox = rt.getBBox();
            const ctm = rt.getCTM() ?? svg.getCTM() ?? new DOMMatrix();
            const corners = [
                { x: bbox.x, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y },
                { x: bbox.x, y: bbox.y + bbox.height },
                { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
            ];
            let rtMinX = Number.POSITIVE_INFINITY;
            let rtMinY = Number.POSITIVE_INFINITY;
            let rtMaxX = Number.NEGATIVE_INFINITY;
            let rtMaxY = Number.NEGATIVE_INFINITY;
            for (const c of corners) {
                pt.x = c.x; pt.y = c.y;
                const p = pt.matrixTransform(ctm);
                rtMinX = Math.min(rtMinX, p.x);
                rtMinY = Math.min(rtMinY, p.y);
                rtMaxX = Math.max(rtMaxX, p.x);
                rtMaxY = Math.max(rtMaxY, p.y);
            }

            minX = Math.min(minX, rtMinX);
            minY = Math.min(minY, rtMinY);
            maxX = Math.max(maxX, rtMaxX);
            maxY = Math.max(maxY, rtMaxY);
        });
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;
        // Determine parent to inject into (parent of top/left most referenceTable if available)
        let injectParent: ParentNode = svg;
        if (topLeftElement?.parentElement) {
            injectParent = topLeftElement.parentElement;
        }
        const parentCTM = (injectParent as any).getCTM ? (injectParent as SVGGraphicsElement).getCTM() : null;
        const invParent = parentCTM ? parentCTM.inverse() : new DOMMatrix();
        pt.x = minX; pt.y = minY;
        const localTL = pt.matrixTransform(invParent);
        pt.x = maxX; pt.y = maxY;
        const localBR = pt.matrixTransform(invParent);

        const localWidth = localBR.x - localTL.x;
        const localHeight = localBR.y - localTL.y;
        // We create an image element
        const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('id', 'fluff-image-injected');
        img.setAttribute('href', imageUrl);
        img.setAttribute('x', localTL.x.toString());
        img.setAttribute('y', localTL.y.toString());
        img.setAttribute('width', Math.max(0, localWidth).toString());
        img.setAttribute('height', Math.max(0, localHeight).toString());
        injectParent.appendChild(img);
        // We hide the reference tables
        referenceTables.forEach((rt) => {
            rt.style.display = 'none';
        });
    }

    private cleanContainer() {
        const content = this.contentRef().nativeElement;
        while (content.firstChild) content.removeChild(content.firstChild);
        this.svgsAttached.set(false);
    }

    private attachSvgs(loadGeneration: number) {
        if (!this.isCurrentSheetLoad(loadGeneration)) return;

        const svgs = this.svgs();
        if (!svgs || svgs.length === 0) return;
        const content = this.contentRef().nativeElement;
        for (const s of svgs) {
            s.classList.add('mekbay-sheet');
            s.style.pointerEvents = 'none';
            s.style.display = 'block';
            s.style.width = '100%';
            s.style.height = 'auto';
            content.appendChild(s);
        }        
        requestAnimationFrame(() => {
            if (!this.isCurrentSheetLoad(loadGeneration)) return;

            this.applyScale();
            this.clampScroll();
            this.svgsAttached.set(true);
        });
    }

    private isCurrentSheetLoad(loadGeneration: number): boolean {
        return loadGeneration === this.sheetLoadGeneration;
    }

    private readonly onWheel = (event: WheelEvent): void => {
        if (!this.zoomable()) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.ctrlKey) {
            const delta = this.normalizeWheelDelta(event.deltaY, event.deltaMode);
            this.zoomAt(this.localPoint(event), this.scale * Math.exp(-delta * 0.002));
            return;
        }

        const container = this.containerRef().nativeElement;
        if (event.shiftKey) {
            container.scrollLeft += this.normalizeWheelDelta(event.deltaX || event.deltaY, event.deltaMode);
        } else {
            container.scrollTop += this.normalizeWheelDelta(event.deltaY, event.deltaMode);
        }
        this.clampScroll();
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

        if (this.isZoomedIn()) {
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

        if (this.isZoomedIn()) {
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
        if (previous.distance <= 0) {
            this.pointerGesture = nextGesture;
            return;
        }

        const nextScale = this.clamp(this.scale * (nextGesture.distance / previous.distance), 1, this.maxScale);
        if (Math.abs(nextScale - this.scale) < this.zoomEpsilon) {
            this.pointerGesture = nextGesture;
            return;
        }

        this.panBy(previous.center.x - nextGesture.center.x, previous.center.y - nextGesture.center.y);
        this.zoomAt(nextGesture.center, nextScale);
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

        this.consumePointer(event, this.isZoomedIn());
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
        if (this.isZoomedIn()) {
            this.resetZoom();
            return;
        }

        this.zoomAt(point, this.doubleTapZoomScale);
    }

    private zoomAt(point: Point, nextScale: number): void {
        const container = this.containerRef().nativeElement;
        const scale = this.clamp(nextScale, 1, this.maxScale);
        if (Math.abs(scale - this.scale) < this.zoomEpsilon) return;

        const content = this.contentRef().nativeElement;
        const contentX = (container.scrollLeft + point.x - content.offsetLeft) / this.scale;
        const contentY = (container.scrollTop + point.y - content.offsetTop) / this.scale;

        this.scale = scale;
        this.applyScale();
        this.syncZoomPercent();
        content.getBoundingClientRect();
        container.scrollLeft = contentX * scale + content.offsetLeft - point.x;
        container.scrollTop = contentY * scale + content.offsetTop - point.y;
        this.clampScroll();
    }

    resetZoom(): void {
        this.cancelPendingSliderZoom();
        this.scale = 1;
        this.clearPointerState();
        this.lastTap = null;
        this.applyScale();
        this.syncZoomPercent();

        const container = this.containerRef().nativeElement;
        container.scrollLeft = 0;
        container.scrollTop = 0;
    }

    setZoomPercent(value: number): void {
        if (!Number.isFinite(value)) return;

        const percent = this.clamp(value, this.minZoomPercent(), this.maxZoomPercent());
        this.zoomPercent.set(percent);
        this.pendingSliderZoomPercent = percent;

        if (this.sliderZoomFrameId !== null) return;

        this.sliderZoomFrameId = requestAnimationFrame(() => {
            this.sliderZoomFrameId = null;
            const nextPercent = this.pendingSliderZoomPercent;
            this.pendingSliderZoomPercent = null;
            if (nextPercent === null) return;

            const container = this.containerRef().nativeElement;
            this.zoomAt({ x: container.clientWidth / 2, y: container.clientHeight / 2 }, nextPercent / 100);
        });
    }

    async downloadPng(): Promise<void> {
        try {
            await SvgExportUtil.downloadPng(this.exportTargets(), this.getExportFileName());
        } catch (err) {
            this.logger.error('svg-viewer-lite: failed to download PNG: ' + JSON.stringify(err));
        }
    }
    
    async openPng(): Promise<void> {
        try {
            await SvgExportUtil.openPng(this.exportTargets());
        } catch (err) {
            this.logger.error('svg-viewer-lite: failed to open PNG: ' + JSON.stringify(err));
        }
    }
    
    async copyPngToClipboard(): Promise<void> {
        try {
            await SvgExportUtil.copyPngToClipboard(this.exportTargets(), this.getExportFileName());
        } catch (err) {
            this.logger.error('svg-viewer-lite: failed to copy PNG to clipboard: ' + JSON.stringify(err));
            throw err;
        }
    }

    private applyScale(): void {
        const content = this.contentRef().nativeElement;
        const baseWidth = this.contentBaseWidth();
        if (baseWidth && baseWidth > 0) {
            const availableWidth = this.containerRef().nativeElement.clientWidth;
            content.style.width = `${Math.min(availableWidth, baseWidth) * this.scale}px`;
            return;
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

    private onResize(): void {
        this.applyScale();
        this.clampScroll();
    }

    private clampScroll(): void {
        const container = this.containerRef().nativeElement;
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
        return this.zoomable() && this.isZoomedIn();
    }

    private consumePointer(event: Event, stopPropagation: boolean): void {
        event.preventDefault();
        if (stopPropagation) event.stopPropagation();
    }

    private getExportFileName(): string {
        const explicitFileName = this.exportFileName();
        if (explicitFileName) {
            return explicitFileName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'record-sheet';
        }

        const unit = this.unit();
        const name = [unit?.chassis, unit?.model].filter(Boolean).join('-') || unit?.name || 'record-sheet';
        return name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'record-sheet';
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}