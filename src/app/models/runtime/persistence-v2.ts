// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import { isUnitConditionKey, type UnitConditionKey } from '../unit-condition.model';
import type {
    BombastLaserRuntimeState,
    C3EmergencyMasterRuntimeState,
    ComponentRuntimeState,
    EscalatingFailureRuntimeState,
    MekLocationConditionKey,
    PpcCapacitorRuntimeState,
} from './runtime-state';
import { isMekLocationConditionKey, MAX_MEK_LOCATION_CONDITION_VALUE } from './runtime-state';
import {
    asComponentId,
    asCriticalSlotId,
    asCrewPositionId,
    asLocationId,
    type ComponentId,
    type CrewPositionId,
} from '../entity/entity-identifiers';
import {
    isC3NetworkRole,
    isC3NetworkType,
    type C3NetworkRole,
    type C3NetworkType,
    type C3UnitPosition,
} from '../c3-network.model';
import { isRecord } from '../../utils/json-value.util';
import { compareText } from '../../utils/string.util';
import type { JsonValue } from '../persisted-unit-state';
import { asUnitUuid, type UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { MAX_CREW_WOUNDS } from '../crew-member.model';
import { asSourceHashCanary, type SourceHashCanary } from '../source-hash-canary';
import { type SerializedInstanceBaselineRef } from './runtime-state';
import { deserializeMekTurnStateV2, type SerializedMekTurnStateV2 } from './mek-turn-state-v2';
import {
    deserializeMekMovementPsrStateV2,
    serializeMekMovementPsrStateV2,
    type SerializedMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import { assertCanonicalCrewAssignment, type CrewAssignment, type CrewPositionDefinition } from './crew-assignment';
import {
    MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
    type CanonicalMekDeploymentConfigurationV2,
} from './unit-state-initializer';
import { MAX_MEK_HEATSINKS_OFF_V2, MAX_MEK_HEAT_VALUE_V2 } from './mek-heat-state-v2';
import {
    CBT_FORCE_ROSTER_SCHEMA_VERSION,
    CBT_FORCE_UNASSIGNED_GROUP_ID,
    MAX_CBT_FORCE_ROSTER_METADATA_LENGTH,
    type SerializedCBTForceRosterV1,
} from './cbt-force-roster';
import type { MekRuleCheckKeyV2, MekRuleCheckStatusV2, MekRuleCheckTokenV2 } from './mek-destruction-state-v2';
import { inspectSerializedNonMekUnit, type SerializedNonMekUnit } from './non-mek-unit-persistence';
import {
    isRuntimeHistoryMessageId,
    runtimeHistoryMessageCanReferenceUnit,
    runtimeHistoryMessageRequiresUnit,
    type SerializedRuntimeHistory,
} from './runtime-history';
import { CBT_HISTORY_FIELD, CBT_HISTORY_TURN_FIELD } from './force-storage-vocabulary';
import { freezeEquipmentRowOrder, type EquipmentRowOrderState } from './equipment-row-order';

export type { SerializedMekTurnStateV2 } from './mek-turn-state-v2';

export const CBT_FORCE_PERSISTENCE_SCHEMA_VERSION = 16 as const;
export const CBT_UNIT_PERSISTENCE_SCHEMA_VERSION = 10 as const;
export const MAX_SERIALIZED_ENCOUNTER_NETWORKS = 100;
export const MAX_SERIALIZED_ENCOUNTER_NETWORK_ENDPOINTS = 1024;

declare const persistenceBrand: unique symbol;
export type ForceId = string & { readonly [persistenceBrand]: 'ForceId' };
export type SavedTargetRef = string & { readonly [persistenceBrand]: 'SavedTargetRef' };
export type OneBasedCriticalSlotOrdinal = number & { readonly [persistenceBrand]: 'OneBasedCriticalSlotOrdinal' };

export function asForceId(value: string): ForceId {
    return asBoundedId(value, 'force ID') as ForceId;
}

export function asSavedTargetRef(value: string): SavedTargetRef {
    return asBoundedId(value, 'saved target reference') as SavedTargetRef;
}

export type SavedTargetRefKind =
    | 'location'
    | 'slot'
    | 'component'
    | 'system'
    | 'ammo'
    | 'crew';

/** Stable Entity-owned target identity used by sparse Mek runtime state. */
export function createSavedTargetRef(
    kind: SavedTargetRefKind,
    ...parts: readonly string[]
): SavedTargetRef {
    const expectedParts = kind === 'location' ? 2 : 1;
    if (parts.length !== expectedParts) {
        throw new Error(`${kind} target references require ${expectedParts} identity part(s)`);
    }
    parts.forEach(part => asBoundedId(part, 'saved target identity'));
    const prefix = kind === 'location'
        ? locationTargetPrefix(parts[1]!)
        : targetKindPrefix(kind);
    return asSavedTargetRef(`${prefix}:${parts[0]}`);
}

export interface ParsedSavedTargetRef {
    readonly kind: SavedTargetRefKind;
    readonly parts: readonly string[];
}

export function parseSavedTargetRef(value: string): ParsedSavedTargetRef | null {
    if (value.length < 3 || value[1] !== ':') return null;
    const id = value.slice(2);
    try {
        asBoundedId(id, 'saved target identity');
    } catch {
        return null;
    }
    switch (value[0]) {
        case 'i': return { kind: 'location', parts: [id, 'internal'] };
        case 'f': return { kind: 'location', parts: [id, 'front-armor'] };
        case 'r': return { kind: 'location', parts: [id, 'rear-armor'] };
        case 's': return { kind: 'slot', parts: [id] };
        case 'c': return { kind: 'component', parts: [id] };
        case 'y': return { kind: 'system', parts: [id] };
        case 'm': return { kind: 'ammo', parts: [id] };
        case 'w': return { kind: 'crew', parts: [id] };
        default: return null;
    }
}

function locationTargetPrefix(section: string): string {
    switch (section) {
        case 'internal': return 'i';
        case 'front-armor': return 'f';
        case 'rear-armor': return 'r';
        default: throw new Error(`Unknown location target section ${section}`);
    }
}

function targetKindPrefix(kind: Exclude<SavedTargetRefKind, 'location'>): string {
    switch (kind) {
        case 'slot': return 's';
        case 'component': return 'c';
        case 'system': return 'y';
        case 'ammo': return 'm';
        case 'crew': return 'w';
    }
}

function inferredSavedTarget(value: string): SavedStateTargetV2 | null {
    const parsed = parseSavedTargetRef(value);
    if (!parsed) return null;
    const id = parsed.parts[0]!;
    switch (parsed.kind) {
        case 'location': {
            const section = parsed.parts[1];
            if (section !== 'internal' && section !== 'front-armor' && section !== 'rear-armor') return null;
            return { kind: 'location-section', location: id, section };
        }
        case 'slot':
            return { kind: 'critical-slot', savedSlotId: id, location: id, slot: asOneBasedCriticalSlotOrdinal(1) };
        case 'component':
            return { kind: 'component', savedComponentId: id, equipmentName: id, locations: [], criticalSlots: [] };
        case 'system':
            return { kind: 'intrinsic-system', savedComponentId: id, systemKey: id, locations: [], criticalSlots: [] };
        case 'ammo':
            return {
                kind: 'ammo-source',
                savedAmmoSourceId: id,
                source: { kind: 'installed-bin', savedComponentId: id, equipmentName: id },
                criticalSlots: [],
            };
        case 'crew':
            return { kind: 'crew-position', savedCrewPositionId: id, positionKey: id };
    }
}

/** Builds only the target kinds needed to validate a compact pre-Entity snapshot. */
function inferActiveSavedTargets(value: unknown): Record<string, SavedStateTargetV2> {
    const targets: Record<string, SavedStateTargetV2> = {};
    const visit = (candidate: unknown): void => {
        if (typeof candidate === 'string') {
            const target = inferredSavedTarget(candidate);
            if (target) targets[candidate] = target;
            return;
        }
        if (Array.isArray(candidate)) {
            candidate.forEach(visit);
            return;
        }
        if (candidate !== null && typeof candidate === 'object') {
            Object.values(candidate as Record<string, unknown>).forEach(visit);
        }
    };
    visit(value);
    return targets;
}

export function asOneBasedCriticalSlotOrdinal(value: number): OneBasedCriticalSlotOrdinal {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid one-based slot ordinal: ${value}`);
    return value as OneBasedCriticalSlotOrdinal;
}

function asBoundedId(value: string, label: string): string {
    if (!value.trim() || value.length > 512 || value.includes('\0')) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}

export interface SavedSlotCoordinateV2 {
    readonly location: string;
    readonly slot: OneBasedCriticalSlotOrdinal;
}

export type SavedStateTargetV2 =
    | {
        readonly kind: 'critical-slot';
        readonly savedSlotId?: string;
        readonly location: string;
        readonly slot: OneBasedCriticalSlotOrdinal;
        readonly expectedSystemId?: string;
        readonly expectedEquipmentName?: string;
    }
    | {
        readonly kind: 'location-section';
        readonly location: string;
        readonly section: 'internal' | 'front-armor' | 'rear-armor';
    }
    | {
        readonly kind: 'component';
        readonly savedComponentId?: string;
        readonly equipmentName: string;
        readonly locations: readonly string[];
        readonly criticalSlots: readonly SavedSlotCoordinateV2[];
        readonly occurrence?: number;
    }
    | {
        readonly kind: 'ammo-source';
        readonly savedAmmoSourceId?: string;
        readonly source:
            | {
                readonly kind: 'installed-bin';
                readonly savedComponentId?: string;
                readonly equipmentName: string;
            }
            | {
                readonly kind: 'intrinsic-magazine' | 'one-shot';
                readonly ownerComponentTarget: SavedTargetRef;
                readonly equipmentName: string;
            };
        readonly location?: string;
        readonly criticalSlots: readonly SavedSlotCoordinateV2[];
        readonly occurrence?: number;
        readonly capacityAtSave?: number;
        readonly munitionAtSave?: string;
    }
    | {
        readonly kind: 'intrinsic-system';
        readonly savedComponentId?: string;
        readonly systemKey: string;
        readonly locations: readonly string[];
        readonly criticalSlots: readonly SavedSlotCoordinateV2[];
    }
    | {
        readonly kind: 'crew-position';
        readonly savedCrewPositionId?: string;
        readonly positionKey: string;
        readonly occurrence?: number;
    };

/** Unit-owned witness table. It is rebuilt for the exact baseline saved with this unit. */
export interface SavedBlueprintReferenceTableV2 {
    readonly schemaVersion: 1;
    readonly targets: Readonly<Record<SavedTargetRef, SavedStateTargetV2>>;
}

/**
 * Returns the canonical transitive source-table closure for active recovery roots.
 * Intrinsic/one-shot ammo targets depend on their owner component target; callers
 * must retain that owner even when it is not itself an unresolved recovery row.
 */
export function savedTargetReferenceClosureV2(
    targets: Readonly<Record<SavedTargetRef, SavedStateTargetV2>>,
    roots: readonly SavedTargetRef[],
): readonly SavedTargetRef[] | undefined {
    const retained = new Set<SavedTargetRef>();
    const pending = [...new Set(roots)].sort(compareSavedTargetRefs);
    while (pending.length > 0) {
        const ref = pending.shift()!;
        if (retained.has(ref)) continue;
        const target = targets[ref];
        if (target === undefined) return undefined;
        retained.add(ref);
        if (target.kind === 'ammo-source' && target.source.kind !== 'installed-bin') {
            pending.push(target.source.ownerComponentTarget);
            pending.sort(compareSavedTargetRefs);
        }
    }
    return Object.freeze([...retained].sort(compareSavedTargetRefs));
}

function compareSavedTargetRefs(left: SavedTargetRef, right: SavedTargetRef): number {
    return compareText(left, right);
}

export interface SerializedDeploymentConfigurationV2 {
    readonly schemaVersion: typeof MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION;
    readonly values: CanonicalMekDeploymentConfigurationV2;
}

export interface SerializedLocationStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly damage: number;
}

/**
 * One sparse, closed-vocabulary location condition fact. The target must be
 * the location's `internal` section so the condition has one stable LocationId
 * witness rather than an armor-facing-dependent identity.
 */
export interface SerializedLocationConditionStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly condition: MekLocationConditionKey;
    /** Positive when committed; pending entries also use zero as explicit removal. */
    readonly value: number;
}

export interface SerializedSlotStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly hits: number;
    /** Sparse: absence means the slot became unavailable on turn zero. */
    readonly destroyedTurn?: number;
}

export interface SerializedComponentStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly statusOverride?: Exclude<EquipmentStatus, 'available'>;
    readonly mode?: string;
    readonly jammed?: boolean;
    readonly escalatingFailure?: EscalatingFailureRuntimeState;
    readonly ppcCapacitor?: PpcCapacitorRuntimeState;
    readonly bombastLaser?: BombastLaserRuntimeState;
    readonly c3EmergencyMaster?: C3EmergencyMasterRuntimeState;
    readonly gaussPower?: ComponentRuntimeState['gaussPower'];
    readonly shieldDamage?: ComponentRuntimeState['shieldDamage'];
    readonly modularArmorDamage?: number;
}

export interface SerializedAmmoStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly shotsSpent: number;
    readonly munitionOverride?: string;
}

export interface SerializedCrewStateV2 {
    readonly schemaVersion: 1;
    readonly positions: readonly {
        readonly target: SavedTargetRef;
        readonly wounds: number;
        readonly unconscious: boolean;
        /** Sparse committed death; six wounds without it are pending until phase end. */
        readonly dead?: true;
        /** Sparse state: omitted is canonical false. */
        readonly ejected?: true;
        /** Earliest turn for a queued recovery; null explicitly means none. */
        readonly recoveryReadyTurn?: number | null;
    }[];
}

export interface SerializedHeatStateV2 {
    /** Current remains named `heat` for snapshots written by the scalar V2 codec. */
    readonly heat: number;
    readonly previous?: number;
    readonly pendingOverride?: number;
    readonly heatsinksOff?: number;
}

export interface SerializedCommonConditionStateV2 {
    readonly values: readonly UnitConditionKey[];
}

export interface SerializedPendingCombatStateV2 {
    readonly locationDamage?: readonly SerializedLocationStateEntryV2[];
    readonly locationConditions?: readonly SerializedLocationConditionStateEntryV2[];
    readonly slotHits?: readonly SerializedSlotStateEntryV2[];
    readonly componentStatus?: readonly {
        readonly target: SavedTargetRef;
        readonly status: EquipmentStatus;
    }[];
    readonly shieldDamage?: readonly {
        readonly target: SavedTargetRef;
        readonly absorptionDamage: number;
        readonly capacityDamage: number;
    }[];
    readonly modularArmorDamage?: readonly {
        readonly target: SavedTargetRef;
        readonly damage: number;
    }[];
}

export type SerializedRecoverableStateFactV2 =
    | { readonly kind: 'location-damage'; readonly damage: number }
    | {
        readonly kind: 'location-condition';
        readonly condition: MekLocationConditionKey;
        readonly value: number;
    }
    | { readonly kind: 'slot-hits'; readonly hits: number; readonly destroyedTurn?: number }
    | {
        readonly kind: 'component-state';
        readonly statusOverride?: Exclude<EquipmentStatus, 'available'>;
        readonly mode?: string;
        readonly jammed?: boolean;
        readonly escalatingFailure?: EscalatingFailureRuntimeState;
        readonly ppcCapacitor?: PpcCapacitorRuntimeState;
        readonly bombastLaser?: BombastLaserRuntimeState;
        readonly c3EmergencyMaster?: C3EmergencyMasterRuntimeState;
        readonly gaussPower?: ComponentRuntimeState['gaussPower'];
        readonly shieldDamage?: ComponentRuntimeState['shieldDamage'];
        readonly modularArmorDamage?: number;
    }
    | { readonly kind: 'ammo-state'; readonly shotsSpent: number; readonly munitionOverride?: string }
    | {
        readonly kind: 'crew-state';
        readonly wounds: number;
        readonly unconscious: boolean;
        readonly dead?: true;
        /** Omitted is canonical false. */
        readonly ejected?: true;
    }
    | {
        readonly kind: 'mek-rule-check';
        readonly key: MekRuleCheckKeyV2;
        readonly token: MekRuleCheckTokenV2;
        readonly openedRevision: number;
        readonly status: MekRuleCheckStatusV2;
    }
    | { readonly kind: 'pending-location-damage'; readonly damage: number }
    | {
        readonly kind: 'pending-location-condition';
        readonly condition: MekLocationConditionKey;
        readonly value: number;
    }
    | { readonly kind: 'pending-slot-hits'; readonly hits: number }
    | { readonly kind: 'pending-component-status'; readonly status: EquipmentStatus }
    | {
        readonly kind: 'pending-shield-damage';
        readonly absorptionDamage: number;
        readonly capacityDamage: number;
    }
    | { readonly kind: 'pending-modular-armor-damage'; readonly damage: number };

export interface SerializedUnresolvedStateRecoveryEntryV2 {
    readonly recoveryId: string;
    /** Exact source-table occurrence; target content alone is not a unique provenance key. */
    readonly sourceTargetRef: SavedTargetRef;
    readonly sourceTarget: SavedStateTargetV2;
    readonly fact: SerializedRecoverableStateFactV2;
    readonly reason: string;
}

export interface SerializedMekRuleCheckEntryV1 {
    readonly key: MekRuleCheckKeyV2;
    readonly token: MekRuleCheckTokenV2;
    readonly trigger: SavedTargetRef;
    readonly openedRevision: number;
    readonly status: MekRuleCheckStatusV2;
}

export interface SerializedMekRuleChecksV1 {
    readonly schemaVersion: 1;
    /** Canonically sorted by key; required even when empty in unit schema V3. */
    readonly entries: readonly SerializedMekRuleCheckEntryV1[];
}

export interface SerializedCBTUnitV2 {
    readonly schemaVersion: typeof CBT_UNIT_PERSISTENCE_SCHEMA_VERSION;
    readonly instanceId: string;
    readonly entity: UnitUuid;
    readonly sourceHashCanary?: SourceHashCanary;
    readonly baselineRefAtSave: SerializedInstanceBaselineRef;
    readonly blueprintReferences: SavedBlueprintReferenceTableV2;
    readonly deployment: SerializedDeploymentConfigurationV2;
    readonly stateRevision: number;
    /** Sparse committed fact; absence is the pristine false baseline. */
    readonly destroyed?: true;
    readonly locationState?: readonly SerializedLocationStateEntryV2[];
    readonly locationConditions?: readonly SerializedLocationConditionStateEntryV2[];
    readonly slotState?: readonly SerializedSlotStateEntryV2[];
    readonly componentState?: readonly SerializedComponentStateEntryV2[];
    readonly ammoState?: readonly SerializedAmmoStateEntryV2[];
    readonly crew: SerializedCrewStateV2;
    readonly heat?: SerializedHeatStateV2;
    readonly family: { readonly kind: 'mek' };
    readonly ruleChecks: SerializedMekRuleChecksV1;
    /** Required sole durable movement/PSR owner. */
    readonly movementPsr: SerializedMekMovementPsrStateV2;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
    readonly conditions?: SerializedCommonConditionStateV2;
    readonly turn: SerializedMekTurnStateV2;
    readonly pendingCombat?: SerializedPendingCombatStateV2;
}

export interface SerializedForceUnitEntryV2 {
    readonly instanceId: string;
    readonly stateRevision: number;
    readonly unit: SerializedCBTUnitV2 | SerializedNonMekUnit;
}

export interface SerializedEncounterNetworkEndpointV2 {
    readonly instanceId: string;
    /** Stable entity component identity. Numeric equipment positions are deliberately forbidden. */
    readonly componentId: ComponentId;
    readonly role: C3NetworkRole;
}

export interface SerializedEncounterNetworkV2 {
    readonly id: string;
    readonly networkType: C3NetworkType;
    readonly color: string;
    readonly endpoints: readonly SerializedEncounterNetworkEndpointV2[];
}

export interface SerializedCBTEncounterStateV2 {
    readonly networks: readonly SerializedEncounterNetworkV2[];
    readonly c3Positions?: readonly C3UnitPosition[];
}

export interface SerializedCBTForceV2 {
    readonly schemaVersion: typeof CBT_FORCE_PERSISTENCE_SCHEMA_VERSION;
    readonly forceId: ForceId;
    readonly forceRevision: number;
    readonly history: SerializedRuntimeHistory;
    readonly units: readonly SerializedForceUnitEntryV2[];
    readonly roster: SerializedCBTForceRosterV1;
    readonly encounter: SerializedCBTEncounterStateV2;
}

export type ForceEnvelopeValidationCode =
    | 'INVALID_SHAPE'
    | 'DUPLICATE_INSTANCE_ID'
    | 'DUPLICATE_ROSTER_GROUP_ID'
    | 'DUPLICATE_ROSTER_MEMBER_ID'
    | 'DANGLING_ROSTER_MEMBER_ID'
    | 'MISSING_ROSTER_MEMBER_ID'
    | 'ROSTER_ORDER_MISMATCH'
    | 'ROSTER_COMMANDER_CONFLICT'
    | 'INSTANCE_ID_MISMATCH'
    | 'REVISION_MISMATCH'
    | 'DESIGN_IDENTITY_MISMATCH'
    | 'DUPLICATE_TARGET_REF'
    | 'DANGLING_TARGET_REF'
    | 'TARGET_KIND_MISMATCH'
    | 'DUPLICATE_STATE_TARGET'
    | 'ENCOUNTER_ENDPOINT_INVALID';

export class ForceEnvelopeValidationError extends Error {
    public constructor(
        public readonly code: ForceEnvelopeValidationCode,
        message: string,
        public readonly path = '$',
    ) {
        super(`${path}: ${message}`);
        this.name = 'ForceEnvelopeValidationError';
    }
}

export function emptyRuntimeHistory(): SerializedRuntimeHistory {
    return Object.freeze({
        [CBT_HISTORY_FIELD.unitIds]: Object.freeze([]),
        [CBT_HISTORY_FIELD.turns]: Object.freeze([]),
    });
}

/** Validates structure, ownership, and identity; failures never partially load. */
export async function validateSerializedCBTForceV2(value: unknown): Promise<SerializedCBTForceV2> {
    let source: Record<string, unknown>;
    try {
        source = requireRecord(structuredClone(value), '$');
    } catch (error) {
        throw validationError('INVALID_SHAPE', error, '$');
    }
    const root: Record<string, unknown> = {
        schemaVersion: source['schemaVersion'],
        forceId: source['forceId'],
        forceRevision: source['forceRevision'],
        history: source['history'],
        units: source['units'],
        roster: source['roster'],
        encounter: source['encounter'],
    };
    validateForceEnvelope(root);
    return deepFreeze(root);
}

function validateForceEnvelope(
    root: Record<string, unknown>,
): asserts root is Record<string, unknown> & SerializedCBTForceV2 {
    if (root['schemaVersion'] !== CBT_FORCE_PERSISTENCE_SCHEMA_VERSION) {
        fail('INVALID_SHAPE', '$.schemaVersion', 'unsupported persistence version');
    }
    validateId(root['forceId'], '$.forceId', asForceId);
    validateRevision(root['forceRevision'], '$.forceRevision');
    const units = requireArray(root['units'], '$.units');
    const instanceIds = new Set<string>();
    units.forEach((entry, index) => {
        const result = validateUnitEntry(entry, index);
        if (instanceIds.has(result.instanceId)) {
            fail('DUPLICATE_INSTANCE_ID', `$.units[${index}].instanceId`, `duplicate instance ${result.instanceId}`);
        }
        instanceIds.add(result.instanceId);
    });

    validateRoster(root['roster'], instanceIds);
    validateEncounter(root['encounter'], instanceIds);
    validateRuntimeHistory(root['history']);
}

function validateRuntimeHistory(value: unknown): void {
    const history = requireRecord(value, '$.history');
    exactKeys(history, Object.values(CBT_HISTORY_FIELD), '$.history');
    const unitIdsPath = `$.history.${CBT_HISTORY_FIELD.unitIds}`;
    const unitIds = requireArray(history[CBT_HISTORY_FIELD.unitIds], unitIdsPath).map((unitId, index) =>
        validateId(unitId, `${unitIdsPath}[${index}]`));
    if (new Set(unitIds).size !== unitIds.length) {
        fail('INVALID_SHAPE', unitIdsPath, 'unit IDs must be unique');
    }
    const turnsPath = `$.history.${CBT_HISTORY_FIELD.turns}`;
    const turns = requireArray(history[CBT_HISTORY_FIELD.turns], turnsPath);
    if (turns.length > 2) {
        fail('INVALID_SHAPE', turnsPath, 'history retains at most the current and previous turn');
    }
    let previousTurn = 0;
    turns.forEach((rawTurn, turnIndex) => {
        const path = `${turnsPath}[${turnIndex}]`;
        const turn = requireRecord(rawTurn, path);
        exactKeys(turn, Object.values(CBT_HISTORY_TURN_FIELD), path);
        const turnNumberPath = `${path}.${CBT_HISTORY_TURN_FIELD.turnNumber}`;
        const number = requirePositiveInteger(turn[CBT_HISTORY_TURN_FIELD.turnNumber], turnNumberPath);
        if (number <= previousTurn) fail('INVALID_SHAPE', turnNumberPath, 'turns must be strictly ordered');
        previousTurn = number;
        const phasesPath = `${path}.${CBT_HISTORY_TURN_FIELD.phases}`;
        const phases = requireArray(turn[CBT_HISTORY_TURN_FIELD.phases], phasesPath);
        if (phases.length === 0) fail('INVALID_SHAPE', phasesPath, 'history turn requires a phase');
        phases.forEach((rawPhase, phaseIndex) => {
            const phasePath = `${phasesPath}[${phaseIndex}]`;
            const messages = requireArray(rawPhase, phasePath);
            if (messages.length === 0) fail('INVALID_SHAPE', phasePath, 'history phases cannot be empty');
            messages.forEach((rawMessage, messageIndex) => {
                const messagePath = `${phasePath}[${messageIndex}]`;
                const message = requireArray(rawMessage, messagePath);
                if (message.length < 1 || message.length > 13) {
                    fail('INVALID_SHAPE', messagePath, 'history messages require 1 to 13 values');
                }
                if (!isRuntimeHistoryMessageId(message[0])) {
                    fail('INVALID_SHAPE', `${messagePath}[0]`, 'is not a supported history message ID');
                }
                message.slice(1).forEach((item, index) => assertJson(item, `${messagePath}[${index + 1}]`));
                const messageId = message[0];
                if (runtimeHistoryMessageRequiresUnit(messageId) && message.length < 2) {
                    fail('INVALID_SHAPE', messagePath, 'unit history message requires a unit index');
                }
                if (runtimeHistoryMessageCanReferenceUnit(messageId) && message.length >= 2) {
                    const unitIndex = message[1];
                    if (!Number.isSafeInteger(unitIndex) || (unitIndex as number) < 0
                        || (unitIndex as number) >= unitIds.length) {
                        fail('INVALID_SHAPE', `${messagePath}[1]`, 'invalid history unit index');
                    }
                }
            });
        });
    });
}

function validateRoster(
    value: unknown,
    instances: ReadonlySet<string>,
): void {
    const roster = requireRecord(value, '$.roster');
    exactKeys(roster, ['schemaVersion', 'groups'], '$.roster');
    if (roster['schemaVersion'] !== CBT_FORCE_ROSTER_SCHEMA_VERSION) {
        fail('INVALID_SHAPE', '$.roster.schemaVersion', `must be ${CBT_FORCE_ROSTER_SCHEMA_VERSION}`);
    }
    const groups = requireArray(roster['groups'], '$.roster.groups');
    const groupIds = new Set<string>();
    const memberIds = new Set<string>();
    groups.forEach((rawGroup, groupIndex) => {
        const path = `$.roster.groups[${groupIndex}]`;
        const group = requireRecord(rawGroup, path);
        exactKeys(group, [
            'groupId', 'order', 'name', 'color', 'formationId', 'formationTargetGroupId',
            'formationLock', 'members',
        ], path);
        const groupId = validateId(group['groupId'], `${path}.groupId`);
        if (groupIds.has(groupId)) {
            fail('DUPLICATE_ROSTER_GROUP_ID', `${path}.groupId`, `duplicate roster group ${groupId}`);
        }
        groupIds.add(groupId);
        if (requireSafeNonnegative(group['order'], `${path}.order`) !== groupIndex) {
            fail('ROSTER_ORDER_MISMATCH', `${path}.order`, 'must equal the canonical group array index');
        }
        validateOptionalCanonicalRosterText(
            group,
            path,
            ['name', 'color', 'formationId', 'formationTargetGroupId'],
        );
        validateSparseRosterTrue(group, 'formationLock', path);
        if (groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) {
            if (groupIndex !== groups.length - 1) {
                fail('ROSTER_ORDER_MISMATCH', path, 'the unassigned roster group must be last');
            }
            if (group['name'] !== undefined
                || group['color'] !== undefined
                || group['formationId'] !== undefined
                || group['formationTargetGroupId'] !== undefined
                || group['formationLock'] !== undefined) {
                fail('INVALID_SHAPE', path, 'the unassigned roster group cannot carry organizational metadata');
            }
        }
        const members = requireArray(group['members'], `${path}.members`);
        let commanderInstanceId: string | undefined;
        members.forEach((rawMember, memberIndex) => {
            const memberPath = `${path}.members[${memberIndex}]`;
            const member = requireRecord(rawMember, memberPath);
            exactKeys(member, ['instanceId', 'order', 'commander'], memberPath);
            const instanceId = validateId(member['instanceId'], `${memberPath}.instanceId`);
            if (memberIds.has(instanceId)) {
                fail(
                    'DUPLICATE_ROSTER_MEMBER_ID',
                    `${memberPath}.instanceId`,
                    `duplicate roster member ${instanceId}`,
                );
            }
            memberIds.add(instanceId);
            if (!instances.has(instanceId)) {
                fail(
                    'DANGLING_ROSTER_MEMBER_ID',
                    `${memberPath}.instanceId`,
                    `roster member ${instanceId} has no force unit entry`,
                );
            }
            if (requireSafeNonnegative(member['order'], `${memberPath}.order`) !== memberIndex) {
                fail('ROSTER_ORDER_MISMATCH', `${memberPath}.order`, 'must equal the canonical member array index');
            }
            validateSparseRosterTrue(member, 'commander', memberPath);
            if (member['commander'] === true) {
                if (commanderInstanceId !== undefined) {
                    fail(
                        'ROSTER_COMMANDER_CONFLICT',
                        `${memberPath}.commander`,
                        `roster group ${groupId} may contain at most one commander; ${instanceId} conflicts with ${commanderInstanceId}`,
                    );
                }
                commanderInstanceId = instanceId;
            }
        });
    });
    groups.forEach((rawGroup, groupIndex) => {
        const group = rawGroup as Record<string, unknown>;
        const targetGroupId = group['formationTargetGroupId'];
        if (targetGroupId === undefined) return;
        const path = `$.roster.groups[${groupIndex}].formationTargetGroupId`;
        if (targetGroupId === group['groupId']
            || targetGroupId === CBT_FORCE_UNASSIGNED_GROUP_ID
            || !groupIds.has(targetGroupId as string)) {
            fail('INVALID_SHAPE', path, 'must reference another regular roster group');
        }
    });
    for (const instanceId of instances) {
        if (!memberIds.has(instanceId)) {
            fail(
                'MISSING_ROSTER_MEMBER_ID',
                '$.roster.groups',
                `force unit ${instanceId} has no roster member`,
            );
        }
    }
}

function validateOptionalCanonicalRosterText(
    record: Record<string, unknown>,
    path: string,
    keys: readonly ('name' | 'color' | 'formationId' | 'formationTargetGroupId')[],
): void {
    for (const key of keys) {
        if (record[key] !== undefined) {
            validateBoundedText(record[key], `${path}.${key}`, 1, MAX_CBT_FORCE_ROSTER_METADATA_LENGTH);
        }
    }
}

function validateSparseRosterTrue(
    record: Record<string, unknown>,
    key: 'formationLock' | 'commander',
    path: string,
): void {
    if (record[key] !== undefined && record[key] !== true) {
        fail('INVALID_SHAPE', `${path}.${key}`, 'sparse organizational flag must be true when present');
    }
}

interface ValidatedUnitEntry {
    readonly instanceId: string;
}

function validateUnitEntry(
    value: unknown,
    index: number,
): ValidatedUnitEntry {
    const path = `$.units[${index}]`;
    const record = requireRecord(value, path);
    exactKeys(record, ['instanceId', 'stateRevision', 'unit'], path);
    const instanceId = validateId(record['instanceId'], `${path}.instanceId`);
    const revision = validateRevision(record['stateRevision'], `${path}.stateRevision`);
    const unit = requireRecord(record['unit'], `${path}.unit`);
    const family = requireRecord(unit['family'], `${path}.unit.family`);
    const result = family['kind'] === 'non-mek'
        ? validateNonMekUnit(unit, `${path}.unit`)
        : validateV2Unit(unit, `${path}.unit`);
    if (result.instanceId !== instanceId) {
        fail('INSTANCE_ID_MISMATCH', `${path}.unit.instanceId`, 'outer and unit instance IDs differ');
    }
    if (result.revision !== revision) {
        fail('REVISION_MISMATCH', `${path}.unit.stateRevision`, 'outer and unit revisions differ');
    }
    return { instanceId };
}

function validateNonMekUnit(
    value: unknown,
    path: string,
): {
    readonly instanceId: string;
    readonly revision: number;
} {
    try {
        const inspected = inspectSerializedNonMekUnit(value);
        return {
            instanceId: inspected.instanceId,
            revision: inspected.stateRevision,
        };
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            path,
            error instanceof Error ? error.message : 'invalid non-Mek non-Mek unit',
        );
    }
}

function validateV2Unit(
    value: unknown,
    path: string,
): {
    readonly instanceId: string;
    readonly revision: number;
} {
    const record = requireRecord(value, path);
    exactKeys(record, [
        'schemaVersion', 'instanceId', 'entity', 'sourceHashCanary', 'baselineRefAtSave', 'blueprintReferences', 'deployment',
        'stateRevision', 'destroyed', 'locationState', 'locationConditions', 'slotState', 'componentState', 'ammoState', 'crew', 'heat',
        'family', 'ruleChecks', 'movementPsr',
        'equipmentRowOrder', 'conditions', 'turn', 'pendingCombat',
    ], path);
    if (record['schemaVersion'] !== CBT_UNIT_PERSISTENCE_SCHEMA_VERSION) {
        fail('INVALID_SHAPE', `${path}.schemaVersion`, `must be ${CBT_UNIT_PERSISTENCE_SCHEMA_VERSION}`);
    }
    const instanceId = validateId(record['instanceId'], `${path}.instanceId`);
    const entity = validateSavedIdentity(record['entity'], `${path}.entity`);
    if (record['sourceHashCanary'] !== undefined) {
        try {
            asSourceHashCanary(requireString(record, 'sourceHashCanary', path));
        } catch {
            fail('INVALID_SHAPE', `${path}.sourceHashCanary`, 'must be a four-character base64url canary');
        }
    }
    const baseline = validateBaseline(record['baselineRefAtSave'], `${path}.baselineRefAtSave`);
    if (entity !== baseline.uuid) {
        fail('DESIGN_IDENTITY_MISMATCH', `${path}.baselineRefAtSave.entity`, 'saved entity and baseline identify different designs');
    }
    const savedTargets = validateSavedBlueprintReferenceTableV2(
        record['blueprintReferences'],
        `${path}.blueprintReferences`,
    );
    const referencesOmitted = Object.keys(savedTargets).length === 0;
    const targets = referencesOmitted ? inferActiveSavedTargets(record) : savedTargets;
    validateDeployment(record['deployment'], `${path}.deployment`, targets);
    const revision = validateRevision(record['stateRevision'], `${path}.stateRevision`);
    if (record['destroyed'] !== undefined && record['destroyed'] !== true) {
        fail('INVALID_SHAPE', `${path}.destroyed`, 'sparse destroyed state must be true when present');
    }

    validateTargetStateArray(record['locationState'], `${path}.locationState`, targets, ['location-section'], validateLocationState);
    validateLocationConditionStateArray(
        record['locationConditions'],
        `${path}.locationConditions`,
        targets,
        false,
    );
    validateTargetStateArray(record['slotState'], `${path}.slotState`, targets, ['critical-slot'], validateSlotState);
    validateTargetStateArray(record['componentState'], `${path}.componentState`, targets, ['component', 'intrinsic-system'], validateComponentState);
    validateTargetStateArray(record['ammoState'], `${path}.ammoState`, targets, ['ammo-source'], validateAmmoState);
    validateCrew(record['crew'], `${path}.crew`, targets);
    if (record['heat'] !== undefined) {
        const heat = requireRecord(record['heat'], `${path}.heat`);
        exactKeys(heat, ['heat', 'previous', 'pendingOverride', 'heatsinksOff'], `${path}.heat`);
        const value = requireFiniteNumber(heat['heat'], `${path}.heat.heat`);
        if (value < 0 || value > MAX_MEK_HEAT_VALUE_V2 || Object.is(value, -0)) {
            fail('INVALID_SHAPE', `${path}.heat.heat`, 'must be a canonical bounded heat value');
        }
        if (heat['previous'] !== undefined) {
            const previous = requireFiniteNumber(heat['previous'], `${path}.heat.previous`);
            if (previous <= 0 || previous > MAX_MEK_HEAT_VALUE_V2 || Object.is(previous, -0)) {
                fail('INVALID_SHAPE', `${path}.heat.previous`, 'sparse previous heat must be positive and bounded');
            }
        }
        if (heat['pendingOverride'] !== undefined) {
            const pending = requireFiniteNumber(heat['pendingOverride'], `${path}.heat.pendingOverride`);
            if (pending < 0 || pending > MAX_MEK_HEAT_VALUE_V2 || Object.is(pending, -0)) {
                fail('INVALID_SHAPE', `${path}.heat.pendingOverride`, 'must be a canonical bounded heat value');
            }
        }
        if (heat['heatsinksOff'] !== undefined) {
            const off = requireFiniteNumber(heat['heatsinksOff'], `${path}.heat.heatsinksOff`);
            if (!Number.isSafeInteger(off) || off <= 0 || off > MAX_MEK_HEATSINKS_OFF_V2) {
                fail(
                    'INVALID_SHAPE',
                    `${path}.heat.heatsinksOff`,
                    'sparse heatsinks-off count must be a bounded positive integer',
                );
            }
        }
    }
    const family = requireRecord(record['family'], `${path}.family`);
    exactKeys(family, ['kind'], `${path}.family`);
    if (family['kind'] !== 'mek') fail('INVALID_SHAPE', `${path}.family.kind`, 'only Mek semantic V2 state is supported');
    validateMekRuleChecks(record['ruleChecks'], `${path}.ruleChecks`, targets, revision);
    {
        let movementPsr: SerializedMekMovementPsrStateV2;
        try {
            const canonical = deserializeMekMovementPsrStateV2(record['movementPsr']);
            movementPsr = serializeMekMovementPsrStateV2(canonical);
        } catch (error) {
            fail(
                'INVALID_SHAPE',
                `${path}.movementPsr`,
                error instanceof Error ? error.message : 'invalid Mek movement/PSR state',
            );
        }
        // Compact storage omits Entity topology. Exact ownership is checked after
        // the native source is loaded and its transient reference table rebuilt.
        if (!referencesOmitted) {
            assertMovementPsrIdsOwnedByReferences(
                movementPsr,
                targets,
                `${path}.movementPsr`,
            );
        }
    }
    if (record['equipmentRowOrder'] !== undefined) {
        const order = requireRecord(record['equipmentRowOrder'], `${path}.equipmentRowOrder`);
        try {
            freezeEquipmentRowOrder(order as EquipmentRowOrderState);
        } catch (error) {
            fail(
                'INVALID_SHAPE',
                `${path}.equipmentRowOrder`,
                error instanceof Error ? error.message : 'invalid equipment row order',
            );
        }
    }
    try {
        deserializeMekTurnStateV2(record['turn']);
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            `${path}.turn`,
            error instanceof Error ? error.message : 'invalid Mek turn state',
        );
    }
    if (record['conditions'] !== undefined) {
        const conditions = requireRecord(record['conditions'], `${path}.conditions`);
        exactKeys(conditions, ['values'], `${path}.conditions`);
        validateUniqueSortedUnitConditions(conditions['values'], `${path}.conditions.values`);
    }
    if (record['pendingCombat'] !== undefined) validatePending(record['pendingCombat'], `${path}.pendingCombat`, targets);
    return {
        instanceId,
        revision,
    };
}

function validateDeployment(
    value: unknown,
    path: string,
    _targets: Record<string, SavedStateTargetV2>,
): void {
    const deployment = requireRecord(value, path);
    exactKeys(deployment, ['schemaVersion', 'values'], path);
    if (deployment['schemaVersion'] !== MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION) {
        fail(
            'INVALID_SHAPE',
            `${path}.schemaVersion`,
            `must be ${MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION}; older crew-less V2 deployments are not guessed`,
        );
    }
    const values = requireRecord(deployment['values'], `${path}.values`);
    exactKeys(values, ['id', 'initialHeat', 'crewAssignment'], `${path}.values`);
    validateId(values['id'], `${path}.values.id`);
    if (values['initialHeat'] !== undefined) {
        requireSafeNonnegative(values['initialHeat'], `${path}.values.initialHeat`);
    }
    try {
        const assignment = requireRecord(
            values['crewAssignment'],
            `${path}.values.crewAssignment`,
        );
        const positions = requireArray(
            assignment['positions'],
            `${path}.values.crewAssignment.positions`,
        );
        const topology = new Map<CrewPositionId, CrewPositionDefinition>();
        positions.forEach((rawPosition, occurrence) => {
            const position = requireRecord(
                rawPosition,
                `${path}.values.crewAssignment.positions[${occurrence}]`,
            );
            const id = asCrewPositionId(validateId(
                position['positionId'],
                `${path}.values.crewAssignment.positions[${occurrence}].positionId`,
            ));
            if (topology.has(id)) throw new Error(`duplicate crew position ${id}`);
            topology.set(id, Object.freeze({ id, occurrence }));
        });
        assertCanonicalCrewAssignment(
            topology,
            values['crewAssignment'] as CrewAssignment,
        );
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            `${path}.values.crewAssignment`,
            error instanceof Error ? error.message : 'invalid crew assignment',
        );
    }
}

interface ValidatedBaseline {
    readonly uuid: string;
    readonly entity: UnitUuid;
}

function validateBaseline(value: unknown, path: string): ValidatedBaseline {
    const record = requireRecord(value, path);
    exactKeys(record, ['entity', 'initialStateProfile'], path);
    const entity = validateSavedIdentity(record['entity'], `${path}.entity`);
    const profile = requireRecord(record['initialStateProfile'], `${path}.initialStateProfile`);
    exactKeys(profile, ['schemaVersion', 'initializerRevision', 'profileId'], `${path}.initialStateProfile`);
    if (profile['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.initialStateProfile.schemaVersion`, 'must be 1');
    requirePositiveInteger(profile['initializerRevision'], `${path}.initialStateProfile.initializerRevision`);
    validateId(profile['profileId'], `${path}.initialStateProfile.profileId`);
    return {
        uuid: entity,
        entity,
    };
}

function validateSavedIdentity(value: unknown, path: string): UnitUuid {
    if (typeof value !== 'string') fail('INVALID_SHAPE', path, 'must be a UUID string');
    try {
        return asUnitUuid(value);
    } catch (error) {
        throw validationError('INVALID_SHAPE', error, path);
    }
}

export function validateSavedBlueprintReferenceTableV2(
    value: unknown,
    path: string,
): Record<string, SavedStateTargetV2> {
    const record = requireRecord(value, path);
    exactKeys(record, ['schemaVersion', 'targets'], path);
    if (record['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    const targets = requireRecord(record['targets'], `${path}.targets`);
    for (const [ref, target] of Object.entries(targets)) {
        validateId(ref, `${path}.targets key`, asSavedTargetRef);
        validateSavedTarget(target, `${path}.targets.${ref}`, targets);
    }
    return targets as Record<string, SavedStateTargetV2>;
}

function validateSavedTarget(value: unknown, path: string, table: Record<string, unknown>): void {
    const target = requireRecord(value, path);
    switch (target['kind']) {
        case 'critical-slot':
            exactKeys(target, ['kind', 'savedSlotId', 'location', 'slot', 'expectedSystemId', 'expectedEquipmentName'], path);
            validateId(target['location'], `${path}.location`);
            validateOrdinal(target['slot'], `${path}.slot`);
            validateOptionalStringFields(target, path, ['savedSlotId', 'expectedSystemId', 'expectedEquipmentName']);
            return;
        case 'location-section':
            exactKeys(target, ['kind', 'location', 'section'], path);
            validateId(target['location'], `${path}.location`);
            if (!['internal', 'front-armor', 'rear-armor'].includes(String(target['section']))) fail('INVALID_SHAPE', `${path}.section`, 'invalid section');
            return;
        case 'component':
            exactKeys(target, ['kind', 'savedComponentId', 'equipmentName', 'locations', 'criticalSlots', 'occurrence'], path);
            validateId(target['equipmentName'], `${path}.equipmentName`);
            validateOptionalStringFields(target, path, ['savedComponentId']);
            validateStringArray(target['locations'], `${path}.locations`);
            validateSlotCoordinates(target['criticalSlots'], `${path}.criticalSlots`);
            validateOptionalNonnegative(target, path, ['occurrence']);
            return;
        case 'ammo-source': {
            exactKeys(target, ['kind', 'savedAmmoSourceId', 'source', 'location', 'criticalSlots', 'occurrence', 'capacityAtSave', 'munitionAtSave'], path);
            const source = requireRecord(target['source'], `${path}.source`);
            if (source['kind'] === 'installed-bin') {
                exactKeys(source, ['kind', 'savedComponentId', 'equipmentName'], `${path}.source`);
                validateOptionalStringFields(source, `${path}.source`, ['savedComponentId']);
            } else if (source['kind'] === 'intrinsic-magazine' || source['kind'] === 'one-shot') {
                exactKeys(source, ['kind', 'ownerComponentTarget', 'equipmentName'], `${path}.source`);
                const owner = validateId(source['ownerComponentTarget'], `${path}.source.ownerComponentTarget`, asSavedTargetRef);
                const ownerTarget = table[owner];
                if (!isRecord(ownerTarget) || (ownerTarget['kind'] !== 'component' && ownerTarget['kind'] !== 'intrinsic-system')) {
                    fail('DANGLING_TARGET_REF', `${path}.source.ownerComponentTarget`, 'owner is missing or not a component');
                }
            } else fail('INVALID_SHAPE', `${path}.source.kind`, 'invalid ammo source kind');
            validateId(source['equipmentName'], `${path}.source.equipmentName`);
            if (target['location'] !== undefined) validateId(target['location'], `${path}.location`);
            validateSlotCoordinates(target['criticalSlots'], `${path}.criticalSlots`);
            validateOptionalStringFields(target, path, ['savedAmmoSourceId', 'location', 'munitionAtSave']);
            validateOptionalNonnegative(target, path, ['occurrence', 'capacityAtSave']);
            return;
        }
        case 'intrinsic-system':
            exactKeys(target, ['kind', 'savedComponentId', 'systemKey', 'locations', 'criticalSlots'], path);
            validateId(target['systemKey'], `${path}.systemKey`);
            validateStringArray(target['locations'], `${path}.locations`);
            validateSlotCoordinates(target['criticalSlots'], `${path}.criticalSlots`);
            validateOptionalStringFields(target, path, ['savedComponentId']);
            return;
        case 'crew-position':
            exactKeys(target, ['kind', 'savedCrewPositionId', 'positionKey', 'occurrence'], path);
            validateId(target['positionKey'], `${path}.positionKey`);
            validateOptionalStringFields(target, path, ['savedCrewPositionId']);
            validateOptionalNonnegative(target, path, ['occurrence']);
            return;
        default:
            fail('INVALID_SHAPE', `${path}.kind`, 'unknown saved target kind');
    }
}

function validateTargetStateArray(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    allowedKinds: readonly SavedStateTargetV2['kind'][],
    validateEntry: (entry: Record<string, unknown>, path: string) => void,
): void {
    if (value === undefined) return;
    const entries = requireArray(value, path);
    const seen = new Set<string>();
    let previous: string | undefined;
    entries.forEach((valueEntry, index) => {
        const entryPath = `${path}[${index}]`;
        const entry = requireRecord(valueEntry, entryPath);
        const ref = validateId(entry['target'], `${entryPath}.target`, asSavedTargetRef);
        if (seen.has(ref)) fail('DUPLICATE_STATE_TARGET', `${entryPath}.target`, `duplicate state for ${ref}`);
        if (previous !== undefined && previous >= ref) fail('INVALID_SHAPE', `${entryPath}.target`, 'state entries must be sorted by target');
        seen.add(ref);
        previous = ref;
        const target = targets[ref];
        if (!target) fail('DANGLING_TARGET_REF', `${entryPath}.target`, `unknown target ${ref}`);
        if (!allowedKinds.includes(target.kind)) fail('TARGET_KIND_MISMATCH', `${entryPath}.target`, `target ${ref} has kind ${target.kind}`);
        validateEntry(entry, entryPath);
    });
}

function validateMekRuleChecks(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    unitRevision: number,
): void {
    const checks = requireRecord(value, path);
    exactKeys(checks, ['schemaVersion', 'entries'], path);
    if (checks['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    const entries = requireArray(checks['entries'], `${path}.entries`);
    if (entries.length > 1) fail('INVALID_SHAPE', `${path}.entries`, 'only the typed torso check is supported');
    let previous: string | undefined;
    entries.forEach((raw, index) => {
        const entryPath = `${path}.entries[${index}]`;
        const entry = requireRecord(raw, entryPath);
        exactKeys(entry, ['key', 'token', 'trigger', 'openedRevision', 'status'], entryPath);
        if (entry['key'] !== 'core.torso-crippling') {
            fail('INVALID_SHAPE', `${entryPath}.key`, 'unknown Mek rule-check key');
        }
        const key = String(entry['key']);
        if (previous !== undefined && previous >= key) {
            fail('INVALID_SHAPE', `${entryPath}.key`, 'rule checks must be unique and sorted by key');
        }
        previous = key;
        validateId(entry['token'], `${entryPath}.token`);
        const trigger = validateId(entry['trigger'], `${entryPath}.trigger`, asSavedTargetRef);
        const target = targets[trigger];
        if (!target) fail('DANGLING_TARGET_REF', `${entryPath}.trigger`, `unknown target ${trigger}`);
        if (target.kind !== 'location-section' || target.section !== 'internal') {
            fail('TARGET_KIND_MISMATCH', `${entryPath}.trigger`, 'torso check requires an internal location target');
        }
        const openedRevision = validateRevision(entry['openedRevision'], `${entryPath}.openedRevision`);
        if (openedRevision > unitRevision) {
            fail('INVALID_SHAPE', `${entryPath}.openedRevision`, 'cannot exceed the unit revision');
        }
        if (entry['status'] !== 'pending' && entry['status'] !== 'success' && entry['status'] !== 'failed') {
            fail('INVALID_SHAPE', `${entryPath}.status`, 'unknown Mek rule-check status');
        }
    });
}

function validateLocationState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'damage'], path);
    requirePositiveInteger(entry['damage'], `${path}.damage`);
}

function validateLocationConditionStateArray(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    pending: boolean,
): void {
    if (value === undefined) return;
    const entries = requireArray(value, path);
    let previous: string | undefined;
    entries.forEach((raw, index) => {
        const entryPath = `${path}[${index}]`;
        const entry = requireRecord(raw, entryPath);
        exactKeys(entry, ['target', 'condition', 'value'], entryPath);
        const ref = validateId(entry['target'], `${entryPath}.target`, asSavedTargetRef);
        const target = targets[ref];
        if (!target) fail('DANGLING_TARGET_REF', `${entryPath}.target`, `unknown target ${ref}`);
        if (target.kind !== 'location-section' || target.section !== 'internal') {
            fail('TARGET_KIND_MISMATCH', `${entryPath}.target`, 'location conditions require an internal location-section target');
        }
        const condition = validateMekLocationConditionKey(entry['condition'], `${entryPath}.condition`);
        validateMekLocationConditionValue(entry['value'], condition, `${entryPath}.value`, pending);
        const coordinate = `${ref}\0${condition}`;
        if (previous !== undefined && previous >= coordinate) {
            fail('INVALID_SHAPE', entryPath, 'location condition entries must be unique and sorted by target then condition');
        }
        previous = coordinate;
    });
}

function validateMekLocationConditionKey(value: unknown, path: string): MekLocationConditionKey {
    if (!isMekLocationConditionKey(value)) {
        fail('INVALID_SHAPE', path, 'unknown Mek location condition');
    }
    return value;
}

function validateMekLocationConditionValue(
    value: unknown,
    condition: MekLocationConditionKey,
    path: string,
    pending: boolean,
): number {
    const normalized = requireSafeNonnegative(value, path);
    if (!pending && normalized === 0) fail('INVALID_SHAPE', path, 'committed sparse condition values must be positive');
    if ((condition === 'blown-off' || condition === 'flooded') && normalized > 1) {
        fail('INVALID_SHAPE', path, 'boolean location condition values must be 0 or 1');
    }
    if (normalized > MAX_MEK_LOCATION_CONDITION_VALUE) {
        fail('INVALID_SHAPE', path, `location condition values must not exceed ${MAX_MEK_LOCATION_CONDITION_VALUE}`);
    }
    return normalized;
}

function validateSlotState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'hits', 'destroyedTurn'], path);
    requirePositiveInteger(entry['hits'], `${path}.hits`);
    if (entry['destroyedTurn'] !== undefined) {
        requirePositiveInteger(entry['destroyedTurn'], `${path}.destroyedTurn`);
    }
}

function validateComponentState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'statusOverride', 'mode', 'jammed', 'escalatingFailure', 'ppcCapacitor', 'bombastLaser', 'c3EmergencyMaster', 'gaussPower', 'shieldDamage', 'modularArmorDamage'], path);
    if (entry['statusOverride'] !== undefined && entry['statusOverride'] !== 'disabled' && entry['statusOverride'] !== 'destroyed') {
        fail('INVALID_SHAPE', `${path}.statusOverride`, 'must be disabled or destroyed');
    }
    if (entry['mode'] !== undefined) validateId(entry['mode'], `${path}.mode`);
    if (entry['jammed'] !== undefined && entry['jammed'] !== true) {
        fail('INVALID_SHAPE', `${path}.jammed`, 'sparse jam state must be true');
    }
    validateEscalatingFailure(entry['escalatingFailure'], `${path}.escalatingFailure`);
    validatePpcCapacitor(entry['ppcCapacitor'], `${path}.ppcCapacitor`);
    validateBombastLaser(entry['bombastLaser'], `${path}.bombastLaser`);
    validateC3EmergencyMaster(entry['c3EmergencyMaster'], `${path}.c3EmergencyMaster`);
    validateGaussPower(entry['gaussPower'], `${path}.gaussPower`);
    validateShieldDamage(entry['shieldDamage'], `${path}.shieldDamage`, false);
    if (entry['modularArmorDamage'] !== undefined) {
        requirePositiveInteger(entry['modularArmorDamage'], `${path}.modularArmorDamage`);
    }
    if (entry['statusOverride'] === undefined && entry['mode'] === undefined && entry['jammed'] === undefined
        && entry['escalatingFailure'] === undefined && entry['ppcCapacitor'] === undefined
        && entry['bombastLaser'] === undefined && entry['c3EmergencyMaster'] === undefined
        && entry['gaussPower'] === undefined && entry['shieldDamage'] === undefined
        && entry['modularArmorDamage'] === undefined) {
        fail('INVALID_SHAPE', path, 'sparse component state must contain a fact');
    }
}

function validateShieldDamage(value: unknown, path: string, pending: boolean): void {
    if (value === undefined) return;
    const damage = requireRecord(value, path);
    exactKeys(damage, ['absorptionDamage', 'capacityDamage'], path);
    const absorption = pending
        ? requireSafeInteger(damage['absorptionDamage'], `${path}.absorptionDamage`)
        : requireSafeNonnegative(damage['absorptionDamage'], `${path}.absorptionDamage`);
    const capacity = pending
        ? requireSafeInteger(damage['capacityDamage'], `${path}.capacityDamage`)
        : requireSafeNonnegative(damage['capacityDamage'], `${path}.capacityDamage`);
    if (absorption === 0 && capacity === 0) {
        fail('INVALID_SHAPE', path, 'sparse shield damage must contain a nonzero value');
    }
}

function validateEscalatingFailure(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['sequence', 'active'], path);
    const sequence = requirePositiveInteger(lifecycle['sequence'], `${path}.sequence`);
    if (sequence > 5) fail('INVALID_SHAPE', `${path}.sequence`, 'must be from 1 to 5');
    if (lifecycle['active'] !== undefined && lifecycle['active'] !== true) {
        fail('INVALID_SHAPE', `${path}.active`, 'sparse active state must be true');
    }
}

function validatePpcCapacitor(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['weaponId', 'chargeState', 'firedThisTurn'], path);
    validateId(lifecycle['weaponId'], `${path}.weaponId`, asComponentId);
    if (lifecycle['chargeState'] !== undefined
        && lifecycle['chargeState'] !== 'charging'
        && lifecycle['chargeState'] !== 'charged') {
        fail('INVALID_SHAPE', `${path}.chargeState`, 'must be charging or charged');
    }
    if (lifecycle['firedThisTurn'] !== undefined && lifecycle['firedThisTurn'] !== true) {
        fail('INVALID_SHAPE', `${path}.firedThisTurn`, 'sparse fired state must be true');
    }
    if ((lifecycle['chargeState'] === undefined && lifecycle['firedThisTurn'] === undefined)
        || (lifecycle['chargeState'] !== undefined && lifecycle['firedThisTurn'] !== undefined)) {
        fail('INVALID_SHAPE', path, 'must contain exactly one charge or fired fact');
    }
}

function validateBombastLaser(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['chargeState', 'firedThisTurn'], path);
    if (lifecycle['chargeState'] !== undefined
        && lifecycle['chargeState'] !== 'charging'
        && lifecycle['chargeState'] !== 'charged') {
        fail('INVALID_SHAPE', `${path}.chargeState`, 'must be charging or charged');
    }
    if (lifecycle['firedThisTurn'] !== undefined && lifecycle['firedThisTurn'] !== true) {
        fail('INVALID_SHAPE', `${path}.firedThisTurn`, 'sparse fired state must be true');
    }
    if ((lifecycle['chargeState'] === undefined && lifecycle['firedThisTurn'] === undefined)
        || (lifecycle['chargeState'] !== undefined && lifecycle['firedThisTurn'] !== undefined)) {
        fail('INVALID_SHAPE', path, 'must contain exactly one charge or fired fact');
    }
}

function validateC3EmergencyMaster(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['mode', 'operatingTurns'], path);
    if (lifecycle['mode'] !== undefined
        && lifecycle['mode'] !== 'on'
        && lifecycle['mode'] !== 'off') {
        fail('INVALID_SHAPE', `${path}.mode`, 'must be on or off');
    }
    if (lifecycle['operatingTurns'] !== undefined) {
        const turns = requirePositiveInteger(lifecycle['operatingTurns'], `${path}.operatingTurns`);
        if (turns > 7) fail('INVALID_SHAPE', `${path}.operatingTurns`, 'must be from 1 to 7');
    }
    if (lifecycle['mode'] === undefined && lifecycle['operatingTurns'] === undefined) {
        fail('INVALID_SHAPE', path, 'sparse C3 Emergency Master state must contain a fact');
    }
}

function validateGaussPower(value: unknown, path: string): void {
    if (value === undefined) return;
    if (value !== 'Powering Down' && value !== 'Powered Down' && value !== 'Powering Up') {
        fail('INVALID_SHAPE', path, 'must be Powering Down, Powered Down, or Powering Up');
    }
}

function validateAmmoState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'shotsSpent', 'munitionOverride'], path);
    const shotsSpent = requireSafeNonnegative(entry['shotsSpent'], `${path}.shotsSpent`);
    if (entry['munitionOverride'] !== undefined) validateId(entry['munitionOverride'], `${path}.munitionOverride`);
    if (shotsSpent === 0 && entry['munitionOverride'] === undefined) {
        fail('INVALID_SHAPE', path, 'sparse ammunition state must contain a fact');
    }
}

function validateCrew(value: unknown, path: string, targets: Record<string, SavedStateTargetV2>): void {
    const crew = requireRecord(value, path);
    exactKeys(crew, ['schemaVersion', 'positions'], path);
    if (crew['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    validateTargetStateArray(crew['positions'], `${path}.positions`, targets, ['crew-position'], (entry, entryPath) => {
        exactKeys(entry, [
            'target', 'wounds', 'unconscious', 'dead', 'ejected', 'recoveryReadyTurn',
        ], entryPath);
        const wounds = requireSafeNonnegative(entry['wounds'], `${entryPath}.wounds`);
        if (typeof entry['unconscious'] !== 'boolean') fail('INVALID_SHAPE', `${entryPath}.unconscious`, 'must be boolean');
        if (entry['dead'] !== undefined && entry['dead'] !== true) {
            fail('INVALID_SHAPE', `${entryPath}.dead`, 'sparse dead state must be true');
        }
        if (entry['ejected'] !== undefined && entry['ejected'] !== true) {
            fail('INVALID_SHAPE', `${entryPath}.ejected`, 'sparse ejected state must be true');
        }
        if (entry['dead'] === true && wounds < MAX_CREW_WOUNDS) {
            fail('INVALID_SHAPE', entryPath, 'committed crew death requires fatal wounds');
        }
        if (entry['recoveryReadyTurn'] !== undefined
            && entry['recoveryReadyTurn'] !== null) {
            requireSafeNonnegative(entry['recoveryReadyTurn'], `${entryPath}.recoveryReadyTurn`);
        }
        if (entry['recoveryReadyTurn'] !== undefined && entry['unconscious'] !== true) {
            fail('INVALID_SHAPE', `${entryPath}.recoveryReadyTurn`, 'requires unconscious crew');
        }
        if (entry['wounds'] === 0 && entry['unconscious'] === false && entry['ejected'] !== true) {
            fail('INVALID_SHAPE', entryPath, 'sparse crew state must contain a fact');
        }
    });
}

function validatePending(value: unknown, path: string, targets: Record<string, SavedStateTargetV2>): void {
    const pending = requireRecord(value, path);
    exactKeys(pending, ['locationDamage', 'locationConditions', 'slotHits', 'componentStatus', 'shieldDamage', 'modularArmorDamage'], path);
    validateTargetStateArray(pending['locationDamage'], `${path}.locationDamage`, targets, ['location-section'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'damage'], entryPath);
        requireSignedSparseDelta(entry['damage'], `${entryPath}.damage`);
    });
    validateLocationConditionStateArray(
        pending['locationConditions'],
        `${path}.locationConditions`,
        targets,
        true,
    );
    validateTargetStateArray(pending['slotHits'], `${path}.slotHits`, targets, ['critical-slot'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'hits'], entryPath);
        requireSignedSparseDelta(entry['hits'], `${entryPath}.hits`);
    });
    validateTargetStateArray(pending['componentStatus'], `${path}.componentStatus`, targets, ['component', 'intrinsic-system'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'status'], entryPath);
        if (!['available', 'disabled', 'destroyed'].includes(String(entry['status']))) fail('INVALID_SHAPE', `${entryPath}.status`, 'invalid equipment status');
    });
    validateTargetStateArray(pending['shieldDamage'], `${path}.shieldDamage`, targets, ['component'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'absorptionDamage', 'capacityDamage'], entryPath);
        validateShieldDamage({
            absorptionDamage: entry['absorptionDamage'],
            capacityDamage: entry['capacityDamage'],
        }, entryPath, true);
    });
    validateTargetStateArray(pending['modularArmorDamage'], `${path}.modularArmorDamage`, targets, ['component'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'damage'], entryPath);
        requireSignedSparseDelta(entry['damage'], `${entryPath}.damage`);
    });
}

function assertMovementPsrIdsOwnedByReferences(
    serialized: SerializedMekMovementPsrStateV2,
    targets: Readonly<Record<string, SavedStateTargetV2>>,
    path: string,
): void {
    const state = deserializeMekMovementPsrStateV2(serialized);
    const componentIds = new Set<string>();
    const slotIds = new Set<string>();
    const locationIds = new Set<string>();
    for (const [targetRef, target] of Object.entries(targets)) {
        if ((target.kind === 'component' || target.kind === 'intrinsic-system')
            && target.savedComponentId !== undefined) {
            const id = validateId(target.savedComponentId, `${path}.references.${targetRef}.savedComponentId`, asComponentId);
            if (componentIds.has(id)) {
                fail('DUPLICATE_TARGET_REF', `${path}.references.${targetRef}.savedComponentId`, 'duplicate component identity');
            }
            componentIds.add(id);
        }
        if (target.kind === 'critical-slot' && target.savedSlotId !== undefined) {
            const id = validateId(target.savedSlotId, `${path}.references.${targetRef}.savedSlotId`, asCriticalSlotId);
            if (slotIds.has(id)) {
                fail('DUPLICATE_TARGET_REF', `${path}.references.${targetRef}.savedSlotId`, 'duplicate critical-slot identity');
            }
            slotIds.add(id);
        }
        if (target.kind === 'location-section') {
            locationIds.add(validateId(target.location, `${path}.references.${targetRef}.location`, asLocationId));
        }
    }
    const requiredComponents = new Set<string>(state.movement?.boosterComponentIds ?? []);
    const requiredSlots = new Set<string>();
    const requiredLocations = new Set<string>();
    for (const check of state.checks) {
        for (const id of check.source.criticalSlotIds) requiredSlots.add(id);
        for (const id of check.source.locationIds) requiredLocations.add(id);
    }
    for (const id of requiredComponents) {
        if (!componentIds.has(id)) fail('DANGLING_TARGET_REF', path, `movement references unknown component ${id}`);
    }
    for (const id of requiredSlots) {
        if (!slotIds.has(id)) fail('DANGLING_TARGET_REF', path, `pilot check references unknown critical slot ${id}`);
    }
    for (const id of requiredLocations) {
        if (!locationIds.has(id)) fail('DANGLING_TARGET_REF', path, `pilot check references unknown location ${id}`);
    }
}

function validateEncounter(
    value: unknown,
    instances: ReadonlySet<string>,
): void {
    const encounter = requireRecord(value, '$.encounter');
    exactKeys(encounter, ['networks', 'c3Positions'], '$.encounter');
    validateEncounterC3Positions(encounter['c3Positions'], '$.encounter.c3Positions', instances);
    const networks = requireArray(encounter['networks'], '$.encounter.networks');
    if (networks.length > MAX_SERIALIZED_ENCOUNTER_NETWORKS) {
        fail(
            'INVALID_SHAPE',
            '$.encounter.networks',
            `cannot contain more than ${MAX_SERIALIZED_ENCOUNTER_NETWORKS} networks`,
        );
    }
    const networkIds = new Set<string>();
    let previous: string | undefined;
    networks.forEach((network, index) => {
        const path = `$.encounter.networks[${index}]`;
        const networkId = validateEncounterNetwork(network, path, instances);
        if (networkIds.has(networkId)) fail('INVALID_SHAPE', `${path}.id`, 'duplicate encounter network ID');
        if (previous !== undefined && previous >= networkId) {
            fail('INVALID_SHAPE', `${path}.id`, 'encounter networks must be sorted by ID');
        }
        networkIds.add(networkId);
        previous = networkId;
    });
}

function validateEncounterC3Positions(
    value: unknown,
    path: string,
    instances: ReadonlySet<string>,
): void {
    if (value === undefined) return;
    const positions = requireArray(value, path);
    if (positions.length > instances.size) {
        fail('INVALID_SHAPE', path, 'cannot contain more positions than force units');
    }
    const unitIds = new Set<string>();
    let previous: string | undefined;
    positions.forEach((raw, index) => {
        const positionPath = `${path}[${index}]`;
        const position = requireRecord(raw, positionPath);
        exactKeys(position, ['unitId', 'x', 'y'], positionPath);
        const unitId = validateId(position['unitId'], `${positionPath}.unitId`);
        if (!instances.has(unitId)) {
            fail('DANGLING_TARGET_REF', `${positionPath}.unitId`, `references unknown unit ${unitId}`);
        }
        if (unitIds.has(unitId)) fail('INVALID_SHAPE', `${positionPath}.unitId`, 'duplicate C3 position');
        if (previous !== undefined && compareText(previous, unitId) >= 0) {
            fail('INVALID_SHAPE', `${positionPath}.unitId`, 'C3 positions must be sorted by unit ID');
        }
        requireFiniteNumber(position['x'], `${positionPath}.x`);
        requireFiniteNumber(position['y'], `${positionPath}.y`);
        unitIds.add(unitId);
        previous = unitId;
    });
}

function validateEncounterNetwork(
    value: unknown,
    path: string,
    instances: ReadonlySet<string>,
): string {
    const network = requireRecord(value, path);
    exactKeys(network, ['id', 'networkType', 'color', 'endpoints'], path);
    const networkId = validateEncounterStableId(network['id'], `${path}.id`, 'network ID');
    const networkType = network['networkType'];
    if (!isC3NetworkType(networkType)) {
        fail('INVALID_SHAPE', `${path}.networkType`, 'unknown C3 network type');
    }
    validateEncounterColor(network['color'], `${path}.color`);
    const endpoints = requireArray(network['endpoints'], `${path}.endpoints`);
    // Persistence owns only shape and resource bounds. C3 topology is validated
    // once, after unit hydration, by C3NetworkEditor through the force boundary.
    if (endpoints.length > MAX_SERIALIZED_ENCOUNTER_NETWORK_ENDPOINTS) {
        fail(
            'INVALID_SHAPE',
            `${path}.endpoints`,
            `cannot contain more than ${MAX_SERIALIZED_ENCOUNTER_NETWORK_ENDPOINTS} endpoints`,
        );
    }
    const endpointKeys = new Set<string>();
    let previous: string | undefined;
    endpoints.forEach((raw, index) => {
        const endpointPath = `${path}.endpoints[${index}]`;
        const endpoint = requireRecord(raw, endpointPath);
        exactKeys(endpoint, ['instanceId', 'componentId', 'role'], endpointPath);
        const instanceId = validateId(endpoint['instanceId'], `${endpointPath}.instanceId`);
        if (!instances.has(instanceId)) {
            fail('ENCOUNTER_ENDPOINT_INVALID', `${endpointPath}.instanceId`, 'network endpoint has no force unit');
        }
        const componentId = validateId(endpoint['componentId'], `${endpointPath}.componentId`, asComponentId);
        const role = endpoint['role'];
        if (!isC3NetworkRole(role)) {
            fail('ENCOUNTER_ENDPOINT_INVALID', `${endpointPath}.role`, 'unknown network endpoint role');
        }
        const key = `${instanceId}\0${componentId}`;
        if (endpointKeys.has(key)) fail('ENCOUNTER_ENDPOINT_INVALID', endpointPath, 'duplicate network endpoint');
        if (previous !== undefined && previous >= key) {
            fail('INVALID_SHAPE', endpointPath, 'network endpoints must be unique and sorted by stable identity');
        }
        endpointKeys.add(key);
        previous = key;
    });
    return networkId;
}

function validateEncounterStableId(value: unknown, path: string, label: string): string {
    const id = validateBoundedText(value, path, 1, 128);
    if (id.includes('\0')) fail('INVALID_SHAPE', path, `${label} must not contain NUL`);
    return id;
}

function validateBoundedText(value: unknown, path: string, minimum: number, maximum: number): string {
    if (typeof value !== 'string') fail('INVALID_SHAPE', path, 'must be a string');
    const text = value as string;
    if (text.length < minimum || text.length > maximum || text.trim() !== text) {
        fail('INVALID_SHAPE', path, `must be ${minimum}-${maximum} characters without surrounding whitespace`);
    }
    if (text.includes('\0')) fail('INVALID_SHAPE', path, 'must not contain NUL');
    return text;
}

function validateEncounterColor(value: unknown, path: string): void {
    if (typeof value !== 'string'
        || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        fail('INVALID_SHAPE', path, 'must be a three- or six-digit hexadecimal color');
    }
}

function validateOptionalStringFields(record: Record<string, unknown>, path: string, keys: readonly string[]): void {
    for (const key of keys) {
        const value = record[key];
        if (value !== undefined && typeof value !== 'string') fail('INVALID_SHAPE', `${path}.${key}`, 'must be a string');
        if (typeof value === 'string' && value.includes('\0')) fail('INVALID_SHAPE', `${path}.${key}`, 'must not contain NUL');
    }
}

function validateOptionalNonnegative(record: Record<string, unknown>, path: string, keys: readonly string[]): void {
    for (const key of keys) if (record[key] !== undefined) requireSafeNonnegative(record[key], `${path}.${key}`);
}

function validateStringArray(value: unknown, path: string): void {
    requireArray(value, path).forEach((entry, index) => validateId(entry, `${path}[${index}]`));
}

function validateUniqueSortedUnitConditions(value: unknown, path: string): void {
    let previous: UnitConditionKey | undefined;
    requireArray(value, path).forEach((entry, index) => {
        const entryPath = `${path}[${index}]`;
        const current = validateId(entry, entryPath);
        if (!isUnitConditionKey(current)) fail('INVALID_SHAPE', entryPath, 'unknown unit condition');
        if (previous !== undefined && previous >= current) {
            fail('INVALID_SHAPE', entryPath, 'values must be unique and sorted');
        }
        previous = current;
    });
}

function validateSlotCoordinates(value: unknown, path: string): void {
    requireArray(value, path).forEach((raw, index) => {
        const coordinate = requireRecord(raw, `${path}[${index}]`);
        exactKeys(coordinate, ['location', 'slot'], `${path}[${index}]`);
        validateId(coordinate['location'], `${path}[${index}].location`);
        validateOrdinal(coordinate['slot'], `${path}[${index}].slot`);
    });
}

function validateOrdinal(value: unknown, path: string): number {
    if (typeof value !== 'number') fail('INVALID_SHAPE', path, 'must be a one-based slot ordinal');
    try { return asOneBasedCriticalSlotOrdinal(value as number); }
    catch (error) { throw validationError('INVALID_SHAPE', error, path); }
}

function validateRevision(value: unknown, path: string): number {
    if (typeof value !== 'number') fail('INVALID_SHAPE', path, 'must be a state revision');
    try { return value as number; }
    catch (error) { throw validationError('INVALID_SHAPE', error, path); }
}

function validateId(
    value: unknown,
    path: string,
    constructor: (text: string) => string = text => asBoundedId(text, 'identifier'),
): string {
    if (typeof value !== 'string') fail('INVALID_SHAPE', path, 'must be a string identifier');
    try { return constructor(value as string); }
    catch (error) { throw validationError('INVALID_SHAPE', error, path); }
}

function requireSafeNonnegative(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('INVALID_SHAPE', path, 'must be a non-negative safe integer');
    return value as number;
}

function requireSafeInteger(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        fail('INVALID_SHAPE', path, 'must be a safe integer');
    }
    return value;
}

function requireSignedSparseDelta(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) {
        fail('INVALID_SHAPE', path, 'must be a non-zero signed safe-integer delta');
    }
    return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
    const parsed = requireSafeNonnegative(value, path);
    if (parsed < 1) fail('INVALID_SHAPE', path, 'must be positive');
    return parsed;
}

function requireFiniteNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) fail('INVALID_SHAPE', path, 'must be a canonical finite number');
    return value as number;
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
    const value = record[key];
    if (typeof value !== 'string') fail('INVALID_SHAPE', `${path}.${key}`, 'must be a string');
    return value as string;
}

function requireArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) fail('INVALID_SHAPE', path, 'must be an array');
    return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_SHAPE', path, 'must be a plain object');
    return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const set = new Set(allowed);
    for (const key of Object.keys(record)) if (!set.has(key)) fail('INVALID_SHAPE', `${path}.${key}`, 'unknown field');
}

function assertJson(value: unknown, path: string, ancestors = new Set<object>()): asserts value is JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { requireFiniteNumber(value, path); return; }
    if (typeof value !== 'object') fail('INVALID_SHAPE', path, 'must be JSON data');
    if (ancestors.has(value as object)) fail('INVALID_SHAPE', path, 'contains a cycle');
    ancestors.add(value as object);
    if (Array.isArray(value)) value.forEach((entry, index) => assertJson(entry, `${path}[${index}]`, ancestors));
    else {
        if (Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_SHAPE', path, 'must use plain JSON objects');
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            if (entry === undefined) fail('INVALID_SHAPE', `${path}.${key}`, 'must not be undefined');
            assertJson(entry, `${path}.${key}`, ancestors);
        }
    }
    ancestors.delete(value as object);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function validationError(code: ForceEnvelopeValidationCode, error: unknown, path: string): ForceEnvelopeValidationError {
    return error instanceof ForceEnvelopeValidationError
        ? error
        : new ForceEnvelopeValidationError(code, errorMessage(error), path);
}

function fail(code: ForceEnvelopeValidationCode, path: string, message: string): never {
    throw new ForceEnvelopeValidationError(code, message, path);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) value.forEach(entry => deepFreeze(entry, seen));
    else Object.values(value as Record<string, unknown>).forEach(entry => deepFreeze(entry, seen));
    return Object.freeze(value);
}
