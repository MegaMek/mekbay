// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PageViewerComponent } from './page-viewer.component';
import type { PageViewerMember } from './internal/types';

describe('PageViewerComponent rendering', () => {
    let viewer: PageViewerComponent;

    beforeEach(() => {
        // Exercise the component's render operations without starting its async
        // sheet-loading effects or mounting the interactive viewer.
        viewer = Object.create(PageViewerComponent.prototype) as PageViewerComponent;
        Object.assign(viewer, {
            pageElements: [],
            initialRenderComplete: false,
            zoomPanService: jasmine.createSpyObj('zoomPan', ['setDisplayedPages', 'applyCurrentTransform', 'resetView']),
            pageViewerNavigation: jasmine.createSpyObj('navigation', ['consumeSelectionRedisplaySuppression']),
            pageViewerPresentation: jasmine.createSpyObj('presentation', ['updateSelectedPageHighlight']),
            displayedUnits: signal([]),
            forceUnits: signal([]),
            unit: signal(null),
            effectiveVisiblePageCount: signal(1),
            viewStartIndex: signal(0),
        });
        for (const method of [
            'removeShadowPageElement', 'setWrapperSelectedState', 'applyWrapperLayout',
            'attachSvgToWrapper', 'bindWrapperInteractiveLayers', 'cleanupUnusedInteractionServices',
            'cleanupUnusedCanvasOverlays', 'cleanupUnusedInteractionOverlays', 'syncZoomPanTransformTargets',
            'updateDimensions', 'restoreViewState', 'setFluffImageVisibility', 'scheduleRenderShadowPages',
            'flushQueuedDirectionalNavigation', 'saveViewState', 'displayUnit',
            'clearPages', 'closeInteractionOverlays', 'updateDisplayedPagesInPlace',
        ] as const) {
            spyOn(viewer as never, method);
        }
    });

    it('prunes only transient shadows overlapping active units', () => {
        const transientShadow = document.createElement('div');
        transientShadow.dataset['unitId'] = 'a';
        const declarativeShadow = document.createElement('div');
        declarativeShadow.dataset['unitId'] = 'a';
        declarativeShadow.dataset['renderMode'] = 'declarative-shadow';
        const neighbor = document.createElement('div');
        neighbor.dataset['unitId'] = 'b';
        viewer['shadowPageElements'] = [transientShadow, declarativeShadow, neighbor];

        viewer['pruneOverlappingShadows'](new Set(['a']));

        expect(viewer['removeShadowPageElement']).toHaveBeenCalledOnceWith(transientShadow);
        expect(viewer['shadowPageElements']).toEqual([declarativeShadow, neighbor]);
    });

    it('binds active wrapper metadata, SVG, and interactive layers', () => {
        const wrapper = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const unit = { id: 'unit-a', recordSheet: () => svg } as PageViewerMember;

        viewer['bindActivePageWrapper']({
            unit,
            wrapper,
            slotIndex: 0,
            descriptor: {
                key: 'active:unit-a:0', unit, unitId: unit.id, unitIndex: 3,
                slotIndex: 0, role: 'active', overlayMode: 'fixed', originalLeft: 120,
                scaledLeft: 120, isSelected: true, isActive: true, isDimmed: false,
            },
        });

        expect(wrapper.dataset['unitId']).toBe('unit-a');
        expect(wrapper.dataset['unitIndex']).toBe('3');
        expect(viewer['attachSvgToWrapper']).toHaveBeenCalledOnceWith({ wrapper, svg, setAsCurrent: true });
        expect(viewer['bindWrapperInteractiveLayers']).toHaveBeenCalledOnceWith(wrapper, unit, svg, 'fixed');
    });

    it('preserves the current transform and navigation queue for an in-place update', () => {
        viewer['initialRenderComplete'] = true;
        viewer['finalizeActivePageRender'](new Set(), { applyCurrentTransform: true });

        expect(viewer['zoomPanService'].applyCurrentTransform).toHaveBeenCalled();
        expect(viewer['zoomPanService'].resetView).not.toHaveBeenCalled();
        expect(viewer['restoreViewState']).not.toHaveBeenCalled();
        expect(viewer['updateDimensions']).not.toHaveBeenCalled();
        expect(viewer['flushQueuedDirectionalNavigation']).not.toHaveBeenCalled();
    });

    it('resets the initial view, then restores subsequent views with swipe context', () => {
        viewer['finalizeActivePageRender'](new Set());

        expect(viewer['zoomPanService'].resetView).toHaveBeenCalledTimes(1);
        expect(viewer['restoreViewState']).not.toHaveBeenCalled();
        expect(viewer['initialRenderComplete']).toBeTrue();

        viewer['finalizeActivePageRender'](new Set(), { fromSwipe: true });

        expect(viewer['zoomPanService'].resetView).toHaveBeenCalledTimes(1);
        expect(viewer['restoreViewState']).toHaveBeenCalledOnceWith({ fromSwipe: true });
        expect(viewer['flushQueuedDirectionalNavigation']).toHaveBeenCalledTimes(2);
    });

    it('updates only the highlight when the new selection is already visible', () => {
        const previousUnit = { id: 'unit-a' } as PageViewerMember;
        const currentUnit = { id: 'unit-b' } as PageViewerMember;
        viewer['displayedUnits'].set([currentUnit]);

        viewer['applySelectionChange'](previousUnit, currentUnit);

        expect(viewer['saveViewState']).toHaveBeenCalledOnceWith(previousUnit);
        expect(viewer['pageViewerPresentation'].updateSelectedPageHighlight).toHaveBeenCalledOnceWith([], 'unit-b');
        expect(viewer['displayUnit']).not.toHaveBeenCalled();
    });

    it('moves the viewport to an off-screen selection and preserves first-display handling', () => {
        const currentUnit = { id: 'unit-b' } as PageViewerMember;
        Object.assign(viewer, { forceUnits: signal([{ id: 'unit-a' } as PageViewerMember, currentUnit]) });

        viewer['applySelectionChange'](null, currentUnit);

        expect(viewer['viewStartIndex']()).toBe(1);
        expect(viewer['displayUnit']).toHaveBeenCalledOnceWith({ fromSwipe: true });
    });

    it('saves the old viewport without redisplaying a selection consumed by navigation', () => {
        const previousUnit = { id: 'unit-a' } as PageViewerMember;
        const currentUnit = { id: 'unit-b' } as PageViewerMember;
        (viewer['pageViewerNavigation'].consumeSelectionRedisplaySuppression as jasmine.Spy).and.returnValue(true);

        viewer['applySelectionChange'](previousUnit, currentUnit);

        expect(viewer['saveViewState']).toHaveBeenCalledOnceWith(previousUnit);
        expect(viewer['displayUnit']).not.toHaveBeenCalled();
        expect(viewer['pageViewerPresentation'].updateSelectedPageHighlight).not.toHaveBeenCalled();
    });

    it('clears the viewer when the last force unit is removed', () => {
        viewer['handleForceUnitsChanged'](1);

        expect(viewer['clearPages']).toHaveBeenCalledTimes(1);
        expect(viewer['updateDimensions']).not.toHaveBeenCalled();
        expect(viewer['displayUnit']).not.toHaveBeenCalled();
    });

    it('keeps the selected sheet in its slot when units are inserted before it', () => {
        const units = ['a', 'c', 'b', 'd'].map(id => ({ id }) as PageViewerMember);
        Object.assign(viewer, {
            forceUnits: signal(units),
            displayedUnits: signal([units[0], units[2]]),
            unit: signal(units[2]),
            effectiveVisiblePageCount: signal(2),
            pageElements: [document.createElement('div'), document.createElement('div')],
        });

        viewer['handleForceUnitsChanged'](4);

        expect(viewer['viewStartIndex']()).toBe(1);
        expect(viewer['closeInteractionOverlays']).toHaveBeenCalled();
        expect(viewer['updateDisplayedPagesInPlace']).toHaveBeenCalledOnceWith({ preserveSelectedUnitId: 'b' });
        expect(viewer['displayUnit']).not.toHaveBeenCalled();
    });

    it('rebuilds the display when the selected sheet has no slot to preserve', () => {
        const units = ['a', 'b', 'c'].map(id => ({ id }) as PageViewerMember);
        Object.assign(viewer, {
            forceUnits: signal(units),
            displayedUnits: signal([{ id: 'x' } as PageViewerMember]),
            unit: signal(units[1]),
            pageElements: [document.createElement('div')],
        });

        viewer['handleForceUnitsChanged'](2);

        expect(viewer['displayUnit']).toHaveBeenCalled();
        expect(viewer['updateDisplayedPagesInPlace']).not.toHaveBeenCalled();
    });

    describe('shadow navigation', () => {
        beforeEach(() => {
            Object.assign(viewer, {
                pageViewerSwipeAnimation: jasmine.createSpyObj('animation', ['hasActiveAnimation', 'setPendingPagesToMove', 'clearPendingPagesToMove']),
                pageViewerNavigation: jasmine.createSpyObj('navigation', ['buildRequest', 'startTransition', 'finishTransition', 'suppressNextSelectionRedisplay']),
                pageViewerViewState: jasmine.createSpyObj('viewState', ['saveSharedViewState']),
                pageViewerState: { transientShadowPages: signal([]) },
                forceWorkspace: jasmine.createSpyObj('workspace', ['selectUnit']),
                optionsService: { options: () => ({ printAllOptions: { recordSheetCenterPanelContent: 'referenceTables' } }) },
                zoomPanService: { scale: () => 1 },
                swipeWrapperRef: () => ({ nativeElement: document.createElement('div') }),
                swipeVersion: 0,
            });
            spyOn(viewer as never, 'captureCurrentViewState');
            spyOn(viewer as never, 'createIncomingShadowPages');
            spyOn(viewer as never, 'startSwipeAnimation');
        });

        it('starts a directional transition and finishes at the calculated display index', () => {
            const units = Array.from({ length: 6 }, (_, index) => ({ id: String(index), recordSheet: () => null }) as PageViewerMember);
            Object.assign(viewer, { forceUnits: signal(units), effectiveVisiblePageCount: signal(2) });
            const shadow = document.createElement('div');
            shadow.dataset['shadowDirection'] = 'right';

            viewer['navigateToShadowPage'](units[3], 3, shadow);

            expect(viewer['pageViewerNavigation'].buildRequest).toHaveBeenCalledOnceWith('right', 'shadow');
            expect(viewer['pageViewerNavigation'].startTransition).toHaveBeenCalled();
            expect(viewer['pageViewerSwipeAnimation'].setPendingPagesToMove).toHaveBeenCalledOnceWith(2);
            const animation = (viewer['startSwipeAnimation'] as jasmine.Spy).calls.mostRecent().args[0];
            expect(animation.transform).toBe('translate3d(-1264px, 0, 0)');
            animation.onComplete();
            expect(viewer['pageViewerNavigation'].finishTransition).toHaveBeenCalledOnceWith(2, '3');
        });

        it('preserves leftward fallback without starting a transition when the direction is missing', () => {
            const units = Array.from({ length: 5 }, (_, index) => ({ id: String(index), recordSheet: () => null }) as PageViewerMember);
            Object.assign(viewer, { forceUnits: signal(units), zoomPanService: { scale: () => 0.5 } });
            viewer['viewStartIndex'].set(2);

            viewer['navigateToShadowPage'](units[0], 0, document.createElement('div'), 'keyboard');

            expect(viewer['pageViewerNavigation'].startTransition).not.toHaveBeenCalled();
            expect(viewer['pageViewerSwipeAnimation'].setPendingPagesToMove).toHaveBeenCalledOnceWith(-2);
            const animation = (viewer['startSwipeAnimation'] as jasmine.Spy).calls.mostRecent().args[0];
            expect(animation.transform).toBe('translate3d(632px, 0, 0)');
            animation.onComplete();
            expect(viewer['pageViewerNavigation'].finishTransition).toHaveBeenCalledOnceWith(0, '0');
        });
    });
});

describe('PageViewerComponent change tracking', () => {
    let viewer: PageViewerComponent;
    let units: WritableSignal<PageViewerMember[]>;
    let options: WritableSignal<{ allowMultipleActiveSheets: boolean }>;
    let readOnly: WritableSignal<boolean>;
    let initialized: WritableSignal<boolean>;

    beforeEach(() => {
        viewer = Object.create(PageViewerComponent.prototype) as PageViewerComponent;
        units = signal<PageViewerMember[]>([]);
        options = signal({ allowMultipleActiveSheets: false });
        readOnly = signal(false);
        initialized = signal(false);
        Object.assign(viewer, {
            injector: TestBed.inject(Injector),
            forceUnits: units,
            optionsService: { options },
            readOnly,
            viewInitialized: initialized,
            isSwiping: false,
        });
        spyOn(viewer as never, 'handleForceUnitsChanged');
        spyOn(viewer as never, 'displayUnit');
        viewer['watchForceUnits']();
        viewer['watchDisplayOptions']();
        TestBed.tick();
    });

    it('records force membership before initialization without redisplaying it on initialization', () => {
        units.set([{ id: 'a' }, { id: 'b' }] as PageViewerMember[]);
        TestBed.tick();
        initialized.set(true);
        TestBed.tick();

        expect(viewer['handleForceUnitsChanged']).not.toHaveBeenCalled();
        expect(viewer['displayUnit']).not.toHaveBeenCalled();
    });

    it('reacts to additions, removals, and reordered ids with the previous member count', () => {
        const a = { id: 'a' } as PageViewerMember;
        const b = { id: 'b' } as PageViewerMember;
        const c = { id: 'c' } as PageViewerMember;
        units.set([a, b]);
        TestBed.tick();
        initialized.set(true);
        TestBed.tick();

        units.set([a, c, b]);
        TestBed.tick();
        units.set([a, c]);
        TestBed.tick();
        units.set([c, a]);
        TestBed.tick();

        expect((viewer['handleForceUnitsChanged'] as jasmine.Spy).calls.allArgs()).toEqual([[2], [3], [2]]);
        units.set([{ id: 'c' }, { id: 'a' }] as PageViewerMember[]);
        TestBed.tick();
        expect(viewer['handleForceUnitsChanged']).toHaveBeenCalledTimes(3);
    });

    it('redisplays once for a combined layout and ownership change', () => {
        initialized.set(true);
        TestBed.tick();
        options.set({ allowMultipleActiveSheets: true });
        readOnly.set(true);
        TestBed.tick();

        expect(viewer['displayUnit']).toHaveBeenCalledTimes(1);
        readOnly.set(false);
        TestBed.tick();
        expect(viewer['displayUnit']).toHaveBeenCalledTimes(2);

        options.set({ allowMultipleActiveSheets: true });
        TestBed.tick();
        expect(viewer['displayUnit']).toHaveBeenCalledTimes(2);
    });

    it('consumes option changes before initialization and during swipes without replaying them later', () => {
        options.set({ allowMultipleActiveSheets: true });
        TestBed.tick();
        initialized.set(true);
        TestBed.tick();
        viewer['isSwiping'] = true;
        options.set({ allowMultipleActiveSheets: false });
        readOnly.set(true);
        TestBed.tick();
        viewer['isSwiping'] = false;
        options.set({ allowMultipleActiveSheets: false });
        TestBed.tick();

        expect(viewer['displayUnit']).not.toHaveBeenCalled();
        readOnly.set(false);
        TestBed.tick();
        expect(viewer['displayUnit']).toHaveBeenCalledTimes(1);
    });
});
