import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { PageViewerSwipeSlotExtensionPlan } from './page-viewer-swipe-slot.service';
import type { PageViewerOverlayMode } from './types';
import type { PageViewerSwipeRendererInstruction, PageViewerSwipeRendererSlotState, PageViewerSwipeRendererUpdate } from './page-viewer-swipe-renderer.service';
import { PageViewerWrapperLayoutService } from './page-viewer-wrapper-layout.service';

@Injectable()
export class PageViewerSwipeDomService {
    constructor(private readonly pageViewerWrapperLayout: PageViewerWrapperLayoutService) {}

    setupSlots(options: {
        content: HTMLDivElement;
        existingSwipeSlots: readonly HTMLDivElement[];
        existingPageElements: readonly HTMLDivElement[];
        scale: number;
        effectiveVisible: number;
        totalUnits: number;
        leftmostOffset: number;
        rightmostOffset: number;
        baseDisplayStartIndex: number;
        baseLeft: number;
    }): {
        swipeSlots: HTMLDivElement[];
        swipeSlotUnitAssignments: number[];
        swipeSlotSvgs: (SVGSVGElement | null)[];
        swipeTotalSlots: number;
    } {
        const {
            content,
            existingSwipeSlots,
            existingPageElements,
            scale,
            effectiveVisible,
            totalUnits,
            leftmostOffset,
            rightmostOffset,
            baseDisplayStartIndex,
            baseLeft
        } = options;

        this.removeElements(content, existingSwipeSlots);
        this.removeElements(content, existingPageElements);

        const swipeSlots: HTMLDivElement[] = [];
        const swipeSlotUnitAssignments: number[] = [];
        const swipeSlotSvgs: (SVGSVGElement | null)[] = [];

        for (let offset = leftmostOffset; offset <= rightmostOffset; offset++) {
            const slotIndex = offset - leftmostOffset;
            const unitIndex = this.normalizeIndex(baseDisplayStartIndex + offset, totalUnits);
            const slot = this.createSlotElement({
                offset,
                slotIndex,
                scale,
                baseLeft,
                visibleCount: effectiveVisible
            });

            content.appendChild(slot);
            swipeSlots.push(slot);
            swipeSlotUnitAssignments.push(unitIndex);
            swipeSlotSvgs.push(null);
        }

        return {
            swipeSlots,
            swipeSlotUnitAssignments,
            swipeSlotSvgs,
            swipeTotalSlots: rightmostOffset - leftmostOffset + 1
        };
    }

    extendSlots(options: {
        content: HTMLDivElement;
        swipeSlots: HTMLDivElement[];
        swipeSlotUnitAssignments: (number | null)[];
        swipeSlotSvgs: (SVGSVGElement | null)[];
        scale: number;
        effectiveVisible: number;
        baseLeft: number;
        extensionPlan: PageViewerSwipeSlotExtensionPlan;
        leftmostOffset: number;
        rightmostOffset: number;
        swipeTotalSlots: number;
        queueSwipeUnitLoad: (unitIndex: number) => void;
    }): {
        leftmostOffset: number;
        rightmostOffset: number;
        swipeTotalSlots: number;
    } {
        const {
            content,
            swipeSlots,
            swipeSlotUnitAssignments,
            swipeSlotSvgs,
            scale,
            effectiveVisible,
            baseLeft,
            extensionPlan,
            queueSwipeUnitLoad
        } = options;

        let leftmostOffset = options.leftmostOffset;
        let rightmostOffset = options.rightmostOffset;
        let swipeTotalSlots = options.swipeTotalSlots;

        for (const leftAdd of extensionPlan.leftAdds) {
            leftmostOffset = leftAdd.offset;
            const slot = this.createSlotElement({
                offset: leftAdd.offset,
                slotIndex: 0,
                scale,
                baseLeft,
                visibleCount: effectiveVisible
            });

            content.appendChild(slot);
            swipeSlots.unshift(slot);
            swipeSlotUnitAssignments.unshift(leftAdd.unitIndex);
            swipeSlotSvgs.unshift(null);
            swipeTotalSlots++;
            this.renumberSlotIndices(swipeSlots);
            queueSwipeUnitLoad(leftAdd.unitIndex);
        }

        for (const rightAdd of extensionPlan.rightAdds) {
            rightmostOffset = rightAdd.offset;
            const slot = this.createSlotElement({
                offset: rightAdd.offset,
                slotIndex: swipeSlots.length,
                scale,
                baseLeft,
                visibleCount: effectiveVisible
            });

            content.appendChild(slot);
            swipeSlots.push(slot);
            swipeSlotUnitAssignments.push(rightAdd.unitIndex);
            swipeSlotSvgs.push(null);
            swipeTotalSlots++;
            queueSwipeUnitLoad(rightAdd.unitIndex);
        }

        for (let trimIndex = 0; trimIndex < extensionPlan.trimLeftCount; trimIndex++) {
            const slotToRemove = swipeSlots.shift();
            this.removeElement(content, slotToRemove);
            swipeSlotUnitAssignments.shift();
            swipeSlotSvgs.shift();
            leftmostOffset++;
            swipeTotalSlots--;
        }

        for (let trimIndex = 0; trimIndex < extensionPlan.trimRightCount; trimIndex++) {
            const slotToRemove = swipeSlots.pop();
            this.removeElement(content, slotToRemove);
            swipeSlotUnitAssignments.pop();
            swipeSlotSvgs.pop();
            rightmostOffset--;
            swipeTotalSlots--;
        }

        this.renumberSlotIndices(swipeSlots);

        return {
            leftmostOffset,
            rightmostOffset,
            swipeTotalSlots
        };
    }

    buildSlotStates(options: {
        swipeSlots: readonly HTMLDivElement[];
        swipeSlotUnitAssignments: readonly (number | null)[];
        swipeSlotSvgs: readonly (SVGSVGElement | null)[];
        scaledPageWidth: number;
    }): PageViewerSwipeRendererSlotState[] {
        const { swipeSlots, swipeSlotUnitAssignments, swipeSlotSvgs, scaledPageWidth } = options;

        return swipeSlots.map((slot, slotIndex) => {
            const slotLeft = parseFloat(slot.style.left);

            return {
                slotIndex,
                unitIndex: swipeSlotUnitAssignments[slotIndex] ?? null,
                element: slot,
                attachedSvg: swipeSlotSvgs[slotIndex] ?? null,
                slotOffset: Number(slot.dataset['slotOffset'] ?? Number.NaN),
                slotLeft,
                slotRight: slotLeft + scaledPageWidth
            };
        });
    }

    syncAttachedSvgs(options: {
        slotStates: readonly PageViewerSwipeRendererSlotState[];
        swipeSlotSvgs: (SVGSVGElement | null)[];
    }): void {
        const { slotStates, swipeSlotSvgs } = options;

        slotStates.forEach((slotState) => {
            swipeSlotSvgs[slotState.slotIndex] = slotState.attachedSvg;
        });
    }

    applyRenderUpdate(options: {
        addOnly: boolean;
        slotStates: PageViewerSwipeRendererSlotState[];
        swipeSlotSvgs: (SVGSVGElement | null)[];
        renderUpdate: Pick<PageViewerSwipeRendererUpdate, 'clearSlotIndices' | 'attachedUnitToSlotMap' | 'slotInstructions'>;
        resolveUnit: (unitIndex: number) => CBTForceUnit | undefined;
        scale: number;
        visiblePages: number;
        readOnly: boolean;
        showFluff: boolean;
        setPageWrapperContentState: (wrapper: HTMLDivElement, hasSvg: boolean) => void;
        setWrapperSelectedState: (wrapper: HTMLDivElement, isSelected: boolean) => void;
        setSwipeNeighborVisibilityState: (wrapper: HTMLDivElement, isVisible: boolean) => void;
        attachSvgToWrapper: (options: { wrapper: HTMLDivElement; svg: SVGSVGElement; scale?: number; setAsCurrent?: boolean }) => void;
        applyFluffImageVisibilityToSvg: (svg: SVGSVGElement, showFluff: boolean) => void;
        bindWrapperInteractiveLayers: (wrapper: HTMLDivElement, unit: CBTForceUnit, svg: SVGSVGElement, overlayMode: PageViewerOverlayMode) => void;
        getOrCreateInteractionOverlay: (wrapper: HTMLDivElement, unit: CBTForceUnit, overlayMode: PageViewerOverlayMode) => unknown;
    }): Set<string> {
        const {
            addOnly,
            slotStates,
            swipeSlotSvgs,
            renderUpdate,
            resolveUnit,
            scale,
            visiblePages,
            readOnly,
            showFluff,
            setPageWrapperContentState,
            setWrapperSelectedState,
            setSwipeNeighborVisibilityState,
            attachSvgToWrapper,
            applyFluffImageVisibilityToSvg,
            bindWrapperInteractiveLayers,
            getOrCreateInteractionOverlay
        } = options;

        if (!addOnly) {
            this.clearInactiveBindings({
                slotStates,
                slotIndicesToClear: renderUpdate.clearSlotIndices,
                attachedUnitToSlotMap: renderUpdate.attachedUnitToSlotMap,
                setPageWrapperContentState,
                setSwipeNeighborVisibilityState
            });
            this.syncAttachedSvgs({ slotStates, swipeSlotSvgs });
        }

        const displayedUnitIds = this.applyInstructions({
            slotStates,
            slotInstructions: renderUpdate.slotInstructions,
            resolveUnit,
            attachedUnitToSlotMap: renderUpdate.attachedUnitToSlotMap,
            scale,
            visiblePages,
            readOnly,
            showFluff,
            setWrapperSelectedState,
            setSwipeNeighborVisibilityState,
            attachSvgToWrapper,
            applyFluffImageVisibilityToSvg,
            bindWrapperInteractiveLayers,
            getOrCreateInteractionOverlay
        });
        this.syncAttachedSvgs({ slotStates, swipeSlotSvgs });

        return displayedUnitIds;
    }

    resetSlots(options: {
        content: HTMLDivElement;
        swipeSlots: readonly HTMLDivElement[];
    }): {
        swipeSlots: HTMLDivElement[];
        swipeSlotUnitAssignments: number[];
        swipeSlotSvgs: (SVGSVGElement | null)[];
        swipeTotalSlots: number;
    } {
        const { content, swipeSlots } = options;

        swipeSlots.forEach((slot) => {
            this.removeElement(content, slot);
            slot.innerHTML = '';
        });

        return {
            swipeSlots: [],
            swipeSlotUnitAssignments: [],
            swipeSlotSvgs: [],
            swipeTotalSlots: 0
        };
    }

    clearInactiveBindings(options: {
        slotStates: PageViewerSwipeRendererSlotState[];
        slotIndicesToClear: readonly number[];
        attachedUnitToSlotMap: Map<number, number>;
        setPageWrapperContentState: (wrapper: HTMLDivElement, hasSvg: boolean) => void;
        setSwipeNeighborVisibilityState: (wrapper: HTMLDivElement, isVisible: boolean) => void;
    }): void {
        const {
            slotStates,
            slotIndicesToClear,
            attachedUnitToSlotMap,
            setPageWrapperContentState,
            setSwipeNeighborVisibilityState
        } = options;

        for (const slotIdx of slotIndicesToClear) {
            const slotState = slotStates[slotIdx];
            if (!slotState) {
                continue;
            }

            const { element, unitIndex, attachedSvg } = slotState;
            if (!attachedSvg || attachedSvg.parentElement !== element) {
                continue;
            }

            element.removeChild(attachedSvg);
            slotState.attachedSvg = null;
            setPageWrapperContentState(element, false);
            setSwipeNeighborVisibilityState(element, false);
            if (unitIndex !== null) {
                attachedUnitToSlotMap.delete(unitIndex);
            }
        }
    }

    applyInstructions(options: {
        slotStates: PageViewerSwipeRendererSlotState[];
        slotInstructions: readonly PageViewerSwipeRendererInstruction[];
        resolveUnit: (unitIndex: number) => CBTForceUnit | undefined;
        attachedUnitToSlotMap: Map<number, number>;
        scale: number;
        visiblePages: number;
        readOnly: boolean;
        showFluff: boolean;
        setWrapperSelectedState: (wrapper: HTMLDivElement, isSelected: boolean) => void;
        setSwipeNeighborVisibilityState: (wrapper: HTMLDivElement, isVisible: boolean) => void;
        attachSvgToWrapper: (options: { wrapper: HTMLDivElement; svg: SVGSVGElement; scale?: number; setAsCurrent?: boolean }) => void;
        applyFluffImageVisibilityToSvg: (svg: SVGSVGElement, showFluff: boolean) => void;
        bindWrapperInteractiveLayers: (wrapper: HTMLDivElement, unit: CBTForceUnit, svg: SVGSVGElement, overlayMode: PageViewerOverlayMode) => void;
        getOrCreateInteractionOverlay: (wrapper: HTMLDivElement, unit: CBTForceUnit, overlayMode: PageViewerOverlayMode) => unknown;
    }): Set<string> {
        const displayedUnitIds = new Set<string>();
        const {
            slotStates,
            slotInstructions,
            resolveUnit,
            attachedUnitToSlotMap,
            scale,
            visiblePages,
            readOnly,
            showFluff,
            setWrapperSelectedState,
            setSwipeNeighborVisibilityState,
            attachSvgToWrapper,
            applyFluffImageVisibilityToSvg,
            bindWrapperInteractiveLayers,
            getOrCreateInteractionOverlay
        } = options;

        for (const instruction of slotInstructions) {
            const slotState = slotStates[instruction.slotIndex];
            const unit = resolveUnit(instruction.unitIndex);
            const svg = instruction.svg;
            if (!slotState || !unit || !svg || instruction.decision.action === 'skip') {
                continue;
            }

            displayedUnitIds.add(unit.id);

            if (instruction.decision.action === 'reuse-existing') {
                if (!readOnly && visiblePages === 1) {
                    getOrCreateInteractionOverlay(slotState.element, unit, instruction.decision.overlayMode);
                }
                continue;
            }

            slotState.element.dataset['unitId'] = unit.id;
            slotState.element.dataset['unitIndex'] = String(instruction.unitIndex);

            if (instruction.decision.updateVisualState) {
                setWrapperSelectedState(slotState.element, instruction.decision.isSelected);
                setSwipeNeighborVisibilityState(slotState.element, instruction.decision.showNeighborVisible);
            }

            attachSvgToWrapper({ wrapper: slotState.element, svg, scale });
            slotState.attachedSvg = svg;
            attachedUnitToSlotMap.set(instruction.unitIndex, instruction.slotIndex);
            applyFluffImageVisibilityToSvg(svg, showFluff);
            bindWrapperInteractiveLayers(slotState.element, unit, svg, instruction.decision.overlayMode);
        }

        return displayedUnitIds;
    }

    resolveDisplayedUnits(options: {
        addOnly: boolean;
        winningUnitIndices: Iterable<number>;
        units: readonly CBTForceUnit[];
    }): CBTForceUnit[] | null {
        const { addOnly, winningUnitIndices, units } = options;
        if (addOnly) {
            return null;
        }

        return Array.from(new Set(winningUnitIndices))
            .map((unitIndex) => units[unitIndex])
            .filter((unit): unit is CBTForceUnit => !!unit);
    }

    private createSlotElement(options: {
        offset: number;
        slotIndex: number;
        scale: number;
        baseLeft: number;
        visibleCount: number;
    }): HTMLDivElement {
        const { offset, slotIndex, scale, baseLeft, visibleCount } = options;
        const slot = document.createElement('div');
        slot.classList.add('page-wrapper');
        slot.dataset['slotIndex'] = String(slotIndex);
        slot.dataset['slotOffset'] = String(offset);
        this.setPageWrapperContentState(slot, false);

        if (this.pageViewerWrapperLayout.isNeighborOffset(offset, visibleCount)) {
            slot.classList.add('neighbor-page');
        }

        const originalLeft = this.pageViewerWrapperLayout.resolveOriginalLeft(baseLeft, offset);
        const layout = this.pageViewerWrapperLayout.buildScaledLayout(originalLeft, scale);
        slot.dataset['originalLeft'] = String(layout.originalLeft);
        slot.style.width = `${layout.width}px`;
        slot.style.height = `${layout.height}px`;
        slot.style.position = 'absolute';
        slot.style.left = `${layout.left}px`;
        slot.style.top = '0';

        return slot;
    }

    private setPageWrapperContentState(wrapper: HTMLDivElement, hasSvg: boolean): void {
        wrapper.classList.toggle('has-svg', hasSvg);
        wrapper.classList.toggle('is-empty', !hasSvg);
    }

    private renumberSlotIndices(swipeSlots: readonly HTMLDivElement[]): void {
        swipeSlots.forEach((slot, index) => {
            slot.dataset['slotIndex'] = String(index);
        });
    }

    private removeElements(content: HTMLDivElement, elements: readonly HTMLDivElement[]): void {
        for (const element of elements) {
            this.removeElement(content, element);
        }
    }

    private removeElement(content: HTMLDivElement, element: HTMLDivElement | undefined): void {
        if (!element) {
            return;
        }

        if (element.parentElement === content) {
            content.removeChild(element);
        }
        element.innerHTML = '';
    }

    private normalizeIndex(index: number, totalUnits: number): number {
        return ((index % totalUnits) + totalUnits) % totalUnits;
    }
}