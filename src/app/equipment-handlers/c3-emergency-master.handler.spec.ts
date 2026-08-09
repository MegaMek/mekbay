// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment } from '../models/equipment.model';
import {
    C3EM_MODE_STATE_KEY,
    C3EM_OPERATING_TURNS_STATE_KEY,
    getC3EmergencyMasterMode,
    getC3EmergencyMasterOperatingTurns,
    isC3EmergencyMasterFried,
    type C3EmergencyMasterStatus,
} from '../models/c3-emergency-master.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { DialogsService } from '../services/dialogs.service';
import { createHandlerCommandContext, createHandlerQueryContext, EquipmentInteractionRegistry } from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { C3EmergencyMasterHandler, C3EM_TOGGLE_CHOICE_VALUE } from './c3-emergency-master.handler';

function fixture(initialStatus: C3EmergencyMasterStatus = 'dormant') {
    let status = initialStatus;
    let equipment!: MountedEquipment;
    const owner = {
        id: 'emergency-unit',
        readOnly: () => false,
        getEquipmentStatus: (entry: MountedEquipment) => entry.committedDestroyed() ? 'destroyed' : 'available',
        isEquipmentOperational: (entry: MountedEquipment) => !entry.committedDestroyed(),
        canPerformEquipmentAction: (entry: MountedEquipment) => !entry.committedDestroyed(),
        getInventory: () => [equipment],
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        getNotificationDisplayName: () => 'Emergency Unit',
    };
    const force = {
        name: 'Test Force',
        instanceId: () => 'test-force',
        units: () => [owner],
        c3Network: () => ({ emergencyMasterStatus: () => status }),
    };
    Object.assign(owner, { force });
    equipment = new MountedEquipment({
        owner: owner as never,
        id: 'c3em',
        name: 'C3 Emergency Master',
        equipment: new MiscEquipment({ id: 'c3em', name: 'C3 Emergency Master', type: 'misc', flags: ['F_C3S', 'F_C3EM'] }),
        states: new Map(),
    });
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    const context = {
        query: createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY, 'turn-summary'),
        command: createHandlerCommandContext(
            EMPTY_EQUIPMENT_REGISTRY,
            toastService,
            jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
        ),
        toastService,
    };
    return { equipment, owner, force, context, setStatus: (value: C3EmergencyMasterStatus) => { status = value; } };
}

describe('C3EmergencyMasterHandler', () => {
    const handler = new C3EmergencyMasterHandler();

    it('renders an empty track and a gray inactive EMERGENCY toggle with no consumed turns', () => {
        const { equipment, context } = fixture();
        const choices = handler.getChoices(equipment, context.query);

        expect(choices.map(choice => choice.label)).toEqual(['1', '2', '3', '4', '5', '6', '!!', 'EMERGENCY']);
        expect(choices.slice(0, 7).every(choice => !choice.active)).toBeTrue();
        expect(choices.at(-1)).toEqual(jasmine.objectContaining({
            value: C3EM_TOGGLE_CHOICE_VALUE,
            active: false,
        }));
    });

    it('displays retained turns with a muted current marker while dormant', () => {
        const { equipment, context, setStatus } = fixture('dormant');
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '4');

        let choices = handler.getChoices(equipment, context.query);

        expect(choices.slice(0, 3).every(choice => choice.active && choice.selectionTone === 'muted')).toBeTrue();
        expect(choices[3]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'muted' }));
        expect(choices.slice(4, 7).every(choice => !choice.active)).toBeTrue();
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(4);
        expect(equipment.states.get(C3EM_OPERATING_TURNS_STATE_KEY)).toBe('4');

        setStatus('active');
        choices = handler.getChoices(equipment, context.query);
        expect(choices[3]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'selected' }));
        expect(choices[4].active).toBeFalse();
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(4);
    });

    it('shows the activation turn as current and advances it after each completed turn', () => {
        const { equipment, context, setStatus } = fixture('active');
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '1');

        let choices = handler.getChoices(equipment, context.query);
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(1);
        expect(choices[0]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'selected' }));
        expect(choices[1].active).toBeFalse();

        handler.onEndTurn(equipment, context.toastService);
        choices = handler.getChoices(equipment, context.query);
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(2);
        expect(choices[0]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'muted' }));
        expect(choices[1]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'selected' }));
        expect(context.toastService.showToast).toHaveBeenCalledWith(
            'Emergency Unit: C3 Emergency Master active, 2/6 operating turns',
            'info'
        );

        setStatus('standby');
        choices = handler.getChoices(equipment, context.query);
        expect(choices[0]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'muted' }));
        expect(choices[1]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'muted' }));
    });

    it('allows manual override on and off without resetting consumed turns', () => {
        const { equipment, owner, context, setStatus } = fixture();
        const toggle = handler.getChoices(equipment, context.query).at(-1)!;

        handler.handleSelection(equipment, toggle, context.command);
        expect(getC3EmergencyMasterMode(equipment)).toBe('on');
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(1);
        expect(context.toastService.showToast).not.toHaveBeenCalled();
        setStatus('active');
        handler.onEndTurn(equipment, context.toastService);
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(2);
        handler.handleSelection(equipment, handler.getChoices(equipment, context.query).at(-1)!, context.command);

        expect(getC3EmergencyMasterMode(equipment)).toBe('off');
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(2);
        expect(owner.setInventoryEntry).toHaveBeenCalledTimes(3);
    });

    it('owns activation transition notifications for manual and automatic status changes', () => {
        const { force, context, setStatus } = fixture('dormant');

        handler.onForceRuntimeChanged(force as never, context.toastService);
        expect(context.toastService.showToast).not.toHaveBeenCalled();

        setStatus('active');
        handler.onForceRuntimeChanged(force as never, context.toastService);
        handler.onForceRuntimeChanged(force as never, context.toastService);
        expect(context.toastService.showToast).toHaveBeenCalledOnceWith(
            'Emergency Unit: C3 Emergency Master EMERGENCY active',
            'info',
            'c3em-activation-test-force-emergency-unit\0c3em'
        );

        setStatus('dormant');
        handler.onForceRuntimeChanged(force as never, context.toastService);
        setStatus('active');
        handler.onForceRuntimeChanged(force as never, context.toastService);
        expect(context.toastService.showToast).toHaveBeenCalledTimes(2);
    });

    it('initializes an already active emergency master without a load-time activation toast', () => {
        const { force, equipment, owner, context } = fixture('active');

        handler.onForceRuntimeChanged(force as never, context.toastService);

        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(1);
        expect(owner.setInventoryEntry).toHaveBeenCalledOnceWith(equipment);
        expect(context.toastService.showToast).not.toHaveBeenCalled();
    });

    it('increments only active operating turns and pauses on standby, recovery, or unavailability', () => {
        const { equipment, owner, context, setStatus } = fixture('active');
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '1');

        handler.onEndTurn(equipment, context.toastService);
        setStatus('standby');
        handler.onEndTurn(equipment, context.toastService);
        setStatus('dormant');
        handler.onEndTurn(equipment, context.toastService);
        setStatus('unavailable');
        handler.onEndTurn(equipment, context.toastService);
        setStatus('active');
        handler.onEndTurn(equipment, context.toastService);

        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(3);
        expect(owner.setInventoryEntry).toHaveBeenCalledTimes(2);
    });

    it('highlights the red fried marker after six turns while leaving track correction enabled', () => {
        const { equipment, owner, context, setStatus } = fixture('active');
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '1');

        for (let turn = 2; turn <= 7; turn++) {
            handler.onEndTurn(equipment, context.toastService);
            expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(turn);
            if (turn === 7) setStatus('fried');
        }
        handler.onEndTurn(equipment, context.toastService);
        const choices = handler.getChoices(equipment, context.query);

        expect(isC3EmergencyMasterFried(equipment)).toBeTrue();
        expect(choices[6]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'selected' }));
        expect(choices[6].disabled).toBeFalsy();
        expect(choices[6].colors).toEqual(jasmine.objectContaining({ selected: '#f00', selectedText: '#fff' }));
        expect(choices.at(-1)).toEqual(jasmine.objectContaining({ active: false, disabled: true }));
        expect(choices.slice(0, 7).every(choice => !choice.disabled)).toBeTrue();
        expect(owner.setInventoryEntry).toHaveBeenCalledTimes(6);
    });

    it('allows correcting a fried track to a lower value and unfrying it', () => {
        const { equipment, owner, context, setStatus } = fixture('fried');
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '7');

        handler.handleSelection(equipment, handler.getChoices(equipment, context.query)[3], context.command);
        setStatus('dormant');

        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(4);
        expect(isC3EmergencyMasterFried(equipment)).toBeFalse();
        expect(owner.setInventoryEntry).toHaveBeenCalledWith(equipment);
        const choices = handler.getChoices(equipment, context.query);
        expect(choices[6].active).toBeFalse();
        expect(choices.slice(0, 4).every(choice => choice.active)).toBeTrue();
        expect(choices.at(-1)?.disabled).toBeFalse();
    });

    it('supports correcting the track while clamping malformed and boundary state', () => {
        const { equipment, context } = fixture();
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, 'invalid');
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(0);
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '-4');
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(0);
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '99');
        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(7);
        equipment.deleteState(C3EM_OPERATING_TURNS_STATE_KEY);

        handler.handleSelection(equipment, handler.getChoices(equipment, context.query)[2], context.command);
        expect(equipment.states.get(C3EM_OPERATING_TURNS_STATE_KEY)).toBe('3');
    });

    it('ignores malformed track choices without mutating equipment', () => {
        const { equipment, owner, context } = fixture();

        for (const value of ['invalid', Number.NaN, 0, -1, 1.5, 8]) {
            handler.handleSelection(equipment, { label: String(value), value }, context.command);
        }

        expect(equipment.states.has(C3EM_OPERATING_TURNS_STATE_KEY)).toBeFalse();
        expect(owner.setInventoryEntry).not.toHaveBeenCalled();
        expect(context.toastService.showToast).not.toHaveBeenCalled();
    });

    it('maps active track buttons to the selected displayed turn without an offset', () => {
        const { equipment, context } = fixture('active');

        handler.handleSelection(equipment, handler.getChoices(equipment, context.query)[1], context.command);

        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(2);
        const choices = handler.getChoices(equipment, context.query);
        expect(choices[0]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'muted' }));
        expect(choices[1]).toEqual(jasmine.objectContaining({ active: true, selectionTone: 'selected' }));
        expect(choices[2].active).toBeFalse();
    });

    it('maps active turn 1 directly to sequence value 1', () => {
        const { equipment, context } = fixture('active');
        equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '4');

        handler.handleSelection(equipment, handler.getChoices(equipment, context.query)[0], context.command);

        expect(getC3EmergencyMasterOperatingTurns(equipment)).toBe(1);
        expect(equipment.states.get(C3EM_OPERATING_TURNS_STATE_KEY)).toBe('1');
        expect(handler.getChoices(equipment, context.query)[0]).toEqual(
            jasmine.objectContaining({ active: true, selectionTone: 'selected' })
        );
    });

    it('follows direct sequence values across Emergency toggles, frying, and corrections', () => {
        const { equipment, context, setStatus } = fixture('dormant');
        const track = () => handler.getChoices(equipment, context.query);
        const expectTrack = (active: number[], selected?: number) => {
            const choices = track();
            expect(choices.slice(0, 7).map(choice => choice.active)).toEqual(
                Array.from({ length: 7 }, (_, index) => active.includes(index + 1))
            );
            expect(choices.slice(0, 7).map(choice => choice.selectionTone)).toEqual(
                Array.from({ length: 7 }, (_, index) => index + 1 === selected ? 'selected' : 'muted')
            );
        };

        handler.handleSelection(equipment, track().at(-1)!, context.command);
        setStatus('active');
        expectTrack([1], 1);

        handler.handleSelection(equipment, track().at(-1)!, context.command);
        setStatus('dormant');
        expectTrack([1]);

        handler.handleSelection(equipment, track().at(-1)!, context.command);
        setStatus('active');
        expectTrack([1], 1);

        handler.handleSelection(equipment, track()[2], context.command);
        expectTrack([1, 2, 3], 3);

        handler.handleSelection(equipment, track().at(-1)!, context.command);
        setStatus('dormant');
        expectTrack([1, 2, 3]);

        setStatus('active');
        handler.handleSelection(equipment, track()[6], context.command);
        setStatus('fried');
        expect(getC3EmergencyMasterMode(equipment)).toBe('off');
        expectTrack([7], 7);

        handler.handleSelection(equipment, track()[5], context.command);
        setStatus('dormant');
        expect(isC3EmergencyMasterFried(equipment)).toBeFalse();
        expect(getC3EmergencyMasterMode(equipment)).toBe('off');
        expectTrack([1, 2, 3, 4, 5, 6]);

        handler.handleSelection(equipment, track().at(-1)!, context.command);
        setStatus('active');
        expectTrack([1, 2, 3, 4, 5, 6], 6);

        handler.handleSelection(equipment, track()[4], context.command);
        expectTrack([1, 2, 3, 4, 5], 5);
    });

    it('does not mutate unavailable or read-only equipment and blocks fried Emergency activation', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        const unavailable = fixture();
        unavailable.equipment.setCommittedDestroyed(true);
        const unavailableChoice = registry.getChoices(unavailable.equipment, unavailable.context.query).at(-1)!;
        expect(registry.handleSelection(unavailable.equipment, unavailableChoice, unavailable.context.command)).toBeFalse();
        expect(unavailable.equipment.states.has(C3EM_MODE_STATE_KEY)).toBeFalse();

        const readOnly = fixture();
        Object.assign(readOnly.owner, { readOnly: () => true });
        const readOnlyChoice = registry.getChoices(readOnly.equipment, readOnly.context.query).at(-1)!;
        expect(registry.handleSelection(readOnly.equipment, readOnlyChoice, readOnly.context.command)).toBeFalse();
        expect(readOnly.equipment.states.has(C3EM_MODE_STATE_KEY)).toBeFalse();

        const fried = fixture('fried');
        fried.equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, '7');
        const friedChoice = registry.getChoices(fried.equipment, fried.context.query).at(-1)!;
        expect(registry.handleSelection(fried.equipment, friedChoice, fried.context.command)).toBeFalse();
        expect(fried.equipment.states.has(C3EM_MODE_STATE_KEY)).toBeFalse();
    });
});
