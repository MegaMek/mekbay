import { Injectable } from '@angular/core';

@Injectable()
export class PageViewerSwipeAnimationService {
    private transitionEndHandler: ((event?: Event) => void) | null = null;
    private timeoutId: number | null = null;
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

        if (this.transitionEndHandler) {
            swipeWrapper.removeEventListener('transitionend', this.transitionEndHandler);
            this.transitionEndHandler = null;
        }

        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        if (applyPendingMove && this.pendingPagesToMove !== 0) {
            applyPendingMove();
        }

        this.pendingPagesToMove = 0;

        if (resetTransform) {
            swipeWrapper.style.transition = 'none';
            swipeWrapper.style.transform = '';
        }
    }

    start(options: {
        swipeWrapper: HTMLDivElement;
        durationMs: number;
        easing: string;
        transform: string;
        onComplete: () => void;
    }): void {
        const { swipeWrapper, durationMs, easing, transform, onComplete } = options;
        let finished = false;

        const finalize = () => {
            if (finished) {
                return;
            }

            finished = true;

            if (this.transitionEndHandler) {
                swipeWrapper.removeEventListener('transitionend', this.transitionEndHandler);
                this.transitionEndHandler = null;
            }

            if (this.timeoutId !== null) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }

            onComplete();
        };

        const onTransitionEnd = (event?: Event) => {
            if (event && event.target !== swipeWrapper) {
                return;
            }
            finalize();
        };

        this.transitionEndHandler = onTransitionEnd;
        swipeWrapper.addEventListener('transitionend', onTransitionEnd);
        this.timeoutId = window.setTimeout(finalize, durationMs + 80);

        swipeWrapper.style.transition = `transform ${durationMs}ms ${easing}`;
        swipeWrapper.style.transform = transform;
    }
}