// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import { TestTankEntity } from '../entity/testing/test-entities';
import {
    deserializeMekMovementPsrStateV2,
    serializeMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import { formatRuntimeHistoryMessage, RUNTIME_HISTORY_MESSAGE } from './runtime-history';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { createNonMekRuntimeForTest } from './testing/unit-runtime-owner-fixture';
import type { CBTUnitCommand } from './unit-command';

describe('Mek physical attack pilot checks', () => {
    const charged = Object.freeze({
        type: 'record-mek-physical-attack-checks',
        attackId: 'attack:charge',
        checks: ['charged'],
    } as const satisfies CBTUnitCommand);

    it('targets the piloting roll plus every same-phase modifier and ignores the same attack recorded again', () => {
        const { instance } = createDirectMekRuntimeFixture('total-warfare');
        const movement = instance.query().mekMovementPsr();
        if (movement.kind !== 'supported') throw new Error('The fixture Mek has no PSR projection');

        expect(instance.dispatch(charged)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(instance.dispatch(charged)).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(instance.dispatch({
            type: 'record-mek-physical-attack-checks',
            attackId: 'attack:kick',
            checks: ['kicked'],
        }).changed).toBeTrue();

        // Each roll adds the other same-phase events' modifiers, so the kick's roll takes the charge's +2
        // (TW p.59, Making Piloting/Driving Skill Rolls; Core p.110, Multiple Rolls).
        expect(instance.query().mekPilotChecks().map(check =>
            [check.reason, check.targetNumber, check.status, check.source.sourceKind]))
            .toEqual([
                ['Charged', movement.pilotingTargetNumber + 2, 'pending', 'physical'],
                ['Kicked', movement.pilotingTargetNumber + 2, 'pending', 'physical'],
            ]);
    });

    it('holds the phase boundary until the check is resolved', () => {
        const { instance } = createDirectMekRuntimeFixture('core-2026');
        expect(instance.dispatch(charged).changed).toBeTrue();
        const check = instance.query().mekPilotChecks()[0]!;

        expect(instance.dispatch({ type: 'end-phase' }).changed).toBeFalse();
        expect(instance.dispatch({
            type: 'resolve-mek-pilot-check',
            checkId: check.checkId,
            evidence: { dice: [6, 6], claimedOutcome: 'success' },
        }).changed).toBeTrue();
        expect(instance.dispatch({ type: 'end-phase' }).accepted).toBeTrue();
        expect(instance.query().mekPilotChecks()).toEqual([]);
        expect(instance.query().hasCondition('prone')).toBeFalse();
    });

    it('does not make an already prone Mek check to avoid falling', () => {
        const { instance } = createDirectMekRuntimeFixture();
        expect(instance.dispatch({ type: 'set-condition', condition: 'prone', active: true }).accepted).toBeTrue();

        expect(instance.dispatch(charged).changed).toBeFalse();
        expect(instance.query().mekPilotChecks()).toEqual([]);
    });

    it('round-trips physical checks and the missed death from above fall through the ledger codec', () => {
        const { instance } = createDirectMekRuntimeFixture('core-2026');
        expect(instance.dispatch(charged).changed).toBeTrue();
        expect(instance.dispatch({
            type: 'record-mek-physical-attack-checks',
            attackId: 'attack:dfa',
            checks: [],
            missedDeathFromAbove: true,
        }).changed).toBeTrue();
        const state = instance.query().mekMovementPsrState();
        expect(state.automaticFalls).toEqual([{ triggerKind: 'missed-death-from-above', locationIds: [] }]);

        const serialized = serializeMekMovementPsrStateV2(state);
        const wire = JSON.parse(JSON.stringify(serialized));
        expect(serializeMekMovementPsrStateV2(deserializeMekMovementPsrStateV2(wire))).toEqual(serialized);

        const check = serialized.checks![0]!;
        expect(() => deserializeMekMovementPsrStateV2({
            ...wire,
            checks: [{ ...check, source: { ...check.source, triggerKind: 'kicked' } }],
        })).toThrowError(/witness does not match/);
    });

    it('rejects a malformed record without changing the ledger', () => {
        const { instance } = createDirectMekRuntimeFixture();
        const malformed: readonly unknown[] = [
            { ...charged, attackId: ' ' },
            { ...charged, checks: ['charged', 'charged'] },
            { ...charged, checks: ['gyro-hit'] },
            { ...charged, checks: [{ triggerKind: 'charged', modifier: 2 }] },
            { ...charged, missedDeathFromAbove: 'yes' },
        ];
        for (const command of malformed) {
            expect(instance.dispatch(command as CBTUnitCommand).changed)
                .withContext(JSON.stringify(command))
                .toBeFalse();
        }
        expect(instance.query().mekMovementPsrState().checks).toEqual([]);
        expect(instance.query().mekMovementPsrState().automaticFalls).toEqual([]);
    });

    it('rejects a check the bound rules do not make: Total Warfare makes no clubbed Mek roll (TW p.60; Core p.111)', () => {
        const { instance } = createDirectMekRuntimeFixture('total-warfare');
        expect(instance.dispatch({ ...charged, checks: ['clubbed'] }).changed).toBeFalse();
        expect(instance.query().mekMovementPsrState().checks).toEqual([]);
    });

    it('leaves a non-Mek runtime unchanged', () => {
        const tank = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        tank.uuid.set(uuid);
        const runtime = createNonMekRuntimeForTest('unit:tank', {
            entity: uuid,
            ruleset: TOTAL_WARFARE_RULESET,
            initialStateProfile: { schemaVersion: 1, initializerRevision: 1, profileId: 'pristine-non-mek-v1' },
        }, tank, TOTAL_WARFARE_RULESET);
        const revision = runtime.query().stateRevision;

        expect(runtime.dispatch({ ...charged, missedDeathFromAbove: true }).changed).toBeFalse();
        expect(runtime.query().stateRevision).toBe(revision);
    });

    it('describes the recorded checks and fall in the unit history', () => {
        const format = (...data: (string | number)[]) => formatRuntimeHistoryMessage(
            [RUNTIME_HISTORY_MESSAGE.PHYSICAL_ATTACK_CHECKS, 'unit:atlas', ...data],
            { unitLabel: () => 'Atlas' },
        );

        expect(format(0, 'made-charge')).toBe('Atlas: Piloting Skill Roll required: Made a charge');
        expect(format(1)).toBe('Atlas: Automatic fall: Missed death from above');
    });
});

/**
 * The rulebooks' worked example (TW p.61; Core p.110): every roll of a phase adds the modifiers of the
 * phase's other events and the damage the Mek holds, so the rolls of one phase share one target.
 */
describe('Mek pilot check targets across a phase', () => {
    type Fixture = ReturnType<typeof createDirectMekRuntimeFixture>;

    function legActuator(fixture: Fixture, systemType: string, locationCode: string) {
        return [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === locationCode
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === systemType;
            }))!;
    }

    /** Commits `amount` damage: armor first, then the centre torso's structure. */
    function damage(fixture: Fixture, amount: number): void {
        let left = amount;
        for (const face of fixture.index.armorFaces.values()) {
            const hit = Math.min(left, fixture.instance.query().remainingArmor(face.id));
            if (hit <= 0) continue;
            expect(fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: hit, target: 'committed' })
                .accepted).toBeTrue();
            left -= hit;
        }
        if (left === 0) return;
        const torso = [...fixture.index.locations.values()].find(location => location.code === 'CT')!;
        expect(fixture.instance.dispatch({ type: 'damage-internal', locationId: torso.id, amount: left, target: 'committed' })
            .accepted).toBeTrue();
    }

    function hit(fixture: Fixture, systemType: string, locationCode: string): void {
        expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: legActuator(fixture, systemType, locationCode).id,
            hits: 1, target: 'committed' }).accepted).toBeTrue();
    }

    function pendingTargets(fixture: Fixture): number[] {
        return fixture.instance.query().mekPilotChecks()
            .filter(check => check.status === 'pending')
            .map(check => check.targetNumber);
    }

    for (const [ruleset, weaponPhaseRolls] of [['total-warfare', 3], ['core-2026', 2]] as const) {
        it(`rolls every ${ruleset} check of the phase at the phase's full target`, () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            const movement = fixture.instance.query().mekMovementPsr();
            if (movement.kind !== 'supported') throw new Error('The fixture Mek has no PSR projection');
            expect(movement.pilotingTargetNumber).toBe(5);

            // Weapon Attack Phase: 20+ damage and two leg actuators (Core rolls once for one leg).
            damage(fixture, 20);
            hit(fixture, 'Upper Leg Actuator', 'LL');
            hit(fixture, 'Lower Leg Actuator', 'LL');
            expect(pendingTargets(fixture)).toEqual(Array<number>(weaponPhaseRolls).fill(8));

            for (const check of fixture.instance.query().mekPilotChecks()) {
                expect(fixture.instance.dispatch({ type: 'resolve-mek-pilot-check', checkId: check.checkId,
                    evidence: { dice: [6, 6] } }).accepted).toBeTrue();
            }
            expect(fixture.instance.dispatch({ type: 'end-phase' }).accepted).toBeTrue();

            // Physical Attack Phase: kicked twice, an actuator in the other leg and 20+ damage.
            for (const attackId of ['attack:first-kick', 'attack:second-kick']) {
                expect(fixture.instance.dispatch({ type: 'record-mek-physical-attack-checks', attackId, checks: ['kicked'] })
                    .changed).toBeTrue();
            }
            hit(fixture, 'Upper Leg Actuator', 'RL');
            damage(fixture, 20);
            expect(pendingTargets(fixture)).toEqual([9, 9, 9, 9]);
        });
    }

    it('keeps the target a check was rolled against when a later event raises the others', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        hit(fixture, 'Upper Leg Actuator', 'LL');
        const [rolled] = fixture.instance.query().mekPilotChecks();
        expect(fixture.instance.dispatch({ type: 'resolve-mek-pilot-check', checkId: rolled!.checkId,
            evidence: { dice: [6, 6] } }).accepted).toBeTrue();

        damage(fixture, 20);

        expect(fixture.instance.query().mekPilotChecks().map(check => [check.status, check.targetNumber]))
            .toEqual([['success', 6], ['pending', 7]]);
    });
});

/**
 * Under the full phase system a Piloting Skill Roll of the Movement Phase is made at once (TW p.59; Core
 * p.113), so its check is immediate: it counts only the events up to it and holds the unit until rolled.
 */
describe('Immediate Movement Phase pilot checks', () => {
    type Fixture = ReturnType<typeof createDirectMekRuntimeFixture>;

    const run = (distance: number, realPhases: boolean): CBTUnitCommand => ({
        type: 'declare-mek-movement',
        declaration: { schemaVersion: 1, mode: 'run', distance, boosterComponentIds: [] },
        ...(realPhases ? { realPhases: true as const } : {}),
    });

    /** A Total Warfare Mek with a damaged gyro, its gyro-hit roll already made. */
    function damagedGyroMek(): Fixture {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const gyro = [...fixture.index.slots.values()].find(slot => slot.componentIds.some(componentId => {
            const component = fixture.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === 'Gyro';
        }))!;
        expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: gyro.id, hits: 1, target: 'committed' })
            .accepted).toBeTrue();
        roll(fixture, fixture.instance.query().mekPilotChecks()[0]!.checkId);
        return fixture;
    }

    function roll(fixture: Fixture, checkId: string): void {
        expect(fixture.instance.dispatch({ type: 'resolve-mek-pilot-check', checkId, evidence: { dice: [6, 6] } })
            .changed).toBeTrue();
    }

    function runCheck(fixture: Fixture) {
        return fixture.instance.query().mekPilotChecks().find(check => check.source.triggerKind === 'move-damaged-gyro');
    }

    for (const realPhases of [true, false]) {
        it(`${realPhases ? 'ignores' : 'counts'} the events after a Movement check ${realPhases
            ? 'rolled at once under the phase system' : 'left for the end of the phase'}`, () => {
            const fixture = damagedGyroMek();
            expect(fixture.instance.dispatch(run(2, realPhases)).changed).toBeTrue();
            const raised = runCheck(fixture)!;
            expect(raised.immediate).toBe(realPhases ? true : undefined);

            // A charge later in the phase adds +2 to every roll still to be made (TW p.59; Core p.110).
            expect(fixture.instance.dispatch({
                type: 'record-mek-physical-attack-checks', attackId: 'attack:charge', checks: ['charged'],
            }).changed).toBeTrue();

            expect(runCheck(fixture)!.targetNumber).toBe(raised.targetNumber + (realPhases ? 0 : 2));
        });
    }

    it('raises end-of-phase checks outside the Movement step', () => {
        const fixture = damagedGyroMek();
        expect(fixture.instance.dispatch({ type: 'complete-turn-step', step: 0 }).changed).toBeTrue();

        expect(fixture.instance.dispatch(run(2, true)).changed).toBeTrue();

        expect(runCheck(fixture)!.immediate).toBeUndefined();
    });

    it('holds the unit until the check is rolled, after which the movement keeps its mode', () => {
        const fixture = damagedGyroMek();
        const { instance } = fixture;
        expect(instance.dispatch(run(2, true)).changed).toBeTrue();
        const legalActions = () => {
            const movement = instance.query().mekMovementPsr();
            return movement.kind === 'supported' ? movement.actions.filter(action => action.legal).map(action => action.kind) : [];
        };

        expect(legalActions()).toEqual([]);
        for (const command of [
            run(3, true),
            { type: 'clear-mek-movement' },
            { type: 'declare-mek-action', action: { schemaVersion: 1, kind: 'shutdown' } },
            { type: 'end-phase' },
        ] satisfies CBTUnitCommand[]) {
            expect(instance.dispatch(command).changed).withContext(command.type).toBeFalse();
        }

        roll(fixture, runCheck(fixture)!.checkId);
        const checks = instance.query().mekPilotChecks().length;
        expect(legalActions()).toEqual(['run', 'shutdown']);
        // The distance may still change, and the movement's roll is not made again.
        expect(instance.dispatch(run(4, true)).changed).toBeTrue();
        expect(instance.query().mekPilotChecks().length).toBe(checks);
        expect(instance.dispatch({
            type: 'declare-mek-movement',
            declaration: { schemaVersion: 1, mode: 'walk', distance: 1, boosterComponentIds: [] },
            realPhases: true,
        }).changed).toBeFalse();
        expect(instance.dispatch({ type: 'end-phase' }).accepted).toBeTrue();
        expect(instance.query().mekPilotChecks()).toEqual([]);
    });

    it('round-trips the immediate fact and reads a check saved without it as end-of-phase', () => {
        const fixture = damagedGyroMek();
        expect(fixture.instance.dispatch(run(2, true)).changed).toBeTrue();
        const serialized = serializeMekMovementPsrStateV2(fixture.instance.query().mekMovementPsrState());
        const wire = JSON.parse(JSON.stringify(serialized));
        expect(wire.checks.map((check: { immediate?: true }) => check.immediate)).toEqual([undefined, true]);
        expect(serializeMekMovementPsrStateV2(deserializeMekMovementPsrStateV2(wire))).toEqual(serialized);

        const { immediate: _immediate, ...older } = wire.checks[1];
        expect(deserializeMekMovementPsrStateV2({ ...wire, checks: [wire.checks[0], older] }).checks[1]!.immediate)
            .toBeUndefined();
        expect(() => deserializeMekMovementPsrStateV2({ ...wire, checks: [wire.checks[0], { ...older, immediate: false }] }))
            .toThrowError(/Invalid Mek pilot check/);
    });
});
