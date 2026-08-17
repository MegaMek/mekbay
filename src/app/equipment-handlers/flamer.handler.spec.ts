// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { WeaponType } from '../models/weapon-types.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry
} from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { INVENTORY_CONTROL_MODE_STATE, type InventoryControlDisplayData } from '../utils/inventory-control.util';
import {
    FLAMER_DAMAGE_MODE,
    FLAMER_HEAT_MODE,
    FlamerHandler,
    selectedFlamerMode
} from './flamer.handler';

function owner(gameRules: CBTGameRules = TW_GAME_RULES) {
    const { owner } = createTestEquipmentOwner({ gameRules });
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    return owner;
}

function flamer(gameRules: CBTGameRules = TW_GAME_RULES, mode?: string): MountedWeapon {
    return new MountedWeapon({
        owner: owner(gameRules),
        id: 'flamer',
        name: 'Flamer',
        states: mode ? new Map([[INVENTORY_CONTROL_MODE_STATE, mode]]) : undefined,
        equipment: new WeaponEquipment({
            id: 'Flamer',
            name: 'Flamer',
            type: 'weapon',
            flags: ['F_FLAMER', 'F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { ammoType: 'NA', damage: 2, heat: 3 }
        })
    });
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);

const display: InventoryControlDisplayData = {
    name: 'Flamer', location: 'RA', heat: '3', damage: '2', hit: '—',
    min: '—', short: '1', medium: '2', long: '3'
};

describe('FlamerHandler', () => {
    const handler = new FlamerHandler();

    it('offers Damage and Heat modes under TW and defaults invalid state to Damage', () => {
        const entry = flamer(TW_GAME_RULES, 'invalid');

        expect(selectedFlamerMode(entry)).toBe(FLAMER_DAMAGE_MODE);
        expect(handler.getChoices(entry, queryContext)).toEqual([jasmine.objectContaining({
            label: 'Mode',
            value: FLAMER_DAMAGE_MODE,
            displayType: 'dropdown',
            choices: [
                { label: FLAMER_DAMAGE_MODE, value: FLAMER_DAMAGE_MODE },
                { label: FLAMER_HEAT_MODE, value: FLAMER_HEAT_MODE }
            ],
            keepOpen: true
        })]);
    });

    it('persists valid selections and ignores invalid values', () => {
        const entry = flamer();

        expect(handler.handleSelection(entry, { label: 'Heat', value: FLAMER_HEAT_MODE }, commandContext)).toBeTrue();
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(FLAMER_HEAT_MODE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledOnceWith(entry);

        handler.handleSelection(entry, { label: 'Invalid', value: 'invalid' }, commandContext);
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(FLAMER_HEAT_MODE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledTimes(1);
    });

    it('marks only Heat mode as an active heat-causing attack', () => {
        const types = new Set<WeaponType>(['AI', 'DE', 'H']);

        expect(handler.applyInventoryControlWeaponTypes(flamer(TW_GAME_RULES, FLAMER_DAMAGE_MODE), types, queryContext))
            .toEqual(new Set<WeaponType>(['AI', 'DE']));
        expect(handler.applyInventoryControlWeaponTypes(flamer(TW_GAME_RULES, FLAMER_HEAT_MODE), types, queryContext))
            .toBe(types);
        expect(types).toEqual(new Set<WeaponType>(['AI', 'DE', 'H']));
    });

    it('shows Heat mode in summaries without renaming the default Damage mode', () => {
        const options = { selectedRange: null, hitModifierBreakdown: [], showModeName: true };

        expect(handler.applyInventoryControlDisplayEffects(
            flamer(TW_GAME_RULES, FLAMER_HEAT_MODE), display, options, queryContext
        ).name).toBe('Flamer (Heat)');
        expect(handler.applyInventoryControlDisplayEffects(
            flamer(TW_GAME_RULES, FLAMER_DAMAGE_MODE), display, options, queryContext
        )).toBe(display);
    });

    it('registers only for TW flamer weapons', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        const misc = new MountedEquipment({
            owner: owner(TW_GAME_RULES),
            id: 'misc-flamer',
            name: 'Misc Flamer',
            equipment: new MiscEquipment({
                id: 'misc-flamer', name: 'Misc Flamer', type: 'misc', flags: ['F_FLAMER']
            })
        });

        expect(handler.applicableTo(flamer(TW_GAME_RULES))).toBeTrue();
        expect(handler.applicableTo(flamer(CORE_2026_GAME_RULES))).toBeFalse();
        expect(handler.applicableTo(misc)).toBeFalse();
        expect(registry.getChoices(flamer(TW_GAME_RULES), queryContext).length).toBe(1);
        expect(registry.getChoices(flamer(CORE_2026_GAME_RULES), queryContext)).toEqual([]);
        expect(handler.flags).toEqual(['F_FLAMER']);
    });
});
