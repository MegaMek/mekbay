import { Injectable } from '@angular/core';

export interface PageViewerSwipeBindingSlotState {
    slotIndex: number;
    unitIndex: number | null;
    hasAttachedSvg: boolean;
    isSvgAttachedToSlot: boolean;
}

export interface PageViewerSwipeBindingPlan {
    attachedUnitToSlotMap: Map<number, number>;
    slotIndicesToClear: number[];
    slotsToProcess: Array<{ slotIndex: number; unitIndex: number }>;
    winningUnitIndices: number[];
}

@Injectable()
export class PageViewerSwipeBindingService {
    buildPlan(options: {
        slots: readonly PageViewerSwipeBindingSlotState[];
        addOnly: boolean;
        visibleSlotIndices: readonly number[];
        visibleSlotIndexSet: ReadonlySet<number>;
        winningSlotForUnit: ReadonlyMap<number, number>;
    }): PageViewerSwipeBindingPlan {
        const { slots, addOnly, visibleSlotIndices, visibleSlotIndexSet, winningSlotForUnit } = options;
        const attachedUnitToSlotMap = new Map<number, number>();

        for (const slot of slots) {
            if (!slot.hasAttachedSvg || !slot.isSvgAttachedToSlot || slot.unitIndex === null) {
                continue;
            }

            attachedUnitToSlotMap.set(slot.unitIndex, slot.slotIndex);
        }

        const slotIndicesToClear = addOnly
            ? []
            : slots
                .filter((slot) => {
                    if (!slot.hasAttachedSvg || !slot.isSvgAttachedToSlot || slot.unitIndex === null) {
                        return false;
                    }

                    const isVisible = visibleSlotIndexSet.has(slot.slotIndex);
                    const isWinningSlot = winningSlotForUnit.get(slot.unitIndex) === slot.slotIndex;
                    return !isVisible || !isWinningSlot;
                })
                .map((slot) => slot.slotIndex);

        const slotsToProcess = addOnly
            ? visibleSlotIndices
                .map((slotIndex) => ({ slotIndex, unitIndex: slots[slotIndex]?.unitIndex ?? null }))
                .filter((slot): slot is { slotIndex: number; unitIndex: number } => slot.unitIndex !== null)
            : Array.from(winningSlotForUnit.entries()).map(([unitIndex, slotIndex]) => ({ slotIndex, unitIndex }));

        return {
            attachedUnitToSlotMap,
            slotIndicesToClear,
            slotsToProcess,
            winningUnitIndices: Array.from(winningSlotForUnit.keys())
        };
    }
}