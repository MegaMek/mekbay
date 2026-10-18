// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { CBTNonMekUnit } from '../runtime/cbt-unit';

import {
asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import {
CORE_2026_RULESET,
TOTAL_WARFARE_RULESET,
type CBTRuleset,
} from '../cbt-ruleset.model';
import { TestProtoMekEntity } from '../entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../entity/testing/test-mounted-equipment';
import { systemDamageId } from './system-damage-rules';

import { isProtoMekEntity } from '../entity/utils/entity-type-guards';
import { type InstanceBaselineRef } from '../runtime/runtime-state';
import { projectNonMekMovementCapabilities } from '../runtime/non-mek-unit-instance';
import { componentIdForMount } from '../runtime/unit-runtime-index';
import { projectProtoMekRuntimeRules, protoMekCriticalModifiers } from './protomek-runtime-rules';

describe('ProtoMek runtime rules', () => {
    it('applies leg and torso critical hits to movement, rounding the half up', () => {
        const { runtime } = harness();
        const maximum = () => projectNonMekMovementCapabilities(
            runtime.getUnit(), runtime.getIndex(), runtime.snapshot(), runtime.ruleset()).maximum;
        const critical = (system: 'legs' | 'torso', level: number) => expect(runtime.dispatch({
            type: 'set-system-damage-level', system, level, target: 'committed', timestamp: 1,
        }).accepted).toBeTrue();
        expect([maximum().walk, maximum().run, maximum().jump]).toEqual([6, 9, 1]);
        critical('legs', 1);
        expect([maximum().walk, maximum().run]).toEqual([5, 8]);
        critical('legs', 2);
        expect([maximum().walk, maximum().run]).toEqual([3, 5]);
        critical('torso', 1);
        expect(maximum().jump).toBe(0);
    });

    it('adds head and arm critical modifiers, and blocks the main gun once both arms are gone', () => {
        const hits = { head: 1, torso: 0, legs: 0, 'Left Arm': 1, 'Right Arm': 2 };
        expect(protoMekCriticalModifiers(hits, ['Left Arm']).map(row => [row.label, row.modifier]))
            .toEqual([['Head critical', 1], ['Left Arm critical', 1]]);
        expect(protoMekCriticalModifiers(hits, ['Main Gun']).reduce((sum, row) => sum + row.modifier, 0)).toBe(4);
        expect(protoMekCriticalModifiers({ ...hits, head: 2 }, ['Torso']).map(row => row.modifier)).toEqual([2]);

        const entity = new TestProtoMekEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(6);
        const mainGun = componentIdForMount(addTestEquipmentWithFlags(entity, 'F_ENERGY', { location: 'Main Gun' }));
        const runtime = createNonMekRuntimeForTest('unit:proto:main-gun', baseline(CORE_2026_RULESET), entity, CORE_2026_RULESET);
        runtime.dispatch({ type: 'set-system-damage-level', system: 'left-arm', level: 2, target: 'committed', timestamp: 1 });
        expect(project(runtime).fireBlockedComponentIds.has(mainGun)).toBeFalse();
        runtime.dispatch({ type: 'set-system-damage-level', system: 'right-arm', level: 2, target: 'committed', timestamp: 1 });
        expect(project(runtime).criticalHits).toEqual(jasmine.objectContaining({ 'Left Arm': 2, 'Right Arm': 2 }));
        expect(project(runtime).fireBlockedComponentIds.has(mainGun)).toBeTrue();
    });

    it('ports the production attack movement modifiers', () => {
        const { entity, runtime } = harness();
        expect(runtime.query().currentBaseBattleValue()).toBe(entity.battleValue(runtime.ruleset()));
        const expected = [
            ['stationary', 0, 0],
            ['walk', 1, 1],
            ['run', 1, 2],
            ['jump', 1, 3],
        ] as const;
        for (const [mode, distance, modifier] of expected) {
            expect(runtime.dispatch({
                type: 'set-movement',
                
                movement: { mode, distance, boosterComponentIds: [] },
            }).accepted).toBeTrue();
            expect(project(runtime).attackMovementModifier).toBe(modifier);
        }
    });

    it('derives abandoned, immobile, and crippled from the direct crew state', () => {
        const dead = harness();
        const deadCrew = [...dead.runtime.getIndex().crewPositions.keys()][0]!;
        expect(dead.runtime.dispatch({
            type: 'set-crew-state',
            
            positionId: deadCrew,
            wounds: 6,
            unconscious: false,
            ejected: false,
        }).accepted).toBeTrue();
        dead.runtime.dispatch({ type: 'end-phase' });
        expect(project(dead.runtime).computedConditions).toEqual(['abandoned', 'immobile']);
        expect(project(dead.runtime).destroyed).withContext('pilot death destroys a ProtoMek').toBeTrue();

        const ejected = harness();
        const ejectedCrew = [...ejected.runtime.getIndex().crewPositions.keys()][0]!;
        ejected.runtime.dispatch({
            type: 'set-crew-state',
            
            positionId: ejectedCrew,
            wounds: 0,
            unconscious: false,
            ejected: true,
        });
        expect(project(ejected.runtime).computedConditions).toEqual(['immobile']);
        expect(project(ejected.runtime).destroyed).toBeFalse();

        const crippled = harness();
        const crippledCrew = [...crippled.runtime.getIndex().crewPositions.keys()][0]!;
        crippled.runtime.dispatch({
            type: 'set-crew-state',
            
            positionId: crippledCrew,
            wounds: 4,
            unconscious: false,
            ejected: false,
        });
        expect(project(crippled.runtime).computedConditions).toEqual(['crippled']);
    });

    it('disables the entire crippled system when forced withdrawal is off', () => {
        const disabled = harness(CORE_2026_RULESET, false);
        const crew = [...disabled.runtime.getIndex().crewPositions.keys()][0]!;
        expect(disabled.runtime.dispatch({
            type: 'set-crew-state',
            positionId: crew,
            wounds: 4,
            unconscious: false,
            ejected: false,
        }).accepted).toBeTrue();

        expect(disabled.runtime.query().hasCondition('crippled')).toBeFalse();
        expect(project(disabled.runtime).computedConditions).not.toContain('crippled');
        expect(disabled.runtime.dispatch({
            type: 'set-condition',
            condition: 'crippled',
            active: true,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(disabled.runtime.query().hasCondition('crippled')).toBeFalse();
    });

    it('derives immobility and destruction from Entity locations and criticals', () => {
        const limbs = harness();
        for (const code of ['Left Arm', 'Right Arm', 'Legs']) {
            const location = [...limbs.runtime.getIndex().locations.values()]
                .find(row => row.code === code)!;
            limbs.runtime.dispatch({
                type: 'set-internal-damage',
                
                locationId: location.id,
                damage: location.internalPoints,
            });
        }
        expect(project(limbs.runtime).computedConditions).toContain('immobile');

        const torso = harness();
        const torsoLocation = [...torso.runtime.getIndex().locations.values()]
            .find(row => row.code === 'Torso')!;
        torso.runtime.dispatch({
            type: 'set-internal-damage',
            
            locationId: torsoLocation.id,
            damage: torsoLocation.internalPoints,
        });
        expect(project(torso.runtime).destroyed).toBeTrue();

        const critical = harness();
        critical.runtime.dispatch({
            type: 'damage-track',
            
            damageTrackId: systemDamageId('torso', 3),
            amount: 1,
            target: 'committed',
            timestamp: 1,
        });
        expect(project(critical.runtime).destroyed).toBeTrue();
    });

    it('uses production Core and Total Warfare condition controls and ProtoMek crew controls', () => {
        expect(project(harness(CORE_2026_RULESET).runtime).conditionControlKeys).toEqual([
            'swarmed', 'tagged', 'ecm-shielded', 'jammed',
        ]);
        const totalWar = project(harness(TOTAL_WARFARE_RULESET).runtime);
        expect(totalWar.conditionControlKeys).toEqual([
            'swarmed', 'tagged', 'ecm-shielded', 'skidding', 'jammed',
        ]);
        expect(totalWar.crewStateControlKeys).toEqual(['stunned']);
        expect(totalWar.crewStateDisplayKeys).toEqual(['stunned', 'killed']);
    });
});

function harness(
    ruleset: CBTRuleset = CORE_2026_RULESET,
    forcedWithdrawal = true,
): Readonly<{
    entity: TestProtoMekEntity;
    runtime: CBTNonMekUnit;
}> {
    const entity = new TestProtoMekEntity();
    entity.uuid.set(UUID);
    entity.setTonnage(6);
    entity.originalWalkMP.set(6);
    addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'Torso' });
    const runtime = createNonMekRuntimeForTest(
        `unit:proto:${ruleset}`,
        baseline(ruleset),
        entity,
        ruleset,
        undefined,
        forcedWithdrawal,
    );
    return Object.freeze({ entity, runtime });
}

function project(runtime: CBTNonMekUnit) {
    const entity = runtime.getUnit();
    if (!isProtoMekEntity(entity)) throw new Error('Expected ProtoMek fixture');
    return projectProtoMekRuntimeRules(
        entity,
        runtime.getIndex(),
        runtime.snapshot(),
        runtime.ruleset(),
        runtime.mechanics().forcedWithdrawal,
    );
}

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

function baseline(ruleset: CBTRuleset): InstanceBaselineRef {
    return Object.freeze({
        entity: UUID,
        ruleset,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}

import { createNonMekRuntimeForTest } from '../runtime/testing/unit-runtime-owner-fixture';
