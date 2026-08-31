// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { SerializedForce } from '../force-serialization';
import type { JsonObject, PersistedUnitIdentity } from '../persisted-unit-state';
import type { DeferredUnitSource } from '../persisted-unit-state';
import { asUnitProviderId, asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import {
    TestAeroSpaceFighterEntity,
    TestTankEntity,
    TestVtolEntity,
} from '../entity/testing/test-entities';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import {
    convertPersistedNonMekUnitV1,
    convertPersistedForceV1,
} from './legacy-force-v1-converter';
import { ReadyNonMekUnit } from './ready-non-mek-unit';
import { asStateRevision, asUnitInstanceId } from './runtime-state';
import { nonMekDamageTrackId } from '../rules/non-mek-damage-track-rules';

const PROVIDER = asUnitProviderId('mm-data');
const UUID = asUnitUuid('01890f3a-9d5b-7c24-8b2e-6f8a10d31234');

describe('Classic V1 force converter', () => {
    it('converts each saved unit and roster member directly to one deferred V2 entry', async () => {
        const source = v1Force();
        const converted = await convertPersistedForceV1(source, { resolveIdentity });
        const envelope = converted.cbt!;

        expect(converted.version).toBe(2);
        expect(envelope.forceRevision).toBe(asStateRevision(0));
        expect(envelope.units.map(entry => entry.kind)).toEqual(['deferred', 'deferred']);
        expect(envelope.units.map(entry => entry.instanceId)).toEqual([
            asUnitInstanceId('unit:a'), asUnitInstanceId('unit:b'),
        ]);
        expect(envelope.units[0].kind === 'deferred' ? envelope.units[0].source.identity.kind : null)
            .toBe('resolved');
        expect(envelope.units[1].kind === 'deferred' ? envelope.units[1].source.identity.kind : null)
            .toBe('unresolved');
        expect(envelope.roster).toEqual({
            schemaVersion: 1,
            groups: [{
                groupId: 'group:converted',
                order: 0,
                name: 'Converted Lance',
                color: '#abcdef',
                formationId: 'formation:line',
                formationLock: true,
                members: [
                    { kind: 'deferred', instanceId: asUnitInstanceId('unit:a'), order: 0, commander: true },
                    { kind: 'deferred', instanceId: asUnitInstanceId('unit:b'), order: 1 },
                ],
            }],
        });
        expect(envelope.encounter.state).toEqual({
            schemaVersion: 2,
            encounterRevision: asStateRevision(0),
            facts: [],
        });
        expect(JSON.stringify(envelope.encounter.recovery?.c3Networks))
            .toBe('[{"id":"network:one","type":"C3i","color":"#abcdef","peerIds":["unit:a","unit:b"]}]');
    });

    it('retains unknown unit and family state without a bridge envelope', async () => {
        const source = v1Force();
        const rawUnit = source.groups![0].units[0] as unknown as JsonObject;
        rawUnit['futureUnitMember'] = 'retained';
        (rawUnit['state'] as JsonObject)['futureFamilyState'] = { retained: true };
        (rawUnit['state'] as JsonObject)['crits'] = [{ id: 'Laser@LT#3', loc: 'LT', slot: 3 }];

        const converted = await convertPersistedForceV1(source, { resolveIdentity });
        const entry = converted.cbt!.units[0];
        expect(entry.kind).toBe('deferred');
        if (entry.kind !== 'deferred') return;
        expect(String((entry.source.payload as JsonObject)['futureUnitMember'])).toBe('retained');
        const retainedState = (entry.source.payload as JsonObject)['state'] as JsonObject;
        expect(JSON.stringify(retainedState))
            .toContain('"futureFamilyState":{"retained":true}');
        expect(JSON.stringify(retainedState['crits']))
            .toBe('[{"id":"Laser@LT#3","loc":"LT","slot":3}]');
        expect(Object.hasOwn(entry.source, 'recovery')).toBeFalse();
    });

    it('normalizes sparse group metadata and rejects conflicting commanders', async () => {
        const normalized = v1Force();
        normalized.groups![0].name = '  Converted Lance  ';
        normalized.groups![0].formationLock = false;
        const converted = await convertPersistedForceV1(normalized, { resolveIdentity });
        expect(converted.cbt!.roster.groups[0].name).toBe('Converted Lance');
        expect(converted.cbt!.roster.groups[0].formationLock).toBeUndefined();

        const duplicate = v1Force();
        duplicate.groups![0].units[1].commander = true;
        await expectAsync(convertPersistedForceV1(duplicate, { resolveIdentity }))
            .toBeRejectedWithError(/at most one commander/u);
    });

    it('carries the current production V1 formation target into the canonical roster', async () => {
        const source = v1Force();
        source.groups![0].formationTargetGroupId = 'group:target';
        source.groups!.push({ id: 'group:target', units: [] });

        const converted = await convertPersistedForceV1(source, { resolveIdentity });

        expect(converted.cbt!.roster.groups.map(group => group.groupId)).toEqual([
            'group:converted', 'group:target',
        ]);
        expect(converted.cbt!.roster.groups[0].formationTargetGroupId).toBe('group:target');
    });

    it('requires the force-unit UUID to be present and unique', async () => {
        const duplicate = v1Force();
        duplicate.groups![0].units[1].id = 'unit:a';
        await expectAsync(convertPersistedForceV1(duplicate, { resolveIdentity }))
            .toBeRejectedWithError(/duplicate unit ID unit:a/u);

        const missing = v1Force();
        delete (missing.groups![0].units[0] as Partial<{ id: string }>).id;
        await expectAsync(convertPersistedForceV1(missing, { resolveIdentity }))
            .toBeRejectedWithError(/requires an ID/u);
    });

    it('materializes non-Mek V1 state into the direct Non-Mek runtime', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        const locationCode = entity.locationOrder[0];
        entity.setArmorValue(locationCode, 'front', 5);
        const identity = Object.freeze({
            origin: 'megamek' as const,
            provider: PROVIDER,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        });
        const fresh = ReadyNonMekUnit.create(entity, {
            instanceId: asUnitInstanceId('unit:tank'),
            identity,
            deployment: { id: 'v1-conversion' },
            scenario: { id: 'test', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const location = [...fresh.getIndex().locations.values()]
            .find(candidate => candidate.code === locationCode)!;
        const source: DeferredUnitSource = {
            payload: {
                unit: 'Legacy Tank',
                state: {
                    destroyed: true,
                    locations: {
                        [locationCode]: {
                            internal: Math.min(1, location.internalPoints),
                            armor: 2,
                            pendingArmor: 1,
                        },
                    },
                    conditions: ['immobile'],
                    crew: [{
                        id: 0,
                        name: 'Ada',
                        gunnerySkill: 3,
                        pilotingSkill: 4,
                        hits: 2,
                        state: 1,
                    }],
                    turnState: {
                        turnCounter: 3,
                        airborne: true,
                        moveMode: 'walk',
                        moveDistance: 4,
                    },
                    heat: 5,
                },
            },
            identity: { kind: 'resolved', savedIdentity: identity },
        };

        const saved = convertPersistedNonMekUnitV1(source, fresh);
        const restored = ReadyNonMekUnit.restore(saved, entity, identity);
        const state = restored.getInstance().snapshot();

        expect(saved.family).toEqual({ kind: 'non-mek', entityType: 'Tank' });
        expect(saved.deployment.values.crewAssignment.positions[0]).toEqual(jasmine.objectContaining({
            name: 'Ada', gunnery: 3, piloting: 4,
        }));
        expect(saved.restoration?.unresolved).toContain(
            'Malformed V1 heat state was retained for recovery.',
        );
        expect(saved.restoration?.unresolved.join('\n')).not.toContain('V1 turn field');
        expect(saved.turn).toEqual({
            turnCounter: 3,
            airborne: true,
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        });
        expect(JSON.stringify(saved)).not.toContain('"heat":5');
        expect(state.explicitlyDestroyed).toBeTrue();
        expect(state.conditions.has('immobile')).toBeTrue();
        expect(state.crew.get([...fresh.getIndex().crewPositions.keys()][0])).toEqual({
            wounds: 2, unconscious: true, ejected: false,
        });
        expect(state.turn).toEqual({
            turnCounter: 3,
            airborne: true,
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
            weaponsHeat: 0,
            cover: null,
            spotting: false,
        });
        expect(restored.getInstance().remainingArmor(location.armorFaceIds[0])).toBe(3);

        const legacyCrew = (((source.payload as JsonObject)['state'] as JsonObject)
            ['crew'] as JsonObject[])[0];
        legacyCrew['hits'] = 0;
        legacyCrew['state'] = 5;
        const stunnedSaved = convertPersistedNonMekUnitV1(source, fresh);
        const positionId = [...fresh.getIndex().crewPositions.keys()][0];
        expect(ReadyNonMekUnit.restore(stunnedSaved, entity, identity)
            .getInstance().snapshot().crew.get(positionId)?.state).toBe('stunned');
        expect(stunnedSaved.restoration?.unresolved.join('\n')).not.toContain('stunned crew state');

        legacyCrew['state'] = 4;
        const killedSaved = convertPersistedNonMekUnitV1(source, fresh);
        expect(ReadyNonMekUnit.restore(killedSaved, entity, identity)
            .getInstance().snapshot().crew.get(positionId)?.state).toBe('killed');
    });

    it('restores the production V1 aerospace heat profile into direct non-Mek state', () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.uuid.set(UUID);
        entity.heatSinkCount.set(10);
        const identity = Object.freeze({
            origin: 'megamek' as const,
            provider: PROVIDER,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        });
        const fresh = ReadyNonMekUnit.create(entity, {
            instanceId: asUnitInstanceId('unit:aero-v1'),
            identity,
            deployment: { id: 'v1-conversion' },
            scenario: { id: 'test', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const source: DeferredUnitSource = {
            payload: {
                unit: 'Legacy Aero',
                state: {
                    heat: {
                        current: 5,
                        next: 19,
                        previous: 2,
                        heatsinksOff: 2,
                    },
                },
            },
            identity: { kind: 'resolved', savedIdentity: identity },
        };

        const saved = convertPersistedNonMekUnitV1(source, fresh);
        expect(saved.heat).toEqual({
            current: 5,
            previous: 2,
            pendingOverride: 19,
            heatsinksOff: 2,
        });
        expect(saved.restoration?.unresolved.join('\n') ?? '').not.toContain('heat');
        expect(ReadyNonMekUnit.restore(saved, entity, identity).getInstance().snapshot().heat)
            .toEqual(saved.heat!);
    });

    it('restores committed and pending non-Mek V1 system damage without treating it as equipment', () => {
        const entity = new TestVtolEntity();
        entity.uuid.set(UUID);
        const identity = Object.freeze({
            origin: 'megamek' as const,
            provider: PROVIDER,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        });
        const fresh = ReadyNonMekUnit.create(entity, {
            instanceId: asUnitInstanceId('unit:vtol-v1'),
            identity,
            deployment: { id: 'v1-conversion' },
            scenario: { id: 'test', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const source: DeferredUnitSource = {
            payload: {
                unit: 'Legacy VTOL',
                state: {
                    crits: [{
                        id: 'rotor',
                        hits: 2,
                        pendingHits: 1,
                        hitTimestamps: [10, 20],
                        pendingHitTimestamps: [30],
                    }, {
                        id: 'motive_system_hit_2',
                        hits: 3,
                        pendingHits: -1,
                        hitTimestamps: [40, 50, 60],
                    }],
                },
            },
            identity: { kind: 'resolved', savedIdentity: identity },
        };

        const saved = convertPersistedNonMekUnitV1(source, fresh);
        const restored = ReadyNonMekUnit.restore(saved, entity, identity).getInstance();
        const rotor = nonMekDamageTrackId('rotor');
        const motive = nonMekDamageTrackId('motive_system_hit_2');

        expect(saved.damageTrackState).toEqual([
            { damageTrackId: motive, hits: 3, hitTimestamps: [40, 50, 60] },
            { damageTrackId: rotor, hits: 2, hitTimestamps: [10, 20] },
        ]);
        expect(saved.pendingCombat?.damageTrackHits).toEqual([
            { damageTrackId: motive, hitDelta: -1, hitTimestamps: [] },
            { damageTrackId: rotor, hitDelta: 1, hitTimestamps: [30] },
        ]);
        expect(restored.damageTrackHits(rotor, 'committed')).toBe(2);
        expect(restored.damageTrackHits(rotor, 'preview')).toBe(3);
        expect(restored.damageTrackHits(motive, 'committed')).toBe(3);
        expect(restored.damageTrackHits(motive, 'preview')).toBe(2);
        expect(restored.damageTrackTimeline('preview')).toEqual([
            { damageTrackId: rotor, timestamp: 10 },
            { damageTrackId: rotor, timestamp: 20 },
            { damageTrackId: rotor, timestamp: 30 },
            { damageTrackId: motive, timestamp: 40 },
            { damageTrackId: motive, timestamp: 50 },
        ]);
        expect(saved.restoration?.unresolved.join('\n') ?? '')
            .not.toContain('has no unique current component');
    });
});

describe('Alpha Strike V1 force converter', () => {
    it('changes only the force version and detaches the persisted graph', async () => {
        const source = {
            version: 1,
            timestamp: '2026-08-10T00:00:00.000Z',
            instanceId: 'force:as',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Converted AS Force',
            groups: [{
                id: 'group:as',
                units: [{
                    id: 'unit:as',
                    unit: 'AS Unit',
                    skill: 4,
                    abilities: [],
                    state: {
                        modified: false,
                        destroyed: false,
                        heat: [0, 0],
                        armor: [0, 0],
                        internal: [0, 0],
                        crits: [],
                        pCrits: [],
                    },
                }],
            }],
        };

        const converted = await convertPersistedForceV1(source as unknown as SerializedForce);

        expect(converted).toEqual({ ...source, version: 2 });
        expect(converted).not.toBe(source);
        expect(converted.groups).not.toBe(source.groups);
    });

    it('rejects records that are not V1', async () => {
        await expectAsync(convertPersistedForceV1({ ...v1Force(), version: 2 }))
            .toBeRejectedWithError(/requires a version 1 force/u);
    });
});

function resolveIdentity(rawUnit: Readonly<Record<string, unknown>>): PersistedUnitIdentity {
    return rawUnit['unit'] === 'Mek A'
        ? {
            kind: 'resolved',
            savedIdentity: { origin: 'megamek', provider: PROVIDER, uuid: UUID },
        }
        : {
            kind: 'unresolved',
            rawLegacyName: String(rawUnit['unit'] ?? ''),
            candidates: [],
            reason: 'not-found',
        };
}

function v1Force(): SerializedForce {
    return {
        version: 1,
        timestamp: '2026-08-10T00:00:00.000Z',
        instanceId: 'force:converted',
        type: GameSystem.CLASSIC,
        name: 'Converted Force',
        groups: [{
            id: 'group:converted',
            name: 'Converted Lance',
            color: '#abcdef',
            formationId: 'formation:line',
            formationLock: true,
            units: [
                {
                    id: 'unit:a',
                    unit: 'Mek A',
                    commander: true,
                    state: { modified: true, destroyed: false, heat: 1 },
                },
                {
                    id: 'unit:b',
                    unit: 'Vehicle B',
                    state: { modified: true, destroyed: false, motive: 2 },
                },
            ],
        }],
        c3Networks: [{
            id: 'network:one',
            type: 'C3i' as never,
            color: '#abcdef',
            peerIds: ['unit:a', 'unit:b'],
        }],
    } as unknown as SerializedForce;
}
