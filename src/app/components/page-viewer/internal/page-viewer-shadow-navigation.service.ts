import { Injectable, inject } from '@angular/core';

import { PAGE_GAP, PAGE_WIDTH } from '../page-viewer-zoom-pan.service';
import { PageViewerNavigationService } from './page-viewer-navigation.service';
import { PageViewerSwipeDecisionService } from './page-viewer-swipe-decision.service';
import type { PageViewerNavigationSource } from './types';

export interface PageViewerShadowNavigationPlan {
    direction: 'left' | 'right';
    shouldStartTransition: boolean;
    pagesToMove: number;
    targetOffset: number;
    nextViewStartIndex: number;
}

@Injectable()
export class PageViewerShadowNavigationService {
    private readonly pageViewerNavigation = inject(PageViewerNavigationService);
    private readonly pageViewerSwipeDecision = inject(PageViewerSwipeDecisionService);

    buildPlan(options: {
        rawDirection: string | undefined;
        source: PageViewerNavigationSource;
        unitId: string;
        currentStartIndex: number;
        effectiveVisible: number;
        targetIndex: number;
        totalUnits: number;
        scale: number;
    }): PageViewerShadowNavigationPlan {
        const {
            rawDirection,
            currentStartIndex,
            effectiveVisible,
            targetIndex,
            totalUnits,
            scale
        } = options;

        const direction: 'left' | 'right' = rawDirection === 'right' ? 'right' : 'left';
        const pagesToMove = this.pageViewerSwipeDecision.resolveShadowPagesToMove({
            direction,
            currentStartIndex,
            effectiveVisible,
            targetIndex,
            totalUnits
        });

        return {
            direction,
            shouldStartTransition: rawDirection === 'left' || rawDirection === 'right',
            pagesToMove,
            targetOffset: -pagesToMove * ((PAGE_WIDTH + PAGE_GAP) * scale),
            nextViewStartIndex: this.pageViewerSwipeDecision.resolveViewStartIndex({
                baseDisplayStartIndex: currentStartIndex,
                pagesToMove,
                totalUnits
            })
        };
    }

    startTransitionIfNeeded(options: {
        plan: PageViewerShadowNavigationPlan;
        source: PageViewerNavigationSource;
        unitId: string;
    }): void {
        const { plan, source, unitId } = options;
        if (!plan.shouldStartTransition) {
            return;
        }

        this.pageViewerNavigation.startTransition(
            this.pageViewerNavigation.buildRequest(plan.direction, source),
            unitId
        );
    }
}