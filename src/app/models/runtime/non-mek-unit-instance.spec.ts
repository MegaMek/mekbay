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
    MM_DATA_UNIT_PROVIDER_ID,
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../entity/testing/test-mounted-equipment';
import { asEncounterTargetId, type TargetRegistrySnapshot } from './encounter-runtime';
import { asStateRevision, asUnitInstanceId, createCommandId, type InstanceBaselineRef } from './runtime-state';
import {
    createPristineNonMekUnitState,
    effectiveNonMekCrewState,
    NonMekUnitInstance,
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
                asUnitInstanceId(`unit:${entity.entityType}`),
                baseline(),
                entity,
                CORE_2026_RULESET,
            );

            expect(runtime.getUnit()).toBe(entity);
            expect(runtime.snapshot().family.entityType).toBe(entity.entityType);
            expect(runtime.matchesEntity(entity)).toBeTrue();
        }
    });

    it('stores damage sparsely and resolves current values against the entity', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        entity.setArmorValue(entity.locationOrder[0], 'front', 2);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0];
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0])!;

        const internal = runtime.dispatch({
            kind: 'set-internal-damage',
            expectedRevision: runtime.revision(),
            locationId: location.id,
            damage: Math.min(1, location.internalPoints),
        });
        const armor = runtime.dispatch({
            kind: 'set-armor-damage',
            expectedRevision: runtime.revision(),
            faceId: face.id,
            damage: Math.min(1, face.maximumPoints),
        });

        expect(internal.accepted).toBeTrue();
        expect(armor.accepted).toBeTrue();
        expect(runtime.remainingInternal(location.id)).toBe(
            location.internalPoints - Math.min(1, location.internalPoints),
        );
        expect(runtime.remainingArmor(face.id)).toBe(
            face.maximumPoints - Math.min(1, face.maximumPoints),
        );
        expect(runtime.snapshot().locations.size).toBe(1);
    });

    it('stores and round-trips vehicle killed/stunned crew state sparsely', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-crew-state'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;

        expect(runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: runtime.revision(),
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            state: 'stunned',
        }).accepted).toBeTrue();
        expect(effectiveNonMekCrewState(runtime.snapshot().crew.get(positionId))).toBe('stunned');

        const saved = serializeNonMekUnit({
            instance: runtime,
            sourceRef: baseline().entity,
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
            state: 'stunned',
        }]);
        const restored = restoreNonMekUnit(saved, entity);
        expect(restored.snapshot().crew.get(positionId)?.state).toBe('stunned');

        const reset = restored.dispatch({
            kind: 'set-crew-state',
            expectedRevision: restored.revision(),
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
        });
        expect(reset).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(restored.snapshot().crew.has(positionId)).toBeFalse();
        expect(restored.dispatch({
            kind: 'set-crew-state',
            expectedRevision: restored.revision(),
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
    });

    it('exposes effective vehicle rules through the direct runtime query surface', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.originalWalkMP.set(8);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-effective-rules'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: runtime.revision(),
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            state: 'killed',
        });

        expect(runtime.conditions()).toEqual(['abandoned', 'immobile']);
        expect(runtime.hasCondition('immobile')).toBeTrue();
        expect(runtime.stateView().movement).toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));

        runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: runtime.revision(),
            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
        });
        runtime.dispatch({
            kind: 'damage-track',
            expectedRevision: runtime.revision(),
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

    it('keeps phase-tracked Entity damage pending until combat is committed', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        entity.setArmorValue(entity.locationOrder[0], 'front', 3);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-pending'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0];
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0])!;

        expect(runtime.dispatch({
            kind: 'damage-armor',
            expectedRevision: runtime.revision(),
            faceId: face.id,
            amount: 2,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.remainingArmor(face.id)).toBe(3);
        expect(runtime.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(2);

        expect(runtime.dispatch({
            kind: 'repair-armor',
            expectedRevision: runtime.revision(),
            faceId: face.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(1);

        expect(runtime.dispatch({
            kind: 'damage-internal',
            expectedRevision: runtime.revision(),
            locationId: location.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'end-phase',
            expectedRevision: runtime.revision(),
        }).accepted).toBeTrue();
        expect(runtime.remainingArmor(face.id)).toBe(2);
        expect(runtime.remainingInternal(location.id)).toBe(location.internalPoints - 1);
        expect(runtime.snapshot().pendingCombat.armorDamage.size).toBe(0);
        expect(runtime.snapshot().pendingCombat.locationInternalDamage.size).toBe(0);
    });

    it('owns vehicle movement, semantic phase boundaries, and turn reset directly', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(60);
        entity.originalWalkMP.set(8);
        const booster = addTestEquipmentWithFlags(entity, ['F_MASC', 'S_SUPERCHARGER']);
        const boosterComponentId = componentIdForMount(booster);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-turn'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        expect(runtime.dispatch({
            kind: 'set-movement',
            expectedRevision: runtime.revision(),
            movement: { mode: 'run', distance: 16, boosterComponentIds: [] },
        }).accepted).toBeFalse();
        expect(runtime.dispatch({
            kind: 'set-movement',
            expectedRevision: runtime.revision(),
            movement: { mode: 'run', distance: 16, boosterComponentIds: [boosterComponentId] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.turnState().movement).toEqual({
            mode: 'run',
            distance: 16,
            boosterComponentIds: [boosterComponentId],
        });

        const beforePhase = runtime.revision();
        expect(runtime.dispatch({
            kind: 'end-phase',
            expectedRevision: beforePhase,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(Number(runtime.revision())).toBe(Number(beforePhase) + 1);
        expect(runtime.turnState().movement?.distance).toBe(16);

        const saved = serializeNonMekUnit({
            instance: runtime,
            sourceRef: baseline().entity,
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
            expectedRevision: restored.revision(),
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(restored.turnState()).toEqual({
            turnCounter: 1,
            airborne: null,
            movement: null,
            weaponsHeat: 0,
        });
    });

    it('activates ProtoMek myomer boosters only when the turn declaration selects them', () => {
        const entity = new TestProtoMekEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(6);
        entity.originalWalkMP.set(6);
        const booster = addTestEquipmentWithFlags(entity, 'F_MASC', { location: 'Torso' });
        const boosterId = componentIdForMount(booster);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:proto-turn'),
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
        expect(capabilities.maximum.run).toBe(12);
        expect(runtime.dispatch({
            kind: 'set-movement',
            expectedRevision: runtime.revision(),
            movement: { mode: 'run', distance: 12, boosterComponentIds: [] },
        }).accepted).toBeFalse();
        expect(runtime.dispatch({
            kind: 'set-movement',
            expectedRevision: runtime.revision(),
            movement: { mode: 'run', distance: 12, boosterComponentIds: [boosterId] },
        }).accepted).toBeTrue();

        const crewId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: runtime.revision(),
            positionId: crewId,
            wounds: 0,
            unconscious: true,
            ejected: false,
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
            jump: 0,
            UMU: 0,
            VTOL: 0,
        });
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
            asUnitInstanceId('unit:tank-equipment'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0];
        expect(String(componentId)).toBe(String(mount.mountId));

        expect(runtime.dispatch({
            kind: 'set-component-status',
            expectedRevision: runtime.revision(),
            componentId,
            status: 'destroyed',
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();
        expect(runtime.snapshot().pendingCombat.componentStatus.get(componentId)).toBe('destroyed');

        expect(runtime.dispatch({
            kind: 'end-phase',
            expectedRevision: runtime.revision(),
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(componentId)?.statusOverride).toBe('destroyed');

        expect(runtime.dispatch({
            kind: 'configure-ammo-source',
            expectedRevision: runtime.revision(),
            componentId,
            munitionKey: precision.id,
            remaining: 3,
        }).accepted).toBeTrue();
        expect(runtime.snapshot().ammo.get(componentId)).toEqual({
            shotsSpent: 7,
            munitionOverride: precision.id,
        });
        expect(runtime.ammoRemaining(componentId)).toBe(3);
    });

    it('stores only a non-default Entity equipment mode', () => {
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
            asUnitInstanceId('unit:tank-mode'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0]!;
        expect(runtime.componentMode(componentId)).toBe('Single');

        expect(runtime.dispatch({
            kind: 'set-component-mode',
            expectedRevision: runtime.revision(),
            componentId,
            mode: 'Rapid',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(componentId)?.mode).toBe('Rapid');
        expect(runtime.componentMode(componentId)).toBe('Rapid');

        expect(runtime.dispatch({
            kind: 'set-component-mode',
            expectedRevision: runtime.revision(),
            componentId,
            mode: 'Single',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();
        expect(runtime.componentMode(componentId)).toBe('Single');

        runtime.dispatch({
            kind: 'set-component-status',
            expectedRevision: runtime.revision(),
            componentId,
            status: 'destroyed',
            target: 'pending',
        });
        expect(runtime.dispatch({
            kind: 'set-component-mode',
            expectedRevision: runtime.revision(),
            componentId,
            mode: 'Rapid',
        }).accepted).toBeTrue();
        runtime.dispatch({ kind: 'end-phase', expectedRevision: runtime.revision() });
        expect(runtime.dispatch({
            kind: 'set-component-mode',
            expectedRevision: runtime.revision(),
            componentId,
            mode: 'Single',
        }).accepted).toBeFalse();
    });

    it('owns vehicle weapon targeting and exact ammunition preference in sparse runtime state', () => {
        const fixture = targetingFixture('unit:tank-targeting');

        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-component-ammo',
                componentId: fixture.weaponId,
                ammo: {
                    munitionKey: fixture.ammo.internalName,
                    preferredSourceId: fixture.ammoId,
                },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));

        expect(fixture.runtime.attackerTargetingState().components.get(fixture.weaponId)).toEqual({
            selection: { kind: 'target', targetId: fixture.targetId },
            ammo: {
                munitionKey: fixture.ammo.internalName,
                preferredSourceId: fixture.ammoId,
            },
        });
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
                expectedRevision: fixture.runtime.revision(),
                expectedRegistryRevision: fixture.registry.revision,
                edit,
            }, fixture.registry, false).accepted).toBeTrue();
        }

        const result = fixture.runtime.dispatchSelectedWeaponFire({
            type: 'fire-selected-weapons',
            commandId: createCommandId(),
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            heatPolicy: 'automatic',
        }, fixture.registry, false, false);

        expect(result).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.runtime.ammoRemaining(fixture.ammoId)).toBe(9);
        expect(fixture.runtime.turnState().weaponsHeat).toBe(0);
    });

    it('keeps a pending-destroyed vehicle weapon actionable until phase commit', () => {
        const fixture = targetingFixture('unit:tank-targeting-destroyed');
        fixture.runtime.dispatch({
            kind: 'set-component-status',
            expectedRevision: fixture.runtime.revision(),
            componentId: fixture.weaponId,
            status: 'destroyed',
            target: 'pending',
        });

        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: true,
        }));
        fixture.runtime.dispatch({ kind: 'end-phase', expectedRevision: fixture.runtime.revision() });
        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: false,
            changed: false,
            reason: 'INVALID_TARGETING',
        }));
    });

    it('rejects weapon selection after the Non-Mek runtime is destroyed', () => {
        const fixture = targetingFixture('unit:tank-targeting-unit-destroyed');
        expect(fixture.runtime.dispatch({
            kind: 'set-destroyed',
            expectedRevision: fixture.runtime.revision(),
            destroyed: true,
        }).accepted).toBeTrue();

        expect(fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: false,
            changed: false,
            reason: 'INVALID_TARGETING',
        }));
    });

    it('reconciles deleted targets before the force commits its target registry', () => {
        const fixture = targetingFixture('unit:tank-targeting-reconcile');
        fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false);
        fixture.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: fixture.runtime.revision(),
            expectedRegistryRevision: fixture.registry.revision,
            edit: {
                kind: 'set-target-facts',
                targetId: fixture.targetId,
                facts: { distance: 8 },
            },
        }, fixture.registry, false);
        const before = fixture.runtime.revision();
        const plan = fixture.runtime.planAttackerTargetingReconciliation(Object.freeze({
            revision: asStateRevision(1),
            targets: Object.freeze([]),
        }));

        expect(plan).not.toBeNull();
        expect(fixture.runtime.commitAttackerTargetingReconciliation(plan!)).toBeTrue();
        expect(Number(fixture.runtime.revision())).toBe(Number(before) + 1);
        expect(fixture.runtime.attackerTargetingState().components.has(fixture.weaponId)).toBeFalse();
        expect(fixture.runtime.attackerTargetingState().targets.has(fixture.targetId)).toBeFalse();
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
                expectedRevision: fixture.runtime.revision(),
                expectedRegistryRevision: fixture.registry.revision,
                edit,
            }, fixture.registry, false);
            expect(result.accepted).toBeTrue();
        }
        const saved = serializeNonMekUnit({
            instance: fixture.runtime,
            sourceRef: baseline().entity,
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
        expect(serializeAttackerTargetingState(restored.attackerTargetingState()))
            .toEqual(serializeAttackerTargetingState(fixture.runtime.attackerTargetingState()));
    });

    it('uses BaseEntity damage topology for Battle Armor and aerospace families', () => {
        const battleArmor = new TestBattleArmorEntity();
        battleArmor.uuid.set(UUID);
        battleArmor.trooperCount.set(4);
        battleArmor.setArmorValue('Squad', 'front', 5);
        const battleArmorRuntime = new NonMekUnitInstance(
            asUnitInstanceId('unit:battle-armor'),
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
            asUnitInstanceId('unit:fighter'),
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
            asUnitInstanceId('unit:warship'),
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
            asUnitInstanceId('unit:fighter-heat-persistence'),
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
            sourceRef: baseline().entity,
            deployment,
        }).heat).toBeUndefined();

        runtime.dispatch({
            kind: 'set-heat',
            expectedRevision: runtime.revision(),
            heat: 19,
            target: 'pending',
        });
        runtime.dispatch({
            kind: 'set-heatsinks-off',
            expectedRevision: runtime.revision(),
            heatsinksOff: 2,
        });
        const saved = serializeNonMekUnit({
            instance: runtime,
            sourceRef: baseline().entity,
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

    it('recalculates fighter and Battle Armor BV from sparse structural damage', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.setTonnage(50);
        fighter.structuralIntegrity.set(10);
        const fighterRuntime = new NonMekUnitInstance(
            asUnitInstanceId('unit:fighter-bv'),
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const fighterPristineBV = fighterRuntime.battleValue();
        const si = [...fighterRuntime.getIndex().locations.values()]
            .find(location => location.code === 'SI')!;
        expect(fighterRuntime.dispatch({
            kind: 'set-internal-damage',
            expectedRevision: fighterRuntime.revision(),
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
            asUnitInstanceId('unit:battle-armor-bv'),
            baseline(),
            battleArmor,
            CORE_2026_RULESET,
        );
        const pristineBattleArmorBV = battleArmorRuntime.battleValue();
        const firstTrooper = [...battleArmorRuntime.getIndex().locations.values()][0];
        expect(battleArmorRuntime.dispatch({
            kind: 'set-internal-damage',
            expectedRevision: battleArmorRuntime.revision(),
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
            asUnitInstanceId('unit:proto-bv'),
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
            expectedRevision: runtime.revision(),
            locationId: arm.id,
            amount: arm.internalPoints,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.componentStatus(componentId)).toBe('available');
        expect(runtime.componentStatus(componentId, 'preview')).toBe('destroyed');

        expect(runtime.dispatch({
            kind: 'end-phase',
            expectedRevision: runtime.revision(),
        }).accepted).toBeTrue();
        expect(runtime.componentStatus(componentId)).toBe('destroyed');
        expect(runtime.battleValue()).toBeLessThan(pristine);
    });

    it('rejects Meks because their concrete runtime owns Mek mechanics', () => {
        const entity = new TestBipedMekEntity();
        entity.uuid.set(UUID);

        expect(() => new NonMekUnitInstance(
            asUnitInstanceId('unit:mek'),
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
            asUnitInstanceId('unit:index'),
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
            asUnitInstanceId('unit:invalid'),
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
        asUnitInstanceId(instanceId),
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
        revision: asStateRevision(0),
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

function baseline(sourceFormat: 'mtf' | 'blk' = 'blk'): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat,
        }),
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
