import { TestBed } from '@angular/core/testing';

import { PageViewerForceUnitsReactionService } from './page-viewer-force-units-reaction.service';

describe('PageViewerForceUnitsReactionService', () => {
    let service: PageViewerForceUnitsReactionService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerForceUnitsReactionService]
        });

        service = TestBed.inject(PageViewerForceUnitsReactionService);
    });

    it('tracks unit ids without firing before the view is initialized', () => {
        expect(service.evaluate({
            currentUnitIds: ['a', 'b'],
            viewInitialized: false
        })).toEqual({
            shouldHandleChange: false,
            previousUnitCount: 0
        });

        expect(service.evaluate({
            currentUnitIds: ['a', 'b'],
            viewInitialized: true
        })).toEqual({
            shouldHandleChange: false,
            previousUnitCount: 2
        });
    });

    it('detects additions removals and reordering after initialization', () => {
        service.evaluate({
            currentUnitIds: ['a', 'b'],
            viewInitialized: false
        });

        expect(service.evaluate({
            currentUnitIds: ['a', 'c', 'b'],
            viewInitialized: true
        })).toEqual({
            shouldHandleChange: true,
            previousUnitCount: 2
        });

        expect(service.evaluate({
            currentUnitIds: ['c', 'a', 'b'],
            viewInitialized: true
        })).toEqual({
            shouldHandleChange: true,
            previousUnitCount: 3
        });
    });
});