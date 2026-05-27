import { TestBed } from '@angular/core/testing';

import { PageViewerNavigationService } from './page-viewer-navigation.service';
import { PageViewerStateService } from './page-viewer-state.service';

describe('PageViewerNavigationService', () => {
    let navigation: PageViewerNavigationService;
    let state: PageViewerStateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerStateService, PageViewerNavigationService]
        });

        navigation = TestBed.inject(PageViewerNavigationService);
        state = TestBed.inject(PageViewerStateService);
        state.setForceUnits([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[]);
        state.visiblePageCount.set(2);
        state.maxVisiblePageCount.set(2);
        state.allowMultipleActiveSheets.set(true);
        state.setViewStartIndex(0);
    });

    it('detects whether navigation is possible', () => {
        expect(navigation.canNavigate()).toBeTrue();

        state.visiblePageCount.set(3);
        state.maxVisiblePageCount.set(3);

        expect(navigation.canNavigate()).toBeFalse();
    });

    it('computes wrapped adjacent target indices', () => {
        expect(navigation.getAdjacentTargetIndex('left')).toBe(2);
        expect(navigation.getAdjacentTargetIndex('right')).toBe(2);

        state.setViewStartIndex(2);

        expect(navigation.getAdjacentTargetIndex('right')).toBe(1);
    });

    it('tracks transition lifecycle', () => {
        const request = navigation.buildRequest('right', 'keyboard');
        navigation.startTransition(request, 'b');

        expect(state.activeTransition().phase).toBe('animating');
        expect(state.activeTransition().targetUnitId).toBe('b');

        navigation.reverseTransition();
        expect(state.activeTransition().phase).toBe('reversing');

        navigation.finishTransition(2, 'c');
        expect(state.viewStartIndex()).toBe(2);
        expect(state.selectedUnitId()).toBe('c');
        expect(state.activeTransition().phase).toBe('idle');
    });

    it('tracks and consumes one-shot selection redisplay suppression', () => {
        navigation.suppressNextSelectionRedisplay();

        expect(navigation.consumeSelectionRedisplaySuppression('a', 'b')).toBeTrue();
        expect(navigation.consumeSelectionRedisplaySuppression('b', 'c')).toBeFalse();
    });
});
