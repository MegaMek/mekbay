import { TestBed } from '@angular/core/testing';

import { PageViewerActiveRenderService } from './page-viewer-active-render.service';

function createSvg(): SVGSVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('PageViewerActiveRenderService', () => {
    let service: PageViewerActiveRenderService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerActiveRenderService]
        });

        service = TestBed.inject(PageViewerActiveRenderService);
    });

    it('prunes transient shadows that overlap active units', () => {
        const transientShadow = document.createElement('div');
        transientShadow.dataset['unitId'] = 'a';
        const declarativeShadow = document.createElement('div');
        declarativeShadow.dataset['unitId'] = 'a';
        declarativeShadow.dataset['renderMode'] = 'declarative-shadow';
        const removeShadowPageElement = jasmine.createSpy('removeShadowPageElement');

        const remaining = service.pruneOverlappingShadows({
            shadowPageElements: [transientShadow, declarativeShadow],
            activeUnitIds: new Set(['a']),
            removeShadowPageElement
        });

        expect(removeShadowPageElement).toHaveBeenCalledOnceWith(transientShadow);
        expect(remaining).toEqual([declarativeShadow]);
    });

    it('binds active wrapper metadata and delegates svg attachment', () => {
        const wrapper = document.createElement('div');
        const svg = createSvg();
        const unit = { id: 'unit-a', svg: () => svg } as never;
        const attachSvgToWrapper = jasmine.createSpy('attachSvgToWrapper');
        const bindWrapperInteractiveLayers = jasmine.createSpy('bindWrapperInteractiveLayers');

        const bound = service.bindActivePageWrapper({
            unit,
            wrapper,
            slotIndex: 0,
            descriptor: {
                key: 'active:unit-a:0',
                unit,
                unitId: 'unit-a',
                unitIndex: 3,
                slotIndex: 0,
                role: 'active',
                overlayMode: 'fixed',
                originalLeft: 120,
                scaledLeft: 120,
                isSelected: true,
                isActive: true,
                isDimmed: false
            },
            setWrapperSelectedState: jasmine.createSpy('setWrapperSelectedState'),
            applyWrapperLayout: jasmine.createSpy('applyWrapperLayout'),
            attachSvgToWrapper,
            bindWrapperInteractiveLayers
        });

        expect(bound).toBeTrue();
        expect(wrapper.dataset['unitId']).toBe('unit-a');
        expect(wrapper.dataset['unitIndex']).toBe('3');
        expect(attachSvgToWrapper).toHaveBeenCalledWith({ wrapper, svg, setAsCurrent: true });
        expect(bindWrapperInteractiveLayers).toHaveBeenCalledWith(wrapper, unit, svg, 'fixed');
    });

    it('builds the active render finalization plan', () => {
        expect(service.buildFinalizePlan({
            applyCurrentTransform: true,
            initialRenderComplete: true,
            fromSwipe: false
        })).toEqual({
            shouldApplyCurrentTransform: true,
            shouldResetView: false,
            shouldRestoreViewState: false,
            fromSwipe: false,
            shouldFlushQueuedDirectionalNavigation: false,
            shouldMarkInitialRenderComplete: false
        });

        expect(service.buildFinalizePlan({
            applyCurrentTransform: false,
            initialRenderComplete: false,
            fromSwipe: true
        })).toEqual({
            shouldApplyCurrentTransform: false,
            shouldResetView: true,
            shouldRestoreViewState: false,
            fromSwipe: true,
            shouldFlushQueuedDirectionalNavigation: true,
            shouldMarkInitialRenderComplete: true
        });
    });
});