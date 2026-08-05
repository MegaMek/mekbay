import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DataService } from '../../services/data.service';
import { EquipmentRegistry } from '../../models/equipment-lookup';
import { DialogsService } from '../../services/dialogs.service';
import { EquipmentInteractionRegistryService } from '../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { PickerFactoryService } from '../../services/picker-factory.service';
import { ToastService } from '../../services/toast.service';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { EquipmentDialogComponent } from '../equipment-dialog/equipment-dialog.component';
import { MountedEquipment } from '../../models/mounted-equipment.model';
import { InventoryControlRuntimeState, type InventoryControlRuntimeRangeKey } from '../../models/inventory-control-runtime-state.model';
import { INVENTORY_CONTROL_MODE_STATE } from '../../utils/inventory-control.util';
import { RISC_LASER_PULSE_MODE, RISC_LASER_STANDARD_MODE } from '../../equipment-handlers/risc-laser-pulse-module.handler';
import { SvgInteractionService } from './svg-interaction.service';
import type { ZoomPanServiceInterface } from './zoom-pan.interface';
import { PageViewerStateService } from './internal/page-viewer-state.service';
import { CORE_2026_GAME_RULES } from '../../models/rules/game-rules';

type SvgInteractionServicePrivate = {
    addSvgTapHandler(
        el: SVGElement,
        handler: (evt: PointerEvent, primaryAction: boolean) => void,
        signal: AbortSignal,
        capture?: boolean
    ): void;
    updateUnit(unit: any): void;
    setupInteractions(svg: SVGSVGElement): void;
    setupReadOnlyInteractions(svg: SVGSVGElement): void;
    cleanup(): void;
    getHeatDiffMarkerData(): { el: SVGElement | null; heat: number; baselineHeat: number; containerRect: DOMRect } | null;
    updateHeatHighlight(heatValue: number): void;
    locationConditionDropdownChoices(unit: any, loc: string): Array<{ key: string }>;
    setupLocationConditionInteractions(svg: SVGSVGElement, signal: AbortSignal): void;
};

const NO_CONDITION_RULES = {
    conditionControls: [],
    crewStateControls: [],
    locationConditionControls: [],
    computeAllEntryStates: () => new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>(),
    computeEntryState: (entry: MountedEquipment) => ({ isDamaged: entry.committedDestroyed(), isDisabled: false, hitMod: 0 }),
    heatDissipation: () => null,
    getTargetNumberGunnerySkill: () => 4,
    getTargetNumberPilotingSkill: () => 5,
    getTargetNumberGunneryModifierBreakdown: () => [],
    getTargetNumberPilotingModifierBreakdown: () => [],
    getPhysicalAttackModifierBreakdown: () => [],
};

function createSvgInteractionUnit<T extends object>(overrides: T): T & { getInventory: () => MountedEquipment[]; rules: typeof NO_CONDITION_RULES } {
    const unit = {
        getInventory: () => [],
        isEquipmentUnavailable: () => false,
        rules: NO_CONDITION_RULES,
        ...overrides,
    } as T & {
        getInventory: () => MountedEquipment[];
        isEquipmentUnavailable: (entry: MountedEquipment) => boolean;
        isEquipmentActionUnavailable?: (entry: MountedEquipment) => boolean;
        rules: typeof NO_CONDITION_RULES;
    };
    unit.isEquipmentActionUnavailable ??= entry => unit.isEquipmentUnavailable(entry);
    return unit;
}

describe('SvgInteractionService', () => {
    let service: SvgInteractionServicePrivate;
    let zoomPanService: ZoomPanServiceInterface;
    let dialogsService: { createDialog: jasmine.Spy };
    let dialogClosedCallbacks: Array<() => void>;
    let closeDialog: jasmine.Spy;
    let forceBuilderService: { selectUnit: jasmine.Spy; editPilotOfUnit: jasmine.Spy };
    let pickerFactory: { createChoicePicker: jasmine.Spy; createNumericPicker: jasmine.Spy };
    let pageViewerState: PageViewerStateService;
    let options: { pickerStyle: 'default' | 'linear' | 'radial'; colorScheme: 'default' | 'night'; trackPhaseAndTurn: boolean };
    let registryGetChoices: jasmine.Spy;
    let registryHandleSelection: jasmine.Spy;

    beforeEach(() => {
        zoomPanService = {
            pointerMoved: false,
            isPanning: false,
            cancelGesture: jasmine.createSpy('cancelGesture')
        };
        dialogClosedCallbacks = [];
        closeDialog = jasmine.createSpy('closeDialog');
        dialogsService = {
            createDialog: jasmine.createSpy('createDialog').and.callFake(() => ({
            close: closeDialog,
                closed: {
                    subscribe: (callback: () => void) => {
                        dialogClosedCallbacks.push(callback);
                        return { unsubscribe: jasmine.createSpy('unsubscribe') };
                    }
                }
            }))
        };
        forceBuilderService = {
            selectUnit: jasmine.createSpy('selectUnit'),
            editPilotOfUnit: jasmine.createSpy('editPilotOfUnit')
        };
        pickerFactory = {
            createChoicePicker: jasmine.createSpy('createChoicePicker').and.returnValue({ destroy: jasmine.createSpy('destroy') }),
            createNumericPicker: jasmine.createSpy('createNumericPicker')
        };
        registryGetChoices = jasmine.createSpy('getChoices').and.returnValue([]);
        registryHandleSelection = jasmine.createSpy('handleSelection').and.returnValue(false);
        options = {
            pickerStyle: 'default',
            colorScheme: 'default',
            trackPhaseAndTurn: true
        };

        TestBed.configureTestingModule({
            providers: [
                SvgInteractionService,
                { provide: DataService, useValue: {
                    getEquipmentRegistry: () => new EquipmentRegistry({}),
                } },
                { provide: DialogsService, useValue: dialogsService },
                {
                    provide: EquipmentInteractionRegistryService,
                    useValue: {
                        getRegistry: () => ({
                            getChoices: registryGetChoices,
                            handleSelection: registryHandleSelection
                        })
                    }
                },
                { provide: ForceBuilderService, useValue: forceBuilderService },
                { provide: LayoutService, useValue: {} },
                PageViewerStateService,
                {
                    provide: OptionsService,
                    useValue: {
                        options: () => options
                    }
                },
                {
                    provide: PickerFactoryService,
                    useValue: pickerFactory
                },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } }
            ]
        });

        pageViewerState = TestBed.inject(PageViewerStateService);
        const injectedService = TestBed.inject(SvgInteractionService);
        injectedService.initialize(
            { nativeElement: document.createElement('div') },
            TestBed.inject(Injector),
            zoomPanService
        );
        service = injectedService as unknown as SvgInteractionServicePrivate;
    });

    it('selects inventory entries from main inventory buttons only', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit();
        pageViewerState.setForceUnits([unit]);
        service.updateUnit(unit);
        service.setupInteractions(svg);

        entry.el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(dialogsService.createDialog).not.toHaveBeenCalled();
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();

        (entry.el!.querySelector('.mainButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(dialogsService.createDialog).not.toHaveBeenCalled();
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeFalse();
    });

    it('gates ground EXT sheet controls behind the Extreme Range option', () => {
        const disabled = createInventoryInteractionUnit();
        pageViewerState.setForceUnits([disabled.unit]);
        service.updateUnit(disabled.unit);
        service.setupInteractions(disabled.svg);
        const disabledButton = disabled.entry.el!.querySelector('.extButton') as SVGElement;

        expect(disabledButton.classList).not.toContain('interactive');
        disabledButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(disabled.unit.getInventoryControlEntryRange(disabled.entry.id)).toBeUndefined();

        const enabled = createInventoryInteractionUnit();
        enabled.unit.allowsExtremeRangeAttacks = () => true;
        pageViewerState.setForceUnits([enabled.unit]);
        service.updateUnit(enabled.unit);
        service.setupInteractions(enabled.svg);
        const enabledButton = enabled.entry.el!.querySelector('.extButton') as SVGElement;

        expect(enabledButton.classList).toContain('interactive');
        enabledButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(enabled.unit.getInventoryControlEntryRange(enabled.entry.id)).toBe('extreme');
    });

    it('keeps Aero ERV sheet controls available when the ground option is disabled', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit();
        unit.getUnit = () => ({ type: 'Aero', comp: [] });
        pageViewerState.setForceUnits([unit]);
        service.updateUnit(unit);
        service.setupInteractions(svg);
        const extremeButton = entry.el!.querySelector('.extButton') as SVGElement;

        expect(extremeButton.classList).toContain('interactive');
        extremeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(unit.getInventoryControlEntryRange(entry.id)).toBe('extreme');
    });

    it('hides blown-off from torso location condition choices', () => {
        const unit = createSvgInteractionUnit({
            rules: {
                ...NO_CONDITION_RULES,
                locationConditionControls: [
                    { key: 'flooded', label: 'Flooded', color: '#66f' },
                    { key: 'blown-off', label: 'Blown Off', color: '#808080' },
                ],
            },
            getLocationCondition: () => false,
            getLocationConditionValue: () => undefined,
        });

        expect(service.locationConditionDropdownChoices(unit, 'LT').map(choice => choice.key)).toEqual(['flooded']);
        expect(service.locationConditionDropdownChoices(unit, 'LA').map(choice => choice.key)).toEqual(['flooded', 'blown-off']);
    });

    it('binds location condition interactions to enlarged controls rather than label text', () => {
        const unit = createSvgInteractionUnit({
            rules: {
                ...NO_CONDITION_RULES,
                locationConditionControls: [{ key: 'flooded', label: 'Flooded', color: '#66f' }],
            },
        });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        control.setAttribute('class', 'locationConditionControl');
        control.setAttribute('loc', 'LA');
        label.setAttribute('class', 'locationConditionText');
        control.appendChild(label);
        svg.appendChild(control);
        service.updateUnit(unit);
        const addTapHandler = spyOn(service, 'addSvgTapHandler');

        service.setupLocationConditionInteractions(svg, new AbortController().signal);

        expect(addTapHandler).toHaveBeenCalledTimes(1);
        expect(addTapHandler).toHaveBeenCalledWith(control, jasmine.any(Function), jasmine.any(AbortSignal));
        expect(addTapHandler).not.toHaveBeenCalledWith(label, jasmine.any(Function), jasmine.any(AbortSignal));
    });

    it('skips location condition controls without a location identifier', () => {
        const unit = createSvgInteractionUnit({
            rules: {
                ...NO_CONDITION_RULES,
                locationConditionControls: [{ key: 'flooded', label: 'Flooded', color: '#66f' }],
            },
        });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        control.setAttribute('class', 'locationConditionControl');
        svg.appendChild(control);
        service.updateUnit(unit);
        const addTapHandler = spyOn(service, 'addSvgTapHandler');

        service.setupLocationConditionInteractions(svg, new AbortController().signal);

        expect(addTapHandler).not.toHaveBeenCalled();
    });

    it('selects inventory entries from alternative mode buttons', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <g class="name"><text>MML 9</text></g>
                <g class="alternativeMode" mode="LRM">
                    <g class="name"><text>LRM</text></g>
                    <g class="damage"><text>1/Msl</text></g>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                </g>
            </g>
        `, 'MML');
        pageViewerState.setForceUnits([unit]);
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.alternativeModeButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(dialogsService.createDialog).not.toHaveBeenCalled();
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();
    });

    it('switches mode from alternative mode buttons before selecting inventory entries', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <g class="name"><text>ATM 6</text></g>
                <g class="alternativeMode" mode="Standard">
                    <g class="name"><text>Standard</text></g>
                    <g class="damage"><text>2/Msl</text></g>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                </g>
                <g class="alternativeMode" mode="High Explosive">
                    <g class="name"><text>High Explosive</text></g>
                    <g class="damage"><text>3/Msl</text></g>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                </g>
            </g>
        `, 'ATM');
        pageViewerState.setForceUnits([unit]);
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.alternativeMode[mode="High Explosive"] .alternativeModeButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('High Explosive');
        expect(entry.el!.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('High Explosive');
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();
    });

    it('keeps selected alternative mode entries on when switching to another mode button', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <g class="name"><text>ATM 6</text></g>
                <g class="alternativeMode" mode="Standard">
                    <g class="name"><text>Standard</text></g>
                    <g class="damage"><text>2/Msl</text></g>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                </g>
                <g class="alternativeMode" mode="Extended Range">
                    <g class="name"><text>Extended Range</text></g>
                    <g class="damage"><text>1/Msl</text></g>
                    <rect class="alternativeModeButton inventoryEntryButton"></rect>
                </g>
            </g>
        `, 'ATM');
        pageViewerState.setForceUnits([unit]);
        service.updateUnit(unit);
        service.setupInteractions(svg);
        const standardButton = entry.el!.querySelector('.alternativeMode[mode="Standard"] .alternativeModeButton') as SVGElement;
        const extendedRangeButton = entry.el!.querySelector('.alternativeMode[mode="Extended Range"] .alternativeModeButton') as SVGElement;

        standardButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        extendedRangeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('Extended Range');
        expect(entry.el!.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('Extended Range');
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();

        extendedRangeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('Extended Range');
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeFalse();
    });

    it('toggles RISC mode from the linked row while selecting ranges on the parent laser row', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <rect class="shrButton inventoryEntryButton"></rect>
                <g class="name"><text>ER Medium Laser</text></g>
                <text class="range_short">4</text>
                <g class="inventoryEntry linked">
                    <rect class="mainButton inventoryEntryButton"></rect>
                    <g class="name"><text>w/RISC Laser Module</text></g>
                </g>
            </g>
        `);
        const module = new MountedEquipment({
            owner: unit,
            id: 'risc',
            name: 'RISC Laser Pulse Module',
            equipment: new MiscEquipment({ id: 'risc', name: 'RISC Laser Pulse Module', type: 'misc', flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'] }),
            states: new Map<string, string>(),
            el: entry.el!.querySelector(':scope > .inventoryEntry.linked') as SVGElement,
            parent: entry
        });
        entry.equipment?.flags.add('F_ENERGY');
        entry.equipment?.flags.add('F_LASER');
        entry.linkedWith = [module];
        module.owner = unit;
        unit.getInventory = () => [entry, module];
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (module.el!.querySelector(':scope > .mainButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(RISC_LASER_PULSE_MODE);
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();

        (entry.el!.querySelector(':scope > .shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(RISC_LASER_PULSE_MODE);
        expect(unit.getInventoryControlEntryRange(entry.id)).toBe('short');

        module.el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(RISC_LASER_STANDARD_MODE);
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();
    });

    it('opens ammo profile in the equipment dialog with unit navigation and inventory-dialog lifecycle', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const ammoProfile = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        ammoProfile.setAttribute('id', 'ammoProfile');
        svg.appendChild(ammoProfile);
        const otherUnit = { id: 'unit-a', readOnly: () => false };
        const unit = { id: 'unit-b', readOnly: () => false };
        pageViewerState.setForceUnits([otherUnit as any, unit as any]);
        service.updateUnit(unit);
        service.setupReadOnlyInteractions(svg);

        ammoProfile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(dialogsService.createDialog).toHaveBeenCalledOnceWith(EquipmentDialogComponent, jasmine.objectContaining({
            data: jasmine.objectContaining({
                unitList: [otherUnit, unit],
                unitIndex: 1,
                initialTab: 'ammo'
            })
        }));
        expect(pageViewerState.inventoryDialogOpen()).toBeTrue();

        const data = dialogsService.createDialog.calls.mostRecent().args[1].data;
        data.onUnitChange(otherUnit, 0);
        expect(forceBuilderService.selectUnit).toHaveBeenCalledOnceWith(otherUnit);

        dialogClosedCallbacks[0]();
        expect(pageViewerState.inventoryDialogOpen()).toBeFalse();
    });

    it('marks read-only sheets to hide condition buttons and restores editable sheets', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = '<g class="unitConditionButton"></g>';
        const unit = createSvgInteractionUnit({
            id: 'unit-a',
            getUnit: () => ({ type: 'Mek' }),
        });

        service.setupReadOnlyInteractions(svg);
        expect(svg.classList.contains('read-only')).toBeTrue();
        expect(svg.querySelector('.unitConditionButton')?.classList.contains('edit-only')).toBeTrue();

        service.updateUnit(unit);
        service.setupInteractions(svg);
        expect(svg.classList.contains('read-only')).toBeFalse();
    });

    it('shows equipment handler choices for mounted equipment crit slots', async () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = '<g class="critSlot" loc="CT" slot="0" uid="CLActiveProbe@CT#0" hittable="1"><text>Active Probe</text></g>';
        const critSlot = { id: 'CLActiveProbe@CT#0', name: 'CLActiveProbe', loc: 'CT', slot: 0 };
        const equipment = new MiscEquipment({ id: 'CLActiveProbe', name: 'Active Probe', type: 'misc', flags: ['F_BAP'] });
        const entry = new MountedEquipment({
            owner: undefined as any,
            id: 'CLActiveProbe@CT#0',
            name: 'CLActiveProbe',
            equipment,
            critSlots: [critSlot]
        });
        const unit = createSvgInteractionUnit({
            id: 'unit-a',
            getUnit: () => ({ type: 'Mek' }),
            getInventory: () => [entry],
            getCritSlots: () => [critSlot],
            getCritSlot: (loc: string, slot: number) => loc === 'CT' && slot === 0 ? critSlot : null,
            isInternalLocPhysicallyDestroyed: () => false,
            isEquipmentUnavailable: () => false,
            applyHitToCritSlot: jasmine.createSpy('applyHitToCritSlot')
        });
        entry.owner = unit as any;
        const handlerChoice = {
            label: 'Active Probe is OFF',
            value: 'enabled',
            displayType: 'toggle' as const,
            _handler: {} as any
        };
        registryGetChoices.and.returnValue([handlerChoice]);
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(svg.querySelector('.critSlot') as SVGElement, 31);

        const pickerConfig = pickerFactory.createChoicePicker.calls.mostRecent().args[0];
        expect(registryGetChoices).toHaveBeenCalledWith(entry, jasmine.objectContaining({
            toastService: jasmine.any(Object),
            dialogsService: jasmine.any(Object),
            dataService: jasmine.any(Object)
        }));
        expect(pickerConfig.values.map((choice: { label: string }) => choice.label)).toContain('Active Probe is OFF');

        await pickerConfig.onPick(handlerChoice);

        expect(registryHandleSelection).toHaveBeenCalledWith(entry, handlerChoice, jasmine.any(Object));
    });

    it('updates sensor hit tiers from critical hit state', () => {
        const { svg, unit, sensorHit3, sensorHit4, sensorHit1 } = createSensorHitInteractionUnit();
        sensorHit3.classList.add('damaged');
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(sensorHit3, 61);
        expect(activeSensorHitLevels(unit)).toEqual([1, 2, 3]);

        tap(sensorHit3, 62);
        expect(activeSensorHitLevels(unit)).toEqual([1, 2]);

        tap(sensorHit4, 63);
        expect(activeSensorHitLevels(unit)).toEqual([1, 2, 3, 4]);

        tap(sensorHit1, 64);
        expect(activeSensorHitLevels(unit)).toEqual([1]);
    });

    it('adds pending VTOL rotor hits with the rotor counter picker delta', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const rotorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rotorGroup.setAttribute('id', 'rotor_hits_group');
        rotorGroup.setAttribute('class', 'critLoc counterGroup rotorHitsControl');
        rotorGroup.setAttribute('critId', 'rotor');
        rotorGroup.setAttribute('type', 'rotor');
        svg.appendChild(rotorGroup);

        const rotorCrit = { id: 'rotor', hits: 2, pendingHits: 1 };
        const unit = createSvgInteractionUnit({
            id: 'unit-vtol',
            getUnit: () => ({ type: 'VTOL' }),
            getInventory: () => [],
            getCritLoc: (id: string) => id === 'rotor' ? rotorCrit : null,
            setCritLoc: jasmine.createSpy('setCritLoc').and.callFake((crit) => {
                Object.assign(rotorCrit, crit);
            }),
            getCritSlots: () => [rotorCrit],
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(rotorGroup, 65);

        expect(pickerFactory.createNumericPicker).toHaveBeenCalledWith(jasmine.objectContaining({
            min: -3,
            max: 17,
            selected: 1,
            title: 'Rotor Hits',
        }));

        pickerFactory.createNumericPicker.calls.mostRecent().args[0].onPick({ value: 5 });

        expect(unit.setCritLoc).toHaveBeenCalledWith(jasmine.objectContaining({
            id: 'rotor',
            hits: 2,
            pendingHits: 6,
            destroying: undefined,
            destroyed: undefined,
        }));
    });

    it('uses the vertical linear picker for VTOL rotor hits when linear pickers are preferred', () => {
        options.pickerStyle = 'linear';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const rotorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rotorGroup.setAttribute('id', 'rotor_hits_group');
        rotorGroup.setAttribute('class', 'critLoc counterGroup rotorHitsControl');
        rotorGroup.setAttribute('critId', 'rotor');
        rotorGroup.setAttribute('type', 'rotor');
        spyOn(rotorGroup, 'getBoundingClientRect').and.returnValue({
            x: 100,
            y: 150,
            top: 150,
            bottom: 170,
            left: 100,
            right: 120,
            width: 20,
            height: 20,
            toJSON: () => ({})
        } as DOMRect);
        svg.appendChild(rotorGroup);

        const rotorCrit = { id: 'rotor', hits: 2, pendingHits: 1 };
        const unit = createSvgInteractionUnit({
            id: 'unit-vtol',
            getUnit: () => ({ type: 'VTOL' }),
            getInventory: () => [],
            getCritLoc: (id: string) => id === 'rotor' ? rotorCrit : null,
            setCritLoc: jasmine.createSpy('setCritLoc'),
            getCritSlots: () => [rotorCrit],
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(rotorGroup, 71);

        expect(pickerFactory.createChoicePicker).toHaveBeenCalledWith(jasmine.objectContaining({
            title: 'Rotor Hits',
            selected: 1,
            suggestedStyle: 'linear',
            targetType: 'motive',
            horizontal: false,
        }));
        expect(zoomPanService.cancelGesture).toHaveBeenCalled();
        expect(pickerFactory.createNumericPicker).not.toHaveBeenCalled();
    });

    it('opens a delta picker for repeatable motive hits and stores pending timestamps', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const motiveHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        motiveHit.setAttribute('id', 'motive_system_hit_2');
        motiveHit.classList.add('critLoc');
        svg.appendChild(motiveHit);

        const motiveCrit = { id: 'motive_system_hit_2', hits: 2, hitTimestamps: [10, 20] };
        const unit = createSvgInteractionUnit({
            id: 'unit-tank',
            getUnit: () => ({ type: 'Tank' }),
            getInventory: () => [],
            getCritLoc: (id: string) => id === 'motive_system_hit_2' ? motiveCrit : null,
            setCritLoc: jasmine.createSpy('setCritLoc').and.callFake((crit) => {
                Object.assign(motiveCrit, crit);
            }),
            getCritSlots: () => [motiveCrit],
        });
        spyOn(Date, 'now').and.returnValue(1000);
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(motiveHit, 69);

        expect(pickerFactory.createNumericPicker).toHaveBeenCalledWith(jasmine.objectContaining({
            min: -2,
            max: 9,
            selected: 1,
            title: 'Motive Hits (Medium)',
        }));

        pickerFactory.createNumericPicker.calls.mostRecent().args[0].onPick({ value: 3 });

        expect(unit.setCritLoc).toHaveBeenCalledWith(jasmine.objectContaining({
            id: 'motive_system_hit_2',
            hits: 2,
            hitTimestamps: [10, 20],
            pendingHits: 3,
            pendingHitTimestamps: [1000, 1001, 1002],
            destroying: undefined,
            destroyed: undefined,
        }));
    });

    it('uses the vertical linear picker for repeatable motive hits when linear pickers are preferred', () => {
        options.pickerStyle = 'linear';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const motiveHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        motiveHit.setAttribute('id', 'motive_system_hit_3');
        motiveHit.classList.add('critLoc');
        spyOn(motiveHit, 'getBoundingClientRect').and.returnValue({
            x: 100,
            y: 150,
            top: 150,
            bottom: 170,
            left: 100,
            right: 120,
            width: 20,
            height: 20,
            toJSON: () => ({})
        } as DOMRect);
        svg.appendChild(motiveHit);

        const motiveCrit = { id: 'motive_system_hit_3', hits: 2, hitTimestamps: [10, 20] };
        const unit = createSvgInteractionUnit({
            id: 'unit-tank',
            getUnit: () => ({ type: 'Tank' }),
            getInventory: () => [],
            getCritLoc: (id: string) => id === 'motive_system_hit_3' ? motiveCrit : null,
            setCritLoc: jasmine.createSpy('setCritLoc'),
            getCritSlots: () => [motiveCrit],
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(motiveHit, 70);

        expect(pickerFactory.createChoicePicker).toHaveBeenCalledWith(jasmine.objectContaining({
            title: 'Motive Hits (Heavy)',
            selected: 1,
            suggestedStyle: 'linear',
            targetType: 'motive',
            horizontal: false,
        }));
        expect(pickerFactory.createNumericPicker).not.toHaveBeenCalled();
    });

    it('adds one pending rotor hit for positive RO armor damage and removes one for repair', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const roLocation = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        roLocation.classList.add('unitLocation');
        roLocation.setAttribute('loc', 'RO');
        svg.appendChild(roLocation);

        let armorHits = 0;
        const rotorCrit = { id: 'rotor', hits: 2, pendingHits: 0 };
        const unit = createSvgInteractionUnit({
            id: 'unit-vtol',
            getUnit: () => ({ type: 'VTOL' }),
            getInventory: () => [],
            getArmorPoints: () => 10,
            getArmorHits: () => armorHits,
            addArmorHits: jasmine.createSpy('addArmorHits').and.callFake((_loc: string, hits: number) => {
                armorHits += hits;
            }),
            getInternalPoints: () => 0,
            getInternalHits: () => 0,
            getCritSlotsAsMatrix: () => ({}),
            getCritLoc: (id: string) => id === 'rotor' ? rotorCrit : null,
            setCritLoc: jasmine.createSpy('setCritLoc').and.callFake((crit) => {
                Object.assign(rotorCrit, crit);
            }),
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(roLocation, 66);
        pickerFactory.createNumericPicker.calls.mostRecent().args[0].onPick({ value: 5 });

        expect(unit.addArmorHits).toHaveBeenCalledWith('RO', 5, false, false);
        expect(unit.setCritLoc).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'rotor', hits: 2, pendingHits: 1 }));

        tap(roLocation, 67);
        pickerFactory.createNumericPicker.calls.mostRecent().args[0].onPick({ value: -3 });

        expect(unit.addArmorHits).toHaveBeenCalledWith('RO', -3, false, false);
        expect(unit.setCritLoc).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'rotor', hits: 2, pendingHits: undefined }));

        rotorCrit.hits = 20;
        rotorCrit.pendingHits = 0;
        tap(roLocation, 68);
        pickerFactory.createNumericPicker.calls.mostRecent().args[0].onPick({ value: 1 });

        expect(unit.setCritLoc).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'rotor', hits: 20, pendingHits: undefined }));
    });

    it('extends armor damage through remaining structure and marks the rotating picker threshold', () => {
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 20,
            armorHits: 5,
            internalPoints: 12,
            internalHits: 0,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 71);

        const pickerConfig = pickerFactory.createNumericPicker.calls.mostRecent().args[0];
        expect(pickerConfig).toEqual(jasmine.objectContaining({
            min: -5,
            max: 27,
            threshold: 15,
            title: 'LT',
        }));

        pickerConfig.onPick({ value: 27 });

        expect(unit.addArmorHits).toHaveBeenCalledWith('LT', 15, false, false);
        expect(unit.addInternalHits).toHaveBeenCalledWith('LT', 12, false);
    });

    it('does not pass armor repairs backward into structure', () => {
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 20,
            armorHits: 5,
            internalPoints: 12,
            internalHits: 4,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 72);
        pickerFactory.createNumericPicker.calls.mostRecent().args[0].onPick({ value: -5 });

        expect(unit.addArmorHits).toHaveBeenCalledWith('LT', -5, false, false);
        expect(unit.addInternalHits).not.toHaveBeenCalled();
    });

    it('passes rear armor damage into the shared front-named structure location', () => {
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 10,
            armorHits: 8,
            internalPoints: 10,
            internalHits: 7,
            rear: true,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 73);
        const pickerConfig = pickerFactory.createNumericPicker.calls.mostRecent().args[0];
        expect(pickerConfig).toEqual(jasmine.objectContaining({ max: 5, threshold: 2, title: 'LT (Rear)' }));
        pickerConfig.onPick({ value: 4 });

        expect(unit.addArmorHits).toHaveBeenCalledWith('LT', 2, true, false);
        expect(unit.addInternalHits).toHaveBeenCalledWith('LT', 2, false);
    });

    it('keeps direct structure damage and repair within structure', () => {
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 20,
            armorHits: 20,
            internalPoints: 20,
            internalHits: 8,
            structure: true,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 74);
        let pickerConfig = pickerFactory.createNumericPicker.calls.mostRecent().args[0];
        expect(pickerConfig).toEqual(jasmine.objectContaining({ min: -8, max: 12 }));
        expect(pickerConfig.threshold).toBeUndefined();
        pickerConfig.onPick({ value: 12 });

        expect(unit.addInternalHits).toHaveBeenCalledWith('LT', 12, false);
        expect(unit.addArmorHits).not.toHaveBeenCalled();

        tap(location, 75);
        pickerConfig = pickerFactory.createNumericPicker.calls.mostRecent().args[0];
        pickerConfig.onPick({ value: -20 });

        expect(unit.addInternalHits).toHaveBeenCalledWith('LT', -20, false);
        expect(unit.addArmorHits).not.toHaveBeenCalled();
    });

    it('stops armor overflow when structure is fully damaged', () => {
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 20,
            armorHits: 5,
            internalPoints: 12,
            internalHits: 12,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 76);

        expect(pickerFactory.createNumericPicker.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
            max: 15,
            threshold: 15,
        }));
    });

    it('offers armor-to-structure overflow with the vertical linear picker', () => {
        options.pickerStyle = 'linear';
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 20,
            armorHits: 5,
            internalPoints: 12,
            internalHits: 0,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 77);

        const pickerConfig = pickerFactory.createChoicePicker.calls.mostRecent().args[0];
        expect(pickerConfig.values.find((choice: { value: number }) => choice.value === -5)?.colors).toBeUndefined();
        expect(pickerConfig.values.find((choice: { value: number }) => choice.value === 15)?.colors).toBeUndefined();
        expect(pickerConfig.values).toContain(jasmine.objectContaining({
            value: 20,
            colors: { normal: '#8B0000', normalText: '#fff' },
        }));
        expect(pickerConfig.values).toContain(jasmine.objectContaining({
            value: 27,
            colors: { normal: '#8B0000', normalText: '#fff' },
        }));
        pickerConfig.onPick({ label: '16', value: 16 });
        expect(unit.addArmorHits).toHaveBeenCalledWith('LT', 15, false, false);
        expect(unit.addInternalHits).toHaveBeenCalledWith('LT', 1, false);
    });

    it('does not color direct structure choices as armor overflow', () => {
        options.pickerStyle = 'linear';
        const { svg, location, unit } = createArmorInteractionUnit({
            armorPoints: 20,
            armorHits: 20,
            internalPoints: 20,
            internalHits: 8,
            structure: true,
        });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        tap(location, 78);

        const choices = pickerFactory.createChoicePicker.calls.mostRecent().args[0].values;
        expect(choices.every((choice: { colors?: unknown }) => choice.colors === undefined)).toBeTrue();
    });

    it('assigns the single target when a sheet range button is clicked with one target', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit();
        unit.createInventoryControlTarget();
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(unit.getInventoryControlEntryTargetId(entry.id)).toBe('A');
        expect(unit.getInventoryControlEntryRange(entry.id)).toBeUndefined();

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(unit.getInventoryControlEntryTargetId(entry.id)).toBeUndefined();
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeFalse();
    });

    it('opens a target picker with target numbers when sheet range is clicked with multiple targets', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit();
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 4 });
        unit.updateInventoryControlTarget('B', { distance: 8, tnModifier: 1 });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(pickerFactory.createChoicePicker).not.toHaveBeenCalled();
        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice:not(.empty-choice)')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-token')?.textContent?.trim())).toEqual(['A', 'B']);
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim())).toEqual(['6', '9']);
        expect(choices.map(choice => choice.querySelector('.target-choice-name')?.textContent?.trim())).toEqual(['Target A', 'Target B']);

        choices[1].click();
        expect(unit.getInventoryControlEntryTargetId(entry.id)).toBe('B');
    });

    it('uses typed hit modifiers instead of rendered SVG hit text in the target picker fallback', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <rect class="shrButton inventoryEntryButton"></rect>
                <g class="name"><text>Laser</text></g>
                <text class="hit">99</text>
                <text class="range_short">3</text>
                <text class="range_medium">6</text>
                <text class="range_long">9</text>
            </g>
        `);
        spyOnProperty(entry.equipment!, 'toHitModifier', 'get').and.returnValue(2);
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 2 });
        unit.updateInventoryControlTarget('B', { distance: 5 });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice:not(.empty-choice)')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim())).toEqual(['6', '8']);
    });

    it('uses C3 distance for sheet target picker target numbers', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <rect class="shrButton inventoryEntryButton"></rect>
                <g class="name"><text>Laser</text></g>
                <text class="range_min">6</text>
                <text class="range_short">7</text>
                <text class="range_medium">14</text>
                <text class="range_long">27</text>
            </g>
        `);
        (entry.equipment as WeaponEquipment).weapon.minRange = 6;
        (entry.equipment as WeaponEquipment).weapon.ranges = [7, 14, 27, 36];
        unit.hasLinkedC3Network = () => true;
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 20, c3Distance: 2, useC3: true });
        unit.updateInventoryControlTarget('B', { distance: 20 });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice:not(.empty-choice)')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-token')?.textContent?.trim())).toEqual(['A', 'B']);
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim())).toEqual(['4', '8']);
    });

    it('shows sheet target picker C3 shots as out of range beyond actual long range', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <rect class="shrButton inventoryEntryButton"></rect>
                <g class="name"><text>Laser</text></g>
                <text class="range_short">2</text>
                <text class="range_medium">4</text>
                <text class="range_long">6</text>
            </g>
        `);
        (entry.equipment as WeaponEquipment).weapon.ranges = [2, 4, 6, 8];
        unit.hasLinkedC3Network = () => true;
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 20, c3Distance: 3, useC3: true });
        unit.updateInventoryControlTarget('B', { distance: 5 });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice:not(.empty-choice)')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-token')?.textContent?.trim())).toEqual(['A', 'B']);
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim())).toEqual(['X', '8']);
    });

    it('shows target picker target numbers for physical entries without range thresholds', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <rect class="shrButton inventoryEntryButton"></rect>
                <g class="name"><text>Punch</text></g>
            </g>
        `);
        entry.setIntrinsicPhysicalAttack(true);
        entry.name = 'punch';
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 4 });
        unit.updateInventoryControlTarget('B', { distance: 8, tnModifier: 1 });
        service.updateUnit(unit);
        service.setupInteractions(svg);

        (entry.el!.querySelector('.shrButton') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice:not(.empty-choice)')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim())).toEqual(['4', '5']);
    });

    it('switches to a valid alternative mode before selecting its sheet range button', () => {
        const { svg, entry, unit } = createInventoryInteractionUnit(`
            <g class="inventoryEntry">
                <rect class="mainButton inventoryEntryButton"></rect>
                <rect class="shrButton inventoryEntryButton"></rect>
                <g class="name"><text>MML 9</text></g>
                <text class="range_short">3</text>
                <g class="alternativeMode" mode="w/Artemis IV">
                    <g class="name"><text>w/Artemis IV</text></g>
                    <rect class="medButton inventoryEntryButton"></rect>
                </g>
                <g class="alternativeMode" mode="LRM">
                    <g class="name"><text>LRM</text></g>
                    <g class="damage"><text>1/Msl</text></g>
                    <text class="range_medium">14</text>
                    <rect class="medButton inventoryEntryButton"></rect>
                </g>
            </g>
        `, 'MML');
        entry.states.set(INVENTORY_CONTROL_MODE_STATE, 'LRM');
        service.updateUnit(unit);
        service.setupInteractions(svg);
        const invalidModeRange = entry.el!.querySelector('.alternativeMode[mode="w/Artemis IV"] .medButton') as SVGElement;
        const lrmRange = entry.el!.querySelector('.alternativeMode[mode="LRM"] .medButton') as SVGElement;

        expect(entry.el!.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('LRM');
        expect(entry.el!.classList.contains('selected')).toBeFalse();
        expect(entry.el!.classList.contains('selected-alternative-mode')).toBeFalse();

        lrmRange.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('LRM');
        expect(entry.el!.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('LRM');
        expect(unit.getInventoryControlEntryRange(entry.id)).toBe('medium');
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeTrue();

        lrmRange.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(unit.isInventoryControlEntrySelected(entry.id)).toBeFalse();
        expect(unit.getInventoryControlEntryRange(entry.id)).toBeUndefined();

        invalidModeRange.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('LRM');
        expect(unit.getInventoryControlEntryRange(entry.id)).toBe('medium');
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

    it('handles taps on nested SVG content during capture when the child stops propagation', () => {
        const target = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGElement;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        target.appendChild(text);
        const abortController = new AbortController();
        const handler = jasmine.createSpy('handler');
        spyOn(target, 'setPointerCapture').and.stub();
        spyOn(target, 'hasPointerCapture').and.returnValue(true);
        spyOn(target, 'releasePointerCapture').and.stub();
        text.addEventListener('pointerdown', event => event.stopPropagation());

        service.addSvgTapHandler(target, handler, abortController.signal, true);

        text.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 29, pointerType: 'touch' }));
        text.dispatchEvent(createPointerEvent('pointerup', { pointerId: 29, pointerType: 'touch' }));

        expect(handler).toHaveBeenCalledOnceWith(jasmine.any(PointerEvent), true);
    });

    it('opens the reference table from completed clicks on nested SVG content', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        table.classList.add('referenceTable');
        table.append(text, path, rect);
        svg.appendChild(table);

        const unit = createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        });
        service.updateUnit(unit);
        service.setupReadOnlyInteractions(svg);

        [text, path, rect].forEach((target, index) => {
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
            expect(dialogsService.createDialog).toHaveBeenCalledTimes(index + 1);
            dialogClosedCallbacks.shift()?.();
        });

        expect(dialogsService.createDialog).toHaveBeenCalledTimes(3);
    });

    it('adds and restores only the center-panel pointer cursor', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        table.classList.add('referenceTable');
        table.style.cursor = 'crosshair';
        svg.appendChild(table);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);
        expect(table.style.cursor).toBe('pointer');
        expect(table.classList).not.toContain('interactive');

        service.cleanup();
        expect(table.style.cursor).toBe('crosshair');
    });

    it('does not mutate positioned fluff foreignObject styles on interaction setup', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img');
        table.classList.add('referenceTable');
        foreignObject.id = 'fluff-image-fo';
        foreignObject.setAttribute('x', '24');
        foreignObject.setAttribute('y', '91');
        foreignObject.setAttribute('style', 'display: block;');
        image.id = 'fluff-image-injected';
        foreignObject.appendChild(image);
        svg.append(table, foreignObject);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);

        expect(table.style.cursor).toBe('pointer');
        expect(foreignObject.getAttribute('style')).toBe('display: block;');
        expect(foreignObject.style.cursor).toBe('');
        expect(foreignObject.getAttribute('x')).toBe('24');
        expect(foreignObject.getAttribute('y')).toBe('91');

        image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
        expect(dialogsService.createDialog).toHaveBeenCalledTimes(1);

        service.cleanup();
        expect(foreignObject.getAttribute('style')).toBe('display: block;');
        expect(foreignObject.style.cursor).toBe('');
    });

    it('opens the reference table when pointer-events-none artwork targets the SVG background', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.id = 'fluff-image-fo';
        foreignObject.style.pointerEvents = 'none';
        foreignObject.getBoundingClientRect = () => ({
            left: 100, top: 150, right: 300, bottom: 350, width: 200, height: 200,
        } as DOMRect);
        svg.appendChild(foreignObject);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);

        svg.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 200,
            clientY: 250,
        }));

        expect(dialogsService.createDialog).toHaveBeenCalledTimes(1);
    });

    it('never opens the reference table during pointerup', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        table.classList.add('referenceTable');
        table.appendChild(text);
        svg.appendChild(table);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);

        text.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 61, pointerType: 'touch' }));
        text.dispatchEvent(createPointerEvent('pointerup', { pointerId: 61, pointerType: 'touch' }));

        expect(dialogsService.createDialog).not.toHaveBeenCalled();
    });

    it('keeps only one reference table dialog open across repeated clicks', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        table.classList.add('referenceTable');
        svg.appendChild(table);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);

        table.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        table.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        expect(dialogsService.createDialog).toHaveBeenCalledTimes(1);

        dialogClosedCallbacks.shift()?.();
        table.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        expect(dialogsService.createDialog).toHaveBeenCalledTimes(2);
    });

    it('closes the owned reference table dialog during service cleanup', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        table.classList.add('referenceTable');
        svg.appendChild(table);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);
        table.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

        service.cleanup();

        expect(closeDialog).toHaveBeenCalledTimes(1);
    });

    it('ignores clicks outside the reference table and non-primary clicks', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const table = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const outside = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        table.classList.add('referenceTable');
        svg.append(table, outside);

        service.updateUnit(createSvgInteractionUnit({
            getUnit: () => ({ type: 'Mek', subtype: 'Biped', comp: [] }),
        }));
        service.setupReadOnlyInteractions(svg);

        outside.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        table.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }));

        expect(dialogsService.createDialog).not.toHaveBeenCalled();
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

    it('reports heat drag marker deltas from the pending heat at drag start', () => {
        const { svg, heat5, heat10, heat12 } = createHeatScaleSvg();
        const heatState: { current: number; next: number | null } = { current: 5, next: null };
        const unit = createSvgInteractionUnit({
            id: 'unit-a',
            svg: () => svg,
            getHeat: () => heatState,
            setHeat: jasmine.createSpy('setHeat').and.callFake((heat: number) => {
                heatState.next = heat;
            }),
            getUnit: () => ({ type: 'Mek' }),
            getInventory: () => [],
        });

        service.updateUnit(unit);
        service.setupInteractions(svg);

        heat5.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 51, pointerType: 'pen', clientY: 50 }));

        expect(service.getHeatDiffMarkerData()).toEqual(jasmine.objectContaining({
            el: heat5,
            heat: 5,
            baselineHeat: 5
        }));

        svg.dispatchEvent(createPointerEvent('pointermove', { pointerId: 51, pointerType: 'pen', clientY: 100 }));

        expect(service.getHeatDiffMarkerData()).toEqual(jasmine.objectContaining({
            el: heat10,
            heat: 10,
            baselineHeat: 5
        }));

        svg.dispatchEvent(createPointerEvent('pointerup', { pointerId: 51, pointerType: 'pen', clientY: 100 }));

        heat10.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 52, pointerType: 'pen', clientY: 100 }));

        expect(service.getHeatDiffMarkerData()).toEqual(jasmine.objectContaining({
            el: heat10,
            heat: 10,
            baselineHeat: 10
        }));

        svg.dispatchEvent(createPointerEvent('pointermove', { pointerId: 52, pointerType: 'pen', clientY: 120 }));

        expect(service.getHeatDiffMarkerData()).toEqual(jasmine.objectContaining({
            el: heat12,
            heat: 12,
            baselineHeat: 10
        }));
    });

    it('falls back to current heat when live heat highlighting receives an invalid value', () => {
        const { svg, heat5, heat10, heat12 } = createHeatScaleSvg();
        const unit = {
            id: 'unit-a',
            svg: () => svg,
            getHeat: () => ({ current: 10, next: undefined }),
            getUnit: () => ({ type: 'Mek' }),
            getInventory: () => []
        };

        service.updateUnit(unit);
        service.updateHeatHighlight(Number.NaN);

        expect(heat5.classList).toContain('hot');
        expect(heat10.classList).toContain('hot');
        expect(heat12.classList).not.toContain('hot');
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

function createHeatScaleSvg(): { svg: SVGSVGElement; heat5: SVGElement; heat10: SVGElement; heat12: SVGElement } {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const heatScale = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    heatScale.setAttribute('id', 'heatScale');
    svg.appendChild(heatScale);

    const heat5 = createHeatElement(5, 50);
    const heat10 = createHeatElement(10, 100);
    const heat12 = createHeatElement(12, 120);

    heatScale.append(heat5, heat10, heat12);
    return { svg, heat5, heat10, heat12 };
}

function createHeatElement(heat: number, centerY: number): SVGElement {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    element.classList.add('heat');
    element.setAttribute('heat', String(heat));
    spyOn(element, 'getBoundingClientRect').and.returnValue({
        x: 0,
        y: centerY - 5,
        top: centerY - 5,
        bottom: centerY + 5,
        left: 0,
        right: 10,
        width: 10,
        height: 10,
        toJSON: () => ({})
    } as DOMRect);
    return element;
}

function tap(el: SVGElement, pointerId: number): void {
    el.dispatchEvent(createPointerEvent('pointerdown', { pointerId, pointerType: 'mouse', button: 0, buttons: 1 }));
    el.dispatchEvent(createPointerEvent('pointerup', { pointerId, pointerType: 'mouse', button: 0 }));
}

function createArmorInteractionUnit(config: {
    armorPoints: number;
    armorHits: number;
    internalPoints: number;
    internalHits: number;
    rear?: boolean;
    structure?: boolean;
}): { svg: SVGSVGElement; location: SVGElement; unit: any } {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const location = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    location.classList.add('unitLocation');
    if (config.structure) location.classList.add('structure');
    if (config.rear) location.setAttribute('rear', '1');
    location.setAttribute('loc', 'LT');
    svg.appendChild(location);

    let armorHits = config.armorHits;
    let internalHits = config.internalHits;
    const unit = createSvgInteractionUnit({
        id: 'unit-mek',
        getUnit: () => ({ type: 'Mek' }),
        getArmorPoints: () => config.armorPoints,
        getArmorHits: () => armorHits,
        addArmorHits: jasmine.createSpy('addArmorHits').and.callFake((_loc: string, hits: number) => {
            armorHits += hits;
        }),
        getInternalPoints: () => config.internalPoints,
        getInternalHits: () => internalHits,
        addInternalHits: jasmine.createSpy('addInternalHits').and.callFake((_loc: string, hits: number) => {
            internalHits += hits;
        }),
        getCritSlotsAsMatrix: () => ({}),
    });
    return { svg, location, unit };
}

function createSensorHitInteractionUnit(): { svg: SVGSVGElement; unit: any; sensorHit1: SVGElement; sensorHit3: SVGElement; sensorHit4: SVGElement } {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const crits = [1, 2, 3, 4].map(level => ({ id: `sensor_hit_${level}` }));
    const sensorHitEls = crits.map(crit => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        el.classList.add('critLoc');
        el.setAttribute('id', crit.id);
        svg.appendChild(el);
        return el;
    });
    const unit = createSvgInteractionUnit({
        id: 'unit-a',
        getUnit: () => ({ type: 'Vehicle' }),
        getInventory: () => [],
        getCritSlots: () => crits,
        getCritLoc: (id: string) => crits.find(crit => crit.id === id) ?? null,
        setCritLoc: jasmine.createSpy('setCritLoc'),
        setCritSlots: jasmine.createSpy('setCritSlots').and.callFake((updatedCrits: typeof crits) => {
            crits.splice(0, crits.length, ...updatedCrits);
        }),
    });

    return {
        svg,
        unit,
        sensorHit1: sensorHitEls[0],
        sensorHit3: sensorHitEls[2],
        sensorHit4: sensorHitEls[3]
    };
}

function activeSensorHitLevels(unit: any): number[] {
    return unit.getCritSlots()
        .filter((crit: { destroying?: number }) => crit.destroying !== undefined)
        .map((crit: { id: string }) => parseInt(crit.id.replace('sensor_hit_', ''), 10));
}

function createInventoryInteractionUnit(html = `
    <g class="inventoryEntry">
        <rect class="mainButton inventoryEntryButton"></rect>
        <rect class="shrButton inventoryEntryButton"></rect>
        <rect class="medButton inventoryEntryButton"></rect>
        <rect class="lngButton inventoryEntryButton"></rect>
        <rect class="extButton inventoryEntryButton"></rect>
        <g class="name"><text>Laser</text></g>
        <text class="range_short">3</text>
        <text class="range_medium">6</text>
        <text class="range_long">9</text>
    </g>
`, weaponType: 'Laser' | 'ATM' | 'MML' = 'Laser'): { svg: SVGSVGElement; entry: MountedEquipment; unit: any } {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = html;
    const entryEl = svg.querySelector('.inventoryEntry') as SVGElement;
    const equipment = new WeaponEquipment({
        id: weaponType,
        name: weaponType,
        type: 'weapon',
        flags: weaponType === 'ATM' ? ['F_MISSILE', 'F_ATM'] : weaponType === 'MML' ? ['F_MISSILE', 'F_MML'] : [],
        weapon: { ammoType: weaponType === 'Laser' ? 'NA' : weaponType, rackSize: 6, ranges: [3, 6, 9, 12] }
    });
    const entry = new MountedEquipment({
        owner: undefined as any,
        id: 'laser',
        name: 'laser',
        equipment,
        states: new Map<string, string>(),
        el: entryEl,
        destroyed: false,
        linkedWith: null,
    });
    const unit = createSvgInteractionUnit({
        id: 'unit-a',
        getInventory: () => [entry],
        getCritSlots: () => [],
        getUnit: () => ({ comp: [] }),
        readOnly: () => false,
        hasDirectInventory: () => true,
        gunnerySkill: () => 4,
        pilotingSkill: () => 5,
        effectiveGunnerySkill: () => 4,
        effectivePilotingSkill: () => 5,
        turnState: () => ({
            moveMode: () => null,
            airborne: () => false,
            getAttackMovementModifier: () => 0,
            getAttackModifierBreakdown: () => [],
            missingAttackMovementModifier: () => false,
            getSpottingModifier: () => 0,
        }),
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
    });
    const runtime = new InventoryControlRuntimeState(() => unit.getInventory());
    Object.assign(unit, {
        getInventoryControlTargets: () => runtime.getTargets(),
        getInventoryControlTargetsMap: () => runtime.targetsMap(),
        getInventoryControlEntryTargetId: (entryId: string) => runtime.getEntryTargetId(entryId),
        isInventoryControlEntrySelected: (entryId: string) => runtime.isEntrySelected(entryId),
        getInventoryControlEntryRange: (entryId: string) => runtime.getEntryRange(entryId),
        getInventoryControlEntryAmmoOption: () => undefined,
        getInventoryControlRules: () => ({}),
        gameRules: CORE_2026_GAME_RULES,
        allowsExtremeRangeAttacks: () => false,
        resolveC3Targeting: (target: any) => ({
            target: (unit as any).hasLinkedC3Network?.() === true || target.c3Distance === undefined
                ? target
                : { ...target, c3Distance: undefined },
            degradationSource: 'none'
        }),
        setInventoryControlEntrySelected: (selectedEntry: MountedEquipment, selected: boolean) => runtime.setEntrySelected(selectedEntry, selected),
        setInventoryControlEntryRange: (selectedEntry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null) => runtime.setEntryRange(selectedEntry, range),
        toggleInventoryControlEntryRange: (selectedEntry: MountedEquipment, range: InventoryControlRuntimeRangeKey, forceSelected = false) => runtime.toggleEntryRange(selectedEntry, range, forceSelected),
        setInventoryControlEntryTarget: (selectedEntry: MountedEquipment, targetId: string | null) => runtime.setEntryTarget(selectedEntry, targetId),
        createInventoryControlTarget: () => runtime.createTarget(),
        updateInventoryControlTarget: (targetId: string, patch: any) => runtime.updateTarget(targetId, patch),
        syncInventoryControlSelectionSvg: () => runtime.syncSelectionSvg()
    });
    entry.owner = unit as any;
    return { svg, entry, unit };
}
