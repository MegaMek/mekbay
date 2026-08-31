// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { CBTForceMember, type CBTMekForceMember } from '../../../models/force-member.model';
import { TestBipedMekEntity } from '../../../models/entity/testing/test-entities';
import type { EquipmentPanelSnapshot } from '../../../models/runtime/equipment-panel';
import type { MekRecordSheetSnapshot } from '../../../models/runtime/mek-record-sheet';
import { DialogsService } from '../../../services/dialogs.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import { ToastService } from '../../../services/toast.service';
import type { ChoicePickerConfig, NumericPickerConfig } from '../../../services/picker-factory.service';
import type { MekRecordSheetInteraction } from '../mek-record-sheet-binder';
import { MekCriticalChanceDialogComponent } from '../mek-critical-chance-dialog.component';
import { MekCriticalRollDialogComponent } from '../mek-critical-roll-dialog.component';
import { UnitStateDropdownComponent } from '../unit-state-dropdown.component';
import { PageViewerOverlayService } from './page-viewer-overlay.service';
import { PageViewerMekInteractionService } from './page-viewer-mek-interaction.service';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';

describe('PageViewerMekInteractionService', () => {
    let service: PageViewerMekInteractionService;
    let numericConfig: NumericPickerConfig | null;
    let choiceConfig: ChoicePickerConfig | null;
    let revision: number;
    let currentSnapshot: MekRecordSheetSnapshot;
    let panel: EquipmentPanelSnapshot;
    let force: any;
    let member: CBTMekForceMember;
    let dialogs: jasmine.SpyObj<DialogsService>;
    let overlayManager: ReturnType<typeof overlayManagerStub>;
    let dropdownFixture: ComponentFixture<UnitStateDropdownComponent>;

    beforeEach(() => {
        numericConfig = null;
        choiceConfig = null;
        revision = 1;
        currentSnapshot = recordSheetSnapshot(revision);
        panel = equipmentPanel(revision);
        const directUnitSnapshot = () => ({
            entity: {
                entityType: 'Mek',
                mountedCockpit: () => ({ canEject: true }),
                totalHeatSinks: () => currentSnapshot.heatSinks.count,
            },
            state: { stateRevision: revision },
            index: { locations: new Map([['loc-ct', { code: 'CT' }]]) },
            query: {
                stateRevision: revision,
                crewState: (positionId: string) => currentSnapshot.crew
                    .find(row => row.positionId === positionId)?.state
                    ?? { wounds: 0, unconscious: false, ejected: false },
                hasCondition: (condition: string) => currentSnapshot.conditions.includes(condition),
                heatState: () => currentSnapshot.heat,
                locationCondition: (locationId: string, condition: string, perspective: string) => {
                    const row = currentSnapshot.locations.find(location => location.locationId === locationId)
                        ?.conditions.find(candidate => candidate.condition === condition);
                    return perspective === 'preview' ? row?.preview ?? 0 : row?.committed ?? 0;
                },
                ammoLoadout: (componentId: string) => {
                    const ammo = currentSnapshot.criticalSlots.flatMap(slot => slot.components)
                        .find(component => component.componentId === componentId)?.ammo;
                    if (!ammo) throw new Error(`Unknown ammo ${componentId}`);
                    return ammo;
                },
                ammoCapacity: (componentId: string) => {
                    const ammo = currentSnapshot.criticalSlots.flatMap(slot => slot.components)
                        .find(component => component.componentId === componentId)?.ammo;
                    if (!ammo) throw new Error(`Unknown ammo ${componentId}`);
                    return ammo.capacity;
                },
                remainingAmmo: (componentId: string) => {
                    const ammo = currentSnapshot.criticalSlots.flatMap(slot => slot.components)
                        .find(component => component.componentId === componentId)?.ammo;
                    if (!ammo) throw new Error(`Unknown ammo ${componentId}`);
                    return ammo.remaining;
                },
                mekCriticalChance: () => ({
                    locationId: 'loc-ct', locationCode: 'CT', canBlowOff: false,
                    industrialMek: false, modifiers: [],
                }),
                mekBlowOff: () => ({ kind: 'blown-off', locationId: 'loc-ct' }),
            },
        });
        force = {
            getMekRecordSheetSnapshot: jasmine.createSpy().and.callFake(() => currentSnapshot),
            getEquipmentPanelSnapshot: jasmine.createSpy().and.callFake(() => panel),
            dispatchMekUnitCommand: jasmine.createSpy().and.callFake(async (_unitId: string, command: any) => {
                revision++;
                currentSnapshot = { ...currentSnapshot, stateRevision: revision } as MekRecordSheetSnapshot;
                panel = { ...panel, stateRevision: revision } as EquipmentPanelSnapshot;
                return { accepted: true, idempotent: false, currentRevision: revision };
            }),
            getMekEquipmentInteractions: jasmine.createSpy().and.returnValue([]),
            dispatchMekEquipmentChoice: jasmine.createSpy().and.resolveTo({ accepted: true, changed: true }),
            getUnitCrewProfile: jasmine.createSpy().and.returnValue({
                revision: 4,
                positions: [{ positionId: 'crew-0', name: 'Morgan', role: 'Pilot', gunnery: 3, piloting: 4 }],
            }),
            replaceUnitCrewProfile: jasmine.createSpy().and.resolveTo({ accepted: true }),
            getAttackerTargeting: jasmine.createSpy().and.returnValue({
                instanceId: 'unit-1', stateRevision: 1, registryRevision: 2,
                state: { schemaVersion: 1, components: new Map(), actions: new Map(), targets: new Map() },
            }),
            dispatchAttackerTargeting: jasmine.createSpy().and.resolveTo({
                accepted: true, idempotent: false, currentRevision: 2,
            }),
            getRosterGroupId: () => 'group-1',
            getUnitSnapshot: jasmine.createSpy().and.callFake(directUnitSnapshot),
        };
        const entity = new TestBipedMekEntity();
        entity.chassis.set('Atlas');
        entity.model.set('AS7-D');
        member = new CBTForceMember('unit-1' as never, force, entity) as CBTMekForceMember;
        dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog', 'prompt']);
        overlayManager = overlayManagerStub();
        TestBed.configureTestingModule({
            imports: [UnitStateDropdownComponent],
            providers: [
                PageViewerMekInteractionService,
                { provide: DialogsService, useValue: dialogs },
                {
                    provide: OptionsService,
                    useValue: {
                        options: () => ({ pickerStyle: 'default', colorScheme: 'default', trackPhaseAndTurn: true }),
                        cbtAutomationMode: () => 'no',
                    },
                },
                {
                    provide: PickerFactoryService,
                    useValue: {
                        createNumericPicker: (config: NumericPickerConfig) => {
                            numericConfig = config;
                            return { component: {}, setPosition: () => undefined, destroy: () => undefined };
                        },
                        createChoicePicker: (config: ChoicePickerConfig) => {
                            choiceConfig = config;
                            return { component: { values: { set: () => undefined } }, setPosition: () => undefined, destroy: () => undefined };
                        },
                    },
                },
                { provide: OverlayManagerService, useValue: overlayManager },
                { provide: PageViewerOverlayService, useValue: jasmine.createSpyObj('PageViewerOverlayService', ['openEquipment', 'openTurn']) },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['showToast']) },
                { provide: ForcePilotEditorService, useValue: jasmine.createSpyObj('ForcePilotEditorService', ['editClassicMember']) },
                { provide: PageViewerZoomPanService, useValue: jasmine.createSpyObj('PageViewerZoomPanService', ['cancelGesture']) },
            ],
        });
        dropdownFixture = TestBed.createComponent(UnitStateDropdownComponent);
        overlayManager.createManagedOverlay.and.returnValue({
            componentRef: dropdownFixture.componentRef,
            closed: new Subject<void>(),
        } as ReturnType<OverlayManagerService['createManagedOverlay']>);
        service = TestBed.inject(PageViewerMekInteractionService);
    });

    afterEach(() => dropdownFixture.destroy());

    it('uses the original radial damage picker and atomically continues armor overflow into internal damage', async () => {
        service.handle(member, {
            kind: 'armor', faceId: 'face-ct', locationId: 'loc-ct', button: 'primary', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());

        expect(numericConfig).toEqual(jasmine.objectContaining({ min: -7, max: 5, threshold: 3, selected: 0 }));
        numericConfig!.onPick({ value: 5 });
        await settleAsyncHandlers();

        const commands = force.dispatchMekUnitCommand.calls.allArgs().map((args: any[]) => args[1]);
        expect(commands[0]).toEqual(jasmine.objectContaining({
            type: 'damage-armor', faceId: 'face-ct', amount: 3, expectedRevision: 1, target: 'pending',
        }));
        expect(commands[1]).toEqual(jasmine.objectContaining({
            type: 'damage-internal', locationId: 'loc-ct', amount: 2, expectedRevision: 2, target: 'pending',
            hardenedArmorApplies: false,
            armorDamagedBySameHit: true,
        }));
        expect(commands[1].hitArc).toBeUndefined();
    });

    it('uses the original critical choice picker and dispatches opaque equipment-handler choices', async () => {
        force.getMekEquipmentInteractions.and.returnValue([{
            instanceId: 'unit-1', componentId: 'ammo-1', componentLabel: 'Ammo', stateRevision: 1,
            choices: [{ token: 'opaque-token', handlerId: 'handler', label: 'Special mode', active: false, disabled: false }],
        }]);
        service.handle(member, {
            kind: 'critical', slotId: 'slot-ct-0', componentIds: ['ammo-1'], button: 'primary', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());

        expect(choiceConfig).toEqual(jasmine.objectContaining({ style: 'linear', targetType: 'crit' }));
        expect(choiceConfig!.values.map(choice => choice.label)).toContain('Critical Hit');
        expect(choiceConfig!.values.map(choice => choice.label)).toContain('-1 AC/20 Ammo');
        const handler = choiceConfig!.values.find(choice => choice.label === 'Special mode')!;
        choiceConfig!.onPick(handler);
        await settleAsyncHandlers();
        expect(force.dispatchMekEquipmentChoice).toHaveBeenCalledWith('opaque-token');
    });

    it('ports the production location critical actions to the direct V2 dialogs', () => {
        dialogs.createDialog.and.returnValues(
            { closed: of({ kind: 'critical-hits', count: 2 }) } as any,
            { closed: of(undefined) } as any,
        );
        service.handle(member, {
            kind: 'location-condition-menu', locationId: 'loc-ct', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        dropdownFixture.detectChanges();

        const choices = dropdownFixture.componentInstance.choices();
        expect(choices.map(choice => choice.label)).toContain('Critical Chance');
        expect(choices.map(choice => choice.label)).toContain('Critical Roll');

        dropdownFixture.componentInstance.selected.emit('critical-chance');

        expect(overlayManager.closeManagedOverlay).toHaveBeenCalledWith('mek-sheet-location-condition');
        expect(dialogs.createDialog.calls.argsFor(0)).toEqual([
            MekCriticalChanceDialogComponent,
            jasmine.objectContaining({
                data: jasmine.objectContaining({ locationLabel: 'Center Torso', canBlowOff: false }),
            }),
        ]);
        expect(dialogs.createDialog.calls.argsFor(1)).toEqual([
            MekCriticalRollDialogComponent,
            jasmine.objectContaining({
                data: jasmine.objectContaining({
                    member,
                    locationId: 'loc-ct',
                    requiredHits: 2,
                    target: 'pending',
                }),
            }),
        ]);
    });

    it('ports every production Mek condition-menu control through direct sparse state', () => {
        service.handle(member, {
            kind: 'condition-menu', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        dropdownFixture.detectChanges();

        expect(dropdownFixture.componentInstance.choices().map(choice => choice.label)).toEqual([
            'SWARMED',
            'TAGGED',
            'ECM SHIELDED',
            'SKIDDING',
            'JAMMED',
        ]);

        dropdownFixture.componentInstance.selected.emit('ecm-shielded');

        expect(force.dispatchMekUnitCommand).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'set-condition',
            condition: 'ecm-shielded',
            active: true,
            expectedRevision: 1,
        }));
    });

    it('applies a production blow-off result through one atomic V2 command', async () => {
        dialogs.createDialog.and.returnValue({ closed: of({ kind: 'blown-off' }) } as any);
        service.handle(member, {
            kind: 'location-condition-menu', locationId: 'loc-ct', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        dropdownFixture.componentInstance.selected.emit('critical-chance');
        await settleAsyncHandlers();

        expect(force.dispatchMekUnitCommand).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'apply-mek-blow-off',
            expectedRevision: 1,
            locationId: 'loc-ct',
            target: 'pending',
        }));
    });

    it('restores handler-authored dropdowns, colors, tones, and option tokens on the sheet', async () => {
        force.getMekEquipmentInteractions.and.returnValue([{
            instanceId: 'unit-1', componentId: 'ammo-1', componentLabel: 'Ammo', stateRevision: 1,
            choices: [{
                token: 'standard-token', handlerId: 'ecm-handler', groupLabel: 'ECM Mode',
                label: 'Standard', shortLabel: 'STD', active: true, disabled: false,
                displayType: 'dropdown', selectionTone: 'muted', keepOpen: true,
                colors: { selected: '#123456', selectedText: '#ffffff' },
            }, {
                token: 'eccm-token', handlerId: 'ecm-handler', groupLabel: 'ECM Mode',
                label: 'ECCM', active: false, disabled: false, displayType: 'dropdown',
                selectionTone: 'muted', keepOpen: true,
                colors: { selected: '#123456', selectedText: '#ffffff' },
            }],
        }]);
        service.handle(member, {
            kind: 'critical', slotId: 'slot-ct-0', componentIds: ['ammo-1'], button: 'primary', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());

        const dropdown = choiceConfig!.values.find(choice => choice.label === 'ECM Mode')!;
        expect(dropdown).toEqual(jasmine.objectContaining({
            displayType: 'dropdown', selectionTone: 'muted', keepOpen: true,
            colors: { selected: '#123456', selectedText: '#ffffff' },
        }));
        expect(dropdown.choices?.map(choice => choice.label)).toEqual(['STD', 'ECCM']);
        choiceConfig!.onPick({ ...dropdown, value: dropdown.choices![1].value, label: 'ECCM' });
        await settleAsyncHandlers();
        expect(force.dispatchMekEquipmentChoice).toHaveBeenCalledWith('eccm-token');
    });

    it('keeps authored system-hit controls as direct toggles instead of opening the slot picker', async () => {
        service.handle(member, {
            kind: 'system-critical', slotId: 'slot-ct-0', system: 'Engine', level: 1, expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(choiceConfig).toBeNull();
        expect(force.dispatchMekUnitCommand).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'hit-critical', slotId: 'slot-ct-0', hits: 1, target: 'pending', expectedRevision: 1,
        }));
    });

    it('opens the established crew editor from authored crew-name controls', async () => {
        const pilotEditor = TestBed.inject(ForcePilotEditorService) as jasmine.SpyObj<ForcePilotEditorService>;
        pilotEditor.editClassicMember.and.resolveTo();
        service.handle(member, {
            kind: 'crew-name', positionId: 'crew-0', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(pilotEditor.editClassicMember).toHaveBeenCalledOnceWith(force, member.id);
    });

    it('does not offer ejection for a torso-mounted cockpit', () => {
        force.getUnitSnapshot.and.returnValue({
            entity: { entityType: 'Mek', mountedCockpit: () => ({ canEject: false }) },
        });

        service.handle(member, {
            kind: 'crew-state-menu', positionId: 'crew-0', expectedRevision: 1,
        } as MekRecordSheetInteraction, anchoredMouseEvent());
        dropdownFixture.detectChanges();

        expect(dropdownFixture.componentInstance.choices().map(choice => choice.key))
            .not.toContain('ejected');
    });

    it('offers command-console crew swapping only while both cockpits are operational', () => {
        currentSnapshot = {
            ...currentSnapshot,
            crew: [
                { ...currentSnapshot.crew[0]!, occurrence: 0, effectiveState: 'active' },
                {
                    ...currentSnapshot.crew[0]!, positionId: 'crew-1', positionKey: 'crew:1', occurrence: 1,
                    role: 'Commander', effectiveState: 'dead',
                },
            ],
        } as unknown as MekRecordSheetSnapshot;

        service.handle(member, {
            kind: 'crew-state-menu', positionId: 'crew-0', expectedRevision: 1,
        } as MekRecordSheetInteraction, anchoredMouseEvent());
        dropdownFixture.detectChanges();

        expect(dropdownFixture.componentInstance.choices().map(choice => choice.key))
            .not.toContain('swap');
    });

    it('preserves the authored cumulative Sensors control as one atomic owner command', async () => {
        currentSnapshot = {
            ...currentSnapshot,
            criticalSlots: [
                {
                    slotId: 'sensor-1', locationId: 'loc-ct', locationCode: 'CT', slotIndex: 0,
                    armored: false, hitCapacity: 1, committedHits: 0, previewHits: 0,
                    components: [{ componentId: 'system:sensor', label: 'Sensors', system: 'Sensors', status: 'available' }],
                },
                {
                    slotId: 'sensor-2', locationId: 'loc-ct', locationCode: 'CT', slotIndex: 1,
                    armored: false, hitCapacity: 1, committedHits: 0, previewHits: 0,
                    components: [{ componentId: 'system:sensor', label: 'Sensors', system: 'Sensors', status: 'available' }],
                },
            ],
        } as unknown as MekRecordSheetSnapshot;
        service.handle(member, {
            kind: 'system-critical', slotId: 'sensor-2', system: 'Sensors', level: 2, expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(force.dispatchMekUnitCommand).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'set-system-critical-level', system: 'Sensors', level: 2,
            target: 'pending', expectedRevision: 1,
        }));
    });

    it('publishes and clears the original heat-drag overlay state', () => {
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        service.handle(member, {
            kind: 'heat-preview', heat: 6, baselineHeat: 2, element: marker, expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());

        expect(service.heatPreview('unit-1')).toEqual({ element: marker, heat: 6, baselineHeat: 2 });
        expect(service.isPickerOpen('unit-1')).toBeTrue();

        service.handle(member, {
            kind: 'heat-preview-end', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        expect(service.heatPreview('unit-1')).toBeNull();
    });

    it('uses the original active-heatsinks picker while dispatching the typed disabled count', async () => {
        currentSnapshot = {
            ...currentSnapshot,
            heat: { ...currentSnapshot.heat, heatsinksOff: 3 },
        } as MekRecordSheetSnapshot;
        service.handle(member, {
            kind: 'heat-sinks-off', expectedRevision: 1,
        } as MekRecordSheetInteraction, anchoredMouseEvent());

        expect(numericConfig).toEqual(jasmine.objectContaining({
            min: 0, max: 10, selected: 7, title: 'Active Heatsinks',
        }));
        numericConfig!.onPick({ value: 5 });
        await settleAsyncHandlers();
        expect(force.dispatchMekUnitCommand).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'set-heatsinks-off', heatsinksOff: 5, expectedRevision: 1,
        }));
    });

    it('routes the sheet shutdown button through typed shutdown and startup actions', async () => {
        service.handle(member, {
            kind: 'shutdown', expectedRevision: 1,
        } as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(force.dispatchMekUnitCommand.calls.argsFor(0)[1]).toEqual(jasmine.objectContaining({
            type: 'declare-mek-action',
            expectedRevision: 1,
            action: jasmine.objectContaining({ kind: 'shutdown' }),
        }));

        currentSnapshot = {
            ...currentSnapshot,
            conditions: ['shutdown'],
        } as MekRecordSheetSnapshot;
        service.handle(member, {
            kind: 'shutdown', expectedRevision: 2,
        } as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(force.dispatchMekUnitCommand.calls.argsFor(1)[1]).toEqual(jasmine.objectContaining({
            type: 'declare-mek-action',
            expectedRevision: 2,
            action: jasmine.objectContaining({ kind: 'startup' }),
        }));
    });

    it('edits one crew skill through the crew-profile CAS boundary', async () => {
        service.handle(member, {
            kind: 'crew-skill', positionId: 'crew-0', skill: 'gunnery', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());

        expect(choiceConfig).toEqual(jasmine.objectContaining({ selected: 3, suggestedStyle: 'radial', targetType: 'skill' }));
        choiceConfig!.onPick({ label: '2', value: 2 });
        await settleAsyncHandlers();
        expect(force.replaceUnitCrewProfile).toHaveBeenCalledWith('unit-1', {
            expectedRevision: 4,
            positions: [{ positionId: 'crew-0', name: 'Morgan', role: 'Pilot', gunnery: 2, piloting: 4 }],
        });
    });

    it('routes an inventory range button to the revisioned attacker-targeting owner', async () => {
        service.handle(member, {
            kind: 'inventory-selection', componentIds: ['weapon-1'], range: 'medium', expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(force.dispatchAttackerTargeting).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'edit-attacker-targeting',
            expectedRevision: 1,
            expectedRegistryRevision: 2,
            edit: { kind: 'set-component-selection', componentId: 'weapon-1', selection: { kind: 'manual-range', range: 'medium' } },
        }));
    });

    it('routes an authored physical-attack row through the typed action-selection owner', async () => {
        panel = {
            ...panel,
            physicalAttacks: [{
                target: { kind: 'intrinsic', actionId: 'Kick' },
                label: 'Kick', locationIds: [], locationCodes: [], available: true, selectable: true,
                effect: { kind: 'damage', damage: 10, maximumDamage: 10 },
            }],
        } as unknown as EquipmentPanelSnapshot;

        service.handle(member, {
            kind: 'action-selection',
            target: { kind: 'intrinsic', actionId: 'Kick' },
            expectedRevision: 1,
        } as unknown as MekRecordSheetInteraction, anchoredMouseEvent());
        await settleAsyncHandlers();

        expect(force.dispatchAttackerTargeting).toHaveBeenCalledWith('unit-1', jasmine.objectContaining({
            type: 'edit-attacker-targeting',
            expectedRevision: 1,
            expectedRegistryRevision: 2,
            edit: {
                kind: 'set-action-selection',
                target: { kind: 'intrinsic', actionId: 'Kick' },
                selection: { kind: 'selected' },
            },
        }));
    });

    it('opens the reference-table dialog with the unit and active ruleset', () => {
        dialogs.createDialog.and.returnValue({ closed: { subscribe: () => undefined } } as any);
        service.handle(member, {
            kind: 'reference-table', expectedRevision: 1,
        } as MekRecordSheetInteraction, anchoredMouseEvent());

        expect(dialogs.createDialog).toHaveBeenCalledWith(jasmine.any(Function), jasmine.objectContaining({
            data: jasmine.objectContaining({
                unit: member.entity,
                gameRules: jasmine.objectContaining({ id: 'core-2026' }),
            }),
        }));
    });
});

function anchoredMouseEvent(): MouseEvent {
    const event = new MouseEvent('click', { clientX: 10, clientY: 20 });
    Object.defineProperty(event, 'currentTarget', { value: document.createElementNS('http://www.w3.org/2000/svg', 'rect') });
    return event;
}

async function settleAsyncHandlers(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
}

function overlayManagerStub() {
    return {
        createManagedOverlay: jasmine.createSpy(),
        closeManagedOverlay: jasmine.createSpy(),
        closeAllManagedOverlays: jasmine.createSpy(),
    };
}

function recordSheetSnapshot(stateRevision: number): MekRecordSheetSnapshot {
    return {
        stateRevision,
        identity: { form: 'biped' },
        locations: [{
            locationId: 'loc-ct', code: 'CT', maximumInternal: 10,
            committedRemainingInternal: 2, previewRemainingInternal: 2, conditions: [],
            armor: [{
                faceId: 'face-ct', locationId: 'loc-ct', locationCode: 'CT', face: 'front',
                maximum: 10, committedRemaining: 3, previewRemaining: 3,
            }],
        }],
        criticalSlots: [{
            slotId: 'slot-ct-0', locationId: 'loc-ct', locationCode: 'CT', slotIndex: 0,
            armored: false, hitCapacity: 1, committedHits: 0, previewHits: 0,
            components: [{
                componentId: 'ammo-1', label: 'AC/20 Ammo', status: 'available',
                ammo: { munitionKey: 'standard', displayName: 'AC/20 Ammo', capacity: 5, remaining: 3 },
            }],
        }],
        crew: [{
            positionId: 'crew-0', positionKey: 'crew:0', occurrence: 0, name: 'Morgan', role: 'Pilot',
            gunnery: 3, piloting: 4, state: { wounds: 0, unconscious: false, ejected: false },
        }],
        heatSinks: { count: 10, unavailableUnits: 0 },
        heat: { current: 0, previous: 0, heatsinksOff: 0 },
        conditions: [],
        equipment: [{
            componentId: 'weapon-1', label: 'AC/20', profile: {
                type: 'weapon', flags: new Set(), modes: [],
                weapon: { rapidFireCount: 0, ammoType: 'AC', rackSize: 20 },
            }, locations: [{ locationId: 'loc-ct', code: 'CT' }], status: 'available', modes: [], jammed: false,
            weapon: { heat: 7, damage: 20, ranges: [3, 6, 9, 12], minimumRange: 0, ammoSources: [] },
        }],
    } as unknown as MekRecordSheetSnapshot;
}

function equipmentPanel(stateRevision: number): EquipmentPanelSnapshot {
    return {
        stateRevision,
        targetRegistryRevision: 2,
        targets: [],
        physicalAttacks: [],
        components: [{
            componentId: 'weapon-1', label: 'AC/20', locations: [], status: 'available', modes: [], jammed: false,
            weapon: { heat: 7, damage: 20, ranges: [3, 6, 9, 12], minimumRange: 0, ammoSources: [] },
        }],
    } as unknown as EquipmentPanelSnapshot;
}
