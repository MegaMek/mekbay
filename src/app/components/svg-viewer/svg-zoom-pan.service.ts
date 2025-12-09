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

import { Injectable, ElementRef, signal, WritableSignal, Injector, inject, computed, DestroyRef } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { SvgInteractionService } from './svg-interaction.service';

/*
 * Author: Drake
 */
const MIN_SCALE_LIMIT = 0.2;
const MAX_SCALE_LIMIT = 5;
const MARGIN_TOP = 0;
const MARGIN_LEFT = 0;
const MARGIN_BOTTOM = 0;
const MARGIN_RIGHT = 0;
const MARGIN_H = MARGIN_LEFT + MARGIN_RIGHT;
const MARGIN_V = MARGIN_TOP + MARGIN_BOTTOM;
const POINTER_MOVE_SENSIBILITY = 5;
const INITIAL_THRESHOLD = 10;
// Tolerance for floating-point comparisons (0.1% margin)
const SCALE_EPSILON = 1.001;

export interface ViewState {
    scale: number;
    translateX: number;
    translateY: number;
}

export interface ZoomPanState {
    scale: WritableSignal<number>;
    minScale: number;
    maxScale: number;
    translate: WritableSignal<{ x: number; y: number }>;
    isPanning: boolean;
    isSwiping: boolean;
    swipeStarted: boolean;
    last: { x: number; y: number };
    pointerStart: { x: number; y: number };
    pointerMoved: boolean;
    touchStartDistance: number;
    touchStartScale: number;
    touchCenter: { x: number; y: number };
    prevTouchCenter: { x: number; y: number };
    waitingForFirstEvent: boolean;
}

export interface SwipeCallbacks {
    onSwipeStart: () => void;
    onSwipeMove: (totalDx: number) => void;
    onSwipeEnd: (totalDx: number) => void;
}

@Injectable()
export class SvgZoomPanService {
    private readonly SWIPE_THRESHOLD = 10; // px
    private layoutService = inject(LayoutService);
    private injector = inject(Injector);

    private static readonly NON_INTERACTIVE_SELECTORS = [
        '.interactive',
        '.pip',
        '.critSlot',
        '.critLoc',
        '.armor',
        '.structure',
        '.inventoryEntry',
        '.preventZoomReset'
    ];

    private state: ZoomPanState = {
        scale: signal(1),
        minScale: 1,
        maxScale: 5,
        translate: signal({ x: 0, y: 0 }),
        isPanning: false,
        isSwiping: false,
        swipeStarted: false,
        last: { x: 0, y: 0 },
        pointerStart: { x: 0, y: 0 },
        pointerMoved: false,
        touchStartDistance: 0,
        touchStartScale: 1,
        touchCenter: { x: 0, y: 0 },
        prevTouchCenter: { x: 0, y: 0 },
        waitingForFirstEvent: true,
    };

    private containerRef!: ElementRef<HTMLDivElement>;
    private svgDimensions = { width: 0, height: 0 };
    private containerDimensions = { width: 0, height: 0 };
    // Cache the computed minScale to avoid recalculating during gestures
    private cachedMinScale = MIN_SCALE_LIMIT;
    private lastMove = 0;
    private _rafPending = false;
    // Store pending scale for RAF to avoid race conditions
    private _pendingScale: number | null = null;
    private _pendingTouchCenter: { x: number; y: number } | null = null;
    private isPickerOpen: WritableSignal<boolean> = signal(false);
    private interactionService!: SvgInteractionService;
    private swipeCallbacks?: SwipeCallbacks;
    private swipeTotalDx = 0;
    private capturePointerId: number | null = null;
    // Flag to prevent state corruption during active gestures
    private isGestureActive = false;

    // Track active pointers
    private pointers = new Map<number, { x: number; y: number; pointerType?: string }>();

    constructor() { 
        inject(DestroyRef).onDestroy(() => {
            this.cleanupEventListeners();
            const container = this.containerRef.nativeElement;
            container.removeEventListener('wheel', this.onWheel);
            container.removeEventListener('pointerdown', this.onPointerDown);
        });
    }

    initialize(
        containerRef: ElementRef<HTMLDivElement>,
        isPickerOpen: WritableSignal<boolean>,
        swipeCallbacks?: SwipeCallbacks
    ) {
        this.containerRef = containerRef;
        this.isPickerOpen = isPickerOpen;
        this.interactionService = this.injector.get(SvgInteractionService);
        this.swipeCallbacks = swipeCallbacks;
        this.setupEventListeners();
    }

    updateDimensions(
        svgWidth: number,
        svgHeight: number,
        containerWidth: number,
        containerHeight: number
    ) {
        // Validate dimensions to prevent invalid minScale calculations
        if (svgWidth <= 0 || svgHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
            return;
        }
        this.svgDimensions = { width: svgWidth, height: svgHeight };
        this.containerDimensions = { width: containerWidth, height: containerHeight };
        this.calculateMinScale();
    }

    getState(): Readonly<ZoomPanState> {
        return { ...this.state };
    }

    getViewState = computed<ViewState>(() => {
        const translate = this.state.translate();
        return {
            scale: this.state.scale(),
            translateX: translate.x,
            translateY: translate.y
        };
    });

    restoreViewState(viewState: ViewState | null) {
        if (viewState && viewState.scale > 0) {
            // Ensure restored scale is within valid bounds
            const clampedScale = Math.max(this.state.minScale, Math.min(this.state.maxScale, viewState.scale));
            this.state.scale.set(clampedScale);
            this.state.translate.set({ x: viewState.translateX, y: viewState.translateY });
            this.clampPan();
        } else {
            this.resetView();
        }
        this.applyTransform();
    }

    setupEventListeners() {
        const container = this.containerRef.nativeElement;

        // Mouse wheel zoom
        container.addEventListener('wheel', this.onWheel, { passive: false });

        // Pointer events for pan/zoom
        container.addEventListener('pointerdown', this.onPointerDown);
    }

    cleanupEventListeners() {
        const container = this.containerRef.nativeElement;
        container.removeEventListener('pointermove', this.onPointerMove);
        container.removeEventListener('pointerup', this.onPointerUp);
        container.removeEventListener('pointerleave', this.onPointerUp);
        container.removeEventListener('pointercancel', this.onPointerUp);
    }

    private calculateMinScale() {
        // Guard against invalid dimensions
        if (this.svgDimensions.width <= 0 || this.svgDimensions.height <= 0 ||
            this.containerDimensions.width <= 0 || this.containerDimensions.height <= 0) {
            return;
        }
        const scaleToFitWidth = this.containerDimensions.width / (this.svgDimensions.width + MARGIN_H);
        const scaleToFitHeight = this.containerDimensions.height / (this.svgDimensions.height + MARGIN_V);
        const scale = Math.min(scaleToFitWidth, scaleToFitHeight);
        // Ensure minScale is always within valid bounds
        const newMinScale = Math.max(MIN_SCALE_LIMIT, Math.min(MAX_SCALE_LIMIT, scale));
        
        // Only update if not during an active gesture to prevent race conditions
        if (!this.isGestureActive) {
            this.state.minScale = newMinScale;
        }
        // Always cache the computed value for reference
        this.cachedMinScale = newMinScale;
    }

    /**
     * Check if the SVG is fully visible (not zoomed in beyond fit)
     */
    private fullyVisible(): boolean {
        // Use cached minScale to avoid inconsistencies during gestures
        return this.state.scale() <= this.cachedMinScale * SCALE_EPSILON;
    }

    /**
     * Check if at minimum zoom (for swipe detection)
     */
    private isAtMinZoom(): boolean {
        return this.state.scale() <= this.state.minScale * SCALE_EPSILON;
    }

    private centerSvg() {
        const svgWidthWithPadding = this.svgDimensions.width + MARGIN_H;
        const svgHeightWithPadding = this.svgDimensions.height + MARGIN_V;
        const x = (this.containerDimensions.width - svgWidthWithPadding * this.state.scale()) / 2;
        const y = (this.containerDimensions.height - svgHeightWithPadding * this.state.scale()) / 2;
        this.state.translate.set({ x: Math.max(0, x), y: Math.max(0, y) });
    }

    resetView() {
        this.state.scale.set(this.state.minScale);
        this.centerSvg();
        this.applyTransform();
    }

    handleResize() {
        // Don't recalculate during active gestures to prevent race conditions
        if (this.isGestureActive) {
            return;
        }
        
        // Recalculate minimum scale to fit
        if (this.svgDimensions.width > 0 && this.svgDimensions.height > 0 &&
            this.containerDimensions.width > 0 && this.containerDimensions.height > 0) {
            this.calculateMinScale();
            // If current scale is below new minimum, adjust it
            if (this.state.scale() < this.state.minScale) {
                this.state.scale.set(this.state.minScale);
            }
        }

        // Reposition and clamp the SVG to stay within bounds
        this.clampPan();
        this.applyTransform();
    }

    private onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const svg = this.containerRef.nativeElement.querySelector('svg');
        if (!svg) return;

        const mx = event.offsetX;
        const my = event.offsetY;
        const scaleAmount = event.deltaY > 0 ? 0.9 : 1.1;
        let newScale = this.state.scale() * scaleAmount;
        newScale = Math.max(this.state.minScale, Math.min(this.state.maxScale, newScale));

        if (newScale === this.state.scale()) return;

        this.interactionService.removePicker();

        if (!this._rafPending) {
            this._rafPending = true;
            requestAnimationFrame(() => {
                // Adjust translation so zoom is centered on mouse
                if (newScale !== this.state.scale()) {
                    const translate = this.state.translate();
                    const newX = mx - ((mx - translate.x) * (newScale / this.state.scale()));
                    const newY = my - ((my - translate.y) * (newScale / this.state.scale()));
                    this.state.translate.set({ x: newX, y: newY });
                    this.state.scale.set(newScale);
                }
                this.clampPan();
                this.applyTransform();
                this._rafPending = false;
            });
        }
    }

    private cleanup() {
        this.isGestureActive = false;
        if (this.capturePointerId !== null) {
            try {
                this.containerRef.nativeElement.releasePointerCapture(this.capturePointerId);
            } catch (e) { /* ignore */ }
            this.capturePointerId = null;
        }
        this.cleanupEventListeners();
        this.pointers.clear();
        if (this.state.isSwiping && this.state.swipeStarted) {
            this.swipeCallbacks?.onSwipeEnd(this.swipeTotalDx);
        }
        this.state.swipeStarted = false;
        this.swipeTotalDx = 0;
        this.state.isPanning = false;
        this.state.isSwiping = false;
        this.state.pointerMoved = false;
        this.state.waitingForFirstEvent = true;
        this.state.touchStartDistance = 0;
        this.state.touchStartScale = this.state.scale();
        this._pendingScale = null;
        this._pendingTouchCenter = null;
        
        // Sync minScale with cached value after gesture ends
        if (this.cachedMinScale > 0) {
            this.state.minScale = this.cachedMinScale;
        }
        
        // Ensure scale is valid after gesture ends
        this.validateAndClampScale();
    }

    /**
     * Validate current scale and clamp if necessary
     */
    private validateAndClampScale() {
        const currentScale = this.state.scale();
        if (!Number.isFinite(currentScale) || currentScale <= 0) {
            this.state.scale.set(this.state.minScale);
        } else if (currentScale < this.state.minScale) {
            this.state.scale.set(this.state.minScale);
        } else if (currentScale > this.state.maxScale) {
            this.state.scale.set(this.state.maxScale);
        }
        this.clampPan();
        this.applyTransform();
    }

    private onPointerDown = (event: PointerEvent) => {
        if (this.pointers.size >= 2) return; // ignore additional pointers
        // Prevent panning if the sidebar menu is being dragged
        if (this.layoutService.isMenuDragging()) return;

        // Only consider primary button for mouse/pen; touch pointers won't have button
        if (event.pointerType !== 'touch' && event.button !== 0) return;

        // Track pointer
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });

        // If this produces two active pointers, initialize pinch baseline
        if (this.pointers.size === 2) {
            this.isGestureActive = true;
            const entries = Array.from(this.pointers.values());
            const p1 = entries[0];
            const p2 = entries[1];
            
            // Always reinitialize pinch state when second pointer is added
            this.state.touchStartDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            // Capture current scale, ensuring it's valid
            const currentScale = this.state.scale();
            this.state.touchStartScale = Number.isFinite(currentScale) && currentScale > 0 
                ? currentScale 
                : this.state.minScale;
            
            const rect = this.containerRef.nativeElement.getBoundingClientRect();
            this.state.touchCenter = {
                x: ((p1.x + p2.x) / 2) - rect.left,
                y: ((p1.y + p2.y) / 2) - rect.top
            };
            this.state.prevTouchCenter = { ...this.state.touchCenter };
            
            // End any swipe state when transitioning to pinch
            if (this.state.isSwiping && this.state.swipeStarted) {
                this.swipeCallbacks?.onSwipeEnd(0);
            }
            this.state.isPanning = false;
            this.state.isSwiping = false;
            this.state.swipeStarted = false;
            this.swipeTotalDx = 0;
        } else if (this.pointers.size === 1) {
            const container = this.containerRef.nativeElement;
            container.addEventListener('pointermove', this.onPointerMove);
            container.addEventListener('pointerup', this.onPointerUp);
            container.addEventListener('pointerleave', this.onPointerUp);
            container.addEventListener('pointercancel', this.onPointerUp);
            this.state.pointerStart = { x: event.clientX, y: event.clientY };
            this.state.last = { x: event.clientX, y: event.clientY };
            this.state.pointerMoved = false;
            this.state.waitingForFirstEvent = true;
        }
    }

    private onPointerMove = (event: PointerEvent) => {
        if (!this.pointers.has(event.pointerId)) return;
        // Update stored pointer if tracked
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });

        if (!event.isPrimary) {
            this.interactionService.removePicker();
        }

        if (this.isPickerOpen() || this.layoutService.isMenuDragging()) {
            this.cleanup();
            return;
        }

        const now = Date.now();
        if (now - this.lastMove < 8) return; // ~120fps throttling
        this.lastMove = now;

        if (this.state.waitingForFirstEvent) {

            const ps = this.state.pointerStart;
            const dx = event.clientX - ps.x;
            const dy = event.clientY - ps.y;
            if (Math.hypot(dx, dy) <= INITIAL_THRESHOLD) {
                return;
            }

            this.state.waitingForFirstEvent = false;
            this.isGestureActive = true;
            
            try {
                this.containerRef.nativeElement.setPointerCapture(event.pointerId);
                this.capturePointerId = event.pointerId;
            } catch (e) { /* ignore */ }

            // If two active pointers: start pinch (state already initialized in onPointerDown)
            if (this.pointers.size === 2) {
                // Pinch state should already be initialized from onPointerDown
                // Just ensure we're not in swipe/pan mode
                this.state.isPanning = false;
                this.state.isSwiping = false;
                return;
            }

            // Single pointer behavior (mouse or single touch)
            this.state.isSwiping = this.isAtMinZoom();
            this.state.isPanning = !this.fullyVisible();

            this.state.last = { x: event.clientX, y: event.clientY };
            this.state.pointerStart = { x: event.clientX, y: event.clientY };
            this.state.pointerMoved = false;
            this.swipeTotalDx = 0;
            this.state.swipeStarted = false;
            return;
        }

        // If two pointers active -> pinch zoom handling
        if (this.pointers.size === 2) {
            this.handlePinchMove();
            return;
        }

        // Single pointer behavior: panning or swiping
        if (this.pointers.size === 1 && (this.state.isPanning || this.state.isSwiping)) {
            this.handleSinglePointerMove();
        }
    }

    /**
     * Handle pinch zoom gesture
     */
    private handlePinchMove() {
        const entries = Array.from(this.pointers.values());
        if (entries.length !== 2) return;
        
        const p1 = entries[0];
        const p2 = entries[1];

        // Compute current distance and center
        const currentDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        
        // Guard against invalid touchStartDistance
        if (this.state.touchStartDistance <= 0) {
            this.state.touchStartDistance = currentDistance;
            this.state.touchStartScale = this.state.scale();
        }
        
        const scaleChange = currentDistance / this.state.touchStartDistance;
        
        // Guard against invalid scale calculations
        if (!Number.isFinite(scaleChange) || scaleChange <= 0) {
            return;
        }
        
        let newScale = this.state.touchStartScale * scaleChange;
        
        // Clamp to valid range
        newScale = Math.max(this.state.minScale, Math.min(this.state.maxScale, newScale));
        
        // Validate the computed scale
        if (!Number.isFinite(newScale) || newScale <= 0) {
            newScale = this.state.minScale;
        }

        const container = this.containerRef.nativeElement;
        const rect = container.getBoundingClientRect();
        const newTouchCenter = {
            x: ((p1.x + p2.x) / 2) - rect.left,
            y: ((p1.y + p2.y) / 2) - rect.top
        };

        // Update translation for panning during pinch
        const translate = this.state.translate();
        const dx = newTouchCenter.x - this.state.prevTouchCenter.x;
        const dy = newTouchCenter.y - this.state.prevTouchCenter.y;
        this.state.translate.set({ x: translate.x + dx, y: translate.y + dy });
        this.state.prevTouchCenter = { ...newTouchCenter };

        // Store pending values for RAF to avoid race conditions
        this._pendingScale = newScale;
        this._pendingTouchCenter = { ...newTouchCenter };

        // Smooth update via rAF
        if (!this._rafPending) {
            this._rafPending = true;
            requestAnimationFrame(() => {
                const pendingScale = this._pendingScale;
                const pendingCenter = this._pendingTouchCenter;
                
                if (pendingScale !== null && pendingCenter !== null && pendingScale !== this.state.scale()) {
                    const currentScale = this.state.scale();
                    // Guard against division by zero
                    if (currentScale > 0) {
                        const translateInner = this.state.translate();
                        const scaleRatio = pendingScale / currentScale;
                        const newX = pendingCenter.x - ((pendingCenter.x - translateInner.x) * scaleRatio);
                        const newY = pendingCenter.y - ((pendingCenter.y - translateInner.y) * scaleRatio);
                        this.state.translate.set({ x: newX, y: newY });
                    }
                    this.state.scale.set(pendingScale);
                }
                this.clampPan();
                this.applyTransform();
                this._rafPending = false;
            });
        }

        this.state.pointerMoved = true;
    }

    /**
     * Handle single pointer pan/swipe
     */
    private handleSinglePointerMove() {
        const p = Array.from(this.pointers.values())[0];
        if (!p) return;

        if (this.state.isSwiping) {
            if (!this.state.swipeStarted) {
                // Don't start swipe until threshold passed
                if (Math.abs(p.x - this.state.pointerStart.x) >= this.SWIPE_THRESHOLD) {
                    this.state.swipeStarted = true;
                    this.swipeCallbacks?.onSwipeStart();
                    return; 
                }
            }
            if (this.state.swipeStarted) {
                // Single pointer swipe
                this.swipeTotalDx = p.x - this.state.pointerStart.x;
                this.state.last = { x: p.x, y: p.y };

                if (!this.state.pointerMoved) {
                    const totalDx = this.swipeTotalDx;
                    const totalDy = p.y - this.state.pointerStart.y;
                    if (Math.abs(totalDx) > POINTER_MOVE_SENSIBILITY || Math.abs(totalDy) > POINTER_MOVE_SENSIBILITY) {
                        this.state.pointerMoved = true;
                    }
                }

                this.swipeCallbacks?.onSwipeMove(this.swipeTotalDx);
                return;
            }
        }

        // Panning path
        if (this.state.isPanning) {
            const dx = p.x - this.state.last.x;
            const dy = p.y - this.state.last.y;
            this.state.last = { x: p.x, y: p.y };

            const translate = this.state.translate();
            this.state.translate.set({ x: translate.x + dx, y: translate.y + dy });

            this.clampPan();
            this.applyTransform();

            if (!this.state.pointerMoved) {
                const totalDx = p.x - this.state.pointerStart.x;
                const totalDy = p.y - this.state.pointerStart.y;
                if (Math.abs(totalDx) > POINTER_MOVE_SENSIBILITY || Math.abs(totalDy) > POINTER_MOVE_SENSIBILITY) {
                    this.state.pointerMoved = true;
                }
            }
        }
    }


    // Double-tap/click to zoom
    private lastTapTime = 0;
    private lastTapPoint: { x: number; y: number } | null = null;

    private evaluatePossibleZoomReset = ((event: PointerEvent) => {
        if (this.pointerMoved || this.pointers.size > 0) {
            this.lastTapPoint = null;
            return;
        }

        const target = document.elementFromPoint(event.clientX, event.clientY) as Element;
        if (!target) {
            this.lastTapPoint = null;
            return;
        }
        const isInteractiveElement = SvgZoomPanService.NON_INTERACTIVE_SELECTORS.some(selector =>
            target.closest(selector)
        );

        if (isInteractiveElement) {
            this.lastTapPoint = null;
            return;
        }

        const now = Date.now();
        const timeSinceLastTap = now - this.lastTapTime;
        const distanceFromLastTap = this.lastTapPoint
            ? Math.hypot(event.clientX - this.lastTapPoint.x, event.clientY - this.lastTapPoint.y)
            : Infinity;

        // Double-tap/click detected (within 300ms and same target)
        if (timeSinceLastTap < 300 && distanceFromLastTap < 30) {
            event.preventDefault();
            event.stopPropagation();

            const isZoomedOut = this.isAtMinZoom();

            if (isZoomedOut) {
                // Zoom in centered on the tap/click point
                const rect = this.containerRef.nativeElement.getBoundingClientRect();
                const clickX = event.clientX - rect.left;
                const clickY = event.clientY - rect.top;

                const newScale = Math.min(this.state.maxScale, this.state.minScale * 2);
                const currentScale = this.state.scale();
                const translate = this.state.translate();

                // Guard against division by zero
                if (currentScale > 0) {
                    // Calculate new translation to keep the clicked point stationary
                    const scaleRatio = newScale / currentScale;
                    const newX = clickX - ((clickX - translate.x) * scaleRatio);
                    const newY = clickY - ((clickY - translate.y) * scaleRatio);

                    this.state.translate.set({ x: newX, y: newY });
                }
                this.state.scale.set(newScale);
                this.clampPan();
                this.applyTransform();
            } else {
                this.resetView();
            }

            this.lastTapTime = 0;
            this.lastTapPoint = null;
        } else {
            this.lastTapTime = now;
            this.lastTapPoint = { x: event.clientX, y: event.clientY };
        }
    });

    private onPointerUp = (event: PointerEvent) => {
        if (!this.pointers.has(event.pointerId)) return;
        // Remove pointer from tracking
        const hadPointer = this.pointers.delete(event.pointerId);

        this.evaluatePossibleZoomReset(event);

        // If we had two pointers and now one remains: transition from pinch to single-pointer pan/swipe
        if (hadPointer && this.pointers.size === 1) {
            const remaining = Array.from(this.pointers.values())[0];
            
            // Properly reinitialize for single-pointer mode
            this.state.isSwiping = this.isAtMinZoom();
            this.state.isPanning = !this.fullyVisible();
            this.state.last = { x: remaining.x, y: remaining.y };
            this.state.pointerStart = { x: remaining.x, y: remaining.y };
            this.state.touchStartDistance = 0;
            // Reset touchStartScale to current valid scale for potential future pinch
            this.state.touchStartScale = this.state.scale();
            this.swipeTotalDx = 0;
            this.state.swipeStarted = false;
            return;
        }

        // If no pointers remain: finalize
        if (this.pointers.size === 0) {
            this.cleanup();
        }
    }

    // Prevent panning out of bounds
    private clampPan() {
        // Guard against invalid dimensions
        if (this.svgDimensions.width <= 0 || this.svgDimensions.height <= 0 ||
            this.containerDimensions.width <= 0 || this.containerDimensions.height <= 0) {
            return;
        }
        
        const scale = this.state.scale();
        
        // Guard against invalid scale
        if (!Number.isFinite(scale) || scale <= 0) {
            return;
        }
        
        const scaledWidth = (this.svgDimensions.width + MARGIN_H) * scale;
        const scaledHeight = (this.svgDimensions.height + MARGIN_V) * scale;
        const maxX = Math.max(0, (this.containerDimensions.width - scaledWidth) / 2);
        const maxY = Math.max(0, (this.containerDimensions.height - scaledHeight) / 2);
        const minX = this.containerDimensions.width - scaledWidth - maxX;
        const minY = this.containerDimensions.height - scaledHeight - maxY;

        const translate = this.state.translate();
        const clampedX = Math.max(minX, Math.min(maxX, translate.x));
        const clampedY = Math.max(minY, Math.min(maxY, translate.y));
        
        // Only update if values are finite
        if (Number.isFinite(clampedX) && Number.isFinite(clampedY)) {
            this.state.translate.set({ x: clampedX, y: clampedY });
        }
    }

    private applyTransform() {
        if (!this.containerRef) return;
        if (!this.containerRef.nativeElement) return;
        const svg = this.containerRef.nativeElement.querySelector('svg');
        if (svg) {
            const translate = this.state.translate();
            (svg as any).style.transform = `translate(${translate.x}px,${translate.y}px) scale(${this.state.scale()})`;
            (svg as any).style.transformOrigin = 'top left';
        }
    }

    // Getters for interaction service
    get pointerMoved(): boolean {
        return this.state.pointerMoved;
    }

    set pointerMoved(value: boolean) {
        this.state.pointerMoved = value;
    }

    get isPanning(): boolean {
        return this.state.isPanning;
    }

    set isPanning(value: boolean) {
        this.state.isPanning = value;
    }

    get isSwiping(): boolean {
        return this.state.isSwiping;
    }
}
