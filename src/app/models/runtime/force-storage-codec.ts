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
import {
    isC3NetworkRole,
    isC3NetworkType,
    type C3UnitPosition,
} from '../c3-network.model';
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
    SerializedCBTEncounterStateV2,
    SerializedCBTForceV2,
    SerializedCBTUnitV2,
    SerializedEncounterNetworkV2,
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
import type { EquipmentRowOrderState } from './equipment-row-order';
import { isSparseMekGaussPowerState, type SparseMekGaussPowerState } from './mek-gauss-power';
import {
    asMekRuleCheckTokenV2,
    isMekRuleCheckKeyV2,
    isMekRuleCheckStatusV2,
    type MekRuleCheckKeyV2,
    type MekRuleCheckStatusV2,
} from './mek-destruction-state-v2';
import {
    AS_FORCE_FIELD,
    AS_GROUP_FIELD,
    AS_NETWORK_FIELD,
    AS_STATE_FIELD,
    AS_UNIT_FIELD,
    CBT_BOMBAST_LASER_FIELD,
    CBT_C3_EMERGENCY_MASTER_FIELD,
    CBT_COMPONENT_STATE_FIELD,
    CBT_DEPLOYMENT_METADATA_FIELD,
    CBT_ENCOUNTER_ENDPOINT_INDEX,
    CBT_ENCOUNTER_NETWORK_INDEX,
    CBT_EQUIPMENT_ROW_ORDER_FIELD,
    CBT_FORCE_FIELD,
    CBT_HEAT_FIELD,
    CBT_HISTORY_FIELD,
    CBT_MOVEMENT_FIELD,
    CBT_MOVEMENT_SOURCE_FIELD,
    CBT_NON_MEK_PENDING_COMBAT_FIELD,
    CBT_PENDING_COMBAT_FIELD,
    CBT_PPC_CAPACITOR_FIELD,
    CBT_ROSTER_GROUP_METADATA_FIELD,
    CBT_TURN_FIELD,
    CBT_UNIT_FAMILY,
    CBT_UNIT_FIELD,
    FORCE_PAYLOAD_FIELD,
} from './force-storage-vocabulary';

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
    const cbt = root[FORCE_PAYLOAD_FIELD.classicBattleTech];
    if (cbt === null || typeof cbt !== 'object' || Array.isArray(cbt)) return false;
    const compact = cbt as Record<string, unknown>;
    return !('schemaVersion' in compact)
        && compact[CBT_FORCE_FIELD.formatVersion] === COMPACT_FORCE_FORMAT_VERSION
        && CBT_FORCE_FIELD.revision in compact
        && CBT_FORCE_FIELD.units in compact
        && CBT_FORCE_FIELD.groups in compact;
}

type CompactUnitUuid = string;

type CompactCrewPosition = readonly unknown[];
type CompactDeployment = readonly unknown[];

type CompactForce = Readonly<{
    [CBT_FORCE_FIELD.formatVersion]: 2;
    [CBT_FORCE_FIELD.revision]: number;
    [CBT_FORCE_FIELD.units]: readonly unknown[];
    [CBT_FORCE_FIELD.groups]: readonly unknown[];
    [CBT_FORCE_FIELD.history]?: SerializedCBTForceV2['history'];
    [CBT_FORCE_FIELD.encounter]?: unknown;
}>;

type CompactASForce = Readonly<{
    [AS_FORCE_FIELD.formatVersion]: 1;
    [AS_FORCE_FIELD.groups]: readonly CompactASGroup[];
    [AS_FORCE_FIELD.networks]?: readonly CompactASNetwork[];
}>;

type CompactASGroup = Readonly<{
    [AS_GROUP_FIELD.instanceId]: string;
    [AS_GROUP_FIELD.name]?: string;
    [AS_GROUP_FIELD.color]?: string;
    [AS_GROUP_FIELD.formationId]?: string;
    [AS_GROUP_FIELD.formationLock]?: 1;
    [AS_GROUP_FIELD.formationTargetGroupId]?: string;
    [AS_GROUP_FIELD.units]: readonly CompactASUnit[];
}>;

type CompactASUnit = Readonly<{
    [AS_UNIT_FIELD.instanceId]: string;
    [AS_UNIT_FIELD.catalogUuid]: string;
    [AS_UNIT_FIELD.sourceHashCanary]?: string;
    [AS_UNIT_FIELD.alias]?: string;
    [AS_UNIT_FIELD.updatedTimestamp]?: number;
    [AS_UNIT_FIELD.skill]?: number;
    [AS_UNIT_FIELD.abilities]?: ASSerializedUnit['abilities'];
    [AS_UNIT_FIELD.formationAbilities]?: string[];
    [AS_UNIT_FIELD.commander]?: 1;
    [AS_UNIT_FIELD.c3Position]?: readonly [number, number];
    [AS_UNIT_FIELD.state]?: Readonly<Record<string, unknown>>;
}>;

type CompactASNetwork = Readonly<{
    [AS_NETWORK_FIELD.instanceId]: string;
    [AS_NETWORK_FIELD.type]: string;
    [AS_NETWORK_FIELD.color]: string;
    [AS_NETWORK_FIELD.peerIds]?: readonly string[];
    [AS_NETWORK_FIELD.masterId]?: string;
    [AS_NETWORK_FIELD.masterComponentIndex]?: number;
    [AS_NETWORK_FIELD.members]?: readonly string[];
}>;

const COMPACT_FORCE_FORMAT_VERSION = 2;
const COMPACT_AS_FORMAT_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COMPACT_UUID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const CBT_MEK_UNIT_FIELDS = [
    CBT_UNIT_FIELD.family,
    CBT_UNIT_FIELD.instanceId,
    CBT_UNIT_FIELD.catalogUuid,
    CBT_UNIT_FIELD.sourceHashCanary,
    CBT_UNIT_FIELD.deployment,
    CBT_UNIT_FIELD.stateRevision,
    CBT_UNIT_FIELD.destroyed,
    CBT_UNIT_FIELD.locationState,
    CBT_UNIT_FIELD.locationConditions,
    CBT_UNIT_FIELD.slotState,
    CBT_UNIT_FIELD.componentState,
    CBT_UNIT_FIELD.ammoState,
    CBT_UNIT_FIELD.crewState,
    CBT_UNIT_FIELD.heat,
    CBT_UNIT_FIELD.ruleChecks,
    CBT_UNIT_FIELD.movementPsr,
    CBT_UNIT_FIELD.equipmentRowOrder,
    CBT_UNIT_FIELD.conditions,
    CBT_UNIT_FIELD.c3Position,
    CBT_UNIT_FIELD.mekTurn,
    CBT_UNIT_FIELD.pendingCombat,
] as const;
const CBT_NON_MEK_UNIT_FIELDS = [
    CBT_UNIT_FIELD.family,
    CBT_UNIT_FIELD.entityType,
    CBT_UNIT_FIELD.instanceId,
    CBT_UNIT_FIELD.catalogUuid,
    CBT_UNIT_FIELD.sourceHashCanary,
    CBT_UNIT_FIELD.deployment,
    CBT_UNIT_FIELD.stateRevision,
    CBT_UNIT_FIELD.destroyed,
    CBT_UNIT_FIELD.locationState,
    CBT_UNIT_FIELD.componentState,
    CBT_UNIT_FIELD.damageTrackState,
    CBT_UNIT_FIELD.ammoState,
    CBT_UNIT_FIELD.crewState,
    CBT_UNIT_FIELD.conditions,
    CBT_UNIT_FIELD.heat,
    CBT_UNIT_FIELD.nonMekTurn,
    CBT_UNIT_FIELD.equipmentRowOrder,
    CBT_UNIT_FIELD.c3Position,
    CBT_UNIT_FIELD.pendingCombat,
] as const;

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
            [FORCE_PAYLOAD_FIELD.alphaStrike]: packASForce(
                force.groups as ASSerializedGroup[],
                force.c3Networks,
            ),
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
        [FORCE_PAYLOAD_FIELD.classicBattleTech]: packForce(force.cbt),
    });
}

export function decodeForceFromStorage(value: unknown): SerializedForce {
    const detached = clone(value);
    const root = record(detached, 'force');
    if (root['version'] === 1) return detached as SerializedForce;
    if (root['type'] === GameSystem.AS) {
        const field = FORCE_PAYLOAD_FIELD.alphaStrike;
        return unpackASForce(root, record(root[field], `force.${field}`));
    }
    const field = FORCE_PAYLOAD_FIELD.classicBattleTech;
    const compact = record(root[field], `force.${field}`);
    const instanceId = text(root['instanceId'], 'force.instanceId');
    return unpackCBTForce(root, instanceId, unpackForce(compact, instanceId));
}

function packASForce(
    groups: readonly ASSerializedGroup[],
    networks: readonly SerializedC3NetworkGroup[] | undefined,
): CompactASForce {
    return Object.freeze({
        [AS_FORCE_FIELD.formatVersion]: COMPACT_AS_FORMAT_VERSION,
        [AS_FORCE_FIELD.groups]: Object.freeze(groups.map(packASGroup)),
        ...(networks === undefined || networks.length === 0
            ? {}
            : { [AS_FORCE_FIELD.networks]: Object.freeze(networks.map(packASNetwork)) }),
    });
}

function packASGroup(group: ASSerializedGroup): CompactASGroup {
    return compactObject({
        [AS_GROUP_FIELD.instanceId]: packOpaqueId(group.id),
        [AS_GROUP_FIELD.name]: group.name,
        [AS_GROUP_FIELD.color]: group.color,
        [AS_GROUP_FIELD.formationId]: group.formationId,
        [AS_GROUP_FIELD.formationLock]: group.formationLock ? 1 : undefined,
        [AS_GROUP_FIELD.formationTargetGroupId]: group.formationTargetGroupId === undefined
            ? undefined
            : packOpaqueId(group.formationTargetGroupId),
        [AS_GROUP_FIELD.units]: Object.freeze(group.units.map(packASUnit)),
    }) as CompactASGroup;
}

function packASUnit(unit: ASSerializedUnit): CompactASUnit {
    return compactObject({
        [AS_UNIT_FIELD.instanceId]: packOpaqueId(unit.id),
        [AS_UNIT_FIELD.catalogUuid]: packUuid(unit.uuid),
        [AS_UNIT_FIELD.sourceHashCanary]: unit.sourceHashCanary,
        [AS_UNIT_FIELD.alias]: unit.alias,
        [AS_UNIT_FIELD.updatedTimestamp]: unit.updatedTs,
        [AS_UNIT_FIELD.skill]: unit.skill,
        [AS_UNIT_FIELD.abilities]: unit.abilities === undefined ? undefined : clone(unit.abilities),
        [AS_UNIT_FIELD.formationAbilities]: unit.formationAbilities === undefined
            ? undefined
            : [...unit.formationAbilities],
        [AS_UNIT_FIELD.commander]: unit.commander ? 1 : undefined,
        [AS_UNIT_FIELD.c3Position]: unit.state?.c3Position === undefined
            ? undefined
            : [unit.state.c3Position.x, unit.state.c3Position.y],
        [AS_UNIT_FIELD.state]: packASState(unit.state),
    }) as CompactASUnit;
}

function packASState(state: ASSerializedState | undefined): Readonly<Record<string, unknown>> | undefined {
    if (state === undefined) return undefined;
    const packed = compactObject({
        [AS_STATE_FIELD.modified]: state.modified ? 1 : undefined,
        [AS_STATE_FIELD.destroyed]: state.destroyed ? 1 : undefined,
        [AS_STATE_FIELD.conditions]: state.conditions === undefined
            ? undefined
            : state.conditions.map(packASCondition),
        [AS_STATE_FIELD.heat]: state.heat,
        [AS_STATE_FIELD.armor]: state.armor,
        [AS_STATE_FIELD.internal]: state.internal,
        [AS_STATE_FIELD.criticals]: state.crits,
        [AS_STATE_FIELD.physicalCriticals]: state.pCrits,
        [AS_STATE_FIELD.consumed]: state.consumed,
        [AS_STATE_FIELD.exhausted]: state.exhausted,
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
        [AS_NETWORK_FIELD.instanceId]: packOpaqueId(network.id),
        [AS_NETWORK_FIELD.type]: network.type,
        [AS_NETWORK_FIELD.color]: network.color,
        [AS_NETWORK_FIELD.peerIds]: network.peerIds?.map(packOpaqueId),
        [AS_NETWORK_FIELD.masterId]: network.masterId === undefined
            ? undefined
            : packOpaqueId(network.masterId),
        [AS_NETWORK_FIELD.masterComponentIndex]: network.masterCompIndex,
        [AS_NETWORK_FIELD.members]: network.members?.map(packNetworkMember),
    }) as CompactASNetwork;
}

function unpackASForce(root: Record<string, unknown>, compact: Record<string, unknown>): ASSerializedForce {
    const forcePath = `force.${FORCE_PAYLOAD_FIELD.alphaStrike}`;
    exactKeys(root, [
        'version', 'timestamp', 'instanceId', 'type', 'name', 'note', 'tags',
        'factionId', 'factionLock', 'eraId', 'eraLock', 'bv', 'pv', 'owned',
        FORCE_PAYLOAD_FIELD.alphaStrike,
    ], 'force');
    if (root['version'] !== 2 || root['type'] !== GameSystem.AS) {
        throw new Error('Force does not match the current Alpha Strike schema');
    }
    exactKeys(compact, Object.values(AS_FORCE_FIELD), forcePath);
    if (compact[AS_FORCE_FIELD.formatVersion] !== COMPACT_AS_FORMAT_VERSION) {
        throw new Error('Unsupported compact Alpha Strike persistence format');
    }
    const groupsPath = `${forcePath}.${AS_FORCE_FIELD.groups}`;
    const groups = array(compact[AS_FORCE_FIELD.groups], groupsPath).map((value, index) =>
        unpackASGroup(value, `${groupsPath}[${index}]`));
    const networksPath = `${forcePath}.${AS_FORCE_FIELD.networks}`;
    const networks = compact[AS_FORCE_FIELD.networks] === undefined
        ? undefined
        : array(compact[AS_FORCE_FIELD.networks], networksPath).map((value, index) =>
            unpackASNetwork(value, `${networksPath}[${index}]`));
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
    exactKeys(group, Object.values(AS_GROUP_FIELD), path);
    const idField = AS_GROUP_FIELD.instanceId;
    const nameField = AS_GROUP_FIELD.name;
    const colorField = AS_GROUP_FIELD.color;
    const formationField = AS_GROUP_FIELD.formationId;
    const lockField = AS_GROUP_FIELD.formationLock;
    const targetField = AS_GROUP_FIELD.formationTargetGroupId;
    const unitsField = AS_GROUP_FIELD.units;
    return {
        id: unpackOpaqueId(text(group[idField], `${path}.${idField}`), `${path}.${idField}`),
        ...(group[nameField] === undefined
            ? {}
            : { name: text(group[nameField], `${path}.${nameField}`) }),
        ...(group[colorField] === undefined
            ? {}
            : { color: text(group[colorField], `${path}.${colorField}`) }),
        ...(group[formationField] === undefined
            ? {}
            : { formationId: text(group[formationField], `${path}.${formationField}`) }),
        ...(group[lockField] === undefined
            ? {}
            : { formationLock: truthyOne(group[lockField], `${path}.${lockField}`) }),
        ...(group[targetField] === undefined ? {} : {
            formationTargetGroupId: unpackOpaqueId(
                text(group[targetField], `${path}.${targetField}`),
                `${path}.${targetField}`,
            ),
        }),
        units: array(group[unitsField], `${path}.${unitsField}`).map((unit, index) =>
            unpackASUnit(unit, `${path}.${unitsField}[${index}]`)),
    };
}

function unpackASUnit(value: unknown, path: string): ASSerializedUnit {
    const unit = record(value, path);
    exactKeys(unit, Object.values(AS_UNIT_FIELD), path);
    const mutableState = unit[AS_UNIT_FIELD.state] === undefined
        ? {}
        : unpackASState(unit[AS_UNIT_FIELD.state], `${path}.${AS_UNIT_FIELD.state}`);
    const c3Position = unit[AS_UNIT_FIELD.c3Position] === undefined
        ? undefined
        : unpackC3Position(unit[AS_UNIT_FIELD.c3Position], `${path}.${AS_UNIT_FIELD.c3Position}`);
    return {
        id: unpackOpaqueId(
            text(unit[AS_UNIT_FIELD.instanceId], `${path}.${AS_UNIT_FIELD.instanceId}`),
            `${path}.${AS_UNIT_FIELD.instanceId}`,
        ),
        uuid: unpackUuid(
            text(unit[AS_UNIT_FIELD.catalogUuid], `${path}.${AS_UNIT_FIELD.catalogUuid}`),
            `${path}.${AS_UNIT_FIELD.catalogUuid}`,
        ),
        ...(unit[AS_UNIT_FIELD.sourceHashCanary] === undefined ? {} : {
            sourceHashCanary: unpackSourceHashCanary(
                unit[AS_UNIT_FIELD.sourceHashCanary],
                `${path}.${AS_UNIT_FIELD.sourceHashCanary}`,
            ),
        }),
        ...(unit[AS_UNIT_FIELD.alias] === undefined ? {} : {
            alias: text(unit[AS_UNIT_FIELD.alias], `${path}.${AS_UNIT_FIELD.alias}`),
        }),
        ...(unit[AS_UNIT_FIELD.updatedTimestamp] === undefined ? {} : {
            updatedTs: finiteNumber(
                unit[AS_UNIT_FIELD.updatedTimestamp],
                `${path}.${AS_UNIT_FIELD.updatedTimestamp}`,
            ),
        }),
        ...(unit[AS_UNIT_FIELD.skill] === undefined ? {} : {
            skill: finiteNumber(unit[AS_UNIT_FIELD.skill], `${path}.${AS_UNIT_FIELD.skill}`),
        }),
        ...(unit[AS_UNIT_FIELD.abilities] === undefined ? {} : {
            abilities: clone(array(
                unit[AS_UNIT_FIELD.abilities],
                `${path}.${AS_UNIT_FIELD.abilities}`,
            )) as ASSerializedUnit['abilities'],
        }),
        ...(unit[AS_UNIT_FIELD.formationAbilities] === undefined ? {} : {
            formationAbilities: unpackTextArray(
                unit[AS_UNIT_FIELD.formationAbilities],
                `${path}.${AS_UNIT_FIELD.formationAbilities}`,
            ),
        }),
        ...(unit[AS_UNIT_FIELD.commander] === undefined ? {} : {
            commander: truthyOne(
                unit[AS_UNIT_FIELD.commander],
                `${path}.${AS_UNIT_FIELD.commander}`,
            ),
        }),
        ...(unit[AS_UNIT_FIELD.state] === undefined && c3Position === undefined
            ? {}
            : { state: { ...mutableState, ...(c3Position === undefined ? {} : { c3Position }) } }),
    };
}

function unpackASState(value: unknown, path: string): ASSerializedState {
    const state = record(value, path);
    exactKeys(state, Object.values(AS_STATE_FIELD), path);
    return {
        ...(state[AS_STATE_FIELD.modified] === undefined ? {} : {
            modified: truthyOne(
                state[AS_STATE_FIELD.modified],
                `${path}.${AS_STATE_FIELD.modified}`,
            ),
        }),
        ...(state[AS_STATE_FIELD.destroyed] === undefined ? {} : {
            destroyed: truthyOne(
                state[AS_STATE_FIELD.destroyed],
                `${path}.${AS_STATE_FIELD.destroyed}`,
            ),
        }),
        ...(state[AS_STATE_FIELD.conditions] === undefined ? {} : {
            conditions: array(
                state[AS_STATE_FIELD.conditions],
                `${path}.${AS_STATE_FIELD.conditions}`,
            ).map((condition, index) => unpackASCondition(
                condition,
                `${path}.${AS_STATE_FIELD.conditions}[${index}]`,
            )),
        }),
        ...(state[AS_STATE_FIELD.heat] === undefined ? {} : {
            heat: unpackASPair(state[AS_STATE_FIELD.heat], `${path}.${AS_STATE_FIELD.heat}`),
        }),
        ...(state[AS_STATE_FIELD.armor] === undefined ? {} : {
            armor: unpackASPair(state[AS_STATE_FIELD.armor], `${path}.${AS_STATE_FIELD.armor}`),
        }),
        ...(state[AS_STATE_FIELD.internal] === undefined ? {} : {
            internal: unpackASPair(
                state[AS_STATE_FIELD.internal],
                `${path}.${AS_STATE_FIELD.internal}`,
            ),
        }),
        ...(state[AS_STATE_FIELD.criticals] === undefined ? {} : {
            crits: unpackASCriticalRows(
                state[AS_STATE_FIELD.criticals],
                `${path}.${AS_STATE_FIELD.criticals}`,
            ),
        }),
        ...(state[AS_STATE_FIELD.physicalCriticals] === undefined ? {} : {
            pCrits: unpackASCriticalRows(
                state[AS_STATE_FIELD.physicalCriticals],
                `${path}.${AS_STATE_FIELD.physicalCriticals}`,
            ),
        }),
        ...(state[AS_STATE_FIELD.consumed] === undefined ? {} : {
            consumed: unpackASConsumed(
                state[AS_STATE_FIELD.consumed],
                `${path}.${AS_STATE_FIELD.consumed}`,
            ),
        }),
        ...(state[AS_STATE_FIELD.exhausted] === undefined ? {} : {
            exhausted: unpackASExhausted(
                state[AS_STATE_FIELD.exhausted],
                `${path}.${AS_STATE_FIELD.exhausted}`,
            ),
        }),
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

function unpackC3Position(value: unknown, path: string): { x: number; y: number } {
    const row = array(value, path);
    if (row.length !== 2) throw new Error(`${path} is not a C3 position`);
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
    exactKeys(network, Object.values(AS_NETWORK_FIELD), path);
    return {
        id: unpackOpaqueId(
            text(network[AS_NETWORK_FIELD.instanceId], `${path}.${AS_NETWORK_FIELD.instanceId}`),
            `${path}.${AS_NETWORK_FIELD.instanceId}`,
        ),
        type: text(
            network[AS_NETWORK_FIELD.type],
            `${path}.${AS_NETWORK_FIELD.type}`,
        ) as SerializedC3NetworkGroup['type'],
        color: text(network[AS_NETWORK_FIELD.color], `${path}.${AS_NETWORK_FIELD.color}`),
        ...(network[AS_NETWORK_FIELD.peerIds] === undefined ? {} : {
            peerIds: unpackTextArray(
                network[AS_NETWORK_FIELD.peerIds],
                `${path}.${AS_NETWORK_FIELD.peerIds}`,
            ).map((id, index) => unpackOpaqueId(
                id,
                `${path}.${AS_NETWORK_FIELD.peerIds}[${index}]`,
            )),
        }),
        ...(network[AS_NETWORK_FIELD.masterId] === undefined ? {} : {
            masterId: unpackOpaqueId(
                text(network[AS_NETWORK_FIELD.masterId], `${path}.${AS_NETWORK_FIELD.masterId}`),
                `${path}.${AS_NETWORK_FIELD.masterId}`,
            ),
        }),
        ...(network[AS_NETWORK_FIELD.masterComponentIndex] === undefined ? {} : {
            masterCompIndex: integer(
                network[AS_NETWORK_FIELD.masterComponentIndex],
                `${path}.${AS_NETWORK_FIELD.masterComponentIndex}`,
            ),
        }),
        ...(network[AS_NETWORK_FIELD.members] === undefined ? {} : {
            members: unpackTextArray(
                network[AS_NETWORK_FIELD.members],
                `${path}.${AS_NETWORK_FIELD.members}`,
            ).map((member, index) => unpackNetworkMember(
                member,
                `${path}.${AS_NETWORK_FIELD.members}[${index}]`,
            )),
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
        'factionId', 'factionLock', 'eraId', 'eraLock', 'bv', 'pv', 'owned',
        FORCE_PAYLOAD_FIELD.classicBattleTech,
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
    const historyEmpty = force.history[CBT_HISTORY_FIELD.unitIds].length === 0
        && force.history[CBT_HISTORY_FIELD.turns].length === 0;
    const encounterEmpty = force.encounter.networks.length === 0;
    const c3Positions = new Map(
        (force.encounter.c3Positions ?? []).map(position => [position.unitId, position] as const),
    );
    return Object.freeze({
        [CBT_FORCE_FIELD.formatVersion]: COMPACT_FORCE_FORMAT_VERSION,
        [CBT_FORCE_FIELD.revision]: force.forceRevision,
        [CBT_FORCE_FIELD.units]: Object.freeze(force.units.map(entry =>
            packUnitEntry(entry, c3Positions.get(entry.instanceId)))),
        [CBT_FORCE_FIELD.groups]: packRoster(force.roster, force.units),
        ...(historyEmpty ? {} : { [CBT_FORCE_FIELD.history]: packHistory(force.history) }),
        ...(encounterEmpty ? {} : {
            [CBT_FORCE_FIELD.encounter]: packEncounter(force.encounter, force.units),
        }),
    });
}

function unpackForce(value: Record<string, unknown>, forceId: string): SerializedCBTForceV2 {
    const forcePath = `force.${FORCE_PAYLOAD_FIELD.classicBattleTech}`;
    exactKeys(value, Object.values(CBT_FORCE_FIELD), forcePath);
    if (value[CBT_FORCE_FIELD.formatVersion] !== COMPACT_FORCE_FORMAT_VERSION) {
        throw new Error('Unsupported compact CBT persistence format');
    }
    const revision = integer(
        value[CBT_FORCE_FIELD.revision],
        `${forcePath}.${CBT_FORCE_FIELD.revision}`,
    );
    const unitsPath = `${forcePath}.${CBT_FORCE_FIELD.units}`;
    const compactUnits = array(value[CBT_FORCE_FIELD.units], unitsPath);
    const units = compactUnits.map((entry, index) =>
        unpackUnitEntry(entry, `${unitsPath}[${index}]`));
    const c3Positions = compactUnits.flatMap((entry, index): C3UnitPosition[] => {
        const unitPath = `${unitsPath}[${index}]`;
        const compactUnit = record(entry, unitPath);
        if (compactUnit[CBT_UNIT_FIELD.c3Position] === undefined) return [];
        return [{
            unitId: units[index]!.instanceId,
            ...unpackC3Position(
                compactUnit[CBT_UNIT_FIELD.c3Position],
                `${unitPath}.${CBT_UNIT_FIELD.c3Position}`,
            ),
        }];
    }).sort((left, right) => left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0);
    const unpackedEncounter = value[CBT_FORCE_FIELD.encounter] === undefined
        ? emptyEncounter()
        : unpackEncounter(
            value[CBT_FORCE_FIELD.encounter],
            `${forcePath}.${CBT_FORCE_FIELD.encounter}`,
            units,
        );
    const encounter = c3Positions.length === 0 ? unpackedEncounter : {
        ...unpackedEncounter,
        c3Positions,
    };
    return {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        forceId: asForceId(forceId),
        forceRevision: revision,
        history: value[CBT_FORCE_FIELD.history] === undefined
            ? {
                [CBT_HISTORY_FIELD.unitIds]: [],
                [CBT_HISTORY_FIELD.turns]: [],
            }
            : unpackHistory(
                value[CBT_FORCE_FIELD.history],
                `${forcePath}.${CBT_FORCE_FIELD.history}`,
            ),
        units,
        roster: unpackRoster(value[CBT_FORCE_FIELD.groups], units),
        encounter,
    };
}

function packHistory(history: SerializedCBTForceV2['history']): SerializedCBTForceV2['history'] {
    return Object.freeze({
        [CBT_HISTORY_FIELD.unitIds]: Object.freeze(
            history[CBT_HISTORY_FIELD.unitIds].map(packOpaqueId),
        ),
        [CBT_HISTORY_FIELD.turns]: clone(history[CBT_HISTORY_FIELD.turns]),
    });
}

function unpackHistory(value: unknown, path: string): SerializedCBTForceV2['history'] {
    const history = record(value, path);
    exactKeys(history, Object.values(CBT_HISTORY_FIELD), path);
    const unitIdsPath = `${path}.${CBT_HISTORY_FIELD.unitIds}`;
    return {
        [CBT_HISTORY_FIELD.unitIds]: array(
            history[CBT_HISTORY_FIELD.unitIds],
            unitIdsPath,
        ).map((raw, index) =>
            unpackOpaqueId(text(raw, `${unitIdsPath}[${index}]`), `${unitIdsPath}[${index}]`)),
        [CBT_HISTORY_FIELD.turns]: clone(array(
            history[CBT_HISTORY_FIELD.turns],
            `${path}.${CBT_HISTORY_FIELD.turns}`,
        )) as SerializedCBTForceV2['history'][typeof CBT_HISTORY_FIELD.turns],
    };
}

function packUnitEntry(entry: SerializedForceUnitEntryV2, c3Position: C3UnitPosition | undefined): unknown {
    return packUnit(entry.unit, c3Position);
}

function unpackUnitEntry(value: unknown, path: string): SerializedForceUnitEntryV2 {
    const unit = unpackUnit(value, path);
    return {
        instanceId: unit.instanceId,
        stateRevision: unit.stateRevision,
        unit,
    };
}

function packUnit(
    unit: SerializedCBTUnitV2 | SerializedNonMekUnit,
    c3Position: C3UnitPosition | undefined,
): unknown {
    return isSerializedNonMekUnit(unit)
        ? packNonMekUnit(unit, c3Position)
        : packMekUnit(unit, c3Position);
}

function unpackUnit(value: unknown, path: string): SerializedCBTUnitV2 | SerializedNonMekUnit {
    const compact = record(value, path);
    return compact[CBT_UNIT_FIELD.family] === undefined
        || compact[CBT_UNIT_FIELD.family] === CBT_UNIT_FAMILY.mek
        ? unpackMekUnit(compact, path)
        : compact[CBT_UNIT_FIELD.family] === CBT_UNIT_FAMILY.nonMekEntity
            ? unpackNonMekUnit(compact, path)
            : fail(`${path}.${CBT_UNIT_FIELD.family} is not a current unit family`);
}

function packMekUnit(unit: SerializedCBTUnitV2, c3Position: C3UnitPosition | undefined): unknown {
    const pristineHeat = unit.deployment.values.initialHeat ?? 0;
    const heatIsPristine = unit.heat?.heat === pristineHeat
        && unit.heat.previous === undefined
        && unit.heat.pendingOverride === undefined
        && unit.heat.heatsinksOff === undefined;
    return compactObject({
        [CBT_UNIT_FIELD.instanceId]: packOpaqueId(unit.instanceId),
        [CBT_UNIT_FIELD.catalogUuid]: packUnitUuid(unit.entity),
        [CBT_UNIT_FIELD.sourceHashCanary]: unit.sourceHashCanary,
        [CBT_UNIT_FIELD.deployment]: packDeployment(unit.deployment.values),
        [CBT_UNIT_FIELD.stateRevision]: unit.stateRevision === 0 ? undefined : unit.stateRevision,
        [CBT_UNIT_FIELD.destroyed]: unit.destroyed ? 1 : undefined,
        [CBT_UNIT_FIELD.locationState]: packRows(
            unit.locationState,
            row => [row.target, row.damage],
        ),
        [CBT_UNIT_FIELD.locationConditions]: packRows(
            unit.locationConditions,
            row => [row.target, row.condition, row.value],
        ),
        [CBT_UNIT_FIELD.slotState]: packRows(
            unit.slotState,
            row => tuple(row.target, row.hits, row.destroyedTurn),
        ),
        [CBT_UNIT_FIELD.componentState]: packRows(unit.componentState, packComponentState),
        [CBT_UNIT_FIELD.ammoState]: packRows(
            unit.ammoState,
            row => tuple(row.target, row.shotsSpent, row.munitionOverride),
        ),
        [CBT_UNIT_FIELD.crewState]: packRows(unit.crew.positions, row => tuple(
            row.target,
            row.wounds,
            packCrewState(row),
            row.recoveryReadyTurn,
        )),
        [CBT_UNIT_FIELD.heat]: heatIsPristine ? undefined : packHeat(unit.heat),
        [CBT_UNIT_FIELD.ruleChecks]: unit.ruleChecks.entries.length === 0
            ? undefined
            : unit.ruleChecks.entries.map(row => [
                row.key, row.token, row.trigger, row.openedRevision, row.status,
            ]),
        [CBT_UNIT_FIELD.movementPsr]: packMovement(unit.movementPsr),
        [CBT_UNIT_FIELD.equipmentRowOrder]: packEquipmentRowOrder(unit.equipmentRowOrder),
        [CBT_UNIT_FIELD.conditions]: unit.conditions?.values.length
            ? unit.conditions.values
            : undefined,
        [CBT_UNIT_FIELD.c3Position]: c3Position === undefined
            ? undefined
            : [c3Position.x, c3Position.y],
        [CBT_UNIT_FIELD.mekTurn]: packTurn(unit.turn),
        [CBT_UNIT_FIELD.pendingCombat]: packPending(unit.pendingCombat),
    });
}

function unpackMekUnit(value: Record<string, unknown>, path: string): SerializedCBTUnitV2 {
    exactKeys(value, CBT_MEK_UNIT_FIELDS, path);
    const entity = unpackUnitUuid(
        value[CBT_UNIT_FIELD.catalogUuid],
        `${path}.${CBT_UNIT_FIELD.catalogUuid}`,
    );
    const baseline = defaultBaseline(
        entity, UNIT_STATE_INITIALIZER_REVISION, DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    );
    const deployment = unpackDeployment(
        value[CBT_UNIT_FIELD.deployment],
        `${path}.${CBT_UNIT_FIELD.deployment}`,
    );
    const pristineHeat = deployment.values.initialHeat ?? 0;
    return {
        schemaVersion: CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: unpackOpaqueId(
            text(value[CBT_UNIT_FIELD.instanceId], `${path}.${CBT_UNIT_FIELD.instanceId}`),
            `${path}.${CBT_UNIT_FIELD.instanceId}`,
        ),
        entity,
        ...(value[CBT_UNIT_FIELD.sourceHashCanary] === undefined ? {} : {
            sourceHashCanary: unpackSourceHashCanary(
                value[CBT_UNIT_FIELD.sourceHashCanary],
                `${path}.${CBT_UNIT_FIELD.sourceHashCanary}`,
            ),
        }),
        baselineRefAtSave: baseline,
        // BaseEntity topology is rebuilt after the exact native source is loaded.
        // The storage wire never carries a copied blueprint reference catalog.
        blueprintReferences: { schemaVersion: 1, targets: {} },
        deployment,
        stateRevision: value[CBT_UNIT_FIELD.stateRevision] === undefined
            ? 0
            : integer(
                value[CBT_UNIT_FIELD.stateRevision],
                `${path}.${CBT_UNIT_FIELD.stateRevision}`,
            ),
        ...(value[CBT_UNIT_FIELD.destroyed] === undefined ? {} : {
            destroyed: truthyOne(
                value[CBT_UNIT_FIELD.destroyed],
                `${path}.${CBT_UNIT_FIELD.destroyed}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.locationState] === undefined ? {} : {
            locationState: unpackRows(
                value[CBT_UNIT_FIELD.locationState],
                `${path}.${CBT_UNIT_FIELD.locationState}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
                }),
            ),
        }),
        ...(value[CBT_UNIT_FIELD.locationConditions] === undefined ? {} : {
            locationConditions: unpackRows(
                value[CBT_UNIT_FIELD.locationConditions],
                `${path}.${CBT_UNIT_FIELD.locationConditions}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                condition: unpackMekLocationCondition(row[1], `${rowPath}[1]`),
                value: rowInteger(row, 2, rowPath),
                }),
            ),
        }),
        ...(value[CBT_UNIT_FIELD.slotState] === undefined ? {} : {
            slotState: unpackRows(
                value[CBT_UNIT_FIELD.slotState],
                `${path}.${CBT_UNIT_FIELD.slotState}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                hits: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { destroyedTurn: rowInteger(row, 2, rowPath) }),
                }),
            ),
        }),
        ...(value[CBT_UNIT_FIELD.componentState] === undefined ? {} : {
            componentState: unpackRows(
                value[CBT_UNIT_FIELD.componentState],
                `${path}.${CBT_UNIT_FIELD.componentState}`,
                unpackComponentState,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.ammoState] === undefined ? {} : {
            ammoState: unpackRows(
                value[CBT_UNIT_FIELD.ammoState],
                `${path}.${CBT_UNIT_FIELD.ammoState}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                shotsSpent: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { munitionOverride: rowText(row, 2, rowPath) }),
                }),
            ),
        }),
        crew: {
            schemaVersion: 1,
            positions: value[CBT_UNIT_FIELD.crewState] === undefined ? [] : unpackRows(
                value[CBT_UNIT_FIELD.crewState],
                `${path}.${CBT_UNIT_FIELD.crewState}`,
                (row, rowPath) => {
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
                },
            ),
        },
        heat: value[CBT_UNIT_FIELD.heat] === undefined
            ? { heat: pristineHeat }
            : unpackHeat(value[CBT_UNIT_FIELD.heat], `${path}.${CBT_UNIT_FIELD.heat}`),
        family: { kind: 'mek' },
        ruleChecks: {
            schemaVersion: 1,
            entries: value[CBT_UNIT_FIELD.ruleChecks] === undefined ? [] : unpackRows(
                value[CBT_UNIT_FIELD.ruleChecks],
                `${path}.${CBT_UNIT_FIELD.ruleChecks}`,
                (row, rowPath) => ({
                key: unpackMekRuleCheckKey(row[0], `${rowPath}[0]`),
                token: asMekRuleCheckTokenV2(rowText(row, 1, rowPath)),
                trigger: asSavedTargetRef(rowText(row, 2, rowPath)),
                openedRevision: rowInteger(row, 3, rowPath),
                status: unpackMekRuleCheckStatus(row[4], `${rowPath}[4]`),
                }),
            ),
        },
        movementPsr: unpackMovement(
            value[CBT_UNIT_FIELD.movementPsr],
            `${path}.${CBT_UNIT_FIELD.movementPsr}`,
        ),
        ...(value[CBT_UNIT_FIELD.equipmentRowOrder] === undefined ? {} : {
            equipmentRowOrder: unpackEquipmentRowOrder(
                value[CBT_UNIT_FIELD.equipmentRowOrder],
                `${path}.${CBT_UNIT_FIELD.equipmentRowOrder}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.conditions] === undefined ? {} : {
            conditions: {
                values: unpackUnitConditions(
                    value[CBT_UNIT_FIELD.conditions],
                    `${path}.${CBT_UNIT_FIELD.conditions}`,
                ),
            },
        }),
        turn: unpackTurn(value[CBT_UNIT_FIELD.mekTurn], `${path}.${CBT_UNIT_FIELD.mekTurn}`),
        ...(value[CBT_UNIT_FIELD.pendingCombat] === undefined ? {} : {
            pendingCombat: unpackPending(
                value[CBT_UNIT_FIELD.pendingCombat],
                `${path}.${CBT_UNIT_FIELD.pendingCombat}`,
            ),
        }),
    };
}

function packNonMekUnit(unit: SerializedNonMekUnit, c3Position: C3UnitPosition | undefined): unknown {
    return compactObject({
        [CBT_UNIT_FIELD.family]: CBT_UNIT_FAMILY.nonMekEntity,
        [CBT_UNIT_FIELD.entityType]: unit.family.entityType,
        [CBT_UNIT_FIELD.instanceId]: packOpaqueId(unit.instanceId),
        [CBT_UNIT_FIELD.catalogUuid]: packUnitUuid(unit.entity),
        [CBT_UNIT_FIELD.sourceHashCanary]: unit.sourceHashCanary,
        [CBT_UNIT_FIELD.deployment]: packDeployment(unit.deployment.values),
        [CBT_UNIT_FIELD.stateRevision]: unit.stateRevision === 0 ? undefined : unit.stateRevision,
        [CBT_UNIT_FIELD.destroyed]: unit.destroyed ? 1 : undefined,
        [CBT_UNIT_FIELD.locationState]: packRows(unit.locationState, row => tuple(
            row.locationId,
            row.internalDamage ?? 0,
            row.armorDamage?.map(armor => [armor.faceId, armor.damage]),
        )),
        [CBT_UNIT_FIELD.componentState]: packRows(unit.componentState, row => [
            row.componentId,
            compactObject({
            [CBT_COMPONENT_STATE_FIELD.status]: row.status,
            [CBT_COMPONENT_STATE_FIELD.mode]: row.mode,
            [CBT_COMPONENT_STATE_FIELD.jammed]: row.jammed ? 1 : undefined,
            [CBT_COMPONENT_STATE_FIELD.escalatingFailure]: row.escalatingFailure
                && [row.escalatingFailure.sequence, row.escalatingFailure.active ? 1 : 0],
            }),
        ]),
        [CBT_UNIT_FIELD.damageTrackState]: packRows(
            unit.damageTrackState,
            row => [row.damageTrackId, row.hits, row.hitTimestamps],
        ),
        [CBT_UNIT_FIELD.ammoState]: packRows(
            unit.ammoState,
            row => tuple(row.componentId, row.shotsSpent, row.munitionOverride),
        ),
        [CBT_UNIT_FIELD.crewState]: packRows(unit.crewState, row => tuple(
            row.positionId,
            row.wounds,
            packCrewState(row),
            row.recoveryReadyTurn,
        )),
        [CBT_UNIT_FIELD.conditions]: unit.conditions?.length ? unit.conditions : undefined,
        [CBT_UNIT_FIELD.heat]: packNonMekHeat(unit.heat),
        [CBT_UNIT_FIELD.nonMekTurn]: packNonMekTurn(unit.turn),
        [CBT_UNIT_FIELD.equipmentRowOrder]: packEquipmentRowOrder(unit.equipmentRowOrder),
        [CBT_UNIT_FIELD.c3Position]: c3Position === undefined
            ? undefined
            : [c3Position.x, c3Position.y],
        [CBT_UNIT_FIELD.pendingCombat]: packNonMekPending(unit.pendingCombat),
    });
}

function unpackNonMekUnit(value: Record<string, unknown>, path: string): SerializedNonMekUnit {
    exactKeys(value, CBT_NON_MEK_UNIT_FIELDS, path);
    const entity = unpackUnitUuid(
        value[CBT_UNIT_FIELD.catalogUuid],
        `${path}.${CBT_UNIT_FIELD.catalogUuid}`,
    );
    const baseline = defaultBaseline(entity, 1, DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID);
    const deployment = unpackNonMekDeployment(
        value[CBT_UNIT_FIELD.deployment],
        `${path}.${CBT_UNIT_FIELD.deployment}`,
    );
    return {
        schemaVersion: NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: unpackOpaqueId(
            text(value[CBT_UNIT_FIELD.instanceId], `${path}.${CBT_UNIT_FIELD.instanceId}`),
            `${path}.${CBT_UNIT_FIELD.instanceId}`,
        ),
        entity,
        ...(value[CBT_UNIT_FIELD.sourceHashCanary] === undefined ? {} : {
            sourceHashCanary: unpackSourceHashCanary(
                value[CBT_UNIT_FIELD.sourceHashCanary],
                `${path}.${CBT_UNIT_FIELD.sourceHashCanary}`,
            ),
        }),
        baselineRefAtSave: baseline,
        deployment,
        family: {
            kind: 'non-mek',
            entityType: unpackNonMekEntityType(
                value[CBT_UNIT_FIELD.entityType],
                `${path}.${CBT_UNIT_FIELD.entityType}`,
            ),
        },
        stateRevision: value[CBT_UNIT_FIELD.stateRevision] === undefined
            ? 0
            : integer(
                value[CBT_UNIT_FIELD.stateRevision],
                `${path}.${CBT_UNIT_FIELD.stateRevision}`,
            ),
        ...(value[CBT_UNIT_FIELD.destroyed] === undefined ? {} : {
            destroyed: truthyOne(
                value[CBT_UNIT_FIELD.destroyed],
                `${path}.${CBT_UNIT_FIELD.destroyed}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.locationState] === undefined ? {} : {
            locationState: unpackRows(
                value[CBT_UNIT_FIELD.locationState],
                `${path}.${CBT_UNIT_FIELD.locationState}`,
                (row, rowPath) => ({
                locationId: asLocationId(rowText(row, 0, rowPath)),
                ...(rowInteger(row, 1, rowPath) === 0 ? {} : { internalDamage: rowInteger(row, 1, rowPath) }),
                ...(row[2] === undefined ? {} : {
                    armorDamage: unpackRows(row[2], `${rowPath}[2]`, (armor, armorPath) => ({
                        faceId: asArmorFaceId(rowText(armor, 0, armorPath)),
                        damage: rowInteger(armor, 1, armorPath),
                    })),
                }),
                }),
            ),
        }),
        ...(value[CBT_UNIT_FIELD.componentState] === undefined ? {} : {
            componentState: unpackRows(
                value[CBT_UNIT_FIELD.componentState],
                `${path}.${CBT_UNIT_FIELD.componentState}`,
                (row, rowPath) => {
                const state = record(row[1], `${rowPath}[1]`);
                const nonMekFields = [
                    CBT_COMPONENT_STATE_FIELD.status,
                    CBT_COMPONENT_STATE_FIELD.mode,
                    CBT_COMPONENT_STATE_FIELD.jammed,
                    CBT_COMPONENT_STATE_FIELD.escalatingFailure,
                ];
                exactKeys(state, nonMekFields, `${rowPath}[1]`);
                const escalating = state[CBT_COMPONENT_STATE_FIELD.escalatingFailure] === undefined
                    ? undefined
                    : array(
                        state[CBT_COMPONENT_STATE_FIELD.escalatingFailure],
                        `${rowPath}[1].${CBT_COMPONENT_STATE_FIELD.escalatingFailure}`,
                    );
                return {
                    componentId: asComponentId(rowText(row, 0, rowPath)),
                    ...(state[CBT_COMPONENT_STATE_FIELD.status] === undefined ? {} : {
                        status: unpackUnavailableEquipmentStatus(
                            state[CBT_COMPONENT_STATE_FIELD.status],
                            `${rowPath}[1].${CBT_COMPONENT_STATE_FIELD.status}`,
                        ),
                    }),
                    ...(state[CBT_COMPONENT_STATE_FIELD.mode] === undefined ? {} : {
                        mode: text(
                            state[CBT_COMPONENT_STATE_FIELD.mode],
                            `${rowPath}[1].${CBT_COMPONENT_STATE_FIELD.mode}`,
                        ),
                    }),
                    ...(state[CBT_COMPONENT_STATE_FIELD.jammed] === undefined ? {} : {
                        jammed: truthyOne(
                            state[CBT_COMPONENT_STATE_FIELD.jammed],
                            `${rowPath}[1].${CBT_COMPONENT_STATE_FIELD.jammed}`,
                        ),
                    }),
                    ...(escalating === undefined ? {} : {
                        escalatingFailure: {
                            sequence: rowInteger(
                                escalating,
                                0,
                                `${rowPath}[1].${CBT_COMPONENT_STATE_FIELD.escalatingFailure}`,
                            ),
                            ...(rowBit(
                                escalating,
                                1,
                                `${rowPath}[1].${CBT_COMPONENT_STATE_FIELD.escalatingFailure}`,
                            )
                                ? { active: true as const }
                                : {}),
                        },
                    }),
                };
                },
            ),
        }),
        ...(value[CBT_UNIT_FIELD.damageTrackState] === undefined ? {} : {
            damageTrackState: unpackRows(
                value[CBT_UNIT_FIELD.damageTrackState],
                `${path}.${CBT_UNIT_FIELD.damageTrackState}`,
                (row, rowPath) => ({
                damageTrackId: asSystemDamageTrackId(rowText(row, 0, rowPath)),
                hits: rowInteger(row, 1, rowPath),
                hitTimestamps: unpackIntegerArray(row[2], `${rowPath}[2]`),
                }),
            ),
        }),
        ...(value[CBT_UNIT_FIELD.ammoState] === undefined ? {} : {
            ammoState: unpackRows(
                value[CBT_UNIT_FIELD.ammoState],
                `${path}.${CBT_UNIT_FIELD.ammoState}`,
                (row, rowPath) => ({
                componentId: asComponentId(rowText(row, 0, rowPath)),
                shotsSpent: rowInteger(row, 1, rowPath),
                ...(row[2] === undefined ? {} : { munitionOverride: rowText(row, 2, rowPath) }),
                }),
            ),
        }),
        ...(value[CBT_UNIT_FIELD.crewState] === undefined ? {} : {
            crewState: unpackRows(
                value[CBT_UNIT_FIELD.crewState],
                `${path}.${CBT_UNIT_FIELD.crewState}`,
                unpackNonMekCrewState,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.conditions] === undefined ? {} : {
            conditions: unpackUnitConditions(
                value[CBT_UNIT_FIELD.conditions],
                `${path}.${CBT_UNIT_FIELD.conditions}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.heat] === undefined ? {} : {
            heat: unpackNonMekHeat(
                value[CBT_UNIT_FIELD.heat],
                `${path}.${CBT_UNIT_FIELD.heat}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.nonMekTurn] === undefined ? {} : {
            turn: unpackNonMekTurn(
                value[CBT_UNIT_FIELD.nonMekTurn],
                `${path}.${CBT_UNIT_FIELD.nonMekTurn}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.equipmentRowOrder] === undefined ? {} : {
            equipmentRowOrder: unpackEquipmentRowOrder(
                value[CBT_UNIT_FIELD.equipmentRowOrder],
                `${path}.${CBT_UNIT_FIELD.equipmentRowOrder}`,
            ),
        }),
        ...(value[CBT_UNIT_FIELD.pendingCombat] === undefined ? {} : {
            pendingCombat: unpackNonMekPending(
                value[CBT_UNIT_FIELD.pendingCombat],
                `${path}.${CBT_UNIT_FIELD.pendingCombat}`,
            ),
        }),
    };
}

function packEquipmentRowOrder(value: EquipmentRowOrderState | undefined): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        [CBT_EQUIPMENT_ROW_ORDER_FIELD.ranged]: value.ranged,
        [CBT_EQUIPMENT_ROW_ORDER_FIELD.physical]: value.physical,
    });
}

function unpackEquipmentRowOrder(value: unknown, path: string): EquipmentRowOrderState {
    const order = record(value, path);
    exactKeys(order, Object.values(CBT_EQUIPMENT_ROW_ORDER_FIELD), path);
    const read = (key: typeof CBT_EQUIPMENT_ROW_ORDER_FIELD[keyof typeof CBT_EQUIPMENT_ROW_ORDER_FIELD]): readonly number[] | undefined => order[key] === undefined
        ? undefined
        : Object.freeze(array(order[key], `${path}.${key}`).map((entry, index) =>
            integer(entry, `${path}.${key}[${index}]`)));
    const ranged = read(CBT_EQUIPMENT_ROW_ORDER_FIELD.ranged);
    const physical = read(CBT_EQUIPMENT_ROW_ORDER_FIELD.physical);
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
        [CBT_DEPLOYMENT_METADATA_FIELD.id]: values.id === DEFAULT_FORCE_DEPLOYMENT_ID
            ? undefined
            : values.id,
        [CBT_DEPLOYMENT_METADATA_FIELD.initialHeat]: values.initialHeat,
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
    exactKeys(metadata, Object.values(CBT_DEPLOYMENT_METADATA_FIELD), `${path}[1]`);
    return {
        id: metadata[CBT_DEPLOYMENT_METADATA_FIELD.id] === undefined
            ? DEFAULT_FORCE_DEPLOYMENT_ID
            : text(
                metadata[CBT_DEPLOYMENT_METADATA_FIELD.id],
                `${path}[1].${CBT_DEPLOYMENT_METADATA_FIELD.id}`,
            ),
        ...(metadata[CBT_DEPLOYMENT_METADATA_FIELD.initialHeat] === undefined ? {} : {
            initialHeat: integer(
                metadata[CBT_DEPLOYMENT_METADATA_FIELD.initialHeat],
                `${path}[1].${CBT_DEPLOYMENT_METADATA_FIELD.initialHeat}`,
            ),
        }),
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
        [CBT_COMPONENT_STATE_FIELD.status]: row.statusOverride,
        [CBT_COMPONENT_STATE_FIELD.mode]: row.mode,
        [CBT_COMPONENT_STATE_FIELD.jammed]: row.jammed ? 1 : undefined,
        [CBT_COMPONENT_STATE_FIELD.escalatingFailure]: row.escalatingFailure
            && [row.escalatingFailure.sequence, row.escalatingFailure.active ? 1 : 0],
        [CBT_COMPONENT_STATE_FIELD.ppcCapacitor]: row.ppcCapacitor && compactObject({
            [CBT_PPC_CAPACITOR_FIELD.weaponId]: row.ppcCapacitor.weaponId,
            [CBT_PPC_CAPACITOR_FIELD.chargeState]: row.ppcCapacitor.chargeState,
            [CBT_PPC_CAPACITOR_FIELD.firedThisTurn]: row.ppcCapacitor.firedThisTurn
                ? 1
                : undefined,
        }),
        [CBT_COMPONENT_STATE_FIELD.bombastLaser]: row.bombastLaser && compactObject({
            [CBT_BOMBAST_LASER_FIELD.chargeState]: row.bombastLaser.chargeState,
            [CBT_BOMBAST_LASER_FIELD.firedThisTurn]: row.bombastLaser.firedThisTurn
                ? 1
                : undefined,
        }),
        [CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster]: row.c3EmergencyMaster && compactObject({
            [CBT_C3_EMERGENCY_MASTER_FIELD.mode]: row.c3EmergencyMaster.mode,
            [CBT_C3_EMERGENCY_MASTER_FIELD.operatingTurns]: row.c3EmergencyMaster.operatingTurns,
        }),
        [CBT_COMPONENT_STATE_FIELD.gaussPower]: row.gaussPower,
        [CBT_COMPONENT_STATE_FIELD.shieldDamage]: row.shieldDamage
            && [row.shieldDamage.absorptionDamage, row.shieldDamage.capacityDamage],
        [CBT_COMPONENT_STATE_FIELD.modularArmorDamage]: row.modularArmorDamage,
    })];
}

function unpackComponentState(row: readonly unknown[], path: string): NonNullable<SerializedCBTUnitV2['componentState']>[number] {
    const state = record(row[1], `${path}[1]`);
    exactKeys(state, Object.values(CBT_COMPONENT_STATE_FIELD), `${path}[1]`);
    const escalating = state[CBT_COMPONENT_STATE_FIELD.escalatingFailure] === undefined
        ? undefined
        : array(
            state[CBT_COMPONENT_STATE_FIELD.escalatingFailure],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.escalatingFailure}`,
        );
    const ppc = state[CBT_COMPONENT_STATE_FIELD.ppcCapacitor] === undefined
        ? undefined
        : record(
            state[CBT_COMPONENT_STATE_FIELD.ppcCapacitor],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.ppcCapacitor}`,
        );
    const bombast = state[CBT_COMPONENT_STATE_FIELD.bombastLaser] === undefined
        ? undefined
        : record(
            state[CBT_COMPONENT_STATE_FIELD.bombastLaser],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.bombastLaser}`,
        );
    const emergency = state[CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster] === undefined
        ? undefined
        : record(
            state[CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster}`,
        );
    const shield = state[CBT_COMPONENT_STATE_FIELD.shieldDamage] === undefined
        ? undefined
        : array(
            state[CBT_COMPONENT_STATE_FIELD.shieldDamage],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.shieldDamage}`,
        );
    if (ppc !== undefined) {
        exactKeys(ppc, Object.values(CBT_PPC_CAPACITOR_FIELD), `${path}[1].${CBT_COMPONENT_STATE_FIELD.ppcCapacitor}`);
    }
    if (bombast !== undefined) {
        exactKeys(
            bombast,
            Object.values(CBT_BOMBAST_LASER_FIELD),
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.bombastLaser}`,
        );
    }
    if (emergency !== undefined) {
        exactKeys(
            emergency,
            Object.values(CBT_C3_EMERGENCY_MASTER_FIELD),
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster}`,
        );
    }

    const statusOverride = optionalUnavailableEquipmentStatus(
        state[CBT_COMPONENT_STATE_FIELD.status],
        `${path}[1].${CBT_COMPONENT_STATE_FIELD.status}`,
    );
    const chargeState = ppc === undefined
        ? undefined
        : optionalPpcChargeState(
            ppc[CBT_PPC_CAPACITOR_FIELD.chargeState],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.ppcCapacitor}.${CBT_PPC_CAPACITOR_FIELD.chargeState}`,
        );
    const bombastChargeState = bombast === undefined
        ? undefined
        : optionalBombastChargeState(
            bombast[CBT_BOMBAST_LASER_FIELD.chargeState],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.bombastLaser}.${CBT_BOMBAST_LASER_FIELD.chargeState}`,
        );
    const emergencyMode = emergency === undefined
        ? undefined
        : optionalC3EmergencyMasterMode(
            emergency[CBT_C3_EMERGENCY_MASTER_FIELD.mode],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster}.${CBT_C3_EMERGENCY_MASTER_FIELD.mode}`,
        );
    const operatingTurns = emergency === undefined
        ? undefined
        : optionalC3EmergencyMasterOperatingTurns(
            emergency[CBT_C3_EMERGENCY_MASTER_FIELD.operatingTurns],
            `${path}[1].${CBT_COMPONENT_STATE_FIELD.c3EmergencyMaster}.${CBT_C3_EMERGENCY_MASTER_FIELD.operatingTurns}`,
        );
    const gaussPower = optionalSparseMekGaussPower(
        state[CBT_COMPONENT_STATE_FIELD.gaussPower],
        `${path}[1].${CBT_COMPONENT_STATE_FIELD.gaussPower}`,
    );

    return {
        target: asSavedTargetRef(rowText(row, 0, path)),
        ...(statusOverride === undefined ? {} : { statusOverride }),
        ...(state[CBT_COMPONENT_STATE_FIELD.mode] === undefined ? {} : {
            mode: text(
                state[CBT_COMPONENT_STATE_FIELD.mode],
                `${path}[1].${CBT_COMPONENT_STATE_FIELD.mode}`,
            ),
        }),
        ...(state[CBT_COMPONENT_STATE_FIELD.jammed] === undefined ? {} : {
            jammed: truthyOne(
                state[CBT_COMPONENT_STATE_FIELD.jammed],
                `${path}[1].${CBT_COMPONENT_STATE_FIELD.jammed}`,
            ),
        }),
        ...(escalating === undefined ? {} : {
            escalatingFailure: {
                sequence: rowInteger(
                    escalating,
                    0,
                    `${path}[1].${CBT_COMPONENT_STATE_FIELD.escalatingFailure}`,
                ),
                ...(rowBit(
                    escalating,
                    1,
                    `${path}[1].${CBT_COMPONENT_STATE_FIELD.escalatingFailure}`,
                ) ? { active: true as const } : {}),
            },
        }),
        ...(ppc === undefined ? {} : {
            ppcCapacitor: {
                weaponId: asComponentId(text(
                    ppc[CBT_PPC_CAPACITOR_FIELD.weaponId],
                    `${path}[1].${CBT_COMPONENT_STATE_FIELD.ppcCapacitor}.${CBT_PPC_CAPACITOR_FIELD.weaponId}`,
                )),
                ...(chargeState === undefined ? {} : { chargeState }),
                ...(ppc[CBT_PPC_CAPACITOR_FIELD.firedThisTurn] === undefined ? {} : {
                    firedThisTurn: truthyOne(
                        ppc[CBT_PPC_CAPACITOR_FIELD.firedThisTurn],
                        `${path}[1].${CBT_COMPONENT_STATE_FIELD.ppcCapacitor}.${CBT_PPC_CAPACITOR_FIELD.firedThisTurn}`,
                    ),
                }),
            },
        }),
        ...(bombast === undefined ? {} : {
            bombastLaser: {
                ...(bombastChargeState === undefined ? {} : { chargeState: bombastChargeState }),
                ...(bombast[CBT_BOMBAST_LASER_FIELD.firedThisTurn] === undefined ? {} : {
                    firedThisTurn: truthyOne(
                        bombast[CBT_BOMBAST_LASER_FIELD.firedThisTurn],
                        `${path}[1].${CBT_COMPONENT_STATE_FIELD.bombastLaser}.${CBT_BOMBAST_LASER_FIELD.firedThisTurn}`,
                    ),
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
                absorptionDamage: rowInteger(
                    shield,
                    0,
                    `${path}[1].${CBT_COMPONENT_STATE_FIELD.shieldDamage}`,
                ),
                capacityDamage: rowInteger(
                    shield,
                    1,
                    `${path}[1].${CBT_COMPONENT_STATE_FIELD.shieldDamage}`,
                ),
            },
        }),
        ...(state[CBT_COMPONENT_STATE_FIELD.modularArmorDamage] === undefined ? {} : {
            modularArmorDamage: integer(
                state[CBT_COMPONENT_STATE_FIELD.modularArmorDamage],
                `${path}[1].${CBT_COMPONENT_STATE_FIELD.modularArmorDamage}`,
            ),
        }),
    };
}

function packHeat(value: SerializedCBTUnitV2['heat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        [CBT_HEAT_FIELD.current]: value.heat,
        [CBT_HEAT_FIELD.previous]: value.previous,
        [CBT_HEAT_FIELD.pendingOverride]: value.pendingOverride,
        [CBT_HEAT_FIELD.heatsinksOff]: value.heatsinksOff,
    });
}

function packNonMekHeat(value: SerializedNonMekUnit['heat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        [CBT_HEAT_FIELD.current]: value.current || undefined,
        [CBT_HEAT_FIELD.previous]: value.previous || undefined,
        [CBT_HEAT_FIELD.pendingOverride]: value.pendingOverride,
        [CBT_HEAT_FIELD.heatsinksOff]: value.heatsinksOff || undefined,
    });
}

function unpackNonMekHeat(
    value: unknown,
    path: string,
): NonNullable<SerializedNonMekUnit['heat']> {
    const heat = record(value, path);
    exactKeys(heat, Object.values(CBT_HEAT_FIELD), path);
    return {
        current: optionalInteger(
            heat[CBT_HEAT_FIELD.current],
            `${path}.${CBT_HEAT_FIELD.current}`,
        ) ?? 0,
        previous: optionalInteger(
            heat[CBT_HEAT_FIELD.previous],
            `${path}.${CBT_HEAT_FIELD.previous}`,
        ) ?? 0,
        ...(heat[CBT_HEAT_FIELD.pendingOverride] === undefined
            ? {}
            : {
                pendingOverride: integer(
                    heat[CBT_HEAT_FIELD.pendingOverride],
                    `${path}.${CBT_HEAT_FIELD.pendingOverride}`,
                ),
            }),
        heatsinksOff: optionalInteger(
            heat[CBT_HEAT_FIELD.heatsinksOff],
            `${path}.${CBT_HEAT_FIELD.heatsinksOff}`,
        ) ?? 0,
    };
}

function unpackHeat(value: unknown, path: string): NonNullable<SerializedCBTUnitV2['heat']> {
    const heat = record(value, path);
    exactKeys(heat, Object.values(CBT_HEAT_FIELD), path);
    return {
        heat: integer(heat[CBT_HEAT_FIELD.current], `${path}.${CBT_HEAT_FIELD.current}`),
        ...(heat[CBT_HEAT_FIELD.previous] === undefined ? {} : {
            previous: integer(
                heat[CBT_HEAT_FIELD.previous],
                `${path}.${CBT_HEAT_FIELD.previous}`,
            ),
        }),
        ...(heat[CBT_HEAT_FIELD.pendingOverride] === undefined ? {} : {
            pendingOverride: integer(
                heat[CBT_HEAT_FIELD.pendingOverride],
                `${path}.${CBT_HEAT_FIELD.pendingOverride}`,
            ),
        }),
        ...(heat[CBT_HEAT_FIELD.heatsinksOff] === undefined ? {} : {
            heatsinksOff: integer(
                heat[CBT_HEAT_FIELD.heatsinksOff],
                `${path}.${CBT_HEAT_FIELD.heatsinksOff}`,
            ),
        }),
    };
}

function packMovement(value: SerializedMekMovementPsrStateV2): unknown {
    const compact = compactObject({
        [CBT_MOVEMENT_FIELD.movement]: value.movement,
        [CBT_MOVEMENT_FIELD.action]: value.action,
        [CBT_MOVEMENT_FIELD.standAttempts]: value.standAttempts,
        [CBT_MOVEMENT_FIELD.carefulStand]: value.carefulStand ? 1 : undefined,
        [CBT_MOVEMENT_FIELD.damageThisPhase]: value.damageThisPhase,
        [CBT_MOVEMENT_FIELD.checks]: value.checks?.map(check => tuple(
            check.checkId,
            compactObject({
                [CBT_MOVEMENT_SOURCE_FIELD.sourceKind]: check.source.sourceKind,
                [CBT_MOVEMENT_SOURCE_FIELD.triggerKind]: check.source.triggerKind,
                [CBT_MOVEMENT_SOURCE_FIELD.witness]: check.source.witness,
                [CBT_MOVEMENT_SOURCE_FIELD.criticalSlotIds]: check.source.criticalSlotIds.length
                    ? check.source.criticalSlotIds
                    : undefined,
                [CBT_MOVEMENT_SOURCE_FIELD.locationIds]: check.source.locationIds.length
                    ? check.source.locationIds
                    : undefined,
                [CBT_MOVEMENT_SOURCE_FIELD.baseTarget]: check.source.baseTarget,
                [CBT_MOVEMENT_SOURCE_FIELD.triggerModifier]: check.source.triggerModifier,
            }),
            check.producingRevision,
            check.ordinal,
            check.targetNumber,
            check.reason,
            check.status,
            check.resolution && [check.resolution.dice, check.resolution.total],
        )),
        [CBT_MOVEMENT_FIELD.automaticFalls]: value.automaticFalls,
    });
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function unpackMovement(value: unknown, path: string): SerializedMekMovementPsrStateV2 {
    if (value === undefined) return { schemaVersion: 2 };
    const movement = record(value, path);
    exactKeys(movement, Object.values(CBT_MOVEMENT_FIELD), path);
    const expanded = compactObject({
        schemaVersion: 2,
        movement: movement[CBT_MOVEMENT_FIELD.movement] === undefined
            ? undefined
            : clone(movement[CBT_MOVEMENT_FIELD.movement]),
        action: movement[CBT_MOVEMENT_FIELD.action] === undefined
            ? undefined
            : clone(movement[CBT_MOVEMENT_FIELD.action]),
        standAttempts: optionalInteger(
            movement[CBT_MOVEMENT_FIELD.standAttempts],
            `${path}.${CBT_MOVEMENT_FIELD.standAttempts}`,
        ),
        carefulStand: movement[CBT_MOVEMENT_FIELD.carefulStand] === undefined
            ? undefined
            : truthyOne(
                movement[CBT_MOVEMENT_FIELD.carefulStand],
                `${path}.${CBT_MOVEMENT_FIELD.carefulStand}`,
            ),
        damageThisPhase: optionalInteger(
            movement[CBT_MOVEMENT_FIELD.damageThisPhase],
            `${path}.${CBT_MOVEMENT_FIELD.damageThisPhase}`,
        ),
        checks: movement[CBT_MOVEMENT_FIELD.checks] === undefined ? undefined : unpackRows(
            movement[CBT_MOVEMENT_FIELD.checks],
            `${path}.${CBT_MOVEMENT_FIELD.checks}`,
            (row, rowPath) => {
            const source = record(row[1], `${rowPath}[1]`);
            const resolution = row[7] === undefined ? undefined : array(row[7], `${rowPath}[7]`);
            return compactObject({
                checkId: rowText(row, 0, rowPath),
                source: {
                    sourceKind: text(
                        source[CBT_MOVEMENT_SOURCE_FIELD.sourceKind],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.sourceKind}`,
                    ),
                    triggerKind: text(
                        source[CBT_MOVEMENT_SOURCE_FIELD.triggerKind],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.triggerKind}`,
                    ),
                    witness: text(
                        source[CBT_MOVEMENT_SOURCE_FIELD.witness],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.witness}`,
                    ),
                    criticalSlotIds: unpackTextArray(
                        source[CBT_MOVEMENT_SOURCE_FIELD.criticalSlotIds] ?? [],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.criticalSlotIds}`,
                    ),
                    locationIds: unpackTextArray(
                        source[CBT_MOVEMENT_SOURCE_FIELD.locationIds] ?? [],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.locationIds}`,
                    ),
                    baseTarget: integer(
                        source[CBT_MOVEMENT_SOURCE_FIELD.baseTarget],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.baseTarget}`,
                    ),
                    triggerModifier: integer(
                        source[CBT_MOVEMENT_SOURCE_FIELD.triggerModifier],
                        `${rowPath}[1].${CBT_MOVEMENT_SOURCE_FIELD.triggerModifier}`,
                    ),
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
            },
        ),
        automaticFalls: movement[CBT_MOVEMENT_FIELD.automaticFalls] === undefined
            ? undefined
            : clone(movement[CBT_MOVEMENT_FIELD.automaticFalls]),
    });
    return serializeMekMovementPsrStateV2(deserializeMekMovementPsrStateV2(expanded));
}

function packTurn(value: SerializedMekTurnStateV2): unknown {
    const compact = compactObject({
        [CBT_TURN_FIELD.turnCounter]: value.turnCounter,
        [CBT_TURN_FIELD.airborne]: value.airborne,
        [CBT_TURN_FIELD.cover]: value.cover,
        [CBT_TURN_FIELD.weaponsHeat]: value.weaponsHeat,
        [CBT_TURN_FIELD.acknowledgedHeatSources]: value.acknowledgedHeatSources
            ?.map(row => [row.sourceId, row.signature]),
        [CBT_TURN_FIELD.heatDissipationConsumed]: value.heatDissipationConsumed,
        [CBT_TURN_FIELD.spotting]: value.spotting ? 1 : undefined,
        [CBT_TURN_FIELD.phaseStateChanged]: value.phaseStateChanged ? 1 : undefined,
        [CBT_TURN_FIELD.endTurnCheckpoint]: packEndTurnCheckpoint(value.endTurnCheckpoint),
        [CBT_TURN_FIELD.pendingFallConsequences]: value.pendingFallConsequences === undefined
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
        [CBT_TURN_FIELD.pendingCriticalEvents]: value.pendingCriticalEvents === undefined
            ? undefined
            : clone(value.pendingCriticalEvents),
    });
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function unpackTurn(value: unknown, path: string): SerializedMekTurnStateV2 {
    if (value === undefined) return { schemaVersion: 1 };
    const turn = record(value, path);
    exactKeys(turn, Object.values(CBT_TURN_FIELD), path);
    const expanded = compactObject({
        schemaVersion: 1,
        turnCounter: optionalInteger(
            turn[CBT_TURN_FIELD.turnCounter],
            `${path}.${CBT_TURN_FIELD.turnCounter}`,
        ),
        airborne: turn[CBT_TURN_FIELD.airborne] as boolean | undefined,
        cover: turn[CBT_TURN_FIELD.cover] === undefined
            ? undefined
            : clone(turn[CBT_TURN_FIELD.cover]),
        weaponsHeat: optionalInteger(
            turn[CBT_TURN_FIELD.weaponsHeat],
            `${path}.${CBT_TURN_FIELD.weaponsHeat}`,
        ),
        acknowledgedHeatSources: turn[CBT_TURN_FIELD.acknowledgedHeatSources] === undefined
            ? undefined
            : unpackRows(
                turn[CBT_TURN_FIELD.acknowledgedHeatSources],
                `${path}.${CBT_TURN_FIELD.acknowledgedHeatSources}`,
                (row, rowPath) => ({
                    sourceId: rowText(row, 0, rowPath),
                    signature: rowText(row, 1, rowPath),
                }),
            ),
        heatDissipationConsumed: optionalInteger(
            turn[CBT_TURN_FIELD.heatDissipationConsumed],
            `${path}.${CBT_TURN_FIELD.heatDissipationConsumed}`,
        ),
        spotting: turn[CBT_TURN_FIELD.spotting] === undefined
            ? undefined
            : truthyOne(turn[CBT_TURN_FIELD.spotting], `${path}.${CBT_TURN_FIELD.spotting}`),
        phaseStateChanged: turn[CBT_TURN_FIELD.phaseStateChanged] === undefined
            ? undefined
            : truthyOne(
                turn[CBT_TURN_FIELD.phaseStateChanged],
                `${path}.${CBT_TURN_FIELD.phaseStateChanged}`,
            ),
        endTurnCheckpoint: turn[CBT_TURN_FIELD.endTurnCheckpoint] === undefined
            ? undefined
            : unpackEndTurnCheckpoint(
                turn[CBT_TURN_FIELD.endTurnCheckpoint],
                `${path}.${CBT_TURN_FIELD.endTurnCheckpoint}`,
            ),
        pendingFallConsequences: turn[CBT_TURN_FIELD.pendingFallConsequences] === undefined
            ? undefined
            : unpackPendingFallConsequences(
                turn[CBT_TURN_FIELD.pendingFallConsequences],
                `${path}.${CBT_TURN_FIELD.pendingFallConsequences}`,
            ),
        pendingCriticalEvents: turn[CBT_TURN_FIELD.pendingCriticalEvents] === undefined
            ? undefined
            : clone(
                turn[CBT_TURN_FIELD.pendingCriticalEvents],
            ) as SerializedMekTurnStateV2['pendingCriticalEvents'],
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

function packPending(value: SerializedCBTUnitV2['pendingCombat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        [CBT_PENDING_COMBAT_FIELD.locationDamage]: packRows(
            value.locationDamage,
            row => [row.target, row.damage],
        ),
        [CBT_PENDING_COMBAT_FIELD.locationConditions]: packRows(
            value.locationConditions,
            row => [row.target, row.condition, row.value],
        ),
        [CBT_PENDING_COMBAT_FIELD.slotHits]: packRows(
            value.slotHits,
            row => [row.target, row.hits],
        ),
        [CBT_PENDING_COMBAT_FIELD.componentStatus]: packRows(
            value.componentStatus,
            row => [row.target, row.status],
        ),
        [CBT_PENDING_COMBAT_FIELD.shieldDamage]: packRows(
            value.shieldDamage,
            row => [row.target, row.absorptionDamage, row.capacityDamage],
        ),
        [CBT_PENDING_COMBAT_FIELD.modularArmorDamage]: packRows(
            value.modularArmorDamage,
            row => [row.target, row.damage],
        ),
    });
}

function unpackPending(value: unknown, path: string): NonNullable<SerializedCBTUnitV2['pendingCombat']> {
    const pending = record(value, path);
    exactKeys(pending, Object.values(CBT_PENDING_COMBAT_FIELD), path);
    return {
        ...(pending[CBT_PENDING_COMBAT_FIELD.locationDamage] === undefined ? {} : {
            locationDamage: unpackRows(
                pending[CBT_PENDING_COMBAT_FIELD.locationDamage],
                `${path}.${CBT_PENDING_COMBAT_FIELD.locationDamage}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
                }),
            ),
        }),
        ...(pending[CBT_PENDING_COMBAT_FIELD.locationConditions] === undefined ? {} : {
            locationConditions: unpackRows(
                pending[CBT_PENDING_COMBAT_FIELD.locationConditions],
                `${path}.${CBT_PENDING_COMBAT_FIELD.locationConditions}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                condition: unpackMekLocationCondition(row[1], `${rowPath}[1]`),
                value: rowInteger(row, 2, rowPath),
                }),
            ),
        }),
        ...(pending[CBT_PENDING_COMBAT_FIELD.slotHits] === undefined ? {} : {
            slotHits: unpackRows(
                pending[CBT_PENDING_COMBAT_FIELD.slotHits],
                `${path}.${CBT_PENDING_COMBAT_FIELD.slotHits}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                hits: rowInteger(row, 1, rowPath),
                }),
            ),
        }),
        ...(pending[CBT_PENDING_COMBAT_FIELD.componentStatus] === undefined ? {} : {
            componentStatus: unpackRows(
                pending[CBT_PENDING_COMBAT_FIELD.componentStatus],
                `${path}.${CBT_PENDING_COMBAT_FIELD.componentStatus}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                status: unpackEquipmentStatus(row[1], `${rowPath}[1]`),
                }),
            ),
        }),
        ...(pending[CBT_PENDING_COMBAT_FIELD.shieldDamage] === undefined ? {} : {
            shieldDamage: unpackRows(
                pending[CBT_PENDING_COMBAT_FIELD.shieldDamage],
                `${path}.${CBT_PENDING_COMBAT_FIELD.shieldDamage}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                absorptionDamage: rowInteger(row, 1, rowPath),
                capacityDamage: rowInteger(row, 2, rowPath),
                }),
            ),
        }),
        ...(pending[CBT_PENDING_COMBAT_FIELD.modularArmorDamage] === undefined ? {} : {
            modularArmorDamage: unpackRows(
                pending[CBT_PENDING_COMBAT_FIELD.modularArmorDamage],
                `${path}.${CBT_PENDING_COMBAT_FIELD.modularArmorDamage}`,
                (row, rowPath) => ({
                target: asSavedTargetRef(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
                }),
            ),
        }),
    };
}

function packNonMekPending(value: SerializedNonMekUnit['pendingCombat']): unknown {
    if (value === undefined) return undefined;
    return compactObject({
        [CBT_NON_MEK_PENDING_COMBAT_FIELD.internalDamage]: packRows(
            value.internalDamage,
            row => [row.locationId, row.damage],
        ),
        [CBT_NON_MEK_PENDING_COMBAT_FIELD.armorDamage]: packRows(
            value.armorDamage,
            row => [row.faceId, row.damage],
        ),
        [CBT_NON_MEK_PENDING_COMBAT_FIELD.componentStatus]: packRows(
            value.componentStatus,
            row => [row.componentId, row.status],
        ),
        [CBT_NON_MEK_PENDING_COMBAT_FIELD.damageTrackHits]: packRows(
            value.damageTrackHits,
            row => [row.damageTrackId, row.hitDelta, row.hitTimestamps],
        ),
    });
}

function unpackNonMekPending(value: unknown, path: string): NonNullable<SerializedNonMekUnit['pendingCombat']> {
    const pending = record(value, path);
    exactKeys(pending, Object.values(CBT_NON_MEK_PENDING_COMBAT_FIELD), path);
    return {
        ...(pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.internalDamage] === undefined ? {} : {
            internalDamage: unpackRows(
                pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.internalDamage],
                `${path}.${CBT_NON_MEK_PENDING_COMBAT_FIELD.internalDamage}`,
                (row, rowPath) => ({
                locationId: asLocationId(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
                }),
            ),
        }),
        ...(pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.armorDamage] === undefined ? {} : {
            armorDamage: unpackRows(
                pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.armorDamage],
                `${path}.${CBT_NON_MEK_PENDING_COMBAT_FIELD.armorDamage}`,
                (row, rowPath) => ({
                faceId: asArmorFaceId(rowText(row, 0, rowPath)),
                damage: rowInteger(row, 1, rowPath),
                }),
            ),
        }),
        ...(pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.componentStatus] === undefined ? {} : {
            componentStatus: unpackRows(
                pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.componentStatus],
                `${path}.${CBT_NON_MEK_PENDING_COMBAT_FIELD.componentStatus}`,
                (row, rowPath) => ({
                componentId: asComponentId(rowText(row, 0, rowPath)),
                status: unpackEquipmentStatus(row[1], `${rowPath}[1]`),
                }),
            ),
        }),
        ...(pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.damageTrackHits] === undefined ? {} : {
            damageTrackHits: unpackRows(
                pending[CBT_NON_MEK_PENDING_COMBAT_FIELD.damageTrackHits],
                `${path}.${CBT_NON_MEK_PENDING_COMBAT_FIELD.damageTrackHits}`,
                (row, rowPath) => ({
                damageTrackId: asSystemDamageTrackId(rowText(row, 0, rowPath)),
                hitDelta: rowInteger(row, 1, rowPath),
                hitTimestamps: unpackIntegerArray(row[2], `${rowPath}[2]`),
                }),
            ),
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
            [CBT_ROSTER_GROUP_METADATA_FIELD.name]: group.name,
            [CBT_ROSTER_GROUP_METADATA_FIELD.color]: group.color,
            [CBT_ROSTER_GROUP_METADATA_FIELD.formationId]: group.formationId,
            [CBT_ROSTER_GROUP_METADATA_FIELD.targetGroupIndex]: targetGroupIndex,
            [CBT_ROSTER_GROUP_METADATA_FIELD.formationLock]: group.formationLock ? 1 : undefined,
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
    const groupsPath = `force.${FORCE_PAYLOAD_FIELD.classicBattleTech}.${CBT_FORCE_FIELD.groups}`;
    const packedGroups = array(value, groupsPath);
    const groupIds = packedGroups.map((raw, index) => {
        const path = `${groupsPath}[${index}]`;
        return unpackOpaqueId(rowText(array(raw, path), 0, path), `${path}[0]`);
    });
    return {
        schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
        groups: unpackRows(packedGroups, groupsPath, (row, path, groupOrder) => {
            const metadata = row[2] === undefined ? {} : record(row[2], `${path}[2]`);
            exactKeys(metadata, Object.values(CBT_ROSTER_GROUP_METADATA_FIELD), `${path}[2]`);
            const targetGroupIndex = optionalInteger(
                metadata[CBT_ROSTER_GROUP_METADATA_FIELD.targetGroupIndex],
                `${path}[2].${CBT_ROSTER_GROUP_METADATA_FIELD.targetGroupIndex}`,
            );
            const formationTargetGroupId = targetGroupIndex === undefined
                ? undefined
                : groupIds[targetGroupIndex];
            if (targetGroupIndex !== undefined && formationTargetGroupId === undefined) {
                throw new Error(`${path}[2].t has no force group`);
            }
            return {
            groupId: groupIds[groupOrder]!,
            order: groupOrder,
            ...(metadata[CBT_ROSTER_GROUP_METADATA_FIELD.name] === undefined ? {} : {
                name: text(
                    metadata[CBT_ROSTER_GROUP_METADATA_FIELD.name],
                    `${path}[2].${CBT_ROSTER_GROUP_METADATA_FIELD.name}`,
                ),
            }),
            ...(metadata[CBT_ROSTER_GROUP_METADATA_FIELD.color] === undefined ? {} : {
                color: text(
                    metadata[CBT_ROSTER_GROUP_METADATA_FIELD.color],
                    `${path}[2].${CBT_ROSTER_GROUP_METADATA_FIELD.color}`,
                ),
            }),
            ...(metadata[CBT_ROSTER_GROUP_METADATA_FIELD.formationId] === undefined ? {} : {
                formationId: text(
                    metadata[CBT_ROSTER_GROUP_METADATA_FIELD.formationId],
                    `${path}[2].${CBT_ROSTER_GROUP_METADATA_FIELD.formationId}`,
                ),
            }),
            ...(formationTargetGroupId === undefined
                ? {}
                : { formationTargetGroupId }),
            ...(metadata[CBT_ROSTER_GROUP_METADATA_FIELD.formationLock] === undefined ? {} : {
                formationLock: truthyOne(
                    metadata[CBT_ROSTER_GROUP_METADATA_FIELD.formationLock],
                    `${path}[2].${CBT_ROSTER_GROUP_METADATA_FIELD.formationLock}`,
                ),
            }),
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

function packEncounter(
    encounter: SerializedCBTEncounterStateV2,
    units: readonly SerializedForceUnitEntryV2[],
): unknown {
    const unitIndexes = new Map(units.map((unit, index) => [unit.instanceId, index] as const));
    return Object.freeze(encounter.networks.map(network => tuple(
        packOpaqueId(network.id),
        network.networkType,
        network.color,
        Object.freeze(network.endpoints.map(endpoint => {
            const unitIndex = unitIndexes.get(endpoint.instanceId);
            if (unitIndex === undefined) {
                throw new Error(`Encounter network endpoint ${endpoint.instanceId} has no force unit`);
            }
            return tuple(
                unitIndex,
                packOpaqueId(endpoint.componentId),
                endpoint.role,
            );
        })),
    )));
}

function unpackEncounter(
    value: unknown,
    path: string,
    units: readonly SerializedForceUnitEntryV2[],
): SerializedCBTEncounterStateV2 {
    const networks = unpackRows(value, path, (row, networkPath): SerializedEncounterNetworkV2 => {
        if (row.length !== 4) throw new Error(`${networkPath} is not a compact encounter network`);
        const networkType = rowText(row, CBT_ENCOUNTER_NETWORK_INDEX.type, networkPath);
        if (!isC3NetworkType(networkType)) {
            throw new Error(`${networkPath}[${CBT_ENCOUNTER_NETWORK_INDEX.type}] is not a C3 network type`);
        }
        const endpointsPath = `${networkPath}[${CBT_ENCOUNTER_NETWORK_INDEX.endpoints}]`;
        const endpoints = unpackRows(
            row[CBT_ENCOUNTER_NETWORK_INDEX.endpoints],
            endpointsPath,
            (endpoint, endpointPath) => {
                if (endpoint.length !== 3) {
                    throw new Error(`${endpointPath} is not a compact encounter network endpoint`);
                }
                const unitIndex = rowInteger(
                    endpoint,
                    CBT_ENCOUNTER_ENDPOINT_INDEX.unit,
                    endpointPath,
                );
                const unit = units[unitIndex];
                if (unit === undefined) {
                    throw new Error(
                        `${endpointPath}[${CBT_ENCOUNTER_ENDPOINT_INDEX.unit}] has no force unit`,
                    );
                }
                const role = rowText(endpoint, CBT_ENCOUNTER_ENDPOINT_INDEX.role, endpointPath);
                if (!isC3NetworkRole(role)) {
                    throw new Error(
                        `${endpointPath}[${CBT_ENCOUNTER_ENDPOINT_INDEX.role}] is not a C3 network role`,
                    );
                }
                return {
                    instanceId: unit.instanceId,
                    componentId: asComponentId(unpackOpaqueId(
                        rowText(endpoint, CBT_ENCOUNTER_ENDPOINT_INDEX.componentId, endpointPath),
                        `${endpointPath}[${CBT_ENCOUNTER_ENDPOINT_INDEX.componentId}]`,
                    )),
                    role,
                };
            },
        );
        return {
            id: unpackOpaqueId(
                rowText(row, CBT_ENCOUNTER_NETWORK_INDEX.instanceId, networkPath),
                `${networkPath}[${CBT_ENCOUNTER_NETWORK_INDEX.instanceId}]`,
            ),
            networkType,
            color: rowText(row, CBT_ENCOUNTER_NETWORK_INDEX.color, networkPath),
            endpoints,
        };
    });
    return { networks };
}

function emptyEncounter(): SerializedCBTEncounterStateV2 {
    return { networks: [] };
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
