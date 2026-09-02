// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../crew-member.model';
import type {
    ASSerializedForce,
    ASSerializedGroup,
    ASSerializedState,
    ASSerializedUnit,
    SerializedC3NetworkGroup,
    SerializedCondition,
    SerializedForce,
} from '../force-serialization';
import { isUnitConditionKey, type UnitConditionKey } from '../unit-condition.model';
import { asUnitUuid, type UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { asSourceHashCanary } from '../source-hash-canary';
import {
    asArmorFaceId,
    asComponentId,
    asCrewPositionId,
    asLocationId,
    asSystemDamageTrackId,
} from '../entity/entity-identifiers';
import { isNativeEntityType } from '../entity/codec-capabilities';
import {
    isEquipmentStatus,
    isUnavailableEquipmentStatus,
    type EquipmentStatus,
    type UnavailableEquipmentStatus,
} from '../equipment-status.model';
import type {
    SavedAttackerTargetingState,
    SerializedCBTEncounterStateV2,
    SerializedCBTForceV2,
    SerializedCBTUnitV2,
    SerializedForceEncounterEntryV2,
    SerializedForceUnitEntryV2,
} from './persistence-v2';
import {
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    asSavedTargetRef,
} from './persistence-v2';
import {
    CBT_FORCE_ROSTER_SCHEMA_VERSION,
    type SerializedCBTForceRosterV1,
} from './cbt-force-roster';
import {
    NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
    NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION,
    isNonMekEntityType,
    isSerializedNonMekUnit,
    type SerializedNonMekUnit,
} from './non-mek-unit-persistence';
import {
    DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
    DEFAULT_FORCE_DEPLOYMENT_ID,
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
    UNIT_STATE_INITIALIZER_REVISION,
} from './unit-state-initializer';
import {
    isBombastLaserChargeState,
    isC3EmergencyMasterModeOverride,
    isC3EmergencyMasterOperatingTurns,
    isMekLocationConditionKey,
    isPpcCapacitorChargeState,
    type BombastLaserChargeState,
    type C3EmergencyMasterModeOverride,
    type C3EmergencyMasterOperatingTurns,
    type MekLocationConditionKey,
    type PpcCapacitorChargeState,
} from './runtime-state';
import {
    deserializeMekMovementPsrStateV2,
    serializeMekMovementPsrStateV2,
    type SerializedMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    deserializeMekTurnStateV2,
    serializeMekTurnStateV2,
    type SerializedMekTurnStateV2,
} from './mek-turn-state-v2';
import type { EndTurnCheckpoint } from './end-turn-checkpoint';
import {
    ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
    deserializeAttackerTargetingState,
    serializeAttackerTargetingState,
    type SerializedAttackerTargetingState,
} from './attacker-targeting-state';
import type { EquipmentRowOrderState } from './equipment-row-order';
import { isSparseMekGaussPowerState, type SparseMekGaussPowerState } from './mek-gauss-power';
import {
    asMekRuleCheckTokenV2,
    isMekRuleCheckKeyV2,
    isMekRuleCheckStatusV2,
    type MekRuleCheckKeyV2,
    type MekRuleCheckStatusV2,
} from './mek-destruction-state-v2';

/**
 * The sole current CBT storage wire. The domain snapshot deliberately keeps
 * descriptive names; IndexedDB and cloud transport do not repeat them hundreds
 * of times. Production V1 records pass through unchanged for the one-way loader.
 */
export type StoredForceRecord = Readonly<Record<string, unknown>>;

export function isCompactStoredForce(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const root = value as Record<string, unknown>;
    if (root['version'] !== 2 || root['type'] !== GameSystem.CBT) return false;
    const cbt = root['cbt'];
    if (cbt === null || typeof cbt !== 'object' || Array.isArray(cbt)) return false;
    const compact = cbt as Record<string, unknown>;
    return !('schemaVersion' in compact)
        && compact['v'] === COMPACT_FORCE_FORMAT_VERSION
        && 'r' in compact && 'u' in compact && 'g' in compact;
}

type CompactUnitUuid = string;

type CompactCrewPosition = readonly unknown[];
type CompactDeployment = readonly unknown[];

type CompactForce = Readonly<{
    v: 2;
    r: number;
    u: readonly unknown[];
    g: readonly unknown[];
    h?: SerializedCBTForceV2['history'];
    e?: unknown;
}>;

type CompactASForce = Readonly<{
    v: 1;
    g: readonly CompactASGroup[];
    n?: readonly CompactASNetwork[];
}>;

type CompactASGroup = Readonly<{
    i: string;
    n?: string;
    c?: string;
    f?: string;
    l?: 1;
    t?: string;
    u: readonly CompactASUnit[];
}>;

type CompactASUnit = Readonly<{
    i: string;
    u: string;
    h?: string;
    a?: string;
    t?: number;
    s?: number;
    b?: ASSerializedUnit['abilities'];
    f?: string[];
    c?: 1;
    x?: Readonly<Record<string, unknown>>;
}>;

type CompactASNetwork = Readonly<{
    i: string;
    y: string;
    c: string;
    p?: readonly string[];
    m?: string;
    x?: number;
    r?: readonly string[];
}>;

const MEK = 'm';
const ENTITY = 'e';
const COMPACT_FORCE_FORMAT_VERSION = 2;
const COMPACT_AS_FORMAT_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COMPACT_UUID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

export function encodeForceForStorage(force: SerializedForce): StoredForceRecord {
    const detached = clone(force);
    if (force.version === 1) return Object.freeze({ ...detached });
    if (force.version !== 2) throw new Error('Unsupported force persistence version');
    if (force.type === GameSystem.AS) {
        if (!Array.isArray(force.groups)) {
            throw new Error('Current Alpha Strike persistence requires force groups');
        }
        const {
            timestamp: _timestamp,
            groups: _groups,
            c3Networks: _networks,
            ...current
        } = detached;
        return Object.freeze({
            ...current,
            timestamp: packTimestamp(force.timestamp),
            a: packASForce(force.groups as ASSerializedGroup[], force.c3Networks),
        });
    }
    if (force.type !== GameSystem.CBT) throw new Error('Unsupported force game system');
    if (force.cbt === undefined) {
        throw new Error('Current CBT persistence requires a current CBT snapshot');
    }
    const {
        timestamp: _timestamp,
        groups: _legacyGroups,
        c3Networks: _legacyNetworks,
        ...current
    } = detached;
    return Object.freeze({
        ...current,
        timestamp: packTimestamp(force.timestamp),
        cbt: packForce(force.cbt),
    });
}

export function decodeForceFromStorage(value: unknown): SerializedForce {
    const detached = clone(value);
    const root = record(detached, 'force');
    if (root['version'] === 1) return detached as SerializedForce;
    if (root['type'] === GameSystem.AS) {
        return unpackASForce(root, record(root['a'], 'force.a'));
    }
    const compact = record(root['cbt'], 'force.cbt');
    const instanceId = text(root['instanceId'], 'force.instanceId');
    return unpackCBTForce(root, instanceId, unpackForce(compact, instanceId));
}

function packASForce(
    groups: readonly ASSerializedGroup[],
    networks: readonly SerializedC3NetworkGroup[] | undefined,
): CompactASForce {
    return Object.freeze({
        v: COMPACT_AS_FORMAT_VERSION,
        g: Object.freeze(groups.map(packASGroup)),
        ...(networks === undefined || networks.length === 0
            ? {}
            : { n: Object.freeze(networks.map(packASNetwork)) }),
    });
}

function packASGroup(group: ASSerializedGroup): CompactASGroup {
    return compactObject({
        i: packOpaqueId(group.id),
        n: group.name,
        c: group.color,
        f: group.formationId,
        l: group.formationLock ? 1 : undefined,
        t: group.formationTargetGroupId === undefined
            ? undefined
            : packOpaqueId(group.formationTargetGroupId),
        u: Object.freeze(group.units.map(packASUnit)),
    }) as CompactASGroup;
}

function packASUnit(unit: ASSerializedUnit): CompactASUnit {
    return compactObject({
        i: packOpaqueId(unit.id),
        u: packUuid(unit.uuid),
        h: unit.sourceHashCanary,
        a: unit.alias,
        t: unit.updatedTs,
        s: unit.skill,
        b: unit.abilities === undefined ? undefined : clone(unit.abilities),
        f: unit.formationAbilities === undefined ? undefined : [...unit.formationAbilities],
        c: unit.commander ? 1 : undefined,
        x: packASState(unit.state),
    }) as CompactASUnit;
}

function packASState(state: ASSerializedState | undefined): Readonly<Record<string, unknown>> | undefined {
    if (state === undefined) return undefined;
    const packed = compactObject({
        m: state.modified ? 1 : undefined,
        d: state.destroyed ? 1 : undefined,
        c: state.conditions === undefined ? undefined : state.conditions.map(packASCondition),
        p: state.c3Position === undefined ? undefined : [state.c3Position.x, state.c3Position.y],
        h: state.heat,
        a: state.armor,
        i: state.internal,
        r: state.crits,
        q: state.pCrits,
        u: state.consumed,
        e: state.exhausted,
    });
    return Object.keys(packed).length === 0 ? undefined : packed;
}

function packASCondition(condition: SerializedCondition): unknown {
    if (typeof condition === 'string') return condition;
    return tuple(
        condition.key,
        condition.value === undefined && condition.pending ? null : condition.value,
        condition.pending ? 1 : undefined,
    );
}

function packASNetwork(network: SerializedC3NetworkGroup): CompactASNetwork {
    return compactObject({
        i: packOpaqueId(network.id),
        y: network.type,
        c: network.color,
        p: network.peerIds?.map(packOpaqueId),
        m: network.masterId === undefined ? undefined : packOpaqueId(network.masterId),
        x: network.masterCompIndex,
        r: network.members?.map(packNetworkMember),
    }) as CompactASNetwork;
}

function unpackASForce(root: Record<string, unknown>, compact: Record<string, unknown>): ASSerializedForce {
    exactKeys(root, [
        'version', 'timestamp', 'instanceId', 'type', 'name', 'note', 'tags',
        'factionId', 'factionLock', 'eraId', 'eraLock', 'bv', 'pv', 'owned', 'a',
    ], 'force');
    if (root['version'] !== 2 || root['type'] !== GameSystem.AS) {
        throw new Error('Force does not match the current Alpha Strike schema');
    }
    exactKeys(compact, ['v', 'g', 'n'], 'force.a');
    if (compact['v'] !== COMPACT_AS_FORMAT_VERSION) {
        throw new Error('Unsupported compact Alpha Strike persistence format');
    }
    const groups = array(compact['g'], 'force.a.g').map((value, index) =>
        unpackASGroup(value, `force.a.g[${index}]`));
    const networks = compact['n'] === undefined
        ? undefined
        : array(compact['n'], 'force.a.n').map((value, index) =>
            unpackASNetwork(value, `force.a.n[${index}]`));
    return {
        version: 2,
        timestamp: unpackTimestamp(root['timestamp'], 'force.timestamp'),
        instanceId: text(root['instanceId'], 'force.instanceId'),
        type: GameSystem.AS,
        name: text(root['name'], 'force.name'),
        ...(root['note'] === undefined ? {} : { note: text(root['note'], 'force.note') }),
        ...(root['tags'] === undefined ? {} : { tags: unpackTextArray(root['tags'], 'force.tags') }),
        ...(root['factionId'] === undefined ? {} : {
            factionId: integer(root['factionId'], 'force.factionId'),
        }),
        ...(root['factionLock'] === undefined ? {} : {
            factionLock: booleanValue(root['factionLock'], 'force.factionLock'),
        }),
        ...(root['eraId'] === undefined ? {} : { eraId: integer(root['eraId'], 'force.eraId') }),
        ...(root['eraLock'] === undefined ? {} : {
            eraLock: booleanValue(root['eraLock'], 'force.eraLock'),
        }),
        ...(root['bv'] === undefined ? {} : { bv: finiteNumber(root['bv'], 'force.bv') }),
        ...(root['pv'] === undefined ? {} : { pv: finiteNumber(root['pv'], 'force.pv') }),
        ...(root['owned'] === undefined ? {} : { owned: booleanValue(root['owned'], 'force.owned') }),
        groups,
        ...(networks === undefined ? {} : { c3Networks: networks }),
    };
}

function unpackASGroup(value: unknown, path: string): ASSerializedGroup {
    const group = record(value, path);
    exactKeys(group, ['i', 'n', 'c', 'f', 'l', 't', 'u'], path);
    return {
        id: unpackOpaqueId(text(group['i'], `${path}.i`), `${path}.i`),
        ...(group['n'] === undefined ? {} : { name: text(group['n'], `${path}.n`) }),
        ...(group['c'] === undefined ? {} : { color: text(group['c'], `${path}.c`) }),
        ...(group['f'] === undefined ? {} : { formationId: text(group['f'], `${path}.f`) }),
        ...(group['l'] === undefined ? {} : { formationLock: truthyOne(group['l'], `${path}.l`) }),
        ...(group['t'] === undefined ? {} : {
            formationTargetGroupId: unpackOpaqueId(text(group['t'], `${path}.t`), `${path}.t`),
        }),
        units: array(group['u'], `${path}.u`).map((unit, index) =>
            unpackASUnit(unit, `${path}.u[${index}]`)),
    };
}

function unpackASUnit(value: unknown, path: string): ASSerializedUnit {
    const unit = record(value, path);
    exactKeys(unit, ['i', 'u', 'h', 'a', 't', 's', 'b', 'f', 'c', 'x'], path);
    return {
        id: unpackOpaqueId(text(unit['i'], `${path}.i`), `${path}.i`),
        uuid: unpackUuid(text(unit['u'], `${path}.u`), `${path}.u`),
        ...(unit['h'] === undefined ? {} : {
            sourceHashCanary: unpackSourceHashCanary(unit['h'], `${path}.h`),
        }),
        ...(unit['a'] === undefined ? {} : { alias: text(unit['a'], `${path}.a`) }),
        ...(unit['t'] === undefined ? {} : { updatedTs: finiteNumber(unit['t'], `${path}.t`) }),
        ...(unit['s'] === undefined ? {} : { skill: finiteNumber(unit['s'], `${path}.s`) }),
        ...(unit['b'] === undefined ? {} : {
            abilities: clone(array(unit['b'], `${path}.b`)) as ASSerializedUnit['abilities'],
        }),
        ...(unit['f'] === undefined ? {} : {
            formationAbilities: unpackTextArray(unit['f'], `${path}.f`),
        }),
        ...(unit['c'] === undefined ? {} : { commander: truthyOne(unit['c'], `${path}.c`) }),
        ...(unit['x'] === undefined ? {} : { state: unpackASState(unit['x'], `${path}.x`) }),
    };
}

function unpackASState(value: unknown, path: string): ASSerializedState {
    const state = record(value, path);
    exactKeys(state, ['m', 'd', 'c', 'p', 'h', 'a', 'i', 'r', 'q', 'u', 'e'], path);
    return {
        ...(state['m'] === undefined ? {} : { modified: truthyOne(state['m'], `${path}.m`) }),
        ...(state['d'] === undefined ? {} : { destroyed: truthyOne(state['d'], `${path}.d`) }),
        ...(state['c'] === undefined ? {} : {
            conditions: array(state['c'], `${path}.c`).map((condition, index) =>
                unpackASCondition(condition, `${path}.c[${index}]`)),
        }),
        ...(state['p'] === undefined ? {} : {
            c3Position: unpackASPosition(state['p'], `${path}.p`),
        }),
        ...(state['h'] === undefined ? {} : { heat: unpackASPair(state['h'], `${path}.h`) }),
        ...(state['a'] === undefined ? {} : { armor: unpackASPair(state['a'], `${path}.a`) }),
        ...(state['i'] === undefined ? {} : { internal: unpackASPair(state['i'], `${path}.i`) }),
        ...(state['r'] === undefined ? {} : { crits: unpackASCriticalRows(state['r'], `${path}.r`) }),
        ...(state['q'] === undefined ? {} : { pCrits: unpackASCriticalRows(state['q'], `${path}.q`) }),
        ...(state['u'] === undefined ? {} : { consumed: unpackASConsumed(state['u'], `${path}.u`) }),
        ...(state['e'] === undefined ? {} : { exhausted: unpackASExhausted(state['e'], `${path}.e`) }),
    };
}

function unpackASCondition(value: unknown, path: string): SerializedCondition {
    if (typeof value === 'string') {
        if (!isUnitConditionKey(value)) throw new Error(`${path} is not a unit condition`);
        return value;
    }
    const row = array(value, path);
    if (row.length < 1 || row.length > 3) throw new Error(`${path} is not a compact condition`);
    const key = text(row[0], `${path}[0]`);
    if (!isUnitConditionKey(key)) throw new Error(`${path}[0] is not a unit condition`);
    const counted = row[1] === undefined || row[1] === null
        ? undefined
        : finiteNumber(row[1], `${path}[1]`);
    return {
        key,
        ...(counted === undefined ? {} : { value: counted }),
        ...(row[2] === undefined ? {} : { pending: truthyOne(row[2], `${path}[2]`) }),
    };
}

function unpackASPosition(value: unknown, path: string): { x: number; y: number } {
    const row = array(value, path);
    if (row.length !== 2) throw new Error(`${path} is not an Alpha Strike position`);
    return { x: finiteNumber(row[0], `${path}[0]`), y: finiteNumber(row[1], `${path}[1]`) };
}

function unpackASPair(value: unknown, path: string): [number, number] {
    const row = array(value, path);
    if (row.length !== 2) throw new Error(`${path} is not an Alpha Strike value pair`);
    return [finiteNumber(row[0], `${path}[0]`), finiteNumber(row[1], `${path}[1]`)];
}

function unpackASCriticalRows(value: unknown, path: string): [string, number][] {
    return array(value, path).map((entry, index) => {
        const rowPath = `${path}[${index}]`;
        const row = array(entry, rowPath);
        if (row.length !== 2) throw new Error(`${rowPath} is not an Alpha Strike critical row`);
        return [text(row[0], `${rowPath}[0]`), finiteNumber(row[1], `${rowPath}[1]`)];
    });
}

function unpackASConsumed(value: unknown, path: string): Record<string, [number, number]> {
    const source = record(value, path);
    return Object.fromEntries(Object.entries(source).map(([key, pair]) => [
        key,
        unpackASPair(pair, `${path}.${key}`),
    ]));
}

function unpackASExhausted(value: unknown, path: string): [string[], string[], string[]] {
    const row = array(value, path);
    if (row.length !== 3) throw new Error(`${path} is not an Alpha Strike exhausted-ability row`);
    return [
        unpackTextArray(row[0], `${path}[0]`),
        unpackTextArray(row[1], `${path}[1]`),
        unpackTextArray(row[2], `${path}[2]`),
    ];
}

function unpackASNetwork(value: unknown, path: string): SerializedC3NetworkGroup {
    const network = record(value, path);
    exactKeys(network, ['i', 'y', 'c', 'p', 'm', 'x', 'r'], path);
    return {
        id: unpackOpaqueId(text(network['i'], `${path}.i`), `${path}.i`),
        type: text(network['y'], `${path}.y`) as SerializedC3NetworkGroup['type'],
        color: text(network['c'], `${path}.c`),
        ...(network['p'] === undefined ? {} : {
            peerIds: unpackTextArray(network['p'], `${path}.p`).map((id, index) =>
                unpackOpaqueId(id, `${path}.p[${index}]`)),
        }),
        ...(network['m'] === undefined ? {} : {
            masterId: unpackOpaqueId(text(network['m'], `${path}.m`), `${path}.m`),
        }),
        ...(network['x'] === undefined ? {} : {
            masterCompIndex: integer(network['x'], `${path}.x`),
        }),
        ...(network['r'] === undefined ? {} : {
            members: unpackTextArray(network['r'], `${path}.r`).map((member, index) =>
                unpackNetworkMember(member, `${path}.r[${index}]`)),
        }),
    };
}

function packTimestamp(value: string): number {
    const parsed = Date.parse(value);
    if (!Number.isSafeInteger(parsed)) throw new Error('Force timestamp is invalid');
    return parsed;
}

function unpackTimestamp(value: unknown, path: string): string {
    const parsed = integer(value, path);
    const date = new Date(parsed);
    if (!Number.isFinite(date.getTime())) throw new Error(`${path} is not a valid timestamp`);
    return date.toISOString();
}

function packUuid(value: string): string {
    if (!UUID_PATTERN.test(value)) throw new Error('Unit UUID is invalid');
    const hex = value.replaceAll('-', '').toLowerCase();
    let bytes = '';
    for (let index = 0; index < hex.length; index += 2) {
        bytes += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    return btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function unpackUuid(value: string, path: string) {
    if (!COMPACT_UUID_PATTERN.test(value)) throw new Error(`${path} is not a compact UUID`);
    let bytes: string;
    try {
        bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==');
    } catch {
        throw new Error(`${path} is not a compact UUID`);
    }
    if (bytes.length !== 16) throw new Error(`${path} is not a compact UUID`);
    const hex = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return asUnitUuid([
        hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
        hex.slice(16, 20), hex.slice(20),
    ].join('-'));
}

function packOpaqueId(value: string): string {
    if (UUID_PATTERN.test(value)) return `~${packUuid(value)}`;
    return value.startsWith('~') ? `~${value}` : value;
}

function unpackOpaqueId(value: string, path: string): string {
    if (!value.startsWith('~')) return value;
    if (value.startsWith('~~')) return value.slice(1);
    return COMPACT_UUID_PATTERN.test(value.slice(1))
        ? unpackUuid(value.slice(1), path)
        : value;
}

function packNetworkMember(value: string): string {
    const matched = value.match(/^([0-9a-f-]{36}):(\d+)$/iu);
    return matched && UUID_PATTERN.test(matched[1]!)
        ? `${packOpaqueId(matched[1]!)}:${matched[2]}`
        : packOpaqueId(value);
}

function unpackNetworkMember(value: string, path: string): string {
    const matched = value.match(/^(~[A-Za-z0-9_-]{22}):(\d+)$/u);
    return matched
        ? `${unpackOpaqueId(matched[1]!, path)}:${matched[2]}`
        : unpackOpaqueId(value, path);
}

function unpackCBTForce(
    root: Record<string, unknown>,
    instanceId: string,
    cbt: SerializedCBTForceV2,
): SerializedForce {
    exactKeys(root, [
        'version', 'timestamp', 'instanceId', 'type', 'name', 'note', 'tags',
        'factionId', 'factionLock', 'eraId', 'eraLock', 'bv', 'pv', 'owned', 'cbt',
    ], 'force');
    if (root['version'] !== 2 || root['type'] !== GameSystem.CBT) {
        throw new Error('Force does not match the current CBT schema');
    }
    return {
        version: 2,
        timestamp: unpackTimestamp(root['timestamp'], 'force.timestamp'),
        instanceId,
        type: GameSystem.CBT,
        name: text(root['name'], 'force.name'),
        ...(root['note'] === undefined ? {} : { note: text(root['note'], 'force.note') }),
        ...(root['tags'] === undefined ? {} : { tags: unpackTextArray(root['tags'], 'force.tags') }),
        ...(root['factionId'] === undefined ? {} : {
            factionId: integer(root['factionId'], 'force.factionId'),
        }),
        ...(root['factionLock'] === undefined ? {} : {
            factionLock: booleanValue(root['factionLock'], 'force.factionLock'),
        }),
        ...(root['eraId'] === undefined ? {} : { eraId: integer(root['eraId'], 'force.eraId') }),
        ...(root['eraLock'] === undefined ? {} : {
            eraLock: booleanValue(root['eraLock'], 'force.eraLock'),
        }),
        ...(root['bv'] === undefined ? {} : { bv: finiteNumber(root['bv'], 'force.bv') }),
        ...(root['pv'] === undefined ? {} : { pv: finiteNumber(root['pv'], 'force.pv') }),
        ...(root['owned'] === undefined ? {} : { owned: booleanValue(root['owned'], 'force.owned') }),
        cbt,
    };
}

function packForce(force: SerializedCBTForceV2): CompactForce {
    const historyEmpty = force.history.u.length === 0 && force.history.t.length === 0;
    const encounterEmpty = force.encounter.encounterRevision === 0
        && force.encounter.state.facts.length === 0;
    return Object.freeze({
        v: COMPACT_FORCE_FORMAT_VERSION,
        r: force.forceRevision,
        u: Object.freeze(force.units.map(packUnitEntry)),
        g: packRoster(force.roster, force.units),
        ...(historyEmpty ? {} : { h: packHistory(force.history) }),
        ...(encounterEmpty ? {} : { e: packEncounter(force.encounter) }),
    });
}

function unpackForce(value: Record<string, unknown>, forceId: string): SerializedCBTForceV2 {
    exactKeys(value, ['v', 'r', 'u', 'g', 'h', 'e'], 'force.cbt');
    if (value['v'] !== COMPACT_FORCE_FORMAT_VERSION) {
        throw new Error('Unsupported compact CBT persistence format');
    }
    const revision = integer(value['r'], 'force.cbt.r');
    const units = array(value['u'], 'force.cbt.u').map((entry, index) =>
        unpackUnitEntry(entry, `force.cbt.u[${index}]`));
    return {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        forceId: asForceId(forceId),
        forceRevision: revision,
        history: value['h'] === undefined
            ? { u: [], t: [] }
            : unpackHistory(value['h'], 'force.cbt.h'),
        units,
        roster: unpackRoster(value['g'], units),
        encounter: value['e'] === undefined
            ? emptyEncounter()
            : unpackEncounter(value['e'], 'force.cbt.e'),
    };
}

function packHistory(history: SerializedCBTForceV2['history']): SerializedCBTForceV2['history'] {
    return Object.freeze({
        u: Object.freeze(history.u.map(packOpaqueId)),
        t: clone(history.t),
    });
}

function unpackHistory(value: unknown, path: string): SerializedCBTForceV2['history'] {
    const history = record(value, path);
    exactKeys(history, ['u', 't'], path);
    return {
        u: array(history['u'], `${path}.u`).map((raw, index) =>
            unpackOpaqueId(text(raw, `${path}.u[${index}]`), `${path}.u[${index}]`)),
        t: clone(array(history['t'], `${path}.t`)) as SerializedCBTForceV2['history']['t'],
    };
}

function packUnitEntry(entry: SerializedForceUnitEntryV2): unknown {
    return packUnit(entry.unit);
}

function unpackUnitEntry(value: unknown, path: string): SerializedForceUnitEntryV2 {
    const unit = unpackUnit(value, path);
    return {
        instanceId: unit.instanceId,
        stateRevision: unit.stateRevision,
        unit,
    };
}

function packUnit(unit: SerializedCBTUnitV2 | SerializedNonMekUnit): unknown {
    return isSerializedNonMekUnit(unit) ? packNonMekUnit(unit) : packMekUnit(unit);
}

function unpackUnit(value: unknown, path: string): SerializedCBTUnitV2 | SerializedNonMekUnit {
    const compact = record(value, path);
    return compact['k'] === undefined || compact['k'] === MEK
        ? unpackMekUnit(compact, path)
        : compact['k'] === ENTITY
            ? unpackNonMekUnit(compact, path)
            : fail(`${path}.k is not a current unit family`);
}

function packMekUnit(unit: SerializedCBTUnitV2): unknown {
    const pristineHeat = unit.deployment.values.initialHeat ?? 0;
    const heatIsPristine = unit.heat?.heat === pristineHeat
        && unit.heat.previous === undefined
        && unit.heat.pendingOverride === undefined
        && unit.heat.heatsinksOff === undefined;
    return compactObject({
        i: packOpaqueId(unit.instanceId),
        e: packUnitUuid(unit.entity),
        h: unit.sourceHashCanary,
        d: packDeployment(unit.deployment.values),
        r: unit.stateRevision === 0 ? undefined : unit.stateRevision,
        x: unit.destroyed ? 1 : undefined,
        l: packRows(unit.locationState, row => [row.target, row.damage]),
        n: packRows(unit.locationConditions, row => [row.target, row.condition, row.value]),
        s: packRows(unit.slotState, row => tuple(row.target, row.hits, row.destroyedTurn)),
        c: packRows(unit.componentState, packComponentState),
        a: packRows(unit.ammoState, row => tuple(row.target, row.shotsSpent, row.munitionOverride)),
        w: packRows(unit.crew.positions, row => tuple(
            row.target,
            row.wounds,
            packCrewState(row),
            row.recoveryReadyTurn,
        )),
        z: heatIsPristine ? undefined : packHeat(unit.heat),
        rC: unit.ruleChecks.entries.length === 0 ? undefined : unit.ruleChecks.entries.map(row => [
            row.key, row.token, row.trigger, row.openedRevision, row.status,
        ]),
        m: packMovement(unit.movementPsr),
        tA: packTargeting(unit.attackerTargeting),
        y: packEquipmentRowOrder(unit.equipmentRowOrder),
        o: unit.conditions?.values.length ? unit.conditions.values : undefined,
        t: packTurn(unit.turn),
        p: packPending(unit.pendingCombat),
    });
}

function unpackMekUnit(value: Record<string, unknown>, path: string): SerializedCBTUnitV2 {
    exactKeys(value, [
        'k', 'i', 'e', 'd', 'r', 'x', 'l', 'n', 's', 'c', 'a', 'w',
        'h', 'z', 'rC', 'm', 'tA', 'y', 'o', 't', 'p',
    ], path);
    const entity = unpackUnitUuid(value['e'], `${path}.e`);
    const baseline = defaultBaseline(
        entity, UNIT_STATE_INITIALIZER_REVISION, DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    );
    const deployment = unpackDeployment(value['d'], `${path}.d`);
    const pristineHeat = deployment.values.initialHeat ?? 0;
    return {
        schemaVersion: CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: unpackOpaqueId(text(value['i'], `${path}.i`), `${path}.i`),
        entity,
        ...(value['h'] === undefined ? {} : {
            sourceHashCanary: unpackSourceHashCanary(value['h'], `${path}.h`),
        }),
        baselineRefAtSave: baseline,
        // BaseEntity topology is rebuilt after the exact native source is loaded.
        // The storage wire never carries a copied blueprint reference catalog.
        blueprintReferences: { schemaVersion: 1, targets: {} },
        deployment,
        stateRevision: value['r'] === undefined ? 0 : integer(value['r'], `${path}.r`),
        ...(value['x'] === undefined ? {} : { destroyed: truthyOne(value['x'], `${path}.x`) }),
        ...(value['l'] === undefined ? {} : {
            locationState: unpackRows(value['l'], `${path}.l`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
            })),
        }),
        ...(value['n'] === undefined ? {} : {
            locationConditions: unpackRows(value['n'], `${path}.n`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                condition: unpackMekLocationCondition(row[1], `${rowPath}[1]`),
                value: rowInteger(row, 2, rowPath),
            })),
        }),
        ...(value['s'] === undefined ? {} : {
            slotState: unpackRows(value['s'], `${path}.s`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                hits: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { destroyedTurn: rowInteger(row, 2, rowPath) }),
            })),
        }),
        ...(value['c'] === undefined ? {} : {
            componentState: unpackRows(value['c'], `${path}.c`, unpackComponentState),
        }),
        ...(value['a'] === undefined ? {} : {
            ammoState: unpackRows(value['a'], `${path}.a`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                shotsSpent: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { munitionOverride: rowText(row, 2, rowPath) }),
            })),
        }),
        crew: {
            schemaVersion: 1,
            positions: value['w'] === undefined ? [] : unpackRows(value['w'], `${path}.w`, (row, rowPath) => {
                const state = unpackCrewState(row[2], `${rowPath}[2]`);
                return {
                    target: asSavedTargetRef(rowText(row, 0, rowPath)),
                    wounds: rowInteger(row, 1, rowPath),
                    unconscious: state.unconscious,
                    ...(state.ejected ? { ejected: true as const } : {}),
                    ...(state.dead ? { dead: true as const } : {}),
                    ...(row[3] === undefined
                        ? {}
                        : {
                            recoveryReadyTurn: row[3] === null
                                ? null
                                : rowInteger(row, 3, rowPath),
                        }),
                };
            }),
        },
        heat: value['z'] === undefined
            ? { heat: pristineHeat }
            : unpackHeat(value['z'], `${path}.z`),
        family: { kind: 'mek' },
        ruleChecks: {
            schemaVersion: 1,
            entries: value['rC'] === undefined ? [] : unpackRows(value['rC'], `${path}.rC`, (row, rowPath) => ({
                key: unpackMekRuleCheckKey(row[0], `${rowPath}[0]`),
                token: asMekRuleCheckTokenV2(rowText(row, 1, rowPath)),
                trigger: asSavedTargetRef(rowText(row, 2, rowPath)),
                openedRevision: rowInteger(row, 3, rowPath),
                status: unpackMekRuleCheckStatus(row[4], `${rowPath}[4]`),
            })),
        },
        movementPsr: unpackMovement(value['m'], `${path}.m`),
        attackerTargeting: unpackSavedTargeting(value['tA'], `${path}.tA`),
        ...(value['y'] === undefined ? {} : {
            equipmentRowOrder: unpackEquipmentRowOrder(value['y'], `${path}.y`),
        }),
        ...(value['o'] === undefined ? {} : {
            conditions: { values: unpackUnitConditions(value['o'], `${path}.o`) },
        }),
        turn: unpackTurn(value['t'], `${path}.t`),
        ...(value['p'] === undefined ? {} : { pendingCombat: unpackPending(value['p'], `${path}.p`) }),
    };
}

function packNonMekUnit(unit: SerializedNonMekUnit): unknown {
    return compactObject({
        k: ENTITY,
        t: unit.family.entityType,
        i: packOpaqueId(unit.instanceId),
        e: packUnitUuid(unit.entity),
        h: unit.sourceHashCanary,
        d: packDeployment(unit.deployment.values),
        r: unit.stateRevision === 0 ? undefined : unit.stateRevision,
        x: unit.destroyed ? 1 : undefined,
        l: packRows(unit.locationState, row => tuple(
            row.locationId,
            row.internalDamage ?? 0,
            row.armorDamage?.map(armor => [armor.faceId, armor.damage]),
        )),
        c: packRows(unit.componentState, row => [row.componentId, compactObject({
            s: row.status,
            m: row.mode,
            j: row.jammed ? 1 : undefined,
            e: row.escalatingFailure
                && [row.escalatingFailure.sequence, row.escalatingFailure.active ? 1 : 0],
        })]),
        q: packRows(unit.damageTrackState, row => [row.damageTrackId, row.hits, row.hitTimestamps]),
        a: packRows(unit.ammoState, row => tuple(row.componentId, row.shotsSpent, row.munitionOverride)),
        w: packRows(unit.crewState, row => tuple(
            row.positionId,
            row.wounds,
            packCrewState(row),
            row.recoveryReadyTurn,
        )),
        o: unit.conditions?.length ? unit.conditions : undefined,
        z: packNonMekHeat(unit.heat),
        v: packNonMekTurn(unit.turn),
        tA: packDirectTargeting(unit.attackerTargeting),
        y: packEquipmentRowOrder(unit.equipmentRowOrder),
        p: packNonMekPending(unit.pendingCombat),
    });
}

function unpackNonMekUnit(value: Record<string, unknown>, path: string): SerializedNonMekUnit {
    exactKeys(value, ['k', 't', 'i', 'e', 'h', 'd', 'r', 'x', 'l', 'c', 'q', 'a', 'w', 'o', 'z', 'v', 'tA', 'y', 'p'], path);
    const entity = unpackUnitUuid(value['e'], `${path}.e`);
    const baseline = defaultBaseline(entity, 1, DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID);
    const deployment = unpackNonMekDeployment(value['d'], `${path}.d`);
    return {
        schemaVersion: NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: unpackOpaqueId(text(value['i'], `${path}.i`), `${path}.i`),
        entity,
        ...(value['h'] === undefined ? {} : {
            sourceHashCanary: unpackSourceHashCanary(value['h'], `${path}.h`),
        }),
        baselineRefAtSave: baseline,
        deployment,
        family: { kind: 'non-mek', entityType: unpackNonMekEntityType(value['t'], `${path}.t`) },
        stateRevision: value['r'] === undefined ? 0 : integer(value['r'], `${path}.r`),
        ...(value['x'] === undefined ? {} : { destroyed: truthyOne(value['x'], `${path}.x`) }),
        ...(value['l'] === undefined ? {} : {
            locationState: unpackRows(value['l'], `${path}.l`, (row, rowPath) => ({
                locationId: asLocationId(rowText(row, 0, rowPath)),
                ...(rowInteger(row, 1, rowPath) === 0 ? {} : { internalDamage: rowInteger(row, 1, rowPath) }),
                ...(row[2] === undefined ? {} : {
                    armorDamage: unpackRows(row[2], `${rowPath}[2]`, (armor, armorPath) => ({
                        faceId: asArmorFaceId(rowText(armor, 0, armorPath)),
                        damage: rowInteger(armor, 1, armorPath),
                    })),
                }),
            })),
        }),
        ...(value['c'] === undefined ? {} : {
            componentState: unpackRows(value['c'], `${path}.c`, (row, rowPath) => {
                const state = record(row[1], `${rowPath}[1]`);
                exactKeys(state, ['s', 'm', 'j', 'e'], `${rowPath}[1]`);
                const escalating = state['e'] === undefined
                    ? undefined
                    : array(state['e'], `${rowPath}[1].e`);
                return {
                    componentId: asComponentId(rowText(row, 0, rowPath)),
                    ...(state['s'] === undefined ? {} : {
                        status: unpackUnavailableEquipmentStatus(state['s'], `${rowPath}[1].s`),
                    }),
                    ...(state['m'] === undefined ? {} : { mode: text(state['m'], `${rowPath}[1].m`) }),
                    ...(state['j'] === undefined ? {} : { jammed: truthyOne(state['j'], `${rowPath}[1].j`) }),
                    ...(escalating === undefined ? {} : {
                        escalatingFailure: {
                            sequence: rowInteger(
                                escalating,
                                0,
                                `${rowPath}[1].e`,
                            ),
                            ...(rowBit(escalating, 1, `${rowPath}[1].e`)
                                ? { active: true as const }
                                : {}),
                        },
                    }),
                };
            }),
        }),
        ...(value['q'] === undefined ? {} : {
            damageTrackState: unpackRows(value['q'], `${path}.q`, (row, rowPath) => ({
                damageTrackId: asSystemDamageTrackId(rowText(row, 0, rowPath)),
                hits: rowInteger(row, 1, rowPath),
                hitTimestamps: unpackIntegerArray(row[2], `${rowPath}[2]`),
            })),
        }),
        ...(value['a'] === undefined ? {} : {
            ammoState: unpackRows(value['a'], `${path}.a`, (row, rowPath) => ({
                componentId: asComponentId(rowText(row, 0, rowPath)),
                shotsSpent: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { munitionOverride: rowText(row, 2, rowPath) }),
            })),
        }),
        ...(value['w'] === undefined ? {} : {
            crewState: unpackRows(value['w'], `${path}.w`, unpackNonMekCrewState),
        }),
        ...(value['o'] === undefined ? {} : {
            conditions: unpackUnitConditions(value['o'], `${path}.o`),
        }),
        ...(value['z'] === undefined ? {} : { heat: unpackNonMekHeat(value['z'], `${path}.z`) }),
        ...(value['v'] === undefined ? {} : { turn: unpackNonMekTurn(value['v'], `${path}.v`) }),
        attackerTargeting: unpackDirectTargeting(value['tA'], `${path}.tA`),
        ...(value['y'] === undefined ? {} : {
            equipmentRowOrder: unpackEquipmentRowOrder(value['y'], `${path}.y`),
        }),
        ...(value['p'] === undefined ? {} : { pendingCombat: unpackNonMekPending(value['p'], `${path}.p`) }),
    };
}

function packEquipmentRowOrder(value: EquipmentRowOrderState | undefined): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        r: value.ranged,
        p: value.physical,
    });
}

function unpackEquipmentRowOrder(value: unknown, path: string): EquipmentRowOrderState {
    const order = record(value, path);
    exactKeys(order, ['r', 'p'], path);
    const read = (key: 'r' | 'p'): readonly number[] | undefined => order[key] === undefined
        ? undefined
        : Object.freeze(array(order[key], `${path}.${key}`).map((entry, index) =>
            integer(entry, `${path}.${key}[${index}]`)));
    const ranged = read('r');
    const physical = read('p');
    return Object.freeze({
        ...(ranged === undefined ? {} : { ranged }),
        ...(physical === undefined ? {} : { physical }),
    });
}

function packNonMekTurn(value: SerializedNonMekUnit['turn']): unknown {
    if (value === undefined) return undefined;
    const movement = value.movement === undefined
        ? undefined
        : tuple(
            value.movement.mode,
            value.movement.distance,
            value.movement.boosterComponentIds.length
                ? value.movement.boosterComponentIds
                : undefined,
        );
    const airborne = value.airborne === undefined ? 0 : value.airborne ? 1 : -1;
    return tuple(
        value.turnCounter ?? 0,
        movement === undefined && airborne === 0 ? undefined : airborne,
        movement,
        value.weaponsHeat ?? (value.cover !== undefined || value.spotting ? 0 : undefined),
        value.cover,
        value.spotting ? 1 : undefined,
        packEndTurnCheckpoint(value.endTurnCheckpoint),
        value.controlRecovery === undefined
            ? undefined
            : [
                value.controlRecovery.readyTurn,
                value.controlRecovery.cause === 'controller-loss' ? 1 : 0,
            ],
        value.phaseStateChanged ? 1 : undefined,
    );
}

function unpackNonMekTurn(value: unknown, path: string): NonNullable<SerializedNonMekUnit['turn']> {
    const turn = array(value, path);
    if (turn.length < 1 || turn.length > 9) throw new Error(`${path} is not a compact non-Mek turn`);
    const turnCounter = rowInteger(turn, 0, path);
    const airborneCode = optionalInteger(turn[1], `${path}[1]`) ?? 0;
    if (airborneCode !== -1 && airborneCode !== 0 && airborneCode !== 1) {
        throw new Error(`${path}[1] is not a non-Mek airborne state`);
    }
    const movement = turn[2] === undefined || turn[2] === null
        ? undefined
        : unpackNonMekMovement(turn[2], `${path}[2]`);
    const weaponsHeat = optionalInteger(turn[3], `${path}[3]`) ?? 0;
    return {
        ...(turnCounter === 0 ? {} : { turnCounter }),
        ...(airborneCode === 0 ? {} : { airborne: airborneCode === 1 }),
        ...(movement === undefined ? {} : { movement }),
        ...(weaponsHeat === 0 ? {} : { weaponsHeat }),
        ...(turn[4] === undefined || turn[4] === null ? {} : {
            cover: rowInteger(turn, 4, path) as NonNullable<SerializedNonMekUnit['turn']>['cover'],
        }),
        ...(turn[5] === undefined || turn[5] === null ? {} : {
            spotting: truthyOne(turn[5], `${path}[5]`),
        }),
        ...(turn[6] === undefined || turn[6] === null ? {} : {
            endTurnCheckpoint: unpackEndTurnCheckpoint(turn[6], `${path}[6]`),
        }),
        ...(turn[7] === undefined || turn[7] === null ? {} : {
            controlRecovery: unpackNonMekControlRecovery(turn[7], `${path}[7]`),
        }),
        ...(turn[8] === undefined || turn[8] === null ? {} : {
            phaseStateChanged: truthyOne(turn[8], `${path}[8]`),
        }),
    };
}

function unpackNonMekControlRecovery(
    value: unknown,
    path: string,
): NonNullable<NonNullable<SerializedNonMekUnit['turn']>['controlRecovery']> {
    const recovery = array(value, path);
    if (recovery.length !== 2) throw new Error(`${path} is not a compact Control recovery`);
    const cause = rowInteger(recovery, 1, path);
    if (cause !== 0 && cause !== 1) throw new Error(`${path}[1] is not a Control recovery cause`);
    return {
        readyTurn: rowInteger(recovery, 0, path),
        cause: cause === 0 ? 'heat-random-movement' : 'controller-loss',
    };
}

function unpackNonMekMovement(
    value: unknown,
    path: string,
): NonNullable<NonNullable<SerializedNonMekUnit['turn']>['movement']> {
    const movement = array(value, path);
    if (movement.length < 2 || movement.length > 3) {
        throw new Error(`${path} is not a compact non-Mek movement`);
    }
    const mode = rowText(movement, 0, path);
    if (mode !== 'stationary' && mode !== 'walk' && mode !== 'run'
        && mode !== 'jump' && mode !== 'UMU' && mode !== 'VTOL') {
        throw new Error(`${path}[0] is not a non-Mek movement mode`);
    }
    const boosterComponentIds = movement[2] === undefined
        ? []
        : array(movement[2], `${path}[2]`).map((id, index) =>
            asComponentId(text(id, `${path}[2][${index}]`)));
    return {
        mode,
        distance: rowInteger(movement, 1, path),
        boosterComponentIds,
    };
}

type CompactCrewState = Readonly<{
    unconscious?: true;
    ejected?: true;
    dead?: true;
}>;

interface DecodedCrewState {
    readonly unconscious: boolean;
    readonly ejected: boolean;
    readonly dead: boolean;
}

function packCrewState(
    row: Readonly<{
        readonly unconscious: boolean;
        readonly ejected?: boolean;
        readonly dead?: true;
    }>,
): CompactCrewState | undefined {
    if (!row.unconscious && !row.ejected && !row.dead) return undefined;
    return Object.freeze({
        ...(row.unconscious ? { unconscious: true as const } : {}),
        ...(row.ejected ? { ejected: true as const } : {}),
        ...(row.dead ? { dead: true as const } : {}),
    });
}

function unpackCrewState(value: unknown, path: string): DecodedCrewState {
    if (value === undefined || value === null) {
        return { unconscious: false, ejected: false, dead: false };
    }
    const state = record(value, path);
    exactKeys(state, ['unconscious', 'ejected', 'dead'], path);
    for (const key of ['unconscious', 'ejected', 'dead'] as const) {
        if (state[key] !== undefined && state[key] !== true) {
            throw new Error(`${path}.${key} must be true when present`);
        }
    }
    return {
        unconscious: state['unconscious'] === true,
        ejected: state['ejected'] === true,
        dead: state['dead'] === true,
    };
}

function unpackNonMekCrewState(
    row: readonly unknown[],
    path: string,
): NonNullable<SerializedNonMekUnit['crewState']>[number] {
    if (row.length < 2 || row.length > 4) throw new Error(`${path} is not a compact non-Mek crew row`);
    const state = unpackCrewState(row[2], `${path}[2]`);
    return {
        positionId: asCrewPositionId(rowText(row, 0, path)),
        wounds: rowInteger(row, 1, path),
        unconscious: state.unconscious,
        ejected: state.ejected,
        ...(state.dead ? { dead: true as const } : {}),
        ...(row[3] === undefined
            ? {}
            : {
                recoveryReadyTurn: row[3] === null
                    ? null
                    : rowInteger(row, 3, path),
            }),
    };
}

function packUnitUuid(uuid: UnitUuid): CompactUnitUuid {
    return packUuid(String(uuid));
}

function unpackUnitUuid(value: unknown, path: string): UnitUuid {
    return unpackUuid(text(value, path), path);
}

function unpackSourceHashCanary(value: unknown, path: string) {
    try {
        return asSourceHashCanary(text(value, path));
    } catch {
        throw new Error(`${path} must be a four-character base64url canary`);
    }
}

function defaultBaseline(
    entity: UnitUuid,
    defaultRevision: number,
    defaultProfileId: string,
): SerializedCBTUnitV2['baselineRefAtSave'] {
    return {
        entity,
        initialStateProfile: {
            schemaVersion: 1,
            initializerRevision: defaultRevision,
            profileId: defaultProfileId,
        },
    };
}

function packDeployment(values: { readonly id: string; readonly initialHeat?: number; readonly crewAssignment: { readonly positions: readonly { readonly positionId: string; readonly name: string; readonly role: string; readonly gunnery: number; readonly piloting: number }[] } }): CompactDeployment | undefined {
    const positions = values.crewAssignment.positions.map(packCrewPosition);
    const pristine = values.id === DEFAULT_FORCE_DEPLOYMENT_ID
        && values.initialHeat === undefined
        && positions.every(position => position.length === 1);
    if (pristine) return undefined;
    const metadata = compactObject({
        i: values.id === DEFAULT_FORCE_DEPLOYMENT_ID ? undefined : values.id,
        h: values.initialHeat,
    });
    return tuple(
        Object.freeze(positions),
        Object.keys(metadata).length === 0 ? undefined : metadata,
    );
}

function unpackDeployment(value: unknown, path: string): SerializedCBTUnitV2['deployment'] {
    const unpacked = unpackDeploymentValues(value, path);
    return {
        schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
        values: unpacked,
    };
}

function unpackNonMekDeployment(value: unknown, path: string): SerializedNonMekUnit['deployment'] {
    const unpacked = unpackDeploymentValues(value, path);
    if (unpacked.initialHeat !== undefined) throw new Error(`${path} cannot give a non-Mek initial heat`);
    return {
        schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
        values: {
            id: unpacked.id,
            crewAssignment: unpacked.crewAssignment,
        },
    };
}

function unpackDeploymentValues(value: unknown, path: string) {
    if (value === undefined) {
        return {
            id: DEFAULT_FORCE_DEPLOYMENT_ID,
            crewAssignment: { schemaVersion: 1 as const, positions: [] },
        };
    }
    const row = array(value, path);
    if (row.length < 1 || row.length > 2) throw new Error(`${path} is not a compact deployment`);
    const metadata = row[1] === undefined ? {} : record(row[1], `${path}[1]`);
    exactKeys(metadata, ['i', 'h'], `${path}[1]`);
    return {
        id: metadata['i'] === undefined ? DEFAULT_FORCE_DEPLOYMENT_ID : text(metadata['i'], `${path}[1].i`),
        ...(metadata['h'] === undefined ? {} : { initialHeat: integer(metadata['h'], `${path}[1].h`) }),
        crewAssignment: unpackCrewAssignment(row[0], `${path}[0]`),
    };
}

function packCrewPosition(position: {
    readonly positionId: string;
    readonly name: string;
    readonly role: string;
    readonly gunnery: number;
    readonly piloting: number;
}): CompactCrewPosition {
    if (position.name === '' && position.role === '') {
        return position.gunnery === DEFAULT_GUNNERY_SKILL
            && position.piloting === DEFAULT_PILOTING_SKILL
            ? Object.freeze([position.positionId])
            : Object.freeze([position.positionId, position.gunnery, position.piloting]);
    }
    return Object.freeze([
        position.positionId,
        position.gunnery,
        position.piloting,
        position.name,
        position.role,
    ]);
}

function unpackCrewAssignment(value: unknown, path: string) {
    return {
        schemaVersion: 1 as const,
        positions: unpackRows(value, path, (row, rowPath) => {
            if (row.length !== 1 && row.length !== 3 && row.length !== 5) {
                throw new Error(`${rowPath} is not a compact crew position`);
            }
            return {
                positionId: asCrewPositionId(rowText(row, 0, rowPath)),
                name: row.length === 5 ? rowText(row, 3, rowPath) : '',
                role: row.length === 5 ? rowText(row, 4, rowPath) : '',
                gunnery: row.length === 1 ? DEFAULT_GUNNERY_SKILL : rowInteger(row, 1, rowPath),
                piloting: row.length === 1 ? DEFAULT_PILOTING_SKILL : rowInteger(row, 2, rowPath),
            };
        }),
    };
}

function packComponentState(row: NonNullable<SerializedCBTUnitV2['componentState']>[number]): unknown {
    return [row.target, compactObject({
        s: row.statusOverride,
        m: row.mode,
        j: row.jammed ? 1 : undefined,
        e: row.escalatingFailure && [row.escalatingFailure.sequence, row.escalatingFailure.active ? 1 : 0],
        p: row.ppcCapacitor && compactObject({
            w: row.ppcCapacitor.weaponId,
            c: row.ppcCapacitor.chargeState,
            f: row.ppcCapacitor.firedThisTurn ? 1 : undefined,
        }),
        b: row.bombastLaser && compactObject({
            c: row.bombastLaser.chargeState,
            f: row.bombastLaser.firedThisTurn ? 1 : undefined,
        }),
        c: row.c3EmergencyMaster && compactObject({
            m: row.c3EmergencyMaster.mode,
            t: row.c3EmergencyMaster.operatingTurns,
        }),
        g: row.gaussPower,
        h: row.shieldDamage && [row.shieldDamage.absorptionDamage, row.shieldDamage.capacityDamage],
        r: row.modularArmorDamage,
    })];
}

function unpackComponentState(row: readonly unknown[], path: string): NonNullable<SerializedCBTUnitV2['componentState']>[number] {
    const state = record(row[1], `${path}[1]`);
    exactKeys(state, ['s', 'm', 'j', 'e', 'p', 'b', 'c', 'g', 'h', 'r'], `${path}[1]`);
    const escalating = state['e'] === undefined ? undefined : array(state['e'], `${path}[1].e`);
    const ppc = state['p'] === undefined ? undefined : record(state['p'], `${path}[1].p`);
    const bombast = state['b'] === undefined ? undefined : record(state['b'], `${path}[1].b`);
    const emergency = state['c'] === undefined ? undefined : record(state['c'], `${path}[1].c`);
    const shield = state['h'] === undefined ? undefined : array(state['h'], `${path}[1].h`);
    if (ppc !== undefined) exactKeys(ppc, ['w', 'c', 'f'], `${path}[1].p`);
    if (bombast !== undefined) exactKeys(bombast, ['c', 'f'], `${path}[1].b`);
    if (emergency !== undefined) exactKeys(emergency, ['m', 't'], `${path}[1].c`);

    const statusOverride = optionalUnavailableEquipmentStatus(state['s'], `${path}[1].s`);
    const chargeState = ppc === undefined
        ? undefined
        : optionalPpcChargeState(ppc['c'], `${path}[1].p.c`);
    const bombastChargeState = bombast === undefined
        ? undefined
        : optionalBombastChargeState(bombast['c'], `${path}[1].b.c`);
    const emergencyMode = emergency === undefined
        ? undefined
        : optionalC3EmergencyMasterMode(emergency['m'], `${path}[1].c.m`);
    const operatingTurns = emergency === undefined
        ? undefined
        : optionalC3EmergencyMasterOperatingTurns(emergency['t'], `${path}[1].c.t`);
    const gaussPower = optionalSparseMekGaussPower(state['g'], `${path}[1].g`);

    return {
        target: asSavedTargetRef(rowText(row, 0, path)),
        ...(statusOverride === undefined ? {} : { statusOverride }),
        ...(state['m'] === undefined ? {} : { mode: text(state['m'], `${path}[1].m`) }),
        ...(state['j'] === undefined ? {} : { jammed: truthyOne(state['j'], `${path}[1].j`) }),
        ...(escalating === undefined ? {} : {
            escalatingFailure: {
                sequence: rowInteger(escalating, 0, `${path}[1].e`),
                ...(rowBit(escalating, 1, `${path}[1].e`) ? { active: true as const } : {}),
            },
        }),
        ...(ppc === undefined ? {} : {
            ppcCapacitor: {
                weaponId: asComponentId(text(ppc['w'], `${path}[1].p.w`)),
                ...(chargeState === undefined ? {} : { chargeState }),
                ...(ppc['f'] === undefined ? {} : {
                    firedThisTurn: truthyOne(ppc['f'], `${path}[1].p.f`),
                }),
            },
        }),
        ...(bombast === undefined ? {} : {
            bombastLaser: {
                ...(bombastChargeState === undefined ? {} : { chargeState: bombastChargeState }),
                ...(bombast['f'] === undefined ? {} : {
                    firedThisTurn: truthyOne(bombast['f'], `${path}[1].b.f`),
                }),
            },
        }),
        ...(emergency === undefined ? {} : {
            c3EmergencyMaster: {
                ...(emergencyMode === undefined ? {} : { mode: emergencyMode }),
                ...(operatingTurns === undefined ? {} : { operatingTurns }),
            },
        }),
        ...(gaussPower === undefined ? {} : { gaussPower }),
        ...(shield === undefined ? {} : {
            shieldDamage: {
                absorptionDamage: rowInteger(shield, 0, `${path}[1].h`),
                capacityDamage: rowInteger(shield, 1, `${path}[1].h`),
            },
        }),
        ...(state['r'] === undefined ? {} : {
            modularArmorDamage: integer(state['r'], `${path}[1].r`),
        }),
    };
}

function packHeat(value: SerializedCBTUnitV2['heat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({ c: value.heat, p: value.previous, o: value.pendingOverride, s: value.heatsinksOff });
}

function packNonMekHeat(value: SerializedNonMekUnit['heat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        c: value.current || undefined,
        p: value.previous || undefined,
        o: value.pendingOverride,
        s: value.heatsinksOff || undefined,
    });
}

function unpackNonMekHeat(
    value: unknown,
    path: string,
): NonNullable<SerializedNonMekUnit['heat']> {
    const heat = record(value, path);
    exactKeys(heat, ['c', 'p', 'o', 's'], path);
    return {
        current: optionalInteger(heat['c'], `${path}.c`) ?? 0,
        previous: optionalInteger(heat['p'], `${path}.p`) ?? 0,
        ...(heat['o'] === undefined
            ? {}
            : { pendingOverride: integer(heat['o'], `${path}.o`) }),
        heatsinksOff: optionalInteger(heat['s'], `${path}.s`) ?? 0,
    };
}

function unpackHeat(value: unknown, path: string): NonNullable<SerializedCBTUnitV2['heat']> {
    const heat = record(value, path);
    exactKeys(heat, ['c', 'p', 'o', 's'], path);
    return {
        heat: integer(heat['c'], `${path}.c`),
        ...(heat['p'] === undefined ? {} : { previous: integer(heat['p'], `${path}.p`) }),
        ...(heat['o'] === undefined ? {} : {
            pendingOverride: integer(heat['o'], `${path}.o`),
        }),
        ...(heat['s'] === undefined ? {} : { heatsinksOff: integer(heat['s'], `${path}.s`) }),
    };
}

function packMovement(value: SerializedMekMovementPsrStateV2): unknown {
    const compact = compactObject({
        m: value.movement,
        a: value.action,
        s: value.standAttempts,
        c: value.carefulStand ? 1 : undefined,
        d: value.damageThisPhase,
        k: value.checks?.map(check => tuple(
            check.checkId,
            compactObject({
                s: check.source.sourceKind,
                t: check.source.triggerKind,
                w: check.source.witness,
                c: check.source.criticalSlotIds.length ? check.source.criticalSlotIds : undefined,
                l: check.source.locationIds.length ? check.source.locationIds : undefined,
                b: check.source.baseTarget,
                m: check.source.triggerModifier,
            }),
            check.producingRevision,
            check.ordinal,
            check.targetNumber,
            check.reason,
            check.status,
            check.resolution && [check.resolution.dice, check.resolution.total],
        )),
        f: value.automaticFalls,
    });
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function unpackMovement(value: unknown, path: string): SerializedMekMovementPsrStateV2 {
    if (value === undefined) return { schemaVersion: 2 };
    const movement = record(value, path);
    exactKeys(movement, ['m', 'a', 's', 'c', 'd', 'k', 'f'], path);
    const expanded = compactObject({
        schemaVersion: 2,
        movement: movement['m'] === undefined ? undefined : clone(movement['m']),
        action: movement['a'] === undefined ? undefined : clone(movement['a']),
        standAttempts: optionalInteger(movement['s'], `${path}.s`),
        carefulStand: movement['c'] === undefined ? undefined : truthyOne(movement['c'], `${path}.c`),
        damageThisPhase: optionalInteger(movement['d'], `${path}.d`),
        checks: movement['k'] === undefined ? undefined : unpackRows(movement['k'], `${path}.k`, (row, rowPath) => {
            const source = record(row[1], `${rowPath}[1]`);
            const resolution = row[7] === undefined ? undefined : array(row[7], `${rowPath}[7]`);
            return compactObject({
                checkId: rowText(row, 0, rowPath),
                source: {
                    sourceKind: text(source['s'], `${rowPath}[1].s`),
                    triggerKind: text(source['t'], `${rowPath}[1].t`),
                    witness: text(source['w'], `${rowPath}[1].w`),
                    criticalSlotIds: unpackTextArray(source['c'] ?? [], `${rowPath}[1].c`),
                    locationIds: unpackTextArray(source['l'] ?? [], `${rowPath}[1].l`),
                    baseTarget: integer(source['b'], `${rowPath}[1].b`),
                    triggerModifier: integer(source['m'], `${rowPath}[1].m`),
                },
                producingRevision: rowInteger(row, 2, rowPath),
                ordinal: rowInteger(row, 3, rowPath),
                targetNumber: rowInteger(row, 4, rowPath),
                reason: rowText(row, 5, rowPath),
                status: rowText(row, 6, rowPath),
                resolution: resolution === undefined ? undefined : {
                    dice: clone(resolution[0]), total: rowInteger(resolution, 1, `${rowPath}[7]`),
                },
            });
        }),
        automaticFalls: movement['f'] === undefined ? undefined : clone(movement['f']),
    });
    return serializeMekMovementPsrStateV2(deserializeMekMovementPsrStateV2(expanded));
}

function packTurn(value: SerializedMekTurnStateV2): unknown {
    const compact = compactObject({
        n: value.turnCounter,
        a: value.airborne,
        c: value.cover,
        w: value.weaponsHeat,
        h: value.acknowledgedHeatSources?.map(row => [row.sourceId, row.signature]),
        d: value.heatDissipationConsumed,
        s: value.spotting ? 1 : undefined,
        e: value.phaseStateChanged ? 1 : undefined,
        p: packEndTurnCheckpoint(value.endTurnCheckpoint),
        f: value.pendingFallConsequences === undefined
            ? undefined
            : tuple(
                value.pendingFallConsequences.eventId,
                value.pendingFallConsequences.totalDamage,
                value.pendingFallConsequences.hitArcLabel,
                value.pendingFallConsequences.applyPilotHits ? 1 : 0,
                value.pendingFallConsequences.forceSeatbeltFailure ? 1 : 0,
                value.pendingFallConsequences.seatbeltPositionIds,
                value.pendingFallConsequences.headHits,
                value.pendingFallConsequences.stage === 'head-hits' ? 0
                    : value.pendingFallConsequences.stage === 'seatbelts' ? 1 : 2,
                value.pendingFallConsequences.seatbeltFailures,
            ),
        q: value.pendingCriticalEvents === undefined
            ? undefined
            : clone(value.pendingCriticalEvents),
    });
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function unpackTurn(value: unknown, path: string): SerializedMekTurnStateV2 {
    if (value === undefined) return { schemaVersion: 1 };
    const turn = record(value, path);
    exactKeys(turn, ['n', 'a', 'c', 'w', 'h', 'd', 's', 'e', 'p', 'f', 'q'], path);
    const expanded = compactObject({
        schemaVersion: 1,
        turnCounter: optionalInteger(turn['n'], `${path}.n`),
        airborne: turn['a'] as boolean | undefined,
        cover: turn['c'] === undefined ? undefined : clone(turn['c']),
        weaponsHeat: optionalInteger(turn['w'], `${path}.w`),
        acknowledgedHeatSources: turn['h'] === undefined ? undefined : unpackRows(turn['h'], `${path}.h`, (row, rowPath) => ({
            sourceId: rowText(row, 0, rowPath), signature: rowText(row, 1, rowPath),
        })),
        heatDissipationConsumed: optionalInteger(turn['d'], `${path}.d`),
        spotting: turn['s'] === undefined ? undefined : truthyOne(turn['s'], `${path}.s`),
        phaseStateChanged: turn['e'] === undefined ? undefined : truthyOne(turn['e'], `${path}.e`),
        endTurnCheckpoint: turn['p'] === undefined
            ? undefined
            : unpackEndTurnCheckpoint(turn['p'], `${path}.p`),
        pendingFallConsequences: turn['f'] === undefined
            ? undefined
            : unpackPendingFallConsequences(turn['f'], `${path}.f`),
        pendingCriticalEvents: turn['q'] === undefined
            ? undefined
            : clone(turn['q']) as SerializedMekTurnStateV2['pendingCriticalEvents'],
    });
    return serializeMekTurnStateV2(deserializeMekTurnStateV2(expanded));
}

function unpackPendingFallConsequences(
    value: unknown,
    path: string,
): NonNullable<SerializedMekTurnStateV2['pendingFallConsequences']> {
    const row = array(value, path);
    if (row.length < 8 || row.length > 9) throw new Error(`${path} is not a pending fall cursor`);
    const stage = rowInteger(row, 7, path);
    if (stage < 0 || stage > 2) throw new Error(`${path}[7] is not a pending fall stage`);
    const positions = unpackTextArray(row[5], `${path}[5]`).map(asCrewPositionId);
    const failures = row[8] === undefined
        ? undefined
        : unpackTextArray(row[8], `${path}[8]`).map(asCrewPositionId);
    return {
        eventId: rowText(row, 0, path),
        totalDamage: rowInteger(row, 1, path),
        hitArcLabel: rowText(row, 2, path),
        applyPilotHits: rowBit(row, 3, path),
        forceSeatbeltFailure: rowBit(row, 4, path),
        seatbeltPositionIds: positions,
        headHits: rowInteger(row, 6, path),
        stage: stage === 0 ? 'head-hits' : stage === 1 ? 'seatbelts' : 'crew-hits',
        ...(failures === undefined ? {} : { seatbeltFailures: failures }),
    };
}

function packEndTurnCheckpoint(value: EndTurnCheckpoint | undefined): 1 | 2 | undefined {
    if (value === undefined) return undefined;
    if (value === 'phase-ended') return 1;
    if (value === 'heat-staged') return 2;
    throw new Error('Cannot compact an invalid End Turn checkpoint');
}

function unpackEndTurnCheckpoint(value: unknown, path: string): EndTurnCheckpoint {
    const code = integer(value, path);
    if (code === 1) return 'phase-ended';
    if (code === 2) return 'heat-staged';
    throw new Error(`${path} is not an End Turn checkpoint`);
}

function packTargeting(value: SavedAttackerTargetingState): unknown {
    if (value.components.length === 0 && value.actions.length === 0 && value.targets.length === 0) return undefined;
    return compactObject({
        c: value.components.length ? value.components.map(row => [row.target, compactObject({
            s: row.selection,
            a: row.ammo,
        })]) : undefined,
        a: value.actions.length ? value.actions : undefined,
        t: value.targets.length ? value.targets : undefined,
    });
}

function unpackSavedTargeting(value: unknown, path: string): SavedAttackerTargetingState {
    if (value === undefined) return { schemaVersion: 1, components: [], actions: [], targets: [] };
    const targeting = record(value, path);
    exactKeys(targeting, ['c', 'a', 't'], path);
    const directComponents = targeting['c'] === undefined
        ? []
        : unpackRows(targeting['c'], `${path}.c`, (row, rowPath) => {
            const state = record(row[1], `${rowPath}[1]`);
            exactKeys(state, ['s', 'a'], `${rowPath}[1]`);
            let ammo: Readonly<Record<string, unknown>> | undefined;
            if (state['a'] !== undefined) {
                const savedAmmo = record(state['a'], `${rowPath}[1].a`);
                exactKeys(savedAmmo, ['munitionKey', 'preferredSourceTarget'], `${rowPath}[1].a`);
                ammo = compactObject({
                    munitionKey: text(savedAmmo['munitionKey'], `${rowPath}[1].a.munitionKey`),
                    preferredSourceId: savedAmmo['preferredSourceTarget'] === undefined
                        ? undefined
                        : asComponentId(text(
                            savedAmmo['preferredSourceTarget'],
                            `${rowPath}[1].a.preferredSourceTarget`,
                        )),
                });
            }
            return compactObject({
                componentId: asComponentId(rowText(row, 0, rowPath)),
                selection: state['s'] === undefined ? undefined : clone(state['s']),
                ammo,
            });
        });
    const directActions = array(targeting['a'] ?? [], `${path}.a`).map((raw, index) => {
        const actionPath = `${path}.a[${index}]`;
        const action = record(raw, actionPath);
        if (action['kind'] === 'intrinsic') {
            exactKeys(action, ['kind', 'actionId', 'selection'], actionPath);
            return {
                target: { kind: 'intrinsic' as const, actionId: text(action['actionId'], `${actionPath}.actionId`) },
                selection: clone(action['selection']),
            };
        }
        if (action['kind'] === 'component') {
            exactKeys(action, ['kind', 'target', 'selection'], actionPath);
            return {
                target: {
                    kind: 'component' as const,
                    componentId: asComponentId(text(action['target'], `${actionPath}.target`)),
                },
                selection: clone(action['selection']),
            };
        }
        throw new Error(`${actionPath}.kind is not an attacker action kind`);
    });
    const canonical = serializeAttackerTargetingState(deserializeAttackerTargetingState({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: directComponents,
        actions: directActions,
        targets: clone(array(targeting['t'] ?? [], `${path}.t`)),
    }));
    return {
        schemaVersion: 1,
        components: canonical.components.map(component => ({
            target: asSavedTargetRef(component.componentId),
            ...(component.selection === undefined ? {} : { selection: component.selection }),
            ...(component.ammo === undefined ? {} : {
                ammo: {
                    munitionKey: component.ammo.munitionKey,
                    ...(component.ammo.preferredSourceId === undefined ? {} : {
                        preferredSourceTarget: asSavedTargetRef(component.ammo.preferredSourceId),
                    }),
                },
            }),
        })),
        actions: canonical.actions.map(action => action.target.kind === 'intrinsic'
            ? {
                kind: 'intrinsic' as const,
                actionId: action.target.actionId,
                selection: action.selection,
            }
            : {
                kind: 'component' as const,
                target: asSavedTargetRef(action.target.componentId),
                selection: action.selection,
            }),
        targets: canonical.targets,
    };
}

function packDirectTargeting(value: SerializedAttackerTargetingState): unknown {
    if (value.components.length === 0 && value.actions.length === 0 && value.targets.length === 0) return undefined;
    return compactObject({
        c: value.components.length ? value.components.map(row => [row.componentId, compactObject({
            s: row.selection,
            a: row.ammo,
        })]) : undefined,
        a: value.actions.length ? value.actions : undefined,
        t: value.targets.length ? value.targets : undefined,
    });
}

function unpackDirectTargeting(value: unknown, path: string): SerializedAttackerTargetingState {
    if (value === undefined) return {
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: [], actions: [], targets: [],
    };
    const targeting = record(value, path);
    exactKeys(targeting, ['c', 'a', 't'], path);
    const expanded = {
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: targeting['c'] === undefined ? [] : unpackRows(targeting['c'], `${path}.c`, (row, rowPath) => {
            const state = record(row[1], `${rowPath}[1]`);
            exactKeys(state, ['s', 'a'], `${rowPath}[1]`);
            return compactObject({
                componentId: asComponentId(rowText(row, 0, rowPath)),
                selection: state['s'] === undefined ? undefined : clone(state['s']),
                ammo: state['a'] === undefined ? undefined : clone(state['a']),
            });
        }),
        actions: clone(targeting['a'] ?? []),
        targets: clone(targeting['t'] ?? []),
    };
    return serializeAttackerTargetingState(deserializeAttackerTargetingState(expanded));
}

function packPending(value: SerializedCBTUnitV2['pendingCombat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        l: packRows(value.locationDamage, row => [row.target, row.damage]),
        n: packRows(value.locationConditions, row => [row.target, row.condition, row.value]),
        s: packRows(value.slotHits, row => [row.target, row.hits]),
        c: packRows(value.componentStatus, row => [row.target, row.status]),
        h: packRows(value.shieldDamage, row => [row.target, row.absorptionDamage, row.capacityDamage]),
        m: packRows(value.modularArmorDamage, row => [row.target, row.damage]),
    });
}

function unpackPending(value: unknown, path: string): NonNullable<SerializedCBTUnitV2['pendingCombat']> {
    const pending = record(value, path);
    exactKeys(pending, ['l', 'n', 's', 'c', 'h', 'm'], path);
    return {
        ...(pending['l'] === undefined ? {} : {
            locationDamage: unpackRows(pending['l'], `${path}.l`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
            })),
        }),
        ...(pending['n'] === undefined ? {} : {
            locationConditions: unpackRows(pending['n'], `${path}.n`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                condition: unpackMekLocationCondition(row[1], `${rowPath}[1]`),
                value: rowInteger(row, 2, rowPath),
            })),
        }),
        ...(pending['s'] === undefined ? {} : {
            slotHits: unpackRows(pending['s'], `${path}.s`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                hits: rowInteger(row, 1, rowPath),
            })),
        }),
        ...(pending['c'] === undefined ? {} : {
            componentStatus: unpackRows(pending['c'], `${path}.c`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                status: unpackEquipmentStatus(row[1], `${rowPath}[1]`),
            })),
        }),
        ...(pending['h'] === undefined ? {} : {
            shieldDamage: unpackRows(pending['h'], `${path}.h`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                absorptionDamage: rowInteger(row, 1, rowPath),
                capacityDamage: rowInteger(row, 2, rowPath),
            })),
        }),
        ...(pending['m'] === undefined ? {} : {
            modularArmorDamage: unpackRows(pending['m'], `${path}.m`, (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
            })),
        }),
    };
}

function packNonMekPending(value: SerializedNonMekUnit['pendingCombat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        l: packRows(value.internalDamage, row => [row.locationId, row.damage]),
        a: packRows(value.armorDamage, row => [row.faceId, row.damage]),
        c: packRows(value.componentStatus, row => [row.componentId, row.status]),
        q: packRows(value.damageTrackHits, row => [row.damageTrackId, row.hitDelta, row.hitTimestamps]),
    });
}

function unpackNonMekPending(value: unknown, path: string): NonNullable<SerializedNonMekUnit['pendingCombat']> {
    const pending = record(value, path);
    exactKeys(pending, ['l', 'a', 'c', 'q'], path);
    return {
        ...(pending['l'] === undefined ? {} : {
            internalDamage: unpackRows(pending['l'], `${path}.l`, (row, rowPath) => ({
                locationId: asLocationId(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
            })),
        }),
        ...(pending['a'] === undefined ? {} : {
            armorDamage: unpackRows(pending['a'], `${path}.a`, (row, rowPath) => ({
                faceId: asArmorFaceId(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
            })),
        }),
        ...(pending['c'] === undefined ? {} : {
            componentStatus: unpackRows(pending['c'], `${path}.c`, (row, rowPath) => ({
                componentId: asComponentId(rowText(row, 0, rowPath)),
                status: unpackEquipmentStatus(row[1], `${rowPath}[1]`),
            })),
        }),
        ...(pending['q'] === undefined ? {} : {
            damageTrackHits: unpackRows(pending['q'], `${path}.q`, (row, rowPath) => ({
                damageTrackId: asSystemDamageTrackId(rowText(row, 0, rowPath)),
                hitDelta: rowInteger(row, 1, rowPath),
                hitTimestamps: unpackIntegerArray(row[2], `${rowPath}[2]`),
            })),
        }),
    };
}

function packRoster(
    roster: SerializedCBTForceRosterV1,
    units: readonly SerializedForceUnitEntryV2[],
): readonly unknown[] {
    const unitIndex = new Map(units.map((unit, index) => [unit.instanceId, index] as const));
    const groupIndex = new Map(roster.groups.map((group, index) => [group.groupId, index] as const));
    return Object.freeze(roster.groups.map(group => {
        const targetGroupIndex = group.formationTargetGroupId === undefined
            ? undefined
            : groupIndex.get(group.formationTargetGroupId);
        if (group.formationTargetGroupId !== undefined && targetGroupIndex === undefined) {
            throw new Error(`Roster formation target ${group.formationTargetGroupId} has no force group`);
        }
        const metadata = compactObject({
            n: group.name,
            c: group.color,
            f: group.formationId,
            t: targetGroupIndex,
            l: group.formationLock ? 1 : undefined,
        });
        return tuple(
            packOpaqueId(group.groupId),
            group.members.map(member => {
                const index = unitIndex.get(member.instanceId);
                if (index === undefined) throw new Error(`Roster member ${member.instanceId} has no force unit`);
                return tuple(index, member.commander ? 1 : undefined);
            }),
            Object.keys(metadata).length === 0 ? undefined : metadata,
        );
    }));
}

function unpackRoster(value: unknown, units: readonly SerializedForceUnitEntryV2[]): SerializedCBTForceRosterV1 {
    const packedGroups = array(value, 'force.cbt.g');
    const groupIds = packedGroups.map((raw, index) => {
        const path = `force.cbt.g[${index}]`;
        return unpackOpaqueId(rowText(array(raw, path), 0, path), `${path}[0]`);
    });
    return {
        schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
        groups: unpackRows(packedGroups, 'force.cbt.g', (row, path, groupOrder) => {
            const metadata = row[2] === undefined ? {} : record(row[2], `${path}[2]`);
            exactKeys(metadata, ['n', 'c', 'f', 't', 'l'], `${path}[2]`);
            const targetGroupIndex = optionalInteger(metadata['t'], `${path}[2].t`);
            const formationTargetGroupId = targetGroupIndex === undefined
                ? undefined
                : groupIds[targetGroupIndex];
            if (targetGroupIndex !== undefined && formationTargetGroupId === undefined) {
                throw new Error(`${path}[2].t has no force group`);
            }
            return {
            groupId: groupIds[groupOrder]!,
            order: groupOrder,
            ...(metadata['n'] === undefined ? {} : { name: text(metadata['n'], `${path}[2].n`) }),
            ...(metadata['c'] === undefined ? {} : { color: text(metadata['c'], `${path}[2].c`) }),
            ...(metadata['f'] === undefined ? {} : { formationId: text(metadata['f'], `${path}[2].f`) }),
            ...(formationTargetGroupId === undefined
                ? {}
                : { formationTargetGroupId }),
            ...(metadata['l'] === undefined ? {} : { formationLock: truthyOne(metadata['l'], `${path}[2].l`) }),
            members: unpackRows(row[1], `${path}[1]`, (member, memberPath, order) => {
                const unitIndex = rowInteger(member, 0, memberPath);
                const unit = units[unitIndex];
                if (unit === undefined) throw new Error(`${memberPath}[0] has no force unit`);
                const instanceId = unit.instanceId;
                return {
                    instanceId,
                    order,
                    ...(member[1] === undefined || member[1] === 0
                        ? {}
                        : { commander: truthyOne(member[1], `${memberPath}[1]`) }),
                };
            }),
        };
        }),
    };
}

function packEncounter(encounter: SerializedForceEncounterEntryV2): unknown {
    return tuple(encounter.encounterRevision, encounter.state.facts);
}

function unpackEncounter(value: unknown, path: string): SerializedForceEncounterEntryV2 {
    const row = array(value, path);
    if (row.length !== 2) throw new Error(`${path} is not a compact encounter`);
    const revision = rowInteger(row, 0, path);
    const state: SerializedCBTEncounterStateV2 = {
        schemaVersion: 2,
        encounterRevision: revision,
        facts: clone(row[1]) as SerializedCBTEncounterStateV2['facts'],
    };
    return {
        encounterRevision: revision,
        state,
    };
}

function emptyEncounter(): SerializedForceEncounterEntryV2 {
    const revision = 0;
    return { encounterRevision: revision, state: { schemaVersion: 2, encounterRevision: revision, facts: [] } };
}

function packRows<T>(value: readonly T[] | undefined, map: (row: T) => unknown): readonly unknown[] | undefined {
    return value === undefined || value.length === 0 ? undefined : value.map(map);
}

function unpackRows<T>(
    value: unknown,
    path: string,
    map: (row: readonly unknown[], path: string, index: number) => T,
): T[] {
    return array(value, path).map((raw, index) => map(array(raw, `${path}[${index}]`), `${path}[${index}]`, index));
}

function compactObject(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)));
}

function tuple(...values: unknown[]): readonly unknown[] {
    while (values.length > 0 && values.at(-1) === undefined) values.pop();
    return Object.freeze(values);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return value;
}

function unpackTextArray(value: unknown, path: string): string[] {
    return array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
}

function unpackIntegerArray(value: unknown, path: string): number[] {
    return array(value, path).map((entry, index) => integer(entry, `${path}[${index}]`));
}

function unpackUnitConditions(value: unknown, path: string): UnitConditionKey[] {
    return array(value, path).map((entry, index) => {
        const key = text(entry, `${path}[${index}]`);
        if (!isUnitConditionKey(key)) throw new Error(`${path}[${index}] is not a unit condition`);
        return key;
    });
}

function unpackMekLocationCondition(value: unknown, path: string): MekLocationConditionKey {
    if (!isMekLocationConditionKey(value)) throw new Error(`${path} is not a Mek location condition`);
    return value;
}

function unpackMekRuleCheckKey(value: unknown, path: string): MekRuleCheckKeyV2 {
    if (!isMekRuleCheckKeyV2(value)) throw new Error(`${path} is not a Mek rule-check key`);
    return value;
}

function unpackMekRuleCheckStatus(value: unknown, path: string): MekRuleCheckStatusV2 {
    if (!isMekRuleCheckStatusV2(value)) throw new Error(`${path} is not a Mek rule-check status`);
    return value;
}

function unpackNonMekEntityType(value: unknown, path: string): SerializedNonMekUnit['family']['entityType'] {
    const entityType = text(value, path);
    if (!isNativeEntityType(entityType) || !isNonMekEntityType(entityType)) {
        throw new Error(`${path} is not a non-Mek entity type`);
    }
    return entityType;
}

function unpackEquipmentStatus(value: unknown, path: string): EquipmentStatus {
    if (!isEquipmentStatus(value)) throw new Error(`${path} is not an equipment status`);
    return value;
}

function unpackUnavailableEquipmentStatus(value: unknown, path: string): UnavailableEquipmentStatus {
    if (!isUnavailableEquipmentStatus(value)) {
        throw new Error(`${path} is not a sparse equipment status`);
    }
    return value;
}

function optionalUnavailableEquipmentStatus(
    value: unknown,
    path: string,
): UnavailableEquipmentStatus | undefined {
    return value === undefined || value === null
        ? undefined
        : unpackUnavailableEquipmentStatus(value, path);
}

function optionalPpcChargeState(value: unknown, path: string): PpcCapacitorChargeState | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isPpcCapacitorChargeState(value)) throw new Error(`${path} is not a PPC charge state`);
    return value;
}

function optionalBombastChargeState(value: unknown, path: string): BombastLaserChargeState | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isBombastLaserChargeState(value)) throw new Error(`${path} is not a Bombast charge state`);
    return value;
}

function optionalC3EmergencyMasterMode(
    value: unknown,
    path: string,
): C3EmergencyMasterModeOverride | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isC3EmergencyMasterModeOverride(value)) {
        throw new Error(`${path} is not a C3 Emergency Master mode`);
    }
    return value;
}

function optionalC3EmergencyMasterOperatingTurns(
    value: unknown,
    path: string,
): C3EmergencyMasterOperatingTurns | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isC3EmergencyMasterOperatingTurns(value)) {
        throw new Error(`${path} is not a C3 Emergency Master turn count`);
    }
    return value;
}

function optionalSparseMekGaussPower(value: unknown, path: string): SparseMekGaussPowerState | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isSparseMekGaussPowerState(value)) throw new Error(`${path} is not a sparse Gauss power state`);
    return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const accepted = new Set(allowed);
    const unexpected = Object.keys(value).find(key => !accepted.has(key));
    if (unexpected !== undefined) throw new Error(`${path}.${unexpected} is not a current compact field`);
}

function text(value: unknown, path: string): string {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`);
    return value;
}

function integer(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
    return value as number;
}

function optionalInteger(value: unknown, path: string): number | undefined {
    return value === undefined || value === null ? undefined : integer(value, path);
}

function finiteNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${path} must be a finite number`);
    }
    return value;
}

function booleanValue(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
    return value;
}

function truthyOne(value: unknown, path: string): true {
    if (value !== 1) throw new Error(`${path} must be one`);
    return true;
}

function rowText(row: readonly unknown[], index: number, path: string): string {
    return text(row[index], `${path}[${index}]`);
}

function rowInteger(row: readonly unknown[], index: number, path: string): number {
    return integer(row[index], `${path}[${index}]`);
}

function rowBit(row: readonly unknown[], index: number, path: string): boolean {
    const value = row[index];
    if (value !== 0 && value !== 1) throw new Error(`${path}[${index}] must be zero or one`);
    return value === 1;
}

function fail(message: string): never {
    throw new Error(message);
}
