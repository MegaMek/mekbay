// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    CORE_2026_RULESET,
    TOTAL_WARFARE_RULESET,
    type CBTRuleset,
} from '../cbt-ruleset.model';
import { nonMekDamageTrackId } from './non-mek-damage-track-rules';
import { TestProtoMekEntity } from '../entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../entity/testing/test-mounted-equipment';
import {
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { NonMekUnitInstance } from '../runtime/non-mek-unit-instance';
import { type InstanceBaselineRef } from '../runtime/runtime-state';

describe('ProtoMek runtime rules', () => {
    it('ports the production attack movement modifiers', () => {
        const { entity, runtime } = harness();
        expect(runtime.battleValue()).toBe(entity.battleValue());
        const expected = [
            ['stationary', 0, 0],
            ['walk', 1, 1],
            ['run', 1, 2],
            ['jump', 1, 3],
        ] as const;
        for (const [mode, distance, modifier] of expected) {
            expect(runtime.dispatch({
                kind: 'set-movement',
                
                movement: { mode, distance, boosterComponentIds: [] },
            }).accepted).toBeTrue();
            expect(project(runtime).attackMovementModifier).toBe(modifier);
        }
    });

    it('derives abandoned, immobile, and crippled from the direct crew state', () => {
        const dead = harness();
        const deadCrew = [...dead.runtime.getIndex().crewPositions.keys()][0]!;
        expect(dead.runtime.dispatch({
            kind: 'set-crew-state',
            
            positionId: deadCrew,
            wounds: 6,
            unconscious: false,
            ejected: false,
        }).accepted).toBeTrue();
        dead.runtime.dispatch({ kind: 'end-phase' });
        expect(project(dead.runtime).computedConditions).toEqual(['abandoned', 'immobile']);

        const ejected = harness();
        const ejectedCrew = [...ejected.runtime.getIndex().crewPositions.keys()][0]!;
        ejected.runtime.dispatch({
            kind: 'set-crew-state',
            
            positionId: ejectedCrew,
            wounds: 0,
            unconscious: false,
            ejected: true,
        });
        expect(project(ejected.runtime).computedConditions).toEqual(['immobile']);

        const crippled = harness();
        const crippledCrew = [...crippled.runtime.getIndex().crewPositions.keys()][0]!;
        crippled.runtime.dispatch({
            kind: 'set-crew-state',
            
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
            kind: 'set-crew-state',
            positionId: crew,
            wounds: 4,
            unconscious: false,
            ejected: false,
        }).accepted).toBeTrue();

        expect(disabled.runtime.query().hasCondition('crippled')).toBeFalse();
        expect(project(disabled.runtime).computedConditions).not.toContain('crippled');
        expect(disabled.runtime.dispatch({
            kind: 'set-condition',
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
                kind: 'set-internal-damage',
                
                locationId: location.id,
                damage: location.internalPoints,
            });
        }
        expect(project(limbs.runtime).computedConditions).toContain('immobile');

        const torso = harness();
        const torsoLocation = [...torso.runtime.getIndex().locations.values()]
            .find(row => row.code === 'Torso')!;
        torso.runtime.dispatch({
            kind: 'set-internal-damage',
            
            locationId: torsoLocation.id,
            damage: torsoLocation.internalPoints,
        });
        expect(project(torso.runtime).destroyed).toBeTrue();

        const critical = harness();
        critical.runtime.dispatch({
            kind: 'damage-track',
            
            damageTrackId: nonMekDamageTrackId('torso_hit_3'),
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
    runtime: NonMekUnitInstance;
}> {
    const entity = new TestProtoMekEntity();
    entity.uuid.set(UUID);
    entity.setTonnage(6);
    entity.originalWalkMP.set(6);
    addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'Torso' });
    const runtime = new NonMekUnitInstance(
        `unit:proto:${ruleset}`,
        baseline(ruleset),
        entity,
        ruleset,
        undefined,
        forcedWithdrawal,
    );
    return Object.freeze({ entity, runtime });
}

function project(runtime: NonMekUnitInstance) {
    const projection = runtime.protoMekRules();
    if (projection === null) throw new Error('Expected ProtoMek fixture');
    return projection;
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
