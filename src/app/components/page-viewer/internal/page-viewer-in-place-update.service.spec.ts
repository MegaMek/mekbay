import { TestBed } from '@angular/core/testing';

import { PageViewerInPlaceUpdateService } from './page-viewer-in-place-update.service';

describe('PageViewerInPlaceUpdateService', () => {
    let service: PageViewerInPlaceUpdateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerInPlaceUpdateService]
        });

        service = TestBed.inject(PageViewerInPlaceUpdateService);
    });

    it('refuses in-place patching when wrapper and unit counts differ', () => {
        const plan = service.buildPlan({
            expectedUnits: [{ id: 'a' }] as never[],
            currentWrapperUnitIds: [],
            preserveSelectedUnitId: 'a'
        });

        expect(plan.canPatchInPlace).toBeFalse();
        expect(plan.slots).toEqual([]);
    });

    it('preserves the selected slot when it remains at the same wrapper index', () => {
        const plan = service.buildPlan({
            expectedUnits: [{ id: 'a' }, { id: 'b' }] as never[],
            currentWrapperUnitIds: ['a', 'b'],
            preserveSelectedUnitId: 'b'
        });

        expect(plan.canPatchInPlace).toBeTrue();
        expect(plan.slots.map((slot) => slot.preserveExisting)).toEqual([false, true]);
    });

    it('marks all slots for replacement when the selected unit moved away from its wrapper', () => {
        const plan = service.buildPlan({
            expectedUnits: [{ id: 'b' }, { id: 'a' }] as never[],
            currentWrapperUnitIds: ['a', 'b'],
            preserveSelectedUnitId: 'b'
        });

        expect(plan.canPatchInPlace).toBeTrue();
        expect(plan.slots.map((slot) => slot.preserveExisting)).toEqual([false, false]);
    });
});