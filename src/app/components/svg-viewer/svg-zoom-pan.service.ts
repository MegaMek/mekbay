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

import { Injectable, ElementRef, signal, WritableSignal, Injector, inject } from '@angular/core';
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

export interface ViewState {
    scale: number;
    translateX: number;
    translateY: number;
}

export interface ZoomPanState {
    scale: number;
    minScale: number;
    maxScale: number;
    translate: { x: number; y: number };
    isPanning: boolean;
    isSwiping: boolean;
    last: { x: number; y: number };
    pointerStart: { x: number; y: number };
    pointerMoved: boolean;
    touchStartDistance: number;
    touchStartScale: number;
    touchCenter: { x: number; y: number };
    prevTouchCenter: { x: number; y: number };
}

export interface SwipeCallbacks {
    onSwipeStart: () => void;
    onSwipeMove: (totalDx: number) => void;
    onSwipeEnd: (totalDx: number) => void;
}

@Injectable()
export class SvgZoomPanService {
    private layoutService = inject(LayoutService);
    private injector = inject(Injector);

    private static readonly NON_INTERACTIVE_SELECTORS = [
        '.pip',
        '.crewSkillButton',
        '.crewNameButton',
        '.critSlot',
        '.critLoc',
        '.armor',
        '#heatScale',
        '.overflowFrame',
        '.overflowButton',
        '.structure',
        '.crewHit',
        '.inventoryEntry'
    ];

    private state: ZoomPanState = {
        scale: 1,
        minScale: 1,
        maxScale: 5,
        translate: { x: 0, y: 0 },
        isPanning: false,
        isSwiping: false,
        last: { x: 0, y: 0 },
        pointerStart: { x: 0, y: 0 },
        pointerMoved: false,
        touchStartDistance: 0,
        touchStartScale: 1,
        touchCenter: { x: 0, y: 0 },
        prevTouchCenter: { x: 0, y: 0 },
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

    getViewState(): ViewState {
        return {
            scale: this.state.scale,
            translateX: this.state.translate.x,
            translateY: this.state.translate.y
        };
    }

    restoreViewState(viewState: ViewState | null) {
        if (viewState && viewState.scale > 0) {
            this.state.scale = viewState.scale;
            this.state.translate.x = viewState.translateX;
            this.state.translate.y = viewState.translateY;
            this.clampPan();
        } else {
            this.resetView();
        }
        this.applyTransform();
    }

    setupEventListeners(svg: SVGSVGElement) {
        // Mouse wheel zoom
        svg.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        // Pointer events for pan
        svg.addEventListener('pointerdown', this.onPointerDown.bind(this));
        svg.addEventListener('pointermove', this.onPointerMove.bind(this));
        svg.addEventListener('pointerup', this.onPointerUp.bind(this));
        svg.addEventListener('pointerleave', this.onPointerUp.bind(this));
        svg.addEventListener('pointercancel', this.onPointerUp.bind(this));

        // Touch events for pinch-zoom
        svg.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        svg.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        svg.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });

        // Double-click to reset view
        svg.addEventListener('dblclick', (event: MouseEvent) => {
            const target = event.target as Element;
            const isInteractiveElement = SvgZoomPanService.NON_INTERACTIVE_SELECTORS.some(selector =>
                target.closest(selector)
            );
            if (!isInteractiveElement) {
                event.preventDefault();
                event.stopPropagation();
                this.resetView();
            }
        });
    }

    private calculateMinScale() {
        const scaleToFitWidth = this.containerDimensions.width / (this.svgDimensions.width + MARGIN_H);
        const scaleToFitHeight = this.containerDimensions.height / (this.svgDimensions.height + MARGIN_V);
        this.state.minScale = Math.max(MIN_SCALE_LIMIT, Math.min(scaleToFitWidth, scaleToFitHeight));
    }

    private centerSvg() {
        const svgWidthWithPadding = this.svgDimensions.width + MARGIN_H;
        const svgHeightWithPadding = this.svgDimensions.height + MARGIN_V;
        const x = (this.containerDimensions.width - svgWidthWithPadding * this.state.scale) / 2;
        const y = (this.containerDimensions.height - svgHeightWithPadding * this.state.scale) / 2;
        this.state.translate.x = Math.max(0, x);
        this.state.translate.y = Math.max(0, y);
    }

    resetView() {
        this.state.scale = this.state.minScale;
        this.centerSvg();
        this.applyTransform();
    }

    handleResize() {
        // Recalculate minimum scale to fit
        if (this.svgDimensions.width && this.svgDimensions.height) {
            this.calculateMinScale();
            // If current scale is below new minimum, adjust it
            if (this.state.scale < this.state.minScale) {
                this.state.scale = this.state.minScale;
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
        let newScale = this.state.scale * scaleAmount;
        newScale = Math.max(this.state.minScale, Math.min(this.state.maxScale, newScale));

        if (newScale === this.state.scale) return;

        this.interactionService.removePicker();

        if (!this._rafPending) {
            this._rafPending = true;
            requestAnimationFrame(() => {
                // Adjust translation so zoom is centered on mouse
                if (newScale !== this.state.scale) {
                    this.state.translate.x = mx - ((mx - this.state.translate.x) * (newScale / this.state.scale));
                    this.state.translate.y = my - ((my - this.state.translate.y) * (newScale / this.state.scale));
                    this.state.scale = newScale;
                }
                this.clampPan();
                this.applyTransform();
                this._rafPending = false;
            });
        }
    }

    private onPointerDown(event: PointerEvent) {
        // if (this.isPickerOpen()) return; // Prevent interaction if picker is open but creates problems with the pickers on pointerdown

        // Prevent panning if the sidebar menu is being dragged
        if (this.layoutService.isMenuDragging()) return;

        if (event.button !== 0) return; // Only handle left button

        const isZoomedOut = this.state.scale <= this.state.minScale * 1.01;
        this.state.isSwiping = isZoomedOut;
        this.state.isPanning = !isZoomedOut;

        this.state.last = { x: event.clientX, y: event.clientY };
        this.state.pointerStart = { x: event.clientX, y: event.clientY };
        this.state.pointerMoved = false;
        this.swipeTotalDx = 0;

        if (this.state.isSwiping) {
            this.swipeCallbacks?.onSwipeStart();
        }

        (event.target as HTMLElement).setPointerCapture(event.pointerId);
    }

    private onPointerMove(event: PointerEvent) {
        if (this.layoutService.isMultiTouch()) {
            this.interactionService.removePicker();
        }

        if (this.isPickerOpen()) return;

        if (this.layoutService.isMenuDragging()) {
            this.state.isPanning = false;
            this.state.isSwiping = false;
            return;
        }

        if (!this.state.isPanning && !this.state.isSwiping) return;
        if (event.buttons !== 1) return; // Only handle left button

        const now = Date.now();
        if (now - this.lastMove < 8) return; // ~120fps throttling
        this.lastMove = now;

        if (this.state.isSwiping) {
            // Full-finger tracking for swipe
            this.swipeTotalDx = event.clientX - this.state.pointerStart.x;
            this.state.last = { x: event.clientX, y: event.clientY };

            // Mark as moved if movement exceeds small threshold
            if (!this.state.pointerMoved) {
                const totalDx = this.swipeTotalDx;
                const totalDy = event.clientY - this.state.pointerStart.y;
                if (Math.abs(totalDx) > 2 || Math.abs(totalDy) > 2) {
                    this.state.pointerMoved = true;
                }
            }

            this.swipeCallbacks?.onSwipeMove(this.swipeTotalDx);
            return;
        }

        // Panning path
        const dx = event.clientX - this.state.last.x;
        const dy = event.clientY - this.state.last.y;
        this.state.last = { x: event.clientX, y: event.clientY };

        this.state.translate.x += dx;
        this.state.translate.y += dy;

        this.clampPan();
        this.applyTransform();

        if (!this.state.pointerMoved) {
            const totalDx = event.clientX - this.state.pointerStart.x;
            const totalDy = event.clientY - this.state.pointerStart.y;
            if (Math.abs(totalDx) > POINTER_MOVE_SENSIBILITY || Math.abs(totalDy) > POINTER_MOVE_SENSIBILITY) {
                this.state.pointerMoved = true;
            }
        }
    }

    private onPointerUp() {
        if (this.state.isSwiping) {
            this.swipeCallbacks?.onSwipeEnd(this.swipeTotalDx);
            this.swipeTotalDx = 0;
        }
        this.state.isPanning = false;
        this.state.isSwiping = false;
    }

    private onTouchStart(event: TouchEvent) {
        // if (this.isPickerOpen()) return;

        // Prevent pinch-zoom if the sidebar menu is being dragged
        if (this.layoutService.isMenuDragging()) return;

        if (event.touches.length === 1) {
            const touch = event.touches[0];
            const isZoomedOut = this.state.scale <= this.state.minScale * 1.01;
            this.state.isSwiping = isZoomedOut;
            this.state.isPanning = !isZoomedOut;
            this.state.last = { x: touch.clientX, y: touch.clientY };
            this.state.pointerStart = { x: touch.clientX, y: touch.clientY };
            this.state.pointerMoved = false;
            this.swipeTotalDx = 0;

            if (this.state.isSwiping) {
                this.swipeCallbacks?.onSwipeStart();
            }
        } else if (event.touches.length === 2) {
            // Initialize pinch zoom
            this.state.isPanning = false;
            this.state.isSwiping = false;
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];

            // Calculate distance between touches
            this.state.touchStartDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );

            this.state.touchStartScale = this.state.scale;

            const container = this.containerRef.nativeElement;
            const rect = container.getBoundingClientRect();
            this.state.touchCenter = {
                x: ((touch1.clientX + touch2.clientX) / 2) - rect.left,
                y: ((touch1.clientY + touch2.clientY) / 2) - rect.top
            };
            this.state.prevTouchCenter = { ...this.state.touchCenter };
        }
    }

    private onTouchMove(event: TouchEvent) {
        if (this.isPickerOpen()) return;

        if (this.layoutService.isMenuDragging()) {
            this.state.isPanning = false;
            this.state.isSwiping = false;
            return;
        }

        const now = Date.now();
        if (now - this.lastMove < 8) return; // ~120fps throttling
        this.lastMove = now;

        if (event.touches.length === 1 && (this.state.isPanning || this.state.isSwiping)) {
            const touch = event.touches[0];

            if (this.state.isSwiping) {
                // Single touch swipe
                this.swipeTotalDx = touch.clientX - this.state.pointerStart.x;
                this.state.last = { x: touch.clientX, y: touch.clientY };

                if (!this.state.pointerMoved) {
                    const totalDx = this.swipeTotalDx;
                    const totalDy = touch.clientY - this.state.pointerStart.y;
                    if (Math.abs(totalDx) > POINTER_MOVE_SENSIBILITY || Math.abs(totalDy) > POINTER_MOVE_SENSIBILITY) {
                        this.state.pointerMoved = true;
                    }
                }

                this.swipeCallbacks?.onSwipeMove(this.swipeTotalDx);
                return;
            }

            // Single touch pan
            const dx = touch.clientX - this.state.last.x;
            const dy = touch.clientY - this.state.last.y;
            this.state.last = { x: touch.clientX, y: touch.clientY };

            if (this.state.isPanning) {
                this.state.translate.x += dx;
                this.state.translate.y += dy;

                this.clampPan();
                this.applyTransform();
            }

            // Mark as moved if movement exceeds threshold
            if (!this.state.pointerMoved) {
                const totalDx = touch.clientX - this.state.pointerStart.x;
                const totalDy = touch.clientY - this.state.pointerStart.y;
                if (Math.abs(totalDx) > POINTER_MOVE_SENSIBILITY || Math.abs(totalDy) > POINTER_MOVE_SENSIBILITY) {
                    this.state.pointerMoved = true;
                }
            }
        } else if (event.touches.length === 2) {
            // Pinch zoom
            this.state.pointerMoved = true;
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];

            const currentDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );

            const scaleChange = currentDistance / this.state.touchStartDistance;
            let newScale = this.state.touchStartScale * scaleChange;
            newScale = Math.max(this.state.minScale, Math.min(this.state.maxScale, newScale));

            // Calculate new center between fingers
            const container = this.containerRef.nativeElement;
            const rect = container.getBoundingClientRect();
            const newTouchCenter = {
                x: ((touch1.clientX + touch2.clientX) / 2) - rect.left,
                y: ((touch1.clientY + touch2.clientY) / 2) - rect.top
            };

            const dx = newTouchCenter.x - this.state.prevTouchCenter.x;
            const dy = newTouchCenter.y - this.state.prevTouchCenter.y;
            this.state.translate.x += dx;
            this.state.translate.y += dy;
            this.state.prevTouchCenter = { ...newTouchCenter };

            if (!this._rafPending) {
                this._rafPending = true;
                requestAnimationFrame(() => {
                    if (newScale !== this.state.scale) {
                        this.state.translate.x = newTouchCenter.x - ((newTouchCenter.x - this.state.translate.x) * (newScale / this.state.scale));
                        this.state.translate.y = newTouchCenter.y - ((newTouchCenter.y - this.state.translate.y) * (newScale / this.state.scale));
                        this.state.scale = newScale;
                    }
                    this.clampPan();
                    this.applyTransform();
                    this._rafPending = false;
                });
            }
        }
    }

    private onTouchEnd(event: TouchEvent) {
        if (event.touches.length === 0) {
            if (this.state.isSwiping) {
                this.swipeCallbacks?.onSwipeEnd(this.swipeTotalDx);
                this.swipeTotalDx = 0;
            }
            this.state.isPanning = false;
            this.state.isSwiping = false;
            this.state.touchStartDistance = 0;
        } else if (event.touches.length === 1) {
            // Transition from pinch to pan
            const touch = event.touches[0];
            const isZoomedOut = this.state.scale <= this.state.minScale * 1.01;
            this.state.isSwiping = isZoomedOut;
            this.state.isPanning = !isZoomedOut;
            this.state.last = { x: touch.clientX, y: touch.clientY };
            this.state.touchStartDistance = 0;

            if (this.state.isSwiping) {
                this.swipeCallbacks?.onSwipeStart();
            }
        }
    }

    // Prevent panning out of bounds
    private clampPan() {
        const scaledWidth = (this.svgDimensions.width + MARGIN_H) * this.state.scale;
        const scaledHeight = (this.svgDimensions.height + MARGIN_V) * this.state.scale;
        const maxX = Math.max(0, (this.containerDimensions.width - scaledWidth) / 2);
        const maxY = Math.max(0, (this.containerDimensions.height - scaledHeight) / 2);
        const minX = this.containerDimensions.width - scaledWidth - maxX;
        const minY = this.containerDimensions.height - scaledHeight - maxY;

        this.state.translate.x = Math.max(minX, Math.min(maxX, this.state.translate.x));
        this.state.translate.y = Math.max(minY, Math.min(maxY, this.state.translate.y));
    }

    private applyTransform() {
        const svg = this.containerRef.nativeElement.querySelector('svg');
        if (svg) {
            (svg as any).style.transform = `translate(${this.state.translate.x}px,${this.state.translate.y}px) scale(${this.state.scale})`;
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
