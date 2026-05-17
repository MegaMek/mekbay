import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeDomService } from './page-viewer-swipe-dom.service';
import { PageViewerWrapperLayoutService } from './page-viewer-wrapper-layout.service';
import type { PageViewerSwipeRendererInstruction, PageViewerSwipeRendererSlotState } from './page-viewer-swipe-renderer.service';

function createSvg(): SVGSVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('PageViewerSwipeDomService', () => {
    let service: PageViewerSwipeDomService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerWrapperLayoutService, PageViewerSwipeDomService]
        });

        service = TestBed.inject(PageViewerSwipeDomService);
    });

    it('sets up swipe slots and clears prior slot and page elements', () => {
        const content = document.createElement('div');
        const oldSwipeSlot = document.createElement('div');
        const oldPage = document.createElement('div');
        content.appendChild(oldSwipeSlot);
        content.appendChild(oldPage);

        const state = service.setupSlots({
            content,
            existingSwipeSlots: [oldSwipeSlot],
            existingPageElements: [oldPage],
            scale: 1,
            effectiveVisible: 1,
            totalUnits: 3,
            leftmostOffset: -1,
            rightmostOffset: 1,
            baseDisplayStartIndex: 0,
            baseLeft: 0
        });

        expect(content.children.length).toBe(3);
        expect(state.swipeSlots.length).toBe(3);
        expect(state.swipeSlotUnitAssignments).toEqual([2, 0, 1]);
        expect(state.swipeSlotSvgs).toEqual([null, null, null]);
        expect(state.swipeTotalSlots).toBe(3);
        expect(state.swipeSlots[0].dataset['slotOffset']).toBe('-1');
        expect(state.swipeSlots[0].classList.contains('neighbor-page')).toBeTrue();
        expect(state.swipeSlots[1].classList.contains('neighbor-page')).toBeFalse();
    });

    it('extends and trims swipe slots while renumbering slot indices', () => {
        const content = document.createElement('div');
        const initial = service.setupSlots({
            content,
            existingSwipeSlots: [],
            existingPageElements: [],
            scale: 1,
            effectiveVisible: 2,
            totalUnits: 6,
            leftmostOffset: -1,
            rightmostOffset: 2,
            baseDisplayStartIndex: 1,
            baseLeft: 0
        });
        const queuedLoads: number[] = [];

        const nextState = service.extendSlots({
            content,
            swipeSlots: initial.swipeSlots,
            swipeSlotUnitAssignments: initial.swipeSlotUnitAssignments,
            swipeSlotSvgs: initial.swipeSlotSvgs,
            scale: 1,
            effectiveVisible: 2,
            baseLeft: 0,
            extensionPlan: {
                leftAdds: [{ offset: -2, unitIndex: 5 }],
                rightAdds: [{ offset: 3, unitIndex: 4 }],
                trimLeftCount: 1,
                trimRightCount: 0
            },
            leftmostOffset: -1,
            rightmostOffset: 2,
            swipeTotalSlots: 4,
            queueSwipeUnitLoad: (unitIndex) => queuedLoads.push(unitIndex)
        });

        expect(queuedLoads).toEqual([5, 4]);
        expect(nextState.leftmostOffset).toBe(-1);
        expect(nextState.rightmostOffset).toBe(3);
        expect(nextState.swipeTotalSlots).toBe(5);
        expect(initial.swipeSlotUnitAssignments).toEqual([0, 1, 2, 3, 4]);
        expect(initial.swipeSlots.map((slot) => slot.dataset['slotIndex'])).toEqual(['0', '1', '2', '3', '4']);
    });

    it('builds slot states and syncs attached svgs back to slot storage', () => {
        const firstSlot = document.createElement('div');
        const secondSlot = document.createElement('div');
        firstSlot.dataset['slotOffset'] = '-1';
        secondSlot.dataset['slotOffset'] = '0';
        firstSlot.style.left = '10px';
        secondSlot.style.left = '210px';
        const firstSvg = createSvg();
        const secondSvg = createSvg();
        const swipeSlotSvgs: (SVGSVGElement | null)[] = [firstSvg, null];

        const slotStates = service.buildSlotStates({
            swipeSlots: [firstSlot, secondSlot],
            swipeSlotUnitAssignments: [4, 5],
            swipeSlotSvgs,
            scaledPageWidth: 200
        });

        expect(slotStates).toEqual([
            jasmine.objectContaining({
                slotIndex: 0,
                unitIndex: 4,
                element: firstSlot,
                attachedSvg: firstSvg,
                slotOffset: -1,
                slotLeft: 10,
                slotRight: 210
            }),
            jasmine.objectContaining({
                slotIndex: 1,
                unitIndex: 5,
                element: secondSlot,
                attachedSvg: null,
                slotOffset: 0,
                slotLeft: 210,
                slotRight: 410
            })
        ]);

        slotStates[1].attachedSvg = secondSvg;
        service.syncAttachedSvgs({ slotStates, swipeSlotSvgs });

        expect(swipeSlotSvgs).toEqual([firstSvg, secondSvg]);
    });

    it('applies a render update and syncs slot svg storage', () => {
        const slot = document.createElement('div');
        const previousSvg = createSvg();
        const nextSvg = createSvg();
        slot.appendChild(previousSvg);
        const slotStates: PageViewerSwipeRendererSlotState[] = [{
            slotIndex: 0,
            slotOffset: 0,
            slotLeft: 0,
            slotRight: 100,
            unitIndex: 0,
            element: slot,
            attachedSvg: previousSvg
        }];
        const swipeSlotSvgs: (SVGSVGElement | null)[] = [previousSvg];
        const unit = { id: 'unit-0' } as never;
        const renderUpdate = {
            clearSlotIndices: [0],
            attachedUnitToSlotMap: new Map<number, number>(),
            slotInstructions: [{
                slotIndex: 0,
                unitIndex: 0,
                unitId: 'unit-0',
                svg: nextSvg,
                decision: {
                    action: 'attach' as const,
                    overlayMode: 'page' as const,
                    updateVisualState: true,
                    isSelected: true,
                    showNeighborVisible: false
                }
            }]
        };
        const setPageWrapperContentState = jasmine.createSpy('setPageWrapperContentState');
        const setWrapperSelectedState = jasmine.createSpy('setWrapperSelectedState');
        const setSwipeNeighborVisibilityState = jasmine.createSpy('setSwipeNeighborVisibilityState');
        const attachSvgToWrapper = jasmine.createSpy('attachSvgToWrapper').and.callFake(({ wrapper, svg }) => {
            wrapper.appendChild(svg);
        });
        const applyFluffImageVisibilityToSvg = jasmine.createSpy('applyFluffImageVisibilityToSvg');
        const bindWrapperInteractiveLayers = jasmine.createSpy('bindWrapperInteractiveLayers');
        const getOrCreateInteractionOverlay = jasmine.createSpy('getOrCreateInteractionOverlay');

        const displayedUnitIds = service.applyRenderUpdate({
            addOnly: false,
            slotStates,
            swipeSlotSvgs,
            renderUpdate,
            resolveUnit: () => unit,
            scale: 1,
            visiblePages: 1,
            readOnly: false,
            showFluff: true,
            setPageWrapperContentState,
            setWrapperSelectedState,
            setSwipeNeighborVisibilityState,
            attachSvgToWrapper,
            applyFluffImageVisibilityToSvg,
            bindWrapperInteractiveLayers,
            getOrCreateInteractionOverlay
        });

        expect(Array.from(displayedUnitIds)).toEqual(['unit-0']);
        expect(setPageWrapperContentState).toHaveBeenCalledWith(slot, false);
        expect(slotStates[0].attachedSvg).toBe(nextSvg);
        expect(swipeSlotSvgs).toEqual([nextSvg]);
    });

    it('resets swipe slots and clears slot bookkeeping', () => {
        const content = document.createElement('div');
        const firstSlot = document.createElement('div');
        const secondSlot = document.createElement('div');
        firstSlot.innerHTML = '<span>first</span>';
        secondSlot.innerHTML = '<span>second</span>';
        content.appendChild(firstSlot);
        content.appendChild(secondSlot);

        const nextState = service.resetSlots({
            content,
            swipeSlots: [firstSlot, secondSlot]
        });

        expect(content.childElementCount).toBe(0);
        expect(firstSlot.innerHTML).toBe('');
        expect(secondSlot.innerHTML).toBe('');
        expect(nextState.swipeSlots).toEqual([]);
        expect(nextState.swipeSlotUnitAssignments).toEqual([]);
        expect(nextState.swipeSlotSvgs).toEqual([]);
        expect(nextState.swipeTotalSlots).toBe(0);
    });

    it('clears inactive slot bindings and resets wrapper state', () => {
        const slot = document.createElement('div');
        const svg = createSvg();
        slot.appendChild(svg);
        const slotStates: PageViewerSwipeRendererSlotState[] = [{
            slotIndex: 0,
            slotOffset: 0,
            slotLeft: 0,
            slotRight: 1000,
            unitIndex: 2,
            element: slot,
            attachedSvg: svg
        }];
        const setPageWrapperContentState = jasmine.createSpy('setPageWrapperContentState');
        const setSwipeNeighborVisibilityState = jasmine.createSpy('setSwipeNeighborVisibilityState');
        const attachedUnitToSlotMap = new Map<number, number>([[2, 0]]);

        service.clearInactiveBindings({
            slotStates,
            slotIndicesToClear: [0],
            attachedUnitToSlotMap,
            setPageWrapperContentState,
            setSwipeNeighborVisibilityState
        });

        expect(slot.childElementCount).toBe(0);
        expect(slotStates[0].attachedSvg).toBeNull();
        expect(attachedUnitToSlotMap.has(2)).toBeFalse();
        expect(setPageWrapperContentState).toHaveBeenCalledWith(slot, false);
        expect(setSwipeNeighborVisibilityState).toHaveBeenCalledWith(slot, false);
    });

    it('applies attach instructions and returns displayed unit ids', () => {
        const slot = document.createElement('div');
        const svg = createSvg();
        const slotStates: PageViewerSwipeRendererSlotState[] = [{
            slotIndex: 0,
            slotOffset: 0,
            slotLeft: 0,
            slotRight: 1000,
            unitIndex: 0,
            element: slot,
            attachedSvg: null
        }];
        const instruction: PageViewerSwipeRendererInstruction = {
            slotIndex: 0,
            unitIndex: 0,
            unitId: 'unit-0',
            svg,
            decision: {
                action: 'attach',
                overlayMode: 'page',
                updateVisualState: true,
                isSelected: true,
                showNeighborVisible: false
            }
        };
        const attachedUnitToSlotMap = new Map<number, number>();
        const setWrapperSelectedState = jasmine.createSpy('setWrapperSelectedState');
        const setSwipeNeighborVisibilityState = jasmine.createSpy('setSwipeNeighborVisibilityState');
        const attachSvgToWrapper = jasmine.createSpy('attachSvgToWrapper').and.callFake(({ wrapper, svg: targetSvg }) => {
            wrapper.appendChild(targetSvg);
        });
        const applyFluffImageVisibilityToSvg = jasmine.createSpy('applyFluffImageVisibilityToSvg');
        const bindWrapperInteractiveLayers = jasmine.createSpy('bindWrapperInteractiveLayers');
        const getOrCreateInteractionOverlay = jasmine.createSpy('getOrCreateInteractionOverlay');
        const unit = { id: 'unit-0' } as never;

        const displayedUnitIds = service.applyInstructions({
            slotStates,
            slotInstructions: [instruction],
            resolveUnit: () => unit,
            attachedUnitToSlotMap,
            scale: 1,
            visiblePages: 1,
            readOnly: false,
            showFluff: true,
            setWrapperSelectedState,
            setSwipeNeighborVisibilityState,
            attachSvgToWrapper,
            applyFluffImageVisibilityToSvg,
            bindWrapperInteractiveLayers,
            getOrCreateInteractionOverlay
        });

        expect(Array.from(displayedUnitIds)).toEqual(['unit-0']);
        expect(slot.dataset['unitId']).toBe('unit-0');
        expect(slot.dataset['unitIndex']).toBe('0');
        expect(slotStates[0].attachedSvg).toBe(svg);
        expect(attachedUnitToSlotMap.get(0)).toBe(0);
        expect(setWrapperSelectedState).toHaveBeenCalledWith(slot, true);
        expect(setSwipeNeighborVisibilityState).toHaveBeenCalledWith(slot, false);
        expect(attachSvgToWrapper).toHaveBeenCalled();
        expect(applyFluffImageVisibilityToSvg).toHaveBeenCalledWith(svg, true);
        expect(bindWrapperInteractiveLayers).toHaveBeenCalledWith(slot, unit, svg, 'page');
        expect(getOrCreateInteractionOverlay).not.toHaveBeenCalled();
    });

    it('resolves the next displayed units from winning unit indices when not in add-only mode', () => {
        const units = [
            { id: 'a' },
            { id: 'b' },
            { id: 'c' }
        ] as never as { id: string }[];

        const displayedUnits = service.resolveDisplayedUnits({
            addOnly: false,
            winningUnitIndices: [2, 1, 2],
            units: units as never
        });

        expect(displayedUnits?.map((unit) => unit.id)).toEqual(['c', 'b']);
    });

    it('skips displayed unit reconciliation in add-only mode', () => {
        const displayedUnits = service.resolveDisplayedUnits({
            addOnly: true,
            winningUnitIndices: [0, 1],
            units: [{ id: 'a' }, { id: 'b' }] as never
        });

        expect(displayedUnits).toBeNull();
    });
});