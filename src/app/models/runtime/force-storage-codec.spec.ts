// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { ASSerializedForce, SerializedCBTForce, SerializedForce } from '../force-serialization';
import {
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    emptyRuntimeHistory,
    type SerializedCBTForceV2,
    type SerializedCBTUnitV2,
    validateSerializedCBTForceV2,
} from './persistence-v2';
import { CBTMekUnit } from './cbt-mek-unit';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import { isSerializedNonMekUnit, type SerializedNonMekUnit } from './non-mek-unit-persistence';
import {
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';
import { TestAeroSpaceFighterEntity, TestTankEntity } from '../entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../entity/testing/test-mounted-equipment';
import { componentIdForMount } from './non-mek-runtime-index';
import { asComponentId } from '../entity/entity-identifiers';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { asSourceHashCanary } from '../source-hash-canary';
import {
    decodeForceFromStorage as decodeStorageRecord,
    encodeForceForStorage as encodeStorageRecord,
} from './force-storage-codec';
import { RUNTIME_HISTORY_MESSAGE } from './runtime-history';
import {
    CBT_HISTORY_MUTATION_TARGET_CODE,
} from './force-storage-vocabulary';
import { MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION } from './mek-movement-psr-v2';
import {
    DEFAULT_FORCE_DEPLOYMENT_ID,
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    UNIT_STATE_INITIALIZER_REVISION,
} from './unit-state-initializer';

describe('compact force storage codec', () => {
    it('owns queued Alpha Strike state independently of later source edits', () => {
        const force: ASSerializedForce = {
            version: 2, timestamp: '2026-09-01T12:00:00.000Z',
            instanceId: '019f6767-0dcb-7bb8-992f-aef08202f5e3', type: GameSystem.AS, name: 'Queued save',
            groups: [{ id: '019f6767-0dcb-7bb8-992f-aef08202f5e4', units: [{
                id: '019f6767-0dcb-7bb8-992f-aef08202f5e5', uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
                state: { armor: [2, 1], consumed: { BOMB1: [0, 1] } },
            }] }],
        };
        const stored = encodeForceForStorage(force);
        force.groups[0].units[0].state!.armor![0] = 99;
        force.groups[0].units[0].state!.consumed!['BOMB1'][1] = 99;
        const restored = decodeForceFromStorage(stored) as ASSerializedForce;
        expect(restored.groups[0].units[0].state).toEqual({ armor: [2, 1], consumed: { BOMB1: [0, 1] } });
    });

    it('round-trips lossless Alpha Strike state through projection-friendly short keys', () => {
        const firstId = '019f6767-0dcb-7bb8-992f-aef08202f5e4';
        const secondId = '~legacy-unit-id';
        const force: ASSerializedForce = {
            version: 2,
            timestamp: '2026-09-01T12:00:00.000Z',
            instanceId: '019f6767-0dcb-7bb8-992f-aef08202f5e7',
            type: GameSystem.AS,
            name: 'Compact AS',
            note: 'Lossless mutable facts',
            tags: ['Test'],
            factionId: 5,
            eraId: 3150,
            pv: 84,
            owned: false,
            groups: [{
                id: '019f6767-0dcb-7bb8-992f-aef08202f5e6',
                name: 'Lance',
                color: '#123456',
                formationId: 'battle-lance',
                formationLock: true,
                formationTargetGroupId: '~legacy-target',
                units: [{
                    id: firstId,
                    uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
                    sourceHashCanary: asSourceHashCanary('k8zQ'),
                    alias: 'Lead',
                    updatedTs: 42,
                    skill: 3,
                    abilities: ['Melee Master', { name: 'Custom', cost: 2, summary: 'Summary' }],
                    formationAbilities: ['LEAD'],
                    commander: true,
                    state: {
                        modified: true,
                        destroyed: true,
                        conditions: ['shutdown', { key: 'tagged', value: 2, pending: true }],
                        c3Position: { x: 12, y: -4 },
                        heat: [2, 1],
                        armor: [4, 2],
                        internal: [3, 1],
                        crits: [['engine', 11]],
                        pCrits: [['weapons', -12]],
                        consumed: { BOMB4: [2, 1] },
                        exhausted: [['OVL'], ['TSEMP'], ['ENE']],
                    },
                }, {
                    id: secondId,
                    uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e3'),
                }],
            }],
            c3Networks: [{
                id: '019f6767-0dcb-7bb8-992f-aef08202f5e5',
                type: 'c3i',
                color: '#abcdef',
                peerIds: [firstId, secondId],
            }],
        };

        const stored = encodeForceForStorage(force);
        expect(stored['timestamp']).toBe(Date.parse(force.timestamp));
        expect(stored['groups']).toBeUndefined();
        expect(stored['c3Networks']).toBeUndefined();
        const compact = stored['a'] as Record<string, unknown>;
        const group = (compact['g'] as Record<string, unknown>[])[0]!;
        const unit = (group['u'] as Record<string, unknown>[])[0]!;
        expect(unit['u']).toMatch(/^[A-Za-z0-9_-]{22}$/u);
        expect(unit['h']).toBe('k8zQ');
        expect(unit['c3']).toEqual([12, -4]);
        expect((unit['x'] as Record<string, unknown>)['d']).toBe(1);
        expect((unit['x'] as Record<string, unknown>)['p']).toBeUndefined();
        expect(byteLength(stored)).toBeLessThan(byteLength(force) * 0.75);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        expect(decoded).toEqual(force);
    });

    it('restores sparse state while rebuilding omitted Entity references at load', async () => {
        const force = damagedForce();
        const stored = encodeForceForStorage(force);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));

        const originalEntry = force.cbt!.units[0]!;
        const decodedEntry = decoded.cbt!.units[0]!;
        const originalUnit = originalEntry.unit as SerializedCBTUnitV2;
        const decodedUnit = decodedEntry.unit as SerializedCBTUnitV2;
        expect(decodedUnit.locationState).toEqual(originalUnit.locationState);
        expect(decodedUnit.turn.endTurnCheckpoint).toBe('phase-ended');
        expect(decodedUnit.turn.pendingFallConsequences)
            .toEqual(originalUnit.turn.pendingFallConsequences);
        expect(decodedUnit.blueprintReferences.targets).toEqual({});
        await expectAsync(validateSerializedCBTForceV2(decoded.cbt)).toBeResolved();

        const fixture = createDirectMekRuntimeFixture();
        const restored = await CBTMekUnit.restoreFromEntity(
            decodedUnit,
            fixture.entity,
            fixture.identity,
            {
                initializerRevision: 1,
                profileId: 'pristine',
                deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        );
        const restoredUnit = restored.serialize();
        expect(restoredUnit.locationState).toEqual(originalUnit.locationState);
        expect(restoredUnit.turn.pendingFallConsequences)
            .toEqual(originalUnit.turn.pendingFallConsequences);
        expect(Object.keys(restoredUnit.blueprintReferences.targets).length).toBeGreaterThan(0);

        const compact = stored['cbt'] as Record<string, unknown>;
        expect(compact['schemaVersion']).toBeUndefined();
        expect(compact['forceId']).toBeUndefined();
        expect(compact['history']).toBeUndefined();
        expect(compact['encounter']).toBeUndefined();

        const unit = (compact['u'] as Record<string, unknown>[])[0]!;
        expect(unit['h']).toBe('k8zQ');
        expect(unit['c3']).toEqual([203, 392]);
        expect(unit['q']).toBeUndefined();
        expect(unit['baselineRefAtSave']).toBeUndefined();
        expect(unit['blueprintReferences']).toBeUndefined();
        expect(unit['family']).toBeUndefined();
        expect(unit['movementPsr']).toBeUndefined();
        expect(unit['attackerTargeting']).toBeUndefined();
        expect((unit['t'] as Record<string, unknown>)['f']).toBeDefined();
        expect(((unit['l'] as unknown[][])[0]![0] as string)).toMatch(/^[fr]:[a-z]+$/u);
        expect(((unit['s'] as unknown[][])[0]![0] as string)).toMatch(/^s:/u);
        expect(JSON.stringify(unit)).not.toMatch(/(?:location|armor|slot|critical|mek):/u);
        expect(byteLength(stored)).toBeLessThan(byteLength(force) * 0.55);
    });

    it('stores C3 networks as unit-indexed encounter tuples', () => {
        const source = damagedForce();
        const instanceId = source.cbt!.units[0].instanceId;
        const force: SerializedCBTForce = {
            ...source,
            cbt: {
                ...source.cbt!,
                encounter: {
                    ...source.cbt!.encounter,
                    networks: [{
                        id: 'network:compact',
                        networkType: 'c3',
                        color: '#123456',
                        endpoints: [{
                            instanceId,
                            componentId: asComponentId('component:c3-master'),
                            role: 'master',
                        }],
                    }],
                },
            },
        };

        const stored = encodeForceForStorage(force);
        expect((stored['cbt'] as Record<string, unknown>)['e']).toEqual([[
            'network:compact',
            'c3',
            '#123456',
            [[0, 'component:c3-master', 'master']],
        ]]);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        expect(decoded.cbt!.encounter).toEqual(force.cbt!.encounter);
    });

    it('persists an ordered critical continuation cursor through compact storage', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const locationId = [...fixture.index.locations.keys()][0]!;
        const turn = fixture.instance.query().turnState();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',
            turn: {
                ...turn,
                pendingCriticalEvents: [{
                    type: 'critical-chance',
                    eventId: 'critical:compact-storage',
                    locationId,
                    target: 'committed',
                    roll: [3, 4],
                    modifier: 1,
                    total: 8,
                    result: 1,
                    breakdown: [{ label: 'IndustrialMech', value: 1 }],
                    effects: ['1 critical hit'],
                    caseIIDiscards: [false],
                }],
            },
        }).accepted).toBeTrue();
        const unit = new CBTMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        ).serialize();
        const force = forceWithUnit(unit, 'force:critical-storage', 'Critical storage');

        const stored = encodeForceForStorage(force);
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect((compactUnit['t'] as Record<string, unknown>)['q']).toBeDefined();
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const decodedUnit = decoded.cbt!.units[0]!.unit as SerializedCBTUnitV2;

        expect(decodedUnit.turn.pendingCriticalEvents).toEqual(unit.turn.pendingCriticalEvents);
        const restored = await CBTMekUnit.restoreFromEntity(
            decodedUnit,
            fixture.entity,
            fixture.identity,
            {
                initializerRevision: 1,
                profileId: 'pristine',
                deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        );
        expect(restored.serialize().turn.pendingCriticalEvents)
            .toEqual(unit.turn.pendingCriticalEvents);
    });

    it('stores committed and pending Modular Armor damage in compact component rows', () => {
        const fixture = createDirectModularArmorRuntimeFixture();
        const panel = [...fixture.index.components.values()].find(component =>
            component.kind === 'equipment'
            && component.mount.equipment?.hasFlag('F_MODULAR_ARMOR') === true)!;
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(panel.id))!;
        const face = [...fixture.index.armorFaces.values()].find(candidate =>
            candidate.locationId === slot.locationId && candidate.face === 'front')!;
        expect(fixture.instance.dispatch({
            type: 'damage-armor',

            faceId: face.id, amount: 6, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'damage-armor',

            faceId: face.id, amount: 3, target: 'pending',
        }).accepted).toBeTrue();
        const ready = new CBTMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );
        const unit = ready.serialize();
        const force = forceWithUnit(unit, 'force:compact-modular', 'Compact Modular Armor');
        const stored = encodeForceForStorage(force);
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect((compactUnit['c'] as unknown[][]).some(row =>
            (row[1] as Record<string, unknown>)['r'] === 6)).toBeTrue();
        expect((compactUnit['p'] as Record<string, unknown>)['m']).toEqual(jasmine.any(Array));

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Compact Modular Armor fixture did not decode as a Mek');
        }
        expect(entry.unit.componentState?.some(row => row.modularArmorDamage === 6)).toBeTrue();
        expect(entry.unit.pendingCombat?.modularArmorDamage?.[0]?.damage).toBe(3);
    });

    it('round-trips current compact history through the IndexedDB record', () => {
        const source = damagedForce();
        const instanceId = 'unit:019f6767-0dcb-7bb8-992f-aef08202f5e4';
        const groupId = '019f6767-0dcb-7bb8-992f-aef08202f5e5';
        const originalEntry = source.cbt!.units[0]!;
        const unit = { ...originalEntry.unit, instanceId };
        const history = {
            u: [instanceId],
            t: [{
                n: 7,
                p: [[
                    [
                        RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
                        0,
                        'f:la',
                        2,
                        'pending',
                    ],
                    [
                        RUNTIME_HISTORY_MESSAGE.REPAIR_ARMOR,
                        0,
                        'f:la',
                        1,
                        'committed',
                    ],
                ]],
            }],
        } as const;
        const force: SerializedCBTForce = {
            ...source,
            cbt: {
                ...source.cbt!,
                history,
                units: [{ ...originalEntry, instanceId, unit }],
                roster: {
                    ...source.cbt!.roster,
                    groups: [{
                        ...source.cbt!.roster.groups[0]!,
                        groupId,
                        members: [{ instanceId, order: 0 }],
                    }],
                },
            },
        };

        const stored = encodeForceForStorage(force);
        const compact = stored['cbt'] as Record<string, unknown>;
        const compactUnit = (compact['u'] as Record<string, unknown>[])[0]!;
        const compactHistory = compact['h'] as Array<{ p: unknown[][][] }>;
        const compactGroup = (compact['g'] as unknown[][])[0]!;
        expect(stored['timestamp']).toBe(Date.parse(force.timestamp));
        expect(compactUnit['k']).toBeUndefined();
        expect(compactUnit['i']).toMatch(/^~u[A-Za-z0-9_-]{22}$/u);
        expect(compactUnit['e']).toMatch(/^[A-Za-z0-9_-]{22}$/u);
        expect(compactHistory[0]!.p[0]![0]).toEqual([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            0,
            'f:la',
            2,
            CBT_HISTORY_MUTATION_TARGET_CODE.pending,
        ]);
        expect(compactHistory[0]!.p[0]![1]).toEqual([
            RUNTIME_HISTORY_MESSAGE.REPAIR_ARMOR,
            0,
            'f:la',
            1,
            CBT_HISTORY_MUTATION_TARGET_CODE.committed,
        ]);
        expect(compactGroup[0]).toMatch(/^~[A-Za-z0-9_-]{22}$/u);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        expect(decoded.cbt!.history).toEqual(history);
        expect(decoded.cbt!.roster.groups[0]!.groupId).toBe(groupId);
        expect(decoded.cbt!.units[0]!.instanceId).toBe(instanceId);
        expect(decoded.cbt!.units[0]!.unit.entity).toBe(originalEntry.unit.entity);
    });

    it('round-trips a compact movement declaration together with its pending PSR', async () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        expect(fixture.instance.dispatch({
            type: 'declare-mek-movement',
            declaration: {
                schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
                mode: 'walk',
                distance: 3,
                boosterComponentIds: [],
            },
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const footActuator = [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'LL'
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(fixture.instance.dispatch({
            type: 'hit-critical',
            slotId: footActuator.id,
            hits: 1,
            target: 'committed',
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.instance.query().mekPilotChecks()).toEqual([
            jasmine.objectContaining({ reason: 'Leg Actuator hit', status: 'pending' }),
        ]);

        const unit = new CBTMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        ).serialize();
        const stored = encodeForceForStorage(forceWithUnit(
            unit,
            'force:movement-psr',
            'Movement and PSR',
        ));
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        const compactMovement = compactUnit['m'] as Record<string, unknown>;
        expect(compactMovement['m']).toEqual(['walk', 3]);
        expect(compactMovement['k']).toEqual(jasmine.any(Array));

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Movement/PSR fixture did not decode as a Mek');
        }
        expect(entry.unit.movementPsr).toEqual(unit.movementPsr);
        const restored = await CBTMekUnit.restoreFromEntity(
            entry.unit,
            fixture.entity,
            fixture.identity,
            {
                initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment: entry.unit.deployment.values,
                scenario: { id: 'megamek', ruleset: 'total-warfare' },
            },
        );
        expect(restored.getInstance().query().mekPilotChecks()).toEqual(
            fixture.instance.query().mekPilotChecks(),
        );
    });

    it('keeps recent history for a unit that is no longer in the force', () => {
        const source = damagedForce();
        const removedInstanceId = 'unit:019f6767-0dcb-7bb8-992f-aef08202f5e4';
        const history = {
            u: [removedInstanceId],
            t: [{
                n: 1,
                p: [[[
                    RUNTIME_HISTORY_MESSAGE.UNIT_ACTION,
                    0,
                    'removed',
                ]]],
            }],
        } as const;
        const force: SerializedCBTForce = {
            ...source,
            cbt: {
                ...source.cbt!,
                history,
            },
        };

        const stored = encodeForceForStorage(force);
        const compact = stored['cbt'] as Record<string, unknown>;
        const compactHistory = compact['h'] as Array<{ p: unknown[][][] }>;
        expect(compactHistory[0]!.p[0]![0]![1]).toMatch(/^~u[A-Za-z0-9_-]{22}$/u);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        expect(decoded.cbt!.history).toEqual(history);
    });

    it('stores production defaults implicitly and roster membership by unit index', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await CBTMekUnit.createFromEntity({
            uuid: fixture.identity,
            instanceId: 'unit:implicit-defaults',
        }, fixture.entity, fixture.identity, {
                initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
        });
        const force = forceWithUnit(ready.serialize(), 'force:implicit-defaults', 'Implicit defaults');
        const stored = encodeForceForStorage(force);
        const compact = stored['cbt'] as Record<string, unknown>;
        const unit = (compact['u'] as Record<string, unknown>[])[0]!;

        expect(unit['b']).toBeUndefined();
        expect(unit['d']).toBeUndefined();
        expect(unit['r']).toBeUndefined();
        expect(unit['k']).toBeUndefined();
        expect(unit['e']).toMatch(/^[A-Za-z0-9_-]{22}$/u);
        expect(((compact['g'] as unknown[][])[0]![1] as unknown[][])[0]).toEqual([0]);
        expect(byteLength(stored)).toBeLessThan(400);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        await expectAsync(validateSerializedCBTForceV2(decoded.cbt)).toBeResolved();
        const entry = decoded.cbt!.units[0]!;
        if (isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Implicit-default fixture did not decode as a ready Mek');
        }
        expect(entry.unit.deployment.values.crewAssignment.positions).toEqual([]);
        const restored = await CBTMekUnit.restoreFromEntity(
            entry.unit,
            fixture.entity,
            fixture.identity,
            {
                initializerRevision: UNIT_STATE_INITIALIZER_REVISION,
                profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment: entry.unit.deployment.values,
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        );
        expect(restored.getCrewAssignment()).toEqual(ready.getCrewAssignment());
    });

    it('stores Mek row order as a compact integer permutation', async () => {
        const fixture = createDirectMekRuntimeFixture();
        expect(fixture.instance.setEquipmentRowOrder(
            'ranged',
            [1, 0],
            2,
            false,
        )).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const ready = new CBTMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );
        const unit = ready.serialize();
        const stored = encodeForceForStorage(forceWithUnit(
            unit,
            'force:row-order',
            'Row order',
        ));
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;

        expect(compactUnit['y']).toEqual({ r: [1, 0] });
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Row-order fixture did not decode as a ready Mek');
        }
        expect(entry.unit.equipmentRowOrder).toEqual({ ranged: [1, 0] });
        const restored = await CBTMekUnit.restoreFromEntity(
            entry.unit,
            fixture.entity,
            fixture.identity,
            {
                initializerRevision: 1,
                profileId: 'pristine',
                deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'core-2026' },
            },
        );
        expect(restored.getInstance().snapshot().equipmentRowOrder).toEqual({ ranged: [1, 0] });
    });

    it('round-trips formation target groups under one compact metadata key', () => {
        const source = damagedForce();
        const sourceGroup = source.cbt.roster.groups[0];
        const force: SerializedCBTForce = {
            ...source,
            cbt: {
                ...source.cbt,
                roster: {
                    schemaVersion: 1,
                    groups: [
                        { ...sourceGroup, formationTargetGroupId: 'group:target' },
                        { groupId: 'group:target', order: 1, members: [] },
                    ],
                },
            },
        };

        const stored = encodeForceForStorage(force);
        const compactGroups = (stored['cbt'] as Record<string, unknown>)['g'] as unknown[][];
        expect((compactGroups[0][2] as Record<string, unknown>)['t']).toBe(1);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        expect(decoded.cbt!.roster.groups[0].formationTargetGroupId).toBe('group:target');
    });

    it('round-trips non-Mek damage and ordered damage-track timestamps', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
        entity.uuid.set(uuid);
        entity.setTonnage(20);
        entity.originalWalkMP.set(8);
        entity.setArmorValue(entity.locationOrder[0], 'front', 5);
        const boosterId = componentIdForMount(addTestEquipmentWithFlags(
            entity,
            ['F_MASC', 'S_SUPERCHARGER'],
            { location: entity.locationOrder[0] },
        ));
        const identity = uuid;
        const ready = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:compact-tank',
            uuid: identity,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const runtime = ready.getInstance();
        const faceId = [...ready.getIndex().armorFaces.keys()][0]!;
        const damageTrackId = [...ready.getIndex().damageTracks.keys()][0]!;
        const crewPositionId = [...ready.getIndex().crewPositions.keys()][0]!;
        expect(runtime.dispatch({
            kind: 'end-phase', endTurnBoundary: true,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'edit-escalating-failure',
            componentId: boosterId, edit: { kind: 'select-sequence', index: 0 },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'damage-armor', faceId,
            amount: 2, target: 'committed',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'damage-track', damageTrackId,
            amount: 1, target: 'pending', timestamp: 17,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-movement',
            movement: { mode: 'run', distance: 5, boosterComponentIds: [] },
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-cover', cover: 'heavy',
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-spotting', spotting: true,
        }).accepted).toBeTrue();
        expect(runtime.dispatch({
            kind: 'set-crew-state', positionId: crewPositionId,
            wounds: 0, unconscious: true, ejected: false,
        }).accepted).toBeTrue();
        expect(runtime.setEquipmentRowOrder(
            'physical', [1, 0], 2, false,
        ).accepted).toBeTrue();

        const unit = ready.serialize();
        const force = forceWithUnit(unit, 'force:compact-tank', 'Compact tank');
        const stored = encodeForceForStorage(force);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (!isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Compact non-Mek fixture did not decode as a ready non-Mek unit');
        }
        expect(entry.unit.family.kind).toBe('non-mek');
        expect(entry.unit).toEqual(unit);
        expect(entry.unit.componentState).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({
                componentId: boosterId,
                escalatingFailure: { sequence: 1, active: true },
            }),
        ]));
        expect(CBTNonMekUnit.restore(
            entry.unit,
            entity,
            identity,
            { id: 'megamek', ruleset: 'core-2026' },
        ).serialize()).toEqual(unit);
        expect(entry.unit.pendingCombat?.damageTrackHits?.[0]?.hitTimestamps).toEqual([17]);

        const compact = stored['cbt'] as Record<string, unknown>;
        const compactUnit = (compact['u'] as Record<string, unknown>[])[0]!;
        expect(compactUnit['baselineRefAtSave']).toBeUndefined();
        expect(compactUnit['attackerTargeting']).toBeUndefined();
        expect(compactUnit['q']).toBeUndefined();
        expect(compactUnit['p']).toBeDefined();
        expect(compactUnit['w']).toEqual([[crewPositionId, 0, { unconscious: true }]]);
        expect(compactUnit['v']).toEqual([0, 0, ['run', 5], 0, 2, 1, 1, undefined, 1]);
        expect(compactUnit['y']).toEqual({ p: [1, 0] });
        expect(compactUnit['c']).toEqual([[boosterId, { e: [1, 1] }]]);
    });

    it('omits pristine non-Mek heat and stores only changed aerospace heat fields', () => {
        const entity = new TestAeroSpaceFighterEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e3');
        entity.uuid.set(uuid);
        entity.heatSinkCount.set(10);
        const identity = uuid;
        const ready = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:compact-aero-heat',
            uuid: identity,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
        });
        const pristine = encodeForceForStorage(forceWithUnit(
            ready.serialize(),
            'force:compact-aero-pristine',
            'Compact pristine aero',
        ));
        expect(((pristine['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!['z'])
            .toBeUndefined();

        const runtime = ready.getInstance();
        runtime.dispatch({
            kind: 'set-heat',

            heat: 19,
            target: 'pending',
        });
        runtime.dispatch({
            kind: 'set-heatsinks-off',

            heatsinksOff: 2,
        });
        runtime.dispatch({
            kind: 'set-condition',

            condition: 'out-of-control',
            active: true,
        });
        runtime.dispatch({
            kind: 'set-control-recovery',

            workflow: { readyTurn: 1, cause: 'heat-random-movement' },
        });
        const pilotId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',

            positionId: pilotId,
            wounds: 1,
            unconscious: true,
            ejected: false,
            recoveryReadyTurn: 1,
        });
        const unit = ready.serialize();
        const stored = encodeForceForStorage(forceWithUnit(
            unit,
            'force:compact-aero-heat',
            'Compact aero heat',
        ));
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect(compactUnit['z']).toEqual({ o: 19, s: 2 });
        expect((compactUnit['v'] as unknown[])[7]).toEqual([1, 0]);
        expect(compactUnit['w']).toEqual([[pilotId, 1, { unconscious: true }, 1]]);

        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const entry = decoded.cbt!.units[0]!;
        if (!isSerializedNonMekUnit(entry.unit)) {
            throw new Error('Compact Aero fixture did not decode as a ready Entity');
        }
        expect(entry.unit.heat).toEqual(unit.heat);
        expect(entry.unit.turn?.controlRecovery).toEqual(unit.turn?.controlRecovery);
        expect(entry.unit.crewState?.[0]?.recoveryReadyTurn).toBe(1);
        expect(CBTNonMekUnit.restore(
            entry.unit,
            entity,
            identity,
            { id: 'megamek', ruleset: 'core-2026' },
        ).serialize()).toEqual(unit);
    });

    it('keeps V1 as the sole compatibility load format', () => {
        const force: SerializedForce = {
            version: 1,
            timestamp: '2026-09-01T12:00:00.000Z',
            instanceId: 'force:v1',
            type: GameSystem.CBT,
            name: 'Legacy force',
            groups: [],
        };

        expect(decodeForceFromStorage(JSON.parse(JSON.stringify(force)))).toEqual(force);
        const { version: _version, ...preVersionForce } = force;
        expect(decodeForceFromStorage(preVersionForce)).toEqual(force);
    });

    it('rejects non-current UUID spellings in V2 storage', () => {
        const force = damagedForce();
        const stored = structuredClone(encodeForceForStorage(force));
        const compactUnit = ((stored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        compactUnit['e'] = force.cbt.units[0]!.unit.entity;

        expect(() => decodeForceFromStorage(stored)).toThrowError(/compact UUID/u);
    });

    it('keeps pending and committed Mek crew death distinct on the compact wire', () => {
        const fixture = createDirectMekRuntimeFixture();
        const positionId = [...fixture.index.crewPositions.keys()][0]!;
        expect(fixture.instance.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 6,
            unconscious: false,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const ready = () => new CBTMekUnit(
            fixture.entity,
            fixture.identity,
            fixture.instance,
            { schemaVersion: 2, values: fixture.initialized.deployment },
        );

        const pendingStored = encodeForceForStorage(forceWithUnit(
            ready().serialize(),
            'force:pending-crew-death',
            'Pending crew death',
        ));
        const pendingUnit = ((pendingStored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect((pendingUnit['w'] as unknown[][])[0]?.slice(1)).toEqual([6]);

        expect(fixture.instance.dispatch({ type: 'end-phase' }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const committedStored = encodeForceForStorage(forceWithUnit(
            ready().serialize(),
            'force:committed-crew-death',
            'Committed crew death',
        ));
        const committedUnit = ((committedStored['cbt'] as Record<string, unknown>)['u'] as Record<string, unknown>[])[0]!;
        expect((committedUnit['w'] as unknown[][])[0]?.slice(1)).toEqual([6, { dead: true }]);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(committedStored)));
        expect((decoded.cbt!.units[0]!.unit as SerializedCBTUnitV2).crew.positions[0]?.dead).toBeTrue();
    });
});

function damagedForce(): SerializedCBTForce {
    const fixture = createDirectMekRuntimeFixture();
    const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 2)!;
    expect(fixture.instance.dispatch({
        type: 'damage-armor',


        faceId: face.id,
        amount: 2,
        target: 'committed',
    }).accepted).toBeTrue();
    const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.length > 0)!;
    expect(fixture.instance.dispatch({
        type: 'hit-critical',


        slotId: slot.id,
        hits: 1,
        target: 'committed',
    }).accepted).toBeTrue();
    expect(fixture.instance.dispatch({
        type: 'end-phase',


        endTurnBoundary: true,
    }).accepted).toBeTrue();
    const pilotId = [...fixture.index.crewPositions.keys()][0]!;
    expect(fixture.instance.dispatch({
        type: 'set-pending-fall-consequences',


        pending: {
            eventId: 'fall:compact-storage',
            totalDamage: 10,
            hitArcLabel: 'Front',
            applyPilotHits: true,
            forceSeatbeltFailure: false,
            seatbeltPositionIds: [pilotId],
            headHits: 1,
            stage: 'crew-hits',
            seatbeltFailures: [pilotId],
        },
    }).accepted).toBeTrue();
    const ready = new CBTMekUnit(
        fixture.entity,
        fixture.identity,
        fixture.instance,
        { schemaVersion: 2, values: fixture.initialized.deployment },
    );
    const unit: SerializedCBTUnitV2 = {
        ...ready.serialize(),
        sourceHashCanary: asSourceHashCanary('k8zQ'),
    };
    return forceWithUnit(unit, 'force:compact-storage', 'Compact storage', { x: 203, y: 392 });
}

function forceWithUnit(
    unit: SerializedCBTUnitV2 | SerializedNonMekUnit,
    forceIdText: string,
    name: string,
    c3Position?: Readonly<{ x: number; y: number }>,
): SerializedCBTForce {
    const forceId = asForceId(forceIdText);
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        forceId,
        forceRevision: unit.stateRevision,
        history: emptyRuntimeHistory(),
        units: [{ instanceId: unit.instanceId, stateRevision: unit.stateRevision, unit }],
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: `group:${forceIdText}`,
                order: 0,
                members: [{ instanceId: unit.instanceId, order: 0 }],
            }],
        },
        encounter: {
            networks: [],
            ...(c3Position === undefined ? {} : {
                c3Positions: [{ unitId: unit.instanceId, ...c3Position }],
            }),
        },
    };
    return {
        version: 2,
        timestamp: '2026-08-23T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name,
        cbt,
    };
}

function byteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

// Every existing round-trip fixture also exercises the codec ownership boundary,
// including rich Mek/non-Mek continuation state, crew, row order, and C3 history.
function encodeForceForStorage(force: SerializedForce) {
    const stored = encodeStorageRecord(force);
    expectDetachedObjects(force, stored);
    return stored;
}

function decodeForceFromStorage(value: unknown): SerializedForce {
    const decoded = decodeStorageRecord(value);
    expectDetachedObjects(value, decoded);
    return decoded;
}

function expectDetachedObjects(source: unknown, result: unknown): void {
    const sourceObjects = new Set<object>();
    const visit = (value: unknown, inspect: (object: object, path: string) => void, path = '$'): void => {
        if (value === null || typeof value !== 'object') return;
        inspect(value, path);
        for (const [key, child] of Object.entries(value)) visit(child, inspect, `${path}.${key}`);
    };
    visit(source, object => sourceObjects.add(object));
    const sharedPaths: string[] = [];
    visit(result, (object, path) => { if (sourceObjects.has(object)) sharedPaths.push(path); });
    expect(sharedPaths).withContext('Storage bytes must not retain caller-owned objects').toEqual([]);
}
