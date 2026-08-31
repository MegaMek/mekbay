// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Sanitizer } from '../utils/sanitizer.util';
import { GameSystem } from './common.model';
import type { ASCustomPilotAbility } from './pilot-abilities.model';
import type { C3NetworkType } from './c3-network.model';
import type { SerializedCBTForceV2 } from './runtime/persistence-v2';
import { isUnitConditionKey, type UnitConditionKey } from './unit-condition.model';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';

export const FORCE_NOTE_MAX_LENGTH = 2000;
const FORCE_TAG_MAX_LENGTH = 48;
const FORCE_TAG_MAX_COUNT = 32;

function sanitizeForceTagLabel(rawTag: unknown): string | null {
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

export interface ASSerializedForce extends SerializedForce {
    version: 2;
    type: GameSystem.ALPHA_STRIKE;
    groups: ASSerializedGroup[];
    cbt?: never;
}

export interface SerializedGroup {
    id: string;
    name?: string;
    color?: string;
    formationId?: string;
    formationLock?: boolean;
    formationTargetGroupId?: string;
    units: (SerializedUnit | ASSerializedUnit)[];
}

export interface ASSerializedGroup extends SerializedGroup {
    units: ASSerializedUnit[];
}

/** V1-only unit row. Current Alpha Strike persistence uses UUIDs below. */
export interface SerializedUnit {
    id: string;
    unit: string; // Unit name
    model?: string;
    chassis?: string;
    alias?: string;
    commander?: boolean;
    updatedTs?: number;
    /** Historical UUID/provider identity used only while importing V1. */
    entityIdentity?: import('./persisted-unit-state').SavedEntityIdentity;
    state: SerializedState;
}

/**
 * Current Alpha Strike unit wire row. Catalog facts are derived from UUID;
 * every other field is omitted when it equals the runtime default.
 */
export interface ASSerializedUnit {
    id: string;
    uuid: UnitUuid;
    alias?: string;
    updatedTs?: number;
    state?: ASSerializedState;
    skill?: number;
    abilities?: (string | ASCustomPilotAbility)[];
    formationAbilities?: string[];
    commander?: true;
}

export interface ConditionData {
    value?: number;
    pending?: boolean;
}

interface SerializedConditionValue {
    key: UnitConditionKey;
    value?: number;
    pending?: boolean;
}
export type SerializedCondition = UnitConditionKey | SerializedConditionValue;

export function normalizeConditionData(data: ConditionData | undefined): ConditionData | undefined {
    const value = data?.value;
    const normalized: ConditionData = {};
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) normalized.value = value;
    if (data?.pending === true) normalized.pending = true;
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function conditionFromSerialized(entry: SerializedCondition): [UnitConditionKey, ConditionData | undefined] {
    if (typeof entry === 'string') {
        return [entry, undefined];
    }

    return [entry.key, normalizeConditionData(entry)];
}

export function conditionsForSerialization(conditions: ReadonlyMap<UnitConditionKey, ConditionData | undefined>): SerializedCondition[] {
    return Array.from(conditions.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, data]) => {
            const normalized = normalizeConditionData(data);
            return normalized ? { key, ...normalized } : key;
        });
}

export interface SerializedState {
    modified?: boolean;
    destroyed?: boolean;
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
    heat?: [number, number];
    /** Armor as [committed, pendingDelta]. Positive = damage, negative = heal. */
    armor?: [number, number];
    /** Internal as [committed, pendingDelta]. Positive = damage, negative = heal. */
    internal?: [number, number];
    /** 
     * Array of committed critical hits with timestamps for ordering.
     */
    crits?: [key: string, timestamp: number][];
    /**
     * Array of pending critical hit changes.
     * Positive timestamp = pending damage, negative timestamp = pending heal.
     */
    pCrits?: [key: string, timestamp: number][];
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

function sanitizeConditions(value: unknown): SerializedCondition[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const states = new Map<UnitConditionKey, ConditionData | undefined>();

    for (const entry of value) {
        if (typeof entry === 'string') {
            if (isUnitConditionKey(entry)) states.set(entry, undefined);
            continue;
        }

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }

        const record = entry as Record<string, unknown>;
        const condition = record['key'];
        const countedValue = record['value'];
        if (!isUnitConditionKey(condition)) {
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

// ===== Alpha Strike Schemas =====

/**
 * Schema for ASCustomPilotAbility
 */
const AS_CUSTOM_PILOT_ABILITY_SCHEMA = Sanitizer.schema<ASCustomPilotAbility>()
    .string('name', { default: '' })
    .number('cost', { default: 1 })
    .string('summary', { default: '' })
    .build();

/**
 * Schema for ASSerializedState
 */
export const AS_SERIALIZED_STATE_SCHEMA = Sanitizer.schema<ASSerializedState>()
    .boolean('modified')
    .boolean('destroyed')
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
        return undefined;
    })
    .custom('armor', (value: unknown) => {
        if (Array.isArray(value) && value.length >= 2) {
            return [
                typeof value[0] === 'number' ? value[0] : 0,
                typeof value[1] === 'number' ? value[1] : 0
            ] as [number, number];
        }
        return undefined;
    })
    .custom('internal', (value: unknown) => {
        if (Array.isArray(value) && value.length >= 2) {
            return [
                typeof value[0] === 'number' ? value[0] : 0,
                typeof value[1] === 'number' ? value[1] : 0
            ] as [number, number];
        }
        return undefined;
    })
    .custom('crits', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const rows = value.flatMap((entry): [string, number][] => (
            Array.isArray(entry)
                && typeof entry[0] === 'string'
                && typeof entry[1] === 'number'
                && Number.isFinite(entry[1])
                ? [[entry[0], entry[1]]]
                : []
        ));
        return rows.length > 0 ? rows : undefined;
    })
    .custom('pCrits', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const rows = value.flatMap((entry): [string, number][] => (
            Array.isArray(entry)
                && typeof entry[0] === 'string'
                && typeof entry[1] === 'number'
                && Number.isFinite(entry[1])
                ? [[entry[0], entry[1]]]
                : []
        ));
        return rows.length > 0 ? rows : undefined;
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
    .string('uuid')
    .string('alias')
    .number('updatedTs')
    .number('skill', { min: 0, max: 8 })
    .custom('abilities', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const abilities = value.map((item: unknown) => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
                return Sanitizer.sanitize(item, AS_CUSTOM_PILOT_ABILITY_SCHEMA);
            }
            return null;
        }).filter((item): item is string | ASCustomPilotAbility => item !== null);
        return abilities.length > 0 ? abilities : undefined;
    })
    .custom('formationAbilities', (value: unknown) => {
        if (!Array.isArray(value)) return undefined;
        const abilities = value.filter((item): item is string => typeof item === 'string');
        return abilities.length > 0 ? [...new Set(abilities)] : undefined;
    })
    .custom('commander', (value: unknown) => value === true ? true : undefined)
    .custom('state', (value: unknown) => {
        if (!value || typeof value !== 'object') return undefined;
        return Sanitizer.sanitize(value, AS_SERIALIZED_STATE_SCHEMA);
    })
    .build();

/**
 * Schema for ASSerializedGroup
 */
const AS_SERIALIZED_GROUP_SCHEMA = Sanitizer.schema<ASSerializedGroup>()
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
