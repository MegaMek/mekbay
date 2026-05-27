import { TestBed } from '@angular/core/testing';

import { PageViewerShadowRenderService } from './page-viewer-shadow-render.service';

function createSvg(): SVGSVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('PageViewerShadowRenderService', () => {
    let service: PageViewerShadowRenderService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerShadowRenderService]
        });

        service = TestBed.inject(PageViewerShadowRenderService);
    });

    it('binds declarative shadow wrappers with a stable click binding', () => {
        const wrapper = document.createElement('div');
        wrapper.dataset['shadowKey'] = 'right:2';
        const unitSvg = createSvg();
        const onShadowClick = jasmine.createSpy('onShadowClick');
        const cleanups = service.bindDeclarativeShadowPages({
            wrappers: [wrapper],
            currentCleanups: [],
            descriptors: [{
                key: 'right:2',
                unit: { svg: () => unitSvg } as never,
                unitId: 'u2',
                unitIndex: 2,
                direction: 'right',
                originalLeft: 920,
                scaledLeft: 920,
                isDimmed: true
            }],
            scale: 1,
            showFluff: true,
            setPromotedShadowState: jasmine.createSpy('setPromotedShadowState'),
            applyWrapperLayout: jasmine.createSpy('applyWrapperLayout'),
            setPageWrapperContentState: jasmine.createSpy('setPageWrapperContentState'),
            applyFluffImageVisibilityToSvg: jasmine.createSpy('applyFluffImageVisibilityToSvg'),
            onShadowClick
        });

        expect(cleanups.length).toBe(0);
        expect(wrapper.querySelector('svg')).not.toBeNull();

        wrapper.click();

        expect(onShadowClick).toHaveBeenCalledTimes(1);
    });

    it('reuses an existing cloned svg when rebinding the same unit', () => {
        const wrapper = document.createElement('div');
        wrapper.dataset['shadowKey'] = 'right:2';
        const unitSvg = createSvg();

        service.bindDeclarativeShadowPages({
            wrappers: [wrapper],
            currentCleanups: [],
            descriptors: [{
                key: 'right:2',
                unit: { svg: () => unitSvg } as never,
                unitId: 'u2',
                unitIndex: 2,
                direction: 'right',
                originalLeft: 920,
                scaledLeft: 920,
                isDimmed: true
            }],
            scale: 1,
            showFluff: true,
            setPromotedShadowState: jasmine.createSpy('setPromotedShadowState'),
            applyWrapperLayout: jasmine.createSpy('applyWrapperLayout'),
            setPageWrapperContentState: jasmine.createSpy('setPageWrapperContentState'),
            applyFluffImageVisibilityToSvg: jasmine.createSpy('applyFluffImageVisibilityToSvg'),
            onShadowClick: jasmine.createSpy('onShadowClick')
        });

        const firstClone = wrapper.querySelector('svg');

        service.bindDeclarativeShadowPages({
            wrappers: [wrapper],
            currentCleanups: [],
            descriptors: [{
                key: 'right:2',
                unit: { svg: () => unitSvg } as never,
                unitId: 'u2',
                unitIndex: 2,
                direction: 'right',
                originalLeft: 920,
                scaledLeft: 920,
                isDimmed: true
            }],
            scale: 1.2,
            showFluff: false,
            setPromotedShadowState: jasmine.createSpy('setPromotedShadowState'),
            applyWrapperLayout: jasmine.createSpy('applyWrapperLayout'),
            setPageWrapperContentState: jasmine.createSpy('setPageWrapperContentState'),
            applyFluffImageVisibilityToSvg: jasmine.createSpy('applyFluffImageVisibilityToSvg'),
            onShadowClick: jasmine.createSpy('onShadowClick')
        });

        expect(wrapper.querySelector('svg')).toBe(firstClone);
    });

    it('collects existing shadow keys from current shadow wrappers', () => {
        const left = document.createElement('div');
        left.dataset['unitIndex'] = '1';
        left.dataset['shadowDirection'] = 'left';
        const right = document.createElement('div');
        right.dataset['unitIndex'] = '3';
        right.dataset['shadowDirection'] = 'right';

        const keys = service.collectExistingShadowKeys([left, right], (unitIndex, direction) => `${direction}:${unitIndex}`);

        expect(Array.from(keys)).toEqual(['left:1', 'right:3']);
    });

    it('clears shadow wrappers and resets bookkeeping', () => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<span>x</span>';
        const cleanup = jasmine.createSpy('cleanup');

        const state = service.clearShadowPages({
            shadowPageElements: [wrapper],
            shadowPageCleanups: [cleanup]
        });

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(wrapper.innerHTML).toBe('');
        expect(state.shadowPageElements).toEqual([]);
        expect(state.shadowPageCleanups).toEqual([]);
    });
});