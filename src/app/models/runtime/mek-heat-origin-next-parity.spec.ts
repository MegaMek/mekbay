// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { restoreMekUnit } from './cbt-mek-unit';
import { asComponentId } from '../entity/entity-identifiers';
import {
    compileMekHeatProfile,
    evaluateMekHeatScenarioSupport,
    type MekHeatProfile,
} from './mek-heat-profile';
import {
    createMekHeatContextV2,
    projectMekMovementHeatV2,
    type MekMovementHeatFactsV2,
} from './mek-heat-state-v2';
import { createMekMechanicsContextV2 } from './mek-mechanics-context-v2';
import { PPC_CAPACITOR_CHARGING_STATE, ppcCapacitorFiringHeat } from './component-ppc-capacitor';
import { projectMekRecordSheet } from './mek-record-sheet';
import { emptyCBTEncounterSnapshot } from './testing/direct-mek-runtime-fixture';
import { createMekRuntimeBinding, queryMekRuntime } from './unit-instance';
import {
    canonicalizeMekTurnStateV2,
    createPristineMekTurnStateV2,
    deserializeMekTurnStateV2,
    serializeMekTurnStateV2,
} from './mek-turn-state-v2';
import {
    createDirectEngineHeatRuntimeFixture,
    createMixedHeatSinkFixture,
    createDirectMekRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('mixed prototype and single sinks (IO:AE p. 65)', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`counts cooling by sink type and switches both sink types off at the End Phase under ${ruleset}`, async () => {
            // TW (Shutting Off Heat Sinks) and Core p. 103: switched off in the End Phase, after this turn's Heat Phase.
            const fixture = createMixedHeatSinkFixture(ruleset);
            const projection = mekProjection(fixture);
            const id = fixture.equipmentComponent('ISDoubleHeatSinkPrototype').id;
            expect(fixture.entity.bulkHeatSinkCount()).toBe(10);
            expect(projection().capacity).toBe(12);
            // On turn 1, until a move is assigned, the switch holds at once (the user's rule; Core p. 103).
            fixture.instance.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 1 });
            expect(fixture.instance.query().heatState()).toEqual(jasmine.objectContaining({ heatsinksOff: 1 }));
            expect(fixture.instance.query().heatState().heatsinksOffNext).toBeUndefined();
            // Once a move is assigned, turn 1 also switches in the End Phase.
            expect(fixture.instance.dispatch({ type: 'declare-mek-movement',
                declaration: { mode: 'stationary', distance: 0, boosterComponentIds: [] } }).changed).toBeTrue();
            fixture.instance.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 0 });
            expect(fixture.instance.query().heatState()).toEqual(jasmine.objectContaining({ heatsinksOff: 1, heatsinksOffNext: 0 }));
            fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' });
            expect(projection().capacity).toBe(12);
            fixture.instance.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 1 });
            expect(fixture.instance.query().heatState()).toEqual(jasmine.objectContaining({ heatsinksOff: 0, heatsinksOffNext: 1 }));
            expect(projection().capacity).toBe(12);
            expect(fixture.instance.dispatch({ type: 'set-component-mode', componentId: id, mode: 'disabling' }).changed).toBeTrue();
            expect(projection().capacity).toBe(12);
            // The pending switch survives a save before the End Phase.
            const pending = await restoreMekUnit(fixture.instance.serialize(), fixture.entity, fixture.identity,
                { profileId: 'pristine', deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset } });
            expect(pending.query().heatState().heatsinksOffNext).toBe(1);
            fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' });
            expect(fixture.instance.query().heatState().heatsinksOffNext).toBeUndefined();
            expect(projection().capacity).toBe(9);
            expect(projection().disabledSinkUnits).toBe(2);
            const restored = await restoreMekUnit(fixture.instance.serialize(), fixture.entity, fixture.identity,
                { profileId: 'pristine', deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset } });
            expect(restored.query().heatProjection()).toEqual(fixture.instance.query().heatProjection());
            restored.dispatch({ type: 'set-condition', condition: 'shutdown', active: true });
            expect(restored.dispatch({ type: 'set-component-mode', componentId: id, mode: 'enabling' }).changed).toBeTrue();
        });
    }
});

describe('restored heat-sink switch', () => {
    it('clamps the switch and its pending change to a design that lost heat sinks, dropping a change that no longer is one', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const bulk = fixture.entity.bulkHeatSinkCount();
        const saved = fixture.instance.serialize();
        const warnings: string[] = [];
        const restored = await restoreMekUnit({ ...saved, heat: { heat: 0, heatsinksOff: bulk + 5, heatsinksOffNext: bulk } },
            fixture.entity, fixture.identity,
            { profileId: 'pristine', deployment: { id: 'default' }, scenario: { id: 'megamek', ruleset: 'core-2026' } },
            undefined, { onWarning: warning => warnings.push(warning.code) });
        expect(restored.query().heatState()).toEqual(jasmine.objectContaining({ heatsinksOff: bulk }));
        expect(restored.query().heatState().heatsinksOffNext).toBeUndefined();
        expect(warnings).toContain('DAMAGE_CLAMPED');
    });
});

describe('prototype double heat sink switch timing', () => {
    it('switches a prototype double at once before the first move of the game, as the bulk switch does (Core p. 103)', () => {
        const fixture = createMixedHeatSinkFixture('core-2026');
        const projection = mekProjection(fixture);
        const id = fixture.equipmentComponent('ISDoubleHeatSinkPrototype').id;
        expect(projection().capacity).toBe(12);
        expect(fixture.instance.dispatch({ type: 'set-component-mode', componentId: id, mode: 'disabling' }).changed).toBeTrue();
        expect(fixture.instance.query().componentMode(id)).toBe('disabled');
        expect(projection().capacity).toBe(10);
    });
});

const NO_COMPONENTS = new Set<ReturnType<typeof asComponentId>>();
const NO_CRITICALS = new Set<never>();

/** The fixture's live heat projection. */
function mekProjection(fixture: DirectMekRuntimeFixture) {
    return () => {
        const result = fixture.instance.query().heatProjection();
        if (result.kind !== 'supported') throw new Error('Fixture heat must be supported');
        return result.projection;
    };
}

function heatProfile(fixture: DirectMekRuntimeFixture): MekHeatProfile {
    const result = compileMekHeatProfile(fixture.entity, fixture.index, 'core-2026');
    expect(result.kind).toBe('supported');
    if (result.kind !== 'supported') throw new Error(JSON.stringify(result.blockers));
    return result.profile;
}

function movementHeat(
    profile: MekHeatProfile,
    mode: NonNullable<MekMovementHeatFactsV2['movement']>['mode'],
    distance = mode === 'stationary' ? 0 : 1,
    options: Partial<Pick<MekMovementHeatFactsV2,
        'airborne' | 'conversionMode' | 'committedUnavailableComponents' | 'committedUnavailableCriticalSlots'>> = {},
): number {
    return projectMekMovementHeatV2(profile, {
        movement: { mode, distance },
        standAttempts: 0,
        airborne: options.airborne ?? false,
        ...(options.conversionMode === undefined ? {} : { conversionMode: options.conversionMode }),
        committedUnavailableComponents: options.committedUnavailableComponents ?? NO_COMPONENTS,
        committedUnavailableCriticalSlots: options.committedUnavailableCriticalSlots ?? NO_CRITICALS,
    });
}

function damageOneEngineCritical(fixture: DirectMekRuntimeFixture): void {
    const engine = [...fixture.index.components.entries()].find(([, component]) =>
        component.kind === 'system' && component.systemType === 'Engine');
    if (!engine) throw new Error('Fixture has no Engine system');
    const slot = [...fixture.index.slots.values()].find(candidate =>
        candidate.componentIds.includes(engine[0]));
    if (!slot) throw new Error('Fixture Engine has no critical slot');
    const result = fixture.instance.dispatch({
        type: 'hit-critical',


        slotId: slot.id,
        hits: 1,
        target: 'committed',
    });
    expect(result.accepted).toBeTrue();
}

function damagedEngineHeat(fixture: DirectMekRuntimeFixture): number | undefined {
    const result = fixture.instance.query().heatProjection();
    expect(result.kind).toBe('supported');
    if (result.kind !== 'supported') return undefined;
    return result.projection.committedSources.find(source => source.id === 'damaged-engine')?.value;
}

describe('origin/next Mek movement and engine heat parity', () => {
    it('keeps heat supported when force-wide mechanics options are synchronized', () => {
        expect(evaluateMekHeatScenarioSupport({
            id: 'megamek',
            options: { forcedWithdrawal: true, sprinting: true },
        })).toEqual({ kind: 'supported' });
    });

    it('still fails closed for malformed or unknown heat scenario options', () => {
        const malformed = evaluateMekHeatScenarioSupport({
            id: 'megamek',
            options: { sprinting: 'yes' },
        });
        const unknown = evaluateMekHeatScenarioSupport({
            id: 'megamek',
            options: { doubleHeat: true },
        });

        expect(malformed.kind).toBe('unsupported');
        expect(unknown.kind).toBe('unsupported');
    });

    it('derives ordinary and Industrial ground heat from the Entity engine descriptor', () => {
        const iceIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'ICE', true, 'core-2026', 'unit:heat:industrial-ice',
        ));
        const fuelIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'Fuel Cell', true, 'core-2026', 'unit:heat:industrial-fuel',
        ));
        const fusionIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'Fusion', true, 'core-2026', 'unit:heat:industrial-fusion',
        ));
        const xxlIndustrial = heatProfile(createDirectEngineHeatRuntimeFixture(
            'XXL', true, 'core-2026', 'unit:heat:industrial-xxl',
        ));
        const ordinaryIce = heatProfile(createDirectEngineHeatRuntimeFixture(
            'ICE', false, 'core-2026', 'unit:heat:ordinary-ice',
        ));

        expect([movementHeat(iceIndustrial, 'walk'), movementHeat(iceIndustrial, 'run')])
            .toEqual([0, 0]);
        expect([movementHeat(fuelIndustrial, 'walk'), movementHeat(fuelIndustrial, 'run')])
            .toEqual([0, 0]);
        expect([movementHeat(fusionIndustrial, 'walk'), movementHeat(fusionIndustrial, 'run')])
            .toEqual([1, 2]);
        expect([movementHeat(xxlIndustrial, 'walk'), movementHeat(xxlIndustrial, 'run')])
            .toEqual([4, 6]);
        expect([movementHeat(ordinaryIce, 'walk'), movementHeat(ordinaryIce, 'run')])
            .toEqual([1, 2]);
    });

    it('adds one UMU heat and doubles it only for an XXL engine', () => {
        const fusion = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:umu-fusion',
        ));
        const xxl = heatProfile(createDirectEngineHeatRuntimeFixture(
            'XXL', false, 'core-2026', 'unit:heat:umu-xxl',
        ));

        expect(movementHeat(fusion, 'UMU')).toBe(1);
        expect(movementHeat(xxl, 'UMU')).toBe(2);
    });

    it('uses one-third rounded jump heat for an AirMech flying, ground heat for one walking, and none for a fighter', () => {
        const profile = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:airmek-base',
        ));

        expect([1, 4, 5].map(distance => movementHeat(
            profile, 'run', distance, { airborne: true, conversionMode: 'airmek' },
        ))).toEqual([1, 1, 2]);
        expect(movementHeat(profile, 'run', 5, { conversionMode: 'airmek' })).toBe(2);
        // IO:AE p. 107: a fighter generates heat as an aerospace fighter, whose thrust generates none.
        expect(movementHeat(profile, 'run', 5, { airborne: true, conversionMode: 'fighter' })).toBe(0);
        expect(movementHeat(profile, 'walk', 1, { conversionMode: 'fighter' })).toBe(0);
    });

    it('uses a working jump booster only when no conventional jet is available', () => {
        const base = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:jump-system-base',
        ));
        const boosterId = asComponentId('component:test-jump-booster');
        const jetId = asComponentId('component:test-jump-jet');
        const boosterOnly = Object.freeze({
            ...base,
            jump: Object.freeze({
                ...base.jump,
                kind: 'none' as const,
                jets: Object.freeze([]),
                boosterComponentIds: Object.freeze([boosterId]),
            }),
        });
        const dual = Object.freeze({
            ...boosterOnly,
            jump: Object.freeze({
                ...boosterOnly.jump,
                kind: 'standard' as const,
                jets: Object.freeze([{ componentId: jetId, mpContribution: 1 }]),
            }),
        });

        expect(movementHeat(boosterOnly, 'jump', 5)).toBe(0);
        expect(movementHeat(dual, 'jump', 5)).toBe(5);
        expect(movementHeat(dual, 'jump', 5, {
            committedUnavailableComponents: new Set([jetId]),
        })).toBe(0);
    });

    it('derives jump heat from the engine and jet kind as MegaMek does', () => {
        const fusion = heatProfile(createDirectMekRuntimeFixture(
            'core-2026', 'unit:heat:jump-kind-fusion',
        ));
        const xxl = heatProfile(createDirectEngineHeatRuntimeFixture(
            'XXL', false, 'core-2026', 'unit:heat:jump-kind-xxl',
        ));
        const jetId = asComponentId('component:test-jump-jet');
        const withJets = (profile: MekHeatProfile, kind: 'standard' | 'improved' | 'prototype-improved') =>
            Object.freeze({ ...profile, jump: Object.freeze({ ...profile.jump, kind, jets: [{ componentId: jetId, mpContribution: 1 }] }) });
        const jumpHeat = (profile: MekHeatProfile) =>
            [1, 5].map(distance => movementHeat(profile, 'jump', distance));

        expect(jumpHeat(withJets(fusion, 'standard'))).toEqual([3, 5]);
        expect(jumpHeat(withJets(fusion, 'improved'))).toEqual([3, 3]);
        expect(jumpHeat(withJets(fusion, 'prototype-improved'))).toEqual([6, 10]);
        expect(jumpHeat(withJets(xxl, 'standard'))).toEqual([6, 10]);
        expect(jumpHeat(withJets(xxl, 'improved'))).toEqual([6, 6]);
        expect(jumpHeat(withJets(xxl, 'prototype-improved'))).toEqual([6, 20]);
    });

    it('adds outside heat such as infernos to the turn, capped at 15, and settles it at the end of the turn', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:outside');
        const projection = mekProjection(fixture);
        const outside = () => {
            const result = fixture.instance.query().heatProjection();
            return result.kind === 'supported'
                ? result.projection.committedSources.find(source => source.id === 'outside-heat')?.value
                : undefined;
        };

        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 1, target: 'elsewhere' as never }).changed)
            .toBeFalse();
        // A pending attack's heat counts now, and cancelling the attack before APPLY HEAT takes it back.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 10, target: 'pending' }).accepted).toBeTrue();
        expect(outside()).toBe(10);
        expect(fixture.instance.dispatch({ type: 'cancel-pending' }).accepted).toBeTrue();
        expect(outside()).toBeUndefined();
        // Pending and committed heat share the cap where it is read, so cancelling leaves the committed heat whole.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 10, target: 'pending' }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 10, target: 'committed' }).accepted).toBeTrue();
        expect(outside()).toBe(15);
        expect(fixture.instance.dispatch({ type: 'cancel-pending' }).accepted).toBeTrue();
        expect(outside()).toBe(10);
        // Committing keeps the pending part, within the cap.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 10, target: 'pending' }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'commit-pending' }).accepted).toBeTrue();
        expect(outside()).toBe(15);
        // APPLY HEAT keeps the turn's outside heat at the cap: another volley adds nothing.
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 20 }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).changed).toBeFalse();
        expect(projection().generated).toBe(0);
        const turn = canonicalizeMekTurnStateV2({ ...createPristineMekTurnStateV2(), outsideHeat: 15 });
        expect(deserializeMekTurnStateV2(serializeMekTurnStateV2(turn)).outsideHeat).toBe(15);

        expect(fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
        expect(outside()).toBeUndefined();
        expect(fixture.instance.query().heatState().current).toBe(20);
    });

    it('keeps an applied arrow at End Turn; the heat sinks left over cool only heat generated afterwards', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:arrow-ledger');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const projection = mekProjection(fixture);
        const fire = () => fixture.instance.dispatch({ type: 'fire-weapons', selections: [{ weaponId: laser.id }] });

        // A 3-heat laser against 10 sinks calculates to 0; the player's arrow says 5, and 7 sinks are left.
        expect(projection().capacity).toBe(10);
        expect(fire().accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 5 }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
        expect(projection().projected).toBe(5);
        expect(projection().hasPendingSettlement).toBeFalse();
        // 3 more heat arriving afterwards meets the 7 sinks left.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 3, target: 'committed' }).accepted)
            .toBeTrue();
        expect([projection().generated, projection().projected]).toEqual([3, 5]);
        expect(fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(5);
    });

    it('gives back the dissipation APPLY HEAT booked on a heat sink destroyed afterwards', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:lost-sink');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const sink = fixture.equipmentComponent('Heat Sink');
        const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.includes(sink.id))!;
        const projection = mekProjection(fixture);

        // 15 outside heat and a 3-heat laser use all 10 sinks: 8 heat.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'fire-weapons', selections: [{ weaponId: laser.id }] }).accepted).toBeTrue();
        expect(projection().projected).toBe(8);
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 8 }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
        // The destroyed sink cools nothing this turn, so the 1 heat it was booked for comes back.
        expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).accepted)
            .toBeTrue();
        expect([projection().capacity, projection().projected]).toEqual([9, 9]);
        expect(fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(9);
    });

    for (const follow of [true, false]) {
        it(`${follow ? 'moves NEXT by heat that arrives after it was set' : 'keeps NEXT the player’s own number'} ${
            follow ? 'while heat resolution calculates' : 'with heat resolution off'}`, () => {
            const fixture = createDirectMekRuntimeFixture('core-2026', `unit:heat:next-${follow}`);
            const projection = mekProjection(fixture);
            const next = () => fixture.instance.query().heatState().pendingOverride;

            // Nothing generated yet, so the calculation is 0 and NEXT at 8 is the player's +8.
            expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 8, follow }).accepted).toBeTrue();
            // 15 outside heat against 10 sinks calculates to 5.
            expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).accepted)
                .toBeTrue();
            expect(projection().projected).toBe(5);
            expect(next()).toBe(follow ? 13 : 8);
            // Once a move is assigned, heat sinks switched off wait for the End Phase (Core p. 103); a 3-heat laser moves
            // NEXT with the calculation.
            expect(fixture.instance.dispatch({ type: 'declare-mek-movement',
                declaration: { mode: 'stationary', distance: 0, boosterComponentIds: [] } }).accepted).toBeTrue();
            expect(fixture.instance.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 2 }).accepted).toBeTrue();
            expect(next()).toBe(follow ? 13 : 8);
            const laser = fixture.equipmentComponent('ISMediumLaser');
            expect(fixture.instance.dispatch({ type: 'fire-weapons', selections: [{ weaponId: laser.id }] }).accepted).toBeTrue();
            expect(next()).toBe(follow ? 16 : 8);
            // A NEXT tapped onto the calculation drops the adjustment.
            expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: projection().projected, follow }).accepted)
                .toBeTrue();
            expect(fixture.instance.query().heatState().pendingOffset).toBe(follow ? 0 : undefined);
        });
    }

    it('stores a following NEXT where it stands, so the sheet, a reload and APPLY HEAT all see the same value', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:next-apply-moved');
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 8, follow: true }).accepted).toBeTrue();
        // 15 outside heat against 10 sinks calculates to 5, so NEXT stands at 13: +8.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).accepted)
            .toBeTrue();
        expect(fixture.instance.snapshot().heat).toEqual(jasmine.objectContaining({ pendingOverride: 13, pendingOffset: 8 }));
        const sheet = projectMekRecordSheet(fixture.entity, fixture.index, fixture.instance.ruleset(),
            fixture.instance.snapshot(), fixture.instance.query(), emptyCBTEncounterSnapshot(), null, true, {});
        expect(sheet.heat.pendingOverride).toBe(13);
        // Setting NEXT where it already stands changes nothing.
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 13, follow: true }).changed).toBeFalse();
        expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(13);
    });

    it('keeps a NEXT held at 0 where the player set it when they set it there again', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:next-clamped');
        // 15 outside heat against 10 sinks calculates to 5; NEXT at 0 is the player's -5.
        expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).accepted)
            .toBeTrue();
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 0, follow: true }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 0, follow: true }).changed).toBeFalse();
        expect(fixture.instance.query().heatState()).toEqual(jasmine.objectContaining({ pendingOverride: 0, pendingOffset: -5 }));
    });

    it('treats clearing a NEXT that is not set as no change', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:next-clear-absent');
        const revision = fixture.instance.snapshot().stateRevision;
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: null }).changed).toBeFalse();
        expect(fixture.instance.snapshot().stateRevision).toBe(revision);
    });

    it('ends the turn on a following NEXT exactly where APPLY HEAT at the time would have', () => {
        const ending = (applyFirst: boolean) => {
            const fixture = createDirectMekRuntimeFixture('core-2026', `unit:heat:next-apply-${applyFirst}`);
            expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 8, follow: true }).accepted).toBeTrue();
            if (applyFirst) expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
            expect(fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' }).accepted)
                .toBeTrue();
            expect(fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
            return fixture.instance.query().heatState().current;
        };
        expect([ending(false), ending(true)]).toEqual([13, 13]);
    });

    it('counts only the heat a settled source adds afterwards', () => {
        const fixture = createDirectEngineHeatRuntimeFixture('Fusion', false, 'core-2026', 'unit:heat:engine-ledger');
        const projection = mekProjection(fixture);
        const engine = [...fixture.index.components.values()]
            .find(component => component.kind === 'system' && component.systemType === 'Engine')!;
        const [first, second] = [...fixture.index.slots.values()].filter(slot => slot.componentIds.includes(engine.id));
        const hit = (slotId: typeof first.id) =>
            fixture.instance.dispatch({ type: 'hit-critical', slotId, hits: 1, target: 'committed' });

        expect(hit(first!.id).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: projection().projected }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
        // A second engine hit makes the engine 10 heat, 5 of it settled already.
        expect(hit(second!.id).accepted).toBeTrue();
        const engineHeat = (sources: readonly { id: string; value: number }[]) =>
            sources.find(source => source.id === 'damaged-engine')?.value;
        expect(engineHeat(projection().committedSources)).toBe(10);
        expect(engineHeat(projection().sources)).toBe(5);
    });

    it('gives back booked dissipation the unit can no longer cool, keeping heat tracking', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:over-booked');
        const state = fixture.instance.snapshot();
        // APPLY HEAT booked 30 before a refit left the unit 10 sinks.
        const turn = canonicalizeMekTurnStateV2({ ...state.turn, heatDissipationConsumed: 30 });
        const scenario = { id: 'megamek' };
        const prepared = createMekRuntimeBinding(fixture.entity, fixture.index, 'core-2026', { ...state, turn }, undefined,
            createMekHeatContextV2(fixture.entity, fixture.index, 'core-2026', scenario),
            createMekMechanicsContextV2(fixture.entity, fixture.index, 'core-2026', scenario));
        const result = queryMekRuntime(prepared.binding, prepared.state).heatProjection();
        expect(result.kind === 'supported' && [result.projection.capacity, result.projection.projected]).toEqual([10, 20]);
    });

    it('keeps the heat of a pending attack once APPLY HEAT applied it, even when the attack is cancelled', () => {
        const fixture = createDirectMekRuntimeFixture('core-2026', 'unit:heat:applied-pending');
        const projection = mekProjection(fixture);
        const attack = () => fixture.instance.dispatch({ type: 'add-outside-heat', amount: 15, target: 'pending' });

        // 15 outside heat against 10 sinks: 5.
        expect(attack().accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: 5 }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({ type: 'cancel-pending' }).accepted).toBeTrue();
        expect([fixture.instance.query().heatState().current, projection().projected]).toEqual([5, 5]);
        // The attack entered again adds nothing the player already applied.
        expect(attack().accepted).toBeTrue();
        expect(projection().projected).toBe(5);
    });

    it('adds the heat of a charged capacitor once when its PPC fires after APPLY HEAT settled the charge', () => {
        const fire = (applyFirst: boolean) => {
            const fixture = createDirectMekRuntimeFixture('core-2026', `unit:heat:ppc-${applyFirst}`);
            const weapon = fixture.equipmentComponent('Test PPC');
            const capacitor = fixture.equipmentComponent('Test PPC Capacitor');
            const turn = () => fixture.instance.query().turnState();
            expect(fixture.instance.dispatch({ type: 'set-ppc-capacitor-charge', capacitorId: capacitor.id,
                weaponId: weapon.id, state: PPC_CAPACITOR_CHARGING_STATE }).accepted).toBeTrue();
            expect(fixture.instance.dispatch({ type: 'end-turn', policy: 'automatic' }).accepted).toBeTrue();
            if (applyFirst) {
                expect(fixture.instance.dispatch({ type: 'set-pending-heat', heat: mekProjection(fixture)().projected })
                    .accepted).toBeTrue();
                expect(fixture.instance.dispatch({ type: 'apply-heat' }).accepted).toBeTrue();
            }
            // The panel and the fire plan add what `ppcCapacitorFiringHeat` says.
            const capacitorHeat = ppcCapacitorFiringHeat(turn(), weapon.id);
            const before = turn().weaponsHeat;
            expect(fixture.instance.dispatch({ type: 'fire-weapons', selections: [{ weaponId: weapon.id }] }).accepted)
                .toBeTrue();
            return { capacitorHeat, weaponsHeat: turn().weaponsHeat - before };
        };
        const unsettled = fire(false);
        const settled = fire(true);

        expect([unsettled.capacitorHeat, settled.capacitorHeat]).toEqual([5, 0]);
        expect(unsettled.weaponsHeat - settled.weaponsHeat).toBe(5);
    });

    it('generates damaged-engine heat only for fusion-family Entity engines', () => {
        const fusion = createDirectEngineHeatRuntimeFixture(
            'Fusion', false, 'core-2026', 'unit:heat:engine-fusion',
        );
        const ice = createDirectEngineHeatRuntimeFixture(
            'ICE', true, 'core-2026', 'unit:heat:engine-ice',
        );

        damageOneEngineCritical(fusion);
        damageOneEngineCritical(ice);

        expect(damagedEngineHeat(fusion)).toBe(5);
        expect(damagedEngineHeat(ice)).toBeUndefined();
    });
});
