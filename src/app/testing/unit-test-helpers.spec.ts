// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EquipmentAction } from '../models/cbt-force-unit.model';
import { WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { type CriticalSlot } from '../models/force-serialization';
import { CORE_2026_GAME_RULES } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from '../models/rules/unit-type-rules';
import { createCBTForceUnitTestHarness, createTestEquipmentOwner } from './unit-test-helpers';

describe('createTestEquipmentOwner', () => {
    it('derives operational state and action permission from one canonical status', () => {
        const fixture = createTestEquipmentOwner();
        const mounted = new MountedEquipment({
            owner: fixture.owner,
            id: 'disabled-laser',
            name: 'Disabled Laser',
            states: new Map([[ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE]]),
        });

        expect(fixture.owner.getEquipmentStatus(mounted)).toBe('disabled');
        expect(fixture.owner.isEquipmentOperational(mounted)).toBeFalse();
        expect(fixture.owner.canPerformEquipmentAction(mounted, 'fire')).toBeFalse();
        expect(fixture.owner.canEditEquipmentState(mounted, 'enable')).toBeTrue();
        expect(fixture.owner.canEditEquipmentState(mounted, 'disable')).toBeFalse();
    });

    it('persists inventory and critical-slot writes through production-shaped methods', () => {
        const fixture = createTestEquipmentOwner();
        const mounted = new MountedEquipment({
            owner: fixture.owner,
            id: 'laser',
            name: 'Laser',
        });
        const slot: CriticalSlot = { id: 'Laser@RA#1', loc: 'RA', slot: 1 };

        fixture.owner.setInventoryEntry(mounted);
        fixture.owner.setCritSlots([slot]);

        expect(fixture.owner.getInventory()).toEqual([mounted]);
        expect(fixture.inventoryWrites).toEqual([mounted]);
        expect(fixture.owner.getCritSlots()).toEqual([slot]);
        expect(fixture.criticalSlotWrites).toEqual([[slot]]);
    });
});

describe('CBTForceUnitTestHarness', () => {
    it('adds mounted components and registers their equipment', () => {
        const harness = createCBTForceUnitTestHarness();
        const weapon = new WeaponEquipment({ id: 'TestLaser', name: 'Test Laser', type: 'weapon' });

        const mounted = harness.addComponent({ id: 'laser', name: 'Test Laser', equipment: weapon });

        expect(mounted).toBeInstanceOf(MountedEquipment);
        expect(mounted.owner).toBe(harness.unit);
        expect(harness.unit.getInventory()).toEqual([mounted]);
        expect(harness.unit.getEquipmentRegistry().findEquipment(weapon.internalName)).toBe(weapon);
    });

    it('does not expose dissipation when the unit does not track heat', () => {
        const harness = createCBTForceUnitTestHarness({ tracksHeat: false, heatDissipation: 10 });

        expect(harness.unit.rules.heatDissipation()).toBeNull();
        expect(harness.turnState.heatDissipationBalance()).toBe(0);
        expect(harness.turnState.effectiveHeatDissipation()).toBe(0);
    });

    it('preserves switched-off heat sinks and tracks fired heat', () => {
        const harness = createCBTForceUnitTestHarness({
            heat: { heatsinksOff: 3 },
            heatDissipation: 10
        });

        harness.turnState.addFiredHeat(4);
        harness.turnState.addFiredHeat(-1);

        expect(harness.unit.rules.heatDissipation()?.heatsinksOff).toBe(3);
        expect(harness.turnState.heatSources()).toContain(jasmine.objectContaining({ id: 'weapons', value: 4 }));
    });

    it('adds critical slots and exposes inventory-control runtime state', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({ id: 'laser', name: 'Test Laser' });
        const slot = harness.addCriticalSlot({ id: 'slot', loc: 'RA', slot: 0 } as CriticalSlot);

        harness.unit.setInventoryControlEntrySelected(mounted, true);

        expect(harness.unit.getCritSlots()).toEqual([slot]);
        expect(harness.unit.isInventoryControlEntrySelected(mounted.id)).toBeTrue();
    });

    it('resolves direct critical status from the current slot identity without aggregating the mount', () => {
        const harness = createCBTForceUnitTestHarness();
        const equipment = new WeaponEquipment({ id: 'TestLaser', name: 'Test Laser', type: 'weapon' });
        const snapshot: CriticalSlot = { id: 'TestLaser@RA#0', loc: 'RA', slot: 0, eq: equipment };
        const mounted = harness.addComponent({
            id: 'laser',
            name: equipment.name,
            equipment,
            critSlots: [snapshot],
        });

        harness.addCriticalSlot({ ...snapshot, destroyed: 1 });

        expect(harness.unit.getEquipmentStatus(snapshot)).toBe('destroyed');
        expect(harness.unit.getEquipmentStatus(mounted)).toBe('available');

        harness.addCriticalSlot({ ...snapshot, destroyed: undefined });

        expect(harness.unit.getEquipmentStatus(snapshot)).toBe('available');
        expect(harness.unit.getEquipmentStatus(mounted)).toBe('available');
    });

    it('does not invent subtype-specific mounted critical aggregation', () => {
        const harness = createCBTForceUnitTestHarness();
        const autocannon = new WeaponEquipment({
            id: 'ISAC5',
            name: 'AC/5',
            type: 'weapon',
            flags: ['F_AC'],
        });
        const first: CriticalSlot = { id: 'ISAC5@RA#0', loc: 'RA', slot: 0, eq: autocannon };
        const second: CriticalSlot = { id: 'ISAC5@RA#1', loc: 'RA', slot: 1, eq: autocannon };
        const mounted = harness.addComponent({
            id: 'ac5',
            name: autocannon.name,
            equipment: autocannon,
            critSlots: [first, second],
        });

        const firstCritical = harness.addCriticalSlot({ ...first, destroyed: 1 });
        harness.addCriticalSlot(second);

        expect(harness.unit.getEquipmentStatus(firstCritical)).toBe('destroyed');
        expect(harness.unit.getEquipmentStatus(mounted)).toBe('available');
        expect(harness.unit.getEquipmentStatusAtLocation(mounted, 'RA')).toBe('available');
    });

    it('provides production-default game rules and equipment disabled state', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({
            id: 'disabled-laser',
            name: 'Disabled Laser',
            states: new Map([[ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE]])
        });

        expect(harness.unit.gameRules).toBe(CORE_2026_GAME_RULES);
        expect(harness.unit.getEquipmentStatus(mounted)).toBe('disabled');
    });

    it('configures equipment status and to-hit modifiers independently', () => {
        const harness = createCBTForceUnitTestHarness();
        const disabled = harness.addComponent({ id: 'disabled-laser', name: 'Disabled Laser' });
        const modified = harness.addComponent({ id: 'modified-laser', name: 'Modified Laser' });
        const modifiers = [{ label: 'Damaged Fire Control', modifier: 2, weakened: true }];

        harness
            .setEquipmentStatus(disabled, 'disabled')
            .setEquipmentToHitModifiers(modified, modifiers);

        expect(harness.unit.getEquipmentStatus(disabled)).toBe('disabled');
        expect(harness.unit.rules.getEquipmentToHitModifiers(disabled)).toEqual([]);
        expect(harness.unit.getEquipmentStatus(modified)).toBe('available');
        expect(harness.unit.rules.getEquipmentToHitModifiers(modified)).toBe(modifiers);
    });

    it('keeps whole-source and location-scoped status resolvers distinct', () => {
        const harness = createCBTForceUnitTestHarness({
            resolveEquipmentStatus: () => 'disabled',
            resolveEquipmentStatusAtLocation: (_entry, location) => location === 'RA' ? 'destroyed' : 'available',
        });
        const mounted = harness.addComponent({ id: 'laser', name: 'Laser' });

        expect(harness.unit.getEquipmentStatus(mounted)).toBe('disabled');
        expect(harness.unit.isEquipmentOperational(mounted)).toBeFalse();
        expect(harness.unit.getEquipmentStatusAtLocation(mounted, 'RA')).toBe('destroyed');
        expect(harness.unit.isEquipmentOperationalAtLocation(mounted, 'RA')).toBeFalse();
        expect(harness.unit.canPerformEquipmentAction(mounted, 'fire')).toBeFalse();
    });

    it('routes equipment actions through an action-aware permission resolver', () => {
        const resolveEquipmentActionPermission = jasmine.createSpy('resolveEquipmentActionPermission')
            .and.callFake((_entry: MountedEquipment, action: EquipmentAction) => action === 'activate');
        const harness = createCBTForceUnitTestHarness({ resolveEquipmentActionPermission });
        const mounted = harness.addComponent({ id: 'active-probe', name: 'Active Probe' });

        expect(harness.unit.canPerformEquipmentAction(mounted, 'activate')).toBeTrue();
        expect(harness.unit.canPerformEquipmentAction(mounted, 'fire')).toBeFalse();
        expect(harness.unit.canPerformEquipmentAction(mounted, 'change-mode')).toBeFalse();
        expect(resolveEquipmentActionPermission.calls.allArgs().map(([, action]) => action)).toEqual([
            'activate',
            'fire',
            'change-mode',
        ]);

        const defaultHarness = createCBTForceUnitTestHarness();
        const defaultMounted = defaultHarness.addComponent({ id: 'default-probe', name: 'Default Probe' });
        expect(defaultHarness.unit.canPerformEquipmentAction(defaultMounted, 'activate')).toBeTrue();
        expect(defaultHarness.unit.canPerformEquipmentAction(defaultMounted, 'configure-network')).toBeFalse();
    });

    it('applies unit availability gates before subtype action permission', () => {
        const resolveEquipmentActionPermission = jasmine.createSpy('resolveEquipmentActionPermission')
            .and.returnValue(true);
        const destroyedHarness = createCBTForceUnitTestHarness({
            destroyed: true,
            resolveEquipmentActionPermission,
        });
        const mounted = destroyedHarness.addComponent({ id: 'laser', name: 'Laser' });

        expect(destroyedHarness.unit.canPerformEquipmentAction(mounted, 'fire')).toBeFalse();
        expect(resolveEquipmentActionPermission).not.toHaveBeenCalled();
    });

    it('does not require an explicitly operational C3 component before configuring its network', () => {
        const resolveConfigureNetworkPermission = jasmine.createSpy('resolveConfigureNetworkPermission')
            .and.returnValue(true);
        const harness = createCBTForceUnitTestHarness({ resolveConfigureNetworkPermission });
        const mounted = harness.addComponent({ id: 'c3-master', name: 'C3 Master' });

        expect(harness.unit.canPerformEquipmentAction(mounted, 'configure-network')).toBeTrue();
        expect(resolveConfigureNetworkPermission).toHaveBeenCalledOnceWith(mounted);

        harness.setEquipmentStatus(mounted, 'destroyed');

        expect(harness.unit.canPerformEquipmentAction(mounted, 'configure-network')).toBeTrue();
        expect(resolveConfigureNetworkPermission).toHaveBeenCalledTimes(2);
    });

    it('resolves lifecycle state through canonical unit helpers', () => {
        const harness = createCBTForceUnitTestHarness({
            resolveEquipmentStatus: () => 'destroyed',
        });
        const mounted = harness.addComponent({ id: 'laser', name: 'Laser' });

        expect(harness.unit.isEquipmentResolvedDestroyed(mounted)).toBeTrue();
        expect(harness.unit.isEquipmentResolvedCommittedDestroyed(mounted)).toBeTrue();

        mounted.setCommittedDestroyed(true);
        mounted.setPendingDestroyed(false);

        expect(harness.unit.isEquipmentResolvedDestroyed(mounted)).toBeFalse();
        expect(harness.unit.isEquipmentResolvedCommittedDestroyed(mounted)).toBeFalse();
    });

    it('blocks repair when the equipment installation location is destroyed', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({
            id: 'laser',
            name: 'Laser',
            locations: new Set(['RA']),
            destroyed: true,
        });
        harness.setEquipmentStatusAtLocation(mounted, 'RA', 'destroyed');
        mounted.setCommittedDestroyed(true);
        mounted.setPendingDestroyed(false);

        expect(harness.unit.getEquipmentInstallationLocationStatus(mounted)).toBe('destroyed');
        expect(harness.unit.isEquipmentResolvedDestroyed(mounted)).toBeTrue();
        expect(harness.unit.isEquipmentResolvedCommittedDestroyed(mounted)).toBeTrue();
        expect(harness.unit.canEditEquipmentState(mounted, 'repair')).toBeFalse();
    });

    it('keeps a destroyed mount in a healthy installation location repairable', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({
            id: 'laser',
            name: 'Laser',
            destroyed: true,
            locations: new Set(['RA']),
        });

        expect(harness.unit.getEquipmentStatus(mounted)).toBe('destroyed');
        expect(harness.unit.getEquipmentStatusAtLocation(mounted, 'RA')).toBe('destroyed');
        expect(harness.unit.getEquipmentInstallationLocationStatus(mounted)).toBe('available');
        expect(harness.unit.canEditEquipmentState(mounted, 'repair')).toBeTrue();
    });

    it('exposes status/profile-aware effective weapon types through the unit facade', () => {
        const harness = createCBTForceUnitTestHarness();
        const weapon = new WeaponEquipment({ id: 'TestLaser', name: 'Test Laser', type: 'weapon' });
        const mounted = harness.addComponent({ id: 'laser', name: weapon.name, equipment: weapon }) as MountedWeapon;
        harness.setInventoryControlRules({
            applyWeaponTypes: (_entry, types) => new Set([...types, 'X' as const]),
        });

        expect(harness.unit.getEffectiveWeaponTypes(mounted).has('X')).toBeTrue();
    });

    it('exposes equipment-aware physical damage through the unit facade', () => {
        const harness = createCBTForceUnitTestHarness();
        const mounted = harness.addComponent({ id: 'claw', name: 'Claw' });
        harness.setInventoryControlRules({
            applyPhysicalDamageEffects: (_entry, effect) => ({
                ...effect,
                baseDamage: effect.baseDamage + 2,
            }),
        });

        expect(harness.unit.getEffectivePhysicalDamageEffect(mounted, {
            baseDamage: 5,
            ignoreMyomer: false,
        })).toEqual({
            baseDamage: 7,
            ignoreMyomer: false,
        });
    });

    it('reports no active conditions by default', () => {
        const harness = createCBTForceUnitTestHarness();

        expect(harness.unit.getCondition('jammed')).toBeFalse();
        expect(harness.unit.getConditions().has('jammed')).toBeFalse();
    });

    it('reports configured active conditions', () => {
        const harness = createCBTForceUnitTestHarness({ conditions: ['jammed'] });

        expect(harness.unit.getCondition('jammed')).toBeTrue();
        expect(harness.unit.getCondition('shutdown')).toBeFalse();
        expect(harness.unit.getConditions().has('jammed')).toBeTrue();
    });
});
