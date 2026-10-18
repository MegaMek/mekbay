// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { BOMBAST_LASER_CHARGING_STATE } from './runtime/component-bombast-laser';
import { BOMBAST_LASER_DAMAGE_12_MODE,BOMBAST_LASER_DAMAGE_16_MODE,BOMBAST_LASER_DAMAGE_7_MODE } from './bombast-laser-mode.model';
import type { CBTForce } from './cbt-force.model';
import type { CBTRuleset } from './cbt-ruleset.model';
import { hasMekRuntime,hasNonMekRuntime } from './cbt-unit-snapshot';
import type { ComponentId } from './entity/entity-identifiers';
import { TestAeroSpaceFighterEntity,TestBipedMekEntity,TestTankEntity } from './entity/testing/test-entities';
import { createTestEquipmentRegistry } from './entity/testing/test-equipment-registry';
import { addTestEquipment } from './entity/testing/test-mounted-equipment';
import { EntityMountedEquipment } from './entity/types';
import { AmmoEquipment,WeaponEquipment } from './equipment.model';
import { FLAMER_HEAT_MODE } from './flamer-mode.model';
import { createMekUnit } from './runtime/cbt-mek-unit';
import { createNonMekUnit } from './runtime/cbt-non-mek-unit';
import type { CBTMekUnit,CBTUnit } from './runtime/cbt-unit';
import { SHIELD_ACTIVE_MODE,SHIELD_INACTIVE_MODE,SHIELD_PASSIVE_MODE } from './runtime/component-shield-mode';
import { projectMekEquipmentPanel } from './runtime/equipment-panel';
import { projectNonMekEquipmentPanel } from './runtime/non-mek-equipment-panel';
import type { NonMekUnitQueryPort } from './runtime/non-mek-unit-instance';
import type { SerializedCBTForce } from './force-serialization';
import type { CBTUnitCommand } from './runtime/unit-command';
import { fixtureScenario,loadCBTForceFixture } from './runtime/testing/cbt-force-fixture';
import {
createDirectBombastRuntimeFixture,
createDirectDualShieldRuntimeFixture,
createDirectEscalatingFailureRuntimeFixture,
createDirectFlamerRuntimeFixture,
createDirectMekRuntimeFixture,
createDirectShieldRuntimeFixture,
emptyCBTEncounterSnapshot,
type DirectMekRuntimeFixture,
} from './runtime/testing/direct-mek-runtime-fixture';

const OTHER: Readonly<Record<CBTRuleset, CBTRuleset>> = { 'total-warfare': 'core-2026', 'core-2026': 'total-warfare' };

/** A live CBT rules switch (`CBTForce.rebindScenarioRules`) over real units, compared with the rulebooks and a reload. */
describe('CBTForce live rules switch', () => {
    for (const from of ['total-warfare', 'core-2026'] as const) {
        const to = OTHER[from];

        it(`leaves every unit as a reload under ${to} would, after a ${from} game with pending damage, crits and PSRs`, async () => {
            const mek = createDirectMekRuntimeFixture(from);
            const tank = tankUnit(from);
            const { force, options, reload } = await loadCBTForceFixture([mek.instance, tank], from);
            await playSharedTurn(force, mek, mek.instance.instanceId);
            const track = [...entitySnapshot(force, tank.instanceId).index.damageTracks.keys()][0]!;
            await dispatch(force, tank.instanceId, { type: 'damage-track', damageTrackId: track, amount: 1,
                target: 'committed', timestamp: 1 });

            expect((await force.rebindScenarioRules(fixtureScenario(to))).bound).toBeTrue();
            const live = (await force.serializeForPersistence()).cbt!.units;

            options.set({ ...options(), CBTRules: to });
            const reloaded = await reload(await force.serializeForPersistence() as SerializedCBTForce);
            expect((await reloaded.serializeForPersistence()).cbt!.units).toEqual(live);
            for (const member of reloaded.getCBTMembers()) {
                expect(reloaded.getUnitSnapshot(member.id)!.ruleset).toBe(to);
                expect(reloaded.getUnitSnapshot(member.id)!.state).toEqual(force.getUnitSnapshot(member.id)!.state);
            }
        });

        it(`keeps pending damage, pending crits and owed consciousness rolls from ${from} to ${to}`, async () => {
            const mek = createDirectMekRuntimeFixture(from);
            const { force } = await loadCBTForceFixture([mek.instance], from);
            const id = mek.instance.instanceId;
            const crewId = [...mek.index.crewPositions.keys()][0]!;
            await playSharedTurn(force, mek, id);
            expect((await force.dispatchUnitCommand(id, { type: 'set-consciousness-rolls-due', positionIds: [crewId] }))
                .changed).toBeTrue();
            const before = mekSnapshot(force, id).state;

            expect((await force.rebindScenarioRules(fixtureScenario(to))).bound).toBeTrue();

            const after = mekSnapshot(force, id);
            expect(after.state.pendingCombat).toEqual(before.pendingCombat);
            expect(after.state.turn.consciousnessRollsDue).toEqual([crewId]);
            expect(after.query.hasPendingPhaseChanges()).toBeTrue();
        });
    }

    it('re-raises pending PSRs at the new rules\' targets: a gyro hit is +3 under TW and +2 under Core (TW p.60; Core p.98, p.111)', async () => {
        const mek = createDirectMekRuntimeFixture('total-warfare');
        const id = mek.instance.instanceId;
        const { force } = await loadCBTForceFixture([mek.instance], 'total-warfare');
        await dispatch(force, id, { type: 'hit-critical', slotId: systemSlot(mek, 'Gyro').id, hits: 1, target: 'committed' });
        await dispatch(force, id, { type: 'declare-mek-movement',
            declaration: { schemaVersion: 1, mode: 'run', distance: 1, boosterComponentIds: [] } });
        const tw = movement(force, id);
        expect(tw.permanentPsrModifier).toBe(3);
        const reasons = pendingChecks(force, id).map(check => check.reason);
        expect(reasons.length).toBe(2);
        expect(pendingChecks(force, id).every(check => check.targetNumber === tw.pilotingTargetNumber)).toBeTrue();

        expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({ bound: true, dropped: [] });
        const core = movement(force, id);
        expect(core.permanentPsrModifier).toBe(2);
        expect(pendingChecks(force, id).map(check => check.reason)).toEqual(reasons);
        for (const check of pendingChecks(force, id)) {
            expect(check.targetNumber).withContext(check.reason).toBe(core.pilotingTargetNumber);
        }

        expect(await force.rebindScenarioRules(fixtureScenario('total-warfare'))).toEqual({ bound: true, dropped: [] });
        expect(pendingChecks(force, id).map(check => check.targetNumber)).toEqual(reasons.map(() => tw.pilotingTargetNumber));
    });

    it('drops and lists a pending PSR the new rules do not raise: a TW foot actuator hit (TW p.60; Core p.111)', async () => {
        const mek = createDirectMekRuntimeFixture('total-warfare');
        const id = mek.instance.instanceId;
        const { force } = await loadCBTForceFixture([mek.instance], 'total-warfare');
        await dispatch(force, id, { type: 'hit-critical', slotId: systemSlot(mek, 'Foot Actuator', 'LL').id,
            hits: 1, target: 'committed' });
        expect(pendingChecks(force, id).length).toBe(1);

        expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({
            bound: true,
            dropped: [{ unit: force.runtimeHistoryUnitLabel(id), items: [jasmine.stringMatching(/piloting roll$/)] }],
        });
        expect(pendingChecks(force, id)).toEqual([]);
    });

    it('keeps only the first of two raised shields under Core and lists the other (Core p.195: one at a time)', async () => {
        const mek = createDirectDualShieldRuntimeFixture('total-warfare', 'medium');
        const id = mek.instance.instanceId;
        const { force } = await loadCBTForceFixture([mek.instance], 'total-warfare');
        const [first, second] = [...mek.index.components.values()]
            .filter(component => component.kind === 'equipment' && component.mount.equipmentId === 'Test Medium Shield');
        for (const shield of [first!, second!]) {
            await dispatch(force, id, { type: 'set-component-mode', componentId: shield.id, mode: SHIELD_ACTIVE_MODE });
        }

        expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({
            bound: true,
            dropped: [{ unit: force.runtimeHistoryUnitLabel(id),
                items: [force.runtimeHistoryTargetLabel(id, 'component', second!.id)] }],
        });
        expect(mekSnapshot(force, id).query.componentMode(first!.id)).toBe(SHIELD_ACTIVE_MODE);
        expect(mekSnapshot(force, id).query.componentMode(second!.id) ?? SHIELD_INACTIVE_MODE).toBe(SHIELD_INACTIVE_MODE);
    });

    for (const [label, create, equipmentId, command] of [
        ['a jammed Ultra AC (TW p.114; Core p.183)', createDirectMekRuntimeFixture, 'Test AC',
            (componentId: ComponentId): CBTUnitCommand => ({ type: 'set-component-jammed', componentId, jammed: true })],
        ['Flamer Heat mode (Core p.183)', createDirectFlamerRuntimeFixture, 'Test Flamer',
            (componentId: ComponentId): CBTUnitCommand => ({ type: 'set-component-mode', componentId, mode: FLAMER_HEAT_MODE })],
        ['a Passive shield (Core p.195)', (ruleset: CBTRuleset) => createDirectShieldRuntimeFixture(ruleset, 'medium'),
            'Test Medium Shield',
            (componentId: ComponentId): CBTUnitCommand => ({ type: 'set-component-mode', componentId, mode: SHIELD_PASSIVE_MODE })],
        ['a 7-damage Bombast Laser mode', createDirectBombastRuntimeFixture, 'Test Bombast Laser',
            (componentId: ComponentId): CBTUnitCommand => ({ type: 'set-component-mode', componentId, mode: BOMBAST_LASER_DAMAGE_7_MODE })],
    ] as const) {
        it(`drops and lists ${label} under Core, and switching back does not restore it`, async () => {
            const mek = create('total-warfare');
            const id = mek.instance.instanceId;
            const componentId = mek.equipmentComponent(equipmentId).id;
            const { force } = await loadCBTForceFixture([mek.instance], 'total-warfare');
            await dispatch(force, id, command(componentId));

            expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({
                bound: true,
                dropped: [{ unit: force.runtimeHistoryUnitLabel(id),
                    items: [force.runtimeHistoryTargetLabel(id, 'component', componentId)] }],
            });
            const core = mekSnapshot(force, id).state.components.get(componentId);
            expect(await force.rebindScenarioRules(fixtureScenario('total-warfare'))).toEqual({ bound: true, dropped: [] });
            expect(mekSnapshot(force, id).state.components.get(componentId)).toEqual(core);
        });
    }

    it('drops a Blue Shield sequence past the 10-step Core table and lists it', async () => {
        const mek = createDirectEscalatingFailureRuntimeFixture('total-warfare');
        const id = mek.instance.instanceId;
        const blueShield = mek.equipmentComponent('Test Blue Shield').id;
        const { force } = await loadCBTForceFixture([mek.instance], 'total-warfare');
        for (let index = 0; index < 14; index++) {
            await dispatch(force, id, { type: 'edit-escalating-failure', componentId: blueShield,
                edit: { kind: 'select-sequence', index } });
        }

        expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({
            bound: true,
            dropped: [{ unit: force.runtimeHistoryUnitLabel(id),
                items: [force.runtimeHistoryTargetLabel(id, 'component', blueShield)] }],
        });
        expect(mekSnapshot(force, id).query.componentEscalatingFailure(blueShield)?.sequence ?? 0).toBeLessThanOrEqual(10);
    });

    it('drops a charging Core 16-damage Bombast under TW and fires the TW 12-damage profile', async () => {
        const mek = createDirectBombastRuntimeFixture('core-2026');
        const id = mek.instance.instanceId;
        const bombast = mek.equipmentComponent('Test Bombast Laser').id;
        const { force } = await loadCBTForceFixture([mek.instance], 'core-2026');
        await dispatch(force, id, { type: 'set-component-mode', componentId: bombast, mode: BOMBAST_LASER_DAMAGE_16_MODE });
        await dispatch(force, id, { type: 'set-bombast-laser-charge', componentId: bombast, state: BOMBAST_LASER_CHARGING_STATE });

        expect(await force.rebindScenarioRules(fixtureScenario('total-warfare'))).toEqual({
            bound: true,
            dropped: [{ unit: force.runtimeHistoryUnitLabel(id),
                items: [force.runtimeHistoryTargetLabel(id, 'component', bombast)] }],
        });
        const snapshot = mekSnapshot(force, id);
        expect(snapshot.query.componentMode(bombast) ?? BOMBAST_LASER_DAMAGE_12_MODE).toBe(BOMBAST_LASER_DAMAGE_12_MODE);
        const row = projectMekEquipmentPanel(snapshot.entity, snapshot.index, snapshot.ruleset, snapshot.query,
            emptyCBTEncounterSnapshot()).components.find(component => component.componentId === bombast)!;
        expect(row.weapon).toEqual(jasmine.objectContaining({ damage: 12, heat: 12, toHitModifier: 3 }));
    });

    it('changes nothing when the scenario is unchanged, and restarts undo on an optional-rule change', async () => {
        const mek = createDirectMekRuntimeFixture('core-2026');
        const id = mek.instance.instanceId;
        const { force } = await loadCBTForceFixture([mek.instance], 'core-2026');
        await playSharedTurn(force, mek, id);
        const units = (await force.serializeForPersistence()).cbt!.units;
        const revision = force.serialize().cbt!.forceRevision;

        expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({ bound: true, dropped: [] });
        expect(force.serialize().cbt!.forceRevision).toBe(revision);
        expect(force.getRuntimeUndoState().canUndo).toBeTrue();

        expect((await force.rebindScenarioRules({ ...fixtureScenario('core-2026'),
            options: { ...fixtureScenario('core-2026').options, sprinting: true } })).bound).toBeTrue();
        // Undo checkpoints hold states made under the old optional rules (a Sprint once sprinting is off),
        // so any change of rules restarts the undo session.
        expect(force.getRuntimeUndoState().canUndo).toBeFalse();
        expect((await force.serializeForPersistence()).cbt!.units).toEqual(units);
    });

    it('returns to the same units after Core -> TW -> Core when no rule-specific state was held', async () => {
        const mek = createDirectMekRuntimeFixture('core-2026');
        const tank = tankUnit('core-2026');
        const id = mek.instance.instanceId;
        const { force } = await loadCBTForceFixture([mek.instance, tank], 'core-2026');
        const face = intactFace(force, id);
        await dispatch(force, id, { type: 'damage-armor', faceId: face, amount: 2, target: 'committed' });
        await dispatch(force, id, { type: 'spend-ammo', componentId: mek.equipmentComponent('Test Ammo').id, amount: 3 });
        const before = (await force.serializeForPersistence()).cbt!.units;

        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            expect(await force.rebindScenarioRules(fixtureScenario(ruleset))).toEqual({ bound: true, dropped: [] });
        }
        expect((await force.serializeForPersistence()).cbt!.units).toEqual(before);
    });

    it('values an undamaged unit at the same pristine and current BV under each ruleset, following the switch', async () => {
        const unit = await caselessMek('total-warfare');
        const { force } = await loadCBTForceFixture([unit], 'total-warfare');
        const [member] = force.getCBTMembers();
        const tw = member!.currentBaseBattleValue()!;
        expect(member!.pristineBattleValue()).toBe(tw);

        expect((await force.rebindScenarioRules(fixtureScenario('core-2026'))).bound).toBeTrue();
        const core = member!.currentBaseBattleValue()!;
        expect(member!.pristineBattleValue()).toBe(core);
        // Caseless AC ammo: twice the standard round's BV under TW, the standard round's under Core.
        expect(tw).toBeGreaterThan(core);
    });

    it('switches a vehicle\'s equipment rules like a Mek\'s but keeps its damage, and drops TW skidding under Core', async () => {
        const mrm = new WeaponEquipment({
            id: 'Test Vehicle MRM', name: 'MRM 10', type: 'weapon', flags: ['F_MRM', 'F_MISSILE'],
            weapon: { ammoType: 'MRM', rackSize: 10, damage: 1, heat: 4, ranges: [3, 8, 15, 16] },
        });
        const tank = tankUnit('total-warfare', mrm);
        const mrmId = [...tank.getIndex().components.values()].find(component =>
            component.mount?.equipmentId === mrm.id)!.id;
        const id = tank.instanceId;
        const { force } = await loadCBTForceFixture([tank], 'total-warfare');
        const index = entitySnapshot(force, id).index;
        const face = [...index.armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;
        await dispatch(force, id, { type: 'damage-armor', faceId: face.id, amount: 1, target: 'committed' });
        await dispatch(force, id, { type: 'damage-track', damageTrackId: [...index.damageTracks.keys()][0]!,
            amount: 1, target: 'committed', timestamp: 1 });
        await dispatch(force, id, { type: 'set-condition', condition: 'skidding', active: true });
        const damage = entitySnapshot(force, id).state;
        expect(mrmToHit(force, id, mrmId)).toBe(1);

        expect(await force.rebindScenarioRules(fixtureScenario('core-2026'))).toEqual({
            bound: true,
            dropped: [{ unit: force.runtimeHistoryUnitLabel(id), items: ['skidding condition'] }],
        });
        const core = entitySnapshot(force, id).state;
        expect(core.locations).toEqual(damage.locations);
        expect(core.damageTracks).toEqual(damage.damageTracks);
        // MRMs carry no TN modifier under Core (Core equipment rules apply to every unit type).
        expect(mrmToHit(force, id, mrmId)).toBe(0);
    });

    it('keeps aerospace heat across a switch both ways', async () => {
        const fighter = new TestAeroSpaceFighterEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5ed');
        fighter.uuid.set(uuid);
        const unit = createNonMekUnit(fighter, { instanceId: 'unit:switch-fighter', uuid, deployment: { id: 'default' },
            scenario: fixtureScenario('total-warfare'), initialStateProfileId: 'pristine-non-mek-v1' });
        const { force } = await loadCBTForceFixture([unit], 'total-warfare');
        await dispatch(force, unit.instanceId, { type: 'set-heat', heat: 7 });
        const heat = entitySnapshot(force, unit.instanceId).state.heat;

        for (const ruleset of ['core-2026', 'total-warfare'] as const) {
            expect((await force.rebindScenarioRules(fixtureScenario(ruleset))).bound).toBeTrue();
            expect(entitySnapshot(force, unit.instanceId).state.heat).withContext(ruleset).toEqual(heat);
        }
    });
});

/** Damage, crits and a pending PSR every ruleset keeps: committed and pending armor, a slot hit, ammo and a gyro hit. */
async function playSharedTurn(force: CBTForce, mek: DirectMekRuntimeFixture, id: string): Promise<void> {
    const faces = [...mek.index.armorFaces.values()].filter(face => face.maximumPoints > 3);
    await dispatch(force, id, { type: 'damage-armor', faceId: faces[0]!.id, amount: 2, target: 'committed' });
    await dispatch(force, id, { type: 'damage-armor', faceId: faces[1]!.id, amount: 3, target: 'pending' });
    await dispatch(force, id, { type: 'spend-ammo', componentId: mek.equipmentComponent('Test Ammo').id, amount: 4 });
    const laser = mek.equipmentComponent('ISMediumLaser');
    const laserSlot = [...mek.index.slots.values()].find(slot => slot.componentIds.includes(laser.id))!;
    await dispatch(force, id, { type: 'hit-critical', slotId: laserSlot.id, hits: 1, target: 'pending' });
    await dispatch(force, id, { type: 'hit-critical', slotId: systemSlot(mek, 'Gyro').id, hits: 1, target: 'committed' });
}

async function dispatch(force: CBTForce, id: string, command: CBTUnitCommand): Promise<void> {
    const result = await force.dispatchUnitCommand(id, command);
    expect(result.accepted).withContext(command.type).toBeTrue();
    expect(result.changed).withContext(command.type).toBeTrue();
}

function systemSlot(mek: DirectMekRuntimeFixture, systemType: string, locationCode?: string) {
    return [...mek.index.slots.values()].find(slot =>
        (locationCode === undefined || mek.index.locations.get(slot.locationId)?.code === locationCode)
        && slot.componentIds.some(componentId => {
            const component = mek.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === systemType;
        }))!;
}

function mekSnapshot(force: CBTForce, id: string) {
    const snapshot = force.getUnitSnapshot(id);
    if (!snapshot || !hasMekRuntime(snapshot)) throw new Error(`Missing Mek runtime ${id}`);
    return snapshot;
}

function entitySnapshot(force: CBTForce, id: string) {
    const snapshot = force.getUnitSnapshot(id);
    if (!snapshot || !hasNonMekRuntime(snapshot)) throw new Error(`Missing non-Mek runtime ${id}`);
    return snapshot;
}

function movement(force: CBTForce, id: string) {
    const projection = mekSnapshot(force, id).query.mekMovementPsr();
    if (projection.kind !== 'supported') throw new Error('Mek movement projection is unsupported');
    return projection;
}

function pendingChecks(force: CBTForce, id: string) {
    return mekSnapshot(force, id).query.mekPilotChecks().filter(check => check.status === 'pending');
}

function intactFace(force: CBTForce, id: string) {
    const snapshot = mekSnapshot(force, id);
    return [...snapshot.index.armorFaces.values()].find(face => face.maximumPoints > 3)!.id;
}

function mrmToHit(force: CBTForce, id: string, componentId: ComponentId) {
    const snapshot = entitySnapshot(force, id);
    return projectNonMekEquipmentPanel(snapshot.entity, snapshot.index, snapshot.ruleset, snapshot.state,
        snapshot.query as NonMekUnitQueryPort, { revision: 0, targets: [] }).components.find(row => row.componentId === componentId)?.weapon?.toHitModifier;
}

function tankUnit(ruleset: CBTRuleset, weapon?: WeaponEquipment): CBTUnit {
    const entity = new TestTankEntity(createTestEquipmentRegistry(weapon ? { [weapon.id]: weapon } : {}));
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5ee');
    entity.uuid.set(uuid);
    entity.setTonnage(40);
    entity.setArmorValue('Front', 'front', 20);
    if (weapon) addTestEquipment(entity, weapon, { location: 'Front' });
    return createNonMekUnit(entity, { instanceId: 'unit:switch-tank', uuid, deployment: { id: 'default' },
        scenario: fixtureScenario(ruleset), initialStateProfileId: 'pristine-non-mek-v1' });
}

async function caselessMek(ruleset: CBTRuleset): Promise<CBTMekUnit> {
    const autocannon = new WeaponEquipment({
        id: 'Test AC/5', name: 'AC/5', type: 'weapon', flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
        stats: { criticalSlots: 4, bv: 70 },
        weapon: { ammoType: 'AC', rackSize: 5, damage: 5, heat: 1, ranges: [3, 6, 12, 18] },
    });
    const standard = new AmmoEquipment({
        id: 'Test AC/5 Ammo', name: 'AC/5 Ammo', type: 'ammo', stats: { bv: 9 },
        ammo: { type: 'AC', rackSize: 5, shots: 20 },
    });
    const caseless = new AmmoEquipment({
        id: 'Test AC/5 Caseless', name: 'AC/5 Caseless Ammo', type: 'ammo', stats: { bv: 9 },
        ammo: { type: 'AC', rackSize: 5, shots: 40, baseAmmo: standard.id, munitionType: ['M_CASELESS'] },
    });
    const entity = new TestBipedMekEntity(createTestEquipmentRegistry({
        [autocannon.id]: autocannon, [standard.id]: standard, [caseless.id]: caseless,
    }));
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5ef');
    entity.uuid.set(uuid);
    entity.setTonnage(50);
    entity.setEquipment([autocannon, caseless].map((equipment, slot) => new EntityMountedEquipment({
        mountId: slot === 0 ? 'weapon:1' : 'ammo:1', equipment, equipmentId: equipment.id,
        allocation: { kind: 'location', location: 'RT' },
        ...(equipment === caseless ? { shotsCount: 40 } : {}),
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
    })));
    return createMekUnit({ uuid, instanceId: 'unit:switch-caseless' }, entity, uuid, {
        initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' }, scenario: fixtureScenario(ruleset),
    });
}
