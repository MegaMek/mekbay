import { Injectable, computed, signal } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type {
    PageViewerPageDescriptor,
    PageViewerShadowDescriptor,
    PageViewerTransitionState
} from './types';

@Injectable()
export class PageViewerStateService {
    readonly forceUnits = signal<CBTForceUnit[]>([]);
    readonly selectedUnitId = signal<string | null>(null);
    readonly suppressSelectionRedisplay = signal(false);
    readonly viewStartIndex = signal(0);
    readonly visiblePageCount = signal(1);
    readonly maxVisiblePageCount = signal(99);
    readonly allowMultipleActiveSheets = signal(true);
    readonly activeTransition = signal<PageViewerTransitionState>({
        phase: 'idle',
        request: null,
        pagesToMove: 0,
        targetUnitId: null
    });
    readonly activePages = signal<PageViewerPageDescriptor[]>([]);
    readonly shadowPages = signal<PageViewerShadowDescriptor[]>([]);
    readonly transientShadowPages = signal<PageViewerShadowDescriptor[]>([]);

    readonly effectiveVisiblePageCount = computed(() => {
        if (!this.allowMultipleActiveSheets()) {
            return 1;
        }

        return Math.max(1, Math.min(this.visiblePageCount(), this.maxVisiblePageCount()));
    });

    setForceUnits(units: CBTForceUnit[]): void {
        this.forceUnits.set(units);
        this.viewStartIndex.update((currentIndex) => this.normalizeIndex(currentIndex));
    }

    setSelectedUnitId(unitId: string | null): void {
        this.selectedUnitId.set(unitId);
    }

    setViewStartIndex(index: number): void {
        this.viewStartIndex.set(this.normalizeIndex(index));
    }

    normalizeIndex(index: number): number {
        const totalUnits = this.forceUnits().length;
        if (totalUnits <= 0) {
            return 0;
        }

        return ((index % totalUnits) + totalUnits) % totalUnits;
    }

    reset(): void {
        this.forceUnits.set([]);
        this.selectedUnitId.set(null);
        this.suppressSelectionRedisplay.set(false);
        this.viewStartIndex.set(0);
        this.activeTransition.set({
            phase: 'idle',
            request: null,
            pagesToMove: 0,
            targetUnitId: null
        });
        this.activePages.set([]);
        this.shadowPages.set([]);
        this.transientShadowPages.set([]);
    }
}
