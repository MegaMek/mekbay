import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeBindingService } from './page-viewer-swipe-binding.service';

describe('PageViewerSwipeBindingService', () => {
    let service: PageViewerSwipeBindingService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeBindingService]
        });

        service = TestBed.inject(PageViewerSwipeBindingService);
    });

    it('builds attached-unit mapping and clear list for non-winning slots', () => {
        const plan = service.buildPlan({
            slots: [
                { slotIndex: 0, unitIndex: 1, hasAttachedSvg: true, isSvgAttachedToSlot: true },
                { slotIndex: 1, unitIndex: 1, hasAttachedSvg: false, isSvgAttachedToSlot: false },
                { slotIndex: 2, unitIndex: 2, hasAttachedSvg: true, isSvgAttachedToSlot: true }
            ],
            addOnly: false,
            visibleSlotIndices: [1, 2],
            visibleSlotIndexSet: new Set([1, 2]),
            winningSlotForUnit: new Map([[1, 1], [2, 2]])
        });

        expect(Array.from(plan.attachedUnitToSlotMap.entries())).toEqual([[1, 0], [2, 2]]);
        expect(plan.slotIndicesToClear).toEqual([0]);
        expect(plan.slotsToProcess).toEqual([{ slotIndex: 1, unitIndex: 1 }, { slotIndex: 2, unitIndex: 2 }]);
        expect(plan.winningUnitIndices).toEqual([1, 2]);
    });

    it('uses visible slots directly in add-only mode', () => {
        const plan = service.buildPlan({
            slots: [
                { slotIndex: 0, unitIndex: 0, hasAttachedSvg: true, isSvgAttachedToSlot: true },
                { slotIndex: 1, unitIndex: null, hasAttachedSvg: false, isSvgAttachedToSlot: false },
                { slotIndex: 2, unitIndex: 2, hasAttachedSvg: false, isSvgAttachedToSlot: false }
            ],
            addOnly: true,
            visibleSlotIndices: [0, 1, 2],
            visibleSlotIndexSet: new Set([0, 1, 2]),
            winningSlotForUnit: new Map([[0, 0], [2, 2]])
        });

        expect(plan.slotIndicesToClear).toEqual([]);
        expect(plan.slotsToProcess).toEqual([{ slotIndex: 0, unitIndex: 0 }, { slotIndex: 2, unitIndex: 2 }]);
    });
});