import { Component, ChangeDetectionStrategy, signal, effect, input, output, inject, viewChild, type ElementRef } from '@angular/core';

import type { Unit } from '../../models/units.model';
import { SheetService } from '../../services/sheet.service';
import { OptionsService } from '../../services/options.service';
import { LoggerService } from '../../services/logger.service';
import { REMOTE_HOST } from '../../models/common.model';

type Point = { x: number; y: number };

type TouchGesture = {
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
    private sheetService = inject(SheetService);
    private optionsService = inject(OptionsService);

    unit = input<Unit | null>(null);
    zoomable = input<boolean>(false);
    zoomPanActiveChange = output<boolean>();

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');

    private svgs = signal<SVGSVGElement[]>([]);
    private svgsAttached = signal(false);
    private scale = 1;
    private zoomPanActive = false;
    private readonly maxScale = 6;
    private readonly zoomEpsilon = 0.001;
    private readonly activePointers = new Map<number, Point>();
    private touchGesture: TouchGesture | null = null;

    // Reactive effect: load sheet when unit changes
    constructor() {
        effect(() => {
            const u = this.unit();
            this.svgs.set([]);
            this.svgsAttached.set(false);
            this.cleanContainer();
            this.resetZoom();

            if (!u || !u.sheets || u.sheets.length === 0) return;

            (async () => {
                try {
                    const svgs: SVGSVGElement[] = [];
                    for (const sheetName of u.sheets) {
                        const svg = await this.sheetService.getSheet(sheetName);
                        const cloned = svg.cloneNode(true) as SVGSVGElement;
                        cloned.removeAttribute('id');
                        svgs.push(cloned);
                    }
                    this.svgs.set([...this.svgs(), ...svgs]);
                    this.cleanContainer();
                    this.attachSvgs();
                } catch (err) {
                    this.logger.error('svg-viewer-lite: failed to load sheet: ' + JSON.stringify(err));
                    this.svgs.set([]);
                }
            })();
        });
        effect(() => {
            if (!this.svgsAttached()) return;
            const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
            const fluffImage = this.unit()?.fluff?.img;
            if (!fluffImage) return; // no fluff image to inject
            if (fluffImage.endsWith('hud.png')) return;
            for (const svg of this.svgs()) {
                if (svg.getElementById('fluff-image')) continue; // already present from the original sheet, we skip
                if (svg.getElementById('fluffImage')) continue; // already present from the original sheet, we skip
                if (centerContent === 'fluffImage') {
                    if (svg.getElementById('fluff-image-injected')) return; // already injected, we skip
                    const fluffImageUrl = `${REMOTE_HOST}/images/fluff/${fluffImage}`;
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

    private attachSvgs() {
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
            this.applyScale();
            this.clampScroll();
            this.svgsAttached.set(true);
        });
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
        if (!this.zoomable() || event.pointerType !== 'touch') return;

        const container = this.containerRef().nativeElement;
        this.activePointers.set(event.pointerId, this.clientPoint(event));
        this.resetTouchGesture();
        this.refreshZoomPanActive();

        try {
            container.setPointerCapture(event.pointerId);
        } catch { /* ignore capture errors */ }

        if (this.isZoomedIn()) {
            this.consumeTouch(event, true);
        }
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.zoomable() || event.pointerType !== 'touch' || !this.activePointers.has(event.pointerId)) return;

        this.activePointers.set(event.pointerId, this.clientPoint(event));

        if (this.activePointers.size > 1) {
            event.preventDefault();
            this.handlePinch();
            return;
        }

        this.handleTouchPan(event);
    };

    private readonly onPointerEnd = (event: PointerEvent): void => {
        if (!this.activePointers.delete(event.pointerId)) return;

        try {
            this.containerRef().nativeElement.releasePointerCapture(event.pointerId);
        } catch { /* ignore release errors */ }

        this.resetTouchGesture();
        this.refreshZoomPanActive();

        if (this.isZoomedIn()) {
            this.consumeTouch(event, true);
        }
    };

    private handlePinch(): void {
        const nextGesture = this.currentTouchGesture();
        if (!nextGesture) return;

        if (!this.touchGesture || this.touchGesture.count < 2) {
            this.touchGesture = nextGesture;
            return;
        }

        const previous = this.touchGesture;
        const container = this.containerRef().nativeElement;
        container.scrollLeft += previous.center.x - nextGesture.center.x;
        container.scrollTop += previous.center.y - nextGesture.center.y;

        if (previous.distance > 0) {
            this.zoomAt(nextGesture.center, this.scale * (nextGesture.distance / previous.distance));
        } else {
            this.clampScroll();
        }

        this.touchGesture = this.currentTouchGesture();
    }

    private handleTouchPan(event: PointerEvent): void {
        const nextGesture = this.currentTouchGesture();
        if (!nextGesture) return;

        if (!this.touchGesture || this.touchGesture.count !== 1) {
            this.touchGesture = nextGesture;
            return;
        }

        const dx = this.touchGesture.center.x - nextGesture.center.x;
        const dy = this.touchGesture.center.y - nextGesture.center.y;
        if (!this.isZoomedIn() && !this.canScrollBy(dx, dy)) {
            this.touchGesture = nextGesture;
            return;
        }

        this.consumeTouch(event, this.isZoomedIn());
        const container = this.containerRef().nativeElement;
        container.scrollLeft += dx;
        container.scrollTop += dy;
        this.clampScroll();
        this.touchGesture = this.currentTouchGesture();
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
        content.getBoundingClientRect();
        container.scrollLeft = contentX * scale + content.offsetLeft - point.x;
        container.scrollTop = contentY * scale + content.offsetTop - point.y;
        this.clampScroll();
        this.refreshZoomPanActive();
    }

    private resetZoom(): void {
        this.scale = 1;
        this.activePointers.clear();
        this.touchGesture = null;
        this.applyScale();

        const container = this.containerRef().nativeElement;
        container.scrollLeft = 0;
        container.scrollTop = 0;
        this.refreshZoomPanActive();
    }

    private applyScale(): void {
        this.contentRef().nativeElement.style.width = `${this.scale * 100}%`;
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

    private resetTouchGesture(): void {
        this.touchGesture = this.currentTouchGesture();
    }

    private currentTouchGesture(): TouchGesture | null {
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

    private refreshZoomPanActive(): void {
        const active = this.zoomable() && (this.isZoomedIn() || this.activePointers.size > 1);
        if (active === this.zoomPanActive) return;

        this.zoomPanActive = active;
        this.zoomPanActiveChange.emit(active);
    }

    private consumeTouch(event: Event, stopPropagation: boolean): void {
        event.preventDefault();
        if (stopPropagation) event.stopPropagation();
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}