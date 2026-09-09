// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PageViewerOverlayMode } from './types';

export interface PageViewerSwipeRenderDecision {
    action: 'skip' | 'reuse-existing' | 'attach';
    overlayMode: PageViewerOverlayMode;
    showTopRightControls: boolean;
    updateVisualState: boolean;
    isSelected: boolean;
    showNeighborVisible: boolean;
}

export function buildSwipeRenderDecision(options: {
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
    // Preloaded neighbors stay inactive until the swipe settles. In single-page mode,
    // the dominant page owns the fixed toolbar, even after leaving the original center slot.
    const showTopRightControls = !addOnly && (visiblePages === 1 ? overlayMode === 'fixed' : isCenterSlot);

    if (hasExistingSvg && addOnly) {
        return {
            action: 'skip',
            overlayMode,
            showTopRightControls,
            updateVisualState: false,
            isSelected: isSelectedUnit,
            showNeighborVisible: !isCenterSlot
        };
    }

    if (existingSvgMatches) {
        return {
            action: 'reuse-existing',
            overlayMode,
            showTopRightControls,
            updateVisualState: false,
            isSelected: isSelectedUnit,
            showNeighborVisible: !isCenterSlot
        };
    }

    if (requestedSvgAttachedElsewhere && (addOnly || unitAlreadyMapped)) {
        return {
            action: 'skip',
            overlayMode,
            showTopRightControls,
            updateVisualState: false,
            isSelected: isSelectedUnit,
            showNeighborVisible: !isCenterSlot
        };
    }

    return {
        action: 'attach',
        overlayMode,
        showTopRightControls,
        updateVisualState: !addOnly,
        isSelected: isSelectedUnit,
        showNeighborVisible: !isCenterSlot
    };
}
