import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeLoadService } from './page-viewer-swipe-load.service';

describe('PageViewerSwipeLoadService', () => {
    let service: PageViewerSwipeLoadService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeLoadService]
        });

        service = TestBed.inject(PageViewerSwipeLoadService);
    });

    it('tracks queued loads within a swipe session', () => {
        service.startSession();

        expect(service.canQueueLoad(2, true)).toBeTrue();

        const sessionId = service.markQueued(2);

        expect(sessionId).toBe(1);
        expect(service.canQueueLoad(2, true)).toBeFalse();
    });

    it('refreshes only when a load completion still matches the active swipe session', () => {
        service.startSession();
        const sessionId = service.markQueued(3);

        expect(service.resolveLoadCompletion({
            unitIndex: 3,
            sessionId,
            isSwiping: true,
            hasActiveAnimation: false,
            isUnitAssigned: true
        })).toBeTrue();

        service.startSession();
        const staleSessionId = service.markQueued(4);
        service.startSession();

        expect(service.resolveLoadCompletion({
            unitIndex: 4,
            sessionId: staleSessionId,
            isSwiping: true,
            hasActiveAnimation: false,
            isUnitAssigned: true
        })).toBeFalse();
    });

    it('allows retrying a failed load within the same swipe session', () => {
        service.startSession();
        service.markQueued(1);
        service.markLoadFailure(1);

        expect(service.canQueueLoad(1, true)).toBeTrue();
    });

    it('clears tracked load state on cleanup', () => {
        service.startSession();
        service.markQueued(1);

        service.clear();

        expect(service.canQueueLoad(1, true)).toBeTrue();
    });
});