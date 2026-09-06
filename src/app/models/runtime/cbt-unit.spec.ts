// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestTankEntity } from '../entity/testing/test-entities';
import { systemDamageId } from '../rules/system-damage-rules';
import { CBTUnit } from './cbt-unit';
import { reduceNonMekRuntime } from './non-mek-unit-instance';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { createNonMekRuntimeForTest } from './testing/unit-runtime-owner-fixture';
import { reduceMekRuntime } from './unit-instance';

describe('the shared CBTUnit state owner', () => {
    it('installs pure mechanics results only through its common command boundary', () => {
        const mek = createDirectMekRuntimeFixture().instance;
        const tankEntity = new TestTankEntity();
        tankEntity.uuid.set(mek.uuid);
        const tank = createNonMekRuntimeForTest('unit:tank-owner', mek.baselineRef, tankEntity, mek.ruleset());
        expect(mek instanceof CBTUnit).toBeTrue();
        expect(tank instanceof CBTUnit).toBeTrue();
        const mekBefore = mek.snapshot();
        const tankBefore = tank.snapshot();

        const mekPlan = reduceMekRuntime(mek.mechanics(), mekBefore, { type: 'set-heat', heat: 3 });
        const tankPlan = reduceNonMekRuntime(tank.mechanics(), tankBefore, { type: 'set-destroyed', destroyed: true });
        expect(mekPlan.changed).toBeTrue();
        expect(tankPlan.changed).toBeTrue();
        expect(mek.snapshot()).toBe(mekBefore);
        expect(tank.snapshot()).toBe(tankBefore);

        mek.dispatch({ type: 'set-heat', heat: 3 });
        tank.dispatch({ type: 'set-destroyed', destroyed: true });
        expect(mek.snapshot().heat.current).toBe(3);
        expect(tank.query().destroyed()).toBeTrue();
        expect(mekBefore.heat.current).toBe(0);
        expect(tankBefore.explicitlyDestroyed).toBeFalse();
        expect(Object.isFrozen(mek)).toBeTrue();
        expect(Object.isFrozen(tank)).toBeTrue();
    });

    it('takes ownership of its binding without retaining the caller runtime wrapper', () => {
        const prepared = createDirectMekRuntimeFixture().instance;
        const runtime = { kind: 'mek' as const, binding: prepared.mechanics(), state: prepared.snapshot(),
            deployment: prepared.getDeployment() };
        const unit = new CBTUnit<'mek'>({ uuid: prepared.uuid, instanceId: prepared.instanceId,
            baselineRef: prepared.baselineRef, runtime });
        const initialState = unit.snapshot();

        runtime.state = reduceMekRuntime(runtime.binding, runtime.state, { type: 'set-heat', heat: 7 }).state;

        expect(runtime.state.heat.current).toBe(7);
        expect(unit.snapshot()).toBe(initialState);
        expect(unit.query().heatState().current).toBe(0);
        expect(unit.revision()).toBe(0);
    });

    it('cannot authorize slot combat merely because a caller supplies a valid Mek slot ID', () => {
        const mek = createDirectMekRuntimeFixture().instance;
        const entity = new TestTankEntity();
        entity.uuid.set(mek.uuid);
        const tank = createNonMekRuntimeForTest('unit:slot-rejection', mek.baselineRef, entity, mek.ruleset());
        const state = tank.snapshot();
        const slotId = [...mek.getIndex().slots.keys()][0]!;
        const result = tank.dispatch({ type: 'hit-critical', slotId, hits: 1, target: 'committed' });
        expect(result).toEqual(jasmine.objectContaining({ accepted: true, changed: false, state }));
        expect(tank.snapshot()).toBe(state);
        expect(tank.revision()).toBe(0);
    });

    it('captures mutable Mek facts, crew deployment and baseline at construction', () => {
        const prepared = createDirectMekRuntimeFixture().instance;
        const heat = { ...prepared.snapshot().heat };
        const slotId = [...prepared.getIndex().slots.keys()][0]!;
        const slot = { hits: 0 };
        const state = { ...prepared.snapshot(), heat, slots: new Map([[slotId, slot]]) };
        const baselineRef = { ...prepared.baselineRef,
            initialStateProfile: { ...prepared.baselineRef.initialStateProfile } };
        const crewAssignment = { ...prepared.getCrewAssignment(),
            positions: prepared.getCrewAssignment().positions.map(position => ({ ...position })) };
        const binding = { ...prepared.mechanics(), source: { ...prepared.mechanics().source, crewAssignment } };
        const deployment = { ...prepared.getDeployment(),
            values: { ...prepared.getDeployment().values, crewAssignment } };
        const unit = new CBTUnit<'mek'>({ uuid: prepared.uuid, instanceId: prepared.instanceId,
            baselineRef, runtime: { kind: 'mek', binding, state, deployment } });
        const saved = unit.serialize();
        const query = unit.query();

        heat.current = 17;
        slot.hits = 1;
        state.explicitlyDestroyed = true;
        baselineRef.initialStateProfile.profileId = 'changed-by-caller';
        crewAssignment.positions[0]!.name = 'Changed by caller';
        deployment.values.id = 'changed-by-caller';
        binding.source = { ...binding.source, crewAssignment: { schemaVersion: 1, positions: [] } };

        expect(unit.serialize()).toEqual(saved);
        expect(unit.query()).toBe(query);
        expect(unit.snapshot().heat.current).toBe(0);
        expect(unit.snapshot().slots.get(slotId)?.hits).toBe(0);
        expect(unit.query().crewAssignment().positions.length).toBeGreaterThan(0);
        expect(unit.revision()).toBe(0);
        expect(Object.isFrozen(unit.snapshot())).toBeTrue();
        expect(Object.isFrozen(unit.snapshot().slots.get(slotId))).toBeTrue();
    });

    it('captures mutable non-Mek system state and its hit timestamps at construction', () => {
        const mek = createDirectMekRuntimeFixture().instance;
        const entity = new TestTankEntity();
        entity.uuid.set(mek.uuid);
        const prepared = createNonMekRuntimeForTest('unit:tank-capture', mek.baselineRef, entity, mek.ruleset());
        const id = systemDamageId('motive', 2);
        const damage = { hits: 1, hitTimestamps: [10] };
        const state = { ...prepared.snapshot(), damageTracks: new Map([[id, damage]]) };
        const unit = new CBTUnit<'non-mek'>({ uuid: prepared.uuid, instanceId: prepared.instanceId,
            baselineRef: prepared.baselineRef, runtime: { kind: 'non-mek', binding: prepared.mechanics(),
                state, deployment: prepared.getDeployment() } });
        const saved = unit.serialize();

        damage.hits = 2;
        damage.hitTimestamps.push(20);
        state.damageTracks.clear();
        state.explicitlyDestroyed = true;

        expect(unit.serialize()).toEqual(saved);
        expect(unit.snapshot().damageTracks.get(id)).toEqual({ hits: 1, hitTimestamps: [10] });
        expect(unit.query().destroyed()).toBeFalse();
        expect(unit.revision()).toBe(0);
    });
});
