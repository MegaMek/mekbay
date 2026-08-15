// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment, type WeaponDamage } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import type { DialogsService } from '../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import { BOMBAST_LASER_CHARGED_STATE, BOMBAST_LASER_CHARGE_STATE_KEY, BombastLaserHandler } from './bombast-laser.handler';
import {
    selectedTwBombastLaserMode,
    TW_BOMBAST_LASER_DAMAGE_10_MODE,
    TW_BOMBAST_LASER_DAMAGE_11_MODE,
    TW_BOMBAST_LASER_DAMAGE_12_MODE,
    TW_BOMBAST_LASER_DAMAGE_7_MODE,
    TW_BOMBAST_LASER_DAMAGE_8_MODE,
    TW_BOMBAST_LASER_DAMAGE_9_MODE,
    TwBombastLaserHandler,
    type TwBombastLaserMode,
} from './tw-bombast-laser.handler';

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);
const damageContext = {} as never;
const baseDamage: WeaponDamage = { values: [12, 10], maximum: 12 };

function bombastLaser(
    gameRules: CBTGameRules = TW_GAME_RULES,
    states = new Map<string, string>(),
    unitType: 'Mek' | 'Aero' = 'Mek',
): MountedWeapon {
    const { owner } = createTestEquipmentOwner({ gameRules, unit: { type: unitType } });
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    return new MountedWeapon({
        owner,
        id: 'bombast-laser',
        name: 'Bombast Laser',
        states,
        equipment: new WeaponEquipment({
            id: 'Bombast Laser',
            name: 'Bombast Laser',
            shortName: 'Bombast',
            type: 'weapon',
            flags: ['F_BOMBAST_LASER', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER'],
            stats: { toHitModifier: 3 },
            weapon: { ammoType: 'NA', damage: 12, heat: 12, av: [12, 12] },
        }),
    });
}

function select(handler: TwBombastLaserHandler, entry: MountedWeapon, mode: TwBombastLaserMode): void {
    handler.handleSelection(entry, { value: mode } as PickerChoice, commandContext);
}

describe('TwBombastLaserHandler', () => {
    const handler = new TwBombastLaserHandler();

    it('offers the six TW damage modes and no Core charge control', () => {
        const choices = handler.getChoices(bombastLaser(), queryContext);

        expect(choices).toEqual([jasmine.objectContaining({
            label: 'Mode',
            value: TW_BOMBAST_LASER_DAMAGE_12_MODE,
            displayType: 'dropdown',
            choices: [
                { label: '7 DMG', value: TW_BOMBAST_LASER_DAMAGE_7_MODE },
                { label: '8 DMG', value: TW_BOMBAST_LASER_DAMAGE_8_MODE },
                { label: '9 DMG', value: TW_BOMBAST_LASER_DAMAGE_9_MODE },
                { label: '10 DMG', value: TW_BOMBAST_LASER_DAMAGE_10_MODE },
                { label: '11 DMG', value: TW_BOMBAST_LASER_DAMAGE_11_MODE },
                { label: '12 DMG', value: TW_BOMBAST_LASER_DAMAGE_12_MODE },
            ],
            keepOpen: true,
        })]);
    });

    it('defaults invalid state to 12 damage and persists valid selections', () => {
        const entry = bombastLaser(TW_GAME_RULES, new Map([[INVENTORY_CONTROL_MODE_STATE, 'Damage 16']]));

        expect(selectedTwBombastLaserMode(entry)).toBe(TW_BOMBAST_LASER_DAMAGE_12_MODE);
        select(handler, entry, TW_BOMBAST_LASER_DAMAGE_9_MODE);
        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(TW_BOMBAST_LASER_DAMAGE_9_MODE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledOnceWith(entry);
    });

    it('applies TW damage, heat, and TN for every mode', () => {
        const profiles: readonly [TwBombastLaserMode, number, number][] = [
            [TW_BOMBAST_LASER_DAMAGE_7_MODE, 7, 0],
            [TW_BOMBAST_LASER_DAMAGE_8_MODE, 8, 1],
            [TW_BOMBAST_LASER_DAMAGE_9_MODE, 9, 1],
            [TW_BOMBAST_LASER_DAMAGE_10_MODE, 10, 2],
            [TW_BOMBAST_LASER_DAMAGE_11_MODE, 11, 2],
            [TW_BOMBAST_LASER_DAMAGE_12_MODE, 12, 3],
        ];

        for (const [mode, damage, modifier] of profiles) {
            const entry = bombastLaser(TW_GAME_RULES, new Map([[INVENTORY_CONTROL_MODE_STATE, mode]]));
            expect(handler.applyInventoryControlDamageEffects(entry, baseDamage, damageContext, queryContext))
                .toEqual({ values: [damage, damage], maximum: damage });
            expect(handler.applyInventoryControlHeatEffects(entry, { value: 12, weakened: false }, queryContext))
                .toEqual({ value: damage, weakened: false });
            expect(handler.getToHitAdjustments(entry, {}, queryContext)).toEqual(modifier === 0 ? [] : [{
                kind: 'replace-base',
                value: modifier,
                label: `Bombast (${mode})`,
            }]);
        }
    });

    it('uses the TW aerospace +3 TN and selected damage as attack value', () => {
        const entry = bombastLaser(
            TW_GAME_RULES,
            new Map([[INVENTORY_CONTROL_MODE_STATE, TW_BOMBAST_LASER_DAMAGE_7_MODE]]),
            'Aero',
        );

        expect(handler.getToHitAdjustments(entry, {}, queryContext)).toEqual([{
            kind: 'replace-base',
            value: 3,
            label: 'Bombast (Damage 7)',
        }]);
        expect(handler.applyInventoryControlAerospaceAttackValueEffects(entry, [12, 12, 0, 0], queryContext))
            .toEqual([7, 7, 0, 0]);
    });

    it('ignores stale Core charge state under TW', () => {
        const entry = bombastLaser(TW_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE],
        ]));
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        registry.afterInventoryControlFire(entry);
        registry.onEndTurn(entry, jasmine.createSpyObj<ToastService>('ToastService', ['showToast']));

        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(registry.getChoices(entry, queryContext).length).toBe(1);
        expect(entry.owner.setInventoryEntry).not.toHaveBeenCalled();
    });

    it('registers exactly one Bombast handler for each ruleset', () => {
        const coreHandler = new BombastLaserHandler();
        const registry = new EquipmentInteractionRegistry();
        registry.register(coreHandler);
        registry.register(handler);
        const coreEntry = bombastLaser(CORE_2026_GAME_RULES);
        const twEntry = bombastLaser();

        expect(registry.getHandlers(coreEntry)).toEqual([coreHandler]);
        expect(registry.getHandlers(twEntry)).toEqual([handler]);
        expect(handler.applicableTo(coreEntry)).toBeFalse();
        expect(handler.applicableTo(twEntry)).toBeTrue();
        expect(handler.flags).toEqual(['F_BOMBAST_LASER']);
    });
});
