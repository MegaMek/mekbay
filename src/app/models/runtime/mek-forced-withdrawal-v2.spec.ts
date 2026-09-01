// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TOTAL_WARFARE_RULESET } from '../cbt-ruleset.model';
import type { CriticalSlotId } from '../entity/entity-identifiers';
import {
    MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
} from './mek-destruction-state-v2';
import {
    createDirectMekRuntimeFixture,
    createDirectNoForcedWithdrawalRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct Mek forced-withdrawal rules', () => {
    it('applies the Core engine, limb, torso, and durable-torso criteria', () => {
        const engineFixture = createDirectMekRuntimeFixture();
        hitCriticals(engineFixture, systemSlots(engineFixture, 'Engine').slice(0, 2));
        expect(engineFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const limbFixture = createDirectMekRuntimeFixture();
        destroyInternal(limbFixture, 'LA');
        destroyInternal(limbFixture, 'RA');
        expect(limbFixture.instance.query().hasCondition('crippled')).toBeFalse();
        destroyInternal(limbFixture, 'LL');
        expect(limbFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const torsoFixture = createDirectMekRuntimeFixture();
        destroyInternal(torsoFixture, 'LT');
        const check = torsoFixture.instance.query().mekRuleCheck(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
        expect(check).toEqual(jasmine.objectContaining({ status: 'pending' }));
        expect(torsoFixture.instance.query().hasCondition('crippled')).toBeFalse();
        expect(torsoFixture.instance.dispatch({
            type: 'resolve-mek-rule-check',


            key: MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
            token: check!.token,
            outcome: 'failed',
        }).accepted).toBeTrue();
        expect(torsoFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const twoTorsoFixture = createDirectMekRuntimeFixture();
        destroyInternal(twoTorsoFixture, 'LT');
        destroyInternal(twoTorsoFixture, 'RT');
        expect(twoTorsoFixture.instance.query().hasCondition('crippled')).toBeTrue();
    });

    it('applies Total Warfare crew, sensor, gyro/engine, and side-torso criteria', () => {
        const crewFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        const pilot = [...crewFixture.index.crewPositions.values()][0]!;
        expect(crewFixture.instance.dispatch({
            type: 'set-crew-state',


            positionId: pilot.id,
            wounds: 4,
            unconscious: false,
            ejected: false,
        }).accepted).toBeTrue();
        expect(crewFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const deadCrewFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        const deadPilot = [...deadCrewFixture.index.crewPositions.values()][0]!;
        expect(deadCrewFixture.instance.dispatch({
            type: 'set-crew-state',


            positionId: deadPilot.id,
            wounds: 6,
            unconscious: false,
            ejected: false,
        }).accepted).toBeTrue();
        expect(deadCrewFixture.instance.query().hasCondition('crippled')).toBeTrue();
        expect(deadCrewFixture.instance.dispatch({ type: 'end-phase' }).accepted).toBeTrue();
        expect(deadCrewFixture.instance.query().hasCondition('crippled')).toBeFalse();

        const sensorFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        hitCriticals(sensorFixture, systemSlots(sensorFixture, 'Sensors'));
        expect(sensorFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const engineGyroFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        hitCriticals(engineGyroFixture, systemSlots(engineGyroFixture, 'Engine').slice(0, 1));
        expect(engineGyroFixture.instance.query().hasCondition('crippled')).toBeFalse();
        hitCriticals(engineGyroFixture, systemSlots(engineGyroFixture, 'Gyro').slice(0, 1));
        expect(engineGyroFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const torsoFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        destroyInternal(torsoFixture, 'LT');
        expect(torsoFixture.instance.query().hasCondition('crippled')).toBeTrue();
        expect(torsoFixture.instance.query().mekRuleCheck(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY))
            .toBeUndefined();
    });

    it('applies Total Warfare damaged-internal thresholds and the scenario gate', () => {
        const limbFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        damageInternal(limbFixture, 'LA', 1);
        damageInternal(limbFixture, 'RA', 1);
        expect(limbFixture.instance.query().hasCondition('crippled')).toBeFalse();
        damageInternal(limbFixture, 'LL', 1);
        expect(limbFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const torsoFixture = createDirectMekRuntimeFixture(TOTAL_WARFARE_RULESET);
        destroyFrontArmor(torsoFixture, 'LT');
        damageInternal(torsoFixture, 'LT', 1);
        expect(torsoFixture.instance.query().hasCondition('crippled')).toBeFalse();
        destroyFrontArmor(torsoFixture, 'CT');
        damageInternal(torsoFixture, 'CT', 1);
        expect(torsoFixture.instance.query().hasCondition('crippled')).toBeTrue();

        const disabledFixture = createDirectNoForcedWithdrawalRuntimeFixture(TOTAL_WARFARE_RULESET);
        destroyInternal(disabledFixture, 'LT');
        expect(disabledFixture.instance.query().hasCondition('crippled')).toBeFalse();
    });
});

function systemSlots(
    fixture: DirectMekRuntimeFixture,
    systemType: string,
): readonly CriticalSlotId[] {
    const component = [...fixture.index.components.values()].find(candidate =>
        candidate.kind === 'system' && candidate.systemType === systemType);
    if (!component) throw new Error(`Direct fixture is missing ${systemType}`);
    return [...fixture.index.slots.values()]
        .filter(slot => slot.componentIds.includes(component.id))
        .map(slot => slot.id);
}

function hitCriticals(
    fixture: DirectMekRuntimeFixture,
    slotIds: readonly CriticalSlotId[],
): void {
    for (const slotId of slotIds) {
        expect(fixture.instance.dispatch({
            type: 'hit-critical',


            slotId,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
    }
}

function destroyInternal(fixture: DirectMekRuntimeFixture, code: string): void {
    const location = locationByCode(fixture, code);
    damageInternal(fixture, code, location.internalPoints);
}

function damageInternal(
    fixture: DirectMekRuntimeFixture,
    code: string,
    amount: number,
): void {
    const location = locationByCode(fixture, code);
    expect(fixture.instance.dispatch({
        type: 'damage-internal',


        locationId: location.id,
        amount,
        target: 'pending',
    }).accepted).toBeTrue();
}

function destroyFrontArmor(fixture: DirectMekRuntimeFixture, code: string): void {
    const location = locationByCode(fixture, code);
    const face = [...fixture.index.armorFaces.values()].find(candidate =>
        candidate.locationId === location.id && candidate.face === 'front');
    if (!face) throw new Error(`Direct fixture is missing ${code} front armor`);
    expect(fixture.instance.dispatch({
        type: 'damage-armor',


        faceId: face.id,
        amount: face.maximumPoints,
        target: 'pending',
    }).accepted).toBeTrue();
}

function locationByCode(fixture: DirectMekRuntimeFixture, code: string) {
    const location = [...fixture.index.locations.values()].find(candidate => candidate.code === code);
    if (!location) throw new Error(`Direct fixture is missing location ${code}`);
    return location;
}
