// SPDX-License-Identifier: GPL-3.0-or-later

import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { CBTMekUnit } from './cbt-mek-unit';
import {
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    validateSerializedCBTForceV2,
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
} from './persistence-v2';
import { RUNTIME_HISTORY_MESSAGE, type SerializedRuntimeHistory } from './runtime-history';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import { TestTankEntity } from '../entity/testing/test-entities';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { GameSystem } from '../common.model';
import { encodeForceForStorage } from './force-storage-codec';
import type { ASSerializedForce, ASSerializedState, ASSerializedUnit } from '../force-serialization';

function emptySerializedEncounterV2(): SerializedCBTEncounterStateV2 {
    return { networks: [] };
}

describe('compact runtime persistence', () => {
    it('does not copy pristine Mek topology into sparse state', async () => {
        const unit = await pristineMek();

        expect(Object.keys(unit.blueprintReferences.targets)).toEqual([]);
        expect(byteLength(unit)).toBeLessThan(2_000);
    });

    it('does not copy pristine non-Mek topology into sparse state', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
        entity.uuid.set(uuid);
        entity.setTonnage(20);
        const identity = uuid;
        const unit = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:size-tank',
            uuid: identity,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
        }).serialize();

        expect(Object.hasOwn(unit, 'references')).toBeFalse();
        expect(byteLength(unit)).toBeLessThan(1_500);
    });

    it('keeps a 100-unit Alpha Strike force with mixed damage below 40 KB', () => {
        const units = Array.from({ length: 100 }, (_, index) => mixedAlphaStrikeUnit(index));
        const force: ASSerializedForce = {
            version: 2,
            timestamp: '2026-08-22T00:00:00.000Z',
            instanceId: uuidAt(9_999),
            type: GameSystem.AS,
            name: 'Mixed Alpha Strike damage budget',
            groups: Array.from({ length: 20 }, (_, groupIndex) => ({
                id: uuidAt(8_000 + groupIndex),
                name: `Formation ${groupIndex + 1}`,
                units: units.slice(groupIndex * 5, groupIndex * 5 + 5),
            })),
        };

        const stored = encodeForceForStorage(force);
        expect(byteLength(stored)).toBeLessThan(40_000);
    });

    it('keeps 100 CBT units with mixed damage and two turns below 120 KB', async () => {
        const template = await representativeDamagedMek();
        const instanceIds = Array.from({ length: 100 }, (_, index) => 
            `019f6767-0dcb-7bb8-992f-${String(index).padStart(12, '0')}`,
        );
        const history = Object.freeze({
            u: Object.freeze(instanceIds),
            t: Object.freeze(Array.from({ length: 2 }, (_, turn) => Object.freeze({
                n: turn + 19,
                p: Object.freeze(Array.from({ length: 4 }, () => Object.freeze(instanceIds.map(
                    (_instanceId, unitIndex) => Object.freeze([
                    RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
                    unitIndex,
                    'f:ll',
                    1,
                    'pending',
                ] as const),
                )))),
            }))),
        }) satisfies SerializedRuntimeHistory;
        const units = instanceIds.map((instanceId, index) => {
            const unit = mixedDamageMek(template, instanceId, index);
            return Object.freeze({
                instanceId,
                stateRevision: unit.stateRevision,
                unit,
            });
        });
        const force: SerializedCBTForceV2 = {
            schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
            forceId: asForceId('019f6767-0dcb-7bb8-992f-999999999999'),
            forceRevision: 0,
            history,
            units,
            roster: {
                schemaVersion: 1,
                groups: [{
                    groupId: '019f6767-0dcb-7bb8-992f-888888888888',
                    order: 0,
                    name: 'Size budget',
                    members: instanceIds.map((instanceId, order) => ({
                        instanceId,
                        order,
                    })),
                }],
            },
            encounter: emptySerializedEncounterV2(),
        };

        await expectAsync(validateSerializedCBTForceV2(force)).toBeResolved();
        expect(history.u.length).toBe(100);
        expect(JSON.stringify(history.t)).not.toContain(instanceIds[0]);
        const stored = encodeForceForStorage({
            version: 2,
            timestamp: '2026-08-22T00:00:00.000Z',
            instanceId: force.forceId,
            type: GameSystem.CBT,
            name: 'Maximum size budget',
            cbt: force,
        });
        expect(byteLength(stored)).toBeLessThan(120_000);
    });
});

function mixedAlphaStrikeUnit(index: number): ASSerializedUnit {
    const damage = index % 5;
    const state: ASSerializedState | undefined = damage === 0
        ? undefined
        : {
            modified: true,
            armor: [damage, damage === 2 ? 1 : 0],
            ...(damage < 3 ? {} : { internal: [damage - 2, damage === 3 ? 1 : 0] }),
            ...(damage < 2 ? {} : { heat: [damage - 1, index % 2] }),
            ...(damage < 4 ? {} : {
                crits: [['weapon', 1_000 + index]],
                consumed: { BOMB1: [1, index % 2] },
                exhausted: [['CASEII'], [], []],
            }),
        };
    return {
        id: uuidAt(index),
        uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
        ...(state === undefined ? {} : { state }),
        ...(index % 7 === 0 ? { skill: 3 } : {}),
    };
}

function uuidAt(index: number): string {
    return `019f6767-0dcb-7bb8-992f-${String(index).padStart(12, '0')}`;
}

async function pristineMek() {
    const fixture = createDirectMekRuntimeFixture();
    return (await CBTMekUnit.createFromEntity({
        uuid: fixture.identity,
        instanceId: 'unit:size-template',
    }, fixture.entity, fixture.identity, {
            initializerRevision: 1,
            profileId: 'pristine',
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
    })).serialize();
}

async function representativeDamagedMek() {
    const fixture = createDirectMekRuntimeFixture();
    const armor = [...fixture.index.armorFaces.values()].find(face => face.maximumPoints > 2)!;
    const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.length > 0)!;
    const crew = [...fixture.index.crewPositions.keys()][0]!;
    expect(fixture.instance.dispatch({
        type: 'damage-armor',
        faceId: armor.id,
        amount: 2,
        target: 'committed',
    }).accepted).toBeTrue();
    expect(fixture.instance.dispatch({
        type: 'hit-critical',
        slotId: slot.id,
        hits: 1,
        target: 'committed',
    }).accepted).toBeTrue();
    expect(fixture.instance.dispatch({
        type: 'set-crew-state',
        positionId: crew,
        wounds: 2,
        unconscious: true,
        ejected: false,
    }).accepted).toBeTrue();
    expect(fixture.instance.dispatch({ type: 'set-heat', heat: 6 }).accepted).toBeTrue();
    return new CBTMekUnit(
        fixture.entity,
        fixture.identity,
        fixture.instance,
        { schemaVersion: 2, values: fixture.initialized.deployment },
    ).serialize();
}

function mixedDamageMek(
    template: Awaited<ReturnType<typeof representativeDamagedMek>>,
    instanceId: string,
    index: number,
): Awaited<ReturnType<typeof representativeDamagedMek>> {
    const damage = index % 5;
    const {
        locationState,
        slotState,
        heat,
        crew,
        ...common
    } = template;
    return Object.freeze({
        ...common,
        instanceId,
        ...(damage === 0 || locationState === undefined
            ? {}
            : {
                locationState: Object.freeze(locationState.map(row => Object.freeze({
                    ...row,
                    damage: Math.min(row.damage, damage),
                }))),
            }),
        ...(damage < 2 || slotState === undefined ? {} : { slotState }),
        crew: Object.freeze({
            ...crew,
            positions: damage < 3
                ? Object.freeze([])
                : Object.freeze(crew.positions.map(position => Object.freeze({
                    ...position,
                    wounds: damage - 2,
                    unconscious: damage === 4,
                }))),
        }),
        ...(damage < 4 || heat === undefined ? {} : { heat }),
    });
}

function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}
