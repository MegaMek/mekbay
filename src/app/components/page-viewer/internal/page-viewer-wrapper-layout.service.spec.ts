import { TestBed } from '@angular/core/testing';

import { PAGE_GAP, PAGE_HEIGHT, PAGE_WIDTH } from '../page-viewer-zoom-pan.service';
import { PageViewerWrapperLayoutService } from './page-viewer-wrapper-layout.service';

describe('PageViewerWrapperLayoutService', () => {
    let service: PageViewerWrapperLayoutService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerWrapperLayoutService]
        });

        service = TestBed.inject(PageViewerWrapperLayoutService);
    });

    it('detects whether an offset is outside the active visible range', () => {
        expect(service.isNeighborOffset(-1, 2)).toBeTrue();
        expect(service.isNeighborOffset(0, 2)).toBeFalse();
        expect(service.isNeighborOffset(1, 2)).toBeFalse();
        expect(service.isNeighborOffset(2, 2)).toBeTrue();
    });

    it('resolves original left positions from base left and offset', () => {
        expect(service.resolveOriginalLeft(120, 0)).toBe(120);
        expect(service.resolveOriginalLeft(120, 2)).toBe(120 + 2 * (PAGE_WIDTH + PAGE_GAP));
        expect(service.resolveOriginalLeft(120, -1)).toBe(120 - (PAGE_WIDTH + PAGE_GAP));
    });

    it('builds scaled and unscaled wrapper layouts', () => {
        expect(service.buildScaledLayout(300, 0.5)).toEqual({
            originalLeft: 300,
            left: 150,
            width: PAGE_WIDTH * 0.5,
            height: PAGE_HEIGHT * 0.5
        });

        expect(service.buildUnscaledLayout(300)).toEqual({
            originalLeft: 300,
            left: 300,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT
        });
    });
});