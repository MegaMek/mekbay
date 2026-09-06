// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { isObjectLiteralRecord } from '../../utils/json-value.util';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import {
    deserializeUnitCover,
    isUnitCover,
    type UnitCover,
} from '../unit-cover.model';

const MAX_MEK_TURN_COLLECTION_ENTRIES = 256;
const MAX_MEK_TURN_LOCATION_ENTRIES = 64;
const MAX_MEK_TURN_TEXT_LENGTH = 512;
const MAX_MEK_TURN_CHECK_ID_LENGTH = 256;
const MAX_MEK_TURN_SIGNATURE_LENGTH = 2_048;
const MAX_MEK_TURN_NUMBER = 1_000_000;

export type LegacyMekTurnMoveModeV1 = 'stationary' | 'walk' | 'run' | 'jump' | 'UMU' | 'VTOL';
export type LegacyMekTurnRuleCheckOutcomeV1 = 'success' | 'failed';

export interface LegacyMekTurnPsrChecksV1 {
    readonly legActuators: ReadonlyMap<string, number>;
    readonly hipsHit: ReadonlySet<string>;
    readonly gyroHit: number;
    readonly gyroDestroyed: boolean;
    readonly legsDestroyed: ReadonlySet<string>;
    readonly shutdown: boolean;
}

/** Transient V1 turn facts used only while constructing the current runtime state. */
export interface LegacyMekTurnStateV1 {
    readonly turnCounter: number;
    readonly airborne: boolean | null;
    readonly cover: UnitCover | null;
    readonly moveMode: LegacyMekTurnMoveModeV1 | null;
    readonly moveDistance: number | null;
    readonly standAttempts: number;
    readonly carefulStand: boolean;
    readonly dmgReceived: number;
    readonly weaponsHeat: number;
    readonly acknowledgedHeatSources: ReadonlyMap<string, string>;
    readonly heatDissipationConsumed: number;
    readonly psrOutcomes: ReadonlyMap<string, LegacyMekTurnRuleCheckOutcomeV1>;
    readonly psrChecks: LegacyMekTurnPsrChecksV1;
    readonly applyMovePSR: boolean;
    readonly spotting: boolean;
    readonly equipmentStateChanged: boolean;
}

export interface LegacyMekTurnStateParseResultV1 {
    readonly state: LegacyMekTurnStateV1;
    readonly warnings: readonly string[];
}

export class LegacyMekTurnStateValidationErrorV1 extends Error {
    public constructor(message: string, public readonly path = '$') {
        super(`${path}: ${message}`);
        this.name = 'LegacyMekTurnStateValidationErrorV1';
    }
}

const MOVE_MODES: readonly LegacyMekTurnMoveModeV1[] = ['stationary', 'walk', 'run', 'jump', 'UMU', 'VTOL'];
const TURN_KEYS = Object.freeze([
    'turnCounter',
    'airborne',
    'cover',
    'moveMode',
    'moveDistance',
    'standAttempts',
    'carefulStand',
    'dmgReceived',
    'weaponsHeat',
    'acknowledgedHeatSources',
    'heatDissipationConsumed',
    'psrOutcomes',
    'psrChecks',
    'applyMovePSR',
    'spotting',
    'equipmentStateChanged',
] as const);
const TURN_KEY_SET = new Set<string>(TURN_KEYS);

const PRISTINE_LEGACY_MEK_TURN_STATE = freezeLegacyMekTurnStateV1({
    turnCounter: 0,
    airborne: null,
    cover: null,
    moveMode: null,
    moveDistance: null,
    standAttempts: 0,
    carefulStand: false,
    dmgReceived: 0,
    weaponsHeat: 0,
    acknowledgedHeatSources: new Map(),
    heatDissipationConsumed: 0,
    psrOutcomes: new Map(),
    psrChecks: {
        legActuators: new Map(),
        hipsHit: new Set(),
        gyroHit: 0,
        gyroDestroyed: false,
        legsDestroyed: new Set(),
        shutdown: false,
    },
    applyMovePSR: true,
    spotting: false,
    equipmentStateChanged: false,
});

export function createPristineLegacyMekTurnStateV1(): LegacyMekTurnStateV1 {
    return PRISTINE_LEGACY_MEK_TURN_STATE;
}

/** Strictly validates and canonicalizes a runtime value. */
export function canonicalizeLegacyMekTurnStateV1(value: LegacyMekTurnStateV1): LegacyMekTurnStateV1 {
    const record = requireRecord(value, '$');
    exactKeys(record, TURN_KEYS, '$');
    requireKeys(record, TURN_KEYS, '$');
    const psr = requireRecord(record['psrChecks'], '$.psrChecks');
    const psrKeys = [
        'legActuators', 'hipsHit', 'gyroHit', 'gyroDestroyed', 'legsDestroyed', 'shutdown',
    ] as const;
    exactKeys(psr, psrKeys, '$.psrChecks');
    requireKeys(psr, psrKeys, '$.psrChecks');
    const standAttempts = turnInteger(record['standAttempts'], '$.standAttempts');
    const carefulStand = requiredBoolean(record['carefulStand'], '$.carefulStand');
    if (carefulStand && standAttempts === 0) {
        fail('careful stand requires at least one attempt', '$.carefulStand');
    }
    return freezeLegacyMekTurnStateV1({
        turnCounter: turnInteger(record['turnCounter'], '$.turnCounter'),
        airborne: nullableBoolean(record['airborne'], '$.airborne'),
        cover: nullableUnitCover(record['cover'], '$.cover'),
        moveMode: nullableMoveMode(record['moveMode'], '$.moveMode'),
        moveDistance: nullableTurnNumber(record['moveDistance'], '$.moveDistance'),
        standAttempts,
        carefulStand,
        dmgReceived: turnNumber(record['dmgReceived'], '$.dmgReceived'),
        weaponsHeat: turnNumber(record['weaponsHeat'], '$.weaponsHeat'),
        acknowledgedHeatSources: canonicalStringMap(
            record['acknowledgedHeatSources'],
            '$.acknowledgedHeatSources',
            MAX_MEK_TURN_COLLECTION_ENTRIES,
            MAX_MEK_TURN_SIGNATURE_LENGTH,
        ),
        heatDissipationConsumed: turnNumber(
            record['heatDissipationConsumed'],
            '$.heatDissipationConsumed',
        ),
        psrOutcomes: canonicalOutcomeMap(record['psrOutcomes'], '$.psrOutcomes'),
        psrChecks: {
            legActuators: canonicalPositiveIntegerMap(
                psr['legActuators'],
                '$.psrChecks.legActuators',
            ),
            hipsHit: canonicalStringSet(psr['hipsHit'], '$.psrChecks.hipsHit'),
            gyroHit: turnInteger(psr['gyroHit'], '$.psrChecks.gyroHit'),
            gyroDestroyed: requiredBoolean(psr['gyroDestroyed'], '$.psrChecks.gyroDestroyed'),
            legsDestroyed: canonicalStringSet(psr['legsDestroyed'], '$.psrChecks.legsDestroyed'),
            shutdown: requiredBoolean(psr['shutdown'], '$.psrChecks.shutdown'),
        },
        applyMovePSR: requiredBoolean(record['applyMovePSR'], '$.applyMovePSR'),
        spotting: requiredBoolean(record['spotting'], '$.spotting'),
        equipmentStateChanged: requiredBoolean(
            record['equipmentStateChanged'],
            '$.equipmentStateChanged',
        ),
    });
}

/** Reads production V1 turn facts, skipping malformed fields with concise warnings. */
export function parseLegacyMekTurnStateV1(value: unknown): LegacyMekTurnStateParseResultV1 {
    if (value === undefined) return { state: createPristineLegacyMekTurnStateV1(), warnings: [] };
    if (!isObjectLiteralRecord(value)) {
        return { state: createPristineLegacyMekTurnStateV1(), warnings: ['Unreadable saved turn state was reset.'] };
    }
    const raw = value;
    const warnings: string[] = [];
    if (Object.keys(raw).some(key => !TURN_KEY_SET.has(key))) warnings.push('Unknown saved turn fields were skipped.');
    const state = mutablePristine();
    const invalid = (field: string) => warnings.push('Invalid saved ' + field + ' was skipped.');

    for (const key of ['airborne', 'carefulStand', 'applyMovePSR', 'spotting', 'equipmentStateChanged'] as const) {
        if (!(key in raw)) continue;
        const value = raw[key];
        if (typeof value !== 'boolean') invalid(key);
        else state[key] = value;
    }
    for (const key of ['turnCounter', 'standAttempts'] as const) {
        if (!(key in raw)) continue;
        const value = legacyNonnegativeInteger(raw[key]);
        if (value === null) invalid(key);
        else state[key] = value;
    }
    if ('cover' in raw) {
        const value = deserializeUnitCover(raw['cover']);
        if (value === undefined) invalid('cover');
        else state.cover = value;
    }
    if ('moveMode' in raw) {
        if (isMoveMode(raw['moveMode'])) state.moveMode = raw['moveMode'];
        else invalid('movement mode');
    }
    for (const key of ['moveDistance', 'dmgReceived', 'weaponsHeat', 'heatDissipationConsumed'] as const) {
        if (!(key in raw)) continue;
        const value = legacyNonnegativeNumber(raw[key]);
        if (value === null) invalid(key);
        else state[key] = value;
    }
    if ('acknowledgedHeatSources' in raw) {
        const parsed = parseLegacyStringRecord(raw['acknowledgedHeatSources'], MAX_MEK_TURN_SIGNATURE_LENGTH);
        state.acknowledgedHeatSources = parsed.value;
        if (parsed.invalid) invalid('heat acknowledgements');
    }
    if ('psrOutcomes' in raw) {
        const parsed = parseLegacyOutcomeRecord(raw['psrOutcomes']);
        state.psrOutcomes = parsed.value;
        if (parsed.invalid) invalid('piloting check outcomes');
    }
    if ('psrChecks' in raw) {
        const parsed = parseLegacyPSRChecks(raw['psrChecks']);
        state.psrChecks = parsed.state;
        if (parsed.invalid) invalid('piloting checks');
    }
    if (state.carefulStand && state.standAttempts === 0) {
        warnings.push('Saved careful standing had no standing attempt and was reset.');
        state.carefulStand = false;
    }
    return { state: canonicalizeLegacyMekTurnStateV1(state), warnings: Object.freeze(warnings) };
}

function freezeLegacyMekTurnStateV1(value: LegacyMekTurnStateV1): LegacyMekTurnStateV1 {
    const psrChecks = Object.freeze({
        ...value.psrChecks,
        legActuators: new ImmutableIndex(sortEntries(value.psrChecks.legActuators)),
        hipsHit: new ImmutableSet(sortValues(value.psrChecks.hipsHit)),
        legsDestroyed: new ImmutableSet(sortValues(value.psrChecks.legsDestroyed)),
    });
    return Object.freeze({
        ...value,
        acknowledgedHeatSources: new ImmutableIndex(sortEntries(value.acknowledgedHeatSources)),
        psrOutcomes: new ImmutableIndex(sortEntries(value.psrOutcomes)),
        psrChecks,
    });
}

function mutablePristine(): LegacyMekTurnStateV1 & {
    turnCounter: number;
    airborne: boolean | null;
    cover: UnitCover | null;
    moveMode: LegacyMekTurnMoveModeV1 | null;
    moveDistance: number | null;
    standAttempts: number;
    carefulStand: boolean;
    dmgReceived: number;
    weaponsHeat: number;
    acknowledgedHeatSources: ReadonlyMap<string, string>;
    heatDissipationConsumed: number;
    psrOutcomes: ReadonlyMap<string, LegacyMekTurnRuleCheckOutcomeV1>;
    psrChecks: LegacyMekTurnPsrChecksV1;
    applyMovePSR: boolean;
    spotting: boolean;
    equipmentStateChanged: boolean;
} {
    const pristine = createPristineLegacyMekTurnStateV1();
    return { ...pristine, psrChecks: { ...pristine.psrChecks } };
}

function canonicalStringMap(
    value: unknown,
    path: string,
    maximumEntries: number,
    maximumValueLength: number,
): ReadonlyMap<string, string> {
    const entries = iterableEntries(value, path, maximumEntries).map(([key, item], index) => [
        canonicalText(key, `${path}[${index}].key`, MAX_MEK_TURN_TEXT_LENGTH),
        canonicalText(item, `${path}[${index}].value`, maximumValueLength),
    ] as const);
    return new ImmutableIndex(uniqueSortedEntries(entries, path));
}

function canonicalOutcomeMap(value: unknown, path: string): ReadonlyMap<string, LegacyMekTurnRuleCheckOutcomeV1> {
    const entries = iterableEntries(value, path, MAX_MEK_TURN_COLLECTION_ENTRIES).map(([key, item], index) => {
        if (!isOutcome(item)) fail('must be success or failed', `${path}[${index}].outcome`);
        return [canonicalText(key, `${path}[${index}].checkId`, MAX_MEK_TURN_CHECK_ID_LENGTH), item] as const;
    });
    return new ImmutableIndex(uniqueSortedEntries(entries, path));
}

function canonicalPositiveIntegerMap(value: unknown, path: string): ReadonlyMap<string, number> {
    const entries = iterableEntries(value, path, MAX_MEK_TURN_LOCATION_ENTRIES).map(([key, item], index) => [
        canonicalText(key, `${path}[${index}].location`, MAX_MEK_TURN_TEXT_LENGTH),
        positiveTurnInteger(item, `${path}[${index}].hits`),
    ] as const);
    return new ImmutableIndex(uniqueSortedEntries(entries, path));
}

function canonicalStringSet(value: unknown, path: string): ReadonlySet<string> {
    const rows = iterableValues(value, path, MAX_MEK_TURN_LOCATION_ENTRIES)
        .map((item, index) => canonicalText(item, `${path}[${index}]`, MAX_MEK_TURN_TEXT_LENGTH));
    const sorted = [...rows].sort(compareText);
    if (new Set(sorted).size !== sorted.length) fail('must contain unique values', path);
    return new ImmutableSet(sorted);
}

function parseLegacyStringRecord(value: unknown, maximumValueLength: number): {
    readonly value: ReadonlyMap<string, string>;
    readonly invalid: boolean;
} {
    if (!isObjectLiteralRecord(value)) return { value: new Map(), invalid: true };
    const rows = Object.entries(value);
    if (rows.length > MAX_MEK_TURN_COLLECTION_ENTRIES) {
        return { value: new Map(), invalid: true };
    }
    const parsed = new Map<string, string>();
    let partialInvalid = false;
    for (const [rawKey, rawValue] of rows) {
        const key = rawKey.trim().normalize('NFC');
        const item = typeof rawValue === 'string' ? rawValue.trim().normalize('NFC') : '';
        if (!validText(key, MAX_MEK_TURN_TEXT_LENGTH) || !validText(item, maximumValueLength)
            || parsed.has(key)) {
            partialInvalid = true;
            continue;
        }
        parsed.set(key, item);
    }
    return {
        value: new ImmutableIndex(sortEntries(parsed)),
        invalid: partialInvalid,
    };
}

function parseLegacyOutcomeRecord(value: unknown): {
    readonly value: ReadonlyMap<string, LegacyMekTurnRuleCheckOutcomeV1>;
    readonly invalid: boolean;
} {
    if (!isObjectLiteralRecord(value)) return { value: new Map(), invalid: true };
    const rows = Object.entries(value);
    if (rows.length > MAX_MEK_TURN_COLLECTION_ENTRIES) {
        return { value: new Map(), invalid: true };
    }
    const parsed = new Map<string, LegacyMekTurnRuleCheckOutcomeV1>();
    let partialInvalid = false;
    for (const [rawKey, rawValue] of rows) {
        const key = rawKey.trim().normalize('NFC');
        if (!validText(key, MAX_MEK_TURN_CHECK_ID_LENGTH) || !isOutcome(rawValue) || parsed.has(key)) {
            partialInvalid = true;
            continue;
        }
        parsed.set(key, rawValue);
    }
    return {
        value: new ImmutableIndex(sortEntries(parsed)),
        invalid: partialInvalid,
    };
}

function parseLegacyPSRChecks(value: unknown): {
    readonly state: LegacyMekTurnPsrChecksV1;
    readonly invalid: boolean;
} {
    if (!isObjectLiteralRecord(value)) return { state: createPristineLegacyMekTurnStateV1().psrChecks, invalid: true };
    const raw = value;
    let invalid = Object.keys(raw).some(key =>
        !['legActuators', 'hipsHit', 'gyroHit', 'gyroDestroyed', 'legsDestroyed', 'shutdown'].includes(key));
    const state = { ...createPristineLegacyMekTurnStateV1().psrChecks };
    if ('legActuators' in raw) {
        const parsed = parseLegacyPositiveIntegerRecord(raw['legActuators']);
        state.legActuators = parsed.value;
        invalid ||= parsed.invalid;
    }
    for (const key of ['hipsHit', 'legsDestroyed'] as const) {
        if (!(key in raw)) continue;
        const parsed = parseLegacyStringArray(raw[key]);
        state[key] = parsed.value;
        invalid ||= parsed.invalid;
    }
    if ('gyroHit' in raw) {
        const value = legacyNonnegativeInteger(raw['gyroHit']);
        if (value === null) invalid = true;
        else state.gyroHit = value;
    }
    for (const key of ['gyroDestroyed', 'shutdown'] as const) {
        if (!(key in raw)) continue;
        const value = raw[key];
        if (typeof value !== 'boolean') invalid = true;
        else state[key] = value;
    }
    return { state: Object.freeze(state), invalid };
}

function parseLegacyPositiveIntegerRecord(value: unknown): {
    readonly value: ImmutableIndex<string, number>;
    readonly invalid: boolean;
} {
    if (!isObjectLiteralRecord(value)) return { value: new ImmutableIndex([]), invalid: true };
    const rows = Object.entries(value);
    if (rows.length > MAX_MEK_TURN_LOCATION_ENTRIES) {
        return { value: new ImmutableIndex([]), invalid: true };
    }
    const parsed = new Map<string, number>();
    let partialInvalid = false;
    for (const [rawKey, rawValue] of rows) {
        const key = rawKey.trim().normalize('NFC');
        const item = legacyPositiveInteger(rawValue);
        if (!validText(key, MAX_MEK_TURN_TEXT_LENGTH) || item === null || parsed.has(key)) {
            partialInvalid = true;
            continue;
        }
        parsed.set(key, item);
    }
    return {
        value: new ImmutableIndex(sortEntries(parsed)),
        invalid: partialInvalid,
    };
}

function parseLegacyStringArray(value: unknown): {
    readonly value: ImmutableSet<string>;
    readonly invalid: boolean;
} {
    if (!Array.isArray(value) || value.length > MAX_MEK_TURN_LOCATION_ENTRIES) {
        return { value: new ImmutableSet([]), invalid: true };
    }
    const parsed = new Set<string>();
    let partialInvalid = false;
    for (const raw of value) {
        const item = typeof raw === 'string' ? raw.trim().normalize('NFC') : '';
        if (!validText(item, MAX_MEK_TURN_TEXT_LENGTH)) partialInvalid = true;
        else parsed.add(item);
    }
    return {
        value: new ImmutableSet(sortValues(parsed)),
        invalid: partialInvalid,
    };
}

function iterableEntries(value: unknown, path: string, maximum: number): readonly (readonly [unknown, unknown])[] {
    if (value === null || typeof value !== 'object' || typeof (value as ReadonlyMap<unknown, unknown>)[Symbol.iterator] !== 'function') {
        fail('must be a readonly map', path);
    }
    let rows: unknown[];
    try { rows = [...(value as Iterable<unknown>)]; }
    catch { fail('must be an iterable readonly map', path); }
    if (rows.length > maximum) fail(`must contain at most ${maximum} entries`, path);
    return rows.map((row, index) => {
        if (!Array.isArray(row) || row.length !== 2) fail('must contain key/value entries', `${path}[${index}]`);
        return [row[0], row[1]] as const;
    });
}

function iterableValues(value: unknown, path: string, maximum: number): readonly unknown[] {
    if (value === null || typeof value !== 'object' || typeof (value as ReadonlySet<unknown>)[Symbol.iterator] !== 'function') {
        fail('must be a readonly set', path);
    }
    let rows: unknown[];
    try { rows = [...(value as Iterable<unknown>)]; }
    catch { fail('must be an iterable readonly set', path); }
    if (rows.length > maximum) fail(`must contain at most ${maximum} entries`, path);
    return rows;
}

function uniqueSortedEntries<K extends string, V>(
    entries: readonly (readonly [K, V])[],
    path: string,
): readonly (readonly [K, V])[] {
    const sorted = [...entries].sort(([left], [right]) => compareText(left, right));
    for (let index = 1; index < sorted.length; index++) {
        if (sorted[index - 1][0] === sorted[index][0]) fail('must contain unique keys', path);
    }
    return sorted;
}

function sortEntries<K extends string, V>(values: ReadonlyMap<K, V>): readonly (readonly [K, V])[] {
    return [...values].sort(([left], [right]) => compareText(left, right));
}

function sortValues<T extends string>(values: ReadonlySet<T>): readonly T[] {
    return [...values].sort(compareText);
}

function nullableBoolean(value: unknown, path: string): boolean | null {
    if (value === null) return null;
    return requiredBoolean(value, path);
}

function nullableUnitCover(value: unknown, path: string): UnitCover | null {
    if (value === null) return null;
    if (!isUnitCover(value)) fail('must be a valid unit cover or null', path);
    return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') fail('must be boolean', path);
    return value;
}

function nullableMoveMode(value: unknown, path: string): LegacyMekTurnMoveModeV1 | null {
    if (value === null) return null;
    return requiredMoveMode(value, path);
}

function requiredMoveMode(value: unknown, path: string): LegacyMekTurnMoveModeV1 {
    if (!isMoveMode(value)) fail('must be a supported motive mode', path);
    return value;
}

function nullableTurnNumber(value: unknown, path: string): number | null {
    return value === null ? null : turnNumber(value, path);
}

function turnNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
        || value < 0 || value > MAX_MEK_TURN_NUMBER) {
        fail(`must be a canonical number from 0 to ${MAX_MEK_TURN_NUMBER}`, path);
    }
    return value;
}

function turnInteger(value: unknown, path: string): number {
    const result = turnNumber(value, path);
    if (!Number.isSafeInteger(result)) fail('must be a safe integer', path);
    return result;
}

function positiveTurnInteger(value: unknown, path: string): number {
    const result = turnInteger(value, path);
    if (result === 0) fail('must be positive', path);
    return result;
}

function canonicalText(value: unknown, path: string, maximumLength: number): string {
    if (typeof value !== 'string' || !validText(value, maximumLength)
        || value !== value.trim() || value !== value.normalize('NFC')) {
        fail(`must be canonical non-empty text of at most ${maximumLength} characters`, path);
    }
    return value;
}

function validText(value: string, maximumLength: number): boolean {
    return value.length > 0 && value.length <= maximumLength && !value.includes('\0');
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
    if (!isObjectLiteralRecord(value)) fail('must be a plain object', path);
    return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
    const allowed = new Set(keys);
    for (const key of Object.keys(record)) if (!allowed.has(key)) fail('contains an unknown field', `${path}.${key}`);
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
    for (const key of keys) if (!(key in record)) fail('is required', `${path}.${key}`);
}

function legacyNonnegativeNumber(value: unknown): number | null {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && !Object.is(parsed, -0) && parsed >= 0 && parsed <= MAX_MEK_TURN_NUMBER
        ? parsed
        : null;
}

function legacyNonnegativeInteger(value: unknown): number | null {
    const parsed = legacyNonnegativeNumber(value);
    return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function legacyPositiveInteger(value: unknown): number | null {
    const parsed = legacyNonnegativeInteger(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function isMoveMode(value: unknown): value is LegacyMekTurnMoveModeV1 {
    return MOVE_MODES.includes(value as LegacyMekTurnMoveModeV1);
}

function isOutcome(value: unknown): value is LegacyMekTurnRuleCheckOutcomeV1 {
    return value === 'success' || value === 'failed';
}

function fail(message: string, path: string): never {
    throw new LegacyMekTurnStateValidationErrorV1(message, path);
}
