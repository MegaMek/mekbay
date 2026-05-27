import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { PickerFactoryService } from '../../services/picker-factory.service';
import { ToastService } from '../../services/toast.service';
import { SvgInteractionService } from './svg-interaction.service';
import type { ZoomPanServiceInterface } from './zoom-pan.interface';

type SvgInteractionServicePrivate = {
    addSvgTapHandler(
        el: SVGElement,
        handler: (evt: PointerEvent, primaryAction: boolean) => void,
        signal: AbortSignal
    ): void;
};

describe('SvgInteractionService', () => {
    let service: SvgInteractionServicePrivate;
    let zoomPanService: ZoomPanServiceInterface;

    beforeEach(() => {
        zoomPanService = {
            pointerMoved: false,
            isPanning: false
        };

        TestBed.configureTestingModule({
            providers: [
                SvgInteractionService,
                { provide: DataService, useValue: { getEquipments: () => ({}) } },
                { provide: DialogsService, useValue: { createDialog: jasmine.createSpy('createDialog') } },
                {
                    provide: EquipmentInteractionRegistryService,
                    useValue: {
                        getRegistry: () => ({
                            getChoices: () => [],
                            handleSelection: () => false
                        })
                    }
                },
                { provide: ForceBuilderService, useValue: { editPilotOfUnit: jasmine.createSpy('editPilotOfUnit') } },
                { provide: LayoutService, useValue: {} },
                {
                    provide: OptionsService,
                    useValue: {
                        options: () => ({
                            pickerStyle: 'default',
                            quickActions: 'disabled',
                            sheetsColor: 'day',
                            useAutomations: true
                        })
                    }
                },
                {
                    provide: PickerFactoryService,
                    useValue: {
                        createChoicePicker: jasmine.createSpy('createChoicePicker'),
                        createNumericPicker: jasmine.createSpy('createNumericPicker')
                    }
                },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } }
            ]
        });

        const injectedService = TestBed.inject(SvgInteractionService);
        injectedService.initialize(
            { nativeElement: document.createElement('div') },
            TestBed.inject(Injector),
            zoomPanService
        );
        service = injectedService as unknown as SvgInteractionServicePrivate;
    });

    it('keeps a captured pen tap alive when hover retargeting fires pointerleave before pointerup', () => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGElement;
        const abortController = new AbortController();
        const handler = jasmine.createSpy('handler');
        const setPointerCapture = spyOn(el, 'setPointerCapture').and.stub();
        const hasPointerCapture = spyOn(el, 'hasPointerCapture').and.returnValue(true);
        const releasePointerCapture = spyOn(el, 'releasePointerCapture').and.stub();

        service.addSvgTapHandler(el, handler, abortController.signal);

        el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 17, pointerType: 'pen', button: 0, buttons: 1 }));
        el.dispatchEvent(createPointerEvent('pointerleave', { pointerId: 17, pointerType: 'pen', buttons: 1 }));
        const upEvent = createPointerEvent('pointerup', { pointerId: 17, pointerType: 'pen', button: 0 });
        el.dispatchEvent(upEvent);

        expect(setPointerCapture).toHaveBeenCalledOnceWith(17);
        expect(hasPointerCapture).toHaveBeenCalledWith(17);
        expect(handler).toHaveBeenCalledOnceWith(upEvent, true);
        expect(releasePointerCapture).toHaveBeenCalledOnceWith(17);
    });

    it('completes a pen tap when hover retargeting moves pointerup away from the SVG element', () => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGElement;
        const abortController = new AbortController();
        const handler = jasmine.createSpy('handler');
        spyOn(el, 'setPointerCapture').and.throwError('unsupported');
        spyOn(el, 'hasPointerCapture').and.returnValue(false);
        spyOn(el, 'releasePointerCapture').and.stub();

        service.addSvgTapHandler(el, handler, abortController.signal);

        el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 23, pointerType: 'pen', button: 0, buttons: 1 }));
        el.dispatchEvent(createPointerEvent('pointerleave', { pointerId: 23, pointerType: 'pen', buttons: 1 }));
        const upEvent = createPointerEvent('pointerup', { pointerId: 23, pointerType: 'pen', button: 0 });
        window.dispatchEvent(upEvent);

        expect(handler).toHaveBeenCalledOnceWith(upEvent, true);
    });

    it('anchors tap action coordinates to pointerdown when the pen drifts before pointerup', () => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGElement;
        const abortController = new AbortController();
        const handler = jasmine.createSpy('handler');
        spyOn(el, 'setPointerCapture').and.stub();
        spyOn(el, 'hasPointerCapture').and.returnValue(true);
        spyOn(el, 'releasePointerCapture').and.stub();

        service.addSvgTapHandler(el, handler, abortController.signal);

        el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 41, pointerType: 'pen', button: 0, buttons: 1, clientX: 25, clientY: 30 }));
        el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 41, pointerType: 'pen', button: 0, clientX: 180, clientY: 210 }));

        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.calls.mostRecent().args[0] as PointerEvent;
        expect(event.type).toBe('pointerup');
        expect(event.clientX).toBe(25);
        expect(event.clientY).toBe(30);
        expect(handler.calls.mostRecent().args[1]).toBeTrue();
    });

    it('still cancels a mouse tap when the pointer leaves without capture', () => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGElement;
        const abortController = new AbortController();
        const handler = jasmine.createSpy('handler');
        spyOn(el, 'setPointerCapture').and.throwError('unsupported');
        spyOn(el, 'hasPointerCapture').and.returnValue(false);
        spyOn(el, 'releasePointerCapture').and.stub();

        service.addSvgTapHandler(el, handler, abortController.signal);

        el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1 }));
        el.dispatchEvent(createPointerEvent('pointerleave', { pointerId: 31, pointerType: 'mouse', buttons: 1 }));
        window.dispatchEvent(createPointerEvent('pointerup', { pointerId: 31, pointerType: 'mouse', button: 0 }));

        expect(handler).not.toHaveBeenCalled();
    });
});

function createPointerEvent(type: string, init: PointerEventInit): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        ...init
    });
}