import { Injectable, signal } from '@angular/core';

import type { ViewportTransform } from '../../../models/force-serialization';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { PageViewerViewStateRecord } from './types';

@Injectable()
export class PageViewerViewStateService {
    readonly lastSharedViewState = signal<ViewportTransform | null>(null);
    readonly savedViewStates = signal<Map<string, PageViewerViewStateRecord>>(new Map());

    saveSharedViewState(viewState: ViewportTransform): void {
        this.lastSharedViewState.set({ ...viewState });
    }

    saveUnitViewState(unit: CBTForceUnit, viewState: ViewportTransform): void {
        const normalizedState = { ...viewState };
        const next = new Map(this.savedViewStates());
        next.set(unit.id, {
            unitId: unit.id,
            viewState: normalizedState,
            updatedAt: Date.now()
        });
        this.savedViewStates.set(next);
        this.saveSharedViewState(normalizedState);
        unit.viewState = normalizedState;
    }

    getSavedUnitViewState(unit: CBTForceUnit | null | undefined): ViewportTransform | null {
        if (!unit) {
            return null;
        }

        const savedState = this.savedViewStates().get(unit.id)?.viewState;
        return savedState ? { ...savedState } : unit.viewState ? { ...unit.viewState } : null;
    }

    resolveRestoredViewState(options: {
        unit: CBTForceUnit | null | undefined;
        syncZoomBetweenSheets: boolean;
        isMultiPageMode: boolean;
        fromSwipe: boolean;
    }): ViewportTransform | null {
        const { unit, syncZoomBetweenSheets, isMultiPageMode, fromSwipe } = options;

        if (!syncZoomBetweenSheets && !isMultiPageMode && !fromSwipe) {
            return this.getSavedUnitViewState(unit);
        }

        const sharedState = this.lastSharedViewState();
        return sharedState ? { ...sharedState } : null;
    }

    clearUnitViewState(unitId: string): void {
        const next = new Map(this.savedViewStates());
        next.delete(unitId);
        this.savedViewStates.set(next);
    }

    clearAll(): void {
        this.savedViewStates.set(new Map());
        this.lastSharedViewState.set(null);
    }
}
