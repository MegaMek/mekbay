// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal } from '@angular/core';

import type { ViewportTransform } from '../../../models/force-serialization';
import type { PageViewerMember, PageViewerViewStateRecord } from './types';

@Injectable()
export class PageViewerViewStateService {
    readonly lastSharedViewState = signal<ViewportTransform | null>(null);
    readonly savedViewStates = signal<Map<string, PageViewerViewStateRecord>>(new Map());

    saveSharedViewState(viewState: ViewportTransform): void {
        this.lastSharedViewState.set({ ...viewState });
    }

    saveUnitViewState(unit: PageViewerMember, viewState: ViewportTransform): void {
        const normalizedState = { ...viewState };
        const next = new Map(this.savedViewStates());
        next.set(unit.id, {
            unitId: unit.id,
            viewState: normalizedState,
            updatedAt: Date.now()
        });
        this.savedViewStates.set(next);
        this.saveSharedViewState(normalizedState);
    }

    getSavedUnitViewState(unit: PageViewerMember | null | undefined): ViewportTransform | null {
        if (!unit) {
            return null;
        }

        const savedState = this.savedViewStates().get(unit.id)?.viewState;
        if (savedState) return { ...savedState };
        return null;
    }

    resolveRestoredViewState(options: {
        unit: PageViewerMember | null | undefined;
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
