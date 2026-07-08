import { Injectable } from '@angular/core';

@Injectable()
export class PageViewerSwipeAnimationService {
    private transitionEndHandler: ((event?: Event) => void) | null = null;
    private timeoutId: number | null = null;
    private activeWrapper: HTMLDivElement | null = null;
    private pendingPagesToMove = 0;

    hasActiveAnimation(): boolean {
        return this.transitionEndHandler !== null;
    }

    getPendingPagesToMove(): number {
        return this.pendingPagesToMove;
    }

    setPendingPagesToMove(pagesToMove: number): void {
        this.pendingPagesToMove = pagesToMove;
    }

    clearPendingPagesToMove(): void {
        this.pendingPagesToMove = 0;
    }

    cancel(options: {
        swipeWrapper: HTMLDivElement;
        applyPendingMove?: () => void;
        resetTransform?: boolean;
    }): void {
        const { swipeWrapper, applyPendingMove, resetTransform } = options;

        this.clearActiveAnimation(swipeWrapper);

        if (applyPendingMove && this.pendingPagesToMove !== 0) {
            applyPendingMove();
        }

        this.pendingPagesToMove = 0;

        if (resetTransform) {
            swipeWrapper.style.transition = 'none';
            swipeWrapper.style.transform = '';
        }
    }

    private clearActiveAnimation(fallbackWrapper?: HTMLDivElement): void {
        if (this.transitionEndHandler) {
            (this.activeWrapper ?? fallbackWrapper)?.removeEventListener('transitionend', this.transitionEndHandler);
            this.transitionEndHandler = null;
        }

        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        this.activeWrapper = null;
    }

    start(options: {
        swipeWrapper: HTMLDivElement;
        durationMs: number;
        easing: string;
        transform: string;
        onComplete: () => void;
    }): void {
        const { swipeWrapper, durationMs, easing, transform, onComplete } = options;
        this.clearActiveAnimation(swipeWrapper);

        let finished = false;

        const finalize = () => {
            if (finished || this.transitionEndHandler !== onTransitionEnd) {
                return;
            }

            finished = true;
            this.clearActiveAnimation(swipeWrapper);
            onComplete();
        };

        const onTransitionEnd = (event?: Event) => {
            if (event && event.target !== swipeWrapper) {
                return;
            }
            finalize();
        };

        this.transitionEndHandler = onTransitionEnd;
    this.activeWrapper = swipeWrapper;
        swipeWrapper.addEventListener('transitionend', onTransitionEnd);
        this.timeoutId = window.setTimeout(finalize, durationMs + 80);

        swipeWrapper.style.transition = `transform ${durationMs}ms ${easing}`;
        swipeWrapper.style.transform = transform;
    }
}