import { Injectable } from '@angular/core';

import type { PageViewerOverlayMode } from './types';

export interface PageViewerSwipeRenderDecision {
    action: 'skip' | 'reuse-existing' | 'attach';
    overlayMode: PageViewerOverlayMode;
    updateVisualState: boolean;
    isSelected: boolean;
    showNeighborVisible: boolean;
}

@Injectable()
export class PageViewerSwipeRenderPlanService {
    buildDecision(options: {
        addOnly: boolean;
        visiblePages: number;
        slotIndex: number;
        mostVisibleSlotIndex: number | null;
        isCenterSlot: boolean;
        isSelectedUnit: boolean;
        existingSvgMatches: boolean;
        hasExistingSvg: boolean;
        requestedSvgAttachedElsewhere: boolean;
        unitAlreadyMapped: boolean;
    }): PageViewerSwipeRenderDecision {
        const {
            addOnly,
            visiblePages,
            slotIndex,
            mostVisibleSlotIndex,
            isCenterSlot,
            isSelectedUnit,
            existingSvgMatches,
            hasExistingSvg,
            requestedSvgAttachedElsewhere,
            unitAlreadyMapped
        } = options;

        const overlayMode: PageViewerOverlayMode = !addOnly && visiblePages === 1 && slotIndex === mostVisibleSlotIndex
            ? 'fixed'
            : 'page';

        if (hasExistingSvg && addOnly) {
            return {
                action: 'skip',
                overlayMode,
                updateVisualState: false,
                isSelected: isSelectedUnit,
                showNeighborVisible: !isCenterSlot
            };
        }

        if (existingSvgMatches) {
            return {
                action: 'reuse-existing',
                overlayMode,
                updateVisualState: false,
                isSelected: isSelectedUnit,
                showNeighborVisible: !isCenterSlot
            };
        }

        if (requestedSvgAttachedElsewhere && (addOnly || unitAlreadyMapped)) {
            return {
                action: 'skip',
                overlayMode,
                updateVisualState: false,
                isSelected: isSelectedUnit,
                showNeighborVisible: !isCenterSlot
            };
        }

        return {
            action: 'attach',
            overlayMode,
            updateVisualState: !addOnly,
            isSelected: isSelectedUnit,
            showNeighborVisible: !isCenterSlot
        };
    }
}