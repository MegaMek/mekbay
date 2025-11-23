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

import { Directive, ElementRef, output, input, inject, effect, Renderer2, signal, DestroyRef } from '@angular/core';

export type SwipeDirection = 'horizontal' | 'vertical' | 'both';

export interface SwipeStartEvent {
    originalEvent: PointerEvent;
    startX: number;
    startY: number;
}

export interface SwipeMoveEvent {
    originalEvent: PointerEvent;
    deltaX: number;
    deltaY: number;
    distance: number;
    direction: 'left' | 'right' | 'up' | 'down';
}

export interface SwipeEndEvent {
    originalEvent: PointerEvent;
    deltaX: number;
    deltaY: number;
    distance: number;
    direction: 'left' | 'right' | 'up' | 'down';
    success: boolean;
    velocity: number;
}

@Directive({
    selector: '[swipe]',
    standalone: true,
})
export class SwipeDirective {
    private readonly elRef = inject(ElementRef<HTMLElement>);
    private readonly renderer = inject(Renderer2);

    // Inputs
    readonly direction = input<SwipeDirection>('both');
    readonly threshold = input<number>(15); // pixels
    readonly successRatio = input<number>(0.5); // 50% of container dimension
    readonly velocityMultiplier = input<number>(2.4); // velocity multiplier for success calculation ( 0 = disabled )
    readonly shouldBlockSwipe = input<(() => boolean) | undefined>(undefined);
    readonly minimumVelocity = input<number>(0.4); // pixels per ms
    readonly dragDimensions = input<(() => number) | undefined>(undefined);

    // Outputs
    readonly swipestart = output<SwipeStartEvent>();
    readonly swipemove = output<SwipeMoveEvent>();
    readonly swipeend = output<SwipeEndEvent>();
    readonly swipecancel = output<void>();
    readonly swiperatio = output<number>();

    // state
    readonly swiping = signal<boolean>(false);


    // Internal state
    private activePointerId: number | null = null;
    private startX = 0;
    private startY = 0;
    private startTime = 0;
    private currentX = 0;
    private currentY = 0;
    private pointerCaptured = false;
    private swipeAxis: 'horizontal' | 'vertical' | null = null;
    readonly swipeRatio = signal(0);

    // Cleanup functions
    private unlistenMove?: () => void;
    private unlistenUp?: () => void;
    private unlistenCancel?: () => void;

    constructor() {
        // Set up pointer down listener
        effect((onCleanup) => {
            const unlisten = this.renderer.listen(
                this.elRef.nativeElement,
                'pointerdown',
                (event: PointerEvent) => this.onPointerDown(event)
            );
            onCleanup(() => unlisten());
        });
        inject(DestroyRef).onDestroy(() => {
            this.cleanup();
        });
    }

    /**
     * Programmatically start a swipe gesture from an external pointer event.
     * This allows parent components to initiate swipes from edge zones or other triggers.
     * 
     * @param event The PointerEvent that should initiate the swipe
     * @returns boolean indicating if the swipe was started successfully
     */
    public startSwipe(event: PointerEvent): boolean {
        if (event.pointerType === 'mouse') {
            // Ignore mouse pointers
            return false;
        }

        // Check if already swiping
        if (this.activePointerId !== null) {
            return false;
        }

        // Check blocking condition
        const blockFn = this.shouldBlockSwipe();
        if (blockFn && blockFn()) {
            return false;
        }

        // Check primary pointer
        if (event.isPrimary === false) {
            return false;
        }

        // Initialize swipe state
        this.activePointerId = event.pointerId;
        this.startX = event.clientX;
        this.startY = event.clientY;
        this.currentX = event.clientX;
        this.currentY = event.clientY;
        this.startTime = Date.now();
        this.pointerCaptured = false;
        this.swipeAxis = null;

        // Set up global listeners for move/up/cancel
        this.unlistenMove = this.renderer.listen('window', 'pointermove', (e: PointerEvent) =>
            this.onPointerMove(e)
        );
        this.unlistenUp = this.renderer.listen('window', 'pointerup', (e: PointerEvent) =>
            this.onPointerUp(e)
        );
        this.unlistenCancel = this.renderer.listen('window', 'pointercancel', (e: PointerEvent) =>
            this.onPointerCancel(e)
        );

        return true;
    }

    private onPointerDown(event: PointerEvent): void {
        this.startSwipe(event);
    }

    private onPointerMove(event: PointerEvent): void {
        if (event.pointerId !== this.activePointerId) {
            return;
        }

        const blockFn = this.shouldBlockSwipe();
        if (blockFn && blockFn()) {
            this.cancelGesture();
            return;
        }

        this.currentX = event.clientX;
        this.currentY = event.clientY;

        const deltaX = this.currentX - this.startX;
        const deltaY = this.currentY - this.startY;
        // Check if threshold reached and decide gesture direction
        if (!this.swipeAxis) {
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distance < this.threshold()) {
                return;
            }


            const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
            const directionSetting = this.direction();

            if (directionSetting === 'horizontal' && !isHorizontal) {
                this.cancelGesture();
                return;
            }

            if (directionSetting === 'vertical' && isHorizontal) {
                this.cancelGesture();
                return;
            }
            this.swipeAxis = isHorizontal ? 'horizontal' : 'vertical';

            try {
                this.elRef.nativeElement.setPointerCapture(this.activePointerId);
                this.pointerCaptured = true;
            } catch {
                // Ignore capture errors
            }
            this.swiping.set(true);
            this.swipestart.emit({
                originalEvent: event,
                startX: this.startX,
                startY: this.startY,
            });
        }

        // Emit move events for valid gestures
        if (this.swipeAxis) {
            this.renderer.addClass(this.elRef.nativeElement, 'swiping');
            const isHorizontal = this.swipeAxis === 'horizontal';
            const delta = isHorizontal ? deltaX : deltaY;
            const distance = Math.abs(delta);
            const direction = this.getSwipeDirection(delta, isHorizontal);
            const ratio = this.calculateSwipeRatio(delta, isHorizontal);

            // Calculate and emit ratio
            this.swipeRatio.set(ratio);
            this.swiperatio.emit(ratio);

            this.swipemove.emit({
                originalEvent: event,
                deltaX,
                deltaY,
                distance,
                direction,
            });
        }
    }

    private calculateSwipeRatio(delta: number, isHorizontal: boolean): number {
        const getDimFn = this.dragDimensions();
        let containerDimension: number;

        if (getDimFn) {
            containerDimension = getDimFn();
        } else {
            const rect = this.elRef.nativeElement.getBoundingClientRect();
            containerDimension = isHorizontal ? rect.width : rect.height;
        }

        // Return signed ratio (can be negative for backwards swipe, or > 1 for over-swipe)
        const ratio = delta / containerDimension;

        // Clamp between -1 and 2 to allow some over-swipe but prevent extreme values
        return Math.max(-1, Math.min(2, ratio));
    }

    private onPointerUp(event: PointerEvent): void {
        if (event.pointerId !== this.activePointerId) {
            return;
        }

        if (this.swipeAxis) {
            const deltaX = this.currentX - this.startX;
            const deltaY = this.currentY - this.startY;
            
            const isHorizontal = this.swipeAxis === 'horizontal';
            const delta = isHorizontal ? deltaX : deltaY;
            const distance = Math.abs(delta);
            const direction = this.getSwipeDirection(delta, isHorizontal);
            
            // Calculate velocity (pixels per millisecond)
            const duration = Date.now() - this.startTime;
            const velocity = duration > 0 ? distance / duration : 0;

            // Determine success
            const success = this.isSwipeSuccessful(deltaX, isHorizontal, velocity);
            this.swipeend.emit({
                originalEvent: event,
                deltaX,
                deltaY,
                distance,
                direction,
                success,
                velocity,
            });
        }

        this.cleanup();
    }

    private onPointerCancel(event: PointerEvent): void {
        if (event.pointerId !== this.activePointerId) {
            return;
        }

        if (this.swipeAxis) {
            // Emit end event with success: false on cancel
            const deltaX = this.currentX - this.startX;
            const deltaY = this.currentY - this.startY;
            const isHorizontal = this.swipeAxis === 'horizontal';
            const delta = isHorizontal ? deltaX : deltaY;
            const distance = Math.abs(delta);
            const direction = this.getSwipeDirection(delta, isHorizontal);
            const duration = Date.now() - this.startTime;
            const velocity = duration > 0 ? distance / duration : 0;
            this.swipeend.emit({
                originalEvent: event,
                deltaX,
                deltaY,
                distance,
                direction,
                success: false,
                velocity,
            });
        }

        this.cleanup();
    }

    private cancelGesture(): void {
        this.swipecancel.emit();
        this.cleanup();
    }

    private cleanup(): void {
        
        this.renderer.removeClass(this.elRef.nativeElement, 'swiping');
        this.swiping.set(false);

        if (this.pointerCaptured && this.activePointerId !== null) {
            try {
                this.elRef.nativeElement.releasePointerCapture(this.activePointerId);
            } catch {
                // Ignore release errors
            }
            this.pointerCaptured = false; 
        }

        this.unlistenMove?.();
        this.unlistenUp?.();
        this.unlistenCancel?.();

        this.unlistenMove = undefined;
        this.unlistenUp = undefined;
        this.unlistenCancel = undefined;
        this.activePointerId = null;
        this.pointerCaptured = false;
        this.swipeRatio.set(0);
        this.swipeAxis = null;
    }

    private getSwipeDirection(delta: number, isHorizontal: boolean): 'left' | 'right' | 'up' | 'down' {
        if (isHorizontal) {
            return delta > 0 ? 'right' : 'left';
        } else {
            return delta > 0 ? 'down' : 'up';
        }
    }

    private isSwipeSuccessful(delta: number, isHorizontal: boolean, velocity: number): boolean {
        // Require minimum velocity for very fast swipes
        const element = this.elRef.nativeElement;
        const rect = element.getBoundingClientRect();
        let swipedDistance = Math.abs(delta);
        const containerDimension = isHorizontal ? rect.width : rect.height;
        if (velocity >= this.minimumVelocity()) {
            // Calculate effective distance with velocity multiplier
            const velocityBoost = velocity * (this.velocityMultiplier());
            swipedDistance = swipedDistance + (velocityBoost * swipedDistance);
        }
        // Check if distance exceeds threshold percentage
        const requiredDistance = containerDimension * this.successRatio();
        return swipedDistance >= requiredDistance;
    }
}