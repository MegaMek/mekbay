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

import { Injectable, ElementRef, signal, WritableSignal, Injector, inject, computed } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { SvgInteractionService } from './svg-interaction.service';

/*
 * Author: Drake
 */
const MIN_SCALE_LIMIT = 0.5;
const MARGIN_TOP = 0;
const MARGIN_LEFT = 0;
const MARGIN_BOTTOM = 0;
const MARGIN_RIGHT = 0;
const MARGIN_H = MARGIN_LEFT + MARGIN_RIGHT;
const MARGIN_V = MARGIN_TOP + MARGIN_BOTTOM;
const POINTER_MOVE_SENSIBILITY = 5;
const INITIAL_THRESHOLD = 10;

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
    private lastMove = 0;
    private _rafPending = false;
    private isPickerOpen: WritableSignal<boolean> = signal(false);
    private interactionService!: SvgInteractionService;
    private swipeCallbacks?: SwipeCallbacks;
    private swipeTotalDx = 0;
    private capturePointerId: number | null = null;

    // Track active pointers
    private pointers = new Map<number, { x: number; y: number; pointerType?: string }>();

    constructor() { }

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
            this.state.scale.set(viewState.scale);
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
        container.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        // Pointer events for pan/zoom
        container.addEventListener('pointerdown', this.onPointerDown.bind(this));
    }

    cleanupEventListeners() {
        const container = this.containerRef.nativeElement;
        container.removeEventListener('pointermove', this.onPointerMove.bind(this));
        container.removeEventListener('pointerup', this.onPointerUp.bind(this));
        container.removeEventListener('pointerleave', this.onPointerUp.bind(this));
        container.removeEventListener('pointercancel', this.onPointerUp.bind(this));
    }

    private calculateMinScale() {
        const scaleToFitWidth = this.containerDimensions.width / (this.svgDimensions.width + MARGIN_H);
        const scaleToFitHeight = this.containerDimensions.height / (this.svgDimensions.height + MARGIN_V);
        this.state.minScale = Math.max(MIN_SCALE_LIMIT, Math.min(scaleToFitWidth, scaleToFitHeight));
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
        // Recalculate minimum scale to fit
        if (this.svgDimensions.width && this.svgDimensions.height) {
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

    private onWheel(event: WheelEvent) {
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
        if (this.capturePointerId) {
            try {
                this.containerRef.nativeElement.releasePointerCapture(this.capturePointerId);
            } catch (e) { /* ignore */ }
            this.capturePointerId = null;
        }
        this.cleanupEventListeners();
        this.pointers.clear();
        if (this.state.isSwiping) {
            this.swipeCallbacks?.onSwipeEnd(this.swipeTotalDx);
            this.state.swipeStarted = false;
            this.swipeTotalDx = 0;
        }
        this.state.isPanning = false;
        this.state.isSwiping = false;
        this.state.pointerMoved = false;
        this.state.waitingForFirstEvent = true;
        this.state.touchStartDistance = 0;
    }

    private onPointerDown(event: PointerEvent) {
        if (this.pointers.size >= 2) return; // ignore additional pointers
        // Prevent panning if the sidebar menu is being dragged
        if (this.layoutService.isMenuDragging()) return;

        // Only consider primary button for mouse/pen; touch pointers won't have button
        if (event.pointerType !== 'touch' && event.button !== 0) return;

        // Track pointer
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });

        // If this produces two active pointers, initialize pinch baseline so a
        // re-added pointer doesn't reset scale back to the old touchStartScale.
        if (this.pointers.size === 2) {
            if (!this.state.waitingForFirstEvent) { // We are already interacting, we need to reset pinch state
                const entries = Array.from(this.pointers.values());
                const p1 = entries[0];
                const p2 = entries[1];
                this.state.touchStartDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                this.state.touchStartScale = this.state.scale();
                const rect = this.containerRef.nativeElement.getBoundingClientRect();
                this.state.touchCenter = {
                    x: ((p1.x + p2.x) / 2) - rect.left,
                    y: ((p1.y + p2.y) / 2) - rect.top
                };
                this.state.prevTouchCenter = { ...this.state.touchCenter };
            }
        } else
        if (this.pointers.size === 1) {
            const container = this.containerRef.nativeElement;
            container.addEventListener('pointermove', this.onPointerMove.bind(this));
            container.addEventListener('pointerup', this.onPointerUp.bind(this));
            container.addEventListener('pointerleave', this.onPointerUp.bind(this));
            container.addEventListener('pointercancel', this.onPointerUp.bind(this));
            this.state.pointerStart = { x: event.clientX, y: event.clientY };
            this.state.last = { x: event.clientX, y: event.clientY };
            this.state.pointerMoved = false;
            this.state.waitingForFirstEvent = true;
        }
    }

    private onPointerMove(event: PointerEvent) {
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
            try {
                this.containerRef.nativeElement.setPointerCapture(event.pointerId);
                this.capturePointerId = event.pointerId;
            } catch (e) { /* ignore */ }

            // If two active pointers: start pinch
            if (this.pointers.size === 2) {
                // End any swipe state
                if (this.state.isSwiping) {
                    this.swipeTotalDx = 0;
                    this.swipeCallbacks?.onSwipeEnd(this.swipeTotalDx);
                }
                this.state.isPanning = false;
                this.state.isSwiping = false;

                const entries = Array.from(this.pointers.values());
                const p1 = entries[0];
                const p2 = entries[1];
                this.state.touchStartDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                this.state.touchStartScale = this.state.scale();

                const container = this.containerRef.nativeElement;
                const rect = container.getBoundingClientRect();
                this.state.touchCenter = {
                    x: ((p1.x + p2.x) / 2) - rect.left,
                    y: ((p1.y + p2.y) / 2) - rect.top
                };
                this.state.prevTouchCenter = { ...this.state.touchCenter };
                return;
            }

            // Single pointer behavior (mouse or single touch)
            const isZoomedOut = this.state.scale() <= this.state.minScale * 1.01;
            const canSwipe = isZoomedOut; // && (event.pointerType !== 'pen');
            this.state.isSwiping = canSwipe;
            this.state.isPanning = !canSwipe;

            this.state.last = { x: event.clientX, y: event.clientY };
            this.state.pointerStart = { x: event.clientX, y: event.clientY };
            this.state.pointerMoved = false;
            this.swipeTotalDx = 0;
            this.state.swipeStarted = false;
            return;
        }

        // If two pointers active -> pinch zoom handling
        if (this.pointers.size === 2) {
            const entries = Array.from(this.pointers.values());
            const p1 = entries[0];
            const p2 = entries[1];

            // compute current distance and center
            const currentDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const scaleChange = this.state.touchStartDistance > 0 ? (currentDistance / this.state.touchStartDistance) : 1;
            let newScale = this.state.touchStartScale * scaleChange;
            newScale = Math.max(this.state.minScale, Math.min(this.state.maxScale, newScale));

            const container = this.containerRef.nativeElement;
            const rect = container.getBoundingClientRect();
            const newTouchCenter = {
                x: ((p1.x + p2.x) / 2) - rect.left,
                y: ((p1.y + p2.y) / 2) - rect.top
            };

            const translate = this.state.translate();
            const dx = newTouchCenter.x - this.state.prevTouchCenter.x;
            const dy = newTouchCenter.y - this.state.prevTouchCenter.y;
            this.state.translate.set({ x: translate.x + dx, y: translate.y + dy });
            this.state.prevTouchCenter = { ...newTouchCenter };

            // smooth update via rAF
            if (!this._rafPending) {
                this._rafPending = true;
                requestAnimationFrame(() => {
                    if (newScale !== this.state.scale()) {
                        const translateInner = this.state.translate();
                        const newX = newTouchCenter.x - ((newTouchCenter.x - translateInner.x) * (newScale / this.state.scale()));
                        const newY = newTouchCenter.y - ((newTouchCenter.y - translateInner.y) * (newScale / this.state.scale()));
                        this.state.translate.set({ x: newX, y: newY });
                        this.state.scale.set(newScale);
                    }
                    this.clampPan();
                    this.applyTransform();
                    this._rafPending = false;
                });
            }

            this.state.pointerMoved = true;
            return;
        }

        // Single pointer behavior: panning or swiping
        if (this.pointers.size === 1 && (this.state.isPanning || this.state.isSwiping)) {
            const p = Array.from(this.pointers.values())[0];

            if (this.state.isSwiping) {
                if (!this.state.swipeStarted) {
                    if (Math.abs(p.x - this.state.pointerStart.x) < this.SWIPE_THRESHOLD) {
                        return; // don't start swipe until threshold passed
                    }
                    this.state.swipeStarted = true;
                    this.swipeCallbacks?.onSwipeStart();
                }
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

            // Panning path
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
    private lastTapTarget: EventTarget | null = null;
        
    private evaluatePossibleZoomReset = ((event: PointerEvent) => {
        if (this.pointerMoved) return;
        
        const target = document.elementFromPoint(event.clientX, event.clientY) as Element;
        if (!target) return;
        const isInteractiveElement = SvgZoomPanService.NON_INTERACTIVE_SELECTORS.some(selector =>
            target.closest(selector)
        );
        
        if (isInteractiveElement) return;

        const now = Date.now();
        const timeSinceLastTap = now - this.lastTapTime;
        const distanceFromLastTap = this.lastTapPoint
            ? Math.hypot(event.clientX - this.lastTapPoint.x, event.clientY - this.lastTapPoint.y)
            : Infinity;
        
        // Double-tap/click detected (within 300ms and same target)
        if (timeSinceLastTap < 300 && this.lastTapTarget === event.target && distanceFromLastTap < 30) {
            event.preventDefault();
            event.stopPropagation();
            
            const isZoomedOut = this.state.scale() <= this.state.minScale * 1.01;
            
            if (isZoomedOut) {
                // Zoom in centered on the tap/click point
                const rect = this.containerRef.nativeElement.getBoundingClientRect();
                const clickX = event.clientX - rect.left;
                const clickY = event.clientY - rect.top;
                
                const newScale = Math.min(this.state.maxScale, this.state.minScale * 2);
                const translate = this.state.translate();
                
                // Calculate the point in SVG coordinates
                const svgX = (clickX - translate.x) / this.state.scale();
                const svgY = (clickY - translate.y) / this.state.scale();
                
                // Center the clicked SVG point in the viewport
                const newX = (this.containerDimensions.width / 2) - (svgX * newScale);
                const newY = (this.containerDimensions.height / 2) - (svgY * newScale);
                
                this.state.translate.set({ x: newX, y: newY });
                this.state.scale.set(newScale);
                this.clampPan();
                this.applyTransform();
            } else {
                this.resetView();
            }

            this.lastTapTime = 0;
            this.lastTapTarget = null;
            this.lastTapPoint = null;
        } else {
            this.lastTapTime = now;
            this.lastTapTarget = event.target;
            this.lastTapPoint = { x: event.clientX, y: event.clientY };
        }
    });

    private onPointerUp(event: PointerEvent) {
        if (!this.pointers.has(event.pointerId)) return;
        // Remove pointer from tracking
        const hadPointer = this.pointers.delete(event.pointerId);

            
        // If we had two pointers and now one remains: transition from pinch to single-pointer pan/swipe
        if (hadPointer && this.pointers.size === 1) {
            const remaining = Array.from(this.pointers.values())[0];
            const isZoomedOut = this.state.scale() <= this.state.minScale * 1.01;
            const canSwipe = isZoomedOut; // && (remaining.pointerType !== 'pen');
            this.state.isSwiping = canSwipe;
            this.state.isPanning = !canSwipe;
            this.state.last = { x: remaining.x, y: remaining.y };
            this.state.pointerStart = { x: remaining.x, y: remaining.y };
            this.state.touchStartDistance = 0;
            return;
        }

        // If no pointers remain: finalize
        if (this.pointers.size === 0) {
            this.evaluatePossibleZoomReset(event);
            this.cleanup();
        }
    }

    // Prevent panning out of bounds
    private clampPan() {
        const scale = this.state.scale();
        const scaledWidth = (this.svgDimensions.width + MARGIN_H) * scale;
        const scaledHeight = (this.svgDimensions.height + MARGIN_V) * scale;
        const maxX = Math.max(0, (this.containerDimensions.width - scaledWidth) / 2);
        const maxY = Math.max(0, (this.containerDimensions.height - scaledHeight) / 2);
        const minX = this.containerDimensions.width - scaledWidth - maxX;
        const minY = this.containerDimensions.height - scaledHeight - maxY;

        const translate = this.state.translate();
        const clampedX = Math.max(minX, Math.min(maxX, translate.x));
        const clampedY = Math.max(minY, Math.min(maxY, translate.y));
        this.state.translate.set({ x: clampedX, y: clampedY });
    }

    private applyTransform() {
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
