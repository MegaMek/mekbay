// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION, type MekMovementModeV2 } from './mek-movement-psr-v2';
import { projectMekTurnPanel } from './mek-turn-panel';
import {
    createDirectMekRuntimeFixture,
    createDirectTracksRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

/** Total Warfare p. 143, Tracks. The Core Rulebook has no tracks, so both rulesets play them the same way. */
describe('Mek tracked movement', () => {
    const rulesets: readonly CBTRuleset[] = ['total-warfare', 'core-2026'];

    it('offers Tracked only to a Mek that mounts tracks', () => {
        expect(action(createDirectMekRuntimeFixture('total-warfare'), 'tracked').legal).toBeFalse();
        expect(movement(createDirectMekRuntimeFixture('total-warfare')).trackedMp).toBe(0);
    });

    for (const ruleset of rulesets) {
        it(`${ruleset}: gives Track MP equal to the Walking MP, with no Running MP, on a standing Mek`, () => {
            const fixture = createDirectTracksRuntimeFixture(ruleset);
            const walk = movement(fixture).walkMp;
            expect(walk).toBeGreaterThan(1);
            expect(movement(fixture).trackedMp).toBe(walk);
            expect(action(fixture, 'tracked')).toEqual(jasmine.objectContaining({ legal: true, maximumMp: walk }));
            expect(declare(fixture, 'tracked', walk + 1)).toBeFalse();
            expect(declare(fixture, 'tracked', walk)).toBeTrue();

            const prone = createDirectTracksRuntimeFixture(ruleset);
            expect(prone.instance.dispatch({ type: 'set-condition', condition: 'prone', active: true }).accepted).toBeTrue();
            expect(action(prone, 'tracked').reasons.map(reason => reason.code)).toContain('PRONE');
        });

        it(`${ruleset}: slows Track MP for a lost track, not for a leg actuator hit`, () => {
            const fixture = createDirectTracksRuntimeFixture(ruleset);
            const walk = movement(fixture).walkMp;
            hit(fixture, systemSlot(fixture, 'Upper Leg Actuator', 'LL'));
            expect(movement(fixture).walkMp).toBeLessThan(walk);
            expect(movement(fixture).trackedMp).toBe(walk);

            // Each of a biped's two tracks carries half of the Track MP.
            hit(fixture, trackSlot(fixture, 'LL'));
            expect(movement(fixture).trackedMp).toBe(Math.floor(walk / 2));
            hit(fixture, trackSlot(fixture, 'RL'));
            expect(movement(fixture).trackedMp).toBe(0);
            expect(action(fixture, 'tracked').legal).toBeFalse();
        });

        it(`${ruleset}: makes no roll for a leg actuator or gyro hit while moving on tracks, but still for 20 damage`, () => {
            const reasons = (mode: MekMovementModeV2) => {
                const fixture = createDirectTracksRuntimeFixture(ruleset);
                expect(declare(fixture, mode, 1)).toBeTrue();
                hit(fixture, systemSlot(fixture, 'Upper Leg Actuator', 'LL'));
                hit(fixture, systemSlot(fixture, 'Hip', 'RL'));
                hit(fixture, systemSlot(fixture, 'Gyro'));
                return fixture.instance.query().mekPilotChecks().map(check => check.source.triggerKind).sort();
            };
            expect(reasons('walk')).toEqual(['gyro-hit', 'hip-hit', 'leg-actuator-hit']);
            expect(reasons('tracked')).toEqual([]);

            const fixture = createDirectTracksRuntimeFixture(ruleset);
            expect(declare(fixture, 'tracked', 1)).toBeTrue();
            let remaining = 20;
            for (const face of fixture.index.armorFaces.values()) {
                const amount = Math.min(remaining, face.maximumPoints);
                if (amount <= 0) continue;
                expect(fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount, target: 'committed' })
                    .accepted).toBeTrue();
                remaining -= amount;
            }
            expect(remaining).toBe(0);
            expect(fixture.instance.query().mekPilotChecks().map(check => check.source.triggerKind))
                .toEqual(['damage-total-20']);
        });

        it(`${ruleset}: does not fall when its gyro is destroyed in a turn it moves on tracks`, () => {
            const falls = (mode: MekMovementModeV2) => {
                const fixture = createDirectTracksRuntimeFixture(ruleset);
                expect(declare(fixture, mode, 1)).toBeTrue();
                for (const slot of systemSlots(fixture, 'Gyro').slice(0, 2)) hit(fixture, slot);
                return fixture.instance.query().mekMovementPsrState().automaticFalls.map(fall => fall.triggerKind);
            };
            expect(falls('walk')).toEqual(['gyro-destroyed']);
            expect(falls('tracked')).toEqual([]);
        });

        it(`${ruleset}: heats and attacks as a Mek that walked`, () => {
            const heat = (mode: MekMovementModeV2) => {
                const fixture = createDirectTracksRuntimeFixture(ruleset);
                expect(declare(fixture, mode, 2)).toBeTrue();
                const projection = fixture.instance.query().heatProjection('manual');
                if (projection.kind !== 'supported') throw new Error('Tracks fixture heat is unsupported');
                return projection.projection.committedSources.find(source => source.id === 'movement')?.value;
            };
            expect(heat('tracked')).toBe(heat('walk'));
            expect(heat('tracked')).toBeGreaterThan(0);

            const fixture = createDirectTracksRuntimeFixture(ruleset);
            const panel = projectMekTurnPanel(fixture.entity, fixture.index, fixture.instance.ruleset(),
                fixture.instance.query(), 'manual');
            expect(panel.attackMovementModifiers.tracked).toBe(panel.attackMovementModifiers.walk);
        });
    }
});

function movement(fixture: DirectMekRuntimeFixture) {
    const projected = fixture.instance.query().mekMovementPsr();
    if (projected.kind !== 'supported') throw new Error('Tracks fixture movement is unsupported');
    return projected;
}

function action(fixture: DirectMekRuntimeFixture, kind: MekMovementModeV2) {
    return movement(fixture).actions.find(candidate => candidate.kind === kind)!;
}

function declare(fixture: DirectMekRuntimeFixture, mode: MekMovementModeV2, distance: number): boolean {
    return fixture.instance.dispatch({
        type: 'declare-mek-movement',
        declaration: { schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION, mode, distance, boosterComponentIds: [] },
    }).changed;
}

function locationCode(fixture: DirectMekRuntimeFixture, slot: { readonly locationId: unknown }): string | undefined {
    return [...fixture.index.locations.values()].find(location => location.id === slot.locationId)?.code;
}

function systemSlots(fixture: DirectMekRuntimeFixture, systemType: string, code?: string) {
    return [...fixture.index.slots.values()].filter(slot => slot.componentIds.some(componentId => {
        const component = fixture.index.components.get(componentId);
        return component?.kind === 'system' && component.systemType === systemType;
    }) && (code === undefined || locationCode(fixture, slot) === code));
}

function systemSlot(fixture: DirectMekRuntimeFixture, systemType: string, code?: string) {
    const slot = systemSlots(fixture, systemType, code)[0];
    if (!slot) throw new Error(`Tracks fixture has no ${systemType} slot`);
    return slot;
}

function trackSlot(fixture: DirectMekRuntimeFixture, code: string) {
    const slot = [...fixture.index.slots.values()].find(candidate => locationCode(fixture, candidate) === code
        && candidate.componentIds.some(componentId => {
            const component = fixture.index.components.get(componentId);
            return component?.kind === 'equipment' && component.mount.equipmentId === 'Test Tracks';
        }));
    if (!slot) throw new Error(`Tracks fixture has no track in ${code}`);
    return slot;
}

function hit(fixture: DirectMekRuntimeFixture, slot: { readonly id: Parameters<typeof hitCommand>[0] }): void {
    expect(fixture.instance.dispatch(hitCommand(slot.id)).accepted).toBeTrue();
}

function hitCommand(slotId: ReturnType<typeof systemSlot>['id']) {
    return { type: 'hit-critical', slotId, hits: 1, target: 'committed' } as const;
}
