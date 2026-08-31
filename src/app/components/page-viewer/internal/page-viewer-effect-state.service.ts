// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import { PageViewerStateService } from './page-viewer-state.service';
import type { PageViewerMember, ViewportTransform } from './types';

@Injectable()
export class PageViewerEffectStateService {
    syncViewerState(options: {
        state: PageViewerStateService;
        forceUnits: PageViewerMember[];
        selectedUnitId: string | null;
        visiblePageCount: number;
        maxVisiblePageCount: number;
        allowMultipleActiveSheets: boolean;
    }): void {
        const {
            state,
            forceUnits,
            selectedUnitId,
            visiblePageCount,
            maxVisiblePageCount,
            allowMultipleActiveSheets
        } = options;

        state.setForceUnits(forceUnits);
        state.setSelectedUnitId(selectedUnitId);
        state.visiblePageCount.set(visiblePageCount);
        state.maxVisiblePageCount.set(maxVisiblePageCount);
        state.allowMultipleActiveSheets.set(allowMultipleActiveSheets);
    }

    captureViewStateSnapshot(viewState: {
        scale: number;
        translateX: number;
        translateY: number;
    }): ViewportTransform {
        return {
            scale: viewState.scale,
            translateX: viewState.translateX,
            translateY: viewState.translateY
        };
    }
}
