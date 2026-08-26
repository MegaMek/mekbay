// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';

import { PageViewerOverlayService } from './page-viewer-overlay.service';

function createAppRefSpy() {
    return {
        injector: {} as never,
        attachView: jasmine.createSpy('attachView'),
        detachView: jasmine.createSpy('detachView')
    };
}

describe('PageViewerOverlayService', () => {
    let service: PageViewerOverlayService;

    type OverlayRefStub = {
        location: { nativeElement: HTMLElement };
        hostView: unknown;
        instance: {
            closeAllOverlays: jasmine.Spy | (() => void);
            openTurnSummary: jasmine.Spy;
            openWeaponEquipmentDialog: jasmine.Spy;
        };
        setInput: jasmine.Spy;
        destroy: jasmine.Spy | (() => void);
    };

    type OverlayServiceTestAccess = {
        canvasOverlayRefs: Map<string, OverlayRefStub>;
        interactionOverlayRefs: Map<string, OverlayRefStub>;
        interactionOverlayModes: Map<string, 'fixed' | 'page'>;
    };

    function createOverlayRef(nativeElement: HTMLElement, options: {
        closeAllOverlays?: () => void;
        onDestroy?: () => void;
    } = {}): OverlayRefStub {
        return {
            location: { nativeElement },
            hostView: {},
            instance: {
                closeAllOverlays: options.closeAllOverlays ?? jasmine.createSpy('closeAllOverlays'),
                openTurnSummary: jasmine.createSpy('openTurnSummary'),
                openWeaponEquipmentDialog: jasmine.createSpy('openWeaponEquipmentDialog'),
            },
            setInput: jasmine.createSpy('setInput'),
            destroy: options.onDestroy ?? jasmine.createSpy('destroy')
        };
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerOverlayService]
        });

        service = TestBed.inject(PageViewerOverlayService);
    });

    it('returns only connected canvas overlay elements for requested units', () => {
        const serviceAccess = service as unknown as OverlayServiceTestAccess;
        const connected = document.createElement('div');
        const disconnected = document.createElement('div');
        document.body.appendChild(connected);

        try {
            serviceAccess.canvasOverlayRefs.set('unit-a', createOverlayRef(connected));
            serviceAccess.canvasOverlayRefs.set('unit-b', createOverlayRef(disconnected));

            expect(service.getCanvasOverlayElements(['unit-a', 'missing']).length).toBe(1);
        } finally {
            connected.remove();
        }
    });

    it('cleans up unused overlays and clears interaction overlay state', () => {
        const serviceAccess = service as unknown as OverlayServiceTestAccess;
        const appRef = createAppRefSpy();
        const interactionRef = createOverlayRef(document.createElement('div'));

        serviceAccess.interactionOverlayRefs.set('unit-a', interactionRef);
        serviceAccess.interactionOverlayModes.set('unit-a', 'page');

        service.cleanupUnusedInteractionOverlays(appRef as never, new Set());
        expect(appRef.detachView).toHaveBeenCalled();

        serviceAccess.interactionOverlayRefs.set('unit-b', interactionRef);
        serviceAccess.interactionOverlayModes.set('unit-b', 'fixed');
        service.closeInteractionOverlays();
        expect(interactionRef.instance.closeAllOverlays).toHaveBeenCalled();

        service.cleanupInteractionOverlays(appRef as never);
    });

    it('refreshes member and force inputs when an interaction overlay is reused', () => {
        const serviceAccess = service as unknown as OverlayServiceTestAccess;
        const ref = createOverlayRef(document.createElement('div'));
        const pageWrapper = document.createElement('div');
        const member = { id: 'unit-a' };
        const force = { id: 'force-a' };
        serviceAccess.interactionOverlayRefs.set(member.id, ref);
        serviceAccess.interactionOverlayModes.set(member.id, 'page');

        service.getOrCreateInteractionOverlay({
            appRef: createAppRefSpy() as never,
            injector: {} as never,
            pageWrapper,
            fixedOverlayContainer: document.createElement('div'),
            unit: member as never,
            force: force as never,
            mode: 'page',
        });

        expect(ref.setInput).toHaveBeenCalledWith('member', member);
        expect(ref.setInput).toHaveBeenCalledWith('force', force);
        expect(pageWrapper.lastElementChild).toBe(ref.location.nativeElement);
    });

    it('forwards the authored sheet equipment control to its requested dialog tab', () => {
        const serviceAccess = service as unknown as OverlayServiceTestAccess;
        const ref = createOverlayRef(document.createElement('div'));
        const event = new MouseEvent('click');
        serviceAccess.interactionOverlayRefs.set('unit-a', ref);

        service.openEquipment('unit-a', event, 'ammo');

        expect(ref.instance.openWeaponEquipmentDialog).toHaveBeenCalledOnceWith(event, 'ammo');
    });
});
