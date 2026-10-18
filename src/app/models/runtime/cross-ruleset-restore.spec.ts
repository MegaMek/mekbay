// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { BOMBAST_LASER_DAMAGE_12_MODE,BOMBAST_LASER_DAMAGE_16_MODE,BOMBAST_LASER_DAMAGE_7_MODE } from '../bombast-laser-mode.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { asComponentId,type ComponentId } from '../entity/entity-identifiers';
import { TestBipedMekEntity,TestTankEntity } from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { addTestEquipment,addTestEquipmentWithFlags } from '../entity/testing/test-mounted-equipment';
import { EntityMountedEquipment } from '../entity/types';
import { AmmoEquipment,WeaponEquipment } from '../equipment.model';
import { FLAMER_HEAT_MODE } from '../flamer-mode.model';
import { createMekUnit,restoreMekUnit } from './cbt-mek-unit';
import { createNonMekUnit,restoreNonMekUnit } from './cbt-non-mek-unit';
import type { CBTMekUnit,CBTNonMekUnit } from './cbt-unit';
import { BOMBAST_LASER_CHARGING_STATE } from './component-bombast-laser';
import { SHIELD_ACTIVE_MODE,SHIELD_PASSIVE_MODE } from './component-shield-mode';
import { projectMekEquipmentPanel } from './equipment-panel';
import type { V2StateRestoreWarning } from './runtime-state-codec-v2';
import {
createDirectBombastRuntimeFixture,
createDirectDualShieldRuntimeFixture,
createDirectEscalatingFailureRuntimeFixture,
createDirectFlamerRuntimeFixture,
createDirectMekRuntimeFixture,
createDirectShieldRuntimeFixture,
emptyCBTEncounterSnapshot,
type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

/**
 * No ruleset is persisted: a saved unit is always restored under the rules in force when it loads, which is
 * how a rules switch reaches every loaded unit. Rule-specific facts must be reread or dropped, never kept stale.
 */
describe('restoring saved units under the other ruleset', () => {
    describe('Mek', () => {
        it('drops a TW Ultra AC jam under Core, where only Rotary ACs jam (TW p.114; Core p.183)', async () => {
            const fixture = createDirectMekRuntimeFixture('total-warfare');
            const ac = fixture.equipmentComponent('Test AC');
            expect(fixture.instance.dispatch({ type: 'set-component-jammed', componentId: ac.id, jammed: true }).changed)
                .toBeTrue();

            const tw = await restoreMek(fixture, fixture.instance, 'total-warfare');
            expect(tw.unit.query().componentJammed(ac.id)).toBeTrue();
            expect(tw.warnings).toEqual([]);

            const core = await restoreMek(fixture, fixture.instance, 'core-2026');
            expect(core.unit.query().componentJammed(ac.id)).toBeFalse();
            expect(core.unit.snapshot().components.get(ac.id)?.jammed).toBeUndefined();
            expect(core.warnings.map(warning => warning.code)).toEqual(['STATE_SKIPPED']);
        });

        it('rereads a one-slot autocannon hit under the bound ruleset (Core p.183: the first hit does not disable it)', async () => {
            for (const [from, to, status] of [
                ['core-2026', 'total-warfare', 'destroyed'],
                ['total-warfare', 'core-2026', 'available'],
            ] as const) {
                const fixture = createDirectMekRuntimeFixture(from);
                const ac = fixture.equipmentComponent('Test AC');
                const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.includes(ac.id))!;
                expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' })
                    .accepted).toBeTrue();

                const restored = await restoreMek(fixture, fixture.instance, to);
                expect(restored.unit.query().criticalHits(slot.id)).withContext(`${from} -> ${to}`).toBe(1);
                expect(restored.unit.query().componentStatus(ac.id)).withContext(`${from} -> ${to}`).toBe(status);
                expect(restored.warnings).withContext(`${from} -> ${to}`).toEqual([]);
            }
        });

        it('clamps the second Core hit on a one-slot autocannon to the single TW critical slot', async () => {
            const fixture = createDirectMekRuntimeFixture('core-2026');
            const ac = fixture.equipmentComponent('Test AC');
            const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.includes(ac.id))!;
            for (let hit = 0; hit < 2; hit++) {
                expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' })
                    .accepted).toBeTrue();
            }

            const tw = await restoreMek(fixture, fixture.instance, 'total-warfare');
            expect(tw.unit.query().criticalHits(slot.id)).toBe(1);
            expect(tw.unit.query().componentStatus(ac.id)).toBe('destroyed');
            expect(tw.warnings.map(warning => warning.code)).toContain('DAMAGE_CLAMPED');
        });

        it('drops TW-only Flamer Heat and Passive Shield modes under Core', async () => {
            const flamer = createDirectFlamerRuntimeFixture('total-warfare');
            const flamerId = flamer.equipmentComponent('Test Flamer').id;
            expect(setMode(flamer.instance, flamerId, FLAMER_HEAT_MODE)).toBeTrue();
            // Core has no Flamer modes: a flamer always deals both heat and damage (Core p.183, Dual-Purpose).
            const coreFlamer = await restoreMek(flamer, flamer.instance, 'core-2026');
            expect(coreFlamer.unit.query().componentMode(flamerId)).toBeUndefined();
            expect(coreFlamer.warnings.map(warning => warning.code)).toEqual(['STATE_SKIPPED']);

            const shield = createDirectShieldRuntimeFixture('total-warfare', 'medium');
            const shieldId = shield.equipmentComponent('Test Medium Shield').id;
            expect(setMode(shield.instance, shieldId, SHIELD_PASSIVE_MODE)).toBeTrue();
            // Core shields are only lowered or raised (Core p.195, Raising a Shield).
            const coreShield = await restoreMek(shield, shield.instance, 'core-2026');
            expect(coreShield.unit.query().componentMode(shieldId)).not.toBe(SHIELD_PASSIVE_MODE);
            expect(coreShield.warnings.map(warning => warning.code)).toEqual(['STATE_SKIPPED']);
        });

        it('raises at most one of two shields active under TW once restored under Core (Core p.195: one at a time)', async () => {
            const fixture = createDirectDualShieldRuntimeFixture('total-warfare', 'medium');
            const shields = [...fixture.index.components.values()]
                .filter(component => component.kind === 'equipment' && component.mount.equipmentId === 'Test Medium Shield');
            expect(shields.length).toBe(2);
            for (const shield of shields) expect(setMode(fixture.instance, shield.id, SHIELD_ACTIVE_MODE)).toBeTrue();

            const core = await restoreMek(fixture, fixture.instance, 'core-2026');
            const raised = shields.filter(shield => core.unit.query().componentMode(shield.id) === SHIELD_ACTIVE_MODE);
            expect(raised.length).toBeLessThanOrEqual(1);
        });

        it('keeps only the Bombast Laser facts the bound ruleset defines', async () => {
            const core = createDirectBombastRuntimeFixture('core-2026');
            const coreId = core.equipmentComponent('Test Bombast Laser').id;
            expect(setMode(core.instance, coreId, BOMBAST_LASER_DAMAGE_16_MODE)).toBeTrue();
            expect(core.instance.dispatch({ type: 'set-bombast-laser-charge', componentId: coreId,
                state: BOMBAST_LASER_CHARGING_STATE }).changed).toBeTrue();
            const toTw = await restoreMek(core, core.instance, 'total-warfare');
            // TW offers 7-12 damage and has no charge lifecycle: the unit falls back to the shared default.
            expect(toTw.unit.query().componentMode(coreId) ?? BOMBAST_LASER_DAMAGE_12_MODE).toBe(BOMBAST_LASER_DAMAGE_12_MODE);
            expect(toTw.unit.query().componentBombastLaser(coreId)).toBeUndefined();
            expect(toTw.warnings.length).toBeGreaterThan(0);

            const tw = createDirectBombastRuntimeFixture('total-warfare');
            const twId = tw.equipmentComponent('Test Bombast Laser').id;
            expect(setMode(tw.instance, twId, BOMBAST_LASER_DAMAGE_7_MODE)).toBeTrue();
            const toCore = await restoreMek(tw, tw.instance, 'core-2026');
            expect(toCore.unit.query().componentMode(twId) ?? BOMBAST_LASER_DAMAGE_12_MODE).toBe(BOMBAST_LASER_DAMAGE_12_MODE);
            expect(toCore.warnings.map(warning => warning.code)).toEqual(['STATE_SKIPPED']);
        });

        it('keeps an escalating-failure sequence only within the bound ruleset\'s table', async () => {
            const fixture = createDirectEscalatingFailureRuntimeFixture('total-warfare');
            const blueShield = fixture.equipmentComponent('Test Blue Shield');
            // TW counts 17 Blue Shield steps; Core only 10.
            for (let index = 0; index < 14; index++) {
                expect(fixture.instance.dispatch({ type: 'edit-escalating-failure', componentId: blueShield.id,
                    edit: { kind: 'select-sequence', index } }).accepted).toBeTrue();
            }
            expect(fixture.instance.query().componentEscalatingFailure(blueShield.id)?.sequence).toBe(14);

            const core = await restoreMek(fixture, fixture.instance, 'core-2026');
            expect(core.unit.query().componentEscalatingFailure(blueShield.id)?.sequence ?? 0).toBeLessThanOrEqual(10);
            expect(core.warnings.map(warning => warning.code)).toEqual(['STATE_SKIPPED']);
        });

        it('rederives the standard gyro PSR modifier and leaves no pending gyro PSR at the TW target (TW p.60 +3; Core p.111 +2)', async () => {
            const fixture = createDirectMekRuntimeFixture('total-warfare');
            const gyro = [...fixture.index.slots.values()].find(slot => slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Gyro';
            }))!;
            expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: gyro.id, hits: 1, target: 'committed' })
                .accepted).toBeTrue();
            const tw = supportedMovement(fixture.instance);
            expect(tw.permanentPsrModifier).toBe(3);
            expect(pendingChecks(fixture.instance)).toEqual([
                jasmine.objectContaining({ reason: 'Gyro hit', targetNumber: tw.pilotingTargetNumber }),
            ]);

            const core = await restoreMek(fixture, fixture.instance, 'core-2026');
            const projection = supportedMovement(core.unit);
            expect(projection.permanentPsrModifier).toBe(2);
            expect(projection.pilotingTargetNumber).toBe(tw.pilotingTargetNumber - 1);
            // The PSR still owed for the hit is rolled against the Core target, or not at all.
            for (const check of pendingChecks(core.unit)) {
                expect(check.targetNumber).withContext(check.reason).toBe(projection.pilotingTargetNumber);
            }
        });

        it('drops the TW lower-arm fire penalty under Core but keeps its punch penalty (TW p.117; Core p.97)', async () => {
            const fixture = createDirectMekRuntimeFixture('total-warfare');
            const lowerArm = [...fixture.index.slots.values()].find(slot =>
                fixture.index.locations.get(slot.locationId)?.code === 'LA'
                && slot.componentIds.some(componentId => {
                    const component = fixture.index.components.get(componentId);
                    return component?.kind === 'system' && component.systemType === 'Lower Arm Actuator';
                }))!;
            expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: lowerArm.id, hits: 1, target: 'committed' })
                .accepted).toBeTrue();
            const tw = armAttacks(fixture, fixture.instance);
            expect(tw.laser.weapon?.toHitModifier).toBe(1);

            const core = await restoreMek(fixture, fixture.instance, 'core-2026');
            const after = armAttacks(fixture, core.unit);
            expect(after.laser.weapon?.toHitModifier).toBe(0);
            expect(after.laser.weapon?.hitModifierBreakdown).toEqual([]);
            // Core punch: -1 base, +2 for the lower arm actuator.
            expect(after.punch.hitModifiers).toEqual([1]);
        });

        it('clamps spent Precision rounds to the smaller TW bin (Core p.192 x0.6; TechManual p.208 x0.5)', async () => {
            const { entity, uuid } = precisionUnit(new TestBipedMekEntity(precisionRegistry()), 'LT');
            const core = await createMekUnit({ uuid, instanceId: 'unit:precision-mek' }, entity, uuid,
                mekOptions('core-2026'));
            expect(core.dispatch({ type: 'configure-ammo-source', componentId: AMMO,
                munitionKey: precision.id, remaining: 0 }).changed).toBeTrue();
            expect(core.query().ammoEquipment(AMMO)?.id).toBe(precision.id);

            const warnings: V2StateRestoreWarning[] = [];
            const tw = await restoreMekUnit(wire(core.serialize()), entity, uuid, mekOptions('total-warfare'),
                undefined, { onWarning: warning => warnings.push(warning) });
            expect(tw.query().ammoEquipment(AMMO)?.id).toBe(precision.id);
            expect(tw.query().remainingAmmo(AMMO)).toBe(0);
            expect(warnings.map(warning => warning.code)).toContain('DAMAGE_CLAMPED');

            // A full Core bin stays full under TW, at the TW capacity of 5.
            const full = await createMekUnit({ uuid, instanceId: 'unit:precision-mek-full' }, entity, uuid,
                mekOptions('core-2026'));
            expect(full.dispatch({ type: 'configure-ammo-source', componentId: AMMO,
                munitionKey: precision.id, remaining: 6 }).changed).toBeTrue();
            const fullTw = await restoreMekUnit(wire(full.serialize()), entity, uuid, mekOptions('total-warfare'));
            expect(fullTw.query().remainingAmmo(AMMO)).toBe(5);
        });
    });

    describe('non-Mek', () => {
        it('loads a TW-jammed Ultra AC vehicle under Core instead of failing to restore it', () => {
            const ultra = new WeaponEquipment({
                id: 'TestUltraAC5', name: 'Test Ultra AC/5', type: 'weapon',
                flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'], modes: ['Single', 'Ultra'],
                weapon: { ammoType: 'AC_ULTRA', rackSize: 5, damage: 5, heat: 1, ranges: [3, 6, 9, 12] },
            });
            const entity = new TestTankEntity(createTestEquipmentRegistry({ [ultra.id]: ultra }));
            entity.uuid.set(TANK_UUID);
            entity.setArmorValue('Front', 'front', 20);
            const ultraId = asComponentId(addTestEquipment(entity, ultra, { location: entity.locationOrder[0] }).mountId);
            const tw = createTank(entity, 'total-warfare');
            expect(tw.dispatch({ type: 'set-component-jammed', componentId: ultraId, jammed: true }).changed).toBeTrue();
            const face = [...tw.getIndex().armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;
            expect(tw.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' }).accepted)
                .toBeTrue();

            let core: CBTNonMekUnit | undefined;
            expect(() => core = restoreNonMekUnit(wire(tw.serialize()), entity, TANK_UUID, scenario('core-2026')))
                .not.toThrow();
            // Unrelated damage survives the switch.
            expect(core?.query().remainingArmor(face.id)).toBe(face.maximumPoints - 1);
        });

        it('loads a vehicle Blue Shield sequence beyond the Core table instead of failing to restore it', () => {
            const entity = new TestTankEntity(createTestEquipmentRegistry());
            entity.uuid.set(TANK_UUID);
            const shieldId = asComponentId(addTestEquipmentWithFlags(entity, 'F_BLUE_SHIELD',
                { location: entity.locationOrder[0] }).mountId);
            const tw = createTank(entity, 'total-warfare');
            for (let index = 0; index < 12; index++) {
                expect(tw.dispatch({ type: 'edit-escalating-failure', componentId: shieldId,
                    edit: { kind: 'select-sequence', index } }).accepted).toBeTrue();
            }
            expect(tw.snapshot().components.get(shieldId)?.escalatingFailure?.sequence).toBe(12);

            expect(() => restoreNonMekUnit(wire(tw.serialize()), entity, TANK_UUID, scenario('core-2026'))).not.toThrow();
        });

        it('loads a vehicle with spent Precision rounds beyond the TW bin instead of failing to restore it', () => {
            const { entity, uuid } = precisionUnit(new TestTankEntity(precisionRegistry()), 'Front');
            const core = createTank(entity, 'core-2026', uuid);
            expect(core.dispatch({ type: 'configure-ammo-source', componentId: AMMO,
                munitionKey: precision.id, remaining: 0 }).changed).toBeTrue();

            let tw: CBTNonMekUnit | undefined;
            expect(() => tw = restoreNonMekUnit(wire(core.serialize()), entity, uuid, scenario('total-warfare')))
                .not.toThrow();
            expect(tw?.query().remainingAmmo(AMMO)).toBe(0);
        });
    });
});

const TANK_UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5ea');
const AMMO = asComponentId('ammo:1');
const standard = new AmmoEquipment({
    id: 'Ammo_AC_10', name: 'AC/10 Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 10 },
});
const precision = new AmmoEquipment({
    id: 'Ammo_AC_10_Precision', name: 'AC/10 Precision Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 5, baseAmmo: standard.id, munitionType: ['M_PRECISION'] },
});

function precisionRegistry() {
    return createTestEquipmentRegistry({ [standard.id]: standard, [precision.id]: precision });
}

function precisionUnit<E extends TestBipedMekEntity | TestTankEntity>(entity: E, location: string) {
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5eb');
    entity.uuid.set(uuid);
    entity.setTonnage(55);
    entity.setEquipment([new EntityMountedEquipment({
        mountId: 'ammo:1', equipment: standard, equipmentId: standard.id,
        allocation: { kind: 'location', location }, shotsCount: 10,
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
    })]);
    return { entity, uuid };
}

function scenario(ruleset: CBTRuleset) {
    return { id: 'megamek', ruleset };
}

function mekOptions(ruleset: CBTRuleset) {
    return { initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' }, scenario: scenario(ruleset) };
}

function createTank(entity: TestTankEntity, ruleset: CBTRuleset, uuid = TANK_UUID): CBTNonMekUnit {
    return createNonMekUnit(entity, {
        instanceId: 'unit:cross-ruleset-tank', uuid, deployment: { id: 'default' },
        scenario: scenario(ruleset), initialStateProfileId: 'pristine-non-mek-v1',
    });
}

/** Saves leave through JSON, as force storage does. */
function wire<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function supportedMovement(unit: CBTMekUnit) {
    const projection = unit.query().mekMovementPsr();
    if (projection.kind !== 'supported') throw new Error('Mek movement projection is unsupported');
    return projection;
}

function pendingChecks(unit: CBTMekUnit) {
    return unit.query().mekPilotChecks().filter(check => check.status === 'pending');
}

function armAttacks(fixture: DirectMekRuntimeFixture, unit: CBTMekUnit) {
    const panel = projectMekEquipmentPanel(fixture.entity, fixture.index, unit.ruleset(), unit.query(),
        emptyCBTEncounterSnapshot());
    return {
        laser: panel.components.find(component => component.label === 'Medium Laser')!,
        punch: panel.physicalAttacks.find(attack =>
            attack.target.kind === 'intrinsic' && attack.locationCodes.includes('LA'))!,
    };
}

function setMode(unit: CBTMekUnit, componentId: ComponentId, mode: string): boolean {
    return unit.dispatch({ type: 'set-component-mode', componentId, mode }).changed;
}

async function restoreMek(fixture: DirectMekRuntimeFixture, unit: CBTMekUnit, ruleset: CBTRuleset) {
    const saved = wire(unit.serialize());
    const warnings: V2StateRestoreWarning[] = [];
    const restored = await restoreMekUnit(saved, fixture.entity, fixture.identity, {
        initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
        profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
        deployment: saved.deployment.values,
        scenario: scenario(ruleset),
    }, undefined, { onWarning: warning => warnings.push(warning) });
    expect(restored.ruleset()).toBe(ruleset);
    return { unit: restored, warnings };
}
