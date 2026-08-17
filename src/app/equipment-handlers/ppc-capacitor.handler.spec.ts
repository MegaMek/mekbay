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
    const markEquipmentStateChanged = jasmine.createSpy('markEquipmentStateChanged');
    Object.assign(owner, {
        turnState: () => ({ markEquipmentStateChanged }),
    });
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
    return { ...fixture, weapon, capacitor, markEquipmentStateChanged };
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
        expect(registry.applyWeaponTypes(
            discharged.weapon,
            new Set(['DE', 'X'] as const),
            queryContext,
        )).toEqual(new Set(['DE'] as const));

        const unavailable = setup(true);
        unavailable.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        expect(registry.applyWeaponTypes(unavailable.weapon, baseTypes, queryContext)).toBe(baseTypes);
    });

    it('owns delayed explosions for both halves of a charged PPC/capacitor pair', () => {
        const { weapon, capacitor } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        const explosionContext = {
            mountedCriticalSlots: (entry: MountedEquipment) => entry === weapon ? 2 : 1,
            componentCriticalHits: (_entry: MountedEquipment) => 0,
            effectiveMaximumWeaponDamage: (_entry: MountedWeapon) => 10,
        };

        for (const hitEntry of [weapon, capacitor]) {
            expect(handler.getCriticalDelayedExplosion(hitEntry, explosionContext, queryContext))
                .toEqual({
                    explosion: {
                        source: weapon,
                        equipment: 'Light PPC + PPC Capacitor',
                        rawDamage: 6,
                        destroyEntries: [weapon, capacitor],
                    },
                });
        }
    });

    it('owns but suppresses the delayed explosion while the capacitor is discharged or previously damaged', () => {
        const discharged = setup();
        const context = {
            mountedCriticalSlots: (_entry: MountedEquipment) => 1,
            componentCriticalHits: (_entry: MountedEquipment) => 0,
            effectiveMaximumWeaponDamage: (_entry: MountedWeapon) => 10,
        };
        expect(handler.getCriticalDelayedExplosion(discharged.weapon, context, queryContext))
            .toEqual({ explosion: null });

        const damaged = setup();
        damaged.capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        expect(handler.getCriticalDelayedExplosion(damaged.weapon, {
            ...context,
            componentCriticalHits: (entry: MountedEquipment) => entry === damaged.capacitor ? 1 : 0,
        }, queryContext)).toEqual({ explosion: null });
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
        const { weapon, capacitor, markEquipmentStateChanged } = setup();

        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, commandContext);

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGING_STATE);
        expect(handler.isInventoryControlSelectable(weapon, queryContext)).toBeFalse();
        expect(handler.getInventoryHeatSources(weapon, {} as never, queryContext)[0]).toEqual(jasmine.objectContaining({ value: 5 }));
        expect(handler.applyInventoryControlHeatEffects(weapon, { value: 5, weakened: false }, queryContext))
            .toEqual({ value: 5, weakened: false });
        expect(markEquipmentStateChanged).toHaveBeenCalledTimes(1);

        handler.onEndTurn(weapon);

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(handler.isInventoryControlSelectable(weapon, queryContext)).toBeNull();
        expect(markEquipmentStateChanged).toHaveBeenCalledTimes(1);
    });

    it('does not mark rejected, repeated, or discharge transitions as phase changes', () => {
        const { weapon, capacitor, markEquipmentStateChanged } = setup();

        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGING_STATE);
        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, commandContext);
        expect(markEquipmentStateChanged).not.toHaveBeenCalled();

        handler.handleSelection(weapon, { value: 'discharged' } as PickerChoice, commandContext);
        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(markEquipmentStateChanged).not.toHaveBeenCalled();

        capacitor.states.set(PPC_CAPACITOR_FIRED_STATE_KEY, '1');
        handler.handleSelection(weapon, { value: PPC_CAPACITOR_CHARGING_STATE } as PickerChoice, commandContext);
        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(markEquipmentStateChanged).not.toHaveBeenCalled();
    });

    it('discharges and marks the capacitor fired after firing', () => {
        const { weapon, capacitor, inventoryWrites, markEquipmentStateChanged } = setup();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);

        handler.afterInventoryControlFire(weapon);

        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        expect(capacitor.states.get(PPC_CAPACITOR_FIRED_STATE_KEY)).toBe('1');
        expect(inventoryWrites).toEqual([capacitor]);
        expect(markEquipmentStateChanged).not.toHaveBeenCalled();
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
            it(`does not infer an explosion from a manual ${state} ${hitEntry} inventory hit`, () => {
                const { weapon, capacitor } = setup();
                capacitor.states.set(PPC_CAPACITOR_STATE_KEY, state);
                const hit = hitEntry === 'PPC' ? weapon : capacitor;
                const untouched = hitEntry === 'PPC' ? capacitor : weapon;
                hit.setPendingDestroyed(true);

                handler.beforeEquipmentStateCommit(weapon);
                hit.commitPendingDestroyed();

                expect(hit.committedDestroyed()).toBeTrue();
                expect(untouched.committedDestroyed()).toBeFalse();
                expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(state);
            });
        }
    }

    it('does not infer an explosion from a manually edited critical slot', () => {
        const { weapon, capacitor, criticalSlotWrites, weaponSlots, capacitorSlots } = setupWithCriticalSlots();
        capacitor.states.set(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
        weaponSlots[0].hits = 1;
        weaponSlots[0].destroying = 10;

        handler.beforeEquipmentStateCommit(weapon);

        expect(weaponSlots[1].destroying).toBeUndefined();
        expect(capacitorSlots.every(slot => slot.destroying === undefined)).toBeTrue();
        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe(PPC_CAPACITOR_CHARGED_STATE);
        expect(criticalSlotWrites).toEqual([]);
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
