import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeDecisionService } from './page-viewer-swipe-decision.service';

describe('PageViewerSwipeDecisionService', () => {
    let service: PageViewerSwipeDecisionService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSwipeDecisionService]
        });

        service = TestBed.inject(PageViewerSwipeDecisionService);
    });

    it('resolves a committed swipe movement and target offset', () => {
        const plan = service.resolveSwipeEndPlan({
            totalDx: -1200,
            velocity: 0,
            scaledPageStep: 1000,
            totalUnits: 6,
            commitThreshold: 0.15,
            velocityThreshold: 300
        });

        expect(plan).toEqual({
            pagesToMove: 1,
            targetOffset: -1000
        });
    });

    it('falls back to flick velocity when distance stays below threshold', () => {
        const plan = service.resolveSwipeEndPlan({
            totalDx: 50,
            velocity: 350,
            scaledPageStep: 1000,
            totalUnits: 6,
            commitThreshold: 0.15,
            velocityThreshold: 300
        });

        expect(plan.pagesToMove).toBe(-1);
    });

    it('resolves shadow navigation movement and wrapped start indices', () => {
        expect(service.resolveShadowPagesToMove({
            direction: 'right',
            currentStartIndex: 4,
            effectiveVisible: 2,
            targetIndex: 1,
            totalUnits: 6
        })).toBe(2);

        expect(service.resolveViewStartIndex({
            baseDisplayStartIndex: 5,
            pagesToMove: 2,
            totalUnits: 6
        })).toBe(1);
    });

    it('builds reverse animation plans', () => {
        expect(service.resolveReversePlan({ currentTranslateX: 0.5, fullPageDistance: 1000 })).toEqual({
            shouldSnapImmediately: true,
            durationMs: 0
        });

        expect(service.resolveReversePlan({ currentTranslateX: 500, fullPageDistance: 1000 })).toEqual({
            shouldSnapImmediately: false,
            durationMs: 110
        });
    });
});