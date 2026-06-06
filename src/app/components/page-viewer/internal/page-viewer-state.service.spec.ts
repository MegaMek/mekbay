import { TestBed } from '@angular/core/testing';

import { PageViewerStateService } from './page-viewer-state.service';

describe('PageViewerStateService', () => {
    let service: PageViewerStateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerStateService]
        });

        service = TestBed.inject(PageViewerStateService);
    });

    it('limits effective visible page count when multiple active sheets are disabled', () => {
        service.visiblePageCount.set(4);
        service.maxVisiblePageCount.set(3);
        service.allowMultipleActiveSheets.set(false);

        expect(service.effectiveVisiblePageCount()).toBe(1);
    });

    it('normalizes indices against the current force units', () => {
        service.setForceUnits([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[]);

        expect(service.normalizeIndex(-1)).toBe(2);
        expect(service.normalizeIndex(3)).toBe(0);
        expect(service.normalizeIndex(4)).toBe(1);
    });

    it('resets state to a clean baseline', () => {
        service.setForceUnits([{ id: 'a' }] as never[]);
        service.setSelectedUnitId('a');
        service.suppressSelectionRedisplay.set(true);
        service.setViewStartIndex(3);
        service.activeTransition.set({
            phase: 'animating',
            request: { direction: 'right', source: 'keyboard', requestedAt: Date.now() },
            pagesToMove: 1,
            targetUnitId: 'a'
        });

        service.reset();

        expect(service.forceUnits()).toEqual([]);
        expect(service.selectedUnitId()).toBeNull();
        expect(service.suppressSelectionRedisplay()).toBeFalse();
        expect(service.viewStartIndex()).toBe(0);
        expect(service.activeTransition().phase).toBe('idle');
    });
});
