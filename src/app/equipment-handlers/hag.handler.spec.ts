// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { WeaponType } from '../models/weapon-types.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import {
    GAUSS_POWER_STATE_KEY,
    GAUSS_POWERED_DOWN_STATE,
    GAUSS_POWERING_UP_STATE,
    gaussPowerState,
} from '../utils/gauss-power-state.util';
import { GaussPowerHandler } from './gauss-power.handler';
import { HAG_FLAK_MODE, HAG_MODE_STATE_KEY, HAG_STANDARD_MODE, HagHandler, selectedHagMode } from './hag.handler';

function owner() {
    return {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        isEquipmentOperational: jasmine.createSpy('isEquipmentOperational').and.returnValue(true),
        canPerformEquipmentAction: jasmine.createSpy('canPerformEquipmentAction').and.returnValue(true),
    } as never;
}

function hag(mode?: string): MountedWeapon {
    return new MountedWeapon({
        owner: owner(),
        id: 'CLHAG20',
        name: 'HAG/20',
        states: mode ? new Map([[HAG_MODE_STATE_KEY, mode]]) : undefined,
        equipment: new WeaponEquipment({
            id: 'CLHAG20',
            name: 'HAG/20',
            type: 'weapon',
            flags: ['F_HAG', 'F_GAUSS', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            stats: { explosive: true },
            weapon: {
                ammoType: 'HAG',
                damage: 'cluster',
                rackSize: 20,
                ranges: [8, 16, 24, 32]
            }
        })
    });
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);

describe('HagHandler', () => {
    const handler = new HagHandler();

    it('offers STD and FLAK modes and defaults invalid state to STD', () => {
        const entry = hag('invalid');

        expect(selectedHagMode(entry)).toBe(HAG_STANDARD_MODE);
        expect(handler.getChoices(entry, queryContext)).toEqual([jasmine.objectContaining({
            label: 'Mode',
            value: HAG_STANDARD_MODE,
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: HAG_STANDARD_MODE },
                { label: 'FLAK', value: HAG_FLAK_MODE }
            ]
        })]);
    });

    it('persists the selected mode through the HAG state', () => {
        const entry = hag();

        expect(handler.handleSelection(entry, { label: 'FLAK', value: HAG_FLAK_MODE }, commandContext)).toBeTrue();

        expect(entry.states.get(HAG_MODE_STATE_KEY)).toBe(HAG_FLAK_MODE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('keeps HAG mode and Gauss power as independent states', () => {
        const entry = hag(HAG_FLAK_MODE);
        entry.states.set(GAUSS_POWER_STATE_KEY, GAUSS_POWERED_DOWN_STATE);
        Object.assign(entry.owner, {
            turnState: () => ({ markEquipmentStateChanged: jasmine.createSpy('markEquipmentStateChanged') }),
        });

        const gaussHandler = new GaussPowerHandler();
        gaussHandler.handleSelection(
            entry,
            gaussHandler.getChoices(entry, queryContext)[0],
            commandContext,
        );

        expect(gaussPowerState(entry)).toBe(GAUSS_POWERING_UP_STATE);
        expect(selectedHagMode(entry)).toBe(HAG_FLAK_MODE);

        handler.handleSelection(entry, { label: 'STD', value: HAG_STANDARD_MODE }, commandContext);

        expect(selectedHagMode(entry)).toBe(HAG_STANDARD_MODE);
        expect(gaussPowerState(entry)).toBe(GAUSS_POWERING_UP_STATE);
        expect(entry.states.get(HAG_MODE_STATE_KEY)).toBe(HAG_STANDARD_MODE);
    });

    it('keeps DB only in STD and replaces it with F in FLAK', () => {
        const baseTypes = new Set<WeaponType>(['C', 'DB', 'F', 'X']);

        expect(handler.applyInventoryControlWeaponTypes(hag(HAG_STANDARD_MODE), baseTypes, queryContext))
            .toEqual(new Set<WeaponType>(['C', 'DB', 'X']));
        expect(handler.applyInventoryControlWeaponTypes(hag(HAG_FLAK_MODE), baseTypes, queryContext))
            .toEqual(new Set<WeaponType>(['C', 'F', 'X']));
        expect(baseTypes).toEqual(new Set<WeaponType>(['C', 'DB', 'F', 'X']));
    });

    it('adds a -1 to-hit adjustment only in FLAK mode', () => {
        expect(handler.getToHitAdjustments(hag(HAG_STANDARD_MODE), {}, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(hag(HAG_FLAK_MODE), {}, queryContext))
            .toEqual([{
                kind: 'add', label: 'HAG/20 (FLAK)', modifier: -1
            }]);
    });

    it('requires both the F_HAG registry flag and weapon equipment', () => {
        const hagMisc = new MountedEquipment({
            owner: owner(),
            id: 'misc-hag',
            name: 'Misc HAG',
            equipment: new MiscEquipment({ id: 'misc-hag', name: 'Misc HAG', type: 'misc', flags: ['F_HAG'] })
        });

        expect(handler.applicableTo(hag())).toBeTrue();
        expect(handler.applicableTo(hagMisc)).toBeFalse();
        expect(handler.flags).toEqual(['F_HAG']);
    });
});
