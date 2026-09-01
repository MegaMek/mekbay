// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { emptyCBTEncounterSnapshot } from './encounter-runtime';
import { projectMekEquipmentPanel } from './equipment-panel';
import { projectMekRecordSheet } from './mek-record-sheet';
import type { MekShieldProjectionV2, MekShieldTrack } from './mek-shield-rules';
import {
    createDirectShieldRuntimeFixture,
    type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct V2 Mek shield rules', () => {
    it('projects the static shield profiles and installed propulsion penalties', () => {
        const expected = {
            small: { bash: 1, absorption: 3, capacity: 11, walk: 5, jump: 3, umu: 2 },
            medium: { bash: 2, absorption: 5, capacity: 18, walk: 4, jump: 2, umu: 2 },
            large: { bash: 3, absorption: 7, capacity: 25, walk: 4, jump: 0, umu: 0 },
        } as const;

        for (const size of ['small', 'medium', 'large'] as const) {
            const fixture = createDirectShieldRuntimeFixture('core-2026', size);
            const shield = onlyShield(fixture);
            const movement = supportedMovement(fixture);
            expect(shield).withContext(size).toEqual(jasmine.objectContaining({
                size,
                bashBonus: expected[size].bash,
                absorption: expected[size].absorption,
                capacity: expected[size].capacity,
                operational: true,
            }));
            expect(movement).withContext(size).toEqual(jasmine.objectContaining({
                walkMp: expected[size].walk,
                jumpMp: expected[size].jump,
                umuMp: expected[size].umu,
            }));
        }
    });

    it('uses DA/DC exhaustion for Core mobility and critical destruction for TW mobility', () => {
        const core = createDirectShieldRuntimeFixture('core-2026');
        const tw = createDirectShieldRuntimeFixture('total-warfare');

        damageShield(core, 'absorption', 5, 'committed');
        damageShield(tw, 'absorption', 5, 'committed');

        expect(supportedMovement(core)).toEqual(jasmine.objectContaining({ walkMp: 5, jumpMp: 3 }));
        expect(supportedMovement(tw)).toEqual(jasmine.objectContaining({ walkMp: 4, jumpMp: 2 }));
        expect(core.instance.query().componentStatus(shieldComponent(core).id)).toBe('destroyed');
        expect(tw.instance.query().componentStatus(shieldComponent(tw).id)).toBe('destroyed');

        const twCriticals = shieldCriticals(tw);
        for (let index = 0; index < 4; index += 1) hitCritical(tw, twCriticals[index]!.id);
        expect(supportedMovement(tw)).toEqual(jasmine.objectContaining({ walkMp: 4, jumpMp: 2 }));
        hitCritical(tw, twCriticals[4]!.id);
        expect(supportedMovement(tw)).toEqual(jasmine.objectContaining({ walkMp: 5, jumpMp: 3 }));
    });

    it('derives shield-track loss from criticals and arm actuators', () => {
        const fixture = createDirectShieldRuntimeFixture('total-warfare');
        hitCritical(fixture, shieldCriticals(fixture)[0]!.id);
        expect(onlyShield(fixture)).toEqual(jasmine.objectContaining({
            absorption: 4,
            capacity: 13,
            absorptionDamage: 1,
            capacityDamage: 5,
            operational: true,
        }));

        hitSystem(fixture, 'Shoulder');
        hitSystem(fixture, 'Upper Arm Actuator');
        expect(onlyShield(fixture)).toEqual(jasmine.objectContaining({
            absorption: 1,
            capacity: 10,
        }));
    });

    it('keeps pending shield damage separate and commits it atomically', () => {
        const fixture = createDirectShieldRuntimeFixture('core-2026');
        damageShield(fixture, 'capacity', 18, 'pending');

        expect(onlyShield(fixture, 'committed').capacity).toBe(18);
        expect(onlyShield(fixture, 'preview').capacity).toBe(0);
        expect(fixture.instance.query().componentStatus(
            shieldComponent(fixture).id,
            'committed',
        )).toBe('available');
        expect(fixture.instance.query().componentStatus(
            shieldComponent(fixture).id,
            'preview',
        )).toBe('destroyed');
        const sheet = projectMekRecordSheet(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.snapshot(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
            null,
        );
        expect(sheet.shields.find(track => track.track === 'capacity')).toEqual(jasmine.objectContaining({
            maximum: 18,
            committedRemaining: 18,
            previewRemaining: 0,
        }));

        expect(fixture.instance.dispatch({
            type: 'commit-pending',


        }).accepted).toBeTrue();
        expect(onlyShield(fixture).capacity).toBe(0);
        expect(fixture.instance.snapshot().pendingCombat.shieldDamage.size).toBe(0);
    });

    it('ports Core shield bash and TW independent shield attacks without applying TSM to the shield', () => {
        const core = createDirectShieldRuntimeFixture('core-2026');
        const tw = createDirectShieldRuntimeFixture('total-warfare');
        setHeat(core, 9);
        setHeat(tw, 9);

        const corePanel = panel(core);
        const twPanel = panel(tw);
        const corePunch = corePanel.physicalAttacks.find(attack =>
            attack.label === 'Punch' && attack.locationCodes.includes('LA'))!;
        const twPunch = twPanel.physicalAttacks.find(attack =>
            attack.label === 'Punch' && attack.locationCodes.includes('LA'))!;
        const twShield = twPanel.physicalAttacks.find(attack =>
            attack.target.kind === 'component'
            && attack.target.componentId === shieldComponent(tw).id)!;
        const coreShield = corePanel.physicalAttacks.find(attack =>
            attack.target.kind === 'component'
            && attack.target.componentId === shieldComponent(core).id)!;

        expect(corePunch.effect).toEqual(jasmine.objectContaining({ damage: 8, baseDamage: 4 }));
        expect(coreShield).toEqual(jasmine.objectContaining({
            selectable: false,
            available: true,
            effect: { kind: 'modifier', modifier: 2, weakened: false },
        }));
        expect(twPunch.effect).toEqual(jasmine.objectContaining({ damage: 4, baseDamage: 2 }));
        expect(twShield.selectable).toBeTrue();
        expect(twShield.effect).toEqual(jasmine.objectContaining({
            damage: 5,
            maximumDamage: 5,
            boosted: false,
        }));
    });
});

function shieldComponent(fixture: DirectMekRuntimeFixture) {
    return [...fixture.index.components.values()].find(component =>
        component.kind === 'equipment' && component.mount.equipment?.hasFlag('F_SHIELD'))!;
}

function shieldCriticals(fixture: DirectMekRuntimeFixture) {
    const component = shieldComponent(fixture);
    return [...fixture.index.slots.values()]
        .filter(slot => slot.componentIds.includes(component.id))
        .sort((left, right) => left.slotIndex - right.slotIndex);
}

function onlyShield(
    fixture: DirectMekRuntimeFixture,
    perspective: 'committed' | 'preview' = 'committed',
): MekShieldProjectionV2 {
    const projection = fixture.instance.query().mekShields(perspective);
    if (projection.kind !== 'supported' || projection.shields.length !== 1) {
        throw new Error('Expected one supported shield');
    }
    return projection.shields[0]!;
}

function supportedMovement(fixture: DirectMekRuntimeFixture) {
    const movement = fixture.instance.query().mekMovementPsr();
    if (movement.kind !== 'supported') throw new Error('Expected supported movement');
    return movement;
}

function panel(fixture: DirectMekRuntimeFixture) {
    return projectMekEquipmentPanel(
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        fixture.instance.query(),
        emptyCBTEncounterSnapshot(),
    );
}

function damageShield(
    fixture: DirectMekRuntimeFixture,
    track: MekShieldTrack,
    amount: number,
    target: 'committed' | 'pending',
): void {
    expect(fixture.instance.dispatch({
        type: 'damage-shield',


        componentId: shieldComponent(fixture).id,
        track,
        amount,
        target,
    }).accepted).toBeTrue();
}

function hitCritical(fixture: DirectMekRuntimeFixture, slotId: ReturnType<typeof shieldCriticals>[number]['id']): void {
    expect(fixture.instance.dispatch({
        type: 'hit-critical',


        slotId,
        hits: 1,
        target: 'committed',
    }).accepted).toBeTrue();
}

function hitSystem(fixture: DirectMekRuntimeFixture, systemType: string): void {
    const slot = [...fixture.index.slots.values()].find(candidate =>
        fixture.index.locations.get(candidate.locationId)?.code === 'LA'
        && candidate.componentIds.some(componentId => {
            const component = fixture.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === systemType;
        }));
    if (!slot) throw new Error(`Missing ${systemType}`);
    hitCritical(fixture, slot.id);
}

function setHeat(fixture: DirectMekRuntimeFixture, heat: number): void {
    expect(fixture.instance.dispatch({
        type: 'set-heat',


        heat,
    }).accepted).toBeTrue();
}
