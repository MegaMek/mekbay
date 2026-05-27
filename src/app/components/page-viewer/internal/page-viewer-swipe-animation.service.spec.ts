import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeAnimationService } from './page-viewer-swipe-animation.service';

describe('PageViewerSwipeAnimationService', () => {
    let service: PageViewerSwipeAnimationService;

    beforeEach(() => {
        jasmine.clock().install();

        TestBed.configureTestingModule({
            providers: [PageViewerSwipeAnimationService]
        });

        service = TestBed.inject(PageViewerSwipeAnimationService);
    });

    afterEach(() => {
        jasmine.clock().uninstall();
    });

    it('tracks pending pages to move', () => {
        service.setPendingPagesToMove(2);
        expect(service.getPendingPagesToMove()).toBe(2);

        service.clearPendingPagesToMove();
        expect(service.getPendingPagesToMove()).toBe(0);
    });

    it('cancels an active animation, applies pending move, and resets the wrapper transform', () => {
        const swipeWrapper = document.createElement('div');
        const applyPendingMove = jasmine.createSpy('applyPendingMove');

        service.setPendingPagesToMove(1);
        service.start({
            swipeWrapper,
            durationMs: 100,
            easing: 'ease-out',
            transform: 'translate3d(10px, 0, 0)',
            onComplete: jasmine.createSpy('onComplete')
        });

        expect(service.hasActiveAnimation()).toBeTrue();

        service.cancel({
            swipeWrapper,
            applyPendingMove,
            resetTransform: true
        });
        jasmine.clock().tick(200);

        expect(applyPendingMove).toHaveBeenCalledTimes(1);
        expect(service.hasActiveAnimation()).toBeFalse();
        expect(service.getPendingPagesToMove()).toBe(0);
        expect(swipeWrapper.style.transition).toBe('none');
        expect(swipeWrapper.style.transform).toBe('');
    });

    it('completes once when the wrapper transition ends', () => {
        const swipeWrapper = document.createElement('div');
        const onComplete = jasmine.createSpy('onComplete');

        service.start({
            swipeWrapper,
            durationMs: 100,
            easing: 'ease-out',
            transform: 'translate3d(10px, 0, 0)',
            onComplete
        });

        swipeWrapper.dispatchEvent(new Event('transitionend'));
        jasmine.clock().tick(200);

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(service.hasActiveAnimation()).toBeFalse();
    });
});