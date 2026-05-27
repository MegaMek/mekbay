import { Injectable } from '@angular/core';

import type { ViewportTransform } from '../../../models/force-serialization';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { PageViewerStateService } from './page-viewer-state.service';

@Injectable()
export class PageViewerEffectStateService {
    syncViewerState(options: {
        state: PageViewerStateService;
        forceUnits: CBTForceUnit[];
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