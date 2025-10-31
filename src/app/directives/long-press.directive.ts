import { Directive, HostListener, input, effect, output, ElementRef, inject } from '@angular/core';

@Directive({
    selector: '[longPress]',
    standalone: true
})
export class LongPressDirective {
    longPressDuration = input<number>(300); // ms
    longPress = output<PointerEvent>();
    shortPress = output<MouseEvent>();
    
    private longPressed = false;
    private el = inject(ElementRef<HTMLElement>);
    private timeoutId: any;
    private startX = 0;
    private startY = 0;
    private pointerId?: number;
    private readonly MOVE_THRESHOLD = 10; // px
    private pointerDownEvent: PointerEvent | null = null;
    private disableNextClick = false;

    constructor() {
        effect((cleanup) => {
            cleanup(() => this.clearTimer());
        });
    }

    @HostListener('pointerdown', ['$event'])
    onPointerDown(event: PointerEvent) {
        // Only left button
        if (event.button && event.button !== 0) return;
    
        try { event.preventDefault(); } catch (e) { /* ignore */ }
    
        this.longPressed = false;
        this.clearTimer();
        this.startX = event.clientX;
        this.startY = event.clientY;
        this.pointerId = event.pointerId;
        this.pointerDownEvent = event;
        this.disableNextClick = false;

        try {
            (event.target as HTMLElement).setPointerCapture(this.pointerId);
        } catch (e) { /* ignore */ }

        this.timeoutId = setTimeout(() => {
            this.clearTimer();
            this.longPressed = true;
            this.longPress.emit(event);
            this.disableNextClick = true;
        }, this.longPressDuration());
    }

    @HostListener('pointermove', ['$event'])
    onPointerMove(event: PointerEvent) {
        if (!this.timeoutId) return;
        const dx = event.clientX - this.startX;
        const dy = event.clientY - this.startY;
        if (Math.hypot(dx, dy) > this.MOVE_THRESHOLD) {
            this.clearTimer();
        }
    }

    @HostListener('pointerup', ['$event'])
    onPointerUp(event: PointerEvent) {
        this.clearTimer();
    }

    @HostListener('click', ['$event'])
    onClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (this.disableNextClick) {
            this.disableNextClick = false;
            return;
        }
        if (!this.longPressed) {
            this.shortPress.emit(event);
        }
    }

    @HostListener('contextmenu', ['$event'])
    onContextMenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.timeoutId) {
            this.longPressed = true;
            this.longPress.emit(this.pointerDownEvent!);
            this.clearTimer();
        }
    }

    @HostListener('pointercancel')
    onPointerCancel() {
        this.clearTimer();
    }

    private clearTimer() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        try {
            if (this.pointerId != null) {
                this.el.nativeElement.releasePointerCapture(this.pointerId);
            }
        } catch (e) { /* ignore */ }
        this.pointerId = undefined;
    }
}