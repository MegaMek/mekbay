import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeSlotService } from './page-viewer-swipe-slot.service';

describe('PageViewerSwipeSlotService', () => {
    let service: PageViewerSwipeSlotService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeSlotService]
        });

        service = TestBed.inject(PageViewerSwipeSlotService);
    });

    it('resolves visible offsets from swipe geometry inputs', () => {
        expect(service.resolveVisibleOffsets({
            containerWidth: 1000,
            scale: 1,
            baseLeft: 0,
            translateX: -250,
            panTranslateX: 0,
            pageWidth: 800,
            pageGap: 100
        })).toEqual({ left: 0, right: 1 });
    });

    it('builds the initial swipe range and preload unit indices', () => {
        const plan = service.buildInitialRangePlan({
            totalUnits: 6,
            effectiveVisible: 2,
            baseDisplayStartIndex: 1
        });

        expect(plan.leftmostOffset).toBe(-1);
        expect(plan.rightmostOffset).toBe(2);
        expect(plan.unitIndicesToPrepare).toEqual([0, 1, 2, 3]);
    });

    it('only refreshes tracked visible offsets when the window changes', () => {
        expect(service.resolveVisibleOffsetRefresh({
            currentVisibleOffsets: { left: -1, right: 1 },
            nextVisibleOffsets: { left: -1, right: 1 }
        })).toEqual({
            shouldRefresh: false,
            nextTrackedOffsets: { left: -1, right: 1 }
        });

        expect(service.resolveVisibleOffsetRefresh({
            currentVisibleOffsets: { left: -1, right: 1 },
            nextVisibleOffsets: { left: 0, right: 2 }
        })).toEqual({
            shouldRefresh: true,
            nextTrackedOffsets: { left: 0, right: 2 }
        });
    });

    it('plans left and right slot extension without duplicating wrapped units', () => {
        const plan = service.buildExtensionPlan({
            totalUnits: 5,
            effectiveVisible: 2,
            baseDisplayStartIndex: 1,
            currentLeftmostOffset: -1,
            currentRightmostOffset: 2,
            leftmostVisibleOffset: -2,
            rightmostVisibleOffset: 3,
            currentAssignedUnitIndices: [0, 1, 2, 3]
        });

        expect(plan.leftAdds).toEqual([{ offset: -2, unitIndex: 4 }]);
        expect(plan.rightAdds).toEqual([]);
        expect(plan.trimLeftCount).toBe(0);
        expect(plan.trimRightCount).toBe(0);
    });

    it('plans trimming when slots move well outside the buffered range', () => {
        const plan = service.buildExtensionPlan({
            totalUnits: 8,
            effectiveVisible: 2,
            baseDisplayStartIndex: 0,
            currentLeftmostOffset: -3,
            currentRightmostOffset: 4,
            leftmostVisibleOffset: 1,
            rightmostVisibleOffset: 2,
            currentAssignedUnitIndices: [5, 6, 7, 0, 1, 2, 3, 4]
        });

        expect(plan.leftAdds).toEqual([]);
        expect(plan.rightAdds).toEqual([]);
        expect(plan.trimLeftCount).toBe(2);
        expect(plan.trimRightCount).toBe(0);
    });

    it('prefers the center slot when duplicate unit assignments are visible', () => {
        const plan = service.resolveVisibilityPlan({
            slots: [
                { slotIndex: 0, slotOffset: -1, slotLeft: -200, slotRight: 800, unitIndex: 0 },
                { slotIndex: 1, slotOffset: 0, slotLeft: 0, slotRight: 1000, unitIndex: 0 },
                { slotIndex: 2, slotOffset: 1, slotLeft: 1000, slotRight: 2000, unitIndex: 1 }
            ],
            visibleLeft: 0,
            visibleRight: 1000,
            scaledPageWidth: 1000,
            visiblePages: 1,
            addOnly: false,
            translateX: -50,
            lastTranslateX: 0,
            currentDirection: 'none'
        });

        expect(plan.nextDirection).toBe('left');
        expect(plan.winningSlotForUnit.get(0)).toBe(1);
        expect(plan.mostVisibleSlotIndex).toBe(1);
    });
});