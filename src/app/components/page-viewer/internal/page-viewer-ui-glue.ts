// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PageViewerMember } from './types';

export interface PageViewerResizePlan {
    shouldRedisplay: boolean;
    shouldScheduleShadowRender: boolean;
}

export function buildViewerResizePlan(options: {
    previousVisibleCount: number;
    nextVisibleCount: number;
    hasCurrentUnit: boolean;
    initialRenderComplete: boolean;
    shadowPagesEnabled: boolean;
    totalUnits: number;
    renderedShadowCount: number;
}): PageViewerResizePlan {
    const {
        previousVisibleCount,
        nextVisibleCount,
        hasCurrentUnit,
        initialRenderComplete,
        shadowPagesEnabled,
        totalUnits,
        renderedShadowCount
    } = options;

    const shouldRedisplay = nextVisibleCount !== previousVisibleCount && hasCurrentUnit;
    const shouldShowShadows = hasCurrentUnit
        && shadowPagesEnabled
        && totalUnits > nextVisibleCount;

    return {
        shouldRedisplay,
        // A resize only needs shadow work when shadows can actually be
        // displayed, or when existing shadows must be removed. Scheduling
        // a clear for an already-empty viewer creates a render/resize
        // feedback loop while a new force has no selected unit.
        shouldScheduleShadowRender: !shouldRedisplay && initialRenderComplete
            && (shouldShowShadows || renderedShadowCount > 0)
    };
}

export function resolvePageSelectionUnit(options: {
    eventTarget: EventTarget | null;
    pointerMoved: boolean;
    isPanning: boolean;
    isSwiping: boolean;
    displayedUnits: readonly PageViewerMember[];
    currentUnitId: string | null;
}): PageViewerMember | null {
    const { eventTarget, pointerMoved, isPanning, isSwiping, displayedUnits, currentUnitId } = options;

    if (pointerMoved || isPanning || isSwiping || displayedUnits.length <= 1) {
        return null;
    }

    const target = eventTarget instanceof Element ? eventTarget : null;
    const pageWrapper = target?.closest('.page-wrapper') as HTMLElement | null;
    const clickedUnitId = pageWrapper?.dataset['unitId'];
    if (!clickedUnitId || clickedUnitId === currentUnitId) {
        return null;
    }

    return displayedUnits.find((unit) => unit.id === clickedUnitId) ?? null;
}
