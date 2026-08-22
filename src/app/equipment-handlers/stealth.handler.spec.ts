// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, type WritableSignal } from '@angular/core';
import type { PickerChoice } from '../components/picker/picker.interface';
import { ECMMode } from '../models/common.model';
import { ArmorEquipment, MiscEquipment, type Equipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import {
    getStealthTnModifiersForEquipment,
    getActiveStealthTnModifiers,
    hasFunctionalEcmForStealth,
    isC3DisruptingStealthActive,
    isStealthEquipmentActive,
    STEALTH_DISABLED_STATE,
    STEALTH_DISABLING_STATE,
    STEALTH_ENABLED_STATE,
    STEALTH_ENABLING_STATE,
    STEALTH_STATE_KEY,
} from '../models/stealth-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { StealthHandler } from './stealth.handler';
import { ECMHandler } from './ecm.handler';

interface StealthFixture {
    readonly owner: MountedEquipment['owner'];
    readonly markEquipmentStateChanged: jasmine.Spy;
    readonly moveDistance: WritableSignal<number | null>;
    add(id: string, equipment: Equipment, states?: Map<string, string>): MountedEquipment;
}

function fixture(): StealthFixture {
    const { owner } = createTestEquipmentOwner();
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    const moveDistance = signal<number | null>(0);
    Object.assign(owner, { turnState: () => ({ markEquipmentStateChanged, moveDistance }) });
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    return {
        owner,
        markEquipmentStateChanged,
        moveDistance,
        add: (id, equipment, states = new Map()) => {
            const entry = new MountedEquipment({ owner, id, name: equipment.name, equipment, states });
            owner.setInventoryEntry(entry);
            return entry;
        },
    };
}

function stealthArmor(type = 'STEALTH'): ArmorEquipment {
    return new ArmorEquipment({
        id: `stealth-${type}`,
        name: 'Stealth Armor',
        type: 'armor',
        modes: ['Off', 'On'],
        flags: ['F_STEALTH'],
        armor: { type },
    });
}

function passiveBattleArmorStealth(type = 'BA_STEALTH_IMP'): ArmorEquipment {
    return new ArmorEquipment({
        id: `stealth-${type}`,
        name: 'BA Stealth Armor',
        type: 'armor',
        flags: ['F_BA_EQUIPMENT', 'F_STEALTH'],
        armor: { type },
    });
}

function misc(id: string, flag: EquipmentFlag): MiscEquipment {
    return new MiscEquipment({
        id,
        name: id,
        type: 'misc',
        modes: flag === 'F_CHAMELEON_SHIELD' || flag === 'F_NULL_SIG' ? ['Off', 'On'] : undefined,
        flags: [flag],
    });
}

function visualCamo(type = 'BA_MIMETIC'): ArmorEquipment {
    return new ArmorEquipment({
        id: `visual-${type}`,
        name: type === 'BA_MIMETIC' ? 'Mimetic Armor' : 'Simple Camo',
        type: 'armor',
        flags: ['F_BA_EQUIPMENT', 'F_STEALTH', 'F_VISUAL_CAMO'],
        armor: { type },
    });
}

describe('StealthHandler', () => {
    const handler = new StealthHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        toastService,
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    beforeEach(() => toastService.showToast.calls.reset());

    it('handles switchable stealth and Chameleon, but gives passive stealth no toggle', () => {
        const test = fixture();
        const stealth = test.add('stealth', stealthArmor());
        const passive = test.add('passive', passiveBattleArmorStealth());
        const chameleon = test.add('chameleon', misc('Chameleon LPS', 'F_CHAMELEON_SHIELD'));
        const ecm = test.add('ecm', misc('ECM', 'F_ECM'));

        expect(handler.applicableTo(stealth)).toBeTrue();
        expect(handler.applicableTo(passive)).toBeTrue();
        expect(handler.applicableTo(chameleon)).toBeTrue();
        expect(handler.applicableTo(ecm)).toBeFalse();
        expect(handler.getChoices(passive, queryContext)).toEqual([]);
        expect(isStealthEquipmentActive(passive)).toBeTrue();
        expect(handler.getInventoryHeatSources(passive, {} as TurnState, queryContext)).toEqual([]);
    });

    it('refuses to activate switchable stealth without a functional ECM suite', () => {
        const test = fixture();
        const stealth = test.add('stealth', stealthArmor());
        const choice = handler.getChoices(stealth, queryContext)[0];

        expect(choice).toEqual(jasmine.objectContaining({
            value: STEALTH_ENABLING_STATE,
            active: false,
            disabled: true,
        }));

        handler.handleSelection(stealth, choice as PickerChoice, commandContext);

        expect(stealth.states.has(STEALTH_STATE_KEY)).toBeFalse();
        expect(toastService.showToast).toHaveBeenCalledWith(
            'Stealth armor requires a functional ECM suite',
            'error',
        );
    });

    it('powers stealth only from ECM-bearing ECM suite modes', () => {
        const test = fixture();
        const stealth = test.add('stealth', stealthArmor());
        const ecm = test.add('ecm', misc('ECM', 'F_ECM'));

        for (const mode of [ECMMode.ECM, ECMMode.ECM_ECCM, ECMMode.ECM_GHOST]) {
            ecm.states.set('ecm_mode', mode);
            expect(hasFunctionalEcmForStealth(stealth)).withContext(mode).toBeTrue();
            expect(handler.getChoices(stealth, queryContext)[0].disabled).withContext(mode).not.toBeTrue();
        }
        for (const mode of [ECMMode.OFF, ECMMode.ECCM, ECMMode.GHOST, ECMMode.ECCM_GHOST]) {
            ecm.states.set('ecm_mode', mode);
            expect(hasFunctionalEcmForStealth(stealth)).withContext(mode).toBeFalse();
            expect(handler.getChoices(stealth, queryContext)[0].disabled).withContext(mode).toBeTrue();
        }
    });

    it('switches stealth at end turn and contributes 10 Equipment heat only while effective', () => {
        const test = fixture();
        const stealth = test.add('stealth', stealthArmor());
        const ecm = test.add('ecm', misc('ECM', 'F_ECM'));

        handler.handleSelection(stealth, handler.getChoices(stealth, queryContext)[0], commandContext);
        expect(stealth.states.get(STEALTH_STATE_KEY)).toBe(STEALTH_ENABLING_STATE);
        expect(handler.getInventoryHeatSources(stealth, {} as TurnState, queryContext)).toEqual([]);

        handler.onEndTurn(stealth);
        expect(stealth.states.get(STEALTH_STATE_KEY)).toBe(STEALTH_ENABLED_STATE);
        expect(handler.getInventoryHeatSources(stealth, {} as TurnState, queryContext)).toEqual([{
            id: 'equipment:stealth',
            label: 'Equipment',
            value: 10,
        }]);
        expect(isC3DisruptingStealthActive(stealth)).toBeTrue();
        expect(new ECMHandler().isActive(ecm)).toBeFalse();

        handler.handleSelection(stealth, handler.getChoices(stealth, queryContext)[0], commandContext);
        expect(stealth.states.get(STEALTH_STATE_KEY)).toBe(STEALTH_DISABLING_STATE);
        expect(handler.getInventoryHeatSources(stealth, {} as TurnState, queryContext)[0].value).toBe(10);

        handler.onEndTurn(stealth);
        expect(stealth.states.get(STEALTH_STATE_KEY)).toBe(STEALTH_DISABLED_STATE);
        expect(handler.getInventoryHeatSources(stealth, {} as TurnState, queryContext)).toEqual([]);
        expect(test.markEquipmentStateChanged).toHaveBeenCalledTimes(2);
    });

    it('forces stealth off when its ECM is being destroyed', () => {
        const test = fixture();
        const stealth = test.add('stealth', stealthArmor(), new Map([
            [STEALTH_STATE_KEY, STEALTH_ENABLED_STATE],
        ]));
        const ecm = test.add('ecm', misc('ECM', 'F_ECM'));
        ecm.setPendingDestroyed(true);

        expect(isC3DisruptingStealthActive(stealth)).toBeFalse();
        expect(handler.getInventoryHeatSources(stealth, {} as TurnState, queryContext)).toEqual([]);

        handler.beforeEquipmentStateCommit(stealth);

        expect(stealth.states.get(STEALTH_STATE_KEY)).toBe(STEALTH_DISABLED_STATE);
    });

    it('forces active stealth off when its ECM leaves an ECM-bearing mode', () => {
        const test = fixture();
        const stealth = test.add('stealth', stealthArmor(), new Map([
            [STEALTH_STATE_KEY, STEALTH_ENABLED_STATE],
        ]));
        const ecm = test.add('ecm', misc('ECM', 'F_ECM'));
        ecm.states.set('ecm_mode', ECMMode.GHOST);

        expect(isStealthEquipmentActive(stealth)).toBeTrue();
        expect(handler.getInventoryHeatSources(stealth, {} as TurnState, queryContext)).toEqual([]);

        handler.beforeEquipmentStateCommit(stealth);

        expect(stealth.states.get(STEALTH_STATE_KEY)).toBe(STEALTH_DISABLED_STATE);
    });

    it('activates Chameleon without ECM, contributes 6 heat, and leaves C3 available', () => {
        const test = fixture();
        const chameleon = test.add('chameleon', misc('Chameleon LPS', 'F_CHAMELEON_SHIELD'));

        handler.handleSelection(chameleon, handler.getChoices(chameleon, queryContext)[0], commandContext);
        handler.onEndTurn(chameleon);

        expect(handler.getInventoryHeatSources(chameleon, {} as TurnState, queryContext)).toEqual([{
            id: 'equipment:chameleon',
            label: 'Equipment',
            value: 6,
        }]);
        expect(isC3DisruptingStealthActive(chameleon)).toBeFalse();
    });

    it('activates Null Signature without ECM, contributes 10 heat, and leaves C3 available', () => {
        const test = fixture();
        const nullSignature = test.add('null-signature', misc('Null Signature', 'F_NULL_SIG'));

        handler.handleSelection(nullSignature, handler.getChoices(nullSignature, queryContext)[0], commandContext);
        handler.onEndTurn(nullSignature);

        expect(handler.getInventoryHeatSources(nullSignature, {} as TurnState, queryContext)).toEqual([{
            id: 'equipment:null-signature',
            label: 'Equipment',
            value: 10,
        }]);
        expect(isC3DisruptingStealthActive(nullSignature)).toBeFalse();
    });

    it('uses the Total Warfare Battle Armor stealth range profiles', () => {
        const test = fixture();
        const improved = test.add('improved', passiveBattleArmorStealth('BA_STEALTH_IMP'));
        const standard = test.add('standard', passiveBattleArmorStealth('BA_STEALTH'));
        const basic = test.add('basic', passiveBattleArmorStealth('BA_STEALTH_BASIC'));
        const prototype = test.add('prototype', passiveBattleArmorStealth('BA_STEALTH_PROTOTYPE'));

        const conventionalInfantry = { short: 0, medium: 0, long: 0 };
        expect(getStealthTnModifiersForEquipment(improved)).toEqual({ short: 1, medium: 2, long: 3, conventionalInfantry });
        expect(getStealthTnModifiersForEquipment(standard)).toEqual({ short: 1, medium: 1, long: 2, conventionalInfantry });
        expect(getStealthTnModifiersForEquipment(basic)).toEqual({ short: 0, medium: 1, long: 2, conventionalInfantry });
        expect(getStealthTnModifiersForEquipment(prototype)).toEqual({ short: 0, medium: 1, long: 2, conventionalInfantry });
    });

    it('uses visual camouflage movement modifiers without treating it as ECM stealth', () => {
        const test = fixture();
        const mimetic = test.add('mimetic', visualCamo());
        const simpleCamo = test.add('simple-camo', visualCamo('BA_STANDARD'));

        expect(getStealthTnModifiersForEquipment(mimetic, 0)).toEqual({ short: 3, medium: 3, long: 3 });
        expect(getStealthTnModifiersForEquipment(mimetic, 1)).toEqual({ short: 2, medium: 2, long: 2 });
        expect(getStealthTnModifiersForEquipment(mimetic, 2)).toEqual({ short: 1, medium: 1, long: 1 });
        expect(getStealthTnModifiersForEquipment(mimetic, 3)).toEqual({ short: 0, medium: 0, long: 0 });
        expect(getStealthTnModifiersForEquipment(simpleCamo, 0)).toEqual({ short: 2, medium: 2, long: 2 });
        expect(getStealthTnModifiersForEquipment(simpleCamo, 1)).toEqual({ short: 1, medium: 1, long: 1 });
        expect(getStealthTnModifiersForEquipment(simpleCamo, 2)).toEqual({ short: 0, medium: 0, long: 0 });

        test.moveDistance.set(1);
        expect(getActiveStealthTnModifiers(test.owner)).toEqual({ short: 2, medium: 2, long: 2 });
    });
});
