// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';
import { TestBed } from '@angular/core/testing';

import { PageViewerRenderModelService } from './page-viewer-render-model.service';
import { PageViewerStateService } from './page-viewer-state.service';

describe('PageViewerRenderModelService', () => {
    let renderModel: PageViewerRenderModelService;
    let state: PageViewerStateService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerZoomPanService, PageViewerStateService, PageViewerRenderModelService]
        });

        renderModel = TestBed.inject(PageViewerRenderModelService);
        state = TestBed.inject(PageViewerStateService);
    });

    it('updates active page positions when paper size changes', () => {
        state.setForceUnits([{ id: 'a' }, { id: 'b' }] as never[]);
        state.visiblePageCount.set(2);
        state.maxVisiblePageCount.set(2);
        state.allowMultipleActiveSheets.set(true);
        const before = renderModel.activePages()[1].originalLeft;
        TestBed.inject(PageViewerZoomPanService).setPageFormat('a4');
        expect(renderModel.activePages()[1].originalLeft - before).toBeCloseTo(595.276 - 612, 6);
    });

    it('creates active page descriptors from visible units and selection', () => {
        state.setForceUnits([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[]);
        state.visiblePageCount.set(2);
        state.maxVisiblePageCount.set(2);
        state.allowMultipleActiveSheets.set(true);
        state.setSelectedUnitId('b');
        state.setViewStartIndex(0);

        const pages = renderModel.activePages();

        expect(pages.length).toBe(2);
        expect(pages[0].unitId).toBe('a');
        expect(pages[0].isActive).toBeTrue();
        expect(pages[0].isSelected).toBeFalse();
        expect(pages[1].unitId).toBe('b');
        expect(pages[1].isSelected).toBeTrue();
        expect(pages[1].overlayMode).toBe('page');
    });

    it('uses fixed overlay mode when a single page is visible', () => {
        state.setForceUnits([{ id: 'a' }] as never[]);
        state.visiblePageCount.set(1);
        state.maxVisiblePageCount.set(1);
        state.allowMultipleActiveSheets.set(true);

        const pages = renderModel.activePages();

        expect(pages.length).toBe(1);
        expect(pages[0].overlayMode).toBe('fixed');
    });

    it('uses roster order when resizing from a paginated window to all units fitting', () => {
        state.setForceUnits([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[]);
        state.visiblePageCount.set(2);
        state.setViewStartIndex(2);
        expect(renderModel.activePages().map(page => page.unitId)).toEqual(['c', 'a']);

        state.visiblePageCount.set(3);
        expect(renderModel.activePages().map(page => [page.unitId, page.unitIndex])).toEqual([
            ['a', 0], ['b', 1], ['c', 2],
        ]);
    });

    it('returns the state-driven shadow descriptors', () => {
        state.shadowPages.set([
            {
                key: 'shadow:left:a',
                unit: { id: 'a' } as never,
                unitId: 'a',
                unitIndex: 0,
                direction: 'left',
                originalLeft: -920,
                scaledLeft: -920,
                isDimmed: true
            },
            {
                key: 'shadow:right:c',
                unit: { id: 'c' } as never,
                unitId: 'c',
                unitIndex: 2,
                direction: 'right',
                originalLeft: 920,
                scaledLeft: 920,
                isDimmed: true
            }
        ]);

        const shadows = renderModel.shadowPages();

        expect(shadows.length).toBe(2);
        expect(shadows[0].direction).toBe('left');
        expect(shadows[0].unitId).toBe('a');
        expect(shadows[1].direction).toBe('right');
        expect(shadows[1].unitId).toBe('c');
    });

    it('appends transient shadow descriptors after steady-state shadows', () => {
        state.shadowPages.set([
            {
                key: 'shadow:left:a',
                unit: { id: 'a' } as never,
                unitId: 'a',
                unitIndex: 0,
                direction: 'left',
                originalLeft: -920,
                scaledLeft: -920,
                isDimmed: true
            }
        ]);
        state.transientShadowPages.set([
            {
                key: 'shadow:right:d',
                unit: { id: 'd' } as never,
                unitId: 'd',
                unitIndex: 3,
                direction: 'right',
                originalLeft: 1840,
                scaledLeft: 1840,
                isDimmed: true
            }
        ]);

        const shadows = renderModel.shadowPages();

        expect(shadows.map((shadow) => shadow.key)).toEqual(['shadow:left:a', 'shadow:right:d']);
    });

    it('undims the current transition target while it is still rendered as a shadow', () => {
        state.shadowPages.set([
            {
                key: 'shadow:right:b',
                unit: { id: 'b' } as never,
                unitId: 'b',
                unitIndex: 1,
                direction: 'right',
                originalLeft: 920,
                scaledLeft: 920,
                isDimmed: true
            }
        ]);
        state.activeTransition.set({
            phase: 'animating',
            request: { direction: 'right', source: 'keyboard', requestedAt: Date.now() },
            pagesToMove: 1,
            targetUnitId: 'b'
        });

        const shadows = renderModel.shadowPages();

        expect(shadows.length).toBe(1);
        expect(shadows[0].isDimmed).toBeFalse();
    });

    it('builds steady-state shadow descriptors from viewport layout', () => {
        state.setForceUnits([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as never[]);

        const shadows = renderModel.buildSteadyStateShadowPages({
            units: state.forceUnits(),
            startIndex: 1,
            visibleCount: 1,
            scale: 1,
            containerWidth: 2000,
            translateX: 0,
            displayedPositions: [0]
        });

        expect(shadows.map((shadow) => shadow.key)).toEqual(['right:2', 'right:3', 'right:0']);
        expect(shadows[0].unitId).toBe('c');
        expect(shadows[1].unitId).toBe('d');
        expect(shadows[2].unitId).toBe('a');
    });

    for (const visibleCount of [1, 3]) {
        it(`omits idle shadows when ${visibleCount} sheets fill the viewport edge to edge`, () => {
            state.setForceUnits(['a', 'b', 'c', 'd', 'e'].map(id => ({ id })) as never[]);
            for (const scale of [0.5, 1, 2]) {
                expect(renderModel.buildSteadyStateShadowPages({
                    units: state.forceUnits(), startIndex: 1, visibleCount, scale,
                    containerWidth: (visibleCount * 612 + (visibleCount - 1) * 20) * scale,
                    translateX: 0,
                    displayedPositions: Array.from({ length: visibleCount }, (_, index) => index * 632),
                })).toEqual([]);
            }
        });
    }

    it('keeps a partially visible neighbor but omits one that only touches the viewport edge', () => {
        state.setForceUnits(['a', 'b', 'c'].map(id => ({ id })) as never[]);
        const options = { units: state.forceUnits(), startIndex: 1, visibleCount: 1,
            scale: 1, containerWidth: 652, translateX: 20, displayedPositions: [0] };
        expect(renderModel.buildSteadyStateShadowPages(options)).toEqual([]);
        expect(renderModel.buildSteadyStateShadowPages({ ...options, containerWidth: 654, translateX: 21 })
            .map(page => page.direction)).toEqual(['left', 'right']);
    });
});
