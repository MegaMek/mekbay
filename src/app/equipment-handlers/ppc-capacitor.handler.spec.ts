// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY, EquipmentRegistry } from '../models/equipment-lookup';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { CriticalSlot } from '../models/force-serialization';
import type { DialogsService } from '../services/dialogs.service';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
} from '../services/equipment-interaction-registry.service';
import type { ToastService } from '../services/toast.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { resolveInventoryControlDamageText } from '../utils/inventory-control-damage.util';
import {
    PPC_CAPACITOR_CHARGING_STATE,
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_FIRED_STATE_KEY,
    PPC_CAPACITOR_STATE_KEY,
    PpcCapacitorHandler
} from './ppc-capacitor.handler';

function setup(destroyed = false, compatible = true) {
    const fixture = createTestEquipmentOwner();
    const { owner } = fixture;
    const capacitor = new MountedEquipment({
        owner,
        id: 'capacitor',
        name: 'PPC Capacitor',
        destroyed,
        equipment: new MiscEquipment({
            id: 'PPC Capacitor',
            name: 'PPC Capacitor',
            type: 'misc',
            flags: ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR']
        })
    });
    const weapon = new MountedWeapon({
        owner,
        id: 'ppc',
        name: 'Light PPC',
        equipment: new WeaponEquipment({
            id: 'Light PPC',
            name: 'Light PPC',
            type: 'weapon',
            flags: [
                'F_PPC', 'F_DIRECT_FIRE', 'F_ENERGY',
                ...(compatible ? ['F_PPC_CAPACITOR_COMPATIBLE' as const] : []),
            ],
            weapon: { damage: 5 }
        }),
        linkedWith: [capacitor]
    });
    fixture.inventory.push(weapon, capacitor);
    return { ...fixture, weapon, capacitor };
}

function setupWithCriticalSlots() {
    const fixture = setup();
    const weaponSlots: CriticalSlot[] = [
        { id: 'Light PPC@RA#1', name: 'Light PPC', loc: 'RA', slot: 1 },
        { id: 'Light PPC@RA#2', name: 'Light PPC', loc: 'RA', slot: 2 },
    ];
    const capacitorSlots: CriticalSlot[] = [
        { id: 'PPC Capacitor@RA#3', name: 'PPC Capacitor', loc: 'RA', slot: 3 },
        { id: 'PPC Capacitor@RA#4', name: 'PPC Capacitor', loc: 'RA', slot: 4, armored: true },
    ];
    const unrelatedSlot: CriticalSlot = {
        id: 'Other Light PPC@LA#1',
        name: 'Light PPC',
        loc: 'LA',
        slot: 1,
    };
    const currentSlots = fixture.criticalSlots;
    currentSlots.push(...weaponSlots, ...capacitorSlots, unrelatedSlot);
    fixture.weapon.critSlots = weaponSlots.map(slot => ({ ...slot }));
    fixture.capacitor.critSlots = capacitorSlots.map(slot => ({ ...slot }));
    return { ...fixture, weaponSlots, capacitorSlots, unrelatedSlot };
}

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const toastService = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    toastService,
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);
describe('PpcCapacitorHandler', () => {
    const handler = new PpcCapacitorHandler();

    it('adds five to typed point damage while charged', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        const damage = resolveInventoryControlDamageText(weapon, {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog: new EquipmentRegistry({}),
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, queryContext)
        });

        expect(damage).toBe('10 [DE]');
    });

    it('leaves damage unchanged when discharged or unavailable', () => {
        const discharged = setup();
        expect(resolveInventoryControlDamageText(discharged.weapon, {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog: new EquipmentRegistry({}),
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, queryContext)
        })).toBe('5 [DE]');

        const unavailable = setup(true);
        unavailable.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        expect(resolveInventoryControlDamageText(unavailable.weapon, {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog: new EquipmentRegistry({}),
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, queryContext)
        })).toBe('5 [DE]');
    });

    it('ignores a charged capacitor linked to an incompatible weapon', () => {
        const { weapon, capacitor } = setup(false, false);
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        expect(resolveInventoryControlDamageText(weapon, {
            selectedRange: null,
            selectedAmmo: null,
            equipmentCatalog: new EquipmentRegistry({}),
        }, {
            applyDamageEffects: (entry, value, damageContext) =>
                handler.applyInventoryControlDamageEffects(entry, value, damageContext, queryContext)
        })).toBe('5 [DE]');
    });

    it('adds X to the parent PPC weapon types only while its capacitor is charged and usable', () => {
        const registry = new EquipmentInteractionRegistry();
        registry.register(handler);
        const baseTypes = new Set(['DE'] as const);
        const charged = setup();
        charged.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        expect(Array.from(registry.applyWeaponTypes(charged.weapon, baseTypes, queryContext))).toEqual(['DE', 'X']);
        expect(Array.from(baseTypes)).toEqual(['DE']);

        const discharged = setup();
        expect(registry.applyWeaponTypes(discharged.weapon, baseTypes, queryContext)).toBe(baseTypes);

        const unavailable = setup(true);
        unavailable.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        expect(registry.applyWeaponTypes(unavailable.weapon, baseTypes, queryContext)).toBe(baseTypes);
    });

    it('uses the query context for pure capacitor projections without mutating state or base types', () => {
        const { owner, weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        owner.getEquipmentStatus = () => { throw new Error('owner status must not be queried'); };
        owner.isEquipmentOperational = () => { throw new Error('owner operational state must not be queried'); };
        const context = { ...queryContext, getStatus: () => 'available' as const };
        const baseTypes = new Set(['DE'] as const);
        const weaponStates = new Map(weapon.states);
        const capacitorStates = new Map(capacitor.states);

        const types = handler.applyInventoryControlWeaponTypes(weapon, baseTypes, context);

        expect(Array.from(types)).toEqual(['DE', 'X']);
        expect(Array.from(baseTypes)).toEqual(['DE']);
        expect(weapon.states).toEqual(weaponStates);
        expect(capacitor.states).toEqual(capacitorStates);
    });

    it('adds five firing heat and exposes replaceable passive heat while charged', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        expect(handler.applyInventoryControlHeatEffects(weapon, { value: 5, weakened: false }, queryContext))
            .toEqual({ value: 10, weakened: false });
        expect(handler.getInventoryHeatSources(weapon, {} as never, queryContext)).toEqual([{
            id: 'ppc-capacitor:ppc',
            label: 'PPC Capacitor',
            value: 5,
            replacedByFiringEntryId: 'ppc'
        }]);
    });

    it('charges for one turn, blocks firing, and becomes charged at end turn', () => {
        const { weapon, capacitor } = setup();

        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, commandContext);

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGING_STATE);
        expect(handler.isInventoryControlSelectable(weapon, queryContext)).toBeFalse();
        expect(handler.getInventoryHeatSources(weapon, {} as never, queryContext)[0]).toEqual(jasmine.objectContaining({ value: 5 }));
        expect(handler.applyInventoryControlHeatEffects(weapon, { value: 5, weakened: false }, queryContext))
            .toEqual({ value: 5, weakened: false });

        handler.onEndTurn(weapon);

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(handler.isInventoryControlSelectable(weapon, queryContext)).toBeNull();
    });

    it('discharges and marks the capacitor fired after firing', () => {
        const { weapon, capacitor, inventoryWrites } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        handler.afterInventoryControlFire(weapon);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(capacitor.states.get(PPC_CAPACITOR_FIRED_STATE_KEY)).toBe('1');
        expect(inventoryWrites).toEqual([capacitor]);
    });

    it('discharges an unavailable capacitor after its linked PPC fires', () => {
        const { weapon, capacitor, inventoryWrites } = setup(true);
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        handler.afterInventoryControlFire(weapon);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(capacitor.states.get(PPC_CAPACITOR_FIRED_STATE_KEY)).toBe('1');
        expect(inventoryWrites).toEqual([capacitor]);
    });

    for (const state of [PPC_CAPACITOR_CHARGING_STATE, PPC_CAPACITOR_CHARGED_STATE] as const) {
        for (const hitEntry of ['PPC', 'capacitor'] as const) {
            it(`explodes both direct-inventory mounts when a ${state} ${hitEntry} hit is committed`, () => {
                const { weapon, capacitor } = setup();
                capacitor.states.set(PPC_CAPACITOR_STATE_KEY, state);
                (hitEntry === 'PPC' ? weapon : capacitor).setPendingDestroyed(true);

                expect(weapon.committedDestroyed()).toBeFalse();
                expect(capacitor.committedDestroyed()).toBeFalse();

                handler.beforeEquipmentStateCommit(weapon);
                weapon.commitPendingDestroyed();
                capacitor.commitPendingDestroyed();

                expect(weapon.committedDestroyed()).toBeTrue();
                expect(capacitor.committedDestroyed()).toBeTrue();
                expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
            });
        }
    }

    it('does not explode direct-inventory mounts before a charged hit is pending', () => {
        const { weapon, capacitor, inventoryWrites } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        handler.beforeEquipmentStateCommit(weapon);

        expect(weapon.hasPendingDestroyedChange()).toBeFalse();
        expect(capacitor.hasPendingDestroyedChange()).toBeFalse();
        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(inventoryWrites).toEqual([]);
    });

    it('commits an ordinary direct-inventory hit while the capacitor is discharged', () => {
        const { weapon, capacitor } = setup();
        weapon.setPendingDestroyed(true);

        handler.beforeEquipmentStateCommit(weapon);
        weapon.commitPendingDestroyed();
        capacitor.commitPendingDestroyed();

        expect(weapon.committedDestroyed()).toBeTrue();
        expect(capacitor.committedDestroyed()).toBeFalse();
        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
    });

    for (const state of [PPC_CAPACITOR_CHARGING_STATE, PPC_CAPACITOR_CHARGED_STATE] as const) {
        for (const hitEntry of ['PPC', 'capacitor'] as const) {
            it(`destroys every linked Mek critical slot when a ${state} ${hitEntry} slot hit is committed`, () => {
                const { weapon, capacitor, criticalSlotWrites, weaponSlots, capacitorSlots, unrelatedSlot } = setupWithCriticalSlots();
                capacitor.states.set(PPC_CAPACITOR_STATE_KEY, state);
                const hitSlots = hitEntry === 'PPC' ? weaponSlots : capacitorSlots;
                hitSlots[0].hits = 1;
                hitSlots[0].destroying = 10;

                handler.beforeEquipmentStateCommit(weapon);

                const explosionSlots = [...weaponSlots, ...capacitorSlots];
                expect(explosionSlots.every(slot => !!slot.destroying)).toBeTrue();
                expect(new Set(explosionSlots.map(slot => slot.destroying)).size).toBe(1);
                expect(capacitorSlots[1].hits).toBe(2);
                expect(unrelatedSlot.destroying).toBeUndefined();
                expect(weapon.hasPendingDestroyedChange()).toBeFalse();
                expect(capacitor.hasPendingDestroyedChange()).toBeFalse();
                expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
                expect(criticalSlotWrites.length).toBe(1);
            });
        }
    }

    it('does not retrigger an explosion for an already committed critical hit', () => {
        const committed = setupWithCriticalSlots();
        committed.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        committed.weaponSlots[0].hits = 1;
        committed.weaponSlots[0].destroying = 10;
        committed.weaponSlots[0].destroyed = 10;

        handler.beforeEquipmentStateCommit(committed.weapon);

        expect(committed.weaponSlots[1].destroying).toBeUndefined();
        expect(committed.capacitorSlots.every(slot => slot.destroying === undefined)).toBeTrue();
        expect(committed.criticalSlotWrites).toEqual([]);
    });

    it('does not treat location-derived critical destruction as a PPC critical hit', () => {
        const { weapon, capacitor, criticalSlotWrites, weaponSlots, capacitorSlots } = setupWithCriticalSlots();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        weaponSlots[0].destroying = 10;

        handler.beforeEquipmentStateCommit(weapon);

        expect(weaponSlots[0].destroying).toBe(10);
        expect(weaponSlots[1].destroying).toBeUndefined();
        expect(capacitorSlots.every(slot => slot.destroying === undefined)).toBeTrue();
        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(criticalSlotWrites).toEqual([]);

        handler.onEndTurn(weapon);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
    });

    it('does not explode a later PPC hit from a stale charge on an already destroyed capacitor', () => {
        const { weapon, capacitor } = setup();
        capacitor.setCommittedDestroyed(true);
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        weapon.setPendingDestroyed(true);

        handler.beforeEquipmentStateCommit(weapon);
        weapon.commitPendingDestroyed();

        expect(weapon.committedDestroyed()).toBeTrue();
        expect(capacitor.hasPendingDestroyedChange()).toBeFalse();
        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
    });

    it('still explodes a charged disabled pair that is not destroyed', () => {
        const { owner, weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        owner.getEquipmentStatus = () => 'disabled';
        weapon.setPendingDestroyed(true);

        handler.beforeEquipmentStateCommit(weapon);
        weapon.commitPendingDestroyed();
        capacitor.commitPendingDestroyed();

        expect(weapon.committedDestroyed()).toBeTrue();
        expect(capacitor.committedDestroyed()).toBeTrue();
        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
    });

    it('explodes a charging capacitor when its hit is committed at end turn', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGING_STATE);
        weapon.setPendingDestroyed(true);

        handler.beforeEquipmentStateCommit(weapon);
        handler.onEndTurn(weapon);
        weapon.commitPendingDestroyed();
        capacitor.commitPendingDestroyed();

        expect(weapon.committedDestroyed()).toBeTrue();
        expect(capacitor.committedDestroyed()).toBeTrue();
        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
    });

    it('does not let an unavailable charging capacitor block its usable PPC', () => {
        const { weapon, capacitor, inventoryWrites } = setup(true);
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGING_STATE);

        expect(handler.isInventoryControlSelectable(weapon, queryContext)).toBeNull();

        handler.onEndTurn(weapon);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(inventoryWrites).toEqual([capacitor]);
    });

    it('rejects charging after the linked PPC fired this turn', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_FIRED_STATE_KEY, '1');

        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, commandContext);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(toastService.showToast).toHaveBeenCalledWith(
            'A fired PPC cannot charge its capacitor this turn.',
            'error'
        );
    });
});
