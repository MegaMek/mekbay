// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface PageViewerSwipeEndPlan {
    pagesToMove: number;
    targetOffset: number;
}

export interface PageViewerSwipeReversePlan {
    shouldSnapImmediately: boolean;
    durationMs: number;
}

export function resolveSwipeEndPlan(options: {
    totalDx: number;
    velocity: number;
    scaledPageStep: number;
    totalUnits: number;
    commitThreshold: number;
    velocityThreshold: number;
}): PageViewerSwipeEndPlan {
    const {
        totalDx,
        velocity,
        scaledPageStep,
        totalUnits,
        commitThreshold,
        velocityThreshold
    } = options;
    const threshold = scaledPageStep * commitThreshold;
    let pagesToMove = 0;

    if (Math.abs(totalDx) > threshold) {
        pagesToMove = -Math.round(totalDx / scaledPageStep);
    }

    if (pagesToMove === 0) {
        if (velocity > velocityThreshold) {
            pagesToMove = -1;
        } else if (velocity < -velocityThreshold) {
            pagesToMove = 1;
        }
    }

    if (totalUnits > 0) {
        pagesToMove = Math.max(-totalUnits + 1, Math.min(totalUnits - 1, pagesToMove));
    }

    return {
        pagesToMove,
        targetOffset: -pagesToMove * scaledPageStep
    };
}

export function resolveShadowPagesToMove(options: {
    direction: 'left' | 'right';
    currentStartIndex: number;
    effectiveVisible: number;
    targetIndex: number;
    totalUnits: number;
}): number {
    const { direction, currentStartIndex, effectiveVisible, targetIndex, totalUnits } = options;

    if (direction === 'right') {
        const endIndex = (currentStartIndex + effectiveVisible - 1) % totalUnits;
        return targetIndex > endIndex
            ? targetIndex - endIndex
            : (totalUnits - endIndex) + targetIndex;
    }

    return targetIndex < currentStartIndex
        ? -(currentStartIndex - targetIndex)
        : -(currentStartIndex + (totalUnits - targetIndex));
}

export function resolveSwipeViewStartIndex(options: {
    baseDisplayStartIndex: number;
    pagesToMove: number;
    totalUnits: number;
}): number {
    const { baseDisplayStartIndex, pagesToMove, totalUnits } = options;
    if (totalUnits <= 0) {
        return 0;
    }

    return ((baseDisplayStartIndex + pagesToMove) % totalUnits + totalUnits) % totalUnits;
}

export function resolveSwipeReversePlan(options: {
    currentTranslateX: number;
    fullPageDistance: number;
}): PageViewerSwipeReversePlan {
    const remainingDistance = Math.abs(options.currentTranslateX);
    if (remainingDistance < 1) {
        return {
            shouldSnapImmediately: true,
            durationMs: 0
        };
    }

    return {
        shouldSnapImmediately: false,
        durationMs: Math.max(90, Math.min(220, Math.round(220 * (remainingDistance / Math.max(1, options.fullPageDistance)))))
    };
}
