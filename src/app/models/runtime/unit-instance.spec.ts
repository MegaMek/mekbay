// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectPrototypeLaserRuntimeFixture,
    createDirectShieldRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';
import { asEncounterTargetId, type TargetRegistrySnapshot } from './encounter-runtime';

describe('CBTUnitInstance with a direct MekEntity', () => {
    it('uses the exact runtime index supplied by its admission owner', () => {
        const fixture = createDirectMekRuntimeFixture();

        expect(fixture.instance.getIndex()).toBe(fixture.index);
    });

    it('accepts an empty phase boundary so history can advance independently of damage', () => {
        const { instance } = createDirectMekRuntimeFixture();

        const result = instance.dispatch({
            type: 'end-phase',


        });

        expect(result.accepted).toBeTrue();
        expect(instance.query().stateRevision).toBe(1);
    });

    it('defers a sixth-wound death until the phase boundary', () => {
        const { instance, index } = createDirectMekRuntimeFixture();
        const pilotId = [...index.crewPositions.keys()][0]!;

        expect(instance.query().hasPendingPhaseChanges()).toBeFalse();
        expect(instance.dispatch({
            type: 'set-crew-state',
            positionId: pilotId,
            wounds: 6,
            unconscious: true,
            ejected: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const pendingCrew = instance.query().crewState(pilotId);
        expect(pendingCrew).toEqual(jasmine.objectContaining({
            wounds: 6,
            unconscious: true,
            ejected: true,
        }));
        expect(pendingCrew.dead).toBeUndefined();
        expect(instance.query().hasPendingPhaseChanges()).toBeTrue();
        expect(instance.query().hasCondition('abandoned')).toBeTrue();

        expect(instance.dispatch({ type: 'end-phase' }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(instance.query().crewState(pilotId)).toEqual(jasmine.objectContaining({
            wounds: 6,
            dead: true,
            unconscious: true,
            ejected: true,
        }));
        expect(instance.query().hasPendingPhaseChanges()).toBeFalse();
        expect(instance.query().hasCondition('abandoned')).toBeTrue();

        expect(instance.dispatch({
            type: 'set-crew-state',
            positionId: pilotId,
            wounds: 5,
            unconscious: true,
            ejected: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const repairedCrew = instance.query().crewState(pilotId);
        expect(repairedCrew).toEqual(jasmine.objectContaining({
            unconscious: true,
            ejected: true,
        }));
        expect(repairedCrew.dead).toBeUndefined();

        expect(instance.dispatch({
            type: 'set-crew-state',
            positionId: pilotId,
            wounds: 5,
            unconscious: false,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(instance.query().hasCondition('abandoned')).toBeFalse();
    });

    it('keeps the entity pristine while two sparse runtimes diverge', () => {
        const fixture = createDirectMekRuntimeFixture();
        const first = fixture.instance;
        const second = fixture.createInstance('unit:second');
        const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;
        const location = fixture.index.locations.get(face.locationId)!;
        const pristineArmor = fixture.entity.getArmorValue(location.code, face.face);

        expect(first.dispatch({
            type: 'damage-armor',


            faceId: face.id,
            amount: 1,
            target: 'committed',
        }).accepted).toBeTrue();

        expect(first.query().remainingArmor(face.id)).toBe(face.maximumPoints - 1);
        expect(second.query().remainingArmor(face.id)).toBe(face.maximumPoints);
        expect(fixture.entity.getArmorValue(location.code, face.face)).toBe(pristineArmor);
        expect(first.snapshot().locations.size).toBe(1);
        expect(second.snapshot().locations.size).toBe(0);
    });

    it('separates pending damage from committed state and commits it atomically', () => {
        const { instance, index } = createDirectMekRuntimeFixture();
        const face = [...index.armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;

        expect(instance.dispatch({
            type: 'damage-armor',
            faceId: face.id, amount: 1, target: 'pending',
        }).accepted).toBeTrue();
        expect(instance.query().remainingArmor(face.id, 'committed')).toBe(face.maximumPoints);
        expect(instance.query().remainingArmor(face.id, 'preview')).toBe(face.maximumPoints - 1);

        expect(instance.dispatch({
            type: 'commit-pending',

        }).accepted).toBeTrue();
        expect(instance.query().remainingArmor(face.id, 'committed')).toBe(face.maximumPoints - 1);
        expect(instance.snapshot().pendingCombat.armorDamage.size).toBe(0);
    });

    it('commits pending damage before requiring its newly-created Piloting Skill Roll', () => {
        const { instance, index } = createDirectMekRuntimeFixture('total-warfare');
        const slot = [...index.slots.values()].find(candidate =>
            index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;

        expect(instance.dispatch({
            type: 'hit-critical',


            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(instance.query().mekPilotChecks()).toEqual([]);

        const committed = instance.dispatch({
            type: 'end-phase',


        });
        expect(committed.accepted).toBeTrue();
        expect(instance.query().criticalHits(slot.id, 'committed')).toBe(1);
        const check = instance.query().mekPilotChecks()[0]!;
        expect(check).toEqual(jasmine.objectContaining({
            reason: 'Leg Actuator hit',
            status: 'pending',
        }));

        expect(instance.dispatch({
            type: 'end-phase',


        })).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
        }));
        expect(instance.dispatch({
            type: 'resolve-mek-pilot-check',


            checkId: check.checkId,
            evidence: { dice: [6, 6], claimedOutcome: 'success' },
        }).accepted).toBeTrue();
        expect(instance.dispatch({
            type: 'end-phase',


        }).accepted).toBeTrue();
        expect(instance.query().mekPilotChecks()).toEqual([]);
    });

    it('previews a phase boundary without committing pending damage or advancing revision', () => {
        const { instance, index } = createDirectMekRuntimeFixture('total-warfare');
        const slot = [...index.slots.values()].find(candidate =>
            index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(instance.dispatch({
            type: 'hit-critical',


            slotId: slot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const revision = instance.query().stateRevision;

        const preview = instance.query().previewEndPhase();

        expect(preview.accepted).toBeTrue();
        if (!preview.accepted) return;
        expect(preview.state.stateRevision).toBe(revision + 1);
        expect(preview.state.movementPsr.checks).toContain(jasmine.objectContaining({
            reason: 'Leg Actuator hit',
            status: 'pending',
        }));
        expect(instance.query().stateRevision).toBe(revision);
        expect(instance.query().criticalHits(slot.id, 'committed')).toBe(0);
        expect(instance.query().criticalHits(slot.id, 'preview')).toBe(1);
        expect(instance.query().mekPilotChecks()).toEqual([]);
    });

    it('commits a pending reattachment without treating it as internal damage', () => {
        const { instance, index } = createDirectMekRuntimeFixture();
        const leg = [...index.locations.values()].find(location => location.code === 'LL')!;

        expect(instance.dispatch({
            type: 'set-location-condition',


            locationId: leg.id,
            condition: 'blown-off',
            value: 1,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(instance.dispatch({
            type: 'set-location-condition',


            locationId: leg.id,
            condition: 'blown-off',
            value: 0,
            target: 'pending',
        }).accepted).toBeTrue();

        const committed = instance.dispatch({
            type: 'end-phase',


        });

        expect(committed.accepted).toBeTrue();
        expect(instance.query().locationCondition(leg.id, 'blown-off', 'committed')).toBe(0);
        expect(instance.query().mekPilotChecks()).toEqual([]);
    });

    it('uses actual mount IDs for mode, ammunition, status, and current BV', () => {
        const { instance, index } = createDirectMekRuntimeFixture();
        const ac = [...index.components.values()].find(component =>
            component.kind === 'equipment' && component.mount.equipmentId === 'Test AC')!;
        const ammo = [...index.components.values()].find(component =>
            component.kind === 'equipment' && component.mount.equipmentId === 'Test Ammo')!;
        const laser = [...index.components.values()].find(component =>
            component.kind === 'equipment' && component.mount.equipmentId === 'ISMediumLaser')!;
        if (ac.kind !== 'equipment' || ammo.kind !== 'equipment' || laser.kind !== 'equipment') {
            throw new Error('Fixture equipment is missing');
        }
        expect(ac.id).toBe(ac.mount.mountId);
        expect(ammo.id).toBe(ammo.mount.mountId);

        const pristineBv = instance.query().mekBattleValue();
        expect(pristineBv.kind).toBe('complete');
        expect(instance.dispatch({
            type: 'set-component-mode',
            componentId: ac.id, mode: 'Rapid',
        }).accepted).toBeTrue();
        expect(instance.query().componentMode(ac.id)).toBe('Rapid');
        expect(instance.dispatch({
            type: 'spend-ammo',
            componentId: ammo.id, amount: 3,
        }).accepted).toBeTrue();
        expect(instance.query().remainingAmmo(ammo.id)).toBe(17);
        expect(instance.dispatch({
            type: 'set-component-status',
            componentId: laser.id,
            status: 'destroyed', target: 'committed',
        }).accepted).toBeTrue();
        expect(instance.query().componentStatus(laser.id)).toBe('destroyed');

        const damagedBv = instance.query().mekBattleValue();
        expect(damagedBv.kind).toBe('complete');
        if (pristineBv.kind === 'complete' && damagedBv.kind === 'complete') {
            expect(damagedBv.battleValue).toBeLessThan(pristineBv.battleValue);
        }
    });

    it('projects an untouched full-ammunition unit at its pristine entity BV', () => {
        const { instance, entity } = createDirectMekRuntimeFixture();
        const projected = instance.query().mekBattleValue();

        expect(projected.kind).toBe('complete');
        if (projected.kind === 'complete') {
            expect(projected.battleValue).toBe(entity.battleValue());
        }
    });

    it('keeps BV movement independent from intact shield and modular-armor mobility modes', () => {
        for (const fixture of [
            createDirectShieldRuntimeFixture(),
            createDirectModularArmorRuntimeFixture(),
        ]) {
            expect(fixture.instance.query().currentBaseBattleValue())
                .withContext(fixture.entity.displayName())
                .toBe(fixture.entity.battleValue());
        }
    });

    it('applies each command to the current state', () => {
        const { instance, index } = createDirectMekRuntimeFixture();
        const face = [...index.armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;
        const command = {
            type: 'damage-armor' as const,
            faceId: face.id,
            amount: 1,
            target: 'committed' as const,
        };
        const first = instance.dispatch(command);
        const second = instance.dispatch(command);
        expect(first).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(second).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(instance.query().remainingArmor(face.id, 'committed')).toBe(face.maximumPoints - 2);
    });

    it('binds both production rulesets without changing the entity', () => {
        const core = createDirectMekRuntimeFixture('core-2026');
        const totalWar = createDirectMekRuntimeFixture('total-warfare');
        expect(core.instance.ruleset()).toBe('core-2026');
        expect(totalWar.instance.ruleset()).toBe('total-warfare');
        expect(core.entity.displayName()).toBe(totalWar.entity.displayName());
    });

    it('clears movement and its pending checks when airborne state changes', () => {
        const { instance } = createDirectMekRuntimeFixture();
        expect(instance.dispatch({
            type: 'declare-mek-movement',


            declaration: {
                schemaVersion: 1,
                mode: 'walk',
                distance: 1,
                boosterComponentIds: [],
            },
        }).accepted).toBeTrue();
        expect(instance.query().mekMovementPsrState().movement?.mode).toBe('walk');

        const currentTurn = instance.query().turnState();
        expect(instance.dispatch({
            type: 'replace-turn-state',


            turn: { ...currentTurn, airborne: true },
        }).accepted).toBeTrue();

        const state = instance.query().mekMovementPsrState();
        expect(instance.query().turnState().airborne).toBeTrue();
        expect(state.movement).toBeNull();
        expect(state.checks.filter(check => check.source.sourceKind === 'movement')).toEqual([]);
    });

    it('keeps an automatic fall distinct from prone until the phase boundary', () => {
        const { instance, index } = createDirectMekRuntimeFixture();
        const leg = [...index.locations.values()].find(location => location.code === 'LL')!;

        expect(instance.dispatch({
            type: 'damage-internal',


            locationId: leg.id,
            amount: leg.internalPoints,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(instance.query().mekMovementPsrState().automaticFalls).toEqual([
            jasmine.objectContaining({
                triggerKind: 'leg-destroyed-auto-fall',
                locationIds: [leg.id],
            }),
        ]);
        expect(instance.query().hasCondition('prone')).toBeFalse();

        expect(instance.dispatch({
            type: 'end-phase',


        }).accepted).toBeTrue();
        expect(instance.query().mekMovementPsrState().automaticFalls.length).toBe(1);
        expect(instance.query().hasCondition('prone')).toBeTrue();
        expect(instance.dispatch({
            type: 'dismiss-mek-automatic-falls',


        }).accepted).toBeTrue();
        if (instance.query().mekPilotChecks().some(check => check.status === 'pending')) {
            expect(instance.dispatch({
                type: 'dismiss-mek-pilot-checks',


            }).accepted).toBeTrue();
        }
        const resolvedBoundary = instance.dispatch({
            type: 'end-phase',


        });
        expect(resolvedBoundary.accepted).withContext(JSON.stringify(resolvedBoundary)).toBeTrue();
        expect(instance.query().mekMovementPsrState().automaticFalls).toEqual([]);
    });

    it('explicitly dismisses pending pilot checks before a boundary', () => {
        const { instance, index } = createDirectMekRuntimeFixture('total-warfare');
        const slot = [...index.slots.values()].find(candidate =>
            index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(instance.dispatch({
            type: 'hit-critical',

            slotId: slot.id, hits: 1, target: 'committed',
        }).accepted).toBeTrue();
        const check = instance.query().mekPilotChecks()[0]!;
        expect(check.status).toBe('pending');

        expect(instance.dispatch({
            type: 'dismiss-mek-pilot-checks',

            checkIds: [check.checkId],
        }).accepted).toBeTrue();
        expect(instance.query().mekPilotChecks()).toEqual([]);
    });

    it('uses the selected rapid-fire mode for heat and ammunition', () => {
        const fixture = createDirectMekRuntimeFixture();
        const ac = fixture.equipmentComponent('Test AC');
        const ammo = fixture.equipmentComponent('Test Ammo');

        expect(fixture.instance.dispatch({
            type: 'set-component-mode',


            componentId: ac.id,
            mode: 'Rapid',
        }).accepted).toBeTrue();
        const munitionKey = fixture.instance.query().ammoLoadout(ammo.id).munitionKey;
        expect(fixture.instance.dispatch({
            type: 'fire-weapons',


            heatPolicy: 'manual',
            selections: [{
                weaponId: ac.id,
                ammoSourceId: ammo.id,
                expectedMunitionKey: munitionKey,
            }],
        }).accepted).toBeTrue();

        expect(fixture.instance.query().turnState().weaponsHeat).toBe(2);
        expect(fixture.instance.query().remainingAmmo(ammo.id)).toBe(18);
    });

    it('adds deterministic prototype-laser heat and rejects missing die evidence', () => {
        const fixture = createDirectPrototypeLaserRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumPulseLaserPrototype');
        const fired = fixture.instance.dispatch({
            type: 'fire-weapons',


            heatPolicy: 'manual',
            selections: [{ weaponId: laser.id }],
            prototypeHeatRolls: [{ weaponId: laser.id, roll: 6 }],
        });

        expect(fired.accepted).toBeTrue();
        if (!fired.accepted) return;
        expect(fired.prototypeHeat).toEqual([{
            weaponId: laser.id,
            roll: 6,
            additionalHeat: 6,
            detail: '1D6 roll: 6',
        }]);
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(10);

        const missing = createDirectPrototypeLaserRuntimeFixture(
            'core-2026',
            'unit:prototype-missing-evidence',
        );
        const missingLaser = missing.equipmentComponent('ISMediumPulseLaserPrototype');
        expect(missing.instance.dispatch({
            type: 'fire-weapons',


            heatPolicy: 'manual',
            selections: [{ weaponId: missingLaser.id }],
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(missing.instance.query().turnState().weaponsHeat).toBe(0);
    });

    it('applies an explicit heat correction without consuming automatic turn heat', () => {
        const fixture = createDirectMekRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');

        expect(fixture.instance.dispatch({
            type: 'set-heat',
            heat: 10,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'fire-weapons',
            heatPolicy: 'automatic',
            selections: [{ weaponId: laser.id }],
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'set-pending-heat',
            heat: 23,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'apply-heat',
            policy: 'automatic',
        }).accepted).toBeTrue();

        expect(fixture.instance.query().heatState()).toEqual(jasmine.objectContaining({
            current: 23,
            previous: 10,
        }));
        expect(fixture.instance.query().heatState().pendingOverride).toBeUndefined();
        expect(fixture.instance.query().turnState().weaponsHeat).toBeGreaterThan(0);
        expect(fixture.instance.query().turnState().acknowledgedHeatSources.size).toBe(0);
    });

    it('uses the calculated projection instead of an unapplied target at automatic end-turn', () => {
        const fixture = createDirectMekRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');

        expect(fixture.instance.dispatch({
            type: 'set-heat',
            heat: 10,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'fire-weapons',
            heatPolicy: 'automatic',
            selections: [{ weaponId: laser.id }],
        }).accepted).toBeTrue();
        const projected = fixture.instance.query().heatProjection('automatic');
        if (projected.kind !== 'supported') throw new Error('Fixture heat must be supported');
        expect(fixture.instance.dispatch({
            type: 'set-pending-heat',
            heat: 25,
        }).accepted).toBeTrue();

        expect(fixture.instance.dispatch({
            type: 'end-turn',
            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(projected.projection.projected);
        expect(fixture.instance.query().heatState().current).not.toBe(25);
        expect(fixture.instance.query().heatState().pendingOverride).toBeUndefined();
    });

    it('leaves calculated heat caller-owned when automatic heat is disabled', () => {
        const fixture = createDirectMekRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');

        expect(fixture.instance.dispatch({
            type: 'set-heat',
            heat: 10,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'fire-weapons',
            heatPolicy: 'manual',
            selections: [{ weaponId: laser.id }],
        }).accepted).toBeTrue();

        expect(fixture.instance.dispatch({
            type: 'end-turn',
            policy: 'manual',
        }).accepted).toBeTrue();
        expect(fixture.instance.query().heatState().current).toBe(10);
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(0);
    });

    it('rejects an illegal target in the direct V2 command boundary', () => {
        const fixture = createDirectMekRuntimeFixture();
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const targetId = asEncounterTargetId('target:indirect');
        const registry: TargetRegistrySnapshot = Object.freeze({
            revision: 0,
            targets: Object.freeze([Object.freeze({
                id: targetId,
                letter: 'A',
                name: 'Indirect target',
                color: '#123456',
                unitType: 'mek-biped' as const,
            })]),
        });

        expect(fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',



            edit: {
                kind: 'set-target-facts',
                targetId,
                facts: { calculator: { indirectFire: true } },
            },
        }, registry, false).accepted).toBeTrue();

        expect(fixture.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',



            edit: {
                kind: 'set-component-selection',
                componentId: laser.id,
                selection: { kind: 'target', targetId },
            },
        }, registry, false)).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
        }));
        expect(fixture.instance.query().attackerTargetingState().components.get(laser.id)).toBeUndefined();
    });
});
