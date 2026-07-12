import { Injectable, computed, inject } from '@angular/core';

import { PageViewerStateService } from './page-viewer-state.service';
import type {
    PageViewerDirection,
    PageViewerNavigationRequest,
    PageViewerNavigationSource,
    PageViewerTransitionState
} from './types';

@Injectable()
export class PageViewerNavigationService {
    private readonly state = inject(PageViewerStateService);

    readonly canNavigate = computed(() => this.state.forceUnits().length > this.state.effectiveVisiblePageCount());

    buildRequest(direction: PageViewerDirection, source: PageViewerNavigationSource): PageViewerNavigationRequest {
        return {
            direction,
            source,
            requestedAt: Date.now()
        };
    }

    getAdjacentTargetIndex(direction: PageViewerDirection): number {
        const units = this.state.forceUnits();
        const totalUnits = units.length;
        const currentStartIndex = this.state.viewStartIndex();
        const visibleCount = this.state.effectiveVisiblePageCount();

        if (totalUnits === 0) {
            return 0;
        }

        return direction === 'left'
            ? this.state.normalizeIndex(currentStartIndex - 1)
            : this.state.normalizeIndex(currentStartIndex + visibleCount);
    }

    getDirectionalPagesToMove(direction: PageViewerDirection): number {
        return direction === 'left' ? -1 : 1;
    }

    getTransitionTargetUnitId(): string | null {
        return this.state.activeTransition().targetUnitId;
    }

    suppressNextSelectionRedisplay(): void {
        this.state.suppressSelectionRedisplay.set(true);
    }

    consumeSelectionRedisplaySuppression(previousUnitId: string | null, currentUnitId: string | null): boolean {
        const shouldSuppress = this.state.suppressSelectionRedisplay() && previousUnitId !== currentUnitId;
        if (shouldSuppress) {
            this.state.suppressSelectionRedisplay.set(false);
        }

        return shouldSuppress;
    }

    startTransition(request: PageViewerNavigationRequest, targetUnitId: string | null): void {
        const nextState: PageViewerTransitionState = {
            phase: 'animating',
            request,
            pagesToMove: this.getDirectionalPagesToMove(request.direction),
            targetUnitId
        };
        this.state.activeTransition.set(nextState);
    }

    reverseTransition(): void {
        const current = this.state.activeTransition();
        if (current.phase === 'idle') {
            return;
        }

        this.state.activeTransition.set({
            ...current,
            phase: 'reversing',
            pagesToMove: 0,
            targetUnitId: null
        });
    }

    finishTransition(nextViewStartIndex: number, selectedUnitId: string | null): void {
        this.state.setViewStartIndex(nextViewStartIndex);
        this.state.setSelectedUnitId(selectedUnitId);
        this.state.activeTransition.set({
            phase: 'idle',
            request: null,
            pagesToMove: 0,
            targetUnitId: null
        });
    }

    cancelTransition(): void {
        this.state.activeTransition.set({
            phase: 'idle',
            request: null,
            pagesToMove: 0,
            targetUnitId: null
        });
    }
}
