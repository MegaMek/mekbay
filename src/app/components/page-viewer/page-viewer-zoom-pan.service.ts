/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import {
    Injectable,
    ElementRef,
    signal,
    WritableSignal,
    computed,
    DestroyRef,
    inject
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';

/*
 * Author: Drake
 * 
 * PageViewerZoomPanService - Manages zoom/pan interactions for a multi-page SVG viewer.
 * 
 * Features:
 * - Pan/zoom support (mouse wheel + touch pinch)
 * - Auto-fit content on start (minimum zoom = fit-to-view)
 * - Swipe navigation between pages when fully zoomed out
 * - Multi-page side-by-side view when viewport allows
 */

// Letter page dimensions in points (8.5 x 11 inches at 72 DPI)
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const PAGE_GAP = 20; // Gap between pages in multi-page view

const MIN_SCALE_ABSOLUTE = 0.1;
const MAX_SCALE = 5;
const POINTER_MOVE_THRESHOLD = 5;
const SWIPE_THRESHOLD = 10;
const DOUBLE_TAP_DELAY = 300;
const DOUBLE_TAP_DISTANCE = 30;

export interface ViewState {
    scale: number;
    translateX: number;
    translateY: number;
}

export interface PageDimensions {
    width: number;
    height: number;
}

export interface SwipeCallbacks {
    onSwipeStart: () => void;
    onSwipeMove: (totalDx: number) => void;
    onSwipeEnd: (totalDx: number, velocity: number) => void;
}

export interface NonInteractiveSelectors {
    selectors: string[];
}

@Injectable()
export class PageViewerZoomPanService {
    private layoutService = inject(LayoutService);

    // Core state signals
    readonly scale = signal(1);
    readonly translate = signal({ x: 0, y: 0 });
    readonly minScale = signal(1);
    readonly visiblePageCount = signal(1);
    
    // Actual number of pages currently displayed (may be less than visiblePageCount)
    private actualDisplayedPages = signal(1);

    // Computed view state for external consumers
    readonly viewState = computed<ViewState>(() => ({
        scale: this.scale(),
        translateX: this.translate().x,
        translateY: this.translate().y
    }));

    // Computed: whether the content is fully visible (at min zoom)
    readonly isFullyVisible = computed(() => this.scale() <= this.minScale() * 1.001);

    // Computed: how many pages can fit side-by-side at current zoom
    readonly pagesVisibleAtCurrentZoom = computed(() => {
        const containerWidth = this.containerDimensions.width;
        if (containerWidth <= 0) return 1;
        const scaledPageWidth = PAGE_WIDTH * this.scale();
        return Math.max(1, Math.floor((containerWidth + PAGE_GAP) / (scaledPageWidth + PAGE_GAP)));
    });

    /**
     * Get state object compatible with SvgZoomPanService interface.
     * Used by overlay components that need access to transform state.
     */
    getState(): { scale: () => number; translate: () => { x: number; y: number } } {
        return {
            scale: () => this.scale(),
            translate: () => this.translate()
        };
    }

    private maxScale = MAX_SCALE;
    private containerRef!: ElementRef<HTMLDivElement>;
    private contentRef!: ElementRef<HTMLDivElement>;
    private containerDimensions = { width: 0, height: 0 };
    private totalPages = 1;
    private nonInteractiveSelectors: string[] = [];
    private spaceEvenly = false;

    // Pointer tracking
    private pointers = new Map<number, { x: number; y: number }>();
    private capturedPointerId: number | null = null;

    // Gesture state
    private gestureState = {
        isPanning: false,
        isSwiping: false,
        swipeStarted: false,
        pointerStart: { x: 0, y: 0 },
        pointerLast: { x: 0, y: 0 },
        pointerMoved: false,
        waitingForFirstMove: true,
        // Pinch zoom state
        pinchStartDistance: 0,
        pinchStartScale: 1,
        pinchCenter: { x: 0, y: 0 },
        pinchPrevCenter: { x: 0, y: 0 }
    };

    // Swipe state
    private swipeCallbacks?: SwipeCallbacks;
    private swipeTotalDx = 0;
    private swipeVelocityTracker = {
        lastTimestamp: 0,
        lastDx: 0,
        velocity: 0
    };

    // Double-tap detection
    private doubleTapState = {
        lastTapTime: 0,
        lastTapPoint: null as { x: number; y: number } | null
    };

    // RAF throttling
    private rafPending = false;

    // Event listeners bound to this
    private boundOnWheel = this.onWheel.bind(this);
    private boundOnPointerDown = this.onPointerDown.bind(this);
    private boundOnPointerMove = this.onPointerMove.bind(this);
    private boundOnPointerUp = this.onPointerUp.bind(this);

    constructor() {
        inject(DestroyRef).onDestroy(() => this.cleanup());
    }

    /**
     * Initialize the zoom/pan service with DOM references
     */
    initialize(
        containerRef: ElementRef<HTMLDivElement>,
        contentRef: ElementRef<HTMLDivElement>,
        swipeCallbacks?: SwipeCallbacks,
        nonInteractiveSelectors?: NonInteractiveSelectors,
        spaceEvenly = false
    ): void {
        this.containerRef = containerRef;
        this.contentRef = contentRef;
        this.swipeCallbacks = swipeCallbacks;
        this.nonInteractiveSelectors = nonInteractiveSelectors?.selectors ?? [];
        this.spaceEvenly = spaceEvenly;
        this.setupEventListeners();
    }

    /**
     * Update dimensions when container or content changes
     */
    updateDimensions(containerWidth: number, containerHeight: number, pageCount: number): void {
        if (containerWidth <= 0 || containerHeight <= 0) return;

        this.containerDimensions = { width: containerWidth, height: containerHeight };
        this.totalPages = Math.max(1, pageCount);

        this.calculateMinScaleAndVisiblePages();
    }

    /**
     * Set the actual number of pages being displayed (for centering)
     */
    setDisplayedPages(count: number): void {
        this.actualDisplayedPages.set(Math.max(1, count));
    }

    /**
     * Calculate page positions for rendering.
     * When spaceEvenly is true, distributes pages with equal gaps including edges.
     * When spaceEvenly is false (default), centers pages as a group with PAGE_GAP between them.
     * Returns array of x positions for each page (in unscaled content coordinates, starting from 0).
     * The centering is handled by the translate transform, not by the page positions.
     */
    getPagePositions(pageCount: number): number[] {
        if (pageCount <= 0) return [];

        if (pageCount === 1) {
            // Single page starts at 0
            return [0];
        }

        if (this.spaceEvenly) {
            // Space-evenly at min scale: calculate positions that will be evenly spaced
            const scale = this.minScale();
            const containerWidth = this.containerDimensions.width;
            const scaledPageWidth = PAGE_WIDTH * scale;
            const totalPagesWidth = scaledPageWidth * pageCount;
            const remainingSpace = containerWidth - totalPagesWidth;
            const gapCount = pageCount + 1;
            const gapSize = remainingSpace / gapCount;

            const positions: number[] = [];
            for (let i = 0; i < pageCount; i++) {
                // Calculate position relative to where a centered group would start
                const containerX = gapSize * (i + 1) + scaledPageWidth * i;
                // Convert to unscaled coordinates relative to content origin
                const totalWidth = scaledPageWidth * pageCount + gapSize * (pageCount - 1);
                const groupStartX = (containerWidth - totalWidth) / 2;
                positions.push((containerX - groupStartX) / scale);
            }
            return positions;
        } else {
            // Standard: pages in a row with PAGE_GAP between them, starting from 0
            const positions: number[] = [];
            for (let i = 0; i < pageCount; i++) {
                positions.push(i * (PAGE_WIDTH + PAGE_GAP));
            }
            return positions;
        }
    }

    /**
     * @deprecated Use getPagePositions instead
     */
    getSpaceEvenlyPositions(pageCount: number): number[] {
        return this.getPagePositions(pageCount);
    }

    /**
     * Calculate the minimum scale to fit content and how many pages are visible
     */
    private calculateMinScaleAndVisiblePages(): void {
        const { width: containerWidth, height: containerHeight } = this.containerDimensions;
        if (containerWidth <= 0 || containerHeight <= 0) return;

        // Calculate the scale needed to fit the page height in the container
        const scaleToFitHeight = containerHeight / PAGE_HEIGHT;
        
        // At this scale, how wide is one page?
        const scaledPageWidth = PAGE_WIDTH * scaleToFitHeight;
        const scaledGap = PAGE_GAP * scaleToFitHeight;
        
        // How many pages could fit side-by-side at this scale?
        const pagesAtFitScale = Math.floor((containerWidth + scaledGap) / (scaledPageWidth + scaledGap));
        const maxPagesVisible = Math.min(Math.max(1, pagesAtFitScale), this.totalPages);

        // Calculate min scale to fit at least one page
        const scaleToFitWidth = containerWidth / PAGE_WIDTH;
        const fitScale = Math.min(scaleToFitWidth, scaleToFitHeight);

        // Determine optimal visible page count and corresponding scale
        let optimalPages = 1;
        let optimalScale = fitScale;

        // Check if we can fit multiple pages while still fitting in height
        // Start from max possible pages and work down
        for (let pages = maxPagesVisible; pages >= 1; pages--) {
            const totalWidth = pages * PAGE_WIDTH + (pages - 1) * PAGE_GAP;
            const scaleForWidth = containerWidth / totalWidth;
            const scaleForHeight = containerHeight / PAGE_HEIGHT;
            const scale = Math.min(scaleForWidth, scaleForHeight);

            if (scale >= MIN_SCALE_ABSOLUTE) {
                optimalPages = pages;
                optimalScale = scale;
                break;
            }
        }

        this.visiblePageCount.set(optimalPages);
        this.minScale.set(Math.max(MIN_SCALE_ABSOLUTE, optimalScale));

        // Ensure current scale isn't below minimum
        if (this.scale() < this.minScale()) {
            this.scale.set(this.minScale());
            this.centerContent();
        }
    }

    /**
     * Reset view to fit content (autofit)
     */
    resetView(): void {
        this.scale.set(this.minScale());
        this.centerContent();
        this.applyTransform();
    }

    /**
     * Restore a previously saved view state
     */
    restoreViewState(viewState: ViewState | null): void {
        if (viewState && viewState.scale > 0) {
            const clampedScale = Math.max(this.minScale(), Math.min(this.maxScale, viewState.scale));
            this.scale.set(clampedScale);
            this.translate.set({ x: viewState.translateX, y: viewState.translateY });
            this.clampPan();
        } else {
            this.resetView();
        }
        this.applyTransform();
    }

    /**
     * Handle container resize
     */
    handleResize(): void {
        const container = this.containerRef?.nativeElement;
        if (!container) return;

        this.containerDimensions = {
            width: container.clientWidth,
            height: container.clientHeight
        };

        this.calculateMinScaleAndVisiblePages();

        // Adjust scale if below minimum
        if (this.scale() < this.minScale()) {
            this.scale.set(this.minScale());
        }

        this.clampPan();
        this.applyTransform();
    }

    // ========== Event Handling ==========

    private setupEventListeners(): void {
        const container = this.containerRef.nativeElement;
        container.addEventListener('wheel', this.boundOnWheel, { passive: false });
        container.addEventListener('pointerdown', this.boundOnPointerDown);
    }

    private addMoveListeners(): void {
        const container = this.containerRef.nativeElement;
        container.addEventListener('pointermove', this.boundOnPointerMove);
        container.addEventListener('pointerup', this.boundOnPointerUp);
        container.addEventListener('pointerleave', this.boundOnPointerUp);
        container.addEventListener('pointercancel', this.boundOnPointerUp);
    }

    private removeMoveListeners(): void {
        const container = this.containerRef.nativeElement;
        container.removeEventListener('pointermove', this.boundOnPointerMove);
        container.removeEventListener('pointerup', this.boundOnPointerUp);
        container.removeEventListener('pointerleave', this.boundOnPointerUp);
        container.removeEventListener('pointercancel', this.boundOnPointerUp);
    }

    private cleanup(): void {
        const container = this.containerRef?.nativeElement;
        if (!container) return;

        container.removeEventListener('wheel', this.boundOnWheel);
        container.removeEventListener('pointerdown', this.boundOnPointerDown);
        this.removeMoveListeners();

        if (this.capturedPointerId !== null) {
            try {
                container.releasePointerCapture(this.capturedPointerId);
            } catch { /* ignore */ }
        }
    }

    // ========== Mouse Wheel Zoom ==========

    private onWheel(event: WheelEvent): void {
        event.preventDefault();

        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        let newScale = this.scale() * zoomFactor;
        newScale = Math.max(this.minScale(), Math.min(this.maxScale, newScale));

        if (newScale === this.scale()) return;

        // Zoom centered on mouse position
        const rect = this.containerRef.nativeElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        this.zoomToPoint(mouseX, mouseY, newScale);
    }

    /**
     * Zoom to a specific scale, keeping a point stationary
     */
    private zoomToPoint(pointX: number, pointY: number, newScale: number): void {
        const currentScale = this.scale();
        if (currentScale <= 0 || newScale <= 0) return;

        const translate = this.translate();
        const scaleRatio = newScale / currentScale;

        const newX = pointX - (pointX - translate.x) * scaleRatio;
        const newY = pointY - (pointY - translate.y) * scaleRatio;

        this.translate.set({ x: newX, y: newY });
        this.scale.set(newScale);
        this.clampPan();
        this.applyTransform();
    }

    // ========== Pointer Events ==========

    private onPointerDown(event: PointerEvent): void {
        // Ignore if we already have 2 pointers
        if (this.pointers.size >= 2) return;

        // Ignore if menu is being dragged
        if (this.layoutService.isMenuDragging()) return;

        // Only primary button for mouse
        if (event.pointerType !== 'touch' && event.button !== 0) return;

        // Track this pointer
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (this.pointers.size === 2) {
            // Two pointers: initialize pinch zoom
            this.initializePinch();
        } else if (this.pointers.size === 1) {
            // Single pointer: prepare for pan/swipe
            this.addMoveListeners();
            this.gestureState.pointerStart = { x: event.clientX, y: event.clientY };
            this.gestureState.pointerLast = { x: event.clientX, y: event.clientY };
            this.gestureState.pointerMoved = false;
            this.gestureState.waitingForFirstMove = true;
        }
    }

    private onPointerMove(event: PointerEvent): void {
        if (!this.pointers.has(event.pointerId)) return;

        // Update pointer position
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        // Ignore if menu is dragging
        if (this.layoutService.isMenuDragging()) {
            this.resetGestureState();
            return;
        }

        // Handle first movement detection
        if (this.gestureState.waitingForFirstMove) {
            const dx = event.clientX - this.gestureState.pointerStart.x;
            const dy = event.clientY - this.gestureState.pointerStart.y;

            if (Math.hypot(dx, dy) < POINTER_MOVE_THRESHOLD) {
                return;
            }

            this.gestureState.waitingForFirstMove = false;

            // Capture pointer
            try {
                this.containerRef.nativeElement.setPointerCapture(event.pointerId);
                this.capturedPointerId = event.pointerId;
            } catch { /* ignore */ }

            // Determine gesture type
            if (this.pointers.size === 2) {
                // Already in pinch mode
                return;
            }

            // Decide: swipe or pan based on zoom level and gesture direction
            const isAtMinZoom = this.isFullyVisible();
            const isHorizontalGesture = Math.abs(dx) > Math.abs(dy);
            
            // Swipe only allowed when at min zoom AND gesture is horizontal
            // Vertical gestures at min zoom should be ignored (no scroll, no pan)
            this.gestureState.isSwiping = isAtMinZoom && isHorizontalGesture;
            this.gestureState.isPanning = !isAtMinZoom;

            this.gestureState.pointerLast = { x: event.clientX, y: event.clientY };
            this.swipeTotalDx = 0;
            this.gestureState.swipeStarted = false;
            return;
        }

        // Two-pointer pinch
        if (this.pointers.size === 2) {
            this.handlePinchMove();
            return;
        }

        // Single pointer: pan or swipe
        this.handleSinglePointerMove(event);
    }

    private onPointerUp(event: PointerEvent): void {
        if (!this.pointers.has(event.pointerId)) return;

        // Handle double-tap detection before cleanup
        this.checkDoubleTap(event);

        // Remove pointer
        this.pointers.delete(event.pointerId);

        // If one pointer remains after having two: transition to single-pointer mode
        if (this.pointers.size === 1) {
            const remaining = Array.from(this.pointers.values())[0];
            this.gestureState.isSwiping = this.isFullyVisible();
            this.gestureState.isPanning = !this.isFullyVisible();
            this.gestureState.pointerLast = { x: remaining.x, y: remaining.y };
            this.gestureState.pointerStart = { x: remaining.x, y: remaining.y };
            this.gestureState.pinchStartDistance = 0;
            this.swipeTotalDx = 0;
            this.gestureState.swipeStarted = false;
            return;
        }

        // No pointers remain: finalize
        if (this.pointers.size === 0) {
            this.finalizeGesture();
        }
    }

    // ========== Pinch Zoom ==========

    private initializePinch(): void {
        const entries = Array.from(this.pointers.values());
        const p1 = entries[0];
        const p2 = entries[1];

        this.gestureState.pinchStartDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        this.gestureState.pinchStartScale = this.scale();

        const rect = this.containerRef.nativeElement.getBoundingClientRect();
        this.gestureState.pinchCenter = {
            x: (p1.x + p2.x) / 2 - rect.left,
            y: (p1.y + p2.y) / 2 - rect.top
        };
        this.gestureState.pinchPrevCenter = { ...this.gestureState.pinchCenter };

        // End any swipe when transitioning to pinch
        if (this.gestureState.isSwiping && this.gestureState.swipeStarted) {
            this.swipeCallbacks?.onSwipeEnd(0, 0);
        }

        this.gestureState.isPanning = false;
        this.gestureState.isSwiping = false;
        this.gestureState.swipeStarted = false;
        this.swipeTotalDx = 0;
    }

    private handlePinchMove(): void {
        const entries = Array.from(this.pointers.values());
        if (entries.length !== 2) return;

        const p1 = entries[0];
        const p2 = entries[1];

        const currentDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);

        if (this.gestureState.pinchStartDistance <= 0) {
            this.gestureState.pinchStartDistance = currentDistance;
            this.gestureState.pinchStartScale = this.scale();
        }

        const scaleChange = currentDistance / this.gestureState.pinchStartDistance;
        if (!Number.isFinite(scaleChange) || scaleChange <= 0) return;

        let newScale = this.gestureState.pinchStartScale * scaleChange;
        newScale = Math.max(this.minScale(), Math.min(this.maxScale, newScale));

        const rect = this.containerRef.nativeElement.getBoundingClientRect();
        const newCenter = {
            x: (p1.x + p2.x) / 2 - rect.left,
            y: (p1.y + p2.y) / 2 - rect.top
        };

        // Apply pan movement during pinch
        const translate = this.translate();
        const dx = newCenter.x - this.gestureState.pinchPrevCenter.x;
        const dy = newCenter.y - this.gestureState.pinchPrevCenter.y;
        this.translate.set({ x: translate.x + dx, y: translate.y + dy });
        this.gestureState.pinchPrevCenter = { ...newCenter };

        // Apply zoom centered on pinch center
        if (!this.rafPending) {
            this.rafPending = true;
            requestAnimationFrame(() => {
                if (newScale !== this.scale()) {
                    this.zoomToPoint(newCenter.x, newCenter.y, newScale);
                }
                this.rafPending = false;
            });
        }

        this.gestureState.pointerMoved = true;
    }

    // ========== Single Pointer Pan/Swipe ==========

    private handleSinglePointerMove(event: PointerEvent): void {
        const px = event.clientX;
        const py = event.clientY;

        if (this.gestureState.isSwiping) {
            this.handleSwipeMove(px);
        } else if (this.gestureState.isPanning) {
            this.handlePanMove(px, py);
        }

        this.gestureState.pointerLast = { x: px, y: py };
    }

    private handleSwipeMove(px: number): void {
        if (!this.gestureState.swipeStarted) {
            // Check if we've passed the swipe threshold
            if (Math.abs(px - this.gestureState.pointerStart.x) >= SWIPE_THRESHOLD) {
                this.gestureState.swipeStarted = true;
                this.swipeVelocityTracker.lastTimestamp = performance.now();
                this.swipeVelocityTracker.lastDx = 0;
                this.swipeCallbacks?.onSwipeStart();
            }
            return;
        }

        // Update swipe position and velocity
        const now = performance.now();
        const dt = Math.max(1, now - this.swipeVelocityTracker.lastTimestamp) / 1000;
        this.swipeTotalDx = px - this.gestureState.pointerStart.x;

        const dxDelta = this.swipeTotalDx - this.swipeVelocityTracker.lastDx;
        this.swipeVelocityTracker.velocity = dxDelta / dt;
        this.swipeVelocityTracker.lastDx = this.swipeTotalDx;
        this.swipeVelocityTracker.lastTimestamp = now;

        this.swipeCallbacks?.onSwipeMove(this.swipeTotalDx);

        if (!this.gestureState.pointerMoved) {
            if (Math.abs(this.swipeTotalDx) > POINTER_MOVE_THRESHOLD) {
                this.gestureState.pointerMoved = true;
            }
        }
    }

    private handlePanMove(px: number, py: number): void {
        const dx = px - this.gestureState.pointerLast.x;
        const dy = py - this.gestureState.pointerLast.y;

        const translate = this.translate();
        this.translate.set({ x: translate.x + dx, y: translate.y + dy });

        this.clampPan();
        this.applyTransform();

        if (!this.gestureState.pointerMoved) {
            const totalDx = px - this.gestureState.pointerStart.x;
            const totalDy = py - this.gestureState.pointerStart.y;
            if (Math.abs(totalDx) > POINTER_MOVE_THRESHOLD || Math.abs(totalDy) > POINTER_MOVE_THRESHOLD) {
                this.gestureState.pointerMoved = true;
            }
        }
    }

    // ========== Double-tap Zoom ==========

    private checkDoubleTap(event: PointerEvent): void {
        if (this.gestureState.pointerMoved || this.pointers.size > 1) {
            this.doubleTapState.lastTapPoint = null;
            return;
        }

        // Check if tapping on an interactive element
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target && this.nonInteractiveSelectors.length > 0) {
            const isInteractive = this.nonInteractiveSelectors.some(selector =>
                target.closest(selector)
            );
            if (isInteractive) {
                this.doubleTapState.lastTapPoint = null;
                return;
            }
        }

        // Only allow double-tap zoom when tapping on a page (not empty space or shadow pages)
        const pageWrapper = target?.closest('.page-wrapper');
        if (!pageWrapper || pageWrapper.classList.contains('shadow-page')) {
            this.doubleTapState.lastTapPoint = null;
            return;
        }

        const now = Date.now();
        const timeSinceLastTap = now - this.doubleTapState.lastTapTime;
        const distanceFromLastTap = this.doubleTapState.lastTapPoint
            ? Math.hypot(
                event.clientX - this.doubleTapState.lastTapPoint.x,
                event.clientY - this.doubleTapState.lastTapPoint.y
            )
            : Infinity;

        if (timeSinceLastTap < DOUBLE_TAP_DELAY && distanceFromLastTap < DOUBLE_TAP_DISTANCE) {
            // Double-tap detected
            event.preventDefault();
            event.stopPropagation();

            const rect = this.containerRef.nativeElement.getBoundingClientRect();
            const tapX = event.clientX - rect.left;
            const tapY = event.clientY - rect.top;

            if (this.isFullyVisible()) {
                // Zoom in to 2x minimum
                const newScale = Math.min(this.maxScale, this.minScale() * 2);
                this.zoomToPoint(tapX, tapY, newScale);
            } else {
                // Zoom out to fit
                this.resetView();
            }

            this.doubleTapState.lastTapTime = 0;
            this.doubleTapState.lastTapPoint = null;
        } else {
            this.doubleTapState.lastTapTime = now;
            this.doubleTapState.lastTapPoint = { x: event.clientX, y: event.clientY };
        }
    }

    // ========== Gesture Finalization ==========

    private resetGestureState(): void {
        this.gestureState.isPanning = false;
        this.gestureState.isSwiping = false;
        this.gestureState.swipeStarted = false;
        this.gestureState.pointerMoved = false;
        this.gestureState.waitingForFirstMove = true;
        this.gestureState.pinchStartDistance = 0;
        this.swipeTotalDx = 0;
        this.pointers.clear();

        if (this.capturedPointerId !== null) {
            try {
                this.containerRef.nativeElement.releasePointerCapture(this.capturedPointerId);
            } catch { /* ignore */ }
            this.capturedPointerId = null;
        }

        this.removeMoveListeners();
    }

    private finalizeGesture(): void {
        // Notify swipe end if swiping
        if (this.gestureState.isSwiping && this.gestureState.swipeStarted) {
            this.swipeCallbacks?.onSwipeEnd(this.swipeTotalDx, this.swipeVelocityTracker.velocity);
        }

        this.resetGestureState();
    }

    // ========== Pan Clamping ==========

    private clampPan(): void {
        const scale = this.scale();
        if (!Number.isFinite(scale) || scale <= 0) return;

        const { width: containerWidth, height: containerHeight } = this.containerDimensions;
        if (containerWidth <= 0 || containerHeight <= 0) return;

        const displayedPages = this.actualDisplayedPages();
        
        // Calculate content dimensions (content starts at 0,0 in content space)
        const contentWidth = displayedPages === 1 
            ? PAGE_WIDTH * scale 
            : (displayedPages * PAGE_WIDTH + (displayedPages - 1) * PAGE_GAP) * scale;
        const contentHeight = PAGE_HEIGHT * scale;

        // Calculate pan bounds
        let minX: number, maxX: number;
        
        if (contentWidth <= containerWidth) {
            // Content fits horizontally - center it
            const centerX = (containerWidth - contentWidth) / 2;
            minX = maxX = centerX;
        } else {
            // Content wider than container - allow panning
            // maxX: left edge of content at left edge of container (content at x=0)
            // minX: right edge of content at right edge of container
            minX = containerWidth - contentWidth;
            maxX = 0;
        }
        
        let minY: number, maxY: number;
        if (contentHeight <= containerHeight) {
            // Content fits vertically - center it
            const centerY = (containerHeight - contentHeight) / 2;
            minY = maxY = centerY;
        } else {
            // Content taller than container - allow panning
            minY = containerHeight - contentHeight;
            maxY = 0;
        }

        const translate = this.translate();
        const clampedX = Math.max(minX, Math.min(maxX, translate.x));
        const clampedY = Math.max(minY, Math.min(maxY, translate.y));

        if (Number.isFinite(clampedX) && Number.isFinite(clampedY)) {
            this.translate.set({ x: clampedX, y: clampedY });
        }
    }

    /**
     * Center the content within the container.
     * Content width is based on actual displayed pages.
     */
    private centerContent(): void {
        const scale = this.scale();
        const displayedPages = this.actualDisplayedPages();
        
        // Calculate content dimensions
        const contentWidth = displayedPages === 1 
            ? PAGE_WIDTH * scale 
            : (displayedPages * PAGE_WIDTH + (displayedPages - 1) * PAGE_GAP) * scale;
        const contentHeight = PAGE_HEIGHT * scale;

        // Center horizontally
        const x = (this.containerDimensions.width - contentWidth) / 2;
        // Center vertically
        const y = (this.containerDimensions.height - contentHeight) / 2;

        this.translate.set({ 
            x: Math.max(0, x), 
            y: Math.max(0, y) 
        });
    }

    /**
     * Apply the current transform to the content element
     * Scale is applied directly to each root SVG element to prevent iOS Safari
     * from rendering SVGs blurry when scaling a parent container.
     * Translation is applied to the content container.
     * Note: Only root SVGs are scaled, not nested SVGs within them.
     */
    private applyTransform(): void {
        const content = this.contentRef?.nativeElement;
        if (!content) return;

        const translate = this.translate();
        const scale = this.scale();

        // Apply only translation to content container (no scale)
        content.style.transform = `translate(${translate.x}px, ${translate.y}px)`;
        content.style.transformOrigin = 'top left';

        // Apply scale directly to each root SVG element (direct children of page-wrappers)
        // This fixes iOS blurry rendering without double-scaling nested SVGs
        const pageWrappers = content.querySelectorAll('.page-wrapper') as NodeListOf<HTMLElement>;
        pageWrappers.forEach((wrapper: HTMLElement) => {
            // Get the original left position (unscaled)
            const originalLeft = parseFloat(wrapper.dataset['originalLeft'] || wrapper.style.left) || 0;
            // Store original left if not already stored
            if (!wrapper.dataset['originalLeft']) {
                wrapper.dataset['originalLeft'] = String(originalLeft);
            }
            // Apply scaled position
            wrapper.style.left = `${originalLeft * scale}px`;
            wrapper.style.width = `${PAGE_WIDTH * scale}px`;
            wrapper.style.height = `${PAGE_HEIGHT * scale}px`;
            
            // Scale only the direct SVG child (not nested SVGs)
            const rootSvg = wrapper.querySelector(':scope > svg') as SVGSVGElement;
            if (rootSvg) {
                rootSvg.style.transform = `scale(${scale})`;
                rootSvg.style.transformOrigin = 'top left';
            }
        });

        // Also scale canvas overlays if present
        const canvasOverlays = content.querySelectorAll('page-canvas-overlay') as NodeListOf<HTMLElement>;
        canvasOverlays.forEach((overlay: HTMLElement) => {
            const originalLeft = parseFloat(overlay.dataset['originalLeft'] || overlay.style.left) || 0;
            if (!overlay.dataset['originalLeft']) {
                overlay.dataset['originalLeft'] = String(originalLeft);
            }
            overlay.style.left = `${originalLeft * scale}px`;
            overlay.style.width = `${PAGE_WIDTH * scale}px`;
            overlay.style.height = `${PAGE_HEIGHT * scale}px`;
        });
    }

    /**
     * Public method to apply the current transform.
     * Used after dynamically adding elements that need to be scaled.
     */
    applyCurrentTransform(): void {
        this.applyTransform();
    }

    // ========== Public Getters ==========

    get pointerMoved(): boolean {
        return this.gestureState.pointerMoved;
    }

    set pointerMoved(value: boolean) {
        this.gestureState.pointerMoved = value;
    }

    get isPanning(): boolean {
        return this.gestureState.isPanning;
    }

    set isPanning(value: boolean) {
        this.gestureState.isPanning = value;
    }

    get isSwiping(): boolean {
        return this.gestureState.isSwiping;
    }
}
