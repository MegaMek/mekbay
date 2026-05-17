import { Injectable } from '@angular/core';

interface SwipeSlotPlanSlot {
    slotIndex: number;
    slotOffset: number;
    slotLeft: number;
    slotRight: number;
    unitIndex: number | null;
}

interface SwipeSlotAddPlan {
    offset: number;
    unitIndex: number;
}

export interface PageViewerSwipeSlotExtensionPlan {
    leftAdds: SwipeSlotAddPlan[];
    rightAdds: SwipeSlotAddPlan[];
    trimLeftCount: number;
    trimRightCount: number;
}

export interface PageViewerSwipeInitialRangePlan {
    leftmostOffset: number;
    rightmostOffset: number;
    unitIndicesToPrepare: number[];
}

export interface PageViewerSwipeVisibleOffsetWindow {
    left: number;
    right: number;
}

export interface PageViewerSwipeVisibleOffsetRefresh {
    shouldRefresh: boolean;
    nextTrackedOffsets: PageViewerSwipeVisibleOffsetWindow;
}

export interface PageViewerSwipeSlotVisibilityPlan {
    nextDirection: 'left' | 'right' | 'none';
    nextLastTranslateX: number;
    visibleSlotIndices: number[];
    visibleSlotIndexSet: Set<number>;
    slotVisibility: Map<number, number>;
    winningSlotForUnit: Map<number, number>;
    mostVisibleSlotIndex: number | null;
}

@Injectable()
export class PageViewerSwipeSlotService {
    resolveVisibleOffsets(options: {
        containerWidth: number;
        scale: number;
        baseLeft: number;
        translateX: number;
        panTranslateX: number;
        pageWidth: number;
        pageGap: number;
    }): PageViewerSwipeVisibleOffsetWindow {
        const scaledPageWidth = options.pageWidth * options.scale;
        const scaledPageStep = (options.pageWidth + options.pageGap) * options.scale;
        const scaledBaseLeft = options.baseLeft * options.scale;
        const visibleLeft = -options.panTranslateX - options.translateX;
        const visibleRight = visibleLeft + options.containerWidth;

        return {
            left: Math.floor((visibleLeft - scaledBaseLeft) / scaledPageStep),
            right: Math.ceil((visibleRight - scaledBaseLeft - scaledPageWidth) / scaledPageStep)
        };
    }

    buildInitialRangePlan(options: {
        totalUnits: number;
        effectiveVisible: number;
        baseDisplayStartIndex: number;
        initialLeftNeighbors?: number;
        initialRightNeighbors?: number;
    }): PageViewerSwipeInitialRangePlan {
        const {
            totalUnits,
            effectiveVisible,
            baseDisplayStartIndex,
            initialLeftNeighbors = 1,
            initialRightNeighbors = 1
        } = options;

        const leftmostOffset = -initialLeftNeighbors;
        const rightmostOffset = effectiveVisible - 1 + initialRightNeighbors;
        const indicesToPrepare = new Set<number>();

        for (let offset = leftmostOffset; offset <= rightmostOffset; offset++) {
            indicesToPrepare.add(this.normalizeIndex(baseDisplayStartIndex + offset, totalUnits));
        }

        return {
            leftmostOffset,
            rightmostOffset,
            unitIndicesToPrepare: Array.from(indicesToPrepare)
        };
    }

    resolveVisibleOffsetRefresh(options: {
        currentVisibleOffsets: PageViewerSwipeVisibleOffsetWindow | null;
        nextVisibleOffsets: PageViewerSwipeVisibleOffsetWindow;
    }): PageViewerSwipeVisibleOffsetRefresh {
        const { currentVisibleOffsets, nextVisibleOffsets } = options;
        const shouldRefresh = !currentVisibleOffsets
            || nextVisibleOffsets.left !== currentVisibleOffsets.left
            || nextVisibleOffsets.right !== currentVisibleOffsets.right;

        return {
            shouldRefresh,
            nextTrackedOffsets: shouldRefresh ? nextVisibleOffsets : (currentVisibleOffsets ?? nextVisibleOffsets)
        };
    }

    buildExtensionPlan(options: {
        totalUnits: number;
        effectiveVisible: number;
        baseDisplayStartIndex: number;
        currentLeftmostOffset: number;
        currentRightmostOffset: number;
        leftmostVisibleOffset: number;
        rightmostVisibleOffset: number;
        currentAssignedUnitIndices: readonly number[];
    }): PageViewerSwipeSlotExtensionPlan {
        const {
            totalUnits,
            effectiveVisible,
            baseDisplayStartIndex,
            currentLeftmostOffset,
            currentRightmostOffset,
            leftmostVisibleOffset,
            rightmostVisibleOffset,
            currentAssignedUnitIndices
        } = options;

        if (totalUnits === 0) {
            return {
                leftAdds: [],
                rightAdds: [],
                trimLeftCount: 0,
                trimRightCount: 0
            };
        }

        const leftAdds: SwipeSlotAddPlan[] = [];
        const rightAdds: SwipeSlotAddPlan[] = [];
        const assignedUnitIndices = new Set(currentAssignedUnitIndices);
        const neededLeftOffset = leftmostVisibleOffset - 1;
        const neededRightOffset = rightmostVisibleOffset + 1;
        const maxRange = totalUnits - 1;
        let nextLeftmostOffset = currentLeftmostOffset;
        let nextRightmostOffset = currentRightmostOffset;

        while (neededLeftOffset < nextLeftmostOffset && (nextRightmostOffset - nextLeftmostOffset) < maxRange) {
            const newOffset = nextLeftmostOffset - 1;
            const unitIndex = this.normalizeIndex(baseDisplayStartIndex + newOffset, totalUnits);
            if (assignedUnitIndices.has(unitIndex)) {
                break;
            }

            leftAdds.push({ offset: newOffset, unitIndex });
            assignedUnitIndices.add(unitIndex);
            nextLeftmostOffset = newOffset;
        }

        while (neededRightOffset > nextRightmostOffset && (nextRightmostOffset - nextLeftmostOffset) < maxRange) {
            const newOffset = nextRightmostOffset + 1;
            const unitIndex = this.normalizeIndex(baseDisplayStartIndex + newOffset, totalUnits);
            if (assignedUnitIndices.has(unitIndex)) {
                break;
            }

            rightAdds.push({ offset: newOffset, unitIndex });
            assignedUnitIndices.add(unitIndex);
            nextRightmostOffset = newOffset;
        }

        const trimBuffer = 2;
        const trimLeftBoundary = leftmostVisibleOffset - trimBuffer;
        const trimRightBoundary = rightmostVisibleOffset + trimBuffer;
        let trimLeftCount = 0;
        let trimRightCount = 0;
        let remainingSlots = currentAssignedUnitIndices.length + leftAdds.length + rightAdds.length;

        while (nextLeftmostOffset < trimLeftBoundary && remainingSlots > effectiveVisible + 2) {
            nextLeftmostOffset++;
            trimLeftCount++;
            remainingSlots--;
        }

        while (nextRightmostOffset > trimRightBoundary && remainingSlots > effectiveVisible + 2) {
            nextRightmostOffset--;
            trimRightCount++;
            remainingSlots--;
        }

        return {
            leftAdds,
            rightAdds,
            trimLeftCount,
            trimRightCount
        };
    }

    resolveVisibilityPlan(options: {
        slots: readonly SwipeSlotPlanSlot[];
        visibleLeft: number;
        visibleRight: number;
        scaledPageWidth: number;
        visiblePages: number;
        addOnly: boolean;
        translateX: number;
        lastTranslateX: number;
        currentDirection: 'left' | 'right' | 'none';
    }): PageViewerSwipeSlotVisibilityPlan {
        const {
            slots,
            visibleLeft,
            visibleRight,
            scaledPageWidth,
            visiblePages,
            addOnly,
            translateX,
            lastTranslateX,
            currentDirection
        } = options;

        let nextDirection = currentDirection;
        let nextLastTranslateX = lastTranslateX;

        if (!addOnly) {
            if (translateX > lastTranslateX + 1) {
                nextDirection = 'right';
            } else if (translateX < lastTranslateX - 1) {
                nextDirection = 'left';
            }
            nextLastTranslateX = translateX;
        }

        const visibleSlotIndices: number[] = [];
        const visibleSlotIndexSet = new Set<number>();
        const slotVisibility = new Map<number, number>();
        const unitToVisibleSlots = new Map<number, number[]>();

        for (const slot of slots) {
            const isVisible = slot.slotRight > visibleLeft && slot.slotLeft < visibleRight;
            if (!isVisible) {
                continue;
            }

            const overlapLeft = Math.max(slot.slotLeft, visibleLeft);
            const overlapRight = Math.min(slot.slotRight, visibleRight);
            const overlapWidth = Math.max(0, overlapRight - overlapLeft);
            const visibilityPercent = scaledPageWidth > 0 ? overlapWidth / scaledPageWidth : 0;

            visibleSlotIndices.push(slot.slotIndex);
            visibleSlotIndexSet.add(slot.slotIndex);
            slotVisibility.set(slot.slotIndex, visibilityPercent);

            if (slot.unitIndex === null) {
                continue;
            }

            if (!unitToVisibleSlots.has(slot.unitIndex)) {
                unitToVisibleSlots.set(slot.unitIndex, []);
            }
            unitToVisibleSlots.get(slot.unitIndex)?.push(slot.slotIndex);
        }

        const winningSlotForUnit = new Map<number, number>();
        for (const [unitIndex, slotIndices] of unitToVisibleSlots) {
            if (slotIndices.length === 1) {
                winningSlotForUnit.set(unitIndex, slotIndices[0]);
                continue;
            }

            const centerSlot = slotIndices.find((slotIndex) => {
                const slotOffset = slots[slotIndex]?.slotOffset;
                return slotOffset !== undefined && slotOffset >= 0 && slotOffset < visiblePages;
            });

            if (centerSlot !== undefined) {
                winningSlotForUnit.set(unitIndex, centerSlot);
                continue;
            }

            let winningSlot = slotIndices[0];
            let winningVisibility = slotVisibility.get(winningSlot) ?? 0;

            for (const candidateSlot of slotIndices.slice(1)) {
                const candidateVisibility = slotVisibility.get(candidateSlot) ?? 0;
                if (candidateVisibility > winningVisibility + 0.0001) {
                    winningSlot = candidateSlot;
                    winningVisibility = candidateVisibility;
                    continue;
                }

                if (Math.abs(candidateVisibility - winningVisibility) <= 0.0001) {
                    const preferHigherSlot = nextDirection === 'left';
                    if ((preferHigherSlot && candidateSlot > winningSlot)
                        || (!preferHigherSlot && candidateSlot < winningSlot)) {
                        winningSlot = candidateSlot;
                        winningVisibility = candidateVisibility;
                    }
                }
            }

            winningSlotForUnit.set(unitIndex, winningSlot);
        }

        let mostVisibleSlotIndex: number | null = null;
        if (!addOnly && visiblePages === 1) {
            let maxVisibility = 0;
            for (const slotIndex of winningSlotForUnit.values()) {
                const visibilityPercent = slotVisibility.get(slotIndex) ?? 0;
                if (visibilityPercent > maxVisibility) {
                    maxVisibility = visibilityPercent;
                    mostVisibleSlotIndex = slotIndex;
                }
            }
        }

        return {
            nextDirection,
            nextLastTranslateX,
            visibleSlotIndices,
            visibleSlotIndexSet,
            slotVisibility,
            winningSlotForUnit,
            mostVisibleSlotIndex
        };
    }

    private normalizeIndex(index: number, totalUnits: number): number {
        if (totalUnits <= 0) {
            return 0;
        }

        return ((index % totalUnits) + totalUnits) % totalUnits;
    }
}