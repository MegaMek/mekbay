// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET,TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import { CrewMember } from '../crew-member.model';
import type { BaseEntity } from '../entity/base-entity';
import {
TestAeroSpaceFighterEntity,
TestBattleArmorEntity,
TestBipedMekEntity,
TestDropShipEntity,
TestHandheldWeaponEntity,
TestInfantryEntity,
TestJumpShipEntity,
TestLargeSupportTankEntity,
TestProtoMekEntity,
TestTankEntity,
TestVtolEntity,
TestWarShipEntity,
} from '../entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import type { EquipmentRegistry } from '../equipment-lookup';
import type { ComponentId } from '../entity/entity-identifiers';
import { parseEntity } from '../entity/parse-entity';
import {
addTestEquipment,
addTestEquipmentWithFlags,
} from '../entity/testing/test-mounted-equipment';
import { AmmoEquipment,MiscEquipment,WeaponEquipment } from '../equipment.model';
import { systemDamageId } from '../rules/system-damage-rules';
import { elevationAt } from '../elevation-record.model';
import { createDefaultCrewAssignment } from './crew-assignment';
import { asEncounterTargetId,type EncounterTargetId,type TargetRegistrySnapshot } from './encounter-runtime';
import { projectNonMekEquipmentPanel } from './non-mek-equipment-panel';
import { projectNonMekRecordSheet } from './non-mek-record-sheet';
import {
canNonMekTakeActiveActions,
createPristineNonMekUnitState,
nonMekAttackMovementModifier,
projectNonMekDefenseModifierBreakdown,
projectNonMekEndTurnHeat,
projectNonMekEscalatingFailureInteractions,
projectNonMekMovementCapabilities,
} from './non-mek-unit-instance';
import {
inspectSerializedNonMekUnit,
serializeNonMekUnit,
} from './non-mek-unit-persistence';
import { type InstanceBaselineRef } from './runtime-state';
import { componentIdForMount } from './unit-runtime-index';
import { TARGET_TAG_INFANTRY_REASON } from './weapon-target-policy';
import type { TnTargetUnitType } from '../target-number-calculator.model';

import { MountedEngine } from '../entity/components/engine';
import {
BOOBY_TRAP_ARMED_MODE,
BOOBY_TRAP_DETONATED_MODE,
} from './component-booby-trap';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

describe('NonMekUnitInstance', () => {
    it('records a flying unit\'s Elevation turn by turn, the unit staying airborne at the last one (TW p. 55)', () => {
        const vtol = new TestVtolEntity();
        vtol.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest('unit:elevation', { ...baseline(), ruleset: TOTAL_WARFARE_RULESET }, vtol,
            TOTAL_WARFARE_RULESET);
        const facts = () => [
            elevationAt(runtime.snapshot().elevationRecord, runtime.snapshot().turn.turnCounter + 1),
            runtime.snapshot().turn.airborne,
        ];
        const record = () => runtime.snapshot().elevationRecord?.map(entry => [entry.turn, entry.value]);
        expect(runtime.dispatch({ type: 'set-elevation', elevation: 3 }).changed).toBeTrue();
        expect(facts()).toEqual([3, true]);
        // Turn 2: still at 3 and airborne, though nothing is recorded for it yet.
        expect(runtime.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
        expect(facts()).toEqual([3, true]);
        expect(record()).toEqual([[1, 3]]);
        // Landing sets it down this turn; taking off lifts it at least one level; Elevation 0 is on the ground.
        expect(runtime.dispatch({ type: 'set-airborne', airborne: false }).changed).toBeTrue();
        expect(facts()).toEqual([0, false]);
        expect(runtime.dispatch({ type: 'set-airborne', airborne: true }).changed).toBeTrue();
        expect(facts()).toEqual([1, true]);
        expect(record()).toEqual([[1, 3], [2, 1]]);
        // An earlier turn is corrected without moving the unit; clearing this turn falls back to the last one before.
        expect(runtime.dispatch({ type: 'set-elevation', elevation: 2, turn: 1 }).changed).toBeTrue();
        expect(facts()).toEqual([1, true]);
        expect(runtime.dispatch({ type: 'set-elevation', elevation: null }).changed).toBeTrue();
        expect(facts()).toEqual([2, true]);
        expect(runtime.dispatch({ type: 'set-elevation', elevation: 0 }).changed).toBeTrue();
        expect(facts()).toEqual([0, false]);
        // No later turn, no Elevation past 500.
        expect(runtime.dispatch({ type: 'set-elevation', elevation: 4, turn: 3 }).changed).toBeFalse();
        expect(runtime.dispatch({ type: 'set-elevation', elevation: 501 }).changed).toBeFalse();
        expect(record()).toEqual([[1, 2], [2, 0]]);
        // A ground vehicle and an aerospace fighter, whose Altitude its velocity record keeps, have no Elevation.
        for (const entity of [new TestTankEntity(), new TestAeroSpaceFighterEntity()]) {
            entity.uuid.set(UUID);
            const other = createNonMekRuntimeForTest('unit:no-elevation', { ...baseline(), ruleset: TOTAL_WARFARE_RULESET },
                entity, TOTAL_WARFARE_RULESET);
            expect(other.dispatch({ type: 'set-elevation', elevation: 1 }).changed).withContext(entity.entityType).toBeFalse();
            expect(other.snapshot().elevationRecord).toBeUndefined();
        }
    });

    it('clears tagged and skidding at End Turn, like Meks, and keeps lasting conditions', () => {
        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest('unit:turn-conditions', { ...baseline(), ruleset: TOTAL_WARFARE_RULESET }, tank,
            TOTAL_WARFARE_RULESET);
        for (const condition of ['tagged', 'skidding', 'swarmed'] as const) {
            expect(runtime.dispatch({ type: 'set-condition', condition, active: true }).accepted).toBeTrue();
        }
        expect(runtime.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
        expect(runtime.query().hasCondition('tagged')).toBeFalse();
        expect(runtime.query().hasCondition('skidding')).toBeFalse();
        expect(runtime.query().hasCondition('swarmed')).toBeTrue();
    });

    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        it(`keeps authored manual BV after non-Mek damage in ${ruleset}`, () => {
            const entity = new TestTankEntity();
            entity.uuid.set(UUID);
            entity.manualBV.set(321);
            entity.setArmorValue('Front', 'front', 20);
            const runtime = createNonMekRuntimeForTest('unit:manual-bv', { ...baseline(), ruleset }, entity, ruleset);
            const face = [...runtime.getIndex().armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;
            expect(runtime.query().currentBaseBattleValue()).toBe(321);
            expect(runtime.dispatch({ type: 'damage-armor', faceId: face.id,
                amount: face.maximumPoints, target: 'committed' }).accepted).toBeTrue();
            expect(runtime.query().currentBaseBattleValue()).toBe(321);
        });
    }

    describe('undamaged runtime BV', () => {
        const laser = new WeaponEquipment({ id: 'Test Laser', name: 'Test Laser', type: 'weapon', stats: { bv: 50 } });
        const lbx = new WeaponEquipment({ id: 'Test LB 10-X AC', name: 'Test LB 10-X AC', type: 'weapon',
            stats: { bv: 148 }, weapon: { ammoType: 'AC_LBX', rackSize: 10 } });
        // Slug (non-cluster) LB-X ammo is not an aerospace replacement munition, but it is authored on stock craft.
        const slug = new AmmoEquipment({ id: 'Test LB 10-X AC Ammo', name: 'Test LB 10-X AC Ammo', type: 'ammo',
            stats: { bv: 19 }, ammo: { type: 'AC_LBX', rackSize: 10, shots: 10 } });
        const modularArmor = new MiscEquipment({ id: 'Test Modular Armor', name: 'Test Modular Armor', type: 'misc',
            flags: ['F_MODULAR_ARMOR'] });
        const registry = () => createTestEquipmentRegistry(Object.fromEntries(
            [laser, lbx, slug, modularArmor].map(equipment => [equipment.id, equipment])));
        const cases: Readonly<Record<string, () => BaseEntity>> = {
            'a JumpShip, whose speed factor uses MP 1': () => {
                const entity = new TestJumpShipEntity(registry());
                addTestEquipment(entity, laser, { location: 'Nose' });
                return entity;
            },
            'a train, whose speed factor uses cruise MP': () => {
                const entity = new TestLargeSupportTankEntity(registry());
                entity.setTonnage(300);
                entity.motiveType.set('Rail');
                entity.originalWalkMP.set(4);
                return entity;
            },
            'battle armor, whose speed factor uses its best walk, jump or UMU MP': () => {
                const entity = new TestBattleArmorEntity(registry());
                entity.motiveType.set('Jump');
                entity.propulsionMP.set(4);
                addTestEquipment(entity, laser, { location: 'Squad' });
                return entity;
            },
            'a tank, whose BV movement ignores the modular-armor MP penalty': () => {
                const entity = new TestTankEntity(registry());
                entity.setTonnage(40);
                entity.originalWalkMP.set(4);
                addTestEquipment(entity, modularArmor, { location: 'Front' });
                return entity;
            },
            'a DropShip carrying authored slug LB-X ammo': () => {
                const entity = new TestDropShipEntity(registry());
                addTestEquipment(entity, lbx, { location: 'Nose' });
                addTestEquipment(entity, slug, { location: 'Nose', shotsCount: 10 });
                return entity;
            },
        };
        for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
            for (const [name, create] of Object.entries(cases)) {
                it(`equals the entity BV for ${name} in ${ruleset}`, () => {
                    const entity = create();
                    entity.uuid.set(UUID);
                    const runtime = createNonMekRuntimeForTest('unit:pristine-bv', { ...baseline(), ruleset }, entity, ruleset);
                    expect(runtime.query().currentBaseBattleValue()).toBe(entity.battleValue(ruleset));
                });
            }
        }

        it('loads the authored aerospace munition even when it is not a valid replacement', () => {
            const entity = cases['a DropShip carrying authored slug LB-X ammo']();
            entity.uuid.set(UUID);
            const bin = entity.equipment().find(mount => mount.equipment === slug)!;
            const runtime = createNonMekRuntimeForTest('unit:authored-ammo', baseline(), entity, CORE_2026_RULESET);
            expect(runtime.query().remainingAmmo(componentIdForMount(bin))).toBe(10);
            expect(runtime.query().ammoEquipment(componentIdForMount(bin))).toBe(slug);
        });
    });

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
            const runtime = createNonMekRuntimeForTest(
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
        const runtime = createNonMekRuntimeForTest(
            'unit:deferred-crew-death',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;
        const deployment = {
            values: {
                id: 'deployment:deferred-crew-death',
                crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            },
        } as const;

        expect(runtime.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 6,
            unconscious: true,
            ejected: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().hasPendingPhaseChanges()).toBeTrue();
        expect(CrewMember.from(runtime.snapshot().crew.get(positionId)).effectiveState()).toBe('ejected');

        const pendingSave = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment,
        });
        expect(pendingSave.crewState?.[0]?.dead).toBeUndefined();
        const pendingRestore = restoreNonMekRuntimeForTest(pendingSave, entity, CORE_2026_RULESET);
        const pendingCrew = pendingRestore.query().crewState(positionId);
        expect(pendingCrew).toEqual(jasmine.objectContaining({
            unconscious: true,
            ejected: true,
        }));
        expect(pendingCrew.dead).toBeUndefined();
        expect(CrewMember.from(pendingRestore.snapshot().crew.get(positionId)).effectiveState()).toBe('ejected');

        expect(pendingRestore.dispatch({ type: 'end-phase' }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(pendingRestore.query().crewState(positionId)).toEqual(jasmine.objectContaining({
            dead: true,
            unconscious: true,
            ejected: true,
        }));
        expect(pendingRestore.query().hasPendingPhaseChanges()).toBeFalse();
        expect(CrewMember.from(pendingRestore.snapshot().crew.get(positionId)).effectiveState()).toBe('dead');

        const committedSave = serializeNonMekUnit({
            entity: pendingRestore.getUnit(), index: pendingRestore.getIndex(), state: pendingRestore.snapshot(), baselineRef: pendingRestore.baselineRef, instanceId: pendingRestore.instanceId,
            uuid: baseline().entity,
            deployment,
        });
        expect(committedSave.crewState?.[0]?.dead).toBeTrue();
        const committedRestore = restoreNonMekRuntimeForTest(committedSave, entity, CORE_2026_RULESET);
        expect(committedRestore.query().crewState(positionId).dead).toBeTrue();
        expect(committedRestore.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 5,
            unconscious: true,
            ejected: true,
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
        const runtime = createNonMekRuntimeForTest(
            'unit:air-ground-conditions',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );

        expect(runtime.query().conditions()).not.toContain('airborne');
        expect(runtime.query().conditions()).not.toContain('grounded');
        expect(runtime.dispatch({
            type: 'set-airborne',

            airborne: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().hasCondition('grounded')).toBeTrue();
        expect(runtime.query().hasCondition('airborne')).toBeFalse();

        expect(runtime.dispatch({
            type: 'set-airborne',

            airborne: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().hasCondition('airborne')).toBeTrue();
        expect(runtime.query().hasCondition('grounded')).toBeFalse();
        expect(runtime.dispatch({
            type: 'set-condition',

            condition: 'grounded',
            active: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const jumpShip = new TestJumpShipEntity();
        jumpShip.uuid.set(UUID);
        const spaceOnly = createNonMekRuntimeForTest(
            'unit:airborne-only-conditions',
            baseline(),
            jumpShip,
            CORE_2026_RULESET,
        );
        expect(spaceOnly.snapshot().turn.airborne).toBeTrue();
        expect(spaceOnly.query().conditions()).not.toContain('airborne');
        expect(spaceOnly.query().conditions()).not.toContain('grounded');

        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        const groundOnly = createNonMekRuntimeForTest(
            'unit:ground-only-conditions',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        expect(groundOnly.snapshot().turn.airborne).toBeNull();
        expect(groundOnly.query().conditions()).not.toContain('airborne');
        expect(groundOnly.query().conditions()).not.toContain('grounded');
        expect(groundOnly.dispatch({
            type: 'set-airborne',

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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-delayed-power',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const searchlightId = componentIdForMount(searchlight);
        const minesweeperId = componentIdForMount(minesweeper);

        expect(runtime.query().componentMode(searchlightId)).toBe('enabled');
        expect(runtime.query().componentMode(minesweeperId)).toBe('enabled');
        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: searchlightId,
            mode: 'disabled',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: searchlightId,
            mode: 'disabling',
        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(searchlightId)).toBe('disabling');
        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(searchlightId)).toBe('disabled');

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: searchlightId,
            mode: 'enabling',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(searchlightId)).toBe('enabled');
        expect(runtime.snapshot().components.has(searchlightId)).toBeFalse();
    });

    it('keeps ProtoMek EI fixed while allowing vehicle EI power switching', () => {
        const protoMek = new TestProtoMekEntity();
        protoMek.uuid.set(UUID);
        const protoEi = addTestEquipmentWithFlags(protoMek, 'F_EI_INTERFACE', {
            location: 'Torso',
        });
        const protoRuntime = createNonMekRuntimeForTest(
            'unit:protomek-ei',
            baseline(),
            protoMek,
            CORE_2026_RULESET,
        );
        expect(protoRuntime.query().componentMode(componentIdForMount(protoEi))).toBeUndefined();
        expect(protoRuntime.dispatch({
            type: 'set-component-mode',

            componentId: componentIdForMount(protoEi),
            mode: 'disabling',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const tank = new TestTankEntity();
        tank.uuid.set(UUID);
        const vehicleEi = addTestEquipmentWithFlags(tank, 'F_EI_INTERFACE', {
            location: tank.locationOrder[0],
        });
        const tankRuntime = createNonMekRuntimeForTest(
            'unit:tank-ei',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        expect(tankRuntime.query().componentMode(componentIdForMount(vehicleEi))).toBe('enabled');
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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-probe-handoff',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const firstId = componentIdForMount(first);
        const secondId = componentIdForMount(second);

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: secondId,
            mode: 'enabling',
        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(firstId)).toBe('enabled');
        expect(runtime.query().componentMode(secondId)).toBe('enabling');

        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(firstId)).toBe('disabled');
        expect(runtime.query().componentMode(secondId)).toBe('enabled');
    });

    it('stores damage sparsely and resolves current values against the entity', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        entity.setArmorValue(entity.locationOrder[0], 'front', 2);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0];
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0])!;

        const internal = runtime.dispatch({
            type: 'set-internal-damage',

            locationId: location.id,
            damage: Math.min(1, location.internalPoints),
        });
        const armor = runtime.dispatch({
            type: 'set-armor-damage',

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

    it('stores vehicle killed/stunned controls as canonical crew facts', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-crew-state',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;

        expect(runtime.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: true,
            ejected: false,
        }).accepted).toBeTrue();
        expect(runtime.query().hasPendingPhaseChanges()).toBeTrue();
        expect(CrewMember.from(runtime.snapshot().crew.get(positionId)).hasState('stunned')).toBeTrue();

        const saved = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
                values: {
                    id: 'deployment:tank-crew-state',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.crewState).toEqual([{
            positionId,
            wounds: 0,
            unconscious: true,
            ejected: false,
        }]);
        const restored = restoreNonMekRuntimeForTest(saved, entity, CORE_2026_RULESET);
        expect(restored.snapshot().crew.get(positionId)?.unconscious).toBeTrue();

        expect(restored.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 0,
            unconscious: true,
            ejected: false,
            dead: true,
        }).accepted).toBeTrue();
        expect(CrewMember.from(restored.snapshot().crew.get(positionId))).toEqual(jasmine.objectContaining({
            wounds: 6,
            dead: true,
        }));
        expect(serializeNonMekUnit({
            entity: restored.getUnit(), index: restored.getIndex(), state: restored.snapshot(), baselineRef: restored.baselineRef, instanceId: restored.instanceId,
            uuid: baseline().entity,
            deployment: saved.deployment,
        }).crewState).toEqual([{
            positionId,
            wounds: 6,
            unconscious: true,
            ejected: false,
            dead: true,
        }]);
        expect(restored.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 0,
            unconscious: true,
            ejected: false,
            dead: false,
        }).accepted).toBeTrue();
        expect(CrewMember.from(restored.snapshot().crew.get(positionId))).toEqual(jasmine.objectContaining({
            wounds: 0,
            unconscious: true,
        }));

        const reset = restored.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
        });
        expect(reset).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(restored.snapshot().crew.has(positionId)).toBeFalse();
        expect(restored.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(restored.dispatch({ type: 'end-phase' }).accepted).toBeTrue();
        expect(restored.query().hasPendingPhaseChanges()).toBeFalse();
    });

    it('preserves a wound-tracking pilot after reassignment to a vehicle', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest(
            'unit:transferred-pilot',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;

        expect(runtime.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 3,
            unconscious: true,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().crewState(positionId).wounds).toBe(3);

        expect(runtime.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 6,
            unconscious: false,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().crewState(positionId).isDeathCommitted()).toBeFalse();

        runtime.dispatch({ type: 'end-phase' });
        expect(runtime.query().crewState(positionId)).toEqual(jasmine.objectContaining({
            wounds: 6,
            dead: true,
        }));
    });

    it('exposes effective vehicle rules through the direct runtime query surface', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.originalWalkMP.set(8);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-effective-rules',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            dead: true,
        });

        expect(runtime.query().conditions()).toEqual(['abandoned', 'immobile']);
        expect(runtime.query().hasCondition('immobile')).toBeTrue();
        expect(vehicleRuntimeRulesForTest(runtime)?.movement).toEqual(jasmine.objectContaining({ walk: 0, maxRun: 0 }));

        runtime.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            dead: false,
        });
        runtime.dispatch({
            type: 'damage-track',

            damageTrackId: systemDamageId('engine', 1),
            amount: 1,
            target: 'committed',
            timestamp: 1,
        });

        expect(runtime.query().conditions()).toEqual([]);
        expect(vehicleRuntimeRulesForTest(runtime)).toEqual(jasmine.objectContaining({
            systems: jasmine.objectContaining({ engineHit: true }),
            movement: jasmine.objectContaining({ walk: 0, maxRun: 0 }),
        }));
    });

    it('scopes projected Non-Mek rules to one immutable query revision', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-query-projection-scope',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const before = runtime.query();
        expect(before.destroyed()).toBeFalse();

        expect(runtime.dispatch({
            type: 'set-destroyed',

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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-pending',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0];
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0])!;

        expect(runtime.dispatch({
            type: 'damage-armor',

            faceId: face.id,
            amount: 2,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.query().remainingArmor(face.id)).toBe(3);
        expect(runtime.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(2);

        expect(runtime.dispatch({
            type: 'repair-armor',

            faceId: face.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().pendingCombat.armorDamage.get(face.id)).toBe(1);

        expect(runtime.dispatch({
            type: 'damage-internal',

            locationId: location.id,
            amount: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();
        expect(runtime.query().remainingArmor(face.id)).toBe(2);
        expect(runtime.query().remainingInternal(location.id)).toBe(location.internalPoints - 1);
        expect(runtime.snapshot().pendingCombat.armorDamage.size).toBe(0);
        expect(runtime.snapshot().pendingCombat.locationInternalDamage.size).toBe(0);
        expect(runtime.snapshot().turn.endTurnCheckpoint).toBeUndefined();
    });

    it('owns vehicle movement, semantic phase boundaries, and turn reset directly', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(60);
        entity.originalWalkMP.set(8);
        const booster = addTestEquipmentWithFlags(entity, ['F_MASC', 'S_SUPERCHARGER']);
        const boosterComponentId = componentIdForMount(booster);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-turn',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        expect(runtime.dispatch({
            type: 'set-movement',

            movement: { mode: 'run', distance: 16, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            type: 'edit-escalating-failure',

            componentId: boosterComponentId,
            edit: { kind: 'select-sequence', index: 0 },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.dispatch({
            type: 'set-movement',

            movement: { mode: 'run', distance: 16, boosterComponentIds: [boosterComponentId] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.snapshot().turn.movement).toEqual({
            mode: 'run',
            distance: 16,
            boosterComponentIds: [boosterComponentId],
        });
        expect(runtime.snapshot().turn.phaseStateChanged).toBeTrue();

        const beforePhase = runtime.revision();
        expect(runtime.dispatch({
            type: 'end-phase',

        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(Number(runtime.revision())).toBe(Number(beforePhase) + 1);
        expect(runtime.snapshot().turn.movement?.distance).toBe(16);
        expect(runtime.snapshot().turn.phaseStateChanged).toBeFalse();

        const saved = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
                values: {
                    id: 'deployment:tank-turn',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.turn).toEqual({
            movement: { mode: 'run', distance: 16, boosterComponentIds: [boosterComponentId] },
        });
        const restored = restoreNonMekRuntimeForTest(saved, entity, CORE_2026_RULESET);
        expect(restored.snapshot().turn).toEqual(runtime.snapshot().turn);

        expect(restored.dispatch({
            type: 'end-turn', policy: 'automatic',

        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(restored.snapshot().components.get(boosterComponentId)?.escalatingFailure).toEqual({
            sequence: 1,
        });
        expect(restored.snapshot().turn).toEqual({
            turnCounter: 1,
            airborne: null,
            movement: null,
            weaponsHeat: 0,
            settledHeat: jasmine.objectContaining({ size: 0 }),
            cover: null,
            spotting: false,
            phaseStateChanged: false,
            turnStep: 0,
        });
    });

    it('owns origin/next cover, spotting, and defense summary state in the Entity runtime', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(40);
        entity.originalWalkMP.set(4);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-turn-summary',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        expect(runtime.dispatch({
            type: 'set-cover',

            cover: 'building-1',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.dispatch({
            type: 'set-spotting',

            spotting: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.dispatch({
            type: 'set-movement',

            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));

        expect(runtime.snapshot().turn).toEqual(jasmine.objectContaining({
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
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
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
        expect(restoreNonMekRuntimeForTest(saved, entity, CORE_2026_RULESET).snapshot().turn).toEqual(runtime.snapshot().turn);

        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().turn).toEqual(jasmine.objectContaining({
            cover: null,
            spotting: false,
        }));
    });

    it('round-trips durable End Turn progress and clears it with the completed turn', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(40);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-end-turn-checkpoint',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        expect(runtime.dispatch({
            type: 'end-phase',

            endTurnBoundary: true,
        }).accepted).toBeTrue();
        expect(runtime.snapshot().turn.endTurnCheckpoint).toBe('phase-ended');
        expect(runtime.dispatch({
            type: 'mark-end-turn-heat-staged',

        }).accepted).toBeTrue();

        const saved = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
                values: {
                    id: 'deployment:tank-end-turn-checkpoint',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        expect(saved.turn).toEqual({ endTurnCheckpoint: 'heat-staged' });
        const restored = restoreNonMekRuntimeForTest(saved, entity, CORE_2026_RULESET);
        expect(restored.snapshot().turn.endTurnCheckpoint).toBe('heat-staged');
        expect(restored.dispatch({
            type: 'end-turn',

            policy: 'manual',
        }).accepted).toBeTrue();
        expect(restored.snapshot().turn.endTurnCheckpoint).toBeUndefined();
    });

    it('round-trips due crew and aerospace Control recovery without an in-memory timer', () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.uuid.set(UUID);
        entity.heatSinkCount.set(10);
        const runtime = createNonMekRuntimeForTest(
            'unit:aero-durable-recovery',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const pilotId = [...runtime.getIndex().crewPositions.keys()][0]!;
        expect(runtime.dispatch({
            type: 'set-condition',

            condition: 'out-of-control',
            active: true,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'set-control-recovery',

            workflow: { readyTurn: 1, cause: 'heat-random-movement' },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            recoveryReadyTurn: 1,
        }).accepted).toBeTrue();

        const saved = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
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

        const restored = restoreNonMekRuntimeForTest(saved, entity, CORE_2026_RULESET);
        expect(restored.snapshot().turn.controlRecovery).toEqual(saved.turn?.controlRecovery);
        expect(restored.query().crewState(pilotId).recoveryReadyTurn).toBe(1);
        for (let turn = 1; turn <= 2; turn += 1) {
            expect(restored.dispatch({
                type: 'end-turn',

                policy: 'manual',
            }).accepted).toBeTrue();
            expect(restored.snapshot().turn.turnCounter).toBe(turn);
            expect(restored.snapshot().turn.controlRecovery).toEqual(saved.turn?.controlRecovery);
        }
        expect(restored.dispatch({
            type: 'set-condition',

            condition: 'out-of-control',
            active: false,
        }).accepted).toBeTrue();
        expect(restored.snapshot().turn.controlRecovery).toBeUndefined();
    });

    it('matches origin/next attacker movement badges by loaded Entity family', () => {
        expect(nonMekAttackMovementModifier(new TestTankEntity(), 'run')).toBe(2);
        expect(nonMekAttackMovementModifier(new TestProtoMekEntity(), 'jump')).toBe(3);
        expect(nonMekAttackMovementModifier(new TestInfantryEntity(), 'walk')).toBe(0);
        expect(nonMekAttackMovementModifier(new TestAeroSpaceFighterEntity(), 'run')).toBe(0);
    });

    it('allows active actions for entities with no crew positions', () => {
        const entity = new TestHandheldWeaponEntity();
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest(
            'unit:handheld-no-crew',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        expect(runtime.getIndex().crewPositions.size).toBe(0);
        expect(canNonMekTakeActiveActions(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        )).toBeTrue();
    });

    it('denies active turn actions without a live controller and permits a drone controller', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.originalWalkMP.set(4);
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-no-controller',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;

        expect(runtime.dispatch({
            type: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            dead: true,
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
            type: 'set-spotting',

            spotting: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            type: 'set-movement',

            movement: { mode: 'walk', distance: 1, boosterComponentIds: [] },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const droneEntity = new TestTankEntity();
        droneEntity.uuid.set(UUID);
        droneEntity.originalWalkMP.set(4);
        addTestEquipmentWithFlags(droneEntity, 'F_DRONE_OPERATING_SYSTEM');
        const droneRuntime = createNonMekRuntimeForTest(
            'unit:tank-drone-controller',
            baseline(),
            droneEntity,
            CORE_2026_RULESET,
        );
        const droneCrewPositionId = [...droneRuntime.getIndex().crewPositions.keys()][0]!;
        expect(droneRuntime.dispatch({
            type: 'set-crew-state',

            positionId: droneCrewPositionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            dead: true,
        }).accepted).toBeTrue();
        expect(canNonMekTakeActiveActions(
            droneEntity,
            droneRuntime.getIndex(),
            droneRuntime.snapshot(),
            CORE_2026_RULESET,
        )).toBeTrue();
        expect(droneRuntime.dispatch({
            type: 'set-spotting',

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
        const runtime = createNonMekRuntimeForTest(
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
            type: 'set-movement',

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
            type: 'edit-escalating-failure',

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
            type: 'set-movement',

            movement: { mode: 'run', distance: 12, boosterComponentIds: [boosterId] },
        }).accepted).toBeTrue();

        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(boosterId)?.escalatingFailure).toEqual({ sequence: 1 });
        expect(projectNonMekMovementCapabilities(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
        ).maximum.run).toBe(9);
        expect(runtime.dispatch({
            type: 'edit-escalating-failure',

            componentId: boosterId,
            edit: { kind: 'set-status', status: 'disabled' },
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(boosterId)).toEqual(jasmine.objectContaining({
            statusOverride: 'disabled',
            escalatingFailure: { sequence: 1 },
        }));
        expect(runtime.dispatch({
            type: 'edit-escalating-failure',

            componentId: boosterId,
            edit: { kind: 'set-status', status: 'available' },
        }).accepted).toBeTrue();

        const crewId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            type: 'set-crew-state',

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
            sprint: 0,
            jump: 0,
            UMU: 0,
            VTOL: 0,
            tracked: 0,
        });
    });

    it('preserves the Total Warfare Blue Shield exemption for aerospace fighters', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        const blueShield = addTestEquipmentWithFlags(fighter, 'F_BLUE_SHIELD', { location: 'Nose' });
        const componentId = componentIdForMount(blueShield);
        const totalWarfare = createNonMekRuntimeForTest(
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
            type: 'edit-escalating-failure',
            componentId,
            edit: { kind: 'select-sequence', index: 0 },
        }).changed).toBeFalse();

        const core = createNonMekRuntimeForTest(
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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-equipment',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0];
        expect(String(componentId)).toBe(String(mount.mountId));

        expect(runtime.dispatch({
            type: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();
        expect(runtime.snapshot().pendingCombat.componentStatus.get(componentId)).toBe('destroyed');

        expect(runtime.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(componentId)?.statusOverride).toBe('destroyed');

        expect(runtime.dispatch({
            type: 'configure-ammo-source',

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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-unowned-mode',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0]!;
        expect(runtime.query().componentMode(componentId)).toBeUndefined();
        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId,
            mode: 'Rapid',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();

        const saved = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
                values: {
                    id: 'deployment:tank-unowned-mode',
                    crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
                },
            },
        });
        const restored = restoreNonMekRuntimeForTest({
            ...saved,
            componentState: Object.freeze([Object.freeze({ componentId, mode: 'Rapid' })]),
        }, entity, CORE_2026_RULESET);
        expect(restored.query().componentMode(componentId)).toBeUndefined();
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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-uac-mode',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = [...runtime.getIndex().components.keys()][0]!;
        expect(runtime.query().componentMode(componentId)).toBe('Single');

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId,
            mode: 'Ultra',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.get(componentId)?.mode).toBe('Ultra');
        expect(runtime.query().componentMode(componentId)).toBe('Ultra');

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId,
            mode: 'Single',
        }).accepted).toBeTrue();
        expect(runtime.snapshot().components.has(componentId)).toBeFalse();
        expect(runtime.query().componentMode(componentId)).toBe('Single');

        runtime.dispatch({
            type: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'pending',
        });
        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId,
            mode: 'Ultra',
        }).accepted).toBeTrue();
        runtime.dispatch({ type: 'end-phase'});
        expect(runtime.dispatch({
            type: 'set-component-mode',

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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-mml-mode',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = componentIdForMount(weaponMount);

        expect(runtime.query().componentMode(componentId)).toBe('LRM');
        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId,
            mode: 'SRM',
        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(componentId)).toBe('SRM');
    });

    it('owns vehicle weapon targeting and exact ammunition preference in sparse runtime state', () => {
        const fixture = targetingFixture('unit:tank-targeting');
        const durableRevision = fixture.runtime.revision();

        expect(fixture.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',

            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',

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
        expect(fixture.runtime.revision()).toBe(durableRevision);
    });

    it('keeps grouped weapon selection transient while damage advances one revision', () => {
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
        const runtime = createNonMekRuntimeForTest(
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
            type: 'edit-attacker-targeting',

            edit: {
                kind: 'set-component-selections',
                componentIds,
                selection: { kind: 'selected' },
            },
        }, registry, false)).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.revision()).toBe(selectionRevision);
        expect(componentIds.map(componentId => runtime.query().attackerTargetingState()
            .components.get(componentId)?.selection)).toEqual(Array.from(
                { length: 4 },
                () => ({ kind: 'selected' }),
            ));

        const damageRevision = runtime.revision();
        expect(runtime.dispatch({
            type: 'set-component-statuses',

            componentIds,
            status: 'destroyed',
            target: 'pending',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.revision()).toBe(damageRevision + 1);
        expect(componentIds.map(componentId => runtime.query().componentStatus(componentId, 'preview')))
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
                type: 'edit-attacker-targeting',

                edit,
            }, fixture.registry, false).accepted).toBeTrue();
        }

        const result = fixture.runtime.dispatchSelectedWeaponFire({
            type: 'fire-selected-weapons',

        }, fixture.registry, false, false);

        expect(result).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.runtime.query().remainingAmmo(fixture.ammoId)).toBe(9);
        expect(fixture.runtime.snapshot().turn.weaponsHeat).toBe(0);
        // A weapon fires once a turn: firing again while it stays selected spends nothing.
        expect(fixture.runtime.snapshot().turn.firedWeapons).toEqual([fixture.weaponId]);
        expect(fixture.runtime.dispatchSelectedWeaponFire({ type: 'fire-selected-weapons' },
            fixture.registry, false, false).changed).toBeFalse();
        expect(fixture.runtime.query().remainingAmmo(fixture.ammoId)).toBe(9);
    });

    it('counts a missed lock as fired without ammo or heat, for lock-on weapons only (TW p. 138)', () => {
        for (const ammoType of ['SRM_STREAK', 'AC'] as const) {
            const fixture = targetingFixture(`unit:no-lock-${ammoType}`, ammoType);
            for (const edit of [{
                kind: 'set-component-selection' as const,
                componentId: fixture.weaponId,
                selection: { kind: 'target' as const, targetId: fixture.targetId },
            }, {
                kind: 'set-component-ammo' as const,
                componentId: fixture.weaponId,
                ammo: { munitionKey: fixture.ammo.internalName, preferredSourceId: fixture.ammoId },
            }]) {
                fixture.runtime.dispatchAttackerTargeting({ type: 'edit-attacker-targeting', edit }, fixture.registry, false);
            }

            const result = fixture.runtime.dispatchSelectedWeaponFire({
                type: 'fire-selected-weapons', noLock: [fixture.weaponId],
            }, fixture.registry, false, false);

            if (ammoType === 'SRM_STREAK') {
                expect(result.changed).toBeTrue();
                expect(fixture.runtime.query().remainingAmmo(fixture.ammoId)).toBe(10);
                expect(fixture.runtime.snapshot().turn.weaponsHeat).toBe(0);
                expect(fixture.runtime.snapshot().turn.firedWeapons).toEqual([fixture.weaponId]);
            } else {
                // An autocannon has no lock to miss.
                expect(result.changed).toBeFalse();
                expect(fixture.runtime.query().remainingAmmo(fixture.ammoId)).toBe(10);
            }
        }
    });

    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        for (const { status, heat, expectedHeat, bombastMode } of [
            { status: 'available', heat: 5, expectedHeat: 4, bombastMode: undefined },
            { status: 'disabled', heat: 5, expectedHeat: 5, bombastMode: undefined },
            { status: 'destroyed', heat: 5, expectedHeat: 5, bombastMode: undefined },
            { status: 'available', heat: 1, expectedHeat: 1, bombastMode: undefined },
            { status: 'available', heat: 12, expectedHeat: ruleset === CORE_2026_RULESET ? 5 : 7, bombastMode: 'Damage 8' },
        ] as const) {
            it(`uses the ${status} laser insulator for displayed and fired aerospace heat ${heat} in ${ruleset}`, () => {
                const laser = new WeaponEquipment({
                    id: 'InsulatedLaser', name: 'Insulated Laser', type: 'weapon',
                    flags: ['F_LASER', 'F_ENERGY', 'F_DIRECT_FIRE', ...(bombastMode === undefined ? [] : ['F_BOMBAST_LASER' as const])],
                    weapon: { damage: 5, heat, ranges: [3, 6, 9, 12], av: [5, 0, 0, 0] },
                });
                const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
                entity.uuid.set(UUID);
                const mount = addTestEquipment(entity, laser, { location: 'Nose' });
                const insulator = addTestEquipmentWithFlags(entity, 'F_LASER_INSULATOR', { location: 'Nose' });
                entity.linkEquipment(insulator, mount);
                const runtime = createNonMekRuntimeForTest(
                    'unit:aero-insulated-laser', { ...baseline(), ruleset }, entity, ruleset,
                );
                if (status !== 'available') {
                    expect(runtime.dispatch({
                        type: 'set-component-status', componentId: componentIdForMount(insulator),
                        status, target: 'committed',
                    }).changed).toBeTrue();
                }
                const weaponId = componentIdForMount(mount);
                if (bombastMode !== undefined) {
                    expect(runtime.dispatch({ type: 'set-component-mode', componentId: weaponId, mode: bombastMode }).changed).toBeTrue();
                }
                const targetId = asEncounterTargetId('target:aero-insulator');
                const registry: TargetRegistrySnapshot = {
                    revision: 0,
                    targets: [{ id: targetId, letter: 'A', name: 'Target A', color: '#ff0000', source: 'manual', readOnly: false }],
                };
                expect(runtime.dispatchAttackerTargeting({
                    type: 'edit-attacker-targeting',
                    edit: { kind: 'set-component-selection', componentId: weaponId, selection: { kind: 'target', targetId } },
                }, registry, false).accepted).toBeTrue();

                const panel = projectNonMekEquipmentPanel(
                    entity, runtime.getIndex(), ruleset, runtime.snapshot(), runtime.query(), registry, {},
                );
                const row = panel.components.find(component => component.componentId === weaponId)!;
                expect(row.weapon?.heat).toBe(expectedHeat);
                expect(row.weapon?.firingHeat).toBe(expectedHeat);
                expect(row.heatWeakened).toBe(status !== 'available');
                if (bombastMode !== undefined) {
                    expect(row.weapon?.hit.default.value).toBe(ruleset === CORE_2026_RULESET ? 0 : 1);
                }
                expect(runtime.dispatchSelectedWeaponFire({
                    type: 'fire-selected-weapons', 
                }, registry, false, false).changed).toBeTrue();
                expect(runtime.snapshot().turn.weaponsHeat).toBe(expectedHeat);
            });
        }
    }

    for (const ruleset of [CORE_2026_RULESET, TOTAL_WARFARE_RULESET]) {
        it(`fires an insulated aerospace small laser in pulse mode after reload under ${ruleset}`, () => {
            const laser = new WeaponEquipment({ id: 'Small Laser', name: 'Small Laser', type: 'weapon',
                flags: ['F_LASER', 'F_ENERGY', 'F_DIRECT_FIRE', 'F_RISC_LASER_PULSE_COMPATIBLE'], weapon: { heat: 1, damage: 3, ranges: [1, 2, 3, 4] } });
            const entity = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
            entity.uuid.set(UUID);
            const mount = addTestEquipment(entity, laser, { location: 'Nose' });
            const weaponId = componentIdForMount(mount);
            const insulator = addTestEquipmentWithFlags(entity, 'F_LASER_INSULATOR', { location: 'Nose' });
            const spare = addTestEquipmentWithFlags(entity, 'F_LASER_INSULATOR', { location: 'Nose' });
            const module = addTestEquipmentWithFlags(entity, 'F_RISC_LASER_PULSE_MODULE', { location: 'Nose' });
            for (const source of [insulator, module, spare]) entity.linkEquipment(source, mount);
            let runtime = createNonMekRuntimeForTest('unit:pulse-insulated', { ...baseline(), ruleset }, entity, ruleset);
            expect(runtime.dispatch({ type: 'set-component-mode', componentId: weaponId, mode: 'Pulse' }).changed).toBeTrue();
            expect(runtime.dispatch({ type: 'set-component-status', componentId: componentIdForMount(insulator),
                status: 'disabled', target: 'committed' }).changed).toBeTrue();
            const saved = serializeNonMekUnit({ entity, index: runtime.getIndex(), state: runtime.snapshot(),
                baselineRef: runtime.baselineRef, instanceId: runtime.instanceId, uuid: baseline().entity,
                deployment: { values: { id: 'deployment:test', crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions) } },
            });
            runtime = restoreNonMekRuntimeForTest(saved, entity, ruleset);
            const targetId = asEncounterTargetId('target:multi');
            const registry: TargetRegistrySnapshot = { revision: 0,
                targets: [{ id: targetId, letter: 'A', name: 'Target', color: '#123456', source: 'manual', readOnly: false }] };
            expect(runtime.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                edit: { kind: 'set-component-selection', componentId: weaponId, selection: { kind: 'target', targetId } },
            }, registry, false).accepted).toBeTrue();
            const row = () => projectNonMekEquipmentPanel(entity, runtime.getIndex(), ruleset, runtime.snapshot(),
                runtime.query(), registry, {}).components.find(component => component.componentId === weaponId)!;
            expect(row().heatWeakened).toBeFalse();
            expect(row().weapon?.heat).toBe(2);
            expect(row().weapon?.effectiveWeaponTypes).toContain('P');
            expect(runtime.dispatchSelectedWeaponFire({ type: 'fire-selected-weapons' }, registry, false, false).changed).toBeTrue();
            expect(runtime.snapshot().turn.weaponsHeat).toBe(2);
            expect(runtime.dispatch({ type: 'set-component-status', componentId: componentIdForMount(module),
                status: 'destroyed', target: 'committed' }).changed).toBeTrue();
            expect(row().weapon?.heat).toBe(1);
            expect(row().weapon?.effectiveWeaponTypes).not.toContain('P');
        });
    }

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
        const runtime = createNonMekRuntimeForTest(
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
            type: 'edit-attacker-targeting',

            edit: {
                kind: 'set-component-selection',
                componentId: weaponId,
                selection: { kind: 'target', targetId },
            },
        }, registry, false).accepted).toBeTrue();

        const result = runtime.dispatchSelectedWeaponFire({
            type: 'fire-selected-weapons',

        }, registry, false, false);

        expect(result).toEqual(jasmine.objectContaining({
            accepted: true,
            prototypeHeat: [],
        }));
        expect(runtime.snapshot().turn.weaponsHeat).toBe(10);
    });

    it('keeps a pending-destroyed vehicle weapon actionable until phase commit', () => {
        const fixture = targetingFixture('unit:tank-targeting-destroyed');
        fixture.runtime.dispatch({
            type: 'set-component-status',

            componentId: fixture.weaponId,
            status: 'destroyed',
            target: 'pending',
        });

        expect(fixture.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',

            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false)).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: true,
        }));
        fixture.runtime.dispatch({ type: 'end-phase'});
        expect(fixture.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',

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
            type: 'set-destroyed',

            destroyed: true,
        }).accepted).toBeTrue();

        expect(fixture.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',

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
            type: 'edit-attacker-targeting',

            edit: {
                kind: 'set-component-selection',
                componentId: fixture.weaponId,
                selection: { kind: 'target', targetId: fixture.targetId },
            },
        }, fixture.registry, false);
        fixture.runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',

            edit: {
                kind: 'set-target-facts',
                targetId: fixture.targetId,
                facts: { distance: 8 },
            },
        }, fixture.registry, false);
        const before = fixture.runtime.revision();
        const plan = fixture.runtime.planTargetingReconciliation(Object.freeze({
            revision: 1,
            targets: Object.freeze([]),
        }));

        expect(plan).not.toBeNull();
        plan!();
        expect(fixture.runtime.revision()).toBe(before);
        expect(fixture.runtime.query().attackerTargetingState().components.has(fixture.weaponId)).toBeFalse();
        expect(fixture.runtime.query().attackerTargetingState().targets.has(fixture.targetId)).toBeFalse();
    });

    it('resets session targeting instead of writing it to the Entity force format', () => {
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
                type: 'edit-attacker-targeting',

                edit,
            }, fixture.registry, false);
            expect(result.accepted).toBeTrue();
        }
        const saved = serializeNonMekUnit({
            entity: fixture.runtime.getUnit(), index: fixture.runtime.getIndex(), state: fixture.runtime.snapshot(), baselineRef: fixture.runtime.baselineRef, instanceId: fixture.runtime.instanceId,
            uuid: baseline().entity,
            deployment: {
                values: {
                    id: 'deployment:tank-targeting',
                    crewAssignment: createDefaultCrewAssignment(fixture.runtime.getIndex().crewPositions),
                },
            },
        });

        expect(inspectSerializedNonMekUnit(saved).instanceId).toBe(fixture.runtime.instanceId);
        expect('attackerTargeting' in saved).toBeFalse();
        const restored = restoreNonMekRuntimeForTest(saved, fixture.entity, CORE_2026_RULESET);
        expect(restored.query().attackerTargetingState().components.size).toBe(0);
        expect(restored.query().attackerTargetingState().actions.size).toBe(0);
        expect(restored.query().attackerTargetingState().targets.size).toBe(0);
    });

    it('jams a non-Mek Ultra AC only where the ruleset lets it jam and keeps the jam across save', () => {
        const ultra = new WeaponEquipment({
            id: 'TestUltraAC5',
            name: 'Test Ultra AC/5',
            type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            modes: ['Single', 'Ultra'],
            weapon: { ammoType: 'AC_ULTRA', rackSize: 5, damage: 5, heat: 1, ranges: [3, 6, 9, 12] },
        });
        const laser = new WeaponEquipment({
            id: 'TestJamLaser',
            name: 'Test Laser',
            type: 'weapon',
            weapon: { damage: 5, heat: 3, ranges: [3, 6, 9, 12] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [ultra.id]: ultra, [laser.id]: laser }));
        entity.uuid.set(UUID);
        const ultraId = componentIdForMount(addTestEquipment(entity, ultra, { location: entity.locationOrder[0] }));
        const laserId = componentIdForMount(addTestEquipment(entity, laser, { location: entity.locationOrder[0] }));

        const core = createNonMekRuntimeForTest('unit:tank-uac-core', baseline(), entity, CORE_2026_RULESET);
        expect(core.dispatch({ type: 'set-component-jammed', componentId: ultraId, jammed: true }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: false }));

        const runtime = createNonMekRuntimeForTest('unit:tank-uac-jam',
            { ...baseline(), ruleset: TOTAL_WARFARE_RULESET }, entity, TOTAL_WARFARE_RULESET);
        expect(runtime.dispatch({ type: 'set-component-jammed', componentId: laserId, jammed: true }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({ type: 'set-component-jammed', componentId: ultraId, jammed: true }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(runtime.query().componentJammed(ultraId)).toBeTrue();
        expect(runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-component-selection', componentId: ultraId, selection: { kind: 'selected' } },
        }, Object.freeze({ revision: 0, targets: Object.freeze([]) }), false).changed).toBeFalse();

        const restored = restoreNonMekRuntimeForTest(runtime.serialize(), entity, TOTAL_WARFARE_RULESET);
        expect(restored.query().componentJammed(ultraId)).toBeTrue();
        expect(restored.dispatch({ type: 'set-component-jammed', componentId: ultraId, jammed: false }).changed)
            .toBeTrue();
        expect(restored.snapshot().components.has(ultraId)).toBeFalse();
    });

    it('rejects and clears non-Mek weapon targets that the shared target policy forbids', () => {
        const tag = new WeaponEquipment({
            id: 'TestTAG',
            name: 'Test TAG',
            type: 'weapon',
            flags: ['F_TAG'],
            weapon: { damage: 0, heat: 0, ranges: [5, 9, 15, 20] },
        });
        const laser = new WeaponEquipment({
            id: 'TestDirectLaser',
            name: 'Test Laser',
            type: 'weapon',
            weapon: { damage: 5, heat: 3, ranges: [3, 6, 9, 12] },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [tag.id]: tag, [laser.id]: laser }));
        entity.uuid.set(UUID);
        const tagId = componentIdForMount(addTestEquipment(entity, tag, { location: entity.locationOrder[0] }));
        const laserId = componentIdForMount(addTestEquipment(entity, laser, { location: entity.locationOrder[0] }));
        const runtime = createNonMekRuntimeForTest('unit:tank-target-policy',
            { ...baseline(), ruleset: TOTAL_WARFARE_RULESET }, entity, TOTAL_WARFARE_RULESET);
        const infantryId = asEncounterTargetId('target:infantry');
        const mekId = asEncounterTargetId('target:mek');
        const registry = (revision: number, mekType: TnTargetUnitType): TargetRegistrySnapshot => Object.freeze({
            revision,
            targets: Object.freeze(([[infantryId, 'A', 'infantry'], [mekId, 'B', mekType]] as const)
                .map(([id, letter, unitType]) => Object.freeze({
                    id, letter, name: `Target ${letter}`, color: '#ff0000',
                    source: 'manual' as const, readOnly: false, unitType,
                }))),
        });
        const initial = registry(0, 'mek-biped');
        const aim = (componentId: typeof tagId, targetId: EncounterTargetId) => runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-component-selection', componentId, selection: { kind: 'target', targetId } },
        }, initial, false);
        const selection = (componentId: typeof tagId) =>
            runtime.query().attackerTargetingState().components.get(componentId)?.selection;

        expect(aim(tagId, infantryId).changed).toBeFalse();
        expect(selection(tagId)).toBeUndefined();
        const panel = projectNonMekEquipmentPanel(entity, runtime.getIndex(), TOTAL_WARFARE_RULESET,
            runtime.snapshot(),
            runtime.query(), initial, {});
        expect(panel.components.find(row => row.componentId === tagId)?.weapon?.disabledTargetReasons[infantryId])
            .toBe(TARGET_TAG_INFANTRY_REASON);

        expect(aim(tagId, mekId).changed).toBeTrue();
        const retyped = registry(1, 'infantry');
        expect(runtime.dispatchSelectedWeaponFire({ type: 'fire-selected-weapons' },
            retyped, false, false).changed).toBeFalse();
        runtime.planTargetingReconciliation(retyped)!();
        expect(selection(tagId)).toBeUndefined();

        expect(aim(laserId, mekId).changed).toBeTrue();
        expect(runtime.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: { kind: 'set-target-facts', targetId: mekId, facts: { calculator: { indirectFire: true } } },
        }, initial, false).changed).toBeTrue();
        expect(selection(laserId)).toBeUndefined();
    });

    it('uses BaseEntity damage topology for Battle Armor and aerospace families', () => {
        const battleArmor = new TestBattleArmorEntity();
        battleArmor.uuid.set(UUID);
        battleArmor.trooperCount.set(4);
        battleArmor.setArmorValue('Squad', 'front', 5);
        const battleArmorRuntime = createNonMekRuntimeForTest(
            'unit:battle-armor',
            baseline(),
            battleArmor,
            CORE_2026_RULESET,
        );
        const battleArmorLocations = [...battleArmorRuntime.getIndex().locations.values()];
        expect(battleArmorLocations.map(location => location.code)).toEqual([
            'Trooper 1', 'Trooper 2', 'Trooper 3', 'Trooper 4',
        ]);
        const battleArmorSheet = projectNonMekRecordSheet(battleArmor, battleArmorRuntime.getIndex(),
            battleArmorRuntime.snapshot(), CORE_2026_RULESET, battleArmorRuntime.query(), 0, 0);
        expect(battleArmorSheet.locations.map(location => location.sheetCode)).toEqual(['T1', 'T2', 'T3', 'T4']);
        expect(battleArmorLocations.every(location => location.internalPoints === 1)).toBeTrue();
        expect(battleArmorSheet.locations.every(location => location.combinedPips)).toBeTrue();
        expect(battleArmorLocations.map(location =>
            battleArmorRuntime.getIndex().armorFaces.get(location.armorFaceIds[0])!.maximumPoints,
        )).toEqual([5, 5, 5, 5]);

        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.structuralIntegrity.set(7);
        const fighterRuntime = createNonMekRuntimeForTest(
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
        const warShipRuntime = createNonMekRuntimeForTest(
            'unit:warship',
            baseline(),
            warShip,
            CORE_2026_RULESET,
        );
        const warShipTracks = [...warShipRuntime.getIndex().locations.values()];
        expect(warShipTracks.find(location => location.code === 'SI')?.internalPoints).toBe(20);
        expect(warShipTracks.some(location => location.code === 'KF')).toBeTrue();
        expect(warShipTracks.some(location => location.code === 'SAIL')).toBeTrue();
    });

    it('round-trips only non-pristine aerospace heat state', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = createNonMekRuntimeForTest(
            'unit:fighter-heat-persistence',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const deployment = {
            values: {
                id: 'deployment:fighter-heat',
                crewAssignment: createDefaultCrewAssignment(runtime.getIndex().crewPositions),
            },
        } as const;
        expect(serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment,
        }).heat).toBeUndefined();

        runtime.dispatch({
            type: 'set-pending-heat',

            heat: 19,

        });
        runtime.dispatch({
            type: 'set-heatsinks-off',

            heatsinksOff: 2,
        });
        const saved = serializeNonMekUnit({
            entity: runtime.getUnit(), index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef, instanceId: runtime.instanceId,
            uuid: baseline().entity,
            deployment,
        });
        expect(saved.heat).toEqual({
            current: 0,
            previous: 0,
            pendingOverride: 19,
            heatsinksOff: 2,
        });
        expect(restoreNonMekRuntimeForTest(saved, fighter, CORE_2026_RULESET).snapshot().heat).toEqual(saved.heat!);
    });

    it('preserves an explicit current-heat override and clears it only with null', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(0);
        addTestEquipmentWithFlags(fighter, ['F_NOVA', 'F_ECM', 'F_BAP'], { location: 'Nose' });
        const runtime = createNonMekRuntimeForTest('unit:held-heat', baseline(), fighter, CORE_2026_RULESET);

        expect(runtime.dispatch({ type: 'set-pending-heat', heat: 0 }).changed).toBeTrue();
        const saved = runtime.serialize();
        expect(saved.heat?.pendingOverride).toBe(0);
        const restored = restoreNonMekRuntimeForTest(saved, fighter, CORE_2026_RULESET);
        restored.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(restored.snapshot().heat.current).toBe(0);

        restored.dispatch({ type: 'set-pending-heat', heat: 0 });
        expect(restored.dispatch({ type: 'set-pending-heat', heat: null }).changed).toBeTrue();
        expect(restored.snapshot().heat.pendingOverride).toBeUndefined();
        restored.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(restored.snapshot().heat.current).toBe(2);
    });

    it('holds outside heat and inferno missiles with their pending attack, capping the heat where it is read', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = createNonMekRuntimeForTest('unit:pending-outside-heat', baseline(), fighter, CORE_2026_RULESET);
        const held = () => {
            const { turn, pendingCombat } = runtime.snapshot();
            return [turn.outsideHeat ?? 0, pendingCombat.outsideHeat ?? 0, turn.infernoMissiles ?? 0,
                pendingCombat.infernoMissiles ?? 0];
        };
        const attack = () => {
            runtime.dispatch({ type: 'add-outside-heat', amount: 10, target: 'pending' });
            runtime.dispatch({ type: 'add-inferno-missiles', count: 2, target: 'pending' });
        };
        const outsideHeatSource = () => projectNonMekEndTurnHeat(fighter, runtime.getIndex(), runtime.snapshot(),
            CORE_2026_RULESET)!.sources.find(source => source.id === 'outside-heat')?.value;

        runtime.dispatch({ type: 'add-outside-heat', amount: 10, target: 'committed' });
        attack();
        expect(held()).toEqual([10, 10, 0, 2]);
        expect(outsideHeatSource()).toBe(15);
        // Cancelling the attack takes back its heat and missiles and leaves the committed heat whole.
        expect(runtime.dispatch({ type: 'cancel-pending' }).changed).toBeTrue();
        expect(held()).toEqual([10, 0, 0, 0]);
        // Ending the phase commits them, the heat within the cap of 15.
        attack();
        expect(runtime.dispatch({ type: 'end-phase' }).changed).toBeTrue();
        expect(held()).toEqual([15, 0, 2, 0]);
        expect(runtime.dispatch({ type: 'add-inferno-missiles', count: 1, target: 'elsewhere' as never }).changed)
            .toBeFalse();
        expect(held()).toEqual([15, 0, 2, 0]);
    });

    it('settles pending outside heat with the aerospace arrow on APPLY HEAT, and not again at End Turn', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const fresh = createNonMekRuntimeForTest('unit:applied-outside-heat', baseline(), fighter, CORE_2026_RULESET);
        const runtime = restoreNonMekRuntimeForTest({ ...fresh.serialize(), turn: { weaponsHeat: 14 } }, fighter, CORE_2026_RULESET);
        const projection = () => projectNonMekEndTurnHeat(fighter, runtime.getIndex(), runtime.snapshot(), CORE_2026_RULESET)!;

        runtime.dispatch({ type: 'add-outside-heat', amount: 6, target: 'pending' });
        // 14 fired and 6 outside, less 10 dissipated.
        expect(projection().calculated).toBe(10);
        runtime.dispatch({ type: 'set-pending-heat', heat: 10 });
        expect(runtime.dispatch({ type: 'apply-heat' }).changed).toBe(true);
        expect(runtime.snapshot().heat.current).toBe(10);
        expect(projection().generated).toBe(0);
        // Committing the attack adds nothing the arrow already holds, and End Turn settles nothing again.
        runtime.dispatch({ type: 'end-phase' });
        expect(projection().calculated).toBe(10);
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(runtime.snapshot().heat.current).toBe(10);
    });

    it('keeps an applied aerospace arrow at End Turn rather than cooling it with the sinks left over', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const fresh = createNonMekRuntimeForTest('unit:arrow-above-calculation', baseline(), fighter, CORE_2026_RULESET);
        const runtime = restoreNonMekRuntimeForTest({ ...fresh.serialize(), turn: { weaponsHeat: 2 } }, fighter, CORE_2026_RULESET);

        // 2 fired against 10 sinks calculates to 0; the player's arrow says 5.
        runtime.dispatch({ type: 'set-pending-heat', heat: 5 });
        expect(runtime.dispatch({ type: 'apply-heat' }).changed).toBeTrue();
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(runtime.snapshot().heat.current).toBe(5);
    });

    it('keeps the aerospace heat of a pending attack once APPLY HEAT applied it, even when the attack is cancelled', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = createNonMekRuntimeForTest('unit:applied-pending', baseline(), fighter, CORE_2026_RULESET);
        const calculated = () => projectNonMekEndTurnHeat(fighter, runtime.getIndex(), runtime.snapshot(),
            CORE_2026_RULESET)!.calculated;

        // 15 outside heat against 10 sinks: 5.
        runtime.dispatch({ type: 'add-outside-heat', amount: 15, target: 'pending' });
        runtime.dispatch({ type: 'set-pending-heat', heat: 5 });
        expect(runtime.dispatch({ type: 'apply-heat' }).changed).toBeTrue();
        expect(runtime.dispatch({ type: 'cancel-pending' }).changed).toBeTrue();
        expect([runtime.snapshot().heat.current, calculated()]).toEqual([5, 5]);
    });

    it('ends an aerospace turn on the arrow once, keeping the heat it started from as PREV, as a Mek does', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const fresh = createNonMekRuntimeForTest('unit:arrow-prev', baseline(), fighter, CORE_2026_RULESET);
        const runtime = restoreNonMekRuntimeForTest({ ...fresh.serialize(), heat: { current: 3, previous: 0, heatsinksOff: 0 },
            turn: { weaponsHeat: 2 } }, fighter, CORE_2026_RULESET);

        runtime.dispatch({ type: 'set-pending-heat', heat: 5 });
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect([runtime.snapshot().heat.current, runtime.snapshot().heat.previous]).toEqual([5, 3]);
    });

    it('moves an aerospace NEXT by heat that arrives after it was set, as a Mek does', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = createNonMekRuntimeForTest('unit:aero-next-follows', baseline(), fighter, CORE_2026_RULESET);

        // Nothing generated yet, so NEXT at 8 is the player's +8; 15 outside heat against 10 sinks calculates to 5.
        runtime.dispatch({ type: 'set-pending-heat', heat: 8, follow: true });
        runtime.dispatch({ type: 'add-outside-heat', amount: 15, target: 'committed' });
        expect(runtime.snapshot().heat).toEqual(jasmine.objectContaining({ pendingOverride: 13, pendingOffset: 8 }));
        const saved = restoreNonMekRuntimeForTest(runtime.serialize(), fighter, CORE_2026_RULESET);
        expect(saved.snapshot().heat).toEqual(runtime.snapshot().heat);
        // A unit rebuilt from a NEXT stored before the calculation moved (other rules, a refit) puts it where it stands.
        const stale = restoreNonMekRuntimeForTest({ ...runtime.serialize(),
            heat: { ...runtime.serialize().heat!, pendingOverride: 8 } }, fighter, CORE_2026_RULESET);
        expect(stale.snapshot().heat.pendingOverride).toBe(13);
        // APPLY HEAT settles NEXT where it stands, as End Turn does.
        saved.dispatch({ type: 'apply-heat' });
        expect(saved.snapshot().heat.current).toBe(13);
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(runtime.snapshot().heat.current).toBe(13);
    });

    it('keeps the aerospace heat sinks APPLY HEAT booked cooling until the End Phase switches them off', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const fresh = createNonMekRuntimeForTest('unit:lost-aero-sinks', baseline(), fighter, CORE_2026_RULESET);
        // Turn 2, so the switch waits for the End Phase.
        const runtime = restoreNonMekRuntimeForTest({ ...fresh.serialize(), turn: { turnCounter: 1, weaponsHeat: 14 } }, fighter,
            CORE_2026_RULESET);

        // 14 fired against 10 sinks: 4 heat, every sink used.
        runtime.dispatch({ type: 'set-pending-heat', heat: 4 });
        expect(runtime.dispatch({ type: 'apply-heat' }).changed).toBeTrue();
        // Sinks switch off in the End Phase (TW, Shutting Off Heat Sinks; Core p. 103), so this turn's 10 still cool.
        expect(runtime.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 3 }).changed).toBeTrue();
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(runtime.snapshot().heat.current).toBe(4);
        expect(runtime.snapshot().heat.heatsinksOff).toBe(3);
    });

    it('switches aerospace heat sinks at once on turn 1 until a move is assigned, and from the End Phase otherwise', () => {
        // The user's rule (Core p. 103 lets a unit begin the game with sinks off); otherwise TW (Shutting Off Heat
        // Sinks) and Core p. 103 switch them in the End Phase, aerospace units as 'Meks.
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const runtime = createNonMekRuntimeForTest('unit:aero-sink-switch', baseline(), fighter, CORE_2026_RULESET);
        expect(runtime.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 2 }).changed).toBeTrue();
        expect(runtime.snapshot().heat).toEqual(jasmine.objectContaining({ heatsinksOff: 2 }));
        expect(runtime.snapshot().heat.heatsinksOffNext).toBeUndefined();
        expect(runtime.dispatch({ type: 'set-movement',
            movement: { mode: 'stationary', distance: 0, boosterComponentIds: [] } }).accepted).toBeTrue();
        expect(runtime.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 3 }).changed).toBeTrue();
        expect(runtime.snapshot().heat).toEqual(jasmine.objectContaining({ heatsinksOff: 2, heatsinksOffNext: 3 }));
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(runtime.snapshot().heat).toEqual(jasmine.objectContaining({ heatsinksOff: 3 }));

        // Turn 2: the switch waits for the End Phase even before a move.
        expect(runtime.dispatch({ type: 'set-heatsinks-off', heatsinksOff: 5 }).changed).toBeTrue();
        expect(runtime.snapshot().heat).toEqual(jasmine.objectContaining({ heatsinksOff: 3, heatsinksOffNext: 5 }));
        const saved = runtime.serialize();
        expect(restoreNonMekRuntimeForTest(saved, fighter, CORE_2026_RULESET).snapshot().heat.heatsinksOffNext).toBe(5);
        runtime.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(runtime.snapshot().heat).toEqual(jasmine.objectContaining({ heatsinksOff: 5 }));
        expect(runtime.snapshot().heat.heatsinksOffNext).toBeUndefined();
    });

    it('settles applied aerospace heat once, adding only weapons fired afterwards at End Turn', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const fresh = createNonMekRuntimeForTest('unit:applied-heat', baseline(), fighter, CORE_2026_RULESET);
        const runtime = restoreNonMekRuntimeForTest({ ...fresh.serialize(), turn: { weaponsHeat: 14 } }, fighter, CORE_2026_RULESET);

        // The arrow is the turn's final heat: 14 fired less 10 dissipated.
        expect(runtime.dispatch({ type: 'set-pending-heat', heat: 4 }).changed).toBeTrue();
        expect(runtime.dispatch({ type: 'apply-heat' }).changed).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(4);
        expect(runtime.snapshot().turn.heatDissipationConsumed).toBe(10);

        // The 14 fired used every sink, so 3 more fired afterwards add in full, even across a save.
        const later = restoreNonMekRuntimeForTest({
            ...runtime.serialize(),
            turn: { ...runtime.serialize().turn, weaponsHeat: 17 },
        }, fighter, CORE_2026_RULESET);
        later.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(later.snapshot().heat.current).toBe(7);
        expect(later.snapshot().turn.heatDissipationConsumed).toBeUndefined();
    });

    it('dissipates aerospace heat generated after APPLY HEAT with the sinks left over, as a Mek does', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(10);
        const fresh = createNonMekRuntimeForTest('unit:leftover-dissipation', baseline(), fighter, CORE_2026_RULESET);
        const runtime = restoreNonMekRuntimeForTest({ ...fresh.serialize(), turn: { weaponsHeat: 6 } }, fighter, CORE_2026_RULESET);

        // 6 fired against 10 sinks: no heat, and 4 sinks left for the rest of the turn; 7 more fired meet those 4.
        runtime.dispatch({ type: 'set-pending-heat', heat: 0 });
        expect(runtime.dispatch({ type: 'apply-heat' }).changed).toBeTrue();
        expect(runtime.snapshot().turn.heatDissipationConsumed).toBe(6);
        const later = restoreNonMekRuntimeForTest({
            ...runtime.serialize(),
            turn: { ...runtime.serialize().turn, weaponsHeat: 13 },
        }, fighter, CORE_2026_RULESET);
        later.dispatch({ type: 'end-turn', policy: 'automatic' });
        expect(later.snapshot().heat.current).toBe(3);
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
        const runtime = createNonMekRuntimeForTest(
            'unit:fighter-nova-heat',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const novaId = componentIdForMount(nova);

        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(2);

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: novaId,
            mode: 'disabling',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(4);
        expect(runtime.query().componentMode(novaId)).toBe('disabled');

        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

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
        const runtime = createNonMekRuntimeForTest(
            'unit:fighter-heat-projection',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        expect(runtime.dispatch({
            type: 'set-heat',

            heat: 10,

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
            calculated: 7,
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
        const runtime = createNonMekRuntimeForTest(
            'unit:fighter-manual-heat',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        expect(runtime.dispatch({
            type: 'set-heat',

            heat: 20,

        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-turn',

            policy: 'manual',
        }).accepted).toBeTrue();

        expect(runtime.snapshot().heat.current).toBe(20);
        expect(runtime.snapshot().turn).toEqual({
            turnCounter: 1,
            airborne: null,
            movement: null,
            weaponsHeat: 0,
            settledHeat: jasmine.objectContaining({ size: 0 }),
            cover: null,
            spotting: false,
            phaseStateChanged: false,
            turnStep: 0,
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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-ground-mobile-hpg',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        const hpgId = componentIdForMount(hpg);

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: hpgId,
            mode: 'charging',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(hpgId)).toBe('charged');

        expect(runtime.dispatch({
            type: 'set-movement',

            movement: { mode: 'walk', distance: 1, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: hpgId,
            mode: 'transmitting',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.dispatch({
            type: 'set-movement',

            movement: null,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'set-component-mode',

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
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(hpgId)).toBe('cooldown-3');
        for (let turn = 0; turn < 3; turn += 1) {
            expect(runtime.dispatch({
                type: 'end-turn', policy: 'automatic',

            }).accepted).toBeTrue();
        }
        expect(runtime.query().componentMode(hpgId)).toBe('idle');
    });

    it('toggles a non-ground Mobile HPG and applies forty aerospace heat', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.heatSinkCount.set(0);
        fighter.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'IS' }));
        const hpg = addTestEquipmentWithFlags(fighter, 'F_MOBILE_HPG', { location: 'Nose' });
        const runtime = createNonMekRuntimeForTest(
            'unit:fighter-mobile-hpg',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const hpgId = componentIdForMount(hpg);

        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: hpgId,
            mode: 'transmitting',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            type: 'end-turn', policy: 'automatic',

        }).accepted).toBeTrue();
        expect(runtime.snapshot().heat.current).toBe(40);
        expect(runtime.query().componentMode(hpgId)).toBe('transmitting');
        expect(runtime.dispatch({
            type: 'set-component-mode',

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
        const runtime = createNonMekRuntimeForTest(
            'unit:tank-booby-trap',
            baseline(),
            tank,
            CORE_2026_RULESET,
        );
        const trapId = componentIdForMount(trap);
        const revision = runtime.revision();

        expect(runtime.query().componentMode(trapId)).toBe(BOOBY_TRAP_ARMED_MODE);
        expect(runtime.dispatch({
            type: 'set-component-mode',

            componentId: trapId,
            mode: BOOBY_TRAP_DETONATED_MODE,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.revision()).toBe(revision);

        expect(runtime.dispatch({
            type: 'detonate-booby-trap',

            componentId: trapId,
        }).accepted).toBeTrue();
        expect(runtime.query().componentMode(trapId)).toBe(BOOBY_TRAP_DETONATED_MODE);
        expect(runtime.snapshot().explicitlyDestroyed).toBeFalse();
        expect(runtime.query().destroyed()).toBeTrue();
        expect(runtime.dispatch({
            type: 'set-destroyed',

            destroyed: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.query().destroyed()).toBeTrue();
    });

    it('recalculates fighter and Battle Armor BV from sparse structural damage', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        fighter.uuid.set(UUID);
        fighter.setTonnage(50);
        fighter.structuralIntegrity.set(10);
        const fighterRuntime = createNonMekRuntimeForTest(
            'unit:fighter-bv',
            baseline(),
            fighter,
            CORE_2026_RULESET,
        );
        const fighterPristineBV = fighterRuntime.query().currentBaseBattleValue()!;
        const si = [...fighterRuntime.getIndex().locations.values()]
            .find(location => location.code === 'SI')!;
        expect(fighterRuntime.dispatch({
            type: 'set-internal-damage',

            locationId: si.id,
            damage: 1,
        }).accepted).toBeTrue();
        expect(fighterRuntime.query().currentBaseBattleValue()!).toBeLessThan(fighterPristineBV);
        expect(fighter.structuralIntegrity()).toBe(10);

        const battleArmor = new TestBattleArmorEntity();
        battleArmor.uuid.set(UUID);
        battleArmor.trooperCount.set(4);
        battleArmor.setArmorValue('Squad', 'front', 5);
        const battleArmorRuntime = createNonMekRuntimeForTest(
            'unit:battle-armor-bv',
            baseline(),
            battleArmor,
            CORE_2026_RULESET,
        );
        const pristineBattleArmorBV = battleArmorRuntime.query().currentBaseBattleValue()!;
        const firstTrooper = [...battleArmorRuntime.getIndex().locations.values()][0];
        expect(battleArmorRuntime.dispatch({
            type: 'set-internal-damage',

            locationId: firstTrooper.id,
            damage: 1,
        }).accepted).toBeTrue();
        expect(battleArmorRuntime.query().currentBaseBattleValue()!).toBeLessThan(pristineBattleArmorBV);
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
        const runtime = createNonMekRuntimeForTest(
            'unit:proto-bv',
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const componentId = componentIdForMount(mount);
        const arm = [...runtime.getIndex().locations.values()]
            .find(location => location.code === 'Left Arm')!;
        const pristine = runtime.query().currentBaseBattleValue()!;
        expect(pristine).toBe(entity.battleValue(runtime.ruleset()));

        expect(runtime.dispatch({
            type: 'damage-internal',

            locationId: arm.id,
            amount: arm.internalPoints,
            target: 'pending',
        }).accepted).toBeTrue();
        expect(runtime.query().componentStatus(componentId)).toBe('available');
        expect(runtime.query().componentStatus(componentId, 'preview')).toBe('destroyed');

        expect(runtime.dispatch({
            type: 'end-phase',

        }).accepted).toBeTrue();
        expect(runtime.query().componentStatus(componentId)).toBe('destroyed');
        expect(runtime.query().currentBaseBattleValue()!).toBeLessThan(pristine);
    });

    it('rejects Meks because their concrete runtime owns Mek mechanics', () => {
        const entity = new TestBipedMekEntity();
        entity.uuid.set(UUID);

        expect(() => createNonMekRuntimeForTest(
            'unit:mek',
            baseline('mtf'),
            entity,
            CORE_2026_RULESET,
        )).toThrowError(/Meks require/u);
    });

    it('rejects persisted pending damage outside the Entity capacity', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        const pristine = createPristineNonMekUnitState(entity);
        const index = createNonMekRuntimeForTest(
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

        expect(() => createNonMekRuntimeForTest(
            'unit:invalid',
            baseline(),
            entity,
            CORE_2026_RULESET,
            invalid,
        )).toThrowError(/outside the entity capacity/u);
    });
});

describe('NonMekUnitInstance Fusillade on the canon Sprite 3', () => {
    let registry: EquipmentRegistry;
    beforeAll(async () => {
        registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
    });

    // mm-data protomeks/WoR/Sprite 3.blk without its fluff: two torso Fusillades.
    const SPRITE_3 = ['UnitType:ProtoMek', 'Name:Sprite Ultraheavy ProtoMech', 'Model:3', 'year:3075',
        'type:Clan Level 4', 'motion_type:Biped', 'cruiseMP:3', 'jumpingMP:5', 'interface_cockpit:false',
        'engine_type:0', 'clan_engine:false', 'armor_type:42', 'armor_tech_rating:0', 'armor_tech_level:2',
        'internal_type:-1', 'armor:9\n30\n6\n6\n14',
        'Body Equipment:ExtendedJumpJetSystem\nExtendedJumpJetSystem\nExtendedJumpJetSystem\nExtendedJumpJetSystem\n'
            + 'ExtendedJumpJetSystem\nCLMediumChemLaserAmmo (30)\nEIInterface',
        'Head Equipment:', 'Torso Equipment:Fusillade\nFusillade', 'Right Arm Equipment:CLMediumChemicalLaser',
        'Left Arm Equipment:CLMediumChemicalLaser', 'Legs Equipment:', 'tonnage:15.0',
    ].map(block => {
        const [tag, ...data] = block.split(':');
        return `<${tag}>\n${data.join(':')}\n</${tag}>`;
    }).join('\n');

    it('fires each launcher from its own two shots and spends one on a miss (IO:AE p. 59)', () => {
        const entity = parseEntity(SPRITE_3, 'Sprite 3.blk', registry).entity;
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest('unit:sprite-3', baseline(), entity, CORE_2026_RULESET);
        const [first, second] = [...runtime.getIndex().components.values()]
            .filter(component => component.mount.equipment?.internalName === 'Fusillade')
            .map(component => component.id);
        expect(second).toBeDefined();
        const munitionKey = 'Clan Ammo iATM-3';
        const targetId = asEncounterTargetId('target:sprite');
        const targets: TargetRegistrySnapshot = Object.freeze({ revision: 0, targets: Object.freeze([Object.freeze({
            id: targetId, letter: 'A', name: 'Target A', color: '#ff0000', source: 'manual' as const, readOnly: false,
        })]) });
        const edit = (componentId: ComponentId, preferredSourceId: ComponentId) => [
            { kind: 'set-component-selection' as const, componentId, selection: { kind: 'target' as const, targetId } },
            { kind: 'set-component-ammo' as const, componentId, ammo: { munitionKey, preferredSourceId } },
        ].map(change => runtime.dispatchAttackerTargeting({ type: 'edit-attacker-targeting', edit: change }, targets, false));
        const fire = (noLock?: ComponentId[]) => runtime.dispatchSelectedWeaponFire({
            type: 'fire-selected-weapons', ...(noLock ? { noLock } : {}),
        }, targets, false, false);

        // A launcher's shots feed only that launcher: the panel offers each its own, and the other's is refused.
        const panel = projectNonMekEquipmentPanel(entity, runtime.getIndex(), CORE_2026_RULESET, runtime.snapshot(),
            runtime.query(), targets, {});
        const row = panel.components.find(component => component.componentId === first)!;
        expect(row.weapon?.ammoSources.map(source => [source.componentId, source.remaining, source.capacity]))
            .toEqual([[first, 2, 2]]);
        expect(row.ammo?.capacity).toBe(2);
        expect(edit(first, second)[1].changed).toBeFalse();

        for (const shotsLeft of [1, 0]) {
            edit(first, first);
            edit(second, second);
            // A Fusillade has no lock to miss: a missed attack still fires its salvo.
            expect(fire([first]).changed).toBeFalse();
            expect(fire().changed).toBeTrue();
            expect([runtime.query().remainingAmmo(first), runtime.query().remainingAmmo(second)])
                .toEqual([shotsLeft, shotsLeft]);
            expect(runtime.dispatch({ type: 'end-turn', policy: 'manual' }).accepted).toBeTrue();
        }
        edit(first, first);
        expect(fire().changed).toBeFalse();

        const saved = serializeNonMekUnit({
            entity, index: runtime.getIndex(), state: runtime.snapshot(), baselineRef: runtime.baselineRef,
            instanceId: runtime.instanceId, uuid: baseline().entity,
            deployment: { values: { id: 'deployment:sprite-3', crewAssignment: runtime.getCrewAssignment() } },
        });
        expect(restoreNonMekRuntimeForTest(saved, entity, CORE_2026_RULESET).query().remainingAmmo(first)).toBe(0);
    });

    it('never feeds a launcher from a matching bin: one-shot weapons "can only be fired once in a scenario" (TW p. 114)', () => {
        const entity = parseEntity(SPRITE_3.replace('EIInterface', 'EIInterface\nClan Ammo iATM-3 (20)'), 'Sprite 3.blk', registry).entity;
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest('unit:sprite-3-bin', baseline(), entity, CORE_2026_RULESET);
        const components = [...runtime.getIndex().components.values()];
        const weaponId = components.find(component => component.mount.equipment?.internalName === 'Fusillade')!.id;
        const binId = components.find(component => component.mount.equipment?.internalName === 'Clan Ammo iATM-3')!.id;
        const targets: TargetRegistrySnapshot = Object.freeze({ revision: 0, targets: Object.freeze([]) });

        const row = projectNonMekEquipmentPanel(entity, runtime.getIndex(), CORE_2026_RULESET, runtime.snapshot(),
            runtime.query(), targets, {}).components.find(component => component.componentId === weaponId)!;
        expect(row.weapon?.ammoSources.map(source => source.componentId)).toEqual([weaponId]);
        expect(runtime.dispatchAttackerTargeting({ type: 'edit-attacker-targeting', edit: {
            kind: 'set-component-ammo', componentId: weaponId, ammo: { munitionKey: 'Clan Ammo iATM-3', preferredSourceId: binId },
        } }, targets, false).changed).toBeFalse();
    });

    it('loads and fires Improved Magnetic Pulse missiles at High Explosive range, 1 point each (IO:AE p. 61)', () => {
        const entity = parseEntity(SPRITE_3, 'Sprite 3.blk', registry).entity;
        entity.uuid.set(UUID);
        const runtime = createNonMekRuntimeForTest('unit:sprite-3-imp', baseline(), entity, CORE_2026_RULESET);
        const weaponId = [...runtime.getIndex().components.values()]
            .find(component => component.mount.equipment?.internalName === 'Fusillade')!.id;
        const munitionKey = 'Clan Ammo iATM-3 IMP';
        expect(runtime.dispatch({ type: 'configure-ammo-source', componentId: weaponId, munitionKey, remaining: 2 }).changed)
            .toBeTrue();
        expect(runtime.dispatch({ type: 'set-component-mode', componentId: weaponId, mode: 'Improved Magnetic Pulse' }).changed)
            .toBeTrue();
        const targets: TargetRegistrySnapshot = Object.freeze({ revision: 0, targets: Object.freeze([]) });
        for (const edit of [
            { kind: 'set-component-selection' as const, componentId: weaponId, selection: { kind: 'selected' as const } },
            { kind: 'set-component-ammo' as const, componentId: weaponId, ammo: { munitionKey, preferredSourceId: weaponId } },
        ]) {
            expect(runtime.dispatchAttackerTargeting({ type: 'edit-attacker-targeting', edit }, targets, false).changed).toBeTrue();
        }

        const weapon = projectNonMekEquipmentPanel(entity, runtime.getIndex(), CORE_2026_RULESET, runtime.snapshot(),
            runtime.query(), targets, {}).components.find(component => component.componentId === weaponId)!.weapon!;
        expect([weapon.ranges, weapon.minimumRange]).toEqual([[3, 6, 9, 12], 0]);
        expect(weapon.damageByRange?.short?.values).toEqual([1]);
        expect(runtime.dispatchSelectedWeaponFire({ type: 'fire-selected-weapons' }, targets, false, false).changed).toBeTrue();
        expect(runtime.query().remainingAmmo(weaponId)).toBe(1);
    });
});

function targetingFixture(instanceId: string, ammoType: 'AC' | 'SRM_STREAK' = 'AC') {
    const weapon = new WeaponEquipment({
        id: 'AC_10_Targeting_Test',
        name: 'AC/10',
        type: 'weapon',
        weapon: { ammoType, rackSize: 10, damage: 10, heat: 3, ranges: [5, 10, 15, 20] },
    });
    const ammo = new AmmoEquipment({
        id: 'Ammo_AC_10_Targeting_Test',
        name: 'AC/10 Ammo',
        type: 'ammo',
        ammo: { type: ammoType, rackSize: 10, shots: 10 },
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
    const runtime = createNonMekRuntimeForTest(
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
            profileId: 'pristine-non-mek',
        }),
    });
}

import { createNonMekRuntimeForTest,restoreNonMekRuntimeForTest,vehicleRuntimeRulesForTest } from './testing/unit-runtime-owner-fixture';
