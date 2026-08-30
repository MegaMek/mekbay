// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Sanitizer } from '../utils/sanitizer.util';
import { GameSystem } from './common.model';
import type { ASCustomPilotAbility } from './pilot-abilities.model';
import type { C3NetworkType } from './c3-network.model';
import type { MotiveModes } from './motiveModes.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from './crew.model';
import { deserializeUnitCover, serializeUnitCover, type SerializedUnitCover } from './unit-cover.model';
import type { MekExplosionProtection } from './rules/game-rules';
import {
    cloneAsJson,
    sanitizeSavedEntityIdentity,
    type JsonObject,
    type SavedEntityIdentity,
} from './persisted-unit-state';
import type { SerializedCBTForceV2 } from './runtime/persistence-v2';

export const FORCE_NOTE_MAX_LENGTH = 2000;
export const FORCE_TAG_MAX_LENGTH = 48;
export const FORCE_TAG_MAX_COUNT = 32;

function preserveEntityIdentityForDeferredResolution(value: unknown): SavedEntityIdentity | undefined {
    if (value === undefined || value === null) return undefined;
    try {
        return sanitizeSavedEntityIdentity(value);
    } catch {
        // Do not turn a malformed identity into an unsafe name fallback. The UUID-first
        // resolver receives the original JSON and converts the unit to a deferred record.
        return cloneAsJson(value) as unknown as SavedEntityIdentity;
    }
}

export function sanitizeForceTagLabel(rawTag: unknown): string | null {
    if (typeof rawTag !== 'string') {
        return null;
    }

    const sanitizedTag = rawTag.trim().replace(/\s+/g, ' ').slice(0, FORCE_TAG_MAX_LENGTH);
    return sanitizedTag.length > 0 ? sanitizedTag : null;
}

/** Sanitizes a force tag label catalog without applying the per-force tag count limit. */
export function sanitizeForceTagLabels(tags: readonly string[] | null | undefined): string[] {
    if (!Array.isArray(tags) || tags.length === 0) {
        return [];
    }

    const sanitizedTags: string[] = [];
    const seen = new Set<string>();

    for (const rawTag of tags) {
        const sanitizedTag = sanitizeForceTagLabel(rawTag);
        if (!sanitizedTag) {
            continue;
        }

        const normalizedTag = sanitizedTag.toLocaleLowerCase();
        if (seen.has(normalizedTag)) {
            continue;
        }

        seen.add(normalizedTag);
        sanitizedTags.push(sanitizedTag);
    }

    return sanitizedTags;
}

export function sanitizeForceTags(tags: readonly string[] | null | undefined): string[] {
    return sanitizeForceTagLabels(tags).slice(0, FORCE_TAG_MAX_COUNT);
}

export interface LocationData {
    armor?: number;
    internal?: number;
    pendingArmor?: number;
    pendingInternal?: number;
    conditions?: SerializedCondition[];
}

export interface HeatProfile {
    current: number;
    next?: number;
    previous: number;
    heatsinksOff?: number;
}

export interface SerializedPSRChecks {
    legActuators?: Record<string, number>;
    hipsHit?: string[];
    gyroHit?: number;
    gyroDestroyed?: boolean;
    legsDestroyed?: string[];
    shutdown?: boolean;
}

export type SerializedMekCriticalChanceResult = 'none' | 'blown-off' | 1 | 2 | 3 | 4;

export const PENDING_UNIT_CHECK_KINDS = [
    'heat-shutdown',
    'heat-ammo-explosion',
    'heat-random-movement',
    'heat-pilot-damage',
    'heat-life-support',
    'life-support-drowning',
    'aero-control-recovery',
    'seatbelt',
    'consciousness',
    'consciousness-recovery',
] as const;

export type PendingUnitCheckKind = typeof PENDING_UNIT_CHECK_KINDS[number];

interface SerializedPendingEventBase {
    readonly id: string;
}

interface SerializedPendingMekCriticalBase extends SerializedPendingEventBase {
    readonly location: string;
    readonly locationDestroyed?: true;
    readonly consolidateImmediately?: true;
    readonly pilotDamageGroup?: string;
}

export interface SerializedPendingMekCriticalChance extends SerializedPendingMekCriticalBase {
    readonly type: 'mek-critical-chance';
    readonly explosionProtection?: MekExplosionProtection;
    readonly hardenedArmorApplies?: boolean;
    readonly result?: SerializedMekCriticalChanceResult;
}

export interface SerializedPendingMekCriticalChanceOrigin {
    readonly explosionProtection?: MekExplosionProtection;
    readonly hardenedArmorApplies?: boolean;
}

export type SerializedPendingMekCriticalCaseII =
    | { readonly status: 'pending'; readonly result?: 'resolve' | 'discard' }
    | { readonly status: 'passed' };

export interface SerializedPendingMekCritical extends SerializedPendingMekCriticalBase {
    readonly type: 'mek-critical-hit';
    readonly targetLocation: string;
    readonly remainingHits: number;
    readonly chanceOrigin?: SerializedPendingMekCriticalChanceOrigin;
    readonly caseII?: SerializedPendingMekCriticalCaseII;
    readonly roll?: readonly number[];
}

export type CBTMekFallSource = 'psr' | 'stand-attempt';

export interface SerializedPendingMekFall extends SerializedPendingEventBase {
    readonly type: 'mek-fall';
    readonly source: CBTMekFallSource;
    readonly levelsFallen: number;
}

export type SerializedPendingCheckResult =
    | { readonly kind: 'manual'; readonly outcome: RuleCheckOutcome }
    | { readonly kind: 'automatic'; readonly outcome: RuleCheckOutcome }
    | { readonly kind: 'roll'; readonly dice: readonly [number, number] };

type SerializedPendingCheckResolution =
    | {
        readonly target: number;
        readonly result?: Exclude<SerializedPendingCheckResult, { readonly kind: 'automatic' }>;
    }
    | {
        readonly target?: never;
        readonly result: Extract<SerializedPendingCheckResult, { readonly kind: 'automatic' }>;
    };

interface SerializedPendingUnitCheckBase extends SerializedPendingEventBase {
    readonly type: 'unit-check';
    readonly pilotDamageGroup?: string;
}

type SerializedPendingBasicUnitCheckKind = 'heat-shutdown' | 'heat-random-movement';
type SerializedPendingBasicUnitCheck = {
    [K in SerializedPendingBasicUnitCheckKind]: SerializedPendingUnitCheckBase
        & SerializedPendingCheckResolution
        & { readonly kind: K };
}[SerializedPendingBasicUnitCheckKind];

type SerializedPendingAmmoExplosionCheck = SerializedPendingUnitCheckBase & SerializedPendingCheckResolution & {
    readonly kind: 'heat-ammo-explosion';
    readonly selectionId?: string;
};

type SerializedPendingPilotDamageCheckKind = 'heat-pilot-damage' | 'heat-life-support' | 'life-support-drowning';
type SerializedPendingPilotDamageCheck = {
    [K in SerializedPendingPilotDamageCheckKind]: SerializedPendingUnitCheckBase
        & SerializedPendingCheckResolution
        & { readonly kind: K; readonly hits: number };
}[SerializedPendingPilotDamageCheckKind];

type SerializedPendingAeroRecoveryCheck = SerializedPendingUnitCheckBase & SerializedPendingCheckResolution & {
    readonly kind: 'aero-control-recovery';
    readonly readyTurn: number;
    readonly cause?: 'heat-random-movement';
};

type SerializedPendingSeatbeltCheck = SerializedPendingUnitCheckBase & SerializedPendingCheckResolution & {
    readonly kind: 'seatbelt';
    readonly crewId: number;
};

type SerializedPendingConsciousnessCheck = SerializedPendingUnitCheckBase & SerializedPendingCheckResolution & {
    readonly kind: 'consciousness';
    readonly pilotDamageGroup: string;
    readonly crewId: number;
};

type SerializedPendingConsciousnessRecoveryCheck = SerializedPendingUnitCheckBase & SerializedPendingCheckResolution & {
    readonly kind: 'consciousness-recovery';
    readonly crewId: number;
    readonly readyTurn: number;
};

export type SerializedPendingUnitCheck =
    | SerializedPendingBasicUnitCheck
    | SerializedPendingAmmoExplosionCheck
    | SerializedPendingPilotDamageCheck
    | SerializedPendingAeroRecoveryCheck
    | SerializedPendingSeatbeltCheck
    | SerializedPendingConsciousnessCheck
    | SerializedPendingConsciousnessRecoveryCheck;

export type SerializedPendingEvent =
    | SerializedPendingMekCriticalChance
    | SerializedPendingMekCritical
    | SerializedPendingMekFall
    | SerializedPendingUnitCheck;

export type PendingEventInput<T extends SerializedPendingEvent> =
    T extends SerializedPendingEvent ? Omit<T, 'type'> : never;

export type SerializedEndTurnCheckpoint = 'phase-ended' | 'heat-staged';

export interface SerializedTurnState {
    turnCounter?: number;
    endTurnCheckpoint?: SerializedEndTurnCheckpoint;
    airborne?: boolean;
    moveMode?: MotiveModes;
    moveDistance?: number;
    standAttempts?: number;
    carefulStand?: boolean;
    cover?: SerializedUnitCover;
    dmgReceived?: number;
    weaponsHeat?: number;
    acknowledgedHeatSources?: Record<string, string>;
    heatDissipationConsumed?: number;
    psrOutcomes?: Record<string, RuleCheckOutcome>;
    psrChecks?: SerializedPSRChecks;
    pendingEvents?: SerializedPendingEvent[];
    applyMovePSR?: boolean;
    spotting?: boolean;
    equipmentStateChanged?: boolean;
}

export interface SerializedForce {
    version: number;
    timestamp: string;
    instanceId: string;
    type: GameSystem;
    name: string;
    note?: string;
    tags?: string[];
    factionId?: number;
    factionLock?: boolean;
    eraId?: number;
    eraLock?: boolean;
    bv?: number;
    pv?: number;
    owned?: boolean;
    groups?: SerializedGroup[];
    c3Networks?: SerializedC3NetworkGroup[];
    /** Complete Classic BattleTech force state. V1 inputs are converted to this on load. */
    cbt?: SerializedCBTForceV2;
}

/** Current Classic force wire record. Legacy groups never enter the live model. */
export interface SerializedClassicForce extends SerializedForce {
    version: 2;
    type: GameSystem.CLASSIC;
    cbt: SerializedCBTForceV2;
    groups?: never;
    c3Networks?: never;
}

export interface CBTSerializedForce extends SerializedForce {
    version: 1;
    type: GameSystem.CLASSIC;
    cbt?: never;
    groups?: CBTSerializedGroup[];
}

export interface ASSerializedForce extends SerializedForce {
    groups?: ASSerializedGroup[];
}

export interface SerializedGroup {
    id: string;
    name?: string;
    color?: string;
    formationId?: string;
    formationLock?: boolean;
    formationTargetGroupId?: string;
    units: SerializedUnit[];
}

export interface CBTSerializedGroup extends SerializedGroup {
    units: CBTSerializedUnit[];
}

export interface ASSerializedGroup extends SerializedGroup {
    units: ASSerializedUnit[];
}
export interface SerializedUnit {
    id: string;
    unit: string; // Unit name
    model?: string;
    chassis?: string;
    alias?: string;
    commander?: boolean;
    updatedTs?: number;
    /** UUID/provider identity plus optional source-revision witnesses at save time. */
    entityIdentity?: SavedEntityIdentity;
    state: SerializedState;
}
export interface ASSerializedUnit extends SerializedUnit {
    state: ASSerializedState;
    skill: number;
    abilities: (string | ASCustomPilotAbility)[]; // Array of ability IDs or custom abilities
    formationAbilities?: string[];
    commander?: boolean;
}

export interface CBTSerializedUnit extends SerializedUnit {
    state: CBTSerializedState;
}
export interface ConditionData {
    value?: number;
    pending?: boolean;
}

export interface SerializedConditionValue {
    key: string;
    value?: number;
    pending?: boolean;
}
export type SerializedCondition = string | SerializedConditionValue;

export function normalizeConditionKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const condition = value.trim().slice(0, 48);
    return condition.length > 0 ? condition : null;
}

export function normalizeConditionData(data: ConditionData | undefined): ConditionData | undefined {
    const value = data?.value;
    const normalized: ConditionData = {};
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) normalized.value = value;
    if (data?.pending === true) normalized.pending = true;
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function conditionFromSerialized(entry: SerializedCondition): [string, ConditionData | undefined] | null {
    if (typeof entry === 'string') {
        const key = normalizeConditionKey(entry);
        return key ? [key, undefined] : null;
    }

    if ((entry as unknown as Record<string, unknown>)['remove'] === true) return null;

    const key = normalizeConditionKey(entry.key);
    return key ? [key, normalizeConditionData(entry)] : null;
}

export function conditionToSerialized(key: string, data: ConditionData | undefined): SerializedCondition {
    const normalized = normalizeConditionData(data);
    return normalized ? { key, ...normalized } : key;
}

export function conditionsMapFromSerialization(conditions: Iterable<SerializedCondition> | undefined): Map<string, ConditionData | undefined> {
    const result = new Map<string, ConditionData | undefined>();
    for (const condition of conditions ?? []) {
        const parsed = conditionFromSerialized(condition);
        if (parsed) result.set(parsed[0], parsed[1]);
    }
    return result;
}

export function conditionsForSerialization(conditions: ReadonlyMap<string, ConditionData | undefined>): SerializedCondition[] {
    return Array.from(conditions.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, data]) => conditionToSerialized(key, data));
}

export function conditionIsActive(_data: ConditionData | undefined): boolean {
    return true;
}

export function conditionIsCommittedActive(data: ConditionData | undefined): boolean {
    return data?.pending !== true;
}

export function conditionsHasActive(conditions: ReadonlyMap<string, ConditionData | undefined>, key: string): boolean {
    return conditions.has(key);
}

export function conditionsHasCommittedActive(conditions: ReadonlyMap<string, ConditionData | undefined>, key: string): boolean {
    return conditions.has(key) && conditionIsCommittedActive(conditions.get(key));
}

export function committedConditionData(data: ConditionData | undefined): ConditionData | undefined {
    return normalizeConditionData({ value: data?.value });
}

export interface SerializedState {
    modified: boolean;
    destroyed: boolean;
    conditions?: SerializedCondition[];
    /** Position in the C3 network visual editor */
    c3Position?: { x: number; y: number };
}

/** 
 * A C3 network group - either peer-based or master/slave hierarchy.
 * 
 * Rules:
 * - Peers (C3i, Naval, Nova): Units connect equally, limit is C3_NETWORK_LIMITS[type]
 * - C3 Master/Slave: Master component has up to 3 children (all slaves OR all masters, not mixed)
 * - Max depth is 2: Master -> SubMaster -> children (those children can't have more)
 * - A master with no children connected to another master is stored as a slave (not a sub-network)
 */
export interface SerializedC3NetworkGroup {
    /** Unique network ID */
    id: string;
    /** Network type */
    type: C3NetworkType;
    /** Assigned color for visualization */
    color: string;
    
    // ===== For peer networks (C3i, Naval, Nova) =====
    /** All peer unit IDs in this network */
    peerIds?: string[];
    
    // ===== For C3 master/slave networks =====
    /** The master unit ID */
    masterId?: string;
    /** Which C3 master component on the unit (for multi-master units) */
    masterCompIndex?: number;
    /** 
     * Child unit IDs directly under this master's component.
     * Can be slaves or masters (acting as slaves if they have no children).
     * For masters, includes "unitId:compIndex" format to identify which component.
     */
    members?: string[];
}

export interface ASSerializedState extends SerializedState {
    /** Heat as [committed, pendingDelta]. pendingDelta of 0 means no pending change. */
    heat: [number, number];
    /** Armor as [committed, pendingDelta]. Positive = damage, negative = heal. */
    armor: [number, number];
    /** Internal as [committed, pendingDelta]. Positive = damage, negative = heal. */
    internal: [number, number];
    /** 
     * Array of committed critical hits with timestamps for ordering.
     */
    crits: ASCriticalHit[];
    /**
     * Array of pending critical hit changes.
     * Positive timestamp = pending damage, negative timestamp = pending heal.
     */
    pCrits: ASCriticalHit[];
    /**
     * Consumed ability counts. Key is ability originalText, value is [committed, pendingDelta].
     * Example: { "BOMB4": [2, 1] } means 2 bombs used, 1 more pending.
     */
    consumed?: Record<string, [number, number]>;
    /**
     * Exhausted abilities. Array of ability originalText values.
     * [committed[], pendingExhaust[], pendingRestore[]]
     */
    exhausted?: [string[], string[], string[]];
}

/**
 * Represents a single critical hit with timestamp for ordering effects.
 */
export interface ASCriticalHit {
    /** The critical type key ('engine', 'weapons', 'motive', ...) */
    key: string;
    /** Timestamp when this hit was applied (for ordering effects). Negative = pending heal. */
    timestamp: number;
}

export interface SerializedCrewMember {
    id: number;
    name: string;
    gunnerySkill: number;
    pilotingSkill: number;
    asfGunnerySkill?: number;
    asfPilotingSkill?: number;
    hits: number;
    state: number;
}

export interface CBTSerializedState extends SerializedState {
    crew: SerializedCrewMember[];
    crits: SerializedLegacyCriticalSlotV1[];
    locations: Record<string, LocationData>;
    heat: HeatProfile;
    inventory?: SerializedInventory[];
    ruleChecks?: SerializedRuleChecks;
    turnState?: SerializedTurnState;
}

export type RuleCheckOutcome = 'success' | 'failed';
export type RuleCheckStatus = 'pending' | RuleCheckOutcome;

export interface SerializedRuleCheck {
    token: string;
    trigger: string;
    status: RuleCheckStatus;
}

export type SerializedRuleChecks = Record<string, SerializedRuleCheck>;

export interface SerializedInventory {
    id: string;
    destroyed?: boolean;
    destroying?: boolean;
    states?: { name: string; value: string }[];
    consumed?: number;
    ammo?: string;
    totalAmmo?: number;
}

/** Exact persisted V1 bridge row. It is decoded only by the V1-to-V2 converter. */
export interface SerializedLegacyCriticalSlotV1 {
    id: string; // Identifier for the critical slot on the sheet. Format is internalName@loc#slot
    name?: string; // Name, if loc/slot are null, this is the name of the critical point (example: engine)
    loc?: string; // Location of the critical slot (HD, LT, RT, ...)
    slot?: number; // Slot number of the critical slot
    hits?: number; // How many hits did this location receive. If is an armored location, this is the number of hits it has taken
    pendingHits?: number; // Pending hit delta for count-based criticals, such as VTOL rotor hits
    hitTimestamps?: number[]; // Committed hit timestamps for count-based criticals that need chronological application
    pendingHitTimestamps?: number[]; // Pending addition timestamps for count-based criticals
    totalAmmo?: number; // If is an ammo slot: how much total ammo is in this slot.
    consumed?: number; // Ammo expended, or modular-armor points already absorbed.
    destroying?: number; // If this location is in the process of being destroyed. Contains the timestamp of when the destruction started
    destroyed?: number; // If this location is destroyed (can be from 0 hits if the structure is completely destroyed). Contains the timestamp of the destruction
    destroyedTurn?: number;
    originalName?: string; // saved original name in case we override the current name
    armored?: boolean; // If this critical slot is armored (for locations that can be armored)
}

/**
 * Schema for network serialized data
 */

export const C3_POSITION_SCHEMA = Sanitizer.schema<{ x: number; y: number }>()
    .number('x', { default: 0 })
    .number('y', { default: 0 })
    .build();

export const C3_NETWORK_GROUP_SCHEMA = Sanitizer.schema<SerializedC3NetworkGroup>()
    .string('id')
    .string('type')
    .string('color')
    .custom('peerIds', (value: unknown) => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
            return value.filter(id => typeof id === 'string').map(String);
        }
        return undefined;
    })
    .string('masterId')
    .number('masterCompIndex')
    .custom('members', (value: unknown) => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
            return value.filter(id => typeof id === 'string').map(String);
        }
        return undefined;
    })
    .build();

// ===== Classic BattleTech Schemas =====

export const HEAT_SCHEMA = Sanitizer.schema<HeatProfile>()
    .number('current', { default: 0, min: 0 })
    .number('previous', { default: 0, min: 0 })
    .custom('next', sanitizeOptionalNonNegativeNumber)
    .custom('heatsinksOff', sanitizeOptionalNonNegativeNumber)
    .build();

const MOTIVE_MODE_VALUES: readonly MotiveModes[] = ['stationary', 'walk', 'run', 'sprint', 'jump', 'UMU', 'VTOL'];

export const PSR_CHECKS_SCHEMA = Sanitizer.schema<SerializedPSRChecks>()
    .custom('legActuators', sanitizeNumberRecord)
    .custom('hipsHit', sanitizeStringArray)
    .number('gyroHit', { min: 0 })
    .boolean('gyroDestroyed')
    .custom('legsDestroyed', sanitizeStringArray)
    .boolean('shutdown')
    .build();

function sanitizePSRChecks(value: unknown): SerializedPSRChecks | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const checks = Sanitizer.sanitize(value, PSR_CHECKS_SCHEMA);
    return Object.keys(checks).length > 0 ? checks : undefined;
}

function sanitizePendingString(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function sanitizePendingInteger(value: unknown, min: number, max: number): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
        ? value
        : undefined;
}

function sanitizeD6Roll(value: unknown, lengths: readonly number[]): readonly number[] | undefined {
    return Array.isArray(value)
        && lengths.includes(value.length)
        && value.every(die => Number.isInteger(die) && die >= 1 && die <= 6)
        ? [...value] as number[]
        : undefined;
}

function sanitizePendingCriticalBase(record: Record<string, unknown>): SerializedPendingMekCriticalBase | null {
    const id = sanitizePendingString(record['id'], 256);
    const location = sanitizePendingString(record['location'], 32);
    if (!id || !location) return null;
    const pilotDamageGroup = sanitizePendingString(record['pilotDamageGroup'], 80);
    return {
        id,
        location,
        ...(record['locationDestroyed'] === true ? { locationDestroyed: true } : {}),
        ...(record['consolidateImmediately'] === true ? { consolidateImmediately: true } : {}),
        ...(pilotDamageGroup ? { pilotDamageGroup } : {}),
    };
}

function sanitizePendingCriticalChanceFacts(
    record: Record<string, unknown>,
): SerializedPendingMekCriticalChanceOrigin | null {
    const explosionProtection = record['explosionProtection'];
    if (explosionProtection !== undefined
        && explosionProtection !== 'none'
        && explosionProtection !== 'case'
        && explosionProtection !== 'case-ii') return null;
    if (record['hardenedArmorApplies'] !== undefined
        && typeof record['hardenedArmorApplies'] !== 'boolean') return null;
    return {
        ...(explosionProtection !== undefined ? { explosionProtection } : {}),
        ...(typeof record['hardenedArmorApplies'] === 'boolean'
            ? { hardenedArmorApplies: record['hardenedArmorApplies'] }
            : {}),
    };
}

function sanitizePendingCheckResolution(record: Record<string, unknown>): SerializedPendingCheckResolution | null {
    const target = sanitizePendingInteger(record['target'], 2, 12);
    const rawResult = record['result'];
    if (target !== undefined) {
        if (rawResult === undefined) return { target };
        if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) return null;
        const result = rawResult as Record<string, unknown>;
        if (result['kind'] === 'manual'
            && (result['outcome'] === 'success' || result['outcome'] === 'failed')) {
            return { target, result: { kind: 'manual', outcome: result['outcome'] } };
        }
        const dice = result['kind'] === 'roll' ? sanitizeD6Roll(result['dice'], [2]) : undefined;
        return dice
            ? { target, result: { kind: 'roll', dice: dice as readonly [number, number] } }
            : null;
    }

    if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) return null;
    const result = rawResult as Record<string, unknown>;
    return result['kind'] === 'automatic'
        && (result['outcome'] === 'success' || result['outcome'] === 'failed')
        ? { result: { kind: 'automatic', outcome: result['outcome'] } }
        : null;
}

function sanitizePendingUnitCheck(record: Record<string, unknown>): SerializedPendingUnitCheck | null {
    const id = sanitizePendingString(record['id'], 256);
    const rawKind = record['kind'];
    const resolution = sanitizePendingCheckResolution(record);
    if (!id || !PENDING_UNIT_CHECK_KINDS.includes(rawKind as PendingUnitCheckKind) || !resolution) return null;
    const kind = rawKind as PendingUnitCheckKind;
    const pilotDamageGroup = sanitizePendingString(record['pilotDamageGroup'], 80);
    const base = {
        type: 'unit-check' as const,
        id,
        ...resolution,
        ...(pilotDamageGroup ? { pilotDamageGroup } : {}),
    };
    switch (kind) {
        case 'heat-shutdown':
        case 'heat-random-movement':
            return { ...base, kind };
        case 'heat-ammo-explosion': {
            const selectionId = sanitizePendingString(record['selectionId'], 256);
            return { ...base, kind, ...(selectionId ? { selectionId } : {}) };
        }
        case 'heat-pilot-damage':
        case 'heat-life-support':
        case 'life-support-drowning': {
            const hits = sanitizePendingInteger(record['hits'], 1, 100);
            return hits === undefined ? null : { ...base, kind, hits };
        }
        case 'aero-control-recovery': {
            const readyTurn = sanitizePendingInteger(record['readyTurn'], 0, Number.MAX_SAFE_INTEGER);
            const cause = record['cause'];
            if (readyTurn === undefined || (cause !== undefined && cause !== 'heat-random-movement')) return null;
            return { ...base, kind, readyTurn, ...(cause ? { cause } : {}) };
        }
        case 'seatbelt': {
            const crewId = sanitizePendingInteger(record['crewId'], 0, 255);
            return crewId !== undefined ? { ...base, kind, crewId } : null;
        }
        case 'consciousness': {
            const crewId = sanitizePendingInteger(record['crewId'], 0, 255);
            return crewId !== undefined && pilotDamageGroup
                ? { ...base, kind, crewId, pilotDamageGroup }
                : null;
        }
        case 'consciousness-recovery': {
            const crewId = sanitizePendingInteger(record['crewId'], 0, 255);
            const readyTurn = sanitizePendingInteger(record['readyTurn'], 0, Number.MAX_SAFE_INTEGER);
            return crewId !== undefined && readyTurn !== undefined
                ? { ...base, kind, crewId, readyTurn }
                : null;
        }
    }
}

function sanitizePendingEvent(record: Record<string, unknown>): SerializedPendingEvent | null {
    switch (record['type']) {
        case 'mek-critical-chance': {
            const base = sanitizePendingCriticalBase(record);
            const chanceFacts = sanitizePendingCriticalChanceFacts(record);
            if (!base || !chanceFacts) return null;
            const result = record['result'];
            const validResult = result === 'none' || result === 'blown-off'
                || result === 1 || result === 2 || result === 3 || result === 4;
            if (result !== undefined && !validResult) return null;
            return {
                ...base,
                type: 'mek-critical-chance',
                ...chanceFacts,
                ...(validResult ? { result: result as SerializedMekCriticalChanceResult } : {}),
            };
        }
        case 'mek-critical-hit': {
            const base = sanitizePendingCriticalBase(record);
            const targetLocation = sanitizePendingString(record['targetLocation'], 32);
            const remainingHits = sanitizePendingInteger(record['remainingHits'], 1, 4);
            if (!base || !targetLocation || remainingHits === undefined) return null;
            let chanceOrigin: SerializedPendingMekCriticalChanceOrigin | undefined;
            if (record['chanceOrigin'] !== undefined) {
                if (!record['chanceOrigin'] || typeof record['chanceOrigin'] !== 'object'
                    || Array.isArray(record['chanceOrigin'])) return null;
                const sanitizedOrigin = sanitizePendingCriticalChanceFacts(
                    record['chanceOrigin'] as Record<string, unknown>,
                );
                if (!sanitizedOrigin) return null;
                chanceOrigin = sanitizedOrigin;
            }
            let caseII: SerializedPendingMekCriticalCaseII | undefined;
            if (record['caseII'] !== undefined) {
                if (!record['caseII'] || typeof record['caseII'] !== 'object' || Array.isArray(record['caseII'])) return null;
                const rawCaseII = record['caseII'] as Record<string, unknown>;
                if (rawCaseII['status'] === 'passed') {
                    caseII = { status: 'passed' };
                } else if (rawCaseII['status'] === 'pending'
                    && (rawCaseII['result'] === undefined
                        || rawCaseII['result'] === 'resolve'
                        || rawCaseII['result'] === 'discard')) {
                    caseII = {
                        status: 'pending',
                        ...(rawCaseII['result']
                            ? { result: rawCaseII['result'] as 'resolve' | 'discard' }
                            : {}),
                    };
                } else {
                    return null;
                }
            }
            const roll = record['roll'] === undefined ? undefined : sanitizeD6Roll(record['roll'], [1, 2]);
            if ((record['roll'] !== undefined && !roll) || (roll && caseII?.status === 'pending')) return null;
            return {
                ...base,
                type: 'mek-critical-hit',
                targetLocation,
                remainingHits,
                ...(chanceOrigin ? { chanceOrigin } : {}),
                ...(caseII ? { caseII } : {}),
                ...(roll ? { roll } : {}),
            };
        }
        case 'mek-fall': {
            const id = sanitizePendingString(record['id'], 256);
            const levelsFallen = sanitizePendingInteger(record['levelsFallen'], 0, 100);
            const source = record['source'];
            return id && levelsFallen !== undefined && (source === 'psr' || source === 'stand-attempt')
                ? { type: 'mek-fall', id, source, levelsFallen }
                : null;
        }
        case 'unit-check':
            return sanitizePendingUnitCheck(record);
        default:
            return null;
    }
}

function sanitizePendingEvents(value: unknown): SerializedPendingEvent[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seenIds = new Set<string>();
    const events: SerializedPendingEvent[] = [];
    for (const candidate of value.slice(0, 256)) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const event = sanitizePendingEvent(candidate as JsonObject);
        if (!event || seenIds.has(event.id)) continue;
        seenIds.add(event.id);
        events.push(event);
    }
    return events.length > 0 ? events : undefined;
}

export const TURN_STATE_SCHEMA = Sanitizer.schema<SerializedTurnState>()
    .custom('turnCounter', sanitizeOptionalNonNegativeInteger)
    .custom('endTurnCheckpoint', (value: unknown) =>
        value === 'phase-ended' || value === 'heat-staged' ? value : undefined)
    .custom('airborne', (value: unknown) => typeof value === 'boolean' ? value : undefined)
    .custom('moveMode', (value: unknown) => MOTIVE_MODE_VALUES.includes(value as MotiveModes) ? value as MotiveModes : undefined)
    .custom('moveDistance', sanitizeOptionalNonNegativeNumber)
    .custom('standAttempts', sanitizeOptionalNonNegativeNumber)
    .custom('carefulStand', (value: unknown) => typeof value === 'boolean' ? value : undefined)
    .custom('cover', sanitizeOptionalCover)
    .custom('dmgReceived', sanitizeOptionalNonNegativeNumber)
    .custom('weaponsHeat', sanitizeOptionalNonNegativeNumber)
    .custom('acknowledgedHeatSources', sanitizeStringRecord)
    .custom('heatDissipationConsumed', sanitizeOptionalNonNegativeNumber)
    .custom('psrOutcomes', (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const outcomes = Object.fromEntries(Object.entries(value)
            .filter(([key, outcome]) => key.length > 0 && key.length <= 256
                && (outcome === 'success' || outcome === 'failed')));
        return Object.keys(outcomes).length > 0 ? outcomes : undefined;
    })
    .custom('psrChecks', sanitizePSRChecks)
    .custom('pendingEvents', sanitizePendingEvents)
    .custom('applyMovePSR', (value: unknown) => typeof value === 'boolean' ? value : undefined)
    .custom('spotting', (value: unknown) => typeof value === 'boolean' ? value : undefined)
    .custom('equipmentStateChanged', (value: unknown) => value === true ? true : undefined)
    .build();

export const LOCATION_SCHEMA = Sanitizer.schema<LocationData>()
    .number('armor')
    .number('internal')
    .number('pendingArmor')
    .number('pendingInternal')
    .custom('conditions', sanitizeConditions)
    .build();

export const CRIT_SLOT_SCHEMA = Sanitizer.schema<SerializedLegacyCriticalSlotV1>()
    .string('id')
    .string('name')
    .string('loc')
    .number('slot')
    .number('hits')
    .number('pendingHits')
    .custom('hitTimestamps', sanitizeTimestampArray)
    .custom('pendingHitTimestamps', sanitizeTimestampArray)
    .number('totalAmmo')
    .number('consumed')
    .number('destroying')
    .custom('destroyed', (value: unknown) => {
        if (typeof value === 'boolean') return value ? Date.now() : undefined; // We may have old boolean values, we convert them to timestamp
        if (typeof value === 'number') return value;
        return undefined;
    })
    .custom('destroyedTurn', sanitizeOptionalNonNegativeInteger)
    .string('originalName')
    .boolean('armored')
    .build();

function sanitizeTimestampArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const timestamps = value
        .map(timestamp => typeof timestamp === 'number' ? timestamp : Number(timestamp))
        .filter(timestamp => Number.isFinite(timestamp));
    return timestamps.length > 0 ? timestamps : undefined;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const values = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
    return values.length > 0 ? [...new Set(values)] : undefined;
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result: Record<string, string> = {};
    for (const [key, rawEntry] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.trim();
        const entry = typeof rawEntry === 'string' ? rawEntry.trim() : '';
        if (normalizedKey.length === 0 || entry.length === 0) {
            continue;
        }
        result[normalizedKey] = entry;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeOptionalNonNegativeNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

function sanitizeOptionalNonNegativeInteger(value: unknown): number | undefined {
    const parsed = sanitizeOptionalNonNegativeNumber(value);
    return parsed === undefined ? undefined : Math.floor(parsed);
}

function sanitizeOptionalCover(value: unknown): SerializedUnitCover | undefined {
    const cover = deserializeUnitCover(value);
    return cover === undefined ? undefined : serializeUnitCover(cover);
}

function sanitizeNumberRecord(value: unknown): Record<string, number> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result: Record<string, number> = {};
    for (const [key, rawEntry] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.trim();
        const entry = typeof rawEntry === 'number' ? rawEntry : Number(rawEntry);
        if (normalizedKey.length === 0 || !Number.isInteger(entry) || entry <= 0) {
            continue;
        }
        result[normalizedKey] = entry;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeConditions(value: unknown): SerializedCondition[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const states = new Map<string, ConditionData | undefined>();

    for (const entry of value) {
        if (typeof entry === 'string') {
            const condition = normalizeConditionKey(entry);
            if (condition) states.set(condition, undefined);
            continue;
        }

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }

        const record = entry as Record<string, unknown>;
        const condition = normalizeConditionKey(record['key'] ?? record['state']);
        const countedValue = record['value'];
        if (!condition) {
            continue;
        }
        if (record['remove'] === true) {
            continue;
        }

        const data: ConditionData = {};
        if (typeof countedValue === 'number' && Number.isFinite(countedValue) && countedValue !== 0) data.value = countedValue;
        if (record['pending'] === true) data.pending = true;
        states.set(condition, normalizeConditionData(data));
    }

    const serializedConditions = conditionsForSerialization(states);
    return serializedConditions.length > 0 ? serializedConditions : undefined;
}

export const INVENTORY_SCHEMA = Sanitizer.schema<SerializedInventory>()
    .string('id')
    .number('totalAmmo')
    .number('consumed')
    .string('ammo')
    .custom('states', (value: unknown) => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
            return value
                .filter(item => 
                    typeof item === 'object' && 
                    item !== null && 
                    'name' in item && 
                    'value' in item
                )
                .map(item => ({
                    name: String(item.name),
                    value: String(item.value)
                }));
        }
        return undefined;
    })
    .boolean('destroyed')
    .boolean('destroying')
    .build();

/**
 * Schema for crew member serialized data
 */
export const CREW_MEMBER_SCHEMA = Sanitizer.schema<SerializedCrewMember>()
    .number('id', { default: 0, min: 0 })
    .string('name', { default: '' })
    .number('gunnerySkill', { default: DEFAULT_GUNNERY_SKILL, min: 0, max: 8 })
    .number('pilotingSkill', { default: DEFAULT_PILOTING_SKILL, min: 0, max: 8 })
    .number('asfGunnerySkill')
    .number('asfPilotingSkill')
    .number('hits', { default: 0, min: 0, max: 6 })
    .number('state', { default: 0, min: 0, max: 2 })
    .build();

/**
 * Schema for CBTSerializedState
 */
export const CBT_SERIALIZED_STATE_SCHEMA = Sanitizer.schema<CBTSerializedState>()
    .boolean('modified', { default: false })
    .boolean('destroyed', { default: false })
    .custom('conditions', sanitizeConditions)
    .custom('c3Position', (value: unknown) => {
        if (!value || typeof value !== 'object') return undefined;
        return Sanitizer.sanitize(value, C3_POSITION_SCHEMA);
    })
    .custom('crew', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, CREW_MEMBER_SCHEMA);
    })
    .custom('crits', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, CRIT_SLOT_SCHEMA);
    })
    .custom('locations', (value: unknown) => {
        if (!value || typeof value !== 'object') return {};
        return Sanitizer.sanitizeRecord(value, LOCATION_SCHEMA);
    })
    .custom('heat', (value: unknown) => {
        if (!value || typeof value !== 'object') return { current: 0, previous: 0 };
        return Sanitizer.sanitize(value, HEAT_SCHEMA);
    })
    .custom('inventory', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        return Sanitizer.sanitizeArray(value, INVENTORY_SCHEMA);
    })
    .custom('ruleChecks', (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const result: SerializedRuleChecks = {};
        for (const [key, entry] of Object.entries(value)) {
            if (!key || key.length > 64 || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const candidate = entry as Record<string, unknown>;
            if (typeof candidate['token'] !== 'string' || !candidate['token']) continue;
            if (typeof candidate['trigger'] !== 'string' || !candidate['trigger']) continue;
            if (candidate['status'] !== 'pending' && candidate['status'] !== 'success' && candidate['status'] !== 'failed') continue;
            result[key] = {
                token: candidate['token'],
                trigger: candidate['trigger'],
                status: candidate['status'],
            };
        }
        return Object.keys(result).length > 0 ? result : undefined;
    })
    .custom('turnState', (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const turnState = Sanitizer.sanitize(value, TURN_STATE_SCHEMA);
        return Object.keys(turnState).length > 0 ? turnState : undefined;
    })
    .build();

/**
 * Schema for CBTSerializedUnit
 */
export const CBT_SERIALIZED_UNIT_SCHEMA = Sanitizer.schema<CBTSerializedUnit>()
    .string('id')
    .string('unit')
    .string('model')
    .string('chassis')
    .string('alias')
    .boolean('commander')
    .number('updatedTs')
    .custom('entityIdentity', preserveEntityIdentityForDeferredResolution)
    .custom('state', (value: unknown) => {
        if (!value || typeof value !== 'object') {
            return Sanitizer.sanitize({}, CBT_SERIALIZED_STATE_SCHEMA);
        }
        return Sanitizer.sanitize(value, CBT_SERIALIZED_STATE_SCHEMA);
    })
    .build();

/**
 * Schema for CBTSerializedGroup
 */
export const CBT_SERIALIZED_GROUP_SCHEMA = Sanitizer.schema<CBTSerializedGroup>()
    .string('id')
    .string('name')
    .string('color')
    .string('formationId')
    .boolean('formationLock')
    .custom('formationTargetGroupId', (value: unknown) => (
        typeof value === 'string' && value.length > 0 ? value : undefined
    ))
    .custom('units', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, CBT_SERIALIZED_UNIT_SCHEMA);
    })
    .build();

/**
 * Exact V1 Classic ingress schema. Current Classic records use `SerializedClassicForce`.
 */
export const CBT_SERIALIZED_FORCE_SCHEMA = Sanitizer.schema<CBTSerializedForce>()
    .number('version', { default: 1 })
    .string('timestamp')
    .string('instanceId')
    .string('type')
    .string('name', { default: 'Unnamed Force' })
    .string('note', { maxLength: FORCE_NOTE_MAX_LENGTH })
    .custom('tags', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const tags = sanitizeForceTags(value);
        return tags.length > 0 ? tags : undefined;
    })
    .boolean('factionLock')
    .number('factionId')
    .number('eraId')
    .boolean('eraLock')
    .number('bv')
    .boolean('owned', { default: true })
    .custom('groups', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, CBT_SERIALIZED_GROUP_SCHEMA);
    })
    .custom('c3Networks', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        return Sanitizer.sanitizeArray(value, C3_NETWORK_GROUP_SCHEMA);
    })
    .build();

// ===== Alpha Strike Schemas =====

/**
 * Schema for ASCriticalHit - single critical hit with timestamp
 */
export const AS_CRITICAL_HIT_SCHEMA = Sanitizer.schema<ASCriticalHit>()
    .string('key')
    .number('timestamp', { default: 0 })
    .build();

/**
 * Schema for ASCustomPilotAbility
 */
export const AS_CUSTOM_PILOT_ABILITY_SCHEMA = Sanitizer.schema<ASCustomPilotAbility>()
    .string('name', { default: '' })
    .number('cost', { default: 1 })
    .string('summary', { default: '' })
    .build();

/**
 * Schema for ASSerializedState
 */
export const AS_SERIALIZED_STATE_SCHEMA = Sanitizer.schema<ASSerializedState>()
    .boolean('modified', { default: false })
    .boolean('destroyed', { default: false })
    .custom('conditions', sanitizeConditions)
    .custom('c3Position', (value: unknown) => {
        if (!value || typeof value !== 'object') return undefined;
        return Sanitizer.sanitize(value, C3_POSITION_SCHEMA);
    })
    .custom('heat', (value: unknown) => {
        if (Array.isArray(value) && value.length >= 2) {
            return [
                typeof value[0] === 'number' ? value[0] : 0,
                typeof value[1] === 'number' ? value[1] : 0
            ] as [number, number];
        }
        return [0, 0] as [number, number];
    })
    .custom('armor', (value: unknown) => {
        if (Array.isArray(value) && value.length >= 2) {
            return [
                typeof value[0] === 'number' ? value[0] : 0,
                typeof value[1] === 'number' ? value[1] : 0
            ] as [number, number];
        }
        return [0, 0] as [number, number];
    })
    .custom('internal', (value: unknown) => {
        if (Array.isArray(value) && value.length >= 2) {
            return [
                typeof value[0] === 'number' ? value[0] : 0,
                typeof value[1] === 'number' ? value[1] : 0
            ] as [number, number];
        }
        return [0, 0] as [number, number];
    })
    .custom('crits', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, AS_CRITICAL_HIT_SCHEMA);
    })
    .custom('pCrits', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, AS_CRITICAL_HIT_SCHEMA);
    })
    .custom('consumed', (value: unknown) => {
        if (!value || typeof value !== 'object') return undefined;
        const result: Record<string, [number, number]> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (Array.isArray(val) && val.length >= 2) {
                result[key] = [
                    typeof val[0] === 'number' ? val[0] : 0,
                    typeof val[1] === 'number' ? val[1] : 0
                ];
            }
        }
        return Object.keys(result).length > 0 ? result : undefined;
    })
    .custom('exhausted', (value: unknown) => {
        if (!Array.isArray(value) || value.length < 3) return undefined;
        const committed = Array.isArray(value[0]) ? value[0].filter((s: unknown) => typeof s === 'string') : [];
        const pendingExhaust = Array.isArray(value[1]) ? value[1].filter((s: unknown) => typeof s === 'string') : [];
        const pendingRestore = Array.isArray(value[2]) ? value[2].filter((s: unknown) => typeof s === 'string') : [];
        if (committed.length === 0 && pendingExhaust.length === 0 && pendingRestore.length === 0) {
            return undefined;
        }
        return [committed, pendingExhaust, pendingRestore] as [string[], string[], string[]];
    })
    .build();

/**
 * Schema for ASSerializedUnit
 */
export const AS_SERIALIZED_UNIT_SCHEMA = Sanitizer.schema<ASSerializedUnit>()
    .string('id')
    .string('unit')
    .string('model')
    .string('chassis')
    .string('alias')
    .number('updatedTs')
    .custom('entityIdentity', preserveEntityIdentityForDeferredResolution)
    .number('skill', { default: DEFAULT_GUNNERY_SKILL, min: 0, max: 8 })
    .custom('abilities', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return value.map((item: unknown) => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
                return Sanitizer.sanitize(item, AS_CUSTOM_PILOT_ABILITY_SCHEMA);
            }
            return null;
        }).filter((item): item is string | ASCustomPilotAbility => item !== null);
    })
    .custom('formationAbilities', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const abilities = value.filter((item): item is string => typeof item === 'string');
        return abilities.length > 0 ? [...new Set(abilities)] : undefined;
    })
    .boolean('commander')
    .custom('state', (value: unknown) => {
        if (!value || typeof value !== 'object') {
            return Sanitizer.sanitize({}, AS_SERIALIZED_STATE_SCHEMA);
        }
        return Sanitizer.sanitize(value, AS_SERIALIZED_STATE_SCHEMA);
    })
    .build();

/**
 * Schema for ASSerializedGroup
 */
export const AS_SERIALIZED_GROUP_SCHEMA = Sanitizer.schema<ASSerializedGroup>()
    .string('id')
    .string('name')
    .string('color')
    .string('formationId')
    .boolean('formationLock')
    .custom('formationTargetGroupId', (value: unknown) => (
        typeof value === 'string' && value.length > 0 ? value : undefined
    ))
    .custom('units', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, AS_SERIALIZED_UNIT_SCHEMA);
    })
    .build();

/**
 * Schema for ASSerializedForce
 */
export const AS_SERIALIZED_FORCE_SCHEMA = Sanitizer.schema<ASSerializedForce>()
    .number('version', { default: 2 })
    .string('timestamp')
    .string('instanceId')
    .string('type')
    .string('name', { default: 'Unnamed Force' })
    .string('note', { maxLength: FORCE_NOTE_MAX_LENGTH })
    .custom('tags', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const tags = sanitizeForceTags(value);
        return tags.length > 0 ? tags : undefined;
    })
    .boolean('factionLock')
    .number('factionId')
    .number('eraId')
    .boolean('eraLock')
    .number('pv')
    .boolean('owned', { default: true })
    .custom('groups', (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return Sanitizer.sanitizeArray(value, AS_SERIALIZED_GROUP_SCHEMA);
    })
    .custom('c3Networks', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        return Sanitizer.sanitizeArray(value, C3_NETWORK_GROUP_SCHEMA);
    })
    .build();

    
export interface ViewportTransform {
    scale: number;
    translateX: number;
    translateY: number;
}
