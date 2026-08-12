// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment, type AmmoType, type WeaponDamage } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { formatInventoryControlHeat, type InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import { INVENTORY_CONTROL_MODE_STATE, type InventoryControlDisplayData } from '../utils/inventory-control.util';
import { formatWeaponDamage } from '../utils/weapon-damage.util';
import {
    UACFiringModeHandler,
    selectedUacFiringMode,
    selectedUacFiringModeShotCount
} from './uac-firing-mode.handler';

function owner(gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
    const { owner } = createTestEquipmentOwner({ gameRules });
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    return owner;
}

function entry(
    ammoType: AmmoType,
    modes = ['Single', '2-shot', '3-shot'],
    states = new Map<string, string>(),
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
): MountedWeapon {
    return new MountedWeapon({
        owner: owner(gameRules),
        id: ammoType,
        name: ammoType,
        states,
        equipment: new WeaponEquipment({
            id: ammoType,
            name: ammoType,
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            modes,
            weapon: { ammoType, damage: 5, heat: 1 }
        })
    });
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);

describe('UACFiringModeHandler', () => {
    const handler = new UACFiringModeHandler();

    it('matches the rotary and ultra autocannon entries', () => {
        expect(handler.applicableTo(entry('AC_ROTARY'))).toBeTrue();
        expect(handler.applicableTo(entry('AC_ULTRA'))).toBeFalse();
        expect(handler.applicableTo(entry('AC_ULTRA_THB'))).toBeFalse();
        expect(handler.applicableTo(entry('AC_ULTRA', ['Single', '2-shot'], new Map(), TW_GAME_RULES))).toBeTrue();
    });

    it('offers the equipment modes in their source order and defaults invalid state to the first mode', () => {
        const mounted = entry('AC_ROTARY', ['Single', '2-shot', '3-shot'], new Map([[INVENTORY_CONTROL_MODE_STATE, 'invalid']]));

        expect(selectedUacFiringMode(mounted)).toBe('Single');
        expect(handler.getChoices(mounted, queryContext)).toEqual([{
            label: 'Mode',
            value: 'Single',
            displayType: 'dropdown',
            choices: [
                { label: 'Single', value: 'Single' },
                { label: '2-shot', value: '2-shot' },
                { label: '3-shot', value: '3-shot' }
            ],
            keepOpen: true
        }]);
    });

    it('persists a selected equipment mode', () => {
        const mounted = entry('AC_ROTARY');

        expect(handler.handleSelection(mounted, { value: '3-shot' } as PickerChoice, commandContext)).toBeTrue();

        expect(mounted.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('3-shot');
        expect(mounted.owner.setInventoryEntry).toHaveBeenCalledWith(mounted);
        expect(selectedUacFiringModeShotCount(mounted)).toBe(3);
    });

    it('scales firing heat while preserving the existing damage and heat display', () => {
        const mounted = entry('AC_ROTARY', ['Single', '2-shot', '3-shot'], new Map([[INVENTORY_CONTROL_MODE_STATE, '3-shot']]));
        const damage: WeaponDamage = { values: [5], maximum: 30, unit: 'shot' };
        const heat: InventoryControlHeatEffect = { value: 1, weakened: false };

        const adjustedHeat = handler.applyInventoryControlHeatEffects(mounted, heat, queryContext);

        expect(formatWeaponDamage(damage)).toBe('5/Sht');
        expect(adjustedHeat).toEqual({ value: 3, weakened: false, displayValue: 1 });
        expect(formatInventoryControlHeat(adjustedHeat.displayValue ?? adjustedHeat.value, adjustedHeat.suffix, mounted.equipment.getRapidFireCount())).toBe('1/s');
    });

    it('scales ammo consumption by the selected shot count', () => {
        const mounted = entry('AC_ROTARY', ['Single', '2-shot', '3-shot'], new Map([[INVENTORY_CONTROL_MODE_STATE, '3-shot']]));

        expect(handler.applyInventoryControlAmmoConsumption(mounted, 1, queryContext)).toBe(3);
        expect(handler.applyInventoryControlAmmoConsumption(mounted, 2, queryContext)).toBe(6);
        expect(handler.applyInventoryControlAmmoConsumption(entry('AC_ROTARY'), 1, queryContext)).toBe(1);
    });

    it('keeps the first mode on the existing per-shot display', () => {
        const mounted = entry('AC_ROTARY');
        const damage: WeaponDamage = { values: [5], maximum: 30, unit: 'shot' };
        const heat: InventoryControlHeatEffect = { value: 1, weakened: false };

        expect(formatWeaponDamage(damage)).toBe('5/Sht');
        expect(handler.applyInventoryControlHeatEffects(mounted, heat, queryContext)).toBe(heat);
        expect(formatInventoryControlHeat(heat.value, heat.suffix, mounted.equipment.getRapidFireCount())).toBe('1/s');
    });

    it('only adds non-default modes to the SVG display name', () => {
        const mounted = entry('AC_ROTARY', ['Single', '2-shot', '3-shot'], new Map([[INVENTORY_CONTROL_MODE_STATE, '3-shot']]));
        const display: InventoryControlDisplayData = {
            name: 'Rotary AC/5',
            location: 'LT',
            heat: '1/s',
            damage: '5/Sht',
            hit: '—',
            min: '—',
            short: '4',
            medium: '8',
            long: '12',
        };
        const options = {
            selectedRange: null,
            hitModifierBreakdown: [],
            selectedAmmo: null,
        };

        expect(handler.applyInventoryControlDisplayEffects(mounted, display, options, queryContext).name).toBe('Rotary AC/5');
        expect(handler.applyInventoryControlDisplayEffects(mounted, display, { ...options, showModeName: true }, queryContext).name).toBe('Rotary AC/5 (3-shot)');

        const firstMode = entry('AC_ROTARY', ['Single', '2-shot', '3-shot']);
        expect(handler.applyInventoryControlDisplayEffects(firstMode, display, { ...options, showModeName: true }, queryContext).name).toBe('Rotary AC/5');
    });
});