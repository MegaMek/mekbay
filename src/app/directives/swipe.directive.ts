import {
    Directive,
    ElementRef,
    output,
    input,
    inject,
    effect,
    Renderer2,
    OnDestroy,
    signal,
} from '@angular/core';

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
export class SwipeDirective implements OnDestroy {
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
    private gestureDecided = false;
    private gestureIsValid = false;
    private pointerCaptured = false;
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
    }

    ngOnDestroy(): void {
        this.cleanup();
    }

    /**
     * Programmatically start a swipe gesture from an external pointer event.
     * This allows parent components to initiate swipes from edge zones or other triggers.
     * 
     * @param event The PointerEvent that should initiate the swipe
     * @returns boolean indicating if the swipe was started successfully
     */
    public startSwipe(event: PointerEvent): boolean {

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
        this.gestureDecided = false;
        this.gestureIsValid = false;
        this.pointerCaptured = false;

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
        if (!this.gestureDecided) {
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distance < this.threshold()) {
                return;
            }

            this.gestureDecided = true;

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

            this.gestureIsValid = true;

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
        if (this.gestureIsValid) {
            this.renderer.addClass(this.elRef.nativeElement, 'swiping');

            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const direction = this.getSwipeDirection(deltaX, deltaY);

            // Calculate and emit ratio
            const ratio = this.calculateSwipeRatio(deltaX, deltaY);
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

    private calculateSwipeRatio(deltaX: number, deltaY: number): number {
        const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
        const swipedDistance = isHorizontal ? deltaX : deltaY;

        // Use custom dimension function if provided, otherwise use element dimensions
        const getDimFn = this.dragDimensions();
        let containerDimension: number;

        if (getDimFn) {
            containerDimension = getDimFn();
        } else {
            const rect = this.elRef.nativeElement.getBoundingClientRect();
            containerDimension = isHorizontal ? rect.width : rect.height;
        }

        // Return signed ratio (can be negative for backwards swipe, or > 1 for over-swipe)
        const ratio = swipedDistance / containerDimension;

        // Clamp between -1 and 2 to allow some over-swipe but prevent extreme values
        return Math.max(-1, Math.min(2, ratio));
    }

    private onPointerUp(event: PointerEvent): void {
        if (event.pointerId !== this.activePointerId) {
            return;
        }

        if (this.gestureIsValid) {
            const deltaX = this.currentX - this.startX;
            const deltaY = this.currentY - this.startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const direction = this.getSwipeDirection(deltaX, deltaY);

            // Calculate velocity (pixels per millisecond)
            const duration = Date.now() - this.startTime;
            const velocity = duration > 0 ? distance / duration : 0;

            // Determine success
            const success = this.isSwipeSuccessful(deltaX, deltaY, velocity);
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

        if (this.gestureIsValid) {
            // Emit end event with success: false on cancel
            const deltaX = this.currentX - this.startX;
            const deltaY = this.currentY - this.startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const direction = this.getSwipeDirection(deltaX, deltaY);
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
        this.gestureDecided = false;
        this.gestureIsValid = false;
    }

    private getSwipeDirection(deltaX: number, deltaY: number): 'left' | 'right' | 'up' | 'down' {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            return deltaX > 0 ? 'right' : 'left';
        } else {
            return deltaY > 0 ? 'down' : 'up';
        }
    }

    private isSwipeSuccessful(deltaX: number, deltaY: number, velocity: number): boolean {
        // Require minimum velocity for very fast swipes
        if (velocity < this.minimumVelocity()) {
            // Fall back to distance-only check for slow swipes
            const element = this.elRef.nativeElement;
            const rect = element.getBoundingClientRect();
            const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
            const swipedDistance = Math.abs(isHorizontal ? deltaX : deltaY);
            const containerDimension = isHorizontal ? rect.width : rect.height;
            const requiredDistance = containerDimension * this.successRatio();
            return swipedDistance >= requiredDistance;
        }

        const element = this.elRef.nativeElement;
        const rect = element.getBoundingClientRect();

        // Determine which dimension to use based on swipe direction
        const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
        const swipedDistance = Math.abs(isHorizontal ? deltaX : deltaY);
        const containerDimension = isHorizontal ? rect.width : rect.height;

        // Calculate effective distance with velocity multiplier
        const velocityBoost = velocity * (this.velocityMultiplier());
        const effectiveDistance = swipedDistance + (velocityBoost * swipedDistance);

        // Check if effective distance exceeds threshold percentage
        const requiredDistance = containerDimension * this.successRatio();

        return effectiveDistance >= requiredDistance;
    }
}