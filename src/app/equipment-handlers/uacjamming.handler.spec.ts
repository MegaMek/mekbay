// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment, type AmmoType } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from '../models/rules/unit-type-rules';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { isEquipmentDisabledByFailure } from './disabled-equipment.handler';
import { UACJammingHandler } from './uacjamming.handler';

function owner(gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
    const getEquipmentStatus = (entry: MountedEquipment) => (
        entry.committedDestroyed()
            ? 'destroyed'
            : isEquipmentDisabledByFailure(entry)
                ? 'disabled'
                : 'available'
    );
    return {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        gameRules,
        getEquipmentStatus,
        isEquipmentOperational: (entry: MountedEquipment) => getEquipmentStatus(entry) === 'available',
        canPerformEquipmentAction: (entry: MountedEquipment) => getEquipmentStatus(entry) === 'available',
        canEditEquipmentState: () => true,
    } as never;
}

function weapon(ammoType: AmmoType): WeaponEquipment {
    return new WeaponEquipment({
        id: ammoType,
        name: ammoType,
        type: 'weapon',
        flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
        weapon: { ammoType }
    });
}

function entry(ammoType: AmmoType, states = new Map<string, string>(), gameRules: CBTGameRules = CORE_2026_GAME_RULES): MountedEquipment {
    return new MountedEquipment({
        owner: owner(gameRules),
        id: ammoType,
        name: ammoType,
        equipment: weapon(ammoType),
        states
    });
}

describe('UACJammingHandler', () => {
    const handler = new UACJammingHandler();
    const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
    const commandContext = createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );

    it('applies rotary autocannons and Tactical Warfare Ultra autocannons', () => {
        expect(handler.applicableTo(entry('AC_ROTARY'))).toBeTrue();
        expect(handler.applicableTo(entry('AC'))).toBeFalse();
        expect(handler.applicableTo(entry('AC_ULTRA'))).toBeFalse();
        expect(handler.applicableTo(entry('AC_ULTRA_THB'))).toBeFalse();
        expect(handler.applicableTo(entry('AC_ULTRA', new Map(), TW_GAME_RULES))).toBeTrue();
        expect(handler.applicableTo(entry('AC_ULTRA_THB', new Map(), TW_GAME_RULES))).toBeTrue();
    });

    it('toggles the shared disabled state with jam labels', () => {
        const mounted = entry('AC_ULTRA');

        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Jam',
            shortLabel: 'Jam',
            active: false,
            value: ENTRY_DISABLED_STATE_VALUE
        }));

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        expect(mounted.states.get(ENTRY_DISABLED_STATE_KEY)).toBe(ENTRY_DISABLED_STATE_VALUE);
        expect(mounted.states.has('state')).toBeFalse();
        expect(mounted.owner.setInventoryEntry).toHaveBeenCalledWith(mounted);
        expect(handler.getChoices(mounted, queryContext)[0]).toEqual(jasmine.objectContaining({
            label: 'Jammed',
            shortLabel: 'Unjam',
            active: true,
        }));

        handler.handleSelection(mounted, handler.getChoices(mounted, queryContext)[0], commandContext);

        expect(mounted.states.has(ENTRY_DISABLED_STATE_KEY)).toBeFalse();
    });
});
