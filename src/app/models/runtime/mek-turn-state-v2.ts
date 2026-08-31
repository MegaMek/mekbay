// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ImmutableIndex } from '../entity/immutable-collections';
import {
    deserializeUnitCover,
    isUnitCover,
    serializeUnitCover,
    type UnitCover,
} from '../unit-cover.model';

export const MAX_MEK_TURN_COLLECTION_ENTRIES = 256;
export const MAX_MEK_TURN_TEXT_LENGTH = 512;
export const MAX_MEK_TURN_SIGNATURE_LENGTH = 2_048;
export const MAX_MEK_TURN_NUMBER = 1_000_000;

/**
 * Unit-owned facts whose lifetime is one CBT turn. Movement, phase damage, and
 * pilot checks are deliberately absent: `MekMovementPsrStateV2` owns them.
 */
export interface MekTurnStateV2 {
    /** Monotonic per-unit counter retained when the transient turn facts reset. */
    readonly turnCounter: number;
    readonly airborne: boolean | null;
    readonly cover: UnitCover | null;
    readonly weaponsHeat: number;
    readonly acknowledgedHeatSources: ReadonlyMap<string, string>;
    readonly heatDissipationConsumed: number;
    readonly spotting: boolean;
    readonly equipmentStateChanged: boolean;
}

/** Canonical sparse wire form. Map entries are unique and ascending by key. */
export interface SerializedMekTurnStateV2 {
    readonly schemaVersion: 1;
    readonly turnCounter?: number;
    readonly airborne?: boolean;
    readonly cover?: ReturnType<typeof serializeUnitCover>;
    readonly weaponsHeat?: number;
    readonly acknowledgedHeatSources?: readonly {
        readonly sourceId: string;
        readonly signature: string;
    }[];
    readonly heatDissipationConsumed?: number;
    readonly spotting?: true;
    readonly equipmentStateChanged?: true;
}

export class MekTurnStateValidationError extends Error {
    public constructor(message: string, public readonly path = '$') {
        super(`${path}: ${message}`);
        this.name = 'MekTurnStateValidationError';
    }
}

const TURN_KEYS = Object.freeze([
    'turnCounter',
    'airborne',
    'cover',
    'weaponsHeat',
    'acknowledgedHeatSources',
    'heatDissipationConsumed',
    'spotting',
    'equipmentStateChanged',
] as const);

const PRISTINE_MEK_TURN_STATE = freezeMekTurnState({
    turnCounter: 0,
    airborne: null,
    cover: null,
    weaponsHeat: 0,
    acknowledgedHeatSources: new Map(),
    heatDissipationConsumed: 0,
    spotting: false,
    equipmentStateChanged: false,
});

export function createPristineMekTurnStateV2(turnCounter = 0): MekTurnStateV2 {
    if (turnCounter === 0) return PRISTINE_MEK_TURN_STATE;
    return freezeMekTurnState({
        ...PRISTINE_MEK_TURN_STATE,
        turnCounter: turnNumber(turnCounter, '$.turnCounter'),
    });
}

/** Strictly validates and canonicalizes a live runtime value. */
export function canonicalizeMekTurnStateV2(value: MekTurnStateV2): MekTurnStateV2 {
    const record = requireRecord(value, '$');
    exactKeys(record, TURN_KEYS, '$');
    requireKeys(record, TURN_KEYS, '$');
    return freezeMekTurnState({
        turnCounter: turnNumber(record['turnCounter'], '$.turnCounter'),
        airborne: nullableBoolean(record['airborne'], '$.airborne'),
        cover: nullableUnitCover(record['cover'], '$.cover'),
        weaponsHeat: turnNumber(record['weaponsHeat'], '$.weaponsHeat'),
        acknowledgedHeatSources: canonicalStringMap(
            record['acknowledgedHeatSources'],
            '$.acknowledgedHeatSources',
        ),
        heatDissipationConsumed: turnNumber(
            record['heatDissipationConsumed'],
            '$.heatDissipationConsumed',
        ),
        spotting: requiredBoolean(record['spotting'], '$.spotting'),
        equipmentStateChanged: requiredBoolean(
            record['equipmentStateChanged'],
            '$.equipmentStateChanged',
        ),
    });
}

export function serializeMekTurnStateV2(value: MekTurnStateV2): SerializedMekTurnStateV2 {
    const turn = canonicalizeMekTurnStateV2(value);
    return Object.freeze({
        schemaVersion: 1 as const,
        ...(turn.turnCounter === 0 ? {} : { turnCounter: turn.turnCounter }),
        ...(turn.airborne === null ? {} : { airborne: turn.airborne }),
        ...(turn.cover === null ? {} : { cover: serializeUnitCover(turn.cover) }),
        ...(turn.weaponsHeat === 0 ? {} : { weaponsHeat: turn.weaponsHeat }),
        ...(turn.acknowledgedHeatSources.size === 0 ? {} : {
            acknowledgedHeatSources: Object.freeze([...turn.acknowledgedHeatSources]
                .map(([sourceId, signature]) => Object.freeze({ sourceId, signature }))),
        }),
        ...(turn.heatDissipationConsumed === 0
            ? {}
            : { heatDissipationConsumed: turn.heatDissipationConsumed }),
        ...(turn.spotting ? { spotting: true as const } : {}),
        ...(turn.equipmentStateChanged ? { equipmentStateChanged: true as const } : {}),
    });
}

/** Strict current-wire decoder; historical movement fields are rejected. */
export function deserializeMekTurnStateV2(value: unknown): MekTurnStateV2 {
    const record = requireRecord(value, '$');
    exactKeys(record, ['schemaVersion', ...TURN_KEYS], '$');
    if (record['schemaVersion'] !== 1) fail('must be schema version 1', '$.schemaVersion');
    return freezeMekTurnState({
        turnCounter: sparsePositiveNumber(record['turnCounter'], '$.turnCounter'),
        airborne: record['airborne'] === undefined
            ? null
            : requiredBoolean(record['airborne'], '$.airborne'),
        cover: deserializeSparseCover(record['cover'], '$.cover'),
        weaponsHeat: sparsePositiveNumber(record['weaponsHeat'], '$.weaponsHeat'),
        acknowledgedHeatSources: deserializeStringEntries(
            record['acknowledgedHeatSources'],
            '$.acknowledgedHeatSources',
        ),
        heatDissipationConsumed: sparsePositiveNumber(
            record['heatDissipationConsumed'],
            '$.heatDissipationConsumed',
        ),
        spotting: record['spotting'] === undefined
            ? false
            : requireExactBoolean(record['spotting'], true, '$.spotting'),
        equipmentStateChanged: record['equipmentStateChanged'] === undefined
            ? false
            : requireExactBoolean(record['equipmentStateChanged'], true, '$.equipmentStateChanged'),
    });
}

export function mekTurnStatesEqualV2(left: MekTurnStateV2, right: MekTurnStateV2): boolean {
    return JSON.stringify(serializeMekTurnStateV2(left)) === JSON.stringify(serializeMekTurnStateV2(right));
}

function freezeMekTurnState(value: MekTurnStateV2): MekTurnStateV2 {
    return Object.freeze({
        ...value,
        acknowledgedHeatSources: new ImmutableIndex(sortEntries(value.acknowledgedHeatSources)),
    });
}

function canonicalStringMap(value: unknown, path: string): ReadonlyMap<string, string> {
    const entries = iterableEntries(value, path).map(([key, item], index) => [
        canonicalText(key, `${path}[${index}].key`, MAX_MEK_TURN_TEXT_LENGTH),
        canonicalText(item, `${path}[${index}].value`, MAX_MEK_TURN_SIGNATURE_LENGTH),
    ] as const);
    return new ImmutableIndex(uniqueSortedEntries(entries, path));
}

function deserializeStringEntries(value: unknown, path: string): ReadonlyMap<string, string> {
    if (value === undefined) return new ImmutableIndex([]);
    const rows = requireArray(value, path);
    if (rows.length === 0) fail('sparse collection must not be empty', path);
    const entries = rows.map((item, index) => {
        const itemPath = `${path}[${index}]`;
        const record = requireRecord(item, itemPath);
        exactKeys(record, ['sourceId', 'signature'], itemPath);
        requireKeys(record, ['sourceId', 'signature'], itemPath);
        return [
            canonicalText(record['sourceId'], `${itemPath}.sourceId`, MAX_MEK_TURN_TEXT_LENGTH),
            canonicalText(record['signature'], `${itemPath}.signature`, MAX_MEK_TURN_SIGNATURE_LENGTH),
        ] as const;
    });
    requireSortedUnique(entries, path);
    return new ImmutableIndex(entries);
}

function iterableEntries(value: unknown, path: string): readonly (readonly [unknown, unknown])[] {
    if (value === null || typeof value !== 'object'
        || typeof (value as ReadonlyMap<unknown, unknown>)[Symbol.iterator] !== 'function') {
        fail('must be a readonly map', path);
    }
    let rows: unknown[];
    try {
        rows = [...(value as Iterable<unknown>)];
    } catch {
        fail('must be an iterable readonly map', path);
    }
    if (rows.length > MAX_MEK_TURN_COLLECTION_ENTRIES) {
        fail(`must contain at most ${MAX_MEK_TURN_COLLECTION_ENTRIES} entries`, path);
    }
    return rows.map((row, index) => {
        if (!Array.isArray(row) || row.length !== 2) {
            fail('must contain key/value entries', `${path}[${index}]`);
        }
        return [row[0], row[1]] as const;
    });
}

function uniqueSortedEntries<K extends string, V>(
    entries: readonly (readonly [K, V])[],
    path: string,
): readonly (readonly [K, V])[] {
    const sorted = [...entries].sort(([left], [right]) => compareText(left, right));
    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index - 1][0] === sorted[index][0]) fail('must contain unique keys', path);
    }
    return sorted;
}

function requireSortedUnique<V>(entries: readonly (readonly [string, V])[], path: string): void {
    for (let index = 1; index < entries.length; index += 1) {
        if (entries[index - 1][0] >= entries[index][0]) {
            fail('must be unique and sorted', `${path}[${index}]`);
        }
    }
}

function sortEntries<K extends string, V>(values: ReadonlyMap<K, V>): readonly (readonly [K, V])[] {
    return [...values].sort(([left], [right]) => compareText(left, right));
}

function nullableBoolean(value: unknown, path: string): boolean | null {
    return value === null ? null : requiredBoolean(value, path);
}

function nullableUnitCover(value: unknown, path: string): UnitCover | null {
    if (value === null) return null;
    if (!isUnitCover(value)) fail('must be a valid unit cover or null', path);
    return value;
}

function deserializeSparseCover(value: unknown, path: string): UnitCover | null {
    if (value === undefined) return null;
    const cover = deserializeUnitCover(value);
    if (cover === undefined) fail('must be a serialized unit cover', path);
    return cover;
}

function requiredBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') fail('must be boolean', path);
    return value;
}

function requireExactBoolean<T extends boolean>(value: unknown, expected: T, path: string): T {
    if (value !== expected) fail(`canonical sparse value must be ${expected}`, path);
    return expected;
}

function turnNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
        || value < 0 || value > MAX_MEK_TURN_NUMBER) {
        fail(`must be a canonical number from 0 to ${MAX_MEK_TURN_NUMBER}`, path);
    }
    return value;
}

function sparsePositiveNumber(value: unknown, path: string): number {
    if (value === undefined) return 0;
    const result = turnNumber(value, path);
    if (result === 0) fail('sparse number must be positive', path);
    return result;
}

function canonicalText(value: unknown, path: string, maximumLength: number): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength
        || value.includes('\0') || value !== value.trim() || value !== value.normalize('NFC')) {
        fail(`must be canonical non-empty text of at most ${maximumLength} characters`, path);
    }
    return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        fail('must be a plain object', path);
    }
    return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
    const allowed = new Set(keys);
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) fail('contains an unknown field', `${path}.${key}`);
    }
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
    for (const key of keys) if (!(key in record)) fail('is required', `${path}.${key}`);
}

function requireArray(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) fail('must be an array', path);
    if (value.length > MAX_MEK_TURN_COLLECTION_ENTRIES) {
        fail(`must contain at most ${MAX_MEK_TURN_COLLECTION_ENTRIES} entries`, path);
    }
    return value;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message: string, path: string): never {
    throw new MekTurnStateValidationError(message, path);
}
