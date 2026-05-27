import { Injectable, inject } from '@angular/core';

import { PageViewerSwipeBindingService } from './page-viewer-swipe-binding.service';
import { PageViewerSwipeRenderPlanService, type PageViewerSwipeRenderDecision } from './page-viewer-swipe-render-plan.service';
import { PageViewerSwipeSlotService } from './page-viewer-swipe-slot.service';

export interface PageViewerSwipeRendererSlotState {
    slotIndex: number;
    slotOffset: number;
    slotLeft: number;
    slotRight: number;
    unitIndex: number | null;
    element: HTMLDivElement;
    attachedSvg: SVGSVGElement | null;
}

export interface PageViewerSwipeRendererUnitState {
    unitId: string;
    svg: SVGSVGElement | null;
}

export interface PageViewerSwipeRendererInstruction {
    slotIndex: number;
    unitIndex: number;
    unitId: string;
    svg: SVGSVGElement | null;
    decision: PageViewerSwipeRenderDecision;
}

export interface PageViewerSwipeRendererUpdate {
    nextDirection: 'left' | 'right' | 'none';
    nextLastTranslateX: number;
    clearSlotIndices: number[];
    attachedUnitToSlotMap: Map<number, number>;
    slotInstructions: PageViewerSwipeRendererInstruction[];
    winningUnitIndices: number[];
}

@Injectable()
export class PageViewerSwipeRendererService {
    private readonly pageViewerSwipeSlot = inject(PageViewerSwipeSlotService);
    private readonly pageViewerSwipeBinding = inject(PageViewerSwipeBindingService);
    private readonly pageViewerSwipeRenderPlan = inject(PageViewerSwipeRenderPlanService);

    buildUpdate(options: {
        slots: readonly PageViewerSwipeRendererSlotState[];
        units: readonly PageViewerSwipeRendererUnitState[];
        visibleLeft: number;
        visibleRight: number;
        scaledPageWidth: number;
        visiblePages: number;
        addOnly: boolean;
        translateX: number;
        lastTranslateX: number;
        currentDirection: 'left' | 'right' | 'none';
        selectedUnitId: string | null;
    }): PageViewerSwipeRendererUpdate {
        const visibilityPlan = this.pageViewerSwipeSlot.resolveVisibilityPlan({
            slots: options.slots.map((slot) => ({
                slotIndex: slot.slotIndex,
                slotOffset: slot.slotOffset,
                slotLeft: slot.slotLeft,
                slotRight: slot.slotRight,
                unitIndex: slot.unitIndex
            })),
            visibleLeft: options.visibleLeft,
            visibleRight: options.visibleRight,
            scaledPageWidth: options.scaledPageWidth,
            visiblePages: options.visiblePages,
            addOnly: options.addOnly,
            translateX: options.translateX,
            lastTranslateX: options.lastTranslateX,
            currentDirection: options.currentDirection
        });

        const bindingPlan = this.pageViewerSwipeBinding.buildPlan({
            slots: options.slots.map((slot) => ({
                slotIndex: slot.slotIndex,
                unitIndex: slot.unitIndex,
                hasAttachedSvg: slot.attachedSvg !== null,
                isSvgAttachedToSlot: slot.attachedSvg?.parentElement === slot.element
            })),
            addOnly: options.addOnly,
            visibleSlotIndices: visibilityPlan.visibleSlotIndices,
            visibleSlotIndexSet: visibilityPlan.visibleSlotIndexSet,
            winningSlotForUnit: visibilityPlan.winningSlotForUnit
        });

        const attachedUnitToSlotMap = new Map(bindingPlan.attachedUnitToSlotMap);
        if (!options.addOnly) {
            for (const slotIndex of bindingPlan.slotIndicesToClear) {
                const unitIndex = options.slots[slotIndex]?.unitIndex;
                if (unitIndex !== null && unitIndex !== undefined) {
                    attachedUnitToSlotMap.delete(unitIndex);
                }
            }
        }

        const slotInstructions = bindingPlan.slotsToProcess.flatMap((slotPlan) => {
            const slot = options.slots[slotPlan.slotIndex];
            const unit = options.units[slotPlan.unitIndex];
            if (!slot || !unit) {
                return [];
            }

            const decision = this.pageViewerSwipeRenderPlan.buildDecision({
                addOnly: options.addOnly,
                visiblePages: options.visiblePages,
                slotIndex: slotPlan.slotIndex,
                mostVisibleSlotIndex: visibilityPlan.mostVisibleSlotIndex,
                isCenterSlot: Number.isFinite(slot.slotOffset) && slot.slotOffset >= 0 && slot.slotOffset < options.visiblePages,
                isSelectedUnit: unit.unitId === options.selectedUnitId,
                existingSvgMatches: unit.svg !== null && slot.attachedSvg === unit.svg,
                hasExistingSvg: slot.attachedSvg !== null,
                requestedSvgAttachedElsewhere: unit.svg !== null && unit.svg.parentElement !== null && unit.svg.parentElement !== slot.element,
                unitAlreadyMapped: attachedUnitToSlotMap.has(slotPlan.unitIndex)
            });

            return [{
                slotIndex: slotPlan.slotIndex,
                unitIndex: slotPlan.unitIndex,
                unitId: unit.unitId,
                svg: unit.svg,
                decision
            }];
        });

        return {
            nextDirection: visibilityPlan.nextDirection,
            nextLastTranslateX: visibilityPlan.nextLastTranslateX,
            clearSlotIndices: bindingPlan.slotIndicesToClear,
            attachedUnitToSlotMap,
            slotInstructions,
            winningUnitIndices: bindingPlan.winningUnitIndices
        };
    }
}