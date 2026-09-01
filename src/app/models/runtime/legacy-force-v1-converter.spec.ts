// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { SerializedForce } from '../force-serialization';
import type { JsonObject, PersistedUnitIdentity } from '../persisted-unit-state';
import type { LegacyUnitSourceV1 } from '../persisted-unit-state';
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
    type PersistedForceV1ConversionOptions,
    type PersistedForceV1ConversionWarning,
} from './legacy-force-v1-converter';
import { ReadyNonMekUnit } from './ready-non-mek-unit';
import { asStateRevision, asUnitInstanceId } from './runtime-state';
import { nonMekDamageTrackId } from '../rules/non-mek-damage-track-rules';
import { DEFAULT_FORCE_DEPLOYMENT_ID } from './unit-state-initializer';
import { C3NetworkType } from '../c3-network.model';
import { MiscEquipment } from '../equipment.model';

const PROVIDER = asUnitProviderId('mm-data');
const UUID = asUnitUuid('01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
const CLASSIC_OPTIONS: PersistedForceV1ConversionOptions = {
    resolveIdentity,
    materializeUnit: materializeNonMek,
};

describe('Classic V1 force converter', () => {
    it('treats a missing legacy game-system discriminator as Classic', async () => {
        const source = { ...v1Force() } as unknown as Record<string, unknown>;
        delete source['type'];

        const converted = await convertPersistedForceV1(source as unknown as SerializedForce, CLASSIC_OPTIONS);

        expect(converted.type).toBe(GameSystem.CLASSIC);
        expect(converted.cbt?.units.length).toBe(1);
    });

    it('materializes found units, skips missing units, and stores no V1 payload', async () => {
        const source = v1Force();
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS,
            onWarning: warning => warnings.push(warning),
        });
        const envelope = converted.cbt!;

        expect(converted.version).toBe(2);
        expect(envelope.units.map(entry => entry.instanceId)).toEqual([asUnitInstanceId('unit:a')]);
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
                    { instanceId: asUnitInstanceId('unit:a'), order: 0, commander: true },
                ],
            }],
        });
        expect(envelope.encounter.state).toEqual({
            schemaVersion: 2,
            encounterRevision: asStateRevision(0),
            facts: [],
        });
        expect(JSON.stringify(converted)).not.toContain('"payload"');
        expect(warnings.some(warning => warning.kind === 'unit-skipped' && warning.unit === 'Vehicle B')).toBeTrue();
        expect(warnings.some(warning => warning.kind === 'force-state-reset')).toBeTrue();
    });

    it('drops unknown V1 fields and reports the partial conversion', async () => {
        const source = v1Force();
        const rawUnit = source.groups![0].units[0] as unknown as JsonObject;
        rawUnit['futureUnitMember'] = 'retained';
        (rawUnit['state'] as JsonObject)['futureFamilyState'] = { retained: true };
        (rawUnit['state'] as JsonObject)['crits'] = [{ id: 'Laser@LT#3', loc: 'LT', slot: 3 }];

        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS,
            onWarning: warning => warnings.push(warning),
        });
        const entry = converted.cbt!.units[0];
        expect(JSON.stringify(converted)).not.toContain('futureUnitMember');
        expect(JSON.stringify(converted)).not.toContain('futureFamilyState');
        expect(warnings.some(warning => warning.kind === 'state-partial')).toBeTrue();
    });

    it('normalizes sparse group metadata and rejects conflicting commanders', async () => {
        const normalized = v1Force();
        normalized.groups![0].name = '  Converted Lance  ';
        normalized.groups![0].formationLock = false;
        const converted = await convertPersistedForceV1(normalized, CLASSIC_OPTIONS);
        expect(converted.cbt!.roster.groups[0].name).toBe('Converted Lance');
        expect(converted.cbt!.roster.groups[0].formationLock).toBeUndefined();

        const duplicate = v1Force();
        duplicate.groups![0].units[1].commander = true;
        await expectAsync(convertPersistedForceV1(duplicate, {
            ...CLASSIC_OPTIONS,
            resolveIdentity: resolveAllIdentity,
        }))
            .toBeRejectedWithError(/at most one commander/u);
    });

    it('converts valid V1 C3 links to typed encounter facts', async () => {
        const converted = await convertPersistedForceV1(v1Force(), {
            resolveIdentity: resolveAllIdentity,
            materializeUnit: materializeC3NonMek,
        });
        const facts = converted.cbt!.encounter.state.facts;

        expect(facts.length).toBe(1);
        expect(facts[0]).toEqual(jasmine.objectContaining({ kind: 'network' }));
        if (facts[0].kind !== 'network') return;
        expect(facts[0].network.networkType).toBe(C3NetworkType.C3I);
        expect(facts[0].network.endpoints.map(endpoint => endpoint.instanceId)).toEqual([
            asUnitInstanceId('unit:a'),
            asUnitInstanceId('unit:b'),
        ]);
    });

    it('carries the current production V1 formation target into the canonical roster', async () => {
        const source = v1Force();
        source.groups![0].formationTargetGroupId = 'group:target';
        source.groups!.push({ id: 'group:target', units: [] });

        const converted = await convertPersistedForceV1(source, CLASSIC_OPTIONS);

        expect(converted.cbt!.roster.groups.map(group => group.groupId)).toEqual([
            'group:converted', 'group:target',
        ]);
        expect(converted.cbt!.roster.groups[0].formationTargetGroupId).toBe('group:target');
    });

    it('requires the force-unit UUID to be present and unique', async () => {
        const duplicate = v1Force();
        duplicate.groups![0].units[1].id = 'unit:a';
        await expectAsync(convertPersistedForceV1(duplicate, CLASSIC_OPTIONS))
            .toBeRejectedWithError(/duplicate unit ID unit:a/u);

        const missing = v1Force();
        delete (missing.groups![0].units[0] as Partial<{ id: string }>).id;
        await expectAsync(convertPersistedForceV1(missing, CLASSIC_OPTIONS))
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
            deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
            scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const location = [...fresh.getIndex().locations.values()]
            .find(candidate => candidate.code === locationCode)!;
        const source: LegacyUnitSourceV1 = {
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
        expect(saved.restoration).toBeUndefined();
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
            phaseStateChanged: false,
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
        expect(stunnedSaved.restoration).toBeUndefined();

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
            deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
            scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const source: LegacyUnitSourceV1 = {
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
        expect(saved.restoration).toBeUndefined();
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
            deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
            scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const source: LegacyUnitSourceV1 = {
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
        expect(saved.restoration).toBeUndefined();
    });
});

describe('Alpha Strike V1 force converter', () => {
    it('resolves the V1 unit name to the canonical V2 UUID and drops pristine defaults', async () => {
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

        const converted = await convertPersistedForceV1(source as unknown as SerializedForce, {
            resolveIdentity: () => ({
                kind: 'resolved',
                savedIdentity: { origin: 'megamek', provider: PROVIDER, uuid: UUID },
            }),
        });

        expect(converted).toEqual({
            version: 2,
            timestamp: source.timestamp,
            instanceId: source.instanceId,
            type: GameSystem.ALPHA_STRIKE,
            name: source.name,
            groups: [{
                id: 'group:as',
                units: [{ id: 'unit:as', uuid: UUID }],
            }],
        });
        expect(converted).not.toBe(source);
        expect(converted.groups).not.toBe(source.groups);
    });

    it('rejects records that are not V1', async () => {
        await expectAsync(convertPersistedForceV1({ ...v1Force(), version: 2 }, CLASSIC_OPTIONS))
            .toBeRejectedWithError(/requires a version 1 force/u);
    });
});

async function materializeNonMek(
    request: Parameters<NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>>[0],
): Promise<ReadyNonMekUnit> {
    if (request.source.identity.kind !== 'resolved') throw new Error('Test identity must be resolved');
    const entity = new TestTankEntity();
    entity.uuid.set(request.source.identity.savedIdentity.uuid);
    entity.setTonnage(20);
    return ReadyNonMekUnit.create(entity, {
        instanceId: request.instanceId,
        identity: request.source.identity.savedIdentity,
        deployment: request.deployment,
        scenario: request.scenario,
        initialStateProfileId: 'pristine-non-mek-v1',
    });
}

async function materializeC3NonMek(
    request: Parameters<NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>>[0],
): Promise<ReadyNonMekUnit> {
    if (request.source.identity.kind !== 'resolved') throw new Error('Test identity must be resolved');
    const c3 = new MiscEquipment({
        id: 'TestC3i',
        name: 'C3i Computer',
        type: 'misc',
        flags: ['F_C3I'],
    });
    const entity = new TestTankEntity();
    entity.addEquipment({
        equipmentId: c3.id,
        equipment: c3,
        allocation: { kind: 'unallocated' },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    });
    entity.uuid.set(request.source.identity.savedIdentity.uuid);
    entity.setTonnage(20);
    return ReadyNonMekUnit.create(entity, {
        instanceId: request.instanceId,
        identity: request.source.identity.savedIdentity,
        deployment: request.deployment,
        scenario: request.scenario,
        initialStateProfileId: 'pristine-non-mek-v1',
    });
}

function resolveAllIdentity(): PersistedUnitIdentity {
    return {
        kind: 'resolved',
        savedIdentity: { origin: 'megamek', provider: PROVIDER, uuid: UUID },
    };
}

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
            type: C3NetworkType.C3I,
            color: '#abcdef',
            peerIds: ['unit:a', 'unit:b'],
        }],
    } as unknown as SerializedForce;
}
