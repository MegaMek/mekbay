import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeFrameService } from './page-viewer-swipe-frame.service';

describe('PageViewerSwipeFrameService', () => {
    let service: PageViewerSwipeFrameService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeFrameService]
        });

        service = TestBed.inject(PageViewerSwipeFrameService);
    });

    it('batches scheduled work into a single animation frame and tracks pending flags', () => {
        const callbacks: FrameRequestCallback[] = [];
        spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        });

        const onFrame = jasmine.createSpy('onFrame');
        service.startSession();
        service.setPendingTranslateX(120);

        service.schedule({ refreshVisibility: false, onFrame });
        service.schedule({ refreshVisibility: true, onFrame });

        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(callbacks.length).toBe(1);

        callbacks[0](0);

        expect(onFrame).toHaveBeenCalledTimes(1);
        expect(service.consumeFlushState({ isSwiping: true, hasActiveAnimation: false })).toEqual({
            pendingTranslateX: 120,
            shouldExtend: true,
            shouldRefresh: true
        });
    });

    it('drops pending work while a swipe animation is active', () => {
        service.startSession();
        service.setPendingTranslateX(50);
        service.schedule({ refreshVisibility: true, onFrame: () => undefined });

        expect(service.consumeFlushState({ isSwiping: true, hasActiveAnimation: true })).toBeNull();
        expect(service.consumeFlushState({ isSwiping: true, hasActiveAnimation: false })).toEqual({
            pendingTranslateX: 50,
            shouldExtend: false,
            shouldRefresh: false
        });
    });

    it('cancels and clears pending frame state', () => {
        spyOn(window, 'requestAnimationFrame').and.returnValue(9);
        spyOn(window, 'cancelAnimationFrame');

        service.startSession();
        service.setPendingTranslateX(80);
        service.schedule({ refreshVisibility: true, onFrame: () => undefined });
        service.clear();

        expect(window.cancelAnimationFrame).toHaveBeenCalledWith(9);
        expect(service.consumeFlushState({ isSwiping: true, hasActiveAnimation: false })).toEqual({
            pendingTranslateX: 0,
            shouldExtend: false,
            shouldRefresh: false
        });
    });
});