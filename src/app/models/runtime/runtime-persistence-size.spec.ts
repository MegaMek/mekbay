// SPDX-License-Identifier: GPL-3.0-or-later

import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { CBTMekUnit } from './cbt-mek-unit';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    validateSerializedCBTForceV2,
    type SerializedCBTForceV2,
    type SerializedForceEncounterEntryV2,
} from './persistence-v2';
import { RUNTIME_HISTORY_MESSAGE, type SerializedRuntimeHistory } from './runtime-history';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import { TestTankEntity } from '../entity/testing/test-entities';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { GameSystem } from '../common.model';
import { encodeForceForStorage } from './force-storage-codec';

function emptySerializedEncounterV2(): SerializedForceEncounterEntryV2 {
    return {
        encounterRevision: 0,
        state: { schemaVersion: 2, encounterRevision: 0, facts: [] },
    };
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

    it('keeps a 100-unit current-and-previous-turn save comfortably below 600 KB', async () => {
        const template = await pristineMek();
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
        const units = instanceIds.map(instanceId => {
            const unit = Object.freeze({ ...template, instanceId });
            return Object.freeze({
                instanceId,
                stateRevision: unit.stateRevision,
                unit,
            });
        });
        const force: SerializedCBTForceV2 = {
            schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
            minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
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
        expect(byteLength(stored)).toBeLessThan(90_000);
    });
});

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

function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}
