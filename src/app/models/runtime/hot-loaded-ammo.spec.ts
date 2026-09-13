// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { ComponentId } from '../entity/entity-identifiers';
import { TestTankEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { addTestEquipment } from '../entity/testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { cloneMekForOwner } from './cbt-mek-unit';
import { cloneNonMekForOwner, createNonMekUnit } from './cbt-non-mek-unit';
import type { CBTMekUnit } from './cbt-unit';
import { projectMekEquipmentPanel } from './equipment-panel';
import { projectNonMekEquipmentPanel } from './non-mek-equipment-panel';
import { applyMekWeaponFirePlanV2, planMekWeaponFireV2 } from './mek-weapon-fire-v2';
import { componentIdForMount } from './unit-runtime-index';
import { createDirectHotLoadedAmmoRuntimeFixture, emptyCBTEncounterSnapshot } from './testing/direct-mek-runtime-fixture';

const scenario = (enabled: boolean) => ({ id: 'megamek', options: { hotLoadedAmmo: enabled } });

function fixture(enabled = true, ruleset: 'core-2026' | 'total-warfare' = 'total-warfare') {
    const fixture = createDirectHotLoadedAmmoRuntimeFixture(enabled, ruleset);
    const bins = [...fixture.index.components.values()].filter(component =>
        component.mount?.equipmentId === 'Test Artemis Ammo').map(component => component.id);
    const launcher = fixture.equipmentComponent('Test Artemis Launcher').id;
    const configure = (bin: ComponentId, remaining: number, hotLoaded?: boolean) => fixture.instance.dispatch({
        type: 'configure-ammo-source', componentId: bin, munitionKey: 'Test Artemis Ammo', remaining, hotLoaded,
    });
    const slot = [...fixture.index.slots.values()].find(slot => slot.componentIds.includes(launcher))!;
    const dice = slot.slotIndex < 6 ? [1, slot.slotIndex + 1] : [4, slot.slotIndex - 5];
    return { ...fixture, bins, launcher, configure, slot, dice };
}

function weapon(unit: CBTMekUnit, id: ComponentId) {
    return projectMekEquipmentPanel(unit.getUnit(), unit.getIndex(), unit.ruleset(), unit.query(), emptyCBTEncounterSnapshot())
        .components.find(row => row.componentId === id)!.weapon!;
}

describe('hot-loaded ammo', () => {
    it('requires the optional rule and eligible ammunition', () => {
        const disabled = fixture(false);
        expect(disabled.configure(disabled.bins[0], 12, true).changed).toBeFalse();
        const enabled = fixture();
        const acAmmo = enabled.equipmentComponent('Test Ammo').id;
        expect(enabled.instance.dispatch({ type: 'configure-ammo-source', componentId: acAmmo,
            munitionKey: 'Test Ammo', remaining: 1, hotLoaded: true }).changed).toBeFalse();
        expect(enabled.configure(enabled.bins[0], 12, true).changed).toBeTrue();
        expect(enabled.instance.query().ammoHotLoaded(enabled.bins[1])).toBeFalse();
    });

    it('uses the selected bin for minimum range and any carried compatible hot-loaded rounds for X', () => {
        const f = fixture();
        f.configure(f.bins[1], 2, true);
        const select = (id: ComponentId) => f.instance.installAttackerTargetingSessionState({
            ...f.instance.query().attackerTargetingState(),
            components: new Map([[f.launcher, { ammo: { munitionKey: 'Test Artemis Ammo', preferredSourceId: id } }]]),
        });
        select(f.bins[0]);
        expect(weapon(f.instance, f.launcher).minimumRange).toBe(6);
        expect(weapon(f.instance, f.launcher).effectiveWeaponTypes).toContain('X');
        select(f.bins[1]);
        expect(weapon(f.instance, f.launcher).minimumRange).toBe(0);
        expect(weapon(f.instance, f.equipmentComponent('Test AC').id).effectiveWeaponTypes).not.toContain('X');
        f.configure(f.bins[1], 0);
        expect(weapon(f.instance, f.launcher).minimumRange).toBe(6);
        expect(weapon(f.instance, f.launcher).effectiveWeaponTypes).not.toContain('X');
    });

    it('preserves hot-loading through firing and loses its effects when the last round is spent', () => {
        const f = fixture();
        f.configure(f.bins[0], 1, true);
        const plan = planMekWeaponFireV2(f.entity, f.index, f.instance.ruleset(), f.instance.query(), [
            { weaponId: f.launcher, ammoSourceId: f.bins[0], expectedMunitionKey: 'Test Artemis Ammo' },
        ]);
        expect(plan.accepted).toBeTrue();
        if (!plan.accepted) return;
        const fired = applyMekWeaponFirePlanV2(f.instance.snapshot(), plan.plan);
        expect(fired.ammo.get(f.bins[0])?.hotLoaded).toBeTrue();
        expect(fired.ammo.get(f.bins[0])?.shotsSpent).toBe(12);
        f.instance.dispatch({ type: 'spend-ammo', componentId: f.bins[0], amount: 1 });
        expect(weapon(f.instance, f.launcher).effectiveWeaponTypes).not.toContain('X');
    });

    it('round-trips a full hot-loaded bin and gates its effects when optional rules change', async () => {
        const f = fixture();
        f.configure(f.bins[0], 12, true);
        const restored = await cloneMekForOwner(f.instance, { ...scenario(true), ruleset: 'total-warfare' });
        expect(restored.snapshot().ammo.get(f.bins[0])).toEqual({ shotsSpent: 0, hotLoaded: true });
        expect(weapon(restored, f.launcher).effectiveWeaponTypes).toContain('X');
        const disabled = await cloneMekForOwner(restored, { ...scenario(false), ruleset: 'total-warfare' });
        expect(disabled.snapshot().ammo.get(f.bins[0])?.hotLoaded).toBeTrue();
        expect(weapon(disabled, f.launcher).effectiveWeaponTypes).not.toContain('X');
        expect(weapon(disabled, f.launcher).minimumRange).toBe(6);
        const enabled = await cloneMekForOwner(disabled, { ...scenario(true), ruleset: 'total-warfare' });
        expect(weapon(enabled, f.launcher).minimumRange).toBe(0);
        enabled.dispatch({ type: 'reset-ammo-loadout' });
        expect(enabled.snapshot().ammo.size).toBe(0);
    });

    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        it(`explodes a hot-loaded launcher for a full missile flight under ${ruleset}`, () => {
            const f = fixture(true, ruleset);
            f.configure(f.bins[0], 1, true);
            const plan = f.instance.query().mekCriticalRoll(f.slot.locationId, f.dice, 'pending');
            expect(plan.kind).toBe('applied');
            if (plan.kind !== 'applied') return;
            expect(plan.pendingExplosion).toBeUndefined();
            expect(plan.explosion?.rawDamage).toBe(10);
            expect(plan.explosion?.destroyComponentIds).toContain(f.launcher);
            expect(plan.hotLoadAmmoIds).toEqual(f.bins);
            const chain = f.instance.query().mekCriticalRoll(f.slot.locationId, f.dice, 'pending', {
                dice: [2, 3], ammoComponentId: f.bins[1],
            });
            expect(chain.kind).toBe('applied');
            if (chain.kind !== 'applied') return;
            expect(chain.explosion?.rawDamage).toBe(130);
            expect(chain.explosion?.destroyComponentIds).toEqual([f.launcher, f.bins[1]]);
            const safe = f.instance.query().mekCriticalRoll(f.slot.locationId, f.dice, 'committed', { dice: [3, 3] });
            if (safe.kind === 'applied') expect(safe.explosion?.rawDamage).toBe(10);
            expect(f.instance.dispatch({ type: 'apply-mek-critical-roll', locationId: f.slot.locationId,
                results: f.dice, target: 'committed', hotLoadExplosion: { dice: [3, 3] } }).changed).toBeTrue();
            expect(f.instance.query().componentStatus(f.launcher)).toBe('destroyed');
        });
    }

    it('does not explode a launcher once its hot-loaded bin is empty or destroyed', () => {
        const f = fixture();
        f.configure(f.bins[0], 0, true);
        const empty = f.instance.query().mekCriticalRoll(f.slot.locationId, f.dice, 'committed');
        if (empty.kind === 'applied') expect(empty.explosion).toBeUndefined();
        f.configure(f.bins[0], 2);
        f.instance.dispatch({ type: 'set-component-status', componentId: f.bins[0], status: 'destroyed', target: 'committed' });
        const destroyed = f.instance.query().mekCriticalRoll(f.slot.locationId, f.dice, 'committed');
        if (destroyed.kind === 'applied') expect(destroyed.explosion).toBeUndefined();
        expect(weapon(f.instance, f.launcher).effectiveWeaponTypes).not.toContain('X');
    });

    it('preserves vehicle bin state and applies its range and weapon-type effects', () => {
        const ammo = new AmmoEquipment({ id: 'LRMAmmo', name: 'LRM Ammo', type: 'ammo', flags: ['F_HOT_LOAD'],
            ammo: { type: 'LRM', rackSize: 10, shots: 12, damagePerShot: 1 } });
        const highDamageAmmo = new AmmoEquipment({ id: 'LRMHighDamageAmmo', name: 'High Damage Ammo', type: 'ammo', flags: ['F_HOT_LOAD'],
            ammo: { type: 'LRM', rackSize: 10, shots: 12, damagePerShot: 2 } });
        const launcher = new WeaponEquipment({ id: 'LRM10', name: 'LRM 10', type: 'weapon', flags: ['F_MISSILE'],
            weapon: { ammoType: 'LRM', rackSize: 10, minRange: 6, ranges: [7, 14, 21, 28] } });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [ammo.id]: ammo, [launcher.id]: launcher,
            [highDamageAmmo.id]: highDamageAmmo }));
        entity.setTonnage(200);
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        entity.uuid.set(uuid);
        const weaponId = componentIdForMount(addTestEquipment(entity, launcher, { location: entity.locationOrder[0] }));
        const ammoId = componentIdForMount(addTestEquipment(entity, ammo, { shotsCount: 12 }));
        const highDamageAmmoId = componentIdForMount(addTestEquipment(entity, highDamageAmmo, { shotsCount: 12 }));
        const unit = createNonMekUnit(entity, { instanceId: 'vehicle-hot-load', uuid,
            scenario: scenario(true), deployment: { id: 'default' }, initialStateProfileId: 'pristine' });
        expect(unit.dispatch({ type: 'configure-ammo-source', componentId: ammoId,
            munitionKey: ammo.id, remaining: 12, hotLoaded: true }).changed).toBeTrue();
        const restored = cloneNonMekForOwner(unit, scenario(true));
        const panel = projectNonMekEquipmentPanel(entity, restored.getIndex(), restored.ruleset(), restored.snapshot(),
            restored.getCrewAssignment(), emptyCBTEncounterSnapshot(), true, restored.mechanics().hotLoadedAmmo);
        expect(restored.query().ammoHotLoaded(ammoId)).toBeTrue();
        expect(panel.components.find(row => row.componentId === weaponId)?.weapon?.minimumRange).toBe(0);
        expect(panel.components.find(row => row.componentId === weaponId)?.weapon?.effectiveWeaponTypes).toContain('X');
        expect(panel.components.find(row => row.componentId === ammoId)?.ammo?.hotLoaded).toBeTrue();
        restored.dispatch({ type: 'set-component-status', componentId: ammoId,
            status: 'disabled', target: 'committed' });
        const disabledBinPanel = projectNonMekEquipmentPanel(entity, restored.getIndex(), restored.ruleset(), restored.snapshot(),
            restored.getCrewAssignment(), emptyCBTEncounterSnapshot(), true, restored.mechanics().hotLoadedAmmo);
        expect(disabledBinPanel.components.find(row => row.componentId === weaponId)?.weapon?.effectiveWeaponTypes).toContain('X');
        const disabled = cloneNonMekForOwner(restored, scenario(false));
        expect(disabled.query().ammoHotLoaded(ammoId)).toBeFalse();
        const locationId = [...restored.getIndex().locations.values()]
            .find(location => location.code === entity.locationOrder[0])!.id;
        const destroy = { type: 'set-component-status', componentId: weaponId,
            status: 'destroyed', target: 'pending' } as const;
        expect(restored.dispatch(destroy).changed).toBeTrue();
        expect(restored.query().remainingInternal(locationId, 'committed')).toBe(20);
        expect(restored.query().remainingInternal(locationId, 'preview')).toBe(10);
        expect(restored.query().remainingAmmo(ammoId)).toBe(12);
        restored.dispatch(destroy);
        expect(restored.query().remainingInternal(locationId, 'preview')).toBe(10);
        disabled.dispatch(destroy);
        expect(disabled.query().remainingInternal(locationId, 'preview')).toBe(20);
        unit.dispatch({ type: 'configure-ammo-source', componentId: highDamageAmmoId,
            munitionKey: highDamageAmmo.id, remaining: 1, hotLoaded: true });
        unit.dispatch(destroy);
        expect(unit.query().remainingInternal(locationId, 'preview')).withContext('maximum flight damage across hot-loaded munitions').toBe(0);
    });
});
