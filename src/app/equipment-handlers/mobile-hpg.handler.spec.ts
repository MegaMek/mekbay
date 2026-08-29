// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import type { UnitEngineType, WeightClass } from '../models/unit-summary.model';
import type { DialogsService } from '../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import {
    HPG_CHARGED_STATE,
    HPG_CHARGING_STATE,
    HPG_COOLDOWN_STATE,
    HPG_IDLE_STATE,
    HPG_TRANSMITTING_STATE,
    hpgState,
} from '../utils/hpg-state.util';
import { MobileHpgHandler } from './mobile-hpg.handler';

interface HpgFixtureOptions {
    readonly groundMobile?: boolean;
    readonly engine?: UnitEngineType | null;
    readonly weightClass?: WeightClass;
}

function fixture(options: HpgFixtureOptions = {}) {
    let moveMode = 'stationary';
    let moveDistance = 0;
    let weaponSelected = false;
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    const { owner } = createTestEquipmentOwner({
        unit: {
            engine: options.engine === undefined ? 'Fusion' : options.engine,
            weightClass: options.weightClass ?? 'Medium',
        },
    });
    Object.assign(owner, {
        turnState: () => ({
            effectiveMoveMode: () => moveMode,
            moveDistance: () => moveDistance,
            markEquipmentStateChanged,
        }),
    });
    const equipment = new MiscEquipment({
        id: options.groundMobile === false ? 'ISMobileHPG' : 'ISGroundMobileHPG',
        name: options.groundMobile === false ? 'Mobile HPG' : 'Ground-Mobile HPG',
        type: 'misc',
        flags: options.groundMobile === false
            ? ['F_MOBILE_HPG']
            : ['F_MOBILE_HPG', 'F_MEK_EQUIPMENT'],
    });
    const mounted = new MountedEquipment({
        owner,
        id: equipment.id,
        name: equipment.name,
        equipment,
    });
    owner.setInventoryEntry(mounted);
    const weapon = new MountedEquipment({
        owner,
        id: 'test-weapon',
        name: 'Test Weapon',
        equipment: new WeaponEquipment({
            id: 'test-weapon',
            name: 'Test Weapon',
            type: 'weapon',
            weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] },
        }),
    });
    owner.setInventoryEntry(weapon);
    Object.assign(owner, {
        isInventoryControlEntrySelected: (id: string) => weaponSelected && id === weapon.id,
    });
    return {
        owner,
        mounted,
        markEquipmentStateChanged,
        setMovement: (mode: string, distance: number) => {
            moveMode = mode;
            moveDistance = distance;
        },
        setWeaponSelected: (selected: boolean) => { weaponSelected = selected; },
    };
}

describe('MobileHpgHandler', () => {
    const handler = new MobileHpgHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast', 'toasts']);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        toastService,
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );
    const turnState = {} as TurnState;

    beforeEach(() => toastService.showToast.calls.reset());

    it('recognizes only actual fusion-engine variants', () => {
        for (const engine of [
            'Fusion', 'XL (IS)', 'XL (Clan)', 'XXL (IS)', 'XXL (Clan)', 'Light', 'Compact',
        ] satisfies UnitEngineType[]) {
            expect(handler.getChoices(fixture({ engine }).mounted, queryContext)[0].disabled)
                .withContext(engine)
                .toBeFalse();
        }

        for (const engine of [
            'ICE', 'Fuel Cell', 'Fission', 'None', 'MagLev', 'Steam', 'Battery', 'Solar', 'External',
        ] satisfies UnitEngineType[]) {
            expect(handler.getChoices(fixture({ engine }).mounted, queryContext)[0].disabled)
                .withContext(engine)
                .toBeTrue();
        }

        const missingEngine = fixture();
        Object.assign(missingEngine.owner.getUnit(), { engine: undefined });
        expect(handler.getChoices(missingEngine.mounted, queryContext)[0].disabled).toBeTrue();
    });

    it('charges, transmits, generates grouped heat, and observes the five-turn ground cycle', () => {
        const { mounted } = fixture();

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        expect(hpgState(mounted)).toBe(HPG_CHARGING_STATE);
        expect(handler.getInventoryHeatSources(mounted, turnState, queryContext)).toEqual([{
            id: `mobile-hpg:${mounted.id}`,
            label: 'HPG Charging',
            value: 20,
            group: 'Equipment',
        }]);

        handler.onEndTurn(mounted);
        expect(hpgState(mounted)).toBe(HPG_CHARGED_STATE);
        expect(handler.getInventoryHeatSources(mounted, turnState, queryContext)).toEqual([]);

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        expect(hpgState(mounted)).toBe(HPG_TRANSMITTING_STATE);
        expect(handler.getInventoryHeatSources(mounted, turnState, queryContext)[0])
            .toEqual(jasmine.objectContaining({ label: 'HPG Transmission', value: 20 }));

        handler.onEndTurn(mounted);
        expect(hpgState(mounted)).toBe(HPG_COOLDOWN_STATE);
        expect(handler.getChoices(mounted, queryContext)[0].label).toBe('HPG Cooldown (3)');
        handler.onEndTurn(mounted);
        handler.onEndTurn(mounted);
        handler.onEndTurn(mounted);
        expect(hpgState(mounted)).toBe(HPG_IDLE_STATE);
    });

    it('requires a Ground-Mobile HPG to spend zero MP before transmitting', () => {
        const { mounted, setMovement } = fixture();
        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        handler.onEndTurn(mounted);
        setMovement('walk', 1);

        const transmit = handler.getChoices(mounted, queryContext)[0] as PickerChoice;
        expect(transmit.disabled).toBeTrue();
        handler.handleSelection(mounted, transmit, commandContext);

        expect(hpgState(mounted)).toBe(HPG_CHARGED_STATE);
        expect(toastService.showToast).toHaveBeenCalledWith(
            'A Ground-Mobile HPG can transmit only after spending 0 MP',
            'error',
        );
    });

    it('does not begin charging or transmitting after a weapon attack is selected', () => {
        const { mounted, setWeaponSelected } = fixture();
        setWeaponSelected(true);

        const charge = handler.getChoices(mounted, queryContext)[0];
        expect(charge.disabled).toBeTrue();
        handler.handleSelection(mounted, { ...charge, disabled: false }, commandContext);
        expect(hpgState(mounted)).toBe(HPG_IDLE_STATE);

        setWeaponSelected(false);
        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        handler.onEndTurn(mounted);
        expect(hpgState(mounted)).toBe(HPG_CHARGED_STATE);

        setWeaponSelected(true);
        const transmit = handler.getChoices(mounted, queryContext)[0];
        expect(transmit.disabled).toBeTrue();
        handler.handleSelection(mounted, { ...transmit, disabled: false }, commandContext);
        expect(hpgState(mounted)).toBe(HPG_CHARGED_STATE);
        expect(toastService.showToast).toHaveBeenCalledWith(
            'An HPG cannot charge or transmit in a turn with weapon attacks',
            'error',
        );
    });

    it('lets a Large Support Vehicle begin a new charge after transmission', () => {
        const { mounted } = fixture({ weightClass: 'Large Support Vehicle' });
        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        handler.onEndTurn(mounted);
        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        handler.onEndTurn(mounted);

        expect(hpgState(mounted)).toBe(HPG_IDLE_STATE);
        expect(handler.getChoices(mounted, queryContext)[0].label).toBe('Charge HPG');
    });

    it('toggles a Mobile HPG transmission and generates 40 heat', () => {
        const { mounted } = fixture({ groundMobile: false });

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        expect(hpgState(mounted)).toBe(HPG_TRANSMITTING_STATE);
        expect(handler.getInventoryHeatSources(mounted, turnState, queryContext)[0])
            .toEqual(jasmine.objectContaining({ value: 40, group: 'Equipment' }));

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);
        expect(hpgState(mounted)).toBe(HPG_IDLE_STATE);
    });
});
