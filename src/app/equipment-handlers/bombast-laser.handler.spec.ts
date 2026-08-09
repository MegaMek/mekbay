// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { MiscEquipment, WeaponEquipment, type WeaponDamage } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { WeaponType } from '../models/weapon-types.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import type { DialogsService } from '../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
    type HandlerCommandContext,
} from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import {
    BOMBAST_LASER_CHARGED_COLOR,
    BOMBAST_LASER_CHARGED_STATE,
    BOMBAST_LASER_CHARGED_TEXT_COLOR,
    BOMBAST_LASER_CHARGE_STATE_KEY,
    BOMBAST_LASER_CHARGING_STATE,
    BOMBAST_LASER_DAMAGE_12_MODE,
    BOMBAST_LASER_DAMAGE_16_MODE,
    BOMBAST_LASER_DAMAGE_8_MODE,
    BOMBAST_LASER_FIRED_STATE_KEY,
    BombastLaserHandler,
    bombastLaserChargeState,
    selectedBombastLaserMode
} from './bombast-laser.handler';

function owner(gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
    const { owner } = createTestEquipmentOwner({ gameRules });
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    Object.assign(owner, {
        turnState: () => ({ markEquipmentStateChanged }),
    });
    spyOn(owner, 'setInventoryEntry').and.callThrough();
    return owner;
}

function equipmentStateChangeMarker(entry: MountedEquipment): jasmine.Spy {
    return entry.owner.turnState().markEquipmentStateChanged as jasmine.Spy;
}

function bombastLaser(
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
    states = new Map<string, string>(),
    destroyed = false
): MountedWeapon {
    return new MountedWeapon({
        owner: owner(gameRules),
        id: 'bombast-laser',
        name: 'Bombast Laser',
        states,
        destroyed,
        equipment: new WeaponEquipment({
            id: 'Bombast Laser',
            name: 'Bombast Laser',
            shortName: 'Bombast',
            type: 'weapon',
            flags: ['F_BOMBAST_LASER', 'F_DIRECT_FIRE', 'F_ENERGY', 'F_LASER'],
            weapon: { ammoType: 'NA', damage: 12, heat: 12 }
        })
    });
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);

function commandContext(toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast'])): HandlerCommandContext {
    return createHandlerCommandContext(
        EMPTY_EQUIPMENT_REGISTRY,
        toastService,
        jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
    );
}

function contexts() {
    const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    return {
        query: queryContext,
        command: commandContext(toastService),
        toastService,
    };
}

const damageContext = {} as never;
const baseDamage: WeaponDamage = { values: [12], maximum: 12 };

function select(handler: BombastLaserHandler, entry: MountedEquipment, value: string, context = commandContext()): void {
    handler.handleSelection(entry, { value } as PickerChoice, context);
}

describe('BombastLaserHandler', () => {
    const handler = new BombastLaserHandler();

    it('offers the three Core damage levels and a charge control', () => {
        const choices = handler.getChoices(bombastLaser(), queryContext);

        expect(choices[0]).toEqual(jasmine.objectContaining({
            label: 'Mode',
            value: BOMBAST_LASER_DAMAGE_12_MODE,
            displayType: 'dropdown',
            choices: [
                { label: '8 DMG', value: BOMBAST_LASER_DAMAGE_8_MODE },
                { label: '12 DMG', value: BOMBAST_LASER_DAMAGE_12_MODE },
                { label: '16 DMG', value: BOMBAST_LASER_DAMAGE_16_MODE }
            ],
            keepOpen: true
        }));
        expect(choices[1]).toEqual(jasmine.objectContaining({
            label: 'Charge Laser',
            shortLabel: 'Charge',
            value: BOMBAST_LASER_CHARGING_STATE,
            active: false,
            displayType: 'toggle'
        }));
    });

    it('defaults missing and invalid mode and charge states safely', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, 'Damage 99'],
            [BOMBAST_LASER_CHARGE_STATE_KEY, 'invalid']
        ]));

        expect(selectedBombastLaserMode(entry)).toBe(BOMBAST_LASER_DAMAGE_12_MODE);
        expect(bombastLaserChargeState(entry)).toBeNull();
    });

    it('persists valid damage selections without changing charge state', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));

        select(handler, entry, BOMBAST_LASER_DAMAGE_16_MODE);

        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(BOMBAST_LASER_DAMAGE_16_MODE);
        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('resolves damage and heat for every selectable damage level', () => {
        const profiles = [
            { mode: BOMBAST_LASER_DAMAGE_8_MODE, damage: 8, heat: 6 },
            { mode: BOMBAST_LASER_DAMAGE_12_MODE, damage: 12, heat: 9 },
            { mode: BOMBAST_LASER_DAMAGE_16_MODE, damage: 16, heat: 12 }
        ];

        for (const profile of profiles) {
            const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([[INVENTORY_CONTROL_MODE_STATE, profile.mode]]));
            expect(handler.applyInventoryControlDamageEffects(entry, baseDamage, damageContext, queryContext))
                .toEqual({ values: [profile.damage], maximum: profile.damage });
            expect(handler.applyInventoryControlHeatEffects(entry, { value: 12, weakened: false }, queryContext))
                .toEqual({ value: profile.heat, weakened: false });
        }
        expect(baseDamage).toEqual({ values: [12], maximum: 12 });
    });

    it('applies the selected damage across range profiles', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_8_MODE]
        ]));
        const rangedDamage: WeaponDamage = { values: [12, 10, 8], maximum: 12 };

        expect(handler.applyInventoryControlDamageEffects(entry, rangedDamage, damageContext, queryContext)).toEqual({
            values: [8, 8, 8],
            maximum: 8
        });
        expect(rangedDamage.values).toEqual([12, 10, 8]);
    });

    it('applies +1 and +2 TN modifiers for uncharged 12 and 16 damage attacks', () => {
        const damage12 = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_12_MODE]
        ]));
        const damage16 = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_16_MODE]
        ]));

        expect(handler.getToHitAdjustments(bombastLaser(CORE_2026_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_8_MODE]
        ])), {}, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(damage12, {}, queryContext)).toEqual([{
            kind: 'replace-base', value: 1, label: 'Bombast (Damage 12)'
        }]);
        expect(handler.getToHitAdjustments(damage16, {}, queryContext)).toEqual([{
            kind: 'replace-base', value: 2, label: 'Bombast (Damage 16)'
        }]);
    });

    it('treats the selected TN as a mode base rather than a weakened modifier', () => {
        for (const [mode, expected] of [
            [BOMBAST_LASER_DAMAGE_12_MODE, 1],
            [BOMBAST_LASER_DAMAGE_16_MODE, 2]
        ] as const) {
            const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([[INVENTORY_CONTROL_MODE_STATE, mode]]));
            const resolution = CORE_2026_GAME_RULES.resolveToHit({
                subject: entry,
                adjustments: handler.getToHitAdjustments(entry, {}, queryContext)
            });

            expect(resolution.value).toBe(expected);
            expect(resolution.weakened).toBeFalse();
            expect(resolution.modifierBreakdown).toEqual([{
                label: `Bombast (${mode})`,
                modifier: expected
            }]);
        }
    });

    it('suppresses every additional TN modifier while charged', () => {
        for (const mode of [BOMBAST_LASER_DAMAGE_8_MODE, BOMBAST_LASER_DAMAGE_12_MODE, BOMBAST_LASER_DAMAGE_16_MODE]) {
            const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
                [INVENTORY_CONTROL_MODE_STATE, mode],
                [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
            ]));

            expect(handler.getToHitAdjustments(entry, {}, queryContext)).toEqual([]);
        }
    });

    it('charges for one turn, blocks firing, and becomes charged at end turn', () => {
        const entry = bombastLaser();
        const testContexts = contexts();

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE, testContexts.command);

        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGING_STATE);
        expect(handler.isInventoryControlSelectable(entry, testContexts.query)).toBeFalse();
        expect(testContexts.toastService.showToast).toHaveBeenCalledWith('Bombast Laser charging', 'info');

        handler.onEndTurn(entry);

        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(handler.isInventoryControlSelectable(entry, testContexts.query)).toBeNull();
        expect(handler.getChoices(entry, testContexts.query)[1]).toEqual(jasmine.objectContaining({
            label: 'Laser Charged!',
            shortLabel: 'Charged!',
            value: 'discharged',
            active: true,
            colors: {
                selected: BOMBAST_LASER_CHARGED_COLOR,
                selectedText: BOMBAST_LASER_CHARGED_TEXT_COLOR
            }
        }));
    });

    it('marks the phase dirty exactly once when charging begins', () => {
        const entry = bombastLaser();
        const markEquipmentStateChanged = equipmentStateChangeMarker(entry);

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE);

        expect(markEquipmentStateChanged).toHaveBeenCalledTimes(1);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledOnceWith(entry);
    });

    it('does not mark the phase dirty for a repeated or rejected charge request', () => {
        const charging = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGING_STATE]
        ]));
        const chargingMarker = equipmentStateChangeMarker(charging);

        select(handler, charging, BOMBAST_LASER_CHARGING_STATE);

        expect(chargingMarker).not.toHaveBeenCalled();
        expect(charging.owner.setInventoryEntry).not.toHaveBeenCalled();

        const fired = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_FIRED_STATE_KEY, '1']
        ]));
        const firedMarker = equipmentStateChangeMarker(fired);

        select(handler, fired, BOMBAST_LASER_CHARGING_STATE);

        expect(firedMarker).not.toHaveBeenCalled();
        expect(fired.owner.setInventoryEntry).not.toHaveBeenCalled();
    });

    it('does not explicitly mark mode, discharge, fire, or end-turn state changes', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const markEquipmentStateChanged = equipmentStateChangeMarker(entry);

        select(handler, entry, BOMBAST_LASER_DAMAGE_16_MODE);
        select(handler, entry, 'discharged');
        handler.afterInventoryControlFire(entry);
        handler.onEndTurn(entry);

        expect(markEquipmentStateChanged).not.toHaveBeenCalled();
    });

    it('can begin charged, gains X, and discharges after firing', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const types = new Set<WeaponType>(['DE', 'V']);

        expect(handler.applyInventoryControlWeaponTypes(entry, types, queryContext))
            .toEqual(new Set<WeaponType>(['DE', 'V', 'X']));
        expect(types).toEqual(new Set<WeaponType>(['DE', 'V']));

        handler.afterInventoryControlFire(entry);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(entry.states.get(BOMBAST_LASER_FIRED_STATE_KEY)).toBe('1');
        expect(handler.applyInventoryControlWeaponTypes(entry, types, queryContext)).toBe(types);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('rejects charging after firing until the turn ends', () => {
        const entry = bombastLaser();
        const testContexts = contexts();
        handler.afterInventoryControlFire(entry);

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE, testContexts.command);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(testContexts.toastService.showToast).toHaveBeenCalledWith(
            'A fired Bombast Laser cannot charge this turn.',
            'error'
        );

        handler.onEndTurn(entry);
        expect(entry.states.has(BOMBAST_LASER_FIRED_STATE_KEY)).toBeFalse();

        select(handler, entry, BOMBAST_LASER_CHARGING_STATE, testContexts.command);
        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGING_STATE);
    });

    it('allows a charge to be manually dissipated', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const testContexts = contexts();

        select(handler, entry, 'discharged', testContexts.command);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(testContexts.toastService.showToast).toHaveBeenCalledWith('Bombast Laser discharged', 'info');
    });

    it('clears an unavailable laser charge instead of progressing it', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGING_STATE]
        ]), true);
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);

        expect(handler.isInventoryControlSelectable(entry, queryContext)).toBeNull();

        handler.onEndTurn(entry);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(handler.getChoices(entry, queryContext)).toEqual([
            jasmine.objectContaining({ label: 'Mode', value: BOMBAST_LASER_DAMAGE_12_MODE }),
            jasmine.objectContaining({ label: 'Charge Laser', active: false, disabled: false }),
        ]);
        expect(registry.getChoices(entry, queryContext).every(choice => choice.disabled)).toBeTrue();
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('clears a charging laser before pending direct destruction commits', () => {
        const entry = bombastLaser(CORE_2026_GAME_RULES, new Map([
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGING_STATE]
        ]));
        entry.setPendingDestroyed(true);

        handler.onEndTurn(entry);

        expect(entry.states.has(BOMBAST_LASER_CHARGE_STATE_KEY)).toBeFalse();
        expect(entry.committedDestroyed()).toBeFalse();
        expect(entry.pendingDestroyed()).toBeTrue();
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('does not register any Bombast interaction under Total Warfare', () => {
        const entry = bombastLaser(TW_GAME_RULES, new Map([
            [INVENTORY_CONTROL_MODE_STATE, BOMBAST_LASER_DAMAGE_16_MODE],
            [BOMBAST_LASER_CHARGE_STATE_KEY, BOMBAST_LASER_CHARGED_STATE]
        ]));
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        const heat = { value: 12, weakened: false };
        const types = new Set<WeaponType>(['DE', 'V']);

        expect(handler.applicableTo(entry)).toBeFalse();
        expect(registry.getHandlers(entry)).toEqual([]);
        expect(registry.getChoices(entry, queryContext)).toEqual([]);
        expect(registry.applyInventoryControlDamageEffects(entry, baseDamage, damageContext, queryContext)).toBe(baseDamage);
        expect(registry.applyInventoryControlHeatEffects(entry, heat, queryContext)).toBe(heat);
        expect(registry.applyWeaponTypes(entry, types, queryContext)).toBe(types);
        expect(registry.getToHitAdjustments(entry, queryContext)).toEqual([]);
        expect(registry.isInventoryControlSelectable(entry, queryContext)).toBeTrue();

        registry.afterInventoryControlFire(entry);
        registry.onEndTurn(entry, jasmine.createSpyObj<ToastService>('ToastService', ['showToast']));
        expect(entry.states.get(BOMBAST_LASER_CHARGE_STATE_KEY)).toBe(BOMBAST_LASER_CHARGED_STATE);
        expect(entry.owner.setInventoryEntry).not.toHaveBeenCalled();
    });

    it('requires weapon equipment in addition to the Bombast flag', () => {
        const misc = new MountedEquipment({
            owner: owner(),
            id: 'misc-bombast',
            name: 'Misc Bombast',
            equipment: new MiscEquipment({
                id: 'misc-bombast',
                name: 'Misc Bombast',
                type: 'misc',
                flags: ['F_BOMBAST_LASER']
            })
        });

        expect(handler.applicableTo(bombastLaser())).toBeTrue();
        expect(handler.applicableTo(bombastLaser(TW_GAME_RULES))).toBeFalse();
        expect(handler.applicableTo(misc)).toBeFalse();
        expect(handler.flags).toEqual(['F_BOMBAST_LASER']);
    });
});
