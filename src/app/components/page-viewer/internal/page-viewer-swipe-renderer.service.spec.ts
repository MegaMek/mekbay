import { TestBed } from '@angular/core/testing';

import { PageViewerSwipeBindingService } from './page-viewer-swipe-binding.service';
import { PageViewerSwipeRenderPlanService } from './page-viewer-swipe-render-plan.service';
import { PageViewerSwipeRendererService } from './page-viewer-swipe-renderer.service';
import { PageViewerSwipeSlotService } from './page-viewer-swipe-slot.service';

function createSvg(): SVGSVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('PageViewerSwipeRendererService', () => {
    let service: PageViewerSwipeRendererService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                PageViewerSwipeSlotService,
                PageViewerSwipeBindingService,
                PageViewerSwipeRenderPlanService,
                PageViewerSwipeRendererService
            ]
        });

        service = TestBed.inject(PageViewerSwipeRendererService);
    });

    it('turns a losing attachment into a winning attach instruction after virtual clears', () => {
        const offscreenSlot = document.createElement('div');
        const visibleSlot = document.createElement('div');
        const desiredSvg = createSvg();
        offscreenSlot.appendChild(desiredSvg);

        const update = service.buildUpdate({
            slots: [
                {
                    slotIndex: 0,
                    slotOffset: -1,
                    slotLeft: 0,
                    slotRight: 1000,
                    unitIndex: 1,
                    element: offscreenSlot,
                    attachedSvg: desiredSvg
                },
                {
                    slotIndex: 1,
                    slotOffset: 0,
                    slotLeft: 1000,
                    slotRight: 2000,
                    unitIndex: 1,
                    element: visibleSlot,
                    attachedSvg: null
                }
            ],
            units: [
                { unitId: 'u0', svg: null },
                { unitId: 'u1', svg: desiredSvg }
            ],
            visibleLeft: 1000,
            visibleRight: 2000,
            scaledPageWidth: 1000,
            visiblePages: 1,
            addOnly: false,
            translateX: -1000,
            lastTranslateX: 0,
            currentDirection: 'none',
            selectedUnitId: 'u1'
        });

        expect(update.clearSlotIndices).toEqual([0]);
        expect(update.attachedUnitToSlotMap.has(1)).toBeFalse();
        expect(update.slotInstructions).toEqual([
            jasmine.objectContaining({
                slotIndex: 1,
                unitIndex: 1,
                unitId: 'u1',
                decision: jasmine.objectContaining({ action: 'attach', isSelected: true })
            })
        ]);
    });

    it('keeps fixed overlay mode when the dominant single visible slot already has the right svg', () => {
        const slot = document.createElement('div');
        const desiredSvg = createSvg();
        slot.appendChild(desiredSvg);

        const update = service.buildUpdate({
            slots: [{
                slotIndex: 0,
                slotOffset: 0,
                slotLeft: 0,
                slotRight: 1000,
                unitIndex: 0,
                element: slot,
                attachedSvg: desiredSvg
            }],
            units: [{ unitId: 'u0', svg: desiredSvg }],
            visibleLeft: 0,
            visibleRight: 1000,
            scaledPageWidth: 1000,
            visiblePages: 1,
            addOnly: false,
            translateX: 0,
            lastTranslateX: 0,
            currentDirection: 'none',
            selectedUnitId: 'u0'
        });

        expect(update.clearSlotIndices).toEqual([]);
        expect(update.slotInstructions).toEqual([
            jasmine.objectContaining({
                slotIndex: 0,
                unitIndex: 0,
                unitId: 'u0',
                decision: jasmine.objectContaining({ action: 'reuse-existing', overlayMode: 'fixed' })
            })
        ]);
    });
});