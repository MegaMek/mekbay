import { TestBed } from '@angular/core/testing';

import { PageViewerDisplayWindowService } from './page-viewer-display-window.service';
import { PageViewerForceChangeService } from './page-viewer-force-change.service';

describe('PageViewerForceChangeService', () => {
    let service: PageViewerForceChangeService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerDisplayWindowService, PageViewerForceChangeService]
        });

        service = TestBed.inject(PageViewerForceChangeService);
    });

    it('clears pages and shadows when the force is empty', () => {
        expect(service.buildActionPlan({
            allUnits: [],
            displayedUnits: [],
            selectedUnitId: null,
            visibleCount: 1,
            previousUnitCount: 1,
            currentViewStartIndex: 0,
            hasPageElements: false
        })).toEqual({
            shouldClearPages: true,
            shouldClearShadows: true,
            shouldUpdateDimensions: false,
            nextViewStartIndex: null,
            shouldCloseInteractionOverlays: false,
            renderStrategy: 'none',
            preserveSelectedUnitId: null
        });
    });

    it('chooses in-place rendering when the selected slot is preserved', () => {
        const units = [{ id: 'a' }, { id: 'c' }, { id: 'b' }, { id: 'd' }] as never[];
        const displayedUnits = [{ id: 'a' }, { id: 'b' }] as never[];

        expect(service.buildActionPlan({
            allUnits: units,
            displayedUnits,
            selectedUnitId: 'b',
            visibleCount: 2,
            previousUnitCount: 4,
            currentViewStartIndex: 0,
            hasPageElements: true
        })).toEqual({
            shouldClearPages: false,
            shouldClearShadows: false,
            shouldUpdateDimensions: true,
            nextViewStartIndex: 1,
            shouldCloseInteractionOverlays: true,
            renderStrategy: 'in-place',
            preserveSelectedUnitId: 'b'
        });
    });

    it('chooses a full rerender when the selected slot cannot be preserved', () => {
        const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];

        expect(service.buildActionPlan({
            allUnits: units,
            displayedUnits: [{ id: 'x' }] as never[],
            selectedUnitId: 'b',
            visibleCount: 1,
            previousUnitCount: 2,
            currentViewStartIndex: 0,
            hasPageElements: true
        }).renderStrategy).toBe('full');
    });
});