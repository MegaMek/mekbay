// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestSupportNavalEntity,
    TestTankEntity,
    TestVtolEntity,
} from '../entity/testing/test-entities';
import {
    addTestEquipment,
    addTestEquipmentWithFlags,
} from '../entity/testing/test-mounted-equipment';
import { createEquipment } from '../equipment.model';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import {
    CORE_2026_RULESET,
    TOTAL_WARFARE_RULESET,
    type CBTRuleset,
} from '../cbt-ruleset.model';
import { buildNonMekRuntimeIndex, componentIdForMount } from '../runtime/non-mek-runtime-index';
import { NonMekUnitInstance } from '../runtime/non-mek-unit-instance';
import { asUnitInstanceId, type InstanceBaselineRef } from '../runtime/runtime-state';
import { nonMekDamageTrackId } from './non-mek-damage-track-rules';
import { projectVehicleRuntimeRules } from './vehicle-runtime-rules';

describe('projectVehicleRuntimeRules', () => {
    it('publishes only damage tracks supported by the Entity topology', () => {
        const turretless = new TestTankEntity();
        const turreted = new TestTankEntity();
        turreted.hasTurret.set(true);
        const vtol = new TestVtolEntity();
        const naval = new TestSupportNavalEntity();
        const sheetIds = (entity: TestTankEntity | TestVtolEntity | TestSupportNavalEntity) =>
            [...buildNonMekRuntimeIndex(entity).damageTracks.values()].map(track => track.sheetId);

        expect(sheetIds(turretless)).not.toContain('turret_locked');
        expect(sheetIds(turretless)).not.toContain('stabilizer_hit_turret');
        expect(sheetIds(turreted)).toContain('turret_locked');
        expect(sheetIds(turreted)).toContain('stabilizer_hit_turret');
        expect(sheetIds(vtol)).toContain('flight_stabilizer_hit');
        expect(sheetIds(vtol)).not.toContain('turret_locked');
        expect(sheetIds(naval)).toContain('turret_locked_f');
        expect(sheetIds(naval)).toContain('turret_locked_r');
        expect(sheetIds(naval)).not.toContain('turret_locked');
    });

    it('uses the same direct vehicle rules owner for Tank, VTOL, and naval families', () => {
        const entities = [
            new TestTankEntity(),
            new TestVtolEntity(),
            new TestSupportNavalEntity(),
        ];

        entities.forEach((entity, index) => {
            prepare(entity);
            expect(project(instance(entity, `unit:vehicle-family-${index}`)).movement)
                .toEqual(jasmine.objectContaining({ walk: 8, run: 12 }));
        });
    });

    it('derives normal and boosted movement from the Entity and working equipment', () => {
        const entity = tank();
        addTestEquipmentWithFlags(entity, ['F_MASC', 'S_SUPERCHARGER']);
        const runtime = instance(entity, 'unit:vehicle-movement');

        expect(project(runtime).movement).toEqual({
            moveImpaired: false,
            walk: 8,
            maxWalk: 8,
            run: 12,
            maxRun: 16,
        });
    });

    it('uses the direct turn declaration for Core/TW Charge damage', () => {
        const coreEntity = tank();
        coreEntity.setTonnage(60);
        const core = instance(coreEntity, 'unit:vehicle-core-charge');
        expect(core.dispatch({
            kind: 'set-movement',
            
            movement: { mode: 'walk', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(project(core).chargeDamage).toEqual(jasmine.objectContaining({
            damage: 36,
            maximumDamage: 60,
            baseDamage: 36,
        }));

        const twEntity = tank();
        twEntity.setTonnage(60);
        const tw = instance(twEntity, 'unit:vehicle-tw-charge', TOTAL_WARFARE_RULESET);
        expect(tw.dispatch({
            kind: 'set-movement',
            
            movement: { mode: 'walk', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(project(tw).chargeDamage).toEqual(jasmine.objectContaining({
            damage: 24,
            maximumDamage: 66,
            baseDamage: 24,
        }));
    });

    it('reapplies the selected attacker movement modifier to stabilizer-hit weapons', () => {
        const entity = tank();
        const weapon = addTestEquipment(entity, createEquipment({
            id: 'Front Stabilizer Weapon',
            name: 'Front Stabilizer Weapon',
            type: 'weapon',
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        }), { location: 'Front' });
        const runtime = instance(entity, 'unit:vehicle-stabilizer');
        hit(runtime, 'stabilizer_hit_front', 10);
        expect(runtime.dispatch({
            kind: 'set-movement',
            
            movement: { mode: 'run', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();

        const rules = project(runtime);
        expect(rules.attackMovementModifier).toBe(2);
        expect(rules.stabilizerAffectedComponentIds).toContain(componentIdForMount(weapon));
    });

    it('applies repeatable motive hits in timestamp order', () => {
        const runtime = instance(tank(), 'unit:vehicle-motive');
        hit(runtime, 'motive_system_hit_3', 10);
        hit(runtime, 'motive_system_hit_2', 20);

        expect(project(runtime).movement).toEqual(jasmine.objectContaining({
            walk: 3,
            run: 5,
            maxRun: 5,
            moveImpaired: true,
        }));
        expect(project(runtime).modifiers.psr.filter(row => row.label === 'Motive system hit'))
            .toEqual([
                { label: 'Motive system hit', modifier: 3, weakened: true },
                { label: 'Motive system hit', modifier: 2, weakened: true },
            ]);
    });

    it('marks killed crews abandoned and immobile but only blocks run for stunned crews', () => {
        const killed = instance(tank(), 'unit:vehicle-killed');
        setCrewState(killed, 'killed');

        expect(project(killed).computedConditions).toEqual(['abandoned', 'immobile']);
        expect(project(killed).movement).toEqual(jasmine.objectContaining({ walk: 0, run: 0 }));

        const stunned = instance(tank(), 'unit:vehicle-stunned');
        setCrewState(stunned, 'stunned');

        expect(project(stunned).computedConditions).toEqual([]);
        expect(project(stunned).movement).toEqual(jasmine.objectContaining({
            walk: 8,
            run: 0,
            maxRun: 0,
            moveImpaired: true,
        }));
    });

    it('applies engine and sensor critical effects to movement and equipment', () => {
        const entity = tank();
        const laser = addTestEquipment(entity, createEquipment({
            id: 'Test Laser',
            name: 'Test Laser',
            type: 'weapon',
            flags: ['F_ENERGY'],
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        }), { location: 'Front' });
        const cannon = addTestEquipment(entity, createEquipment({
            id: 'Test Cannon',
            name: 'Test Cannon',
            type: 'weapon',
            flags: ['F_BALLISTIC'],
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        }), { location: 'Front' });
        const runtime = instance(entity, 'unit:vehicle-systems');
        hit(runtime, 'engine_hit_1', 10);
        expect(runtime.dispatch({
            kind: 'set-sensor-damage-level',
            
            level: 4,
            target: 'committed',
            timestamp: 20,
        }).accepted).toBeTrue();

        const rules = project(runtime);
        expect(rules.movement.walk).toBe(0);
        expect(rules.componentStatuses.get(componentIdForMount(laser))).toBe('disabled');
        expect(rules.componentStatuses.get(componentIdForMount(cannon))).toBe('available');
        expect(rules.fireBlockedComponentIds).toContain(componentIdForMount(laser));
        expect(rules.fireBlockedComponentIds).toContain(componentIdForMount(cannon));
        expect(rules.modifiers.ranged).toContain(jasmine.objectContaining({
            label: 'Sensor hits',
            modifier: 4,
        }));
    });

    it('previews a pending engine hit without applying its rules early', () => {
        const entity = tank();
        const laser = addTestEquipment(entity, createEquipment({
            id: 'Preview Laser',
            name: 'Preview Laser',
            type: 'weapon',
            flags: ['F_ENERGY'],
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        }), { location: 'Front' });
        const runtime = instance(entity, 'unit:vehicle-preview');
        hit(runtime, 'engine_hit_1', 10, 'pending');

        const preview = project(runtime);
        expect(preview.systems.engineHit).toBeFalse();
        expect(preview.movement.walk).toBe(8);
        expect(preview.componentStatuses.get(componentIdForMount(laser))).toBe('available');
        expect(preview.previewComponentStatuses.get(componentIdForMount(laser))).toBe('disabled');
    });

    it('applies rotor and flight-stabilizer damage to VTOL movement', () => {
        const entity = new TestVtolEntity();
        prepare(entity);
        const runtime = instance(entity, 'unit:vehicle-vtol');
        hit(runtime, 'rotor', 10, 'committed', 3);
        hit(runtime, 'flight_stabilizer_hit', 20);

        expect(project(runtime).movement).toEqual(jasmine.objectContaining({
            walk: 5,
            run: 0,
            maxRun: 0,
            moveImpaired: true,
        }));
    });

    it('derives disconnected and immobile for an unavailable drone operating system', () => {
        const entity = tank();
        const drone = addTestEquipmentWithFlags(entity, 'F_DRONE_OPERATING_SYSTEM');
        const runtime = instance(entity, 'unit:vehicle-drone');
        expect(runtime.dispatch({
            kind: 'set-component-status',
            
            componentId: componentIdForMount(drone),
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();

        expect(project(runtime).computedConditions).toEqual(['disconnected', 'immobile']);
        expect(project(runtime).movement.walk).toBe(0);
    });

    it('exposes only rules-valid vehicle condition and crew controls', () => {
        const core = instance(tank(), 'unit:vehicle-core-controls');
        expect(project(core).conditionControlKeys).toEqual([
            'swarmed', 'tagged', 'ecm-shielded', 'jammed',
        ]);
        expect(project(core).crewStateControlKeys).toEqual(['killed', 'stunned']);

        const tw = instance(tank(), 'unit:vehicle-tw-controls', TOTAL_WARFARE_RULESET);
        expect(project(tw).conditionControlKeys).toEqual([
            'swarmed', 'tagged', 'ecm-shielded', 'skidding', 'jammed',
        ]);

        const droneEntity = tank();
        addTestEquipmentWithFlags(droneEntity, 'F_DRONE_OPERATING_SYSTEM');
        const drone = instance(droneEntity, 'unit:vehicle-drone-controls');
        expect(project(drone).conditionControlKeys).toContain('disconnected');
        expect(project(drone).crewStateControlKeys).toEqual([]);
    });

    it('derives destruction and mounted-component loss from committed internal damage', () => {
        const entity = tank();
        const cannon = addTestEquipment(entity, createEquipment({
            id: 'Location Cannon',
            name: 'Location Cannon',
            type: 'weapon',
            flags: ['F_BALLISTIC'],
            weapon: { damage: 5, ranges: [3, 6, 9, 12] },
        }), { location: 'Front' });
        const runtime = instance(entity, 'unit:vehicle-location');
        const front = [...runtime.getIndex().locations.values()]
            .find(location => location.code === 'Front')!;
        expect(runtime.dispatch({
            kind: 'set-internal-damage',
            
            locationId: front.id,
            damage: front.internalPoints,
        }).accepted).toBeTrue();

        const rules = project(runtime);
        expect(rules.destroyed).toBeTrue();
        expect(rules.componentStatuses.get(componentIdForMount(cannon))).toBe('destroyed');
    });
});

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

function tank(): TestTankEntity {
    const entity = new TestTankEntity();
    prepare(entity);
    return entity;
}

function prepare(entity: VehicleTestEntity): void {
    entity.uuid.set(UUID);
    entity.setTonnage(20);
    entity.originalWalkMP.set(8);
}

function instance(
    entity: VehicleTestEntity,
    id: string,
    ruleset: CBTRuleset = CORE_2026_RULESET,
): NonMekUnitInstance {
    return new NonMekUnitInstance(
        asUnitInstanceId(id),
        baseline(ruleset),
        entity,
        ruleset,
    );
}

type VehicleTestEntity = TestTankEntity | TestVtolEntity | TestSupportNavalEntity;

function project(runtime: NonMekUnitInstance) {
    const rules = runtime.vehicleRules();
    if (!rules) throw new Error('Expected vehicle rules');
    return rules;
}

function hit(
    runtime: NonMekUnitInstance,
    sheetId: string,
    timestamp: number,
    target: 'committed' | 'pending' = 'committed',
    amount = 1,
): void {
    const result = runtime.dispatch({
        kind: 'damage-track',
        
        damageTrackId: nonMekDamageTrackId(sheetId),
        amount,
        target,
        timestamp,
    });
    expect(result.accepted).toBeTrue();
    expect(result.changed).toBeTrue();
}

function setCrewState(runtime: NonMekUnitInstance, state: 'killed' | 'stunned'): void {
    const positionId = [...runtime.getIndex().crewPositions.keys()][0]!;
    const result = runtime.dispatch({
        kind: 'set-crew-state',
        
        positionId,
        wounds: 0,
        unconscious: false,
        ejected: false,
        state,
    });
    expect(result.accepted).toBeTrue();
}

function baseline(ruleset: CBTRuleset = CORE_2026_RULESET): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        }),
        ruleset,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
