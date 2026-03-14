import { TestBed } from '@angular/core/testing';

import { PageViewerNavigationService } from './page-viewer-navigation.service';
import { PageViewerShadowNavigationService } from './page-viewer-shadow-navigation.service';
import { PageViewerStateService } from './page-viewer-state.service';
import { PageViewerSwipeDecisionService } from './page-viewer-swipe-decision.service';

describe('PageViewerShadowNavigationService', () => {
    let service: PageViewerShadowNavigationService;
    let navigation: PageViewerNavigationService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                PageViewerStateService,
                PageViewerNavigationService,
                PageViewerSwipeDecisionService,
                PageViewerShadowNavigationService
            ]
        });

        service = TestBed.inject(PageViewerShadowNavigationService);
        navigation = TestBed.inject(PageViewerNavigationService);
    });

    it('builds a rightward shadow navigation plan', () => {
        const plan = service.buildPlan({
            rawDirection: 'right',
            source: 'shadow',
            unitId: 'unit-b',
            currentStartIndex: 0,
            effectiveVisible: 2,
            targetIndex: 3,
            totalUnits: 6,
            scale: 1
        });

        expect(plan).toEqual({
            direction: 'right',
            shouldStartTransition: true,
            pagesToMove: 2,
            targetOffset: -1264,
            nextViewStartIndex: 2
        });
    });

    it('falls back to leftward movement when the shadow direction is missing', () => {
        const plan = service.buildPlan({
            rawDirection: undefined,
            source: 'keyboard',
            unitId: 'unit-a',
            currentStartIndex: 2,
            effectiveVisible: 1,
            targetIndex: 0,
            totalUnits: 5,
            scale: 0.5
        });

        expect(plan.direction).toBe('left');
        expect(plan.shouldStartTransition).toBeFalse();
        expect(plan.pagesToMove).toBe(-2);
        expect(plan.targetOffset).toBe(632);
        expect(plan.nextViewStartIndex).toBe(0);
    });

    it('starts a transition only when the plan is transition-worthy', () => {
        const startTransitionSpy = spyOn(navigation, 'startTransition');
        const buildRequestSpy = spyOn(navigation, 'buildRequest').and.callThrough();

        const plan = service.buildPlan({
            rawDirection: 'left',
            source: 'keyboard',
            unitId: 'unit-c',
            currentStartIndex: 1,
            effectiveVisible: 1,
            targetIndex: 0,
            totalUnits: 4,
            scale: 1
        });

        service.startTransitionIfNeeded({ plan, source: 'keyboard', unitId: 'unit-c' });
        expect(buildRequestSpy).toHaveBeenCalledWith('left', 'keyboard');
        expect(startTransitionSpy).toHaveBeenCalled();

        startTransitionSpy.calls.reset();
        service.startTransitionIfNeeded({
            plan: { ...plan, shouldStartTransition: false },
            source: 'keyboard',
            unitId: 'unit-c'
        });
        expect(startTransitionSpy).not.toHaveBeenCalled();
    });
});