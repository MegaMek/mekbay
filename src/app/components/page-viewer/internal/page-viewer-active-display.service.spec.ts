import { TestBed } from '@angular/core/testing';

import { PageViewerActiveDisplayService } from './page-viewer-active-display.service';
import { PageViewerDisplayWindowService } from './page-viewer-display-window.service';
import { PageViewerInPlaceUpdateService } from './page-viewer-in-place-update.service';

function createUnit(id: string, hasSvg: boolean = true) {
    return {
        id,
        svg: () => hasSvg ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null
    } as never;
}

describe('PageViewerActiveDisplayService', () => {
    let service: PageViewerActiveDisplayService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                PageViewerDisplayWindowService,
                PageViewerInPlaceUpdateService,
                PageViewerActiveDisplayService
            ]
        });

        service = TestBed.inject(PageViewerActiveDisplayService);
    });

    it('clears active page content and removes transient wrappers', () => {
        const content = document.createElement('div');
        const declarative = document.createElement('div');
        declarative.dataset['renderMode'] = 'declarative';
        declarative.innerHTML = '<span>a</span>';
        const transient = document.createElement('div');
        transient.innerHTML = '<span>b</span>';
        content.appendChild(declarative);
        content.appendChild(transient);

        const nextPageElements = service.clearActivePageElements(content, [declarative, transient]);

        expect(nextPageElements).toEqual([]);
        expect(declarative.innerHTML).toBe('');
        expect(transient.innerHTML).toBe('');
        expect(content.contains(declarative)).toBeTrue();
        expect(content.contains(transient)).toBeFalse();
    });

    it('prepares the displayed unit window when the current unit svg is ready', () => {
        const units = [createUnit('a'), createUnit('b'), createUnit('c')];

        const preparation = service.prepareDisplay({
            currentUnit: units[0],
            allUnits: units,
            visiblePages: 2,
            viewStartIndex: 1
        });

        expect(preparation).toEqual({
            canRender: true,
            displayedUnits: [units[1], units[2]],
            loadError: null
        });
    });

    it('returns a loading state when the current unit svg is not ready', () => {
        const unit = createUnit('a', false);

        const preparation = service.prepareDisplay({
            currentUnit: unit,
            allUnits: [unit],
            visiblePages: 1,
            viewStartIndex: 0
        });

        expect(preparation).toEqual({
            canRender: false,
            displayedUnits: [],
            loadError: 'Loading record sheet...'
        });
    });

    it('builds the in-place patch plan for the current wrapper ids', () => {
        const units = [createUnit('a'), createUnit('b')];

        const preparation = service.prepareInPlaceUpdate({
            allUnits: units,
            visiblePages: 2,
            viewStartIndex: 0,
            currentWrapperUnitIds: ['a', 'b'],
            preserveSelectedUnitId: 'b'
        });

        expect(preparation.expectedUnits).toEqual(units);
        expect(preparation.patchPlan.canPatchInPlace).toBeTrue();
        expect(preparation.patchPlan.slots.map((slot) => slot.preserveExisting)).toEqual([false, true]);
    });
});