import { TestBed } from '@angular/core/testing';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { PageViewerViewStateService } from './page-viewer-view-state.service';

function createUnit(id: string): CBTForceUnit {
    return { id, viewState: null } as unknown as CBTForceUnit;
}

describe('PageViewerViewStateService', () => {
    let service: PageViewerViewStateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerViewStateService]
        });

        service = TestBed.inject(PageViewerViewStateService);
    });

    it('saves and retrieves unit view state', () => {
        const unit = createUnit('unit-1');
        const viewState = { scale: 1.5, translateX: 10, translateY: 20 };

        service.saveUnitViewState(unit, viewState);

        expect(service.getSavedUnitViewState(unit)).toEqual(viewState);
        expect(service.lastSharedViewState()).toEqual(viewState);
    });

    it('prefers unit-specific state when sync zoom is disabled in single-page mode', () => {
        const unit = createUnit('unit-1');
        service.saveUnitViewState(unit, { scale: 2, translateX: 30, translateY: 40 });

        expect(service.resolveRestoredViewState({
            unit,
            syncZoomBetweenSheets: false,
            isMultiPageMode: false,
            fromSwipe: false
        })).toEqual({ scale: 2, translateX: 30, translateY: 40 });
    });

    it('falls back to shared state when sync zoom is enabled', () => {
        const unit = createUnit('unit-1');
        service.saveUnitViewState(unit, { scale: 2, translateX: 30, translateY: 40 });

        expect(service.resolveRestoredViewState({
            unit: createUnit('unit-2'),
            syncZoomBetweenSheets: true,
            isMultiPageMode: false,
            fromSwipe: false
        })).toEqual({ scale: 2, translateX: 30, translateY: 40 });
    });

    it('updates the shared state independently of unit-specific state', () => {
        service.saveSharedViewState({ scale: 1.25, translateX: 12, translateY: 18 });

        expect(service.lastSharedViewState()).toEqual({ scale: 1.25, translateX: 12, translateY: 18 });
        expect(service.resolveRestoredViewState({
            unit: createUnit('unit-2'),
            syncZoomBetweenSheets: true,
            isMultiPageMode: true,
            fromSwipe: true
        })).toEqual({ scale: 1.25, translateX: 12, translateY: 18 });
    });
});
