import { Injectable, inject } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { PageViewerDisplayWindowService } from './page-viewer-display-window.service';

export interface PageViewerForceChangeActionPlan {
    shouldClearPages: boolean;
    shouldClearShadows: boolean;
    shouldUpdateDimensions: boolean;
    nextViewStartIndex: number | null;
    shouldCloseInteractionOverlays: boolean;
    renderStrategy: 'none' | 'full' | 'in-place';
    preserveSelectedUnitId: string | null;
}

@Injectable()
export class PageViewerForceChangeService {
    private readonly pageViewerDisplayWindow = inject(PageViewerDisplayWindowService);

    buildActionPlan(options: {
        allUnits: readonly CBTForceUnit[];
        displayedUnits: readonly CBTForceUnit[];
        selectedUnitId: string | null;
        visibleCount: number;
        previousUnitCount: number;
        currentViewStartIndex: number;
        hasPageElements: boolean;
    }): PageViewerForceChangeActionPlan {
        const {
            allUnits,
            displayedUnits,
            selectedUnitId,
            visibleCount,
            previousUnitCount,
            currentViewStartIndex,
            hasPageElements
        } = options;

        if (allUnits.length === 0) {
            return {
                shouldClearPages: true,
                shouldClearShadows: true,
                shouldUpdateDimensions: false,
                nextViewStartIndex: null,
                shouldCloseInteractionOverlays: false,
                renderStrategy: 'none',
                preserveSelectedUnitId: null
            };
        }

        const plan = this.pageViewerDisplayWindow.buildForceChangePlan({
            allUnits,
            displayedUnits,
            selectedUnitId,
            visibleCount,
            previousUnitCount,
            currentViewStartIndex
        });

        const canPatchInPlace = !!selectedUnitId && plan.preserveSelectedSlot && hasPageElements && !plan.modeChanged;

        return {
            shouldClearPages: false,
            shouldClearShadows: false,
            shouldUpdateDimensions: true,
            nextViewStartIndex: plan.nextViewStartIndex !== currentViewStartIndex ? plan.nextViewStartIndex : null,
            shouldCloseInteractionOverlays: plan.needsRedisplay,
            renderStrategy: !plan.needsRedisplay
                ? 'none'
                : canPatchInPlace
                    ? 'in-place'
                    : 'full',
            preserveSelectedUnitId: canPatchInPlace ? selectedUnitId : null
        };
    }
}