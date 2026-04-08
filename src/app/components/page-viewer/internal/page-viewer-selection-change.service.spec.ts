import { TestBed } from '@angular/core/testing';

import { PageViewerSelectionChangeService } from './page-viewer-selection-change.service';

describe('PageViewerSelectionChangeService', () => {
    let service: PageViewerSelectionChangeService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerSelectionChangeService]
        });

        service = TestBed.inject(PageViewerSelectionChangeService);
    });

    it('updates highlight when the selected unit is already displayed', () => {
        const previousUnit = { id: 'unit-a' } as never;
        const currentUnit = { id: 'unit-b' } as never;
        const displayedUnits = [{ id: 'unit-b' }] as never[];
        const allUnits = [{ id: 'unit-a' }, currentUnit] as never[];

        expect(service.buildPlan({
            previousUnit,
            currentUnit,
            displayedUnits,
            allUnits,
            selectionRedisplaySuppressed: false
        })).toEqual({
            unitToSave: previousUnit,
            nextPreviousUnit: currentUnit,
            shouldUpdateHighlight: true,
            shouldDisplay: false,
            nextViewStartIndex: null,
            fromSwipe: false,
            selectedUnitId: 'unit-b'
        });
    });

    it('requests a redisplay and next view start index when the unit is off-screen', () => {
        const currentUnit = { id: 'unit-b' } as never;

        expect(service.buildPlan({
            previousUnit: null,
            currentUnit,
            displayedUnits: [{ id: 'unit-a' }] as never[],
            allUnits: [{ id: 'unit-a' }, currentUnit] as never[],
            selectionRedisplaySuppressed: false
        })).toEqual({
            unitToSave: null,
            nextPreviousUnit: currentUnit,
            shouldUpdateHighlight: false,
            shouldDisplay: true,
            nextViewStartIndex: 1,
            fromSwipe: true,
            selectedUnitId: 'unit-b'
        });
    });

    it('suppresses redisplay when navigation consumed the selection change', () => {
        const previousUnit = { id: 'unit-a' } as never;
        const currentUnit = { id: 'unit-b' } as never;

        expect(service.buildPlan({
            previousUnit,
            currentUnit,
            displayedUnits: [] as never[],
            allUnits: [previousUnit, currentUnit] as never[],
            selectionRedisplaySuppressed: true
        })).toEqual({
            unitToSave: previousUnit,
            nextPreviousUnit: currentUnit,
            shouldUpdateHighlight: false,
            shouldDisplay: false,
            nextViewStartIndex: null,
            fromSwipe: false,
            selectedUnitId: 'unit-b'
        });
    });
});