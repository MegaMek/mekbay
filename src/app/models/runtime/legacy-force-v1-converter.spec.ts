// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { SerializedForce, SerializedGroup } from '../force-serialization';
import type { JsonObject, PersistedUnitIdentity } from '../persisted-unit-state';
import type { LegacyUnitSourceV1 } from '../persisted-unit-state';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import {
    TestAeroSpaceFighterEntity,
    TestTankEntity,
    TestVtolEntity,
} from '../entity/testing/test-entities';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import {
    convertPersistedMekUnitV1,
    convertPersistedNonMekUnitV1,
    convertPersistedForceV1,
    type PersistedForceV1ConversionOptions,
    type PersistedForceV1ConversionWarning,
} from './legacy-force-v1-converter';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import { nonMekDamageTrackId } from '../rules/non-mek-damage-track-rules';
import { DEFAULT_FORCE_DEPLOYMENT_ID, initializeUnitState } from './unit-state-initializer';
import { C3NetworkType } from '../c3-network.model';
import { MiscEquipment } from '../equipment.model';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import { CBTMekUnit } from './cbt-mek-unit';
import { CBTUnitInstance } from './unit-instance';

const UUID = asUnitUuid('01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
const SCENARIO = Object.freeze({ id: 'megamek', ruleset: CORE_2026_RULESET });
const CLASSIC_OPTIONS: PersistedForceV1ConversionOptions = {
    resolveIdentity,
    scenario: SCENARIO,
    materializeUnit: materializeNonMek,
};

describe('CBT V1 force converter', () => {
    it('reports discarded Mek movement facts while keeping readable damage and crew', async () => {
        const source = v1Force();
        source.groups![0].units = [source.groups![0].units[0]];
        delete source.c3Networks;
        (source.groups![0].units[0] as unknown as JsonObject)['state'] = {
            heat: { current: 4 },
            crew: [{ id: 0, name: 'Pilot', gunnerySkill: 3, pilotingSkill: 4, hits: 2, state: 0 }],
            turnState: { moveMode: 'run', moveDistance: 8 },
        };
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS,
            materializeUnit: materializeMek,
            onWarning: warning => warnings.push(warning),
        });

        expect(warnings).toEqual([jasmine.objectContaining({
            kind: 'state-partial', message: jasmine.stringMatching('could not be converted'),
        })]);
        expect(JSON.stringify(converted)).toContain('"heat":4');
        expect(JSON.stringify(converted)).toContain('"wounds":2');
        expect(JSON.stringify(converted)).not.toMatch(/"(?:payload|unresolved|recoveryId)"/u);
    });

    it('does not report converted Mek crew and C3 position as lost state', async () => {
        const source = v1Force();
        source.groups![0].units = [source.groups![0].units[0]];
        delete source.c3Networks;
        (source.groups![0].units[0] as unknown as JsonObject)['state'] = {
            crew: [{ id: 0, name: 'Pilot', gunnerySkill: 3, pilotingSkill: 4, hits: 2, state: 0 }],
            c3Position: { x: 12, y: 34 },
        };
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS,
            materializeUnit: materializeMek,
            onWarning: warning => warnings.push(warning),
        });

        expect(warnings).toEqual([]);
        expect(converted.cbt!.encounter.c3Positions).toEqual([{ unitId: 'unit:a', x: 12, y: 34 }]);
    });

    for (const [family, materializeUnit] of [['Mek', materializeMek], ['non-Mek', materializeNonMek]] as const) {
        for (const shutdown of [false, true]) {
            it(`converts early V1 ${family} shutdown (${shutdown}) into V2 conditions without warnings`, async () => {
                const source = v1Force();
                source.groups![0].units = [source.groups![0].units[0]];
                delete source.c3Networks;
                (source.groups![0].units[0] as unknown as JsonObject)['state'] = {
                    shutdown,
                    crew: [{ id: 0, gunnerySkill: 3, pilotingSkill: 4, hits: 2, state: 0 }],
                };
                const warnings: PersistedForceV1ConversionWarning[] = [];
                const converted = await convertPersistedForceV1(source, {
                    ...CLASSIC_OPTIONS, materializeUnit, onWarning: warning => warnings.push(warning),
                });

                expect(converted.version).toBe(2);
                const conditions = converted.cbt!.units[0].unit.conditions;
                expect(conditions).toEqual(shutdown
                    ? (family === 'Mek' ? { values: ['shutdown'] } : ['shutdown'])
                    : undefined);
                expect(JSON.stringify(converted)).toContain('"wounds":2');
                expect(JSON.stringify(converted)).not.toContain('"shutdown":');
                expect(warnings).toEqual([]);
            });
        }

        it(`warns and resets unreadable ${family} state while retaining the identified unit`, async () => {
            const source = v1Force();
            source.groups![0].units = [source.groups![0].units[0]];
            delete source.c3Networks;
            (source.groups![0].units[0] as unknown as JsonObject)['state'] = 'unreadable';
            const warnings: PersistedForceV1ConversionWarning[] = [];
            const converted = await convertPersistedForceV1(source, {
                ...CLASSIC_OPTIONS, materializeUnit, onWarning: warning => warnings.push(warning),
            });

            expect(converted.cbt!.units.length).toBe(1);
            expect(warnings).toEqual([jasmine.objectContaining({ kind: 'state-reset', unit: 'Mek A' })]);
        });

        it(`reports malformed ${family} containers and crew without dropping readable state`, async () => {
            const source = v1Force();
            source.groups![0].units = [source.groups![0].units[0]];
            delete source.c3Networks;
            (source.groups![0].units[0] as unknown as JsonObject)['state'] = {
                destroyed: true, inventory: {}, crits: {},
                crew: [{ id: 0, name: 'Pilot', gunnerySkill: 99, hits: 'invalid', state: 'invalid' }],
            };
            const warnings: PersistedForceV1ConversionWarning[] = [];
            const converted = await convertPersistedForceV1(source, {
                ...CLASSIC_OPTIONS, materializeUnit, onWarning: warning => warnings.push(warning),
            });

            expect(converted.cbt!.units.length).toBe(1);
            expect(warnings).toEqual([jasmine.objectContaining({ kind: 'state-partial' })]);
            expect(warnings[0].message.toLowerCase()).toContain('inventory');
            expect(warnings[0].message.toLowerCase()).toContain('critical');
            expect(warnings[0].message.toLowerCase()).toContain('crew');
            expect(JSON.stringify(converted)).toContain('"destroyed":true');
        });
    }

    it('rejects a record with no legacy roster instead of creating an empty force', async () => {
        const source = v1Force();
        delete source.groups;
        await expectAsync(convertPersistedForceV1(source, CLASSIC_OPTIONS))
            .toBeRejectedWithError(/groups must be an array/u);
    });

    it('folds legacy Mek stunned/killed states into its wound-tracked V2 facts', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const fresh = new CBTMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );
        const source: LegacyUnitSourceV1 = {
            payload: {
                unit: 'Legacy Mek',
                state: {
                    crew: [{ id: 0, hits: 0, state: 5 }],
                },
            },
            identity: { kind: 'resolved', uuid: fixture.identity },
        };

        const stunned = await convertPersistedMekUnitV1(source, fresh, SCENARIO);
        expect(stunned.crew.positions[0]).toEqual(jasmine.objectContaining({
            wounds: 0,
            unconscious: true,
        }));

        const legacyCrew = (((source.payload as JsonObject)['state'] as JsonObject)
            ['crew'] as JsonObject[])[0]!;
        legacyCrew['state'] = 4;
        const killed = await convertPersistedMekUnitV1(source, fresh, SCENARIO);
        expect(killed.crew.positions[0]).toEqual(jasmine.objectContaining({
            wounds: 6,
            dead: true,
        }));
    });

    it('treats a missing legacy game-system discriminator as CBT', async () => {
        const source = { ...v1Force() } as unknown as Record<string, unknown>;
        delete source['type'];

        const converted = await convertPersistedForceV1(source as unknown as SerializedForce, CLASSIC_OPTIONS);

        expect(converted.type).toBe(GameSystem.CBT);
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
        expect(envelope.units.map(entry => entry.instanceId)).toEqual(['unit:a']);
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
                    { instanceId: 'unit:a', order: 0, commander: true },
                ],
            }],
        });
        expect(envelope.encounter).toEqual({
            networks: [],
            c3Positions: [{ unitId: 'unit:a', x: 203, y: 392 }],
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
        expect(JSON.stringify(converted)).not.toContain('futureUnitMember');
        expect(JSON.stringify(converted)).not.toContain('futureFamilyState');
        expect(warnings.some(warning => warning.kind === 'state-partial')).toBeTrue();
    });

    it('normalizes sparse group metadata and keeps the first conflicting commander with a warning', async () => {
        const normalized = v1Force();
        normalized.groups![0].name = '  Converted Lance  ';
        normalized.groups![0].formationLock = false;
        const converted = await convertPersistedForceV1(normalized, CLASSIC_OPTIONS);
        expect(converted.cbt!.roster.groups[0].name).toBe('Converted Lance');
        expect(converted.cbt!.roster.groups[0].formationLock).toBeUndefined();

        const duplicate = v1Force();
        duplicate.groups![0].units[1].commander = true;
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const recovered = await convertPersistedForceV1(duplicate, {
            ...CLASSIC_OPTIONS,
            resolveIdentity: resolveAllIdentity,
            onWarning: warning => warnings.push(warning),
        });
        expect(recovered.cbt!.roster.groups[0].members.map(member => member.commander)).toEqual([true, undefined]);
        expect(warnings.some(warning => warning.kind === 'state-partial' && warning.message.includes('commander')))
            .toBeTrue();
    });

    it('drops malformed commander flags while retaining identified units', async () => {
        const source = v1Force();
        (source.groups![0].units[0] as unknown as JsonObject)['commander'] = 'invalid';
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
        });
        expect(converted.cbt!.units.length).toBe(1);
        expect(converted.cbt!.roster.groups[0].members[0].commander).toBeUndefined();
        expect(warnings.some(warning => warning.kind === 'state-partial' && warning.message.includes('commander')))
            .toBeTrue();
    });

    it('converts valid V1 C3 links to durable encounter networks', async () => {
        const converted = await convertPersistedForceV1(v1Force(), {
            resolveIdentity: resolveAllIdentity,
            scenario: SCENARIO,
            materializeUnit: materializeC3NonMek,
        });
        const networks = converted.cbt!.encounter.networks;

        expect(networks.length).toBe(1);
        expect(networks[0].networkType).toBe(C3NetworkType.C3I);
        expect(networks[0].endpoints.map(endpoint => endpoint.instanceId)).toEqual([
            'unit:a',
            'unit:b',
        ]);
        expect(converted.cbt!.encounter.c3Positions).toEqual([
            { unitId: 'unit:a', x: 203, y: 392 },
            { unitId: 'unit:b', x: 407, y: 392 },
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

    for (const system of [GameSystem.AS, GameSystem.CBT]) {
        it(`repairs only missing, invalid and duplicate ${system} unit IDs while retaining recognizable units`, async () => {
            const source = { ...v1Force(), type: system };
            delete source.c3Networks;
            source.groups![0].units = [
                { id: UUID, unit: 'Mek A' },
                { id: UUID, unit: 'Mek A' },
                { unit: 'Mek A' },
                { id: 42, unit: 'Mek A' },
                { id: '', unit: 'Mek A' },
            ] as unknown as SerializedGroup['units'];
            const original = structuredClone(source);
            const warnings: PersistedForceV1ConversionWarning[] = [];
            const converted = await convertPersistedForceV1(source, {
                ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
            });
            const ids = converted.cbt?.units.map(entry => entry.instanceId)
                ?? converted.groups!.flatMap(group => group.units.map(unit => unit.id));

            expect(ids.length).toBe(5);
            expect(ids[0]).toBe(UUID);
            expect(new Set(ids).size).toBe(5);
            expect(ids.slice(1).every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id))).toBeTrue();
            expect(warnings.filter(warning => warning.kind === 'state-partial').length).toBe(4);
            expect(source).toEqual(original);
        });

        it(`drops ambiguous ${system} C3 references without dropping unambiguous peers`, async () => {
            const duplicateId = '019f6767-0dcb-7bb8-992f-000000000001';
            const secondId = '019f6767-0dcb-7bb8-992f-000000000002';
            const thirdId = '019f6767-0dcb-7bb8-992f-000000000003';
            const source = { ...v1Force(), type: system };
            source.groups![0].units = [duplicateId, duplicateId, secondId, thirdId]
                .map(id => ({ id, unit: 'Mek A' })) as unknown as SerializedGroup['units'];
            source.c3Networks = [{ id: 'network:ambiguous', type: C3NetworkType.C3I,
                color: '#abcdef', peerIds: [duplicateId, secondId, thirdId] }];
            const warnings: PersistedForceV1ConversionWarning[] = [];
            const converted = await convertPersistedForceV1(source, {
                ...CLASSIC_OPTIONS, materializeUnit: materializeC3NonMek,
                onWarning: warning => warnings.push(warning),
            });
            const peers = converted.cbt?.encounter.networks[0]?.endpoints.map(endpoint => endpoint.instanceId)
                ?? converted.c3Networks?.[0]?.peerIds;

            expect(peers).toEqual([secondId, thirdId]);
            expect(warnings.some(warning => warning.kind === 'force-state-reset' && warning.message.includes('C3'))).toBeTrue();
        });

        it(`still rejects a structurally unrecognizable ${system} unit`, async () => {
            const source = { ...v1Force(), type: system };
            source.groups![0].units = [{}] as SerializedGroup['units'];
            await expectAsync(convertPersistedForceV1(source, CLASSIC_OPTIONS))
                .toBeRejected();
        });

        it(`repairs corrupt ${system} group IDs and removes ambiguous formation targets`, async () => {
            const source = { ...v1Force(), type: system };
            delete source.c3Networks;
            source.groups = [
                { id: UUID, units: [{ id: 'unit:a', unit: 'Mek A' }] },
                { id: UUID, units: [{ id: 'unit:b', unit: 'Mek A' }] },
                { id: null, units: [{ id: 'unit:c', unit: 'Mek A' }], formationTargetGroupId: UUID },
                { units: [{ id: 'unit:d', unit: 'Mek A' }] },
            ] as unknown as SerializedGroup[];
            const warnings: PersistedForceV1ConversionWarning[] = [];
            const converted = await convertPersistedForceV1(source, {
                ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
            });
            const groups = converted.cbt?.roster.groups ?? converted.groups!;
            const ids = groups.map(group => 'groupId' in group ? group.groupId : group.id);

            expect(ids.length).toBe(4);
            expect(ids[0]).toBe(UUID);
            expect(new Set(ids).size).toBe(4);
            expect(ids[3]).toBe('v1-group:3');
            expect(groups[2].formationTargetGroupId).toBeUndefined();
            expect(warnings.filter(warning => warning.kind === 'force-state-reset').length).toBe(3);
        });
    }

    it('materializes non-Mek V1 state into the direct Non-Mek runtime', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(20);
        const locationCode = entity.locationOrder[0];
        entity.setArmorValue(locationCode, 'front', 5);
        const identity = UUID;
        const fresh = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:tank',
            uuid: identity,
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
                    shutdown: true,
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
            identity: { kind: 'resolved', uuid: identity },
        };

        const issues: string[] = [];
        const saved = convertPersistedNonMekUnitV1(source, fresh, issue => issues.push(issue));
        const restored = CBTNonMekUnit.restore(saved, entity, identity, SCENARIO);
        const state = restored.getInstance().snapshot();

        expect(saved.family).toEqual({ kind: 'non-mek', entityType: 'Tank' });
        expect(saved.deployment.values.crewAssignment.positions[0]).toEqual(jasmine.objectContaining({
            name: 'Ada', gunnery: 3, piloting: 4,
        }));
        expect(saved.turn).toEqual({
            turnCounter: 3,
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
        });
        expect(JSON.stringify(saved)).not.toContain('"heat":5');
        expect(issues.some(issue => issue.includes('shutdown'))).toBeFalse();
        expect(state.explicitlyDestroyed).toBeTrue();
        expect(state.conditions.has('immobile')).toBeTrue();
        expect(state.crew.get([...fresh.getIndex().crewPositions.keys()][0])).toEqual({
            wounds: 2, unconscious: true, ejected: false,
        });
        expect(state.turn).toEqual({
            turnCounter: 3,
            airborne: null,
            movement: { mode: 'walk', distance: 4, boosterComponentIds: [] },
            weaponsHeat: 0,
            cover: null,
            spotting: false,
            phaseStateChanged: false,
        });
        expect(restored.getInstance().query().remainingArmor(location.armorFaceIds[0])).toBe(3);

        const legacyCrew = (((source.payload as JsonObject)['state'] as JsonObject)
            ['crew'] as JsonObject[])[0];
        legacyCrew['hits'] = 0;
        legacyCrew['state'] = 5;
        const stunnedSaved = convertPersistedNonMekUnitV1(source, fresh);
        const positionId = [...fresh.getIndex().crewPositions.keys()][0];
        expect(CBTNonMekUnit.restore(stunnedSaved, entity, identity, SCENARIO)
            .getInstance().snapshot().crew.get(positionId)?.unconscious).toBeTrue();

        legacyCrew['state'] = 4;
        const killedSaved = convertPersistedNonMekUnitV1(source, fresh);
        expect(CBTNonMekUnit.restore(killedSaved, entity, identity, SCENARIO)
            .getInstance().snapshot().crew.get(positionId)).toEqual(jasmine.objectContaining({
                wounds: 6,
                dead: true,
            }));
    });

    it('restores the production V1 aerospace heat profile into direct non-Mek state', () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.uuid.set(UUID);
        entity.heatSinkCount.set(10);
        const identity = UUID;
        const fresh = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:aero-v1',
            uuid: identity,
            deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
            scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const source: LegacyUnitSourceV1 = {
            payload: {
                unit: 'Legacy Aero',
                state: {
                    crew: [{ id: 0, hits: 0, state: 4 }],
                    heat: {
                        current: 5,
                        next: 19,
                        previous: 2,
                        heatsinksOff: 2,
                    },
                },
            },
            identity: { kind: 'resolved', uuid: identity },
        };

        const saved = convertPersistedNonMekUnitV1(source, fresh);
        expect(saved.heat).toEqual({
            current: 5,
            previous: 2,
            pendingOverride: 19,
            heatsinksOff: 2,
        });
        expect(CBTNonMekUnit.restore(saved, entity, identity, SCENARIO).getInstance().snapshot().heat)
            .toEqual(saved.heat!);
        expect(saved.crewState?.[0]).toEqual(jasmine.objectContaining({
            wounds: 6,
            dead: true,
        }));
    });

    it('restores committed and pending non-Mek V1 system damage without treating it as equipment', () => {
        const entity = new TestVtolEntity();
        entity.uuid.set(UUID);
        const identity = UUID;
        const fresh = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:vtol-v1',
            uuid: identity,
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
            identity: { kind: 'resolved', uuid: identity },
        };

        const saved = convertPersistedNonMekUnitV1(source, fresh);
        const restored = CBTNonMekUnit.restore(saved, entity, identity, SCENARIO).getInstance();
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
        expect(restored.snapshot().damageTracks.get(rotor)?.hits).toBe(2);
        expect((restored.snapshot().damageTracks.get(rotor)?.hits ?? 0)
            + (restored.snapshot().pendingCombat.damageTrackHits.get(rotor)?.hitDelta ?? 0)).toBe(3);
        expect(restored.snapshot().damageTracks.get(motive)?.hits).toBe(3);
        expect((restored.snapshot().damageTracks.get(motive)?.hits ?? 0)
            + (restored.snapshot().pendingCombat.damageTrackHits.get(motive)?.hitDelta ?? 0)).toBe(2);
    });
});

for (const type of [GameSystem.CBT, GameSystem.AS]) {
    it(`loads ${type} units with a warning when the display name is unreadable`, async () => {
        const source = { ...v1Force(), type };
        delete source.c3Networks;
        source.groups![0].units = [source.groups![0].units[0]];
        (source.groups![0].units[0] as unknown as JsonObject)['state'] = {};
        (source as unknown as JsonObject)['name'] = null;
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
        });
        expect(converted.name).toBe('');
        expect(type === GameSystem.CBT ? converted.cbt!.units.length : converted.groups![0].units.length).toBe(1);
        expect(warnings).toEqual([jasmine.objectContaining({ kind: 'force-state-reset' })]);
    });

    it(`loads ${type} units when optional group metadata is unreadable`, async () => {
        const source = { ...v1Force(), type };
        delete source.c3Networks;
        source.groups![0].units = [source.groups![0].units[0]];
        (source.groups![0].units[0] as unknown as JsonObject)['state'] = {};
        const group = source.groups![0] as unknown as JsonObject;
        group['formationId'] = { invalid: true };
        group['formationLock'] = 'invalid';
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
        });
        const restored = type === GameSystem.CBT ? converted.cbt!.roster.groups[0] : converted.groups![0];
        expect(restored.name).toBe('Converted Lance');
        expect(restored.formationId).toBeUndefined();
        expect(restored.formationLock).toBeUndefined();
        expect(warnings.every(warning => warning.kind === 'force-state-reset')).toBeTrue();
        expect(warnings.length).toBe(2);
    });
}

describe('Alpha Strike V1 force converter', () => {
    it('preserves an empty force name written by the production V1 serializer', async () => {
        const source = { ...v1Force(), type: GameSystem.AS, name: '', groups: [] };
        const converted = await convertPersistedForceV1(source, CLASSIC_OPTIONS);
        expect(converted.name).toBe('');
    });

    it('loads recognizable units with warnings for missing units and unreadable state', async () => {
        const source = { ...v1Force(), type: GameSystem.AS };
        delete source.c3Networks;
        (source.groups![0].units[0] as unknown as JsonObject)['state'] = null;
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
        });
        expect(converted.groups![0].units).toEqual([{ id: 'unit:a', uuid: UUID }]);
        expect(warnings).toEqual([
            jasmine.objectContaining({ kind: 'state-reset', unit: 'Mek A' }),
            jasmine.objectContaining({ kind: 'unit-skipped', unit: 'Vehicle B' }),
        ]);
    });

    it('converts production V1 committed and pending damage, criticals, and abilities', async () => {
        const source = { ...v1Force(), type: GameSystem.AS };
        source.groups![0].units = [source.groups![0].units[0]];
        delete source.c3Networks;
        const row = source.groups![0].units[0] as unknown as JsonObject;
        row['skill'] = 3;
        row['abilities'] = ['weapon-specialist', { name: 'Custom', summary: 'Description', cost: 2 }];
        row['state'] = {
            modified: true, heat: [1, 2], armor: [3, -1], internal: [1, 1],
            crits: [{ key: 'engine', timestamp: 123 }],
            pCrits: [{ key: 'weapons', timestamp: 456 }],
            consumed: { 'weapon-specialist': [1, 2] }, exhausted: [['a'], ['b'], ['c']],
        };
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            ...CLASSIC_OPTIONS, onWarning: warning => warnings.push(warning),
        });
        expect(converted.groups![0].units[0] as unknown as Record<string, unknown>).toEqual(jasmine.objectContaining({
            skill: 3, abilities: ['weapon-specialist', { name: 'Custom', summary: 'Description', cost: 2 }],
            state: {
                modified: true, heat: [1, 2], armor: [3, -1], internal: [1, 1],
                crits: [['engine', 123]], pCrits: [['weapons', 456]],
                consumed: { 'weapon-specialist': [1, 2] }, exhausted: [['a'], ['b'], ['c']],
            },
        }));
        expect(warnings).toEqual([]);
    });

    it('resolves the V1 unit name to the canonical V2 UUID and drops pristine defaults', async () => {
        const source = {
            version: 1,
            timestamp: '2026-08-10T00:00:00.000Z',
            instanceId: 'force:as',
            type: GameSystem.AS,
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
                uuid: UUID,
            }),
        });

        expect(converted).toEqual({
            version: 2,
            timestamp: source.timestamp,
            instanceId: source.instanceId,
            type: GameSystem.AS,
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
): Promise<CBTNonMekUnit> {
    if (request.source.identity.kind !== 'resolved') throw new Error('Test identity must be resolved');
    const entity = new TestTankEntity();
    entity.uuid.set(request.source.identity.uuid);
    entity.setTonnage(20);
    return CBTNonMekUnit.create(entity, {
        instanceId: request.instanceId,
        uuid: request.source.identity.uuid,
        deployment: request.deployment,
        scenario: request.scenario,
        initialStateProfileId: 'pristine-non-mek-v1',
    });
}

async function materializeMek(
    request: Parameters<NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>>[0],
): Promise<CBTMekUnit> {
    const fixture = createDirectMekRuntimeFixture(CORE_2026_RULESET, request.instanceId);
    // Use the fixture design for the resolver's requested identity, as the real catalog does.
    fixture.entity.uuid.set(UUID);
    const initialized = initializeUnitState(fixture.entity, fixture.index, UUID, {
        deployment: request.deployment, scenario: request.scenario,
        initializerRevision: 1, profileId: 'pristine-v1-converter-test',
    });
    const instance = new CBTUnitInstance(request.instanceId, initialized.baselineRef, fixture.entity,
        fixture.index, initialized.baselineRef.ruleset, initialized.state, initialized.deployment.crewAssignment);
    return new CBTMekUnit(fixture.entity, UUID, instance, {
        schemaVersion: 2, values: initialized.deployment,
    });
}

async function materializeC3NonMek(
    request: Parameters<NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>>[0],
): Promise<CBTNonMekUnit> {
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
    entity.uuid.set(request.source.identity.uuid);
    entity.setTonnage(20);
    return CBTNonMekUnit.create(entity, {
        instanceId: request.instanceId,
        uuid: request.source.identity.uuid,
        deployment: request.deployment,
        scenario: request.scenario,
        initialStateProfileId: 'pristine-non-mek-v1',
    });
}

function resolveAllIdentity(): PersistedUnitIdentity {
    return {
        kind: 'resolved',
        uuid: UUID,
    };
}

function resolveIdentity(rawUnit: Readonly<Record<string, unknown>>): PersistedUnitIdentity {
    return rawUnit['unit'] === 'Mek A'
        ? {
            kind: 'resolved',
            uuid: UUID,
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
        type: GameSystem.CBT,
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
                    state: {
                        modified: true,
                        destroyed: false,
                        heat: 1,
                        c3Position: { x: 203, y: 392 },
                    },
                },
                {
                    id: 'unit:b',
                    unit: 'Vehicle B',
                    state: {
                        modified: true,
                        destroyed: false,
                        motive: 2,
                        c3Position: { x: 407, y: 392 },
                    },
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
