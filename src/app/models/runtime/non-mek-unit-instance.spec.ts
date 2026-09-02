// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestBipedMekEntity,
    TestDropShipEntity,
    TestInfantryEntity,
    TestJumpShipEntity,
    TestProtoMekEntity,
    TestTankEntity,
    TestWarShipEntity,
} from '../entity/testing/test-entities';
import {
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../entity/testing/test-mounted-equipment';
import { asEncounterTargetId, type TargetRegistrySnapshot } from './encounter-runtime';
import { type InstanceBaselineRef } from './runtime-state';
import {
    canNonMekTakeActiveActions,
    createPristineNonMekUnitState,
    effectiveNonMekCrewState,
    nonMekAttackMovementModifier,
    NonMekUnitInstance,
    projectNonMekDefenseModifierBreakdown,
    projectNonMekEndTurnHeat,
    projectNonMekEscalatingFailureInteractions,
    projectNonMekMovementCapabilities,
} from './non-mek-unit-instance';
import { createDefaultCrewAssignment } from './crew-assignment';
import {
    NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
    inspectSerializedNonMekUnit,
    restoreNonMekUnit,
    serializeNonMekUnit,
} from './non-mek-unit-persistence';
import { serializeAttackerTargetingState } from './attacker-targeting-state';
import { nonMekDamageTrackId } from '../rules/non-mek-damage-track-rules';
import { componentIdForMount } from './non-mek-runtime-index';
import { MountedEngine } from '../entity/components/engine';
import {
    BOOBY_TRAP_ARMED_MODE,
    BOOBY_TRAP_DETONATED_MODE,
} from './component-booby-trap';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

describe('NonMekUnitInstance', () => {
    it('binds every non-Mek family directly to its concrete entity', () => {
        const entities: BaseEntity[] = [
            new TestTankEntity(),
            new TestInfantryEntity(),
            new TestProtoMekEntity(),
            new TestAeroSpaceFighterEntity(),
            new TestJumpShipEntity(),
        ];

        for (const entity of entities) {
            entity.uuid.set(UUID);
            const runtime = new NonMekUnitInstance(
                `unit:${entity.entityType}`,
                baseline(),
                entity,
                CORE_2026_RULESET,
            );

            expect(runtime.getUnit()).toBe(entity);
            expect(runtime.matchesEntity(entity)).toBeTrue();
        }
    });

    it('persists the distinction between pending and committed crew death', () => {
        const entity = new TestProtoMekEntity();
        entity.uuid.set(UUID);
        const runtime = new NonMekUnitInstance(
            'unit:deferred-crew-death',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;
        const deployment = {
            schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
            values: {
                id: 'deployment:deferred-crew-death',
                crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            },
        } as const;

        expect(runtime.dispatch({
            kind: 'set-crew-state',
            positionId,
            wounds: 6,
            unconscious: true,
            ejected: true,
            killed: false,
            stunned: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().hasPendingPhaseChanges()).toBeTrue();
        expect(effectiveNonMekCrewState(runtime.snapshot().crew.get(positionId))).toBe('ejected');

        const pendingSave = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment,
        });
        expect(pendingSave.crewState?.[0]?.dead).toBeUndefined();
        const pendingRestore = restoreNonMekUnit(pendingSave, entity);
        const pendingCrew = pendingRestore.query().crewState(positionId);
        expect(pendingCrew).toEqual(jasmine.objectContaining({
            unconscious: true,
            ejected: true,
        }));
        expect(pendingCrew.dead).toBeUndefined();
        expect(effectiveNonMekCrewState(pendingRestore.snapshot().crew.get(positionId))).toBe('ejected');

        expect(pendingRestore.dispatch({ kind: 'end-phase' }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(pendingRestore.query().crewState(positionId)).toEqual(jasmine.objectContaining({
            dead: true,
            unconscious: true,
            ejected: true,
        }));
        expect(pendingRestore.query().hasPendingPhaseChanges()).toBeFalse();
        expect(effectiveNonMekCrewState(pendingRestore.snapshot().crew.get(positionId))).toBe('dead');

        const committedSave = serializeNonMekUnit({
            instance: pendingRestore,
            uuid: baseline().entity,
            deployment,
        });
        expect(committedSave.crewState?.[0]?.dead).toBeTrue();
        const committedRestore = restoreNonMekUnit(committedSave, entity);
        expect(committedRestore.query().crewState(positionId).dead).toBeTrue();
        expect(committedRestore.dispatch({
            kind: 'set-crew-state',
            positionId,
            wounds: 5,
            unconscious: true,
            ejected: true,
            killed: false,
            stunned: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const repairedCrew = committedRestore.query().crewState(positionId);
        expect(repairedCrew).toEqual(jasmine.objectContaining({
            unconscious: true,
            ejected: true,
        }));
        expect(repairedCrew.dead).toBeUndefined();
    });

    it('derives airborne and grounded conditions only for a selectable air state', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        const runtime = new NonMekUnitInstance(
            'unit:air-ground-conditions',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );

        expect(runtime.conditions()).not.toContain('airborne');
        expect(runtime.conditions()).not.toContain('grounded');
        expect(runtime.dispatch({
            kind: 'set-airborne',

            airborne: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.hasCondition('grounded')).toBeTrue();
        expect(runtime.hasCondition('airborne')).toBeFalse();

        expect(runtime.dispatch({
            kind: 'set-airborne',

            airborne: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.hasCondition('airborne')).toBeTrue();
        expect(runtime.hasCondition('grounded')).toBeFalse();
        expect(runtime.dispatch({
            kind: 'set-condition',

            condition: 'grounded',
            active: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const jumpShip = new TestJumpShipEntity();
        jumpShip.uuid.set(UUID);
        const spaceOnly = new NonMekUnitInstance(
            'unit:airborne-only-conditions',
            baseline(),
            jumpShip,
            CORE_2026_RULESET,
        );
        expect(spaceOnly.turnState().airborne).toBeTrue();
        expect(spaceOnly.conditions()).not.toContain('airborne');
        expect(spaceOnly.conditions()).not.toContain('grounded');

        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        const groundOnly = new NonMekUnitInstance(
            'unit:ground-only-conditions',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        expect(groundOnly.turnState().airborne).toBeNull();
        expect(groundOnly.conditions()).not.toContain('airborne');
        expect(groundOnly.conditions()).not.toContain('grounded');
        expect(groundOnly.dispatch({
            kind: 'set-airborne',

            airborne: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
    });

    it('applies the shared delayed power lifecycle to non-Mek searchlights and minesweepers', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const searchlight = addTestEquipmentWithFlags(entity, 'F_SEARCHLIGHT', {
            location: entity.locationOrder[0],
        });
        const minesweeper = addTestEquipmentWithFlags(entity, 'F_MINESWEEPER', {
            location: entity.locationOrder[0],
        });
        const runtime = new NonMekUnitInstance(
            'unit:tank-delayed-power',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const searchlightId = componentIdForMount(searchlight);
        const minesweeperId = componentIdForMount(minesweeper);

        expect(runtime.componentMode(searchlightId)).toBe('enabled');
        expect(runtime.componentMode(minesweeperId)).toBe('enabled');
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: searchlightId,
            mode: 'disabled',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: searchlightId,
            mode: 'disabling',
        }).accepted).toBeTrue();
        expect(runtime.componentMode(searchlightId)).toBe('disabling');
        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.componentMode(searchlightId)).toBe('disabled');

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: searchlightId,
            mode: 'enabling',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.componentMode(searchlightId)).toBe('enabled');
        expect(runtime.snapshot().components.has(searchlightId)).toBeFalse();
    });

    it('keeps ProtoMek EI fixed while allowing vehicle EI power switching', () => {
        const protoMek = new TestProtoMekEntity();
        protoMek.uuid.set(UUID);
        const protoEi = addTestEquipmentWithFlags(protoMek, 'F_EI_INTERFACE', {
            location: 'Torso',
        });
        const protoRuntime = new NonMekUnitInstance(
            'unit:protomek-ei',
            baseline(),
            protoMek,
            CORE_2026_RULESET,
        );
        expect(protoRuntime.componentMode(componentIdForMount(protoEi))).toBeUndefined();
        expect(protoRuntime.dispatch({
            kind: 'set-component-mode',

            componentId: componentIdForMount(protoEi),
            mode: 'disabling',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        const vehicleEi = addTestEquipmentWithFlags(tank, 'F_EI_INTERFACE', {
            location: tank.locationOrder[0],
        });
        const tankRuntime = new NonMekUnitInstance(
            'unit:tank-ei',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        expect(tankRuntime.componentMode(componentIdForMount(vehicleEi))).toBe('enabled');
    });

    it('hands a non-Mek active probe to the last selected mount at End Turn', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const first = addTestEquipmentWithFlags(entity, 'F_BAP', {
            location: entity.locationOrder[0],
        });
        const second = addTestEquipmentWithFlags(entity, 'F_BAP', {
            location: entity.locationOrder[0],
        });
        const runtime = new NonMekUnitInstance(
            'unit:tank-probe-handoff',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const firstId = componentIdForMount(first);
        const secondId = componentIdForMount(second);

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: secondId,
            mode: 'enabling',
        }).accepted).toBeTrue();
        expect(runtime.componentMode(firstId)).toBe('enabled');
        expect(runtime.componentMode(secondId)).toBe('enabling');

        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.componentMode(firstId)).toBe('disabled');
        expect(runtime.componentMode(secondId)).toBe('enabled');
    });

    it('stores damage sparsely and resolves current values against the entity', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        entity.setArmorValue(entity.locationOrder[0], 'front', 2);
        const runtime = new NonMekUnitInstance(
            'unit:tank',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0];
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0])!;

        const internal = runtime.dispatch({
            kind: 'set-internal-damage',

            locationId: location.id,
            damage: Math.min(1, location.internalPoints),
        });
        const armor = runtime.dispatch({
            kind: 'set-armor-damage',

            faceId: face.id,
            damage: Math.min(1, face.maximumPoints),
        });

        expect(internal.accepted).toBeTrue();
        expect(armor.accepted).toBeTrue();
        expect(runtime.query().remainingInternal(location.id)).toBe(
            location.internalPoints - Math.min(1, location.internalPoints),
        );
        expect(runtime.query().remainingArmor(face.id)).toBe(
            face.maximumPoints - Math.min(1, face.maximumPoints),
        );
        expect(runtime.snapshot().locations.size).toBe(1);
    });

    it('stores and round-trips vehicle killed/stunned crew state sparsely', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const runtime = new NonMekUnitInstance(
            'unit:tank-crew-state',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;

        expect(runtime.dispatch({
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: false,
            stunned: true,
        }).accepted).toBeTrue();
        expect(runtime.query().hasPendingPhaseChanges()).toBeTrue();
        expect(effectiveNonMekCrewState(runtime.snapshot().crew.get(positionId))).toBe('stunned');

        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:tank-crew-state',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.crewState).toEqual([{
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            stunned: true,
        }]);
        const restored = restoreNonMekUnit(saved, entity);
        expect(restored.snapshot().crew.get(positionId)?.stunned).toBeTrue();

        expect(restored.dispatch({
            kind: 'set-crew-state',
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: true,
            stunned: true,
        }).accepted).toBeTrue();
        expect(effectiveNonMekCrewState(restored.snapshot().crew.get(positionId))).toBe('killed');
        expect(restored.dispatch({
            kind: 'set-crew-state',
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: false,
            stunned: true,
        }).accepted).toBeTrue();
        expect(effectiveNonMekCrewState(restored.snapshot().crew.get(positionId))).toBe('stunned');

        const reset = restored.dispatch({
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: false,
            stunned: false,
        });
        expect(reset).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(restored.snapshot().crew.has(positionId)).toBeFalse();
        expect(restored.dispatch({
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: false,
            stunned: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(restored.dispatch({ kind: 'end-phase' }).accepted).toBeTrue();
        expect(restored.query().hasPendingPhaseChanges()).toBeFalse();
    });

    it('exposes effective vehicle rules through the direct runtime query surface', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.originalWalkMP.set(8);
        const runtime = new NonMekUnitInstance(
            'unit:tank-effective-rules',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: true,
            stunned: false,
        });

        expect(runtime.conditions()).toEqual(['abandoned', 'immobile']);
        expect(runtime.hasCondition('immobile')).toBeTrue();
        expect(runtime.stateView().movement).toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));

        runtime.dispatch({
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: false,
            stunned: false,
        });
        runtime.dispatch({
            kind: 'damage-track',

            damageTrackId: nonMekDamageTrackId('engine_hit_1'),
            amount: 1,
            target: 'committed',
            timestamp: 1,
        });

        expect(runtime.conditions()).toEqual([]);
        expect(runtime.stateView()).toEqual(jasmine.objectContaining({
            engineHits: 1,
            movement: jasmine.objectContaining({ walk: 0, run: 0 }),
        }));
    });

    it('scopes projected Non-Mek rules to one immutable query revision', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const runtime = new NonMekUnitInstance(
            'unit:tank-query-projection-scope',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const before = runtime.query();
        expect(before.destroyed()).toBeFalse();

        expect(runtime.dispatch({
            kind: 'set-destroyed',

            destroyed: true,
        }).accepted).toBeTrue();

        const after = runtime.query();
        expect(after.stateRevision).not.toBe(before.stateRevision);
        expect(before.destroyed()).toBeFalse();
        expect(after.destroyed()).toBeTrue();
    });

    it('keeps phase-tracked Entity damage pending until combat is committed', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        entity.setArmorValue(entity.locationOrder[0], 'front', 3);
        const runtime = new NonMekUnitInstance(
            'unit:tank-pending',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0];
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0])!;

        expect(runtime.dispatch({
            kind: 'damage-armor',

            faceId: face.id,
            amount: 2,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.query().remainingArmor(face.id)).toBe(3);
        expect(runtime.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(2);

        expect(runtime.dispatch({
            kind: 'repair-armor',

            faceId: face.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(1);

        expect(runtime.dispatch({
            kind: 'damage-internal',

            locationId: location.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-phase',

        }).accepted).toBeTrue();
        expect(runtime.query().remainingArmor(face.id)).toBe(2);
        expect(runtime.query().remainingInternal(location.id)).toBe(location.internalPoints - 1);
        expect(runtime.snapshot().pendingCombat.armorDamage.size).toBe(0);
        expect(runtime.snapshot().pendingCombat.locationInternalDamage.size).toBe(0);
        expect(runtime.turnState().endTurnCheckpoint).toBeUndefined();
    });

    it('owns vehicle movement, semantic phase boundaries, and turn reset directly', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(60);
        entity.originalWalkMP.set(8);
        const booster = addTestEquipmentWithFlags(entity, ['F_MASC', 'S_SUPERCHARGER']);
        const boosterComponentId = componentIdForMount(booster);
        const runtime = new NonMekUnitInstance(
            'unit:tank-turn',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'run', distance: 16, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            kind: 'edit-escalating-failure',

            componentId: boosterComponentId,
            edit: { kind: 'select-sequence', index: 0 },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'run', distance: 16, boosterComponentIds: [boosterComponentId] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.turnState().movement).toEqual({
            mode: 'run',
            distance: 16,
            boosterComponentIds: [boosterComponentId],
        });
        expect(runtime.turnState().phaseStateChanged).toBeTrue();

        const beforePhase = runtime.revision();
        expect(runtime.dispatch({
            kind: 'end-phase',

        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(Number(runtime.revision())).toBe(Number(beforePhase) + 1);
        expect(runtime.turnState().movement?.distance).toBe(16);
        expect(runtime.turnState().phaseStateChanged).toBeFalse();

        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:tank-turn',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.turn).toEqual({
            movement: { mode: 'run', distance: 16, boosterComponentIds: [boosterComponentId] },
        });
        const restored = restoreNonMekUnit(saved, entity);
        expect(restored.turnState()).toEqual(runtime.turnState());

        expect(restored.dispatch({
            kind: 'end-turn',

        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(restored.snapshot().components.get(boosterComponentId)?.escalatingFailure).toEqual({
            sequence: 1,
        });
        expect(restored.turnState()).toEqual({
            turnCounter: 1,
            airborne: null,
            movement: null,
            weaponsHeat: 0,
            cover: null,
            spotting: false,
            phaseStateChanged: false,
        });
    });

    it('owns origin/next cover, spotting, and defense summary state in the Entity runtime', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(40);
        entity.originalWalkMP.set(4);
        const runtime = new NonMekUnitInstance(
            'unit:tank-turn-summary',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        expect(runtime.dispatch({
            kind: 'set-cover',

            cover: 'building-1',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.dispatch({
            kind: 'set-spotting',

            spotting: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));

        expect(runtime.turnState()).toEqual(jasmine.objectContaining({
            cover: 'building-1',
            spotting: true,
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        }));
        expect(projectNonMekDefenseModifierBreakdown(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        )).toEqual([
            { label: 'Moved 3-4 hexes', modifier: 1 },
        ]);

        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:tank-turn-summary',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.turn).toEqual({
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
            cover: 6,
            spotting: true,
            phaseStateChanged: true,
        });
        expect(restoreNonMekUnit(saved, entity).turnState()).toEqual(runtime.turnState());

        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.turnState()).toEqual(jasmine.objectContaining({
            cover: null,
            spotting: false,
        }));
    });

    it('round-trips durable End Turn progress and clears it with the completed turn', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(40);
        const runtime = new NonMekUnitInstance(
            'unit:tank-end-turn-checkpoint',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        expect(runtime.dispatch({
            kind: 'end-phase',

            endTurnBoundary: true,
        }).accepted).toBeTrue();
        expect(runtime.turnState().endTurnCheckpoint).toBe('phase-ended');
        expect(runtime.dispatch({
            kind: 'mark-end-turn-heat-staged',

        }).accepted).toBeTrue();

        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:tank-end-turn-checkpoint',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.turn).toEqual({ endTurnCheckpoint: 'heat-staged' });
        const restored = restoreNonMekUnit(saved, entity);
        expect(restored.turnState().endTurnCheckpoint).toBe('heat-staged');
        expect(restored.dispatch({
            kind: 'end-turn',

            heatPolicy: 'manual',
        }).accepted).toBeTrue();
        expect(restored.turnState().endTurnCheckpoint).toBeUndefined();
    });

    it('round-trips due crew and aerospace Control recovery without an in-memory timer', () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.uuid.set(UUID);
        entity.heatSinkCount.set(10);
        const runtime = new NonMekUnitInstance(
            'unit:aero-durable-recovery',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const pilotId = [...runtime.getIndex().crewPositions.keys()][0]!;
        expect(runtime.dispatch({
            kind: 'set-condition',

            condition: 'out-of-control',
            active: true,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-control-recovery',

            workflow: { readyTurn: 1, cause: 'heat-random-movement' },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
            recoveryReadyTurn: 1,
        }).accepted).toBeTrue();

        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:aero-durable-recovery',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.turn?.controlRecovery).toEqual({
            readyTurn: 1,
            cause: 'heat-random-movement',
        });
        expect(saved.crewState?.[0]?.recoveryReadyTurn).toBe(1);

        const restored = restoreNonMekUnit(saved, entity);
        expect(restored.turnState().controlRecovery).toEqual(saved.turn?.controlRecovery);
        expect(restored.query().crewState(pilotId).recoveryReadyTurn).toBe(1);
        for (let turn = 1; turn <= 2; turn += 1) {
            expect(restored.dispatch({
                kind: 'end-turn',

                heatPolicy: 'manual',
            }).accepted).toBeTrue();
            expect(restored.turnState().turnCounter).toBe(turn);
            expect(restored.turnState().controlRecovery).toEqual(saved.turn?.controlRecovery);
        }
        expect(restored.dispatch({
            kind: 'set-condition',

            condition: 'out-of-control',
            active: false,
        }).accepted).toBeTrue();
        expect(restored.turnState().controlRecovery).toBeUndefined();
    });

    it('matches origin/next attacker movement badges by loaded Entity family', () => {
        expect(nonMekAttackMovementModifier(new TestTankEntity(), 'run')).toBe(2);
        expect(nonMekAttackMovementModifier(new TestProtoMekEntity(), 'jump')).toBe(3);
        expect(nonMekAttackMovementModifier(new TestInfantryEntity(), 'walk')).toBe(0);
        expect(nonMekAttackMovementModifier(new TestAeroSpaceFighterEntity(), 'run')).toBe(0);
    });

    it('denies active turn actions without a live controller and permits a drone controller', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.originalWalkMP.set(4);
        const runtime = new NonMekUnitInstance(
            'unit:tank-no-controller',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;

        expect(runtime.dispatch({
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: true,
            stunned: false,
        }).accepted).toBeTrue();
        expect(canNonMekTakeActiveActions(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        )).toBeFalse();
        expect(projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        )).toEqual(jasmine.objectContaining({
            canTakeActiveActions: false,
            maximum: jasmine.objectContaining({ walk: 0, run: 0, jump: 0 }),
        }));
        expect(runtime.dispatch({
            kind: 'set-spotting',

            spotting: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'walk', distance: 1, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const droneEntity = new TestTankEntity();
        droneEntity.uuid.set(UUID);
        droneEntity.originalWalkMP.set(4);
        addTestEquipmentWithFlags(droneEntity, 'F_DRONE_OPERATING_SYSTEM');
        const droneRuntime = new NonMekUnitInstance(
            'unit:tank-drone-controller',
            baseline(),
            droneEntity,
            CORE_2026_RULESET,
        );
        const droneCrewPositionId = [...droneRuntime.getIndex().crewPositions.keys()][0]!;
        expect(droneRuntime.dispatch({
            kind: 'set-crew-state',

            positionId: droneCrewPositionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            killed: true,
            stunned: false,
        }).accepted).toBeTrue();
        expect(canNonMekTakeActiveActions(
            droneEntity,
            droneRuntime.getIndex(),
            droneRuntime.snapshot(),
            CORE_2026_RULESET,
        )).toBeTrue();
        expect(droneRuntime.dispatch({
            kind: 'set-spotting',

            spotting: true,
        }).accepted).toBeTrue();
    });

    it('owns ProtoMek myomer-booster risk, movement, failure, and recovery state', () => {
        const entity = new TestProtoMekEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(6);
        entity.originalWalkMP.set(6);
        const booster = addTestEquipmentWithFlags(entity, 'F_MASC', { location: 'Torso' });
        const boosterId = componentIdForMount(booster);
        const runtime = new NonMekUnitInstance(
            'unit:proto-turn',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        let capabilities = projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        );
        expect(capabilities.ordinaryRun).toBe(9);
        expect(capabilities.maximum.run).toBe(9);
        expect(capabilities.boosterComponentIds).toEqual([]);
        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'run', distance: 12, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        const interaction = projectNonMekEscalatingFailureInteractions(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            'turn-summary',
        )[0]!;
        expect(interaction.choices.map(choice => choice.shortLabel)).toEqual([
            '3+', '5+', '7+', '10+', '11+', '✖',
        ]);
        expect(runtime.dispatch({
            kind: 'edit-escalating-failure',

            componentId: boosterId,
            edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        capabilities = projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        );
        expect(capabilities.maximum.run).toBe(12);
        expect(capabilities.boosterComponentIds).toEqual([boosterId]);
        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'run', distance: 12, boosterComponentIds: [boosterId] },
        }).accepted).toBeTrue();

        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(boosterId)?.escalatingFailure).toEqual({ sequence: 1 });
        expect(projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        ).maximum.run).toBe(9);
        expect(runtime.dispatch({
            kind: 'edit-escalating-failure',

            componentId: boosterId,
            edit: { kind: 'set-status', status: 'disabled' },
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(boosterId)).toEqual(jasmine.objectContaining({
            statusOverride: 'disabled',
            escalatingFailure: { sequence: 1 },
        }));
        expect(runtime.dispatch({
            kind: 'edit-escalating-failure',

            componentId: boosterId,
            edit: { kind: 'set-status', status: 'available' },
        }).accepted).toBeTrue();

        const crewId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',

            positionId: crewId,
            wounds: 0,
            unconscious: true,
            ejected: false,
            killed: false,
            stunned: false,
        });
        capabilities = projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        );
        expect(capabilities.maximum).toEqual({
            stationary: 0,
            walk: 0,
            run: 0,
            sprint: 0,
            jump: 0,
            UMU: 0,
            VTOL: 0,
        });
    });

    it('preserves the Total Warfare Blue Shield exemption for aerospace fighters', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        const blueShield = addTestEquipmentWithFlags(fighter, 'F_BLUE_SHIELD', { location: 'Nose' });
        const componentId = componentIdForMount(blueShield);
        const totalWarfare = new NonMekUnitInstance(
            'unit:tw-blue-shield',
            Object.freeze({ ...baseline(), ruleset: TOTAL_WARFARE_RULESET }),
            fighter,
            TOTAL_WARFARE_RULESET,
        );

        expect(projectNonMekEscalatingFailureInteractions(
            fighter,
            totalWarfare.getIndex(),
            totalWarfare.snapshot(),
            TOTAL_WARFARE_RULESET,
        )).toEqual([]);
        expect(totalWarfare.dispatch({
            kind: 'edit-escalating-failure',
            componentId,
            edit: { kind: 'select-sequence', index: 0 },
        }).changed).toBeFalse();

        const core = new NonMekUnitInstance(
            'unit:core-blue-shield',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        expect(projectNonMekEscalatingFailureInteractions(
            fighter,
            core.getIndex(),
            core.snapshot(),
            CORE_2026_RULESET,
        ).length).toBe(1);
    });

    it('keeps component hits pending and configures compatible non-Mek ammunition atomically', () => {
        const standard = new AmmoEquipment({
            id: 'Ammo_AC_10',
            name: 'AC/10 Ammo',
            type: 'ammo',
            ammo: { type: 'AC', rackSize: 10, shots: 10 },
        });
        const precision = new AmmoEquipment({
            id: 'Ammo_AC_10_Precision',
            name: 'AC/10 Precision Ammo',
            type: 'ammo',
            ammo: { type: 'AC', rackSize: 10, shots: 10, munitionType: ['M_PRECISION'] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({
            [standard.id]: standard,
            [precision.id]: precision,
        }));
        entity.uuid.set(UUID);
        const mount = addTestEquipment(entity, standard, {
            location: entity.locationOrder[0],
            shotsCount: 10,
        });
        const runtime = new NonMekUnitInstance(
            'unit:tank-equipment',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0];
        expect(String(componentId)).toBe(String(mount.mountId));

        expect(runtime.dispatch({
            kind: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();
        expect(runtime.snapshot().pendingCombat.componentStatus.get(componentId)).toBe('destroyed');

        expect(runtime.dispatch({
            kind: 'end-phase',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(componentId)?.statusOverride).toBe('destroyed');

        expect(runtime.dispatch({
            kind: 'configure-ammo-source',

            componentId,
            munitionKey: precision.id,
            remaining: 3,
        }).accepted).toBeTrue();
        expect(runtime.snapshot().ammo.get(componentId)).toEqual({
            shotsSpent: 7,
            munitionOverride: precision.id,
        });
        expect(runtime.query().remainingAmmo(componentId)).toBe(3);
    });

    it('ignores catalog-authored modes when no runtime behavior owns them', () => {
        const weapon = new WeaponEquipment({
            id: 'TestEntityWeapon',
            name: 'Test Entity Weapon',
            type: 'weapon',
            modes: ['Single', 'Rapid'],
            weapon: { damage: 5, heat: 1, ranges: [3, 6, 9, 12] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [weapon.id]: weapon }));
        entity.uuid.set(UUID);
        addTestEquipment(entity, weapon, { location: entity.locationOrder[0] });
        const runtime = new NonMekUnitInstance(
            'unit:tank-unowned-mode',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0]!;
        expect(runtime.componentMode(componentId)).toBeUndefined();
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId,
            mode: 'Rapid',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();

        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:tank-unowned-mode',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        const restored = restoreNonMekUnit({
            ...saved,
            componentState: Object.freeze([Object.freeze({ componentId, mode: 'Rapid' })]),
        }, entity);
        expect(restored.componentMode(componentId)).toBeUndefined();
        expect(restored.snapshot().components.has(componentId)).toBeFalse();
    });

    it('stores only a non-default mode owned by the UAC/RAC behavior', () => {
        const weapon = new WeaponEquipment({
            id: 'TestUltraAutocannon',
            name: 'Test Ultra Autocannon',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            modes: ['Single', 'Ultra'],
            weapon: {
                ammoType: 'AC_ULTRA',
                rackSize: 5,
                damage: 5,
                heat: 1,
                ranges: [3, 6, 9, 12],
            },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [weapon.id]: weapon }));
        entity.uuid.set(UUID);
        addTestEquipment(entity, weapon, { location: entity.locationOrder[0] });
        const runtime = new NonMekUnitInstance(
            'unit:tank-uac-mode',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0]!;
        expect(runtime.componentMode(componentId)).toBe('Single');

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId,
            mode: 'Ultra',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(componentId)?.mode).toBe('Ultra');
        expect(runtime.componentMode(componentId)).toBe('Ultra');

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId,
            mode: 'Single',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();
        expect(runtime.componentMode(componentId)).toBe('Single');

        runtime.dispatch({
            kind: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'pending',
        });
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId,
            mode: 'Ultra',
        }).accepted).toBeTrue();
        runtime.dispatch({ kind: 'end-phase'});
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId,
            mode: 'Single',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
    });

    it('derives an unedited non-Mek MML mode from compatible installed ammunition', () => {
        const weapon = new WeaponEquipment({
            id: 'TestMML7',
            name: 'Test MML 7',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: {
                ammoType: 'MML',
                rackSize: 7,
                damage: 'cluster',
                heat: 4,
                ranges: [3, 6, 9, 12],
            },
        });
        const ammunition = new AmmoEquipment({
            id: 'TestMML7LRMAmmo',
            name: 'Test MML 7 LRM Ammo',
            type: 'ammo',
            flags: ['F_MML_LRM'],
            ammo: { type: 'MML', rackSize: 7, shots: 17 },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({
            [weapon.id]: weapon,
            [ammunition.id]: ammunition,
        }));
        entity.uuid.set(UUID);
        const weaponMount = addTestEquipment(entity, weapon, { location: entity.locationOrder[0] });
        addTestEquipment(entity, ammunition, {
            location: entity.locationOrder[0],
            shotsCount: 17,
        });
        const runtime = new NonMekUnitInstance(
            'unit:tank-mml-mode',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = componentIdForMount(weaponMount);

        expect(runtime.componentMode(componentId)).toBe('LRM');
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId,
            mode: 'SRM',
        }).accepted).toBeTrue();
        expect(runtime.componentMode(componentId)).toBe('SRM');
    });

    it('owns vehicle weapon targeting and exact ammunition preference in sparse runtime state', () => {
        const fixture = targetingFixture('unit:tank-targeting');

        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-ammo',
                componentId: fixture.weaponId,
                ammo: {
                    munitionKey: fixture.ammo.internalName,
                    preferredSourceId: fixture.ammoId,
                },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));

        expect(fixture.runtime.query().attackerTargetingState().components.get(fixture.weaponId)).toEqual({
            selection: { kind: 'target', targetId: fixture.targetId },
            ammo: {
                munitionKey: fixture.ammo.internalName,
                preferredSourceId: fixture.ammoId,
            },
        });
    });

    it('applies grouped weapon selection and damage in one revision each', () => {
        const weapon = new WeaponEquipment({
            id: 'GroupedEnergyWeapon',
            name: 'Grouped Energy Weapon',
            type: 'weapon',
            weapon: { damage: 5, heat: 3, ranges: [3, 6, 9, 12] },
        });
        const entity = new TestDropShipEntity(createTestEquipmentRegistry({ [weapon.id]: weapon }));
        entity.uuid.set(UUID);
        const mounts = Array.from({ length: 4 }, () =>
            addTestEquipment(entity, weapon, { location: entity.locationOrder[0] }));
        const componentIds = mounts.map(componentIdForMount);
        const runtime = new NonMekUnitInstance(
            'unit:dropship-grouped-command',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const registry = Object.freeze({
            revision: 0,
            targets: Object.freeze([]),
        });
        const selectionRevision = runtime.revision();

        expect(runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selections',
                componentIds,
                selection: { kind: 'selected' },
            },
        }, registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.revision()).toBe(selectionRevision + 1);
        expect(componentIds.map(componentId => runtime.query().attackerTargetingState()
            .components.get(componentId)?.selection)).toEqual(Array.from(
                { length: 4 },
                () => ({ kind: 'selected' }),
            ));

        const damageRevision = runtime.revision();
        expect(runtime.dispatch({
            kind: 'set-component-statuses',

            componentIds,
            status: 'destroyed',
            target: 'pending',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.revision()).toBe(damageRevision + 1);
        expect(componentIds.map(componentId => runtime.componentStatus(componentId, 'preview')))
            .toEqual(['destroyed', 'destroyed', 'destroyed', 'destroyed']);
    });

    it('fires selected non-Mek weapons through the Entity owner and consumes exact ammunition', () => {
        const fixture = targetingFixture('unit:tank-fire');
        for (const edit of [{
            kind: 'set-component-selection' as const,
            componentId: fixture.weaponId,
            selection: { kind: 'target' as const, targetId: fixture.targetId },
        }, {
            kind: 'set-component-ammo' as const,
            componentId: fixture.weaponId,
            ammo: {
                munitionKey: fixture.ammo.internalName,
                preferredSourceId: fixture.ammoId,
            },
        }]) {
            expect(fixture.runtime.dispatchAttackerTargeting({
                kind: 'edit-attacker-targeting',


                edit,
            }, fixture.registry, false).accepted).toBeTrue();
        }

        const result = fixture.runtime.dispatchSelectedWeaponFire({
            type: 'fire-selected-weapons',



            heatPolicy: 'automatic',
        }, fixture.registry, false, false);

        expect(result).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.runtime.query().remainingAmmo(fixture.ammoId)).toBe(9);
        expect(fixture.runtime.turnState().weaponsHeat).toBe(0);
    });

    it('uses maximum prototype-laser heat for aerospace fire without die evidence', () => {
        const weapon = new WeaponEquipment({
            id: 'ISMediumPulseLaserPrototype',
            name: 'Prototype Medium Pulse Laser',
            type: 'weapon',
            weapon: { damage: 6, heat: 4, ranges: [2, 4, 6, 8], av: [6, 0, 0, 0] },
        });
        const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({
            [weapon.id]: weapon,
        }));
        entity.uuid.set(UUID);
        entity.heatSinkCount.set(10);
        const mount = addTestEquipment(entity, weapon, { location: 'Nose' });
        const runtime = new NonMekUnitInstance(
            'unit:aero-prototype-fire',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const weaponId = componentIdForMount(mount);
        const targetId = asEncounterTargetId('target:aero-prototype');
        const registry: TargetRegistrySnapshot = Object.freeze({
            revision: 0,
            targets: Object.freeze([Object.freeze({
                id: targetId,
                letter: 'A',
                name: 'Target A',
                color: '#ff0000',
                source: 'manual' as const,
                readOnly: false,
            })]),
        });
        expect(runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: weaponId,
                selection: { kind: 'target', targetId },
            },
        }, registry, false).accepted).toBeTrue();

        const result = runtime.dispatchSelectedWeaponFire({
            type: 'fire-selected-weapons',



            heatPolicy: 'automatic',
        }, registry, false, false);

        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            prototypeHeat: [],
        }));
        expect(runtime.turnState().weaponsHeat).toBe(10);
    });

    it('keeps a pending-destroyed vehicle weapon actionable until phase commit', () => {
        const fixture = targetingFixture('unit:tank-targeting-destroyed');
        fixture.runtime.dispatch({
            kind: 'set-component-status',

            componentId: fixture.weaponId,
            status: 'destroyed',
            target: 'pending',
        });

        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: true,
        }));
        fixture.runtime.dispatch({ kind: 'end-phase'});
        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
        }));
    });

    it('rejects weapon selection after the Non-Mek runtime is destroyed', () => {
        const fixture = targetingFixture('unit:tank-targeting-unit-destroyed');
        expect(fixture.runtime.dispatch({
            kind: 'set-destroyed',

            destroyed: true,
        }).accepted).toBeTrue();

        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: false,
        }));
    });

    it('reconciles deleted targets before the force commits its target registry', () => {
        const fixture = targetingFixture('unit:tank-targeting-reconcile');
        fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false);
        fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',


            edit: {
                kind: 'set-target-facts',
                targetId: fixture.targetId,
                facts: { distance: 8 },
            },
        }, fixture.registry, false);
        const before = fixture.runtime.revision();
        const plan = fixture.runtime.planAttackerTargetingReconciliation(Object.freeze({
            revision: 1,
            targets: Object.freeze([]),
        }));

        expect(plan).not.toBeNull();
        fixture.runtime.installAttackerTargetingReconciliation(plan!);
        expect(Number(fixture.runtime.revision())).toBe(Number(before) + 1);
        expect(fixture.runtime.query().attackerTargetingState().components.has(fixture.weaponId)).toBeFalse();
        expect(fixture.runtime.query().attackerTargetingState().targets.has(fixture.targetId)).toBeFalse();
    });

    it('round-trips Entity targeting through the current force wire format', () => {
        const fixture = targetingFixture('unit:tank-targeting-persistence');
        for (const edit of [{
            kind: 'set-component-selection' as const,
            componentId: fixture.weaponId,
            selection: { kind: 'target' as const, targetId: fixture.targetId },
        }, {
            kind: 'set-component-ammo' as const,
            componentId: fixture.weaponId,
            ammo: {
                munitionKey: fixture.ammo.internalName,
                preferredSourceId: fixture.ammoId,
            },
        }, {
            kind: 'set-target-facts' as const,
            targetId: fixture.targetId,
            facts: { distance: 7, calculator: { partialCover: true as const } },
        }]) {
            const result = fixture.runtime.dispatchAttackerTargeting({
                kind: 'edit-attacker-targeting',


                edit,
            }, fixture.registry, false);
            expect(result.accepted).toBeTrue();
        }
        const saved = serializeNonMekUnit({
            instance: fixture.runtime,
            uuid: baseline().entity,
            deployment: {
                schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
                values: {
                    id: 'deployment:tank-targeting',
                    crewAssignment: createDefaultCrewAssignment(fixture.runtime.getIndex().crewPositions),
                },
            },
        });

        expect(inspectSerializedNonMekUnit(saved).instanceId).toBe(fixture.runtime.id);
        const restored = restoreNonMekUnit(saved, fixture.entity);
        expect(serializeAttackerTargetingState(restored.query().attackerTargetingState()))
            .toEqual(serializeAttackerTargetingState(fixture.runtime.query().attackerTargetingState()));
    });

    it('uses BaseEntity damage topology for Battle Armor and aerospace families', () => {
        const battleArmor = new TestBattleArmorEntity();
        battleArmor.uuid.set(UUID);
        battleArmor.trooperCount.set(4);
        battleArmor.setArmorValue('Squad', 'front', 5);
        const battleArmorRuntime = new NonMekUnitInstance(
            'unit:battle-armor',
            baseline(),
            battleArmor,
            CORE_2026_RULESET,
        );
        const battleArmorLocations = [...battleArmorRuntime.getIndex().locations.values()];
        expect(battleArmorLocations.map(location => location.code)).toEqual([
            'Trooper 1', 'Trooper 2', 'Trooper 3', 'Trooper 4',
        ]);
        expect(battleArmorLocations.map(location => location.sheetCode)).toEqual(['T1', 'T2', 'T3', 'T4']);
        expect(battleArmorLocations.every(location => location.internalPoints === 1 && location.combinedPips)).toBeTrue();
        expect(battleArmorLocations.map(location =>
            battleArmorRuntime.getIndex().armorFaces.get(location.armorFaceIds[0])!.maximumPoints,
        )).toEqual([5, 5, 5, 5]);

        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.structuralIntegrity.set(7);
        const fighterRuntime = new NonMekUnitInstance(
            'unit:fighter',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const fighterLocations = [...fighterRuntime.getIndex().locations.values()];
        expect(fighterLocations.filter(location => location.internalPoints > 0)
            .map(location => [location.code, location.internalPoints])).toEqual([['SI', 7]]);

        const dropShip = new TestDropShipEntity();
        expect(dropShip.locationOrder).toEqual(['Nose', 'Left Side', 'Right Side', 'Aft']);

        const warShip = new TestWarShipEntity();
        warShip.uuid.set(UUID);
        warShip.structuralIntegrity.set(20);
        const warShipRuntime = new NonMekUnitInstance(
            'unit:warship',
            baseline(),
            warShip,
            CORE_2026_RULESET,
        );
        const warShipTracks = [...warShipRuntime.getIndex().locations.values()];
        expect(warShipTracks.find(location => location.code === 'SI')?.sheetCode).toBe('SI');
        expect(warShipTracks.some(location => location.code === 'KF')).toBeTrue();
        expect(warShipTracks.some(location => location.code === 'SAIL')).toBeTrue();
    });

    it('round-trips only non-pristine aerospace heat state', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = new NonMekUnitInstance(
            'unit:fighter-heat-persistence',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const deployment = {
            schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
            values: {
                id: 'deployment:fighter-heat',
                crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            },
        } as const;
        expect(serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment,
        }).heat).toBeUndefined();

        runtime.dispatch({
            kind: 'set-heat',

            heat: 19,
            target: 'pending',
        });
        runtime.dispatch({
            kind: 'set-heatsinks-off',

            heatsinksOff: 2,
        });
        const saved = serializeNonMekUnit({
            instance: runtime,
            uuid: baseline().entity,
            deployment,
        });
        expect(saved.heat).toEqual({
            current: 0,
            previous: 0,
            pendingOverride: 19,
            heatsinksOff: 2,
        });
        expect(restoreNonMekUnit(saved, fighter).snapshot().heat).toEqual(saved.heat!);
    });

    it('applies Nova CEWS heat to aerospace units using the committed power state', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(0);
        const nova = addTestEquipmentWithFlags(
            fighter,
            ['F_NOVA', 'F_ECM', 'F_BAP'],
            { location: 'Nose' },
        );
        const runtime = new NonMekUnitInstance(
            'unit:fighter-nova-heat',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const novaId = componentIdForMount(nova);

        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(2);

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: novaId,
            mode: 'disabling',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(4);
        expect(runtime.componentMode(novaId)).toBe('disabled');

        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(4);
    });

    it('projects named aerospace end-turn heat sources without mutating runtime state', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(5);
        const nova = addTestEquipmentWithFlags(
            fighter,
            ['F_NOVA', 'F_ECM', 'F_BAP'],
            { location: 'Nose' },
        );
        const runtime = new NonMekUnitInstance(
            'unit:fighter-heat-projection',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        expect(runtime.dispatch({
            kind: 'set-heat',

            heat: 10,
            target: 'committed',
        }).accepted).toBeTrue();

        const before = runtime.snapshot();
        const projection = projectNonMekEndTurnHeat(
            fighter,
            runtime.getIndex(),
            before,
            CORE_2026_RULESET,
        );

        expect(projection).toEqual(jasmine.objectContaining({
            current: 10,
            generated: 2,
            dissipated: 5,
            projected: 7,
        }));
        expect(projection?.sources).toEqual([
            { id: 'nova-cews', label: 'Nova CEWS', value: 2 },
            { id: 'dissipation', label: 'Dissipation', value: -5 },
        ]);
        expect(runtime.snapshot()).toBe(before);
        expect(componentIdForMount(nova)).toBeDefined();
    });

    it('leaves aerospace heat unchanged under manual end-turn settlement', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = new NonMekUnitInstance(
            'unit:fighter-manual-heat',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        expect(runtime.dispatch({
            kind: 'set-heat',

            heat: 20,
            target: 'committed',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-turn',

            heatPolicy: 'manual',
        }).accepted).toBeTrue();

        expect(runtime.snapshot().heat.current).toBe(20);
        expect(runtime.turnState()).toEqual({
            turnCounter: 1,
            airborne: null,
            movement: null,
            weaponsHeat: 0,
            cover: null,
            spotting: false,
            phaseStateChanged: false,
        });
    });

    it('runs the Ground-Mobile HPG charge, transmission, movement, and cooldown cycle', () => {
        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        tank.originalWalkMP.set(4);
        tank.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'IS' }));
        const hpg = addTestEquipmentWithFlags(
            tank,
            ['F_MOBILE_HPG', 'F_MEK_EQUIPMENT'],
            { location: tank.locationOrder[0] },
        );
        const runtime = new NonMekUnitInstance(
            'unit:tank-ground-mobile-hpg',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        const hpgId = componentIdForMount(hpg);

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: hpgId,
            mode: 'charging',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.componentMode(hpgId)).toBe('charged');

        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: { mode: 'walk', distance: 1, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: hpgId,
            mode: 'transmitting',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            kind: 'set-movement',

            movement: null,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: hpgId,
            mode: 'transmitting',
        }).accepted).toBeTrue();
        expect(projectNonMekMovementCapabilities(
            tank,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        ).maximum.walk).toBe(0);

        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.componentMode(hpgId)).toBe('cooldown-3');
        for (let turn = 0; turn < 3; turn += 1) {
            expect(runtime.dispatch({
                kind: 'end-turn',

            }).accepted).toBeTrue();
        }
        expect(runtime.componentMode(hpgId)).toBe('idle');
    });

    it('toggles a non-ground Mobile HPG and applies forty aerospace heat', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(0);
        fighter.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'IS' }));
        const hpg = addTestEquipmentWithFlags(fighter, 'F_MOBILE_HPG', { location: 'Nose' });
        const runtime = new NonMekUnitInstance(
            'unit:fighter-mobile-hpg',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const hpgId = componentIdForMount(hpg);

        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: hpgId,
            mode: 'transmitting',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-turn',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(40);
        expect(runtime.componentMode(hpgId)).toBe('transmitting');
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: hpgId,
            mode: 'idle',
        }).accepted).toBeTrue();
    });

    it('detonates a Booby Trap as one irreversible component-and-unit transaction', () => {
        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        const trap = addTestEquipmentWithFlags(
            tank,
            'F_BOOBY_TRAP',
            { location: tank.locationOrder[0] },
        );
        const runtime = new NonMekUnitInstance(
            'unit:tank-booby-trap',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        const trapId = componentIdForMount(trap);
        const revision = runtime.revision();

        expect(runtime.componentMode(trapId)).toBe(BOOBY_TRAP_ARMED_MODE);
        expect(runtime.dispatch({
            kind: 'set-component-mode',

            componentId: trapId,
            mode: BOOBY_TRAP_DETONATED_MODE,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.revision()).toBe(revision);

        expect(runtime.dispatch({
            kind: 'detonate-booby-trap',

            componentId: trapId,
        }).accepted).toBeTrue();
        expect(runtime.componentMode(trapId)).toBe(BOOBY_TRAP_DETONATED_MODE);
        expect(runtime.snapshot().explicitlyDestroyed).toBeFalse();
        expect(runtime.query().destroyed()).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-destroyed',

            destroyed: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.query().destroyed()).toBeTrue();
    });

    it('recalculates fighter and Battle Armor BV from sparse structural damage', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.setTonnage(50);
        fighter.structuralIntegrity.set(10);
        const fighterRuntime = new NonMekUnitInstance(
            'unit:fighter-bv',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const fighterPristineBV = fighterRuntime.battleValue();
        const si = [...fighterRuntime.getIndex().locations.values()]
            .find(location => location.code === 'SI')!;
        expect(fighterRuntime.dispatch({
            kind: 'set-internal-damage',

            locationId: si.id,
            damage: 1,
        }).accepted).toBeTrue();
        expect(fighterRuntime.battleValue()).toBeLessThan(fighterPristineBV);
        expect(fighter.structuralIntegrity()).toBe(10);

        const battleArmor = new TestBattleArmorEntity();
        battleArmor.uuid.set(UUID);
        battleArmor.trooperCount.set(4);
        battleArmor.setArmorValue('Squad', 'front', 5);
        const battleArmorRuntime = new NonMekUnitInstance(
            'unit:battle-armor-bv',
            baseline(),
            battleArmor,
            CORE_2026_RULESET,
        );
        const pristineBattleArmorBV = battleArmorRuntime.battleValue();
        const firstTrooper = [...battleArmorRuntime.getIndex().locations.values()][0];
        expect(battleArmorRuntime.dispatch({
            kind: 'set-internal-damage',

            locationId: firstTrooper.id,
            damage: 1,
        }).accepted).toBeTrue();
        expect(battleArmorRuntime.battleValue()).toBeLessThan(pristineBattleArmorBV);
        expect(battleArmor.trooperCount()).toBe(4);
    });

    it('derives ProtoMek component destruction and current BV from location damage', () => {
        const weapon = new WeaponEquipment({
            id: 'ProtoRuntimeLaser',
            name: 'Proto Runtime Laser',
            type: 'weapon',
            stats: { bv: 200 },
            weapon: { damage: 5, heat: 2, ranges: [3, 6, 9, 12] },
        });
        const entity = new TestProtoMekEntity(createTestEquipmentRegistry({ [weapon.id]: weapon }));
        entity.uuid.set(UUID);
        entity.setTonnage(6);
        entity.originalWalkMP.set(5);
        const mount = addTestEquipment(entity, weapon, { location: 'Left Arm' });
        const runtime = new NonMekUnitInstance(
            'unit:proto-bv',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = componentIdForMount(mount);
        const arm = [...runtime.getIndex().locations.values()]
            .find(location => location.code === 'Left Arm')!;
        const pristine = runtime.battleValue();
        expect(pristine).toBe(entity.battleValue());

        expect(runtime.dispatch({
            kind: 'damage-internal',

            locationId: arm.id,
            amount: arm.internalPoints,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.componentStatus(componentId)).toBe('available');
        expect(runtime.componentStatus(componentId, 'preview')).toBe('destroyed');

        expect(runtime.dispatch({
            kind: 'end-phase',

        }).accepted).toBeTrue();
        expect(runtime.componentStatus(componentId)).toBe('destroyed');
        expect(runtime.battleValue()).toBeLessThan(pristine);
    });

    it('rejects Meks because their concrete runtime owns Mek mechanics', () => {
        const entity = new TestBipedMekEntity();
        entity.uuid.set(UUID);

        expect(() => new NonMekUnitInstance(
            'unit:mek',
            baseline('mtf'),
            entity,
            CORE_2026_RULESET,
        )).toThrowError(/Meks require CBTUnitInstance/u);
    });

    it('rejects persisted pending damage outside the Entity capacity', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        const pristine = createPristineNonMekUnitState(entity);
        const index = new NonMekUnitInstance(
            'unit:index',
            baseline(),
            entity,
            CORE_2026_RULESET,
            pristine,
        ).getIndex();
        const location = [...index.locations.values()][0];
        const invalid = {
            ...pristine,
            pendingCombat: {
                ...pristine.pendingCombat,
                locationInternalDamage: new Map([[location.id, location.internalPoints + 1]]),
            },
        };

        expect(() => new NonMekUnitInstance(
            'unit:invalid',
            baseline(),
            entity,
            CORE_2026_RULESET,
            invalid,
        )).toThrowError(/outside the entity capacity/u);
    });
});

function targetingFixture(instanceId: string) {
    const weapon = new WeaponEquipment({
        id: 'AC_10_Targeting_Test',
        name: 'AC/10',
        type: 'weapon',
        weapon: { ammoType: 'AC', rackSize: 10, damage: 10, heat: 3, ranges: [5, 10, 15, 20] },
    });
    const ammo = new AmmoEquipment({
        id: 'Ammo_AC_10_Targeting_Test',
        name: 'AC/10 Ammo',
        type: 'ammo',
        ammo: { type: 'AC', rackSize: 10, shots: 10 },
    });
    const entity = new TestTankEntity(createTestEquipmentRegistry({
        [weapon.id]: weapon,
        [ammo.id]: ammo,
    }));
    entity.uuid.set(UUID);
    const weaponMount = addTestEquipment(entity, weapon, { location: entity.locationOrder[0] });
    const ammoMount = addTestEquipment(entity, ammo, {
        location: entity.locationOrder[0],
        shotsCount: 10,
    });
    const runtime = new NonMekUnitInstance(
        instanceId,
        baseline(),
        entity,
        CORE_2026_RULESET,
    );
    const weaponId = [...runtime.getIndex().components.keys()]
        .find(id => String(id) === String(weaponMount.mountId))!;
    const ammoId = [...runtime.getIndex().components.keys()]
        .find(id => String(id) === String(ammoMount.mountId))!;
    const targetId = asEncounterTargetId('target:vehicle');
    const registry: TargetRegistrySnapshot = Object.freeze({
        revision: 0,
        targets: Object.freeze([Object.freeze({
            id: targetId,
            letter: 'A',
            name: 'Target A',
            color: '#ff0000',
            source: 'manual' as const,
            readOnly: false,
        })]),
    });
    return { entity, runtime, weaponId, ammoId, ammo, targetId, registry };
}

function baseline(_sourceFormat: 'mtf' | 'blk' = 'blk'): InstanceBaselineRef {
    return Object.freeze({
        entity: UUID,
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
