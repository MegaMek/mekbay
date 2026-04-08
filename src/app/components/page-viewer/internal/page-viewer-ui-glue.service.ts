import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';

export interface PageViewerResizePlan {
    shouldRedisplay: boolean;
    shouldCloseInteractionOverlays: boolean;
    shouldScheduleShadowRender: boolean;
}

@Injectable()
export class PageViewerUiGlueService {
    buildResizePlan(options: {
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

        if (nextVisibleCount !== previousVisibleCount && hasCurrentUnit) {
            return {
                shouldRedisplay: true,
                shouldCloseInteractionOverlays: true,
                shouldScheduleShadowRender: false
            };
        }

        if (!initialRenderComplete) {
            return {
                shouldRedisplay: false,
                shouldCloseInteractionOverlays: false,
                shouldScheduleShadowRender: false
            };
        }

        const shouldShowShadows = shadowPagesEnabled && totalUnits > nextVisibleCount;
        if (shouldShowShadows && renderedShadowCount === 0 && hasCurrentUnit) {
            return {
                shouldRedisplay: true,
                shouldCloseInteractionOverlays: true,
                shouldScheduleShadowRender: false
            };
        }

        return {
            shouldRedisplay: false,
            shouldCloseInteractionOverlays: false,
            shouldScheduleShadowRender: true
        };
    }

    resolvePageSelectionUnit(options: {
        eventTarget: EventTarget | null;
        pointerMoved: boolean;
        isPanning: boolean;
        isSwiping: boolean;
        displayedUnits: readonly CBTForceUnit[];
        currentUnitId: string | null;
    }): CBTForceUnit | null {
        const { eventTarget, pointerMoved, isPanning, isSwiping, displayedUnits, currentUnitId } = options;

        if (pointerMoved || isPanning || isSwiping || displayedUnits.length <= 1) {
            return null;
        }

        const target = eventTarget instanceof HTMLElement ? eventTarget : null;
        const pageWrapper = target?.closest('.page-wrapper') as HTMLElement | null;
        const clickedUnitId = pageWrapper?.dataset['unitId'];
        if (!clickedUnitId || clickedUnitId === currentUnitId) {
            return null;
        }

        return displayedUnits.find((unit) => unit.id === clickedUnitId) ?? null;
    }
}