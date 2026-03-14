import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeSessionService } from './page-viewer-swipe-session.service';

describe('PageViewerSwipeSessionService', () => {
    let service: PageViewerSwipeSessionService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeSessionService]
        });

        service = TestBed.inject(PageViewerSwipeSessionService);
    });

    it('builds swipe session start state', () => {
        const units = [{ id: 'a' }, { id: 'b' }] as never[];

        expect(service.buildStartState({
            viewStartIndex: 3,
            units,
            initialRangePlan: { leftmostOffset: -1, rightmostOffset: 2, unitIndicesToPrepare: [0, 1] },
            initialVisibleOffsets: { left: -1, right: 1 }
        })).toEqual({
            baseDisplayStartIndex: 3,
            swipeAllUnits: units,
            swipeLeftmostOffset: -1,
            swipeRightmostOffset: 2,
            lastSwipeVisibleOffsets: { left: -1, right: 1 }
        });
    });

    it('builds reset state', () => {
        expect(service.buildResetState()).toEqual({
            baseDisplayStartIndex: 0,
            swipeDirection: 'none',
            lastSwipeTranslateX: 0,
            lastSwipeVisibleOffsets: null,
            swipeLeftmostOffset: 0,
            swipeRightmostOffset: 0,
            swipeAllUnits: []
        });
    });
});