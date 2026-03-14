import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeRenderPlanService } from './page-viewer-swipe-render-plan.service';

describe('PageViewerSwipeRenderPlanService', () => {
    let service: PageViewerSwipeRenderPlanService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeRenderPlanService]
        });

        service = TestBed.inject(PageViewerSwipeRenderPlanService);
    });

    it('skips add-only slots that already have an svg attached', () => {
        const decision = service.buildDecision({
            addOnly: true,
            visiblePages: 1,
            slotIndex: 0,
            mostVisibleSlotIndex: 0,
            isCenterSlot: true,
            isSelectedUnit: true,
            existingSvgMatches: false,
            hasExistingSvg: true,
            requestedSvgAttachedElsewhere: false,
            unitAlreadyMapped: false
        });

        expect(decision.action).toBe('skip');
        expect(decision.overlayMode).toBe('page');
    });

    it('reuses an existing matching svg and keeps fixed overlay mode for the dominant single page', () => {
        const decision = service.buildDecision({
            addOnly: false,
            visiblePages: 1,
            slotIndex: 2,
            mostVisibleSlotIndex: 2,
            isCenterSlot: false,
            isSelectedUnit: false,
            existingSvgMatches: true,
            hasExistingSvg: true,
            requestedSvgAttachedElsewhere: false,
            unitAlreadyMapped: false
        });

        expect(decision.action).toBe('reuse-existing');
        expect(decision.overlayMode).toBe('fixed');
    });

    it('skips attachment when the requested svg is already mapped elsewhere during add-only preloading', () => {
        const decision = service.buildDecision({
            addOnly: true,
            visiblePages: 2,
            slotIndex: 1,
            mostVisibleSlotIndex: null,
            isCenterSlot: false,
            isSelectedUnit: false,
            existingSvgMatches: false,
            hasExistingSvg: false,
            requestedSvgAttachedElsewhere: true,
            unitAlreadyMapped: true
        });

        expect(decision.action).toBe('skip');
        expect(decision.overlayMode).toBe('page');
    });

    it('attaches and updates visual state for a normal winning slot', () => {
        const decision = service.buildDecision({
            addOnly: false,
            visiblePages: 2,
            slotIndex: 0,
            mostVisibleSlotIndex: null,
            isCenterSlot: true,
            isSelectedUnit: true,
            existingSvgMatches: false,
            hasExistingSvg: false,
            requestedSvgAttachedElsewhere: false,
            unitAlreadyMapped: false
        });

        expect(decision.action).toBe('attach');
        expect(decision.updateVisualState).toBeTrue();
        expect(decision.isSelected).toBeTrue();
        expect(decision.showNeighborVisible).toBeFalse();
    });
});