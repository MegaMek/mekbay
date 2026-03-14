import { TestBed } from '@angular/core/testing';

import { PageViewerEffectStateService } from './page-viewer-effect-state.service';
import { PageViewerStateService } from './page-viewer-state.service';

describe('PageViewerEffectStateService', () => {
    let service: PageViewerEffectStateService;
    let state: PageViewerStateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerEffectStateService, PageViewerStateService]
        });

        service = TestBed.inject(PageViewerEffectStateService);
        state = TestBed.inject(PageViewerStateService);
    });

    it('syncs component-facing state into the shared page-viewer state service', () => {
        const units = [{ id: 'a' }, { id: 'b' }] as never[];

        service.syncViewerState({
            state,
            forceUnits: units,
            selectedUnitId: 'b',
            visiblePageCount: 3,
            maxVisiblePageCount: 2,
            allowMultipleActiveSheets: false
        });

        expect(state.forceUnits()).toEqual(units);
        expect(state.selectedUnitId()).toBe('b');
        expect(state.visiblePageCount()).toBe(3);
        expect(state.maxVisiblePageCount()).toBe(2);
        expect(state.allowMultipleActiveSheets()).toBeFalse();
    });

    it('captures a normalized view-state snapshot', () => {
        expect(service.captureViewStateSnapshot({
            scale: 1.25,
            translateX: 12,
            translateY: 18
        })).toEqual({
            scale: 1.25,
            translateX: 12,
            translateY: 18
        });
    });
});