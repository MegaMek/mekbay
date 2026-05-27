import { Injectable } from '@angular/core';

export interface PageViewerSwipeEndPlan {
    pagesToMove: number;
    targetOffset: number;
}

export interface PageViewerSwipeReversePlan {
    shouldSnapImmediately: boolean;
    durationMs: number;
}

@Injectable()
export class PageViewerSwipeDecisionService {
    resolveSwipeEndPlan(options: {
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

    resolveShadowPagesToMove(options: {
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

    resolveViewStartIndex(options: {
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

    resolveReversePlan(options: {
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
}