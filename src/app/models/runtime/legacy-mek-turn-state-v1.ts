// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { isObjectLiteralRecord, isRecord } from '../../utils/json-value.util';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import {
    deserializeUnitCover,
    isUnitCover,
    serializeUnitCover,
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

/**
 * Framework-free, unit-owned state for facts that live for one CBT turn.
 * Defaults are explicit here; only the persistence DTO below is sparse.
 */
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

export interface SerializedLegacyMekTurnPsrChecksV1 {
    readonly legActuators?: readonly {
        readonly location: string;
        readonly hits: number;
    }[];
    readonly hipsHit?: readonly string[];
    readonly gyroHit?: number;
    readonly gyroDestroyed?: true;
    readonly legsDestroyed?: readonly string[];
    readonly shutdown?: true;
}

/** Canonical sparse wire form. Map/set entries are unique and ascending by key. */
export interface SerializedLegacyMekTurnStateV1 {
    readonly schemaVersion: 1;
    readonly turnCounter?: number;
    readonly airborne?: boolean;
    readonly cover?: ReturnType<typeof serializeUnitCover>;
    readonly moveMode?: LegacyMekTurnMoveModeV1;
    readonly moveDistance?: number;
    readonly standAttempts?: number;
    readonly carefulStand?: true;
    readonly dmgReceived?: number;
    readonly weaponsHeat?: number;
    readonly acknowledgedHeatSources?: readonly {
        readonly sourceId: string;
        readonly signature: string;
    }[];
    readonly heatDissipationConsumed?: number;
    readonly psrOutcomes?: readonly {
        readonly checkId: string;
        readonly outcome: LegacyMekTurnRuleCheckOutcomeV1;
    }[];
    readonly psrChecks?: SerializedLegacyMekTurnPsrChecksV1;
    readonly applyMovePSR?: false;
    readonly spotting?: true;
    readonly equipmentStateChanged?: true;
}

export interface LegacyMekTurnStateParseResultV1 {
    readonly state: LegacyMekTurnStateV1;
    readonly appliedFacts: number;
    /** Exact invalid/unknown fragments, suitable for a legacy recovery witness. */
    readonly unresolved?: unknown;
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

export function serializeLegacyMekTurnStateV1(value: LegacyMekTurnStateV1): SerializedLegacyMekTurnStateV1 {
    const turn = canonicalizeLegacyMekTurnStateV1(value);
    const legActuators = [...turn.psrChecks.legActuators]
        .map(([location, hits]) => Object.freeze({ location, hits }));
    const psrChecks: SerializedLegacyMekTurnPsrChecksV1 = Object.freeze({
        ...(legActuators.length === 0 ? {} : { legActuators: Object.freeze(legActuators) }),
        ...(turn.psrChecks.hipsHit.size === 0
            ? {}
            : { hipsHit: Object.freeze([...turn.psrChecks.hipsHit]) }),
        ...(turn.psrChecks.gyroHit === 0 ? {} : { gyroHit: turn.psrChecks.gyroHit }),
        ...(turn.psrChecks.gyroDestroyed ? { gyroDestroyed: true as const } : {}),
        ...(turn.psrChecks.legsDestroyed.size === 0
            ? {}
            : { legsDestroyed: Object.freeze([...turn.psrChecks.legsDestroyed]) }),
        ...(turn.psrChecks.shutdown ? { shutdown: true as const } : {}),
    });
    const hasPSRChecks = Object.keys(psrChecks).length > 0;
    return Object.freeze({
        schemaVersion: 1 as const,
        ...(turn.turnCounter === 0 ? {} : { turnCounter: turn.turnCounter }),
        ...(turn.airborne === null ? {} : { airborne: turn.airborne }),
        ...(turn.cover === null ? {} : { cover: serializeUnitCover(turn.cover) }),
        ...(turn.moveMode === null ? {} : { moveMode: turn.moveMode }),
        ...(turn.moveDistance === null ? {} : { moveDistance: turn.moveDistance }),
        ...(turn.standAttempts === 0 ? {} : { standAttempts: turn.standAttempts }),
        ...(turn.carefulStand ? { carefulStand: true as const } : {}),
        ...(turn.dmgReceived === 0 ? {} : { dmgReceived: turn.dmgReceived }),
        ...(turn.weaponsHeat === 0 ? {} : { weaponsHeat: turn.weaponsHeat }),
        ...(turn.acknowledgedHeatSources.size === 0 ? {} : {
            acknowledgedHeatSources: Object.freeze([...turn.acknowledgedHeatSources]
                .map(([sourceId, signature]) => Object.freeze({ sourceId, signature }))),
        }),
        ...(turn.heatDissipationConsumed === 0
            ? {}
            : { heatDissipationConsumed: turn.heatDissipationConsumed }),
        ...(turn.psrOutcomes.size === 0 ? {} : {
            psrOutcomes: Object.freeze([...turn.psrOutcomes]
                .map(([checkId, outcome]) => Object.freeze({ checkId, outcome }))),
        }),
        ...(hasPSRChecks ? { psrChecks } : {}),
        ...(turn.applyMovePSR ? {} : { applyMovePSR: false as const }),
        ...(turn.spotting ? { spotting: true as const } : {}),
        ...(turn.equipmentStateChanged ? { equipmentStateChanged: true as const } : {}),
    });
}

/** Strict wire decoder. It rejects unknown fields, non-sparse defaults, and unsorted collections. */
export function deserializeLegacyMekTurnStateV1(value: unknown): LegacyMekTurnStateV1 {
    const record = requireRecord(value, '$');
    exactKeys(record, ['schemaVersion', ...TURN_KEYS], '$');
    if (record['schemaVersion'] !== 1) fail('must be schema version 1', '$.schemaVersion');
    const psr = record['psrChecks'] === undefined
        ? undefined
        : deserializePSRChecks(record['psrChecks'], '$.psrChecks');
    const standAttempts = sparsePositiveInteger(record['standAttempts'], '$.standAttempts');
    const carefulStand = record['carefulStand'] === undefined
        ? false
        : requireExactBoolean(record['carefulStand'], true, '$.carefulStand');
    if (carefulStand && standAttempts === 0) {
        fail('careful stand requires at least one attempt', '$.carefulStand');
    }
    return freezeLegacyMekTurnStateV1({
        turnCounter: sparsePositiveInteger(record['turnCounter'], '$.turnCounter'),
        airborne: record['airborne'] === undefined
            ? null
            : requiredBoolean(record['airborne'], '$.airborne'),
        cover: deserializeSparseCover(record['cover'], '$.cover'),
        moveMode: record['moveMode'] === undefined
            ? null
            : requiredMoveMode(record['moveMode'], '$.moveMode'),
        moveDistance: record['moveDistance'] === undefined
            ? null
            : turnNumber(record['moveDistance'], '$.moveDistance'),
        standAttempts,
        carefulStand,
        dmgReceived: sparsePositiveNumber(record['dmgReceived'], '$.dmgReceived'),
        weaponsHeat: sparsePositiveNumber(record['weaponsHeat'], '$.weaponsHeat'),
        acknowledgedHeatSources: deserializeStringEntries(
            record['acknowledgedHeatSources'],
            '$.acknowledgedHeatSources',
            'sourceId',
            'signature',
            MAX_MEK_TURN_COLLECTION_ENTRIES,
            MAX_MEK_TURN_SIGNATURE_LENGTH,
        ),
        heatDissipationConsumed: sparsePositiveNumber(
            record['heatDissipationConsumed'],
            '$.heatDissipationConsumed',
        ),
        psrOutcomes: deserializeOutcomeEntries(record['psrOutcomes'], '$.psrOutcomes'),
        psrChecks: psr ?? pristinePSRChecks(),
        applyMovePSR: record['applyMovePSR'] === undefined
            ? true
            : requireExactBoolean(record['applyMovePSR'], false, '$.applyMovePSR'),
        spotting: record['spotting'] === undefined
            ? false
            : requireExactBoolean(record['spotting'], true, '$.spotting'),
        equipmentStateChanged: record['equipmentStateChanged'] === undefined
            ? false
            : requireExactBoolean(record['equipmentStateChanged'], true, '$.equipmentStateChanged'),
    });
}

/** Tolerant, field-by-field migration from the old SerializedTurnState object. */
export function parseLegacyMekTurnStateV1(value: unknown): LegacyMekTurnStateParseResultV1 {
    if (value === undefined) return { state: createPristineLegacyMekTurnStateV1(), appliedFacts: 0 };
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        return { state: createPristineLegacyMekTurnStateV1(), appliedFacts: 0, unresolved: value };
    }
    const raw = value as Record<string, unknown>;
    const unresolved: Record<string, unknown> = Object.fromEntries(
        Object.entries(raw).filter(([key]) => !TURN_KEY_SET.has(key)),
    );
    let appliedFacts = 0;
    const state = mutablePristine();

    const booleanField = (
        key: 'airborne' | 'carefulStand' | 'applyMovePSR' | 'spotting' | 'equipmentStateChanged',
        apply: (item: boolean) => void,
    ) => {
        if (!(key in raw)) return;
        if (typeof raw[key] !== 'boolean') unresolved[key] = raw[key];
        else { apply(raw[key] as boolean); appliedFacts += 1; }
    };
    booleanField('airborne', item => { state.airborne = item; });
    booleanField('carefulStand', item => { state.carefulStand = item; });
    booleanField('applyMovePSR', item => { state.applyMovePSR = item; });
    booleanField('spotting', item => { state.spotting = item; });
    booleanField('equipmentStateChanged', item => { state.equipmentStateChanged = item; });

    if ('turnCounter' in raw) {
        const parsed = legacyNonnegativeInteger(raw['turnCounter']);
        if (parsed === null) unresolved['turnCounter'] = raw['turnCounter'];
        else { state.turnCounter = parsed; appliedFacts += 1; }
    }

    if ('cover' in raw) {
        const parsed = deserializeUnitCover(raw['cover']);
        if (parsed === undefined) unresolved['cover'] = raw['cover'];
        else { state.cover = parsed; appliedFacts += 1; }
    }

    if ('moveMode' in raw) {
        if (isMoveMode(raw['moveMode'])) { state.moveMode = raw['moveMode']; appliedFacts += 1; }
        else unresolved['moveMode'] = raw['moveMode'];
    }
    if ('standAttempts' in raw) {
        const parsed = legacyNonnegativeInteger(raw['standAttempts']);
        if (parsed === null) unresolved['standAttempts'] = raw['standAttempts'];
        else { state.standAttempts = parsed; appliedFacts += 1; }
    }
    for (const key of ['moveDistance', 'dmgReceived', 'weaponsHeat', 'heatDissipationConsumed'] as const) {
        if (!(key in raw)) continue;
        const parsed = legacyNonnegativeNumber(raw[key]);
        if (parsed === null) unresolved[key] = raw[key];
        else { state[key] = parsed; appliedFacts += 1; }
    }

    if ('acknowledgedHeatSources' in raw) {
        const parsed = parseLegacyStringRecord(raw['acknowledgedHeatSources'], MAX_MEK_TURN_SIGNATURE_LENGTH);
        if (parsed.valid) {
            state.acknowledgedHeatSources = parsed.value;
            appliedFacts += parsed.value.size;
        }
        if (parsed.unresolved !== undefined) unresolved['acknowledgedHeatSources'] = parsed.unresolved;
    }
    if ('psrOutcomes' in raw) {
        const parsed = parseLegacyOutcomeRecord(raw['psrOutcomes']);
        if (parsed.valid) {
            state.psrOutcomes = parsed.value;
            appliedFacts += parsed.value.size;
        }
        if (parsed.unresolved !== undefined) unresolved['psrOutcomes'] = parsed.unresolved;
    }
    if ('psrChecks' in raw) {
        const parsed = parseLegacyPSRChecks(raw['psrChecks']);
        if (parsed.state !== undefined) {
            state.psrChecks = parsed.state;
            appliedFacts += parsed.appliedFacts;
        }
        if (parsed.unresolved !== undefined) unresolved['psrChecks'] = parsed.unresolved;
    }
    if (state.carefulStand && state.standAttempts === 0) {
        unresolved['carefulStand'] = raw['carefulStand'];
        state.carefulStand = false;
        appliedFacts -= 1;
    }

    return {
        state: canonicalizeLegacyMekTurnStateV1(state),
        appliedFacts,
        ...(Object.keys(unresolved).length === 0 ? {} : { unresolved: Object.freeze(unresolved) }),
    };
}

function deserializePSRChecks(value: unknown, path: string): LegacyMekTurnPsrChecksV1 {
    const record = requireRecord(value, path);
    exactKeys(record, [
        'legActuators', 'hipsHit', 'gyroHit', 'gyroDestroyed', 'legsDestroyed', 'shutdown',
    ], path);
    const legActuators = deserializePositiveEntries(
        record['legActuators'],
        `${path}.legActuators`,
    );
    const hipsHit = deserializeSortedStringSet(record['hipsHit'], `${path}.hipsHit`);
    const gyroHit = record['gyroHit'] === undefined
        ? 0
        : sparsePositiveInteger(record['gyroHit'], `${path}.gyroHit`);
    const gyroDestroyed = record['gyroDestroyed'] === undefined
        ? false
        : requireExactBoolean(record['gyroDestroyed'], true, `${path}.gyroDestroyed`);
    const legsDestroyed = deserializeSortedStringSet(
        record['legsDestroyed'],
        `${path}.legsDestroyed`,
    );
    const shutdown = record['shutdown'] === undefined
        ? false
        : requireExactBoolean(record['shutdown'], true, `${path}.shutdown`);
    if (legActuators.size === 0 && hipsHit.size === 0 && gyroHit === 0 && !gyroDestroyed
        && legsDestroyed.size === 0 && !shutdown) {
        fail('sparse PSR checks must contain a fact', path);
    }
    return Object.freeze({ legActuators, hipsHit, gyroHit, gyroDestroyed, legsDestroyed, shutdown });
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

function pristinePSRChecks(): LegacyMekTurnPsrChecksV1 {
    return PRISTINE_LEGACY_MEK_TURN_STATE?.psrChecks ?? Object.freeze({
        legActuators: new ImmutableIndex<string, number>([]),
        hipsHit: new ImmutableSet<string>([]),
        gyroHit: 0,
        gyroDestroyed: false,
        legsDestroyed: new ImmutableSet<string>([]),
        shutdown: false,
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

function deserializeStringEntries(
    value: unknown,
    path: string,
    keyField: string,
    valueField: string,
    maximumEntries: number,
    maximumValueLength: number,
): ReadonlyMap<string, string> {
    if (value === undefined) return new ImmutableIndex([]);
    const rows = requireArray(value, path, maximumEntries);
    if (rows.length === 0) fail('sparse collection must not be empty', path);
    const entries = rows.map((item, index) => {
        const itemPath = `${path}[${index}]`;
        const record = requireRecord(item, itemPath);
        exactKeys(record, [keyField, valueField], itemPath);
        return [
            canonicalText(record[keyField], `${itemPath}.${keyField}`, MAX_MEK_TURN_TEXT_LENGTH),
            canonicalText(record[valueField], `${itemPath}.${valueField}`, maximumValueLength),
        ] as const;
    });
    requireSortedUnique(entries, path);
    return new ImmutableIndex(entries);
}

function deserializeOutcomeEntries(value: unknown, path: string): ReadonlyMap<string, LegacyMekTurnRuleCheckOutcomeV1> {
    if (value === undefined) return new ImmutableIndex([]);
    const rows = requireArray(value, path, MAX_MEK_TURN_COLLECTION_ENTRIES);
    if (rows.length === 0) fail('sparse collection must not be empty', path);
    const entries = rows.map((item, index) => {
        const itemPath = `${path}[${index}]`;
        const record = requireRecord(item, itemPath);
        exactKeys(record, ['checkId', 'outcome'], itemPath);
        if (!isOutcome(record['outcome'])) fail('must be success or failed', `${itemPath}.outcome`);
        return [
            canonicalText(record['checkId'], `${itemPath}.checkId`, MAX_MEK_TURN_CHECK_ID_LENGTH),
            record['outcome'],
        ] as const;
    });
    requireSortedUnique(entries, path);
    return new ImmutableIndex(entries);
}

function deserializePositiveEntries(value: unknown, path: string): ReadonlyMap<string, number> {
    if (value === undefined) return new ImmutableIndex([]);
    const rows = requireArray(value, path, MAX_MEK_TURN_LOCATION_ENTRIES);
    if (rows.length === 0) fail('sparse collection must not be empty', path);
    const entries = rows.map((item, index) => {
        const itemPath = `${path}[${index}]`;
        const record = requireRecord(item, itemPath);
        exactKeys(record, ['location', 'hits'], itemPath);
        return [
            canonicalText(record['location'], `${itemPath}.location`, MAX_MEK_TURN_TEXT_LENGTH),
            positiveTurnInteger(record['hits'], `${itemPath}.hits`),
        ] as const;
    });
    requireSortedUnique(entries, path);
    return new ImmutableIndex(entries);
}

function deserializeSortedStringSet(value: unknown, path: string): ReadonlySet<string> {
    if (value === undefined) return new ImmutableSet([]);
    const rows = requireArray(value, path, MAX_MEK_TURN_LOCATION_ENTRIES);
    if (rows.length === 0) fail('sparse collection must not be empty', path);
    const result: string[] = [];
    let previous: string | undefined;
    for (const [index, item] of rows.entries()) {
        const current = canonicalText(item, `${path}[${index}]`, MAX_MEK_TURN_TEXT_LENGTH);
        if (previous !== undefined && previous >= current) fail('must be unique and sorted', `${path}[${index}]`);
        previous = current;
        result.push(current);
    }
    return new ImmutableSet(result);
}

function parseLegacyStringRecord(value: unknown, maximumValueLength: number): {
    readonly valid: boolean;
    readonly value: ReadonlyMap<string, string>;
    readonly unresolved?: unknown;
} {
    if (!isObjectLiteralRecord(value)) return { valid: false, value: new Map(), unresolved: value };
    const rows = Object.entries(value);
    if (rows.length > MAX_MEK_TURN_COLLECTION_ENTRIES) {
        return { valid: false, value: new Map(), unresolved: value };
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
        valid: parsed.size > 0 || rows.length === 0,
        value: new ImmutableIndex(sortEntries(parsed)),
        ...(partialInvalid ? { unresolved: value } : {}),
    };
}

function parseLegacyOutcomeRecord(value: unknown): {
    readonly valid: boolean;
    readonly value: ReadonlyMap<string, LegacyMekTurnRuleCheckOutcomeV1>;
    readonly unresolved?: unknown;
} {
    if (!isObjectLiteralRecord(value)) return { valid: false, value: new Map(), unresolved: value };
    const rows = Object.entries(value);
    if (rows.length > MAX_MEK_TURN_COLLECTION_ENTRIES) {
        return { valid: false, value: new Map(), unresolved: value };
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
        valid: parsed.size > 0 || rows.length === 0,
        value: new ImmutableIndex(sortEntries(parsed)),
        ...(partialInvalid ? { unresolved: value } : {}),
    };
}

function parseLegacyPSRChecks(value: unknown): {
    readonly state?: LegacyMekTurnPsrChecksV1;
    readonly appliedFacts: number;
    readonly unresolved?: unknown;
} {
    if (!isObjectLiteralRecord(value)) return { appliedFacts: 0, unresolved: value };
    const raw = value as Record<string, unknown>;
    const unresolved: Record<string, unknown> = Object.fromEntries(Object.entries(raw).filter(([key]) =>
        !['legActuators', 'hipsHit', 'gyroHit', 'gyroDestroyed', 'legsDestroyed', 'shutdown'].includes(key)));
    const state = {
        legActuators: new ImmutableIndex<string, number>([]),
        hipsHit: new ImmutableSet<string>([]),
        gyroHit: 0,
        gyroDestroyed: false,
        legsDestroyed: new ImmutableSet<string>([]),
        shutdown: false,
    };
    let appliedFacts = 0;
    if ('legActuators' in raw) {
        const parsed = parseLegacyPositiveIntegerRecord(raw['legActuators']);
        if (parsed.valid) { state.legActuators = parsed.value; appliedFacts += parsed.value.size; }
        if (parsed.unresolved !== undefined) unresolved['legActuators'] = parsed.unresolved;
    }
    for (const key of ['hipsHit', 'legsDestroyed'] as const) {
        if (!(key in raw)) continue;
        const parsed = parseLegacyStringArray(raw[key]);
        if (parsed.valid) { state[key] = parsed.value; appliedFacts += parsed.value.size; }
        if (parsed.unresolved !== undefined) unresolved[key] = parsed.unresolved;
    }
    if ('gyroHit' in raw) {
        const parsed = legacyNonnegativeInteger(raw['gyroHit']);
        if (parsed === null) unresolved['gyroHit'] = raw['gyroHit'];
        else { state.gyroHit = parsed; appliedFacts += 1; }
    }
    for (const key of ['gyroDestroyed', 'shutdown'] as const) {
        if (!(key in raw)) continue;
        if (typeof raw[key] !== 'boolean') unresolved[key] = raw[key];
        else { state[key] = raw[key] as boolean; appliedFacts += 1; }
    }
    return {
        state: Object.freeze(state),
        appliedFacts,
        ...(Object.keys(unresolved).length === 0 ? {} : { unresolved: Object.freeze(unresolved) }),
    };
}

function parseLegacyPositiveIntegerRecord(value: unknown): {
    readonly valid: boolean;
    readonly value: ImmutableIndex<string, number>;
    readonly unresolved?: unknown;
} {
    if (!isObjectLiteralRecord(value)) return { valid: false, value: new ImmutableIndex([]), unresolved: value };
    const rows = Object.entries(value);
    if (rows.length > MAX_MEK_TURN_LOCATION_ENTRIES) {
        return { valid: false, value: new ImmutableIndex([]), unresolved: value };
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
        valid: parsed.size > 0 || rows.length === 0,
        value: new ImmutableIndex(sortEntries(parsed)),
        ...(partialInvalid ? { unresolved: value } : {}),
    };
}

function parseLegacyStringArray(value: unknown): {
    readonly valid: boolean;
    readonly value: ImmutableSet<string>;
    readonly unresolved?: unknown;
} {
    if (!Array.isArray(value) || value.length > MAX_MEK_TURN_LOCATION_ENTRIES) {
        return { valid: false, value: new ImmutableSet([]), unresolved: value };
    }
    const parsed = new Set<string>();
    let partialInvalid = false;
    for (const raw of value) {
        const item = typeof raw === 'string' ? raw.trim().normalize('NFC') : '';
        if (!validText(item, MAX_MEK_TURN_TEXT_LENGTH)) partialInvalid = true;
        else parsed.add(item);
    }
    return {
        valid: parsed.size > 0 || value.length === 0,
        value: new ImmutableSet(sortValues(parsed)),
        ...(partialInvalid ? { unresolved: value } : {}),
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

function requireSortedUnique<V>(entries: readonly (readonly [string, V])[], path: string): void {
    for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1][0] >= entries[index][0]) fail('must be unique and sorted', `${path}[${index}]`);
    }
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

function sparsePositiveNumber(value: unknown, path: string): number {
    if (value === undefined) return 0;
    const result = turnNumber(value, path);
    if (result === 0) fail('sparse number must be positive', path);
    return result;
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

function sparsePositiveInteger(value: unknown, path: string): number {
    return positiveTurnInteger(value, path);
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

function requireArray(value: unknown, path: string, maximum: number): readonly unknown[] {
    if (!Array.isArray(value)) fail('must be an array', path);
    if (value.length > maximum) fail(`must contain at most ${maximum} entries`, path);
    return value;
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
