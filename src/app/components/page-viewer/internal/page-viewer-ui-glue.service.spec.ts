import { TestBed } from '@angular/core/testing';

import { PageViewerUiGlueService } from './page-viewer-ui-glue.service';

describe('PageViewerUiGlueService', () => {
    let service: PageViewerUiGlueService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerUiGlueService]
        });

        service = TestBed.inject(PageViewerUiGlueService);
    });

    it('requests a redisplay when the effective visible count changes', () => {
        expect(service.buildResizePlan({
            previousVisibleCount: 1,
            nextVisibleCount: 2,
            hasCurrentUnit: true,
            initialRenderComplete: true,
            shadowPagesEnabled: true,
            totalUnits: 4,
            renderedShadowCount: 2
        })).toEqual({
            shouldRedisplay: true,
            shouldCloseInteractionOverlays: true,
            shouldScheduleShadowRender: false
        });
    });

    it('requests a redisplay when shadows should exist but none are rendered yet', () => {
        expect(service.buildResizePlan({
            previousVisibleCount: 1,
            nextVisibleCount: 1,
            hasCurrentUnit: true,
            initialRenderComplete: true,
            shadowPagesEnabled: true,
            totalUnits: 3,
            renderedShadowCount: 0
        })).toEqual({
            shouldRedisplay: true,
            shouldCloseInteractionOverlays: true,
            shouldScheduleShadowRender: false
        });
    });

    it('schedules shadow rendering when only a steady-state resize refresh is needed', () => {
        expect(service.buildResizePlan({
            previousVisibleCount: 1,
            nextVisibleCount: 1,
            hasCurrentUnit: true,
            initialRenderComplete: true,
            shadowPagesEnabled: true,
            totalUnits: 3,
            renderedShadowCount: 2
        })).toEqual({
            shouldRedisplay: false,
            shouldCloseInteractionOverlays: false,
            shouldScheduleShadowRender: true
        });
    });

    it('resolves a clicked visible unit only when the gesture is a real page click', () => {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper';
        wrapper.dataset['unitId'] = 'unit-b';
        const child = document.createElement('span');
        wrapper.appendChild(child);
        const units = [{ id: 'unit-a' }, { id: 'unit-b' }] as never[];

        expect(service.resolvePageSelectionUnit({
            eventTarget: child,
            pointerMoved: false,
            isPanning: false,
            isSwiping: false,
            displayedUnits: units,
            currentUnitId: 'unit-a'
        })).toEqual(units[1]);

        expect(service.resolvePageSelectionUnit({
            eventTarget: child,
            pointerMoved: true,
            isPanning: false,
            isSwiping: false,
            displayedUnits: units,
            currentUnitId: 'unit-a'
        })).toBeNull();
    });
});