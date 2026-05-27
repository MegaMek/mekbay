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