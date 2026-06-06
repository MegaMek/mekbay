import { Injectable } from '@angular/core';

export interface PageViewerSwipeFrameFlushState {
    pendingTranslateX: number;
    shouldExtend: boolean;
    shouldRefresh: boolean;
}

@Injectable()
export class PageViewerSwipeFrameService {
    private pendingTranslateX = 0;
    private frameId: number | null = null;
    private refreshPending = false;
    private extendPending = false;

    startSession(): void {
        this.pendingTranslateX = 0;
        this.refreshPending = false;
        this.extendPending = false;
    }

    setPendingTranslateX(translateX: number): void {
        this.pendingTranslateX = translateX;
    }

    schedule(options: {
        refreshVisibility?: boolean;
        onFrame: () => void;
    }): void {
        this.refreshPending = true;
        this.extendPending = this.extendPending || (options.refreshVisibility ?? false);

        if (this.frameId !== null) {
            return;
        }

        this.frameId = requestAnimationFrame(() => {
            this.frameId = null;
            options.onFrame();
        });
    }

    cancelPendingFrame(): void {
        if (this.frameId !== null) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
    }

    consumeFlushState(options: {
        isSwiping: boolean;
        hasActiveAnimation: boolean;
    }): PageViewerSwipeFrameFlushState | null {
        if (!options.isSwiping) {
            return null;
        }

        if (options.hasActiveAnimation) {
            this.refreshPending = false;
            this.extendPending = false;
            return null;
        }

        const flushState: PageViewerSwipeFrameFlushState = {
            pendingTranslateX: this.pendingTranslateX,
            shouldExtend: this.extendPending,
            shouldRefresh: this.refreshPending
        };

        this.extendPending = false;
        this.refreshPending = false;

        return flushState;
    }

    clear(): void {
        this.cancelPendingFrame();
        this.pendingTranslateX = 0;
        this.refreshPending = false;
        this.extendPending = false;
    }
}