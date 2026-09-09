// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, ElementRef, inject, Renderer2, signal, viewChild, viewChildren } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { PageViewerComponent } from './page-viewer.component';
import { PageViewerZoomPanService } from './page-viewer-zoom-pan.service';
import { PageViewerRenderModelService } from './internal/page-viewer-render-model.service';
import { PageViewerStateService } from './internal/page-viewer-state.service';
import type { PageViewerMember } from './internal/types';
import { ViewerPageComponent } from './parts/viewer-page/viewer-page.component';
import { ViewerShadowPageComponent } from './parts/viewer-shadow-page/viewer-shadow-page.component';
import { PageViewerShadowRenderService } from './internal/page-viewer-shadow-render.service';
import { PageViewerSheetSourceService } from './internal/page-viewer-sheet-source.service';

@Component({
    imports: [ViewerPageComponent, ViewerShadowPageComponent],
    template: `<div #content>
        @for (page of model.activePages(); track page.key) {
            <viewer-page [descriptor]="page"></viewer-page>
        }
        @for (shadow of model.shadowPages(); track shadow.key) {
            <viewer-shadow-page [descriptor]="shadow"></viewer-shadow-page>
        }
    </div>`,
    providers: [PageViewerStateService, PageViewerRenderModelService, PageViewerShadowRenderService,
        { provide: PageViewerSheetSourceService, useValue: {} }, {
        provide: PageViewerZoomPanService,
        useValue: { pageWidth: () => 612, pageHeight: () => 792 },
    }],
})
class PageHost {
    readonly state = inject(PageViewerStateService);
    readonly model = inject(PageViewerRenderModelService);
    readonly renderer = inject(Renderer2);
    readonly content = viewChild.required<ElementRef<HTMLDivElement>>('content');
    readonly pages = viewChildren(ViewerPageComponent);
    readonly shadows = viewChildren(ViewerShadowPageComponent);
}

function sheetUnit(id: string): PageViewerMember {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.dataset['sheetUnitId'] = id;
    return { id, recordSheet: () => svg } as PageViewerMember;
}

describe('PageViewerComponent Angular page reconciliation', () => {
    let fixture: ComponentFixture<PageHost>;
    let host: PageHost;
    let viewer: PageViewerComponent;
    let units: PageViewerMember[];
    let loadUnits: jasmine.Spy;

    beforeEach(() => {
        fixture = TestBed.createComponent(PageHost);
        host = fixture.componentInstance;
        units = ['a', 'b', 'c', 'd', 'e'].map(sheetUnit);
        host.state.setForceUnits(units);
        host.state.visiblePageCount.set(3);
        host.state.setSelectedUnitId('b');
        host.state.setViewStartIndex(1);
        fixture.detectChanges();

        // Keep Angular's actual keyed wrappers and the component's SVG binding;
        // omit unrelated sheet generation, runtime mechanics and zoom gestures.
        viewer = Object.create(PageViewerComponent.prototype) as PageViewerComponent;
        Object.assign(viewer, {
            injector: fixture.debugElement.injector,
            renderer: host.renderer,
            contentRef: host.content,
            activePageComponentRefs: host.pages,
            rewriteActivePages: host.model.activePages,
            forceUnits: host.state.forceUnits,
            viewStartIndex: host.state.viewStartIndex,
            effectiveVisiblePageCount: host.state.effectiveVisiblePageCount,
            unit: signal(units[1]),
            displayedUnits: signal(units.slice(1, 4)),
            pageElements: [],
            shadowPageElements: [],
            displayVersion: 0,
            asyncNavigationVersion: 0,
            loadError: signal(null),
            currentSvg: signal(null),
            zoomPanService: { pageWidth: () => 612, pageHeight: () => 792 },
        });
        for (const method of [
            'bindWrapperInteractiveLayers', 'finalizeActivePageRender',
            'closeInteractionOverlays', 'updateDimensions', 'clearShadowPages',
            'syncZoomPanTransformTargets',
        ] as const) spyOn(viewer as never, method);
        loadUnits = spyOn(viewer as never, 'loadUnits').and.resolveTo();
        viewer['renderPages']();
        TestBed.tick();
    });

    async function settle(): Promise<void> {
        await Promise.resolve();
        TestBed.tick();
        await fixture.whenStable();
    }

    function shadowViewport(initialWidth: number) {
        let width = initialWidth;
        const container = document.createElement('div');
        Object.defineProperty(container, 'clientWidth', { get: () => width });
        Object.assign(viewer, {
            containerRef: () => ({ nativeElement: container }),
            pageViewerState: host.state, pageViewerRenderModel: host.model,
            pageViewerShadowRender: fixture.debugElement.injector.get(PageViewerShadowRenderService),
            shadowPageComponentRefs: host.shadows, rewriteShadowPages: host.model.shadowPages,
            shadowPages: () => true, performanceMode: () => false,
            shadowRenderVersion: 0, shadowRenderFrameId: null, shadowPageCleanups: [],
            optionsService: { options: () => ({ printAllOptions: { recordSheetCenterPanelContent: 'referenceTables' } }) },
            pageViewerPresentation: { applyFluffImageVisibilityToSvg: () => {} },
            zoomPanService: { pageWidth: () => 612, pageHeight: () => 792, scale: () => 1,
                translate: () => ({ x: (width - 1876) / 2, y: 0 }),
                getPagePositions: (count: number) => Array.from({ length: count }, (_, index) => index * 632) },
        });
        (viewer['clearShadowPages'] as jasmine.Spy).and.callThrough();
        spyOn(viewer as never, 'navigateToShadowPage');
        return (next: number) => width = next;
    }

    it('reuses visible shadow clones and removes all shadow DOM when the viewport becomes edge-to-edge', async () => {
        const resize = shadowViewport(2030);
        await viewer['renderShadowPages']();
        await settle();
        const wrappers = host.shadows().map(page => page.nativeElement);
        const clones = wrappers.map(wrapper => wrapper.querySelector('svg'));
        expect(clones.length).toBe(2);
        expect(clones.every(Boolean)).toBeTrue();
        await viewer['renderShadowPages']();
        await settle();
        expect(host.shadows().map(page => page.nativeElement.querySelector('svg'))).toEqual(clones);
        expect(host.shadows()[0].nativeElement.querySelector('svg')).toBe(clones[0]);
        loadUnits.calls.reset();
        resize(1876);
        await viewer['renderShadowPages']();
        await settle();
        expect(host.shadows()).toEqual([]);
        expect(host.content().nativeElement.querySelectorAll('.shadow-page').length).toBe(0);
        expect(viewer['shadowPageCleanups']).toEqual([]);
        expect(loadUnits).not.toHaveBeenCalled();
        wrappers[0].click();
        expect(viewer['navigateToShadowPage']).not.toHaveBeenCalled();
    });

    it('does not attach a late neighboring sheet after a newer layout has no room for shadows', async () => {
        const resize = shadowViewport(2030);
        let complete!: () => void;
        loadUnits.and.returnValue(new Promise<void>(resolve => complete = resolve));
        const pending = viewer['renderShadowPages']();
        resize(1876);
        await viewer['renderShadowPages']();
        complete();
        await pending;
        await settle();
        expect(host.shadows()).toEqual([]);
        expect(host.state.shadowPages()).toEqual([]);
    });

    function expectSheets(expected: PageViewerMember[]): void {
        const wrappers = host.pages().map(page => page.nativeElement);
        expect(viewer['pageElements']).toEqual(wrappers);
        expect(viewer['displayedUnits']()).toEqual(expected);
        expect(wrappers.length).toBe(expected.length);
        expected.forEach((unit, index) => {
            expect(wrappers[index].dataset['unitId']).toBe(unit.id);
            expect(wrappers[index].dataset['unitIndex']).toBe(String(host.state.forceUnits().indexOf(unit)));
            expect(wrappers[index].querySelector(':scope > svg')).toBe(unit.recordSheet());
        });
    }

    it('keeps all three sheets attached when the selected second unit moves down to third', async () => {
        const selectedWrapper = host.pages()[0].nativeElement;
        host.state.setForceUnits([units[0], units[2], units[1], units[3], units[4]]);
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets([units[1], units[3], units[4]]);
        expect(host.pages()[0].nativeElement).toBe(selectedWrapper);
        expect(viewer['finalizeActivePageRender']).toHaveBeenCalledWith(jasmine.any(Set), { applyCurrentTransform: true });
    });

    it('keeps all three sheets attached when the selected unit moves upward', async () => {
        host.state.setForceUnits([units[1], units[0], units[2], units[3], units[4]]);
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets([units[1], units[0], units[2]]);
    });

    it('keeps the selected middle slot when a preceding unit moves after it', async () => {
        Object.assign(viewer, { unit: signal(units[2]) });
        host.state.setSelectedUnitId('c');
        host.state.setForceUnits([units[0], units[2], units[1], units[3], units[4]]);
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets([units[0], units[2], units[1]]);
    });

    it('rebinds a visible neighbor replaced under the same roster ID', async () => {
        const replacement = sheetUnit('c');
        host.state.setForceUnits([units[0], units[1], replacement, units[3], units[4]]);
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets([units[1], replacement, units[3]]);
    });

    it('rebinds a replacement selected sheet without retaining its old SVG', async () => {
        const replacement = sheetUnit('b');
        Object.assign(viewer, { unit: signal(replacement) });
        host.state.setForceUnits([units[0], replacement, ...units.slice(2)]);
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets([replacement, units[2], units[3]]);
        expect(viewer.currentSvg()).toBe(replacement.recordSheet());
    });

    it('wraps the neighboring slots when the selected unit moves to the end', async () => {
        host.state.setForceUnits([units[0], ...units.slice(2), units[1]]);
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets([units[1], units[0], units[2]]);
    });

    it('refreshes retained wrapper indices after a preceding unit is removed', async () => {
        host.state.setForceUnits(units.slice(1));
        viewer['handleForceUnitsChanged'](5);
        await settle();

        expectSheets(units.slice(1, 4));
    });

    it('keeps sheets and wrapper descriptors aligned when the viewport fits the entire force', async () => {
        host.state.visiblePageCount.set(5);
        viewer['displayUnit']({ fromSwipe: true });
        await settle();

        expect(host.state.viewStartIndex()).toBe(0);
        expectSheets(units);
    });

    it('ignores an earlier reorder load that finishes after a later reorder', async () => {
        let resolveLoad!: () => void;
        loadUnits.and.returnValue(new Promise<void>(resolve => { resolveLoad = resolve; }));
        host.state.setForceUnits([units[0], units[2], units[1], units[3], units[4]]);
        viewer['handleForceUnitsChanged'](5);
        TestBed.tick();

        loadUnits.and.resolveTo();
        host.state.setForceUnits([units[1], units[0], ...units.slice(2)]);
        viewer['handleForceUnitsChanged'](5);
        await settle();
        expectSheets([units[1], units[0], units[2]]);

        const bindCount = (viewer['bindWrapperInteractiveLayers'] as jasmine.Spy).calls.count();
        resolveLoad();
        await settle();
        expectSheets([units[1], units[0], units[2]]);
        expect(viewer['bindWrapperInteractiveLayers']).toHaveBeenCalledTimes(bindCount);
    });

    it('allows page flips on a secondary active sheet', () => {
        const unit = units[2];
        const nextSheet = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        Object.assign(unit, { showNextRecordSheet: () => nextSheet });
        Object.assign(viewer, {
            optionsService: { options: () => ({ printAllOptions: { recordSheetCenterPanelContent: 'referenceTables' } }) },
            pageViewerPresentation: jasmine.createSpyObj('presentation', ['applyFluffImageVisibilityToSvg']),
        });
        Object.assign(viewer['zoomPanService'], { applyCurrentTransform: jasmine.createSpy() });
        const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        control.classList.add('record-sheet-page-flip-control');
        unit.recordSheet()!.appendChild(control);
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        control.addEventListener('click', event => viewer['onRecordSheetPageFlip'](event));
        control.dispatchEvent(event);

        expect(host.pages()[1].nativeElement.querySelector(':scope > svg')).toBe(nextSheet);
        expect(viewer.currentSvg()).toBe(units[1].recordSheet());
        expect(event.defaultPrevented).toBeTrue();
    });

    it('does not revive a pending render after clearing the viewer', async () => {
        let rejectLoad!: (error: Error) => void;
        loadUnits.and.returnValue(new Promise<void>((_resolve, reject) => { rejectLoad = reject; }));
        viewer['displayUnit']();
        viewer['clearPages']();
        rejectLoad(new Error('stale sheet failure'));
        await settle();

        expect(viewer.loadError()).toBeNull();
        expect(viewer.currentSvg()).toBeNull();
        expect(viewer['displayedUnits']()).toEqual([]);
    });

    it('ignores a pending load after a display with no selected unit', async () => {
        let rejectLoad!: (error: Error) => void;
        loadUnits.and.returnValue(new Promise<void>((_resolve, reject) => { rejectLoad = reject; }));
        viewer['displayUnit']();
        Object.assign(viewer, { unit: signal(null) });
        viewer['displayUnit']();
        rejectLoad(new Error('stale sheet failure'));
        await settle();

        expect(viewer.loadError()).toBeNull();
        expect(viewer.currentSvg()).toBeNull();
    });

    it('ignores a retry failure after the viewer is cleared', async () => {
        let rejectLoad!: (error: Error) => void;
        Object.assign(viewer, {
            pageViewerSheetSource: {
                load: () => new Promise<void>((_resolve, reject) => { rejectLoad = reject; }),
            },
        });
        viewer.retryLoad();
        viewer['clearPages']();
        rejectLoad(new Error('stale retry failure'));
        await settle();

        expect(viewer.loadError()).toBeNull();
        expect(viewer.currentSvg()).toBeNull();
    });
});
