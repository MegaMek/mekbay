// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { ImmutableIndex } from '../entity/immutable-collections';
import {
    asCrewPositionId,
    asLocationId,
    type ComponentId,
    type CrewPositionId,
    type LocationId,
} from '../entity/entity-identifiers';
import {
    deserializeUnitCover,
    isUnitCover,
    serializeUnitCover,
    type UnitCover,
} from '../unit-cover.model';
import type { SpottingMode } from '../target-number-calculator.model';
import { isHeatValue,readFiredWeapons,serializeSharedTurnFacts } from './cbt-unit-runtime';
import { HEAT_TURN_STEP } from '../rules/turn-sequence';
import { MAX_OUTSIDE_HEAT_PER_TURN } from '../rules/inferno-rules';
import { isEndTurnCheckpoint, type EndTurnCheckpoint } from './end-turn-checkpoint';
import { MAX_HEAT_VALUE, canonicalTurnHeatLedger, readTurnHeatLedger, type TurnHeatLedger } from './turn-heat-ledger';

export const MAX_MEK_TURN_COLLECTION_ENTRIES = 256;
export const MAX_MEK_TURN_TEXT_LENGTH = 512;
export const MAX_MEK_TURN_EVENT_TEXT_LENGTH = 2_048;
export const MAX_MEK_TURN_NUMBER = 1_000_000;

export type MekPendingFallConsequenceStage = 'head-hits' | 'seatbelts' | 'crew-hits';

/** Durable cursor for the unapplied consequences of an already-damaged fall. */
export interface MekPendingFallConsequencesV2 {
    readonly eventId: string;
    readonly totalDamage: number;
    readonly hitArcLabel: string;
    readonly applyPilotHits: boolean;
    readonly forceSeatbeltFailure: boolean;
    readonly seatbeltPositionIds: readonly CrewPositionId[];
    readonly headHits: number;
    readonly stage: MekPendingFallConsequenceStage;
    readonly seatbeltFailures?: readonly CrewPositionId[];
}

export type MekPendingCriticalChanceResultV2 = 'none' | 'blown-off' | 1 | 2 | 3 | 4;

export interface MekPendingCriticalBreakdownV2 {
    readonly label: string;
    readonly value: number;
}

interface MekPendingCriticalEventBaseV2 {
    readonly eventId: string;
    readonly locationId: LocationId;
    readonly target: 'committed' | 'pending';
    readonly locationDestroyed?: true;
}

/** Exact already-rolled chance retained while its review is closed. */
export interface MekPendingCriticalChanceV2 extends MekPendingCriticalEventBaseV2 {
    readonly type: 'critical-chance';
    readonly roll: readonly [number, number];
    readonly modifier: number;
    readonly total: number;
    readonly result: MekPendingCriticalChanceResultV2;
    readonly breakdown: readonly MekPendingCriticalBreakdownV2[];
    readonly effects: readonly string[];
    /** One entry per resulting hit; true means its Total Warfare CASE II check discarded it. */
    readonly caseIIDiscards: readonly boolean[];
}

/** Exact unresolved slot stage retained while a follow-up review is closed. */
export interface MekPendingCriticalHitV2 extends MekPendingCriticalEventBaseV2 {
    readonly type: 'critical-hit';
    readonly remainingHits: number;
    readonly caseIIDiscards: readonly boolean[];
    readonly roll?: readonly number[];
}

export type MekPendingCriticalEventV2 = MekPendingCriticalChanceV2 | MekPendingCriticalHitV2;

/**
 * Unit-owned facts whose lifetime is one CBT turn. Movement, phase damage, and
 * pilot checks are deliberately absent: `MekMovementPsrStateV2` owns them.
 */
export interface MekTurnStateV2 extends TurnHeatLedger {
    /** Monotonic per-unit counter retained when the transient turn facts reset. */
    readonly turnCounter: number;
    readonly airborne: boolean | null;
    readonly cover: UnitCover | null;
    readonly weaponsHeat: number;
    /** The weapons that fired this turn, each once (`withFiredWeapons`); absent when none. */
    readonly firedWeapons?: readonly ComponentId[];
    readonly amsEngagements?: readonly ComponentId[];
    /** Heat from outside sources such as inferno missiles, capped per turn; absent at 0. */
    readonly outsideHeat?: number;
    readonly spotting: SpottingMode;
    readonly phaseStateChanged: boolean;
    readonly endTurnCheckpoint?: EndTurnCheckpoint;
    readonly turnStep: number;
    /**
     * The real-phase step this unit joined the turn at, when it was added after the turn's Movement: it acts
     * after the Initiative order. Absent otherwise.
     */
    readonly joinedStep?: number;
    readonly pendingFallConsequences?: MekPendingFallConsequencesV2;
    readonly pendingCriticalEvents?: readonly MekPendingCriticalEventV2[];
    /**
     * Core p.117: crew members hit by this combat phase's damage, each owing one consciousness roll
     * at the end of the phase. Absent when nobody owes a roll.
     */
    readonly consciousnessRollsDue?: readonly CrewPositionId[];
}

/** Canonical sparse wire form. Map entries are unique and ascending by key. */
export interface SerializedMekTurnStateV2 {
    readonly turnCounter?: number;
    readonly airborne?: boolean;
    readonly cover?: ReturnType<typeof serializeUnitCover>;
    readonly weaponsHeat?: number;
    readonly firedWeapons?: readonly ComponentId[];
    readonly amsEngagements?: readonly ComponentId[];
    readonly outsideHeat?: number;
    readonly settledHeat?: readonly {
        readonly sourceId: string;
        readonly heat: number;
    }[];
    readonly heatDissipationConsumed?: number;
    readonly spotting?: true | 'tag';
    readonly phaseStateChanged?: true;
    readonly endTurnCheckpoint?: EndTurnCheckpoint;
    readonly turnStep?: number;
    readonly joinedStep?: number;
    readonly pendingFallConsequences?: MekPendingFallConsequencesV2;
    readonly pendingCriticalEvents?: readonly MekPendingCriticalEventV2[];
    readonly consciousnessRollsDue?: readonly CrewPositionId[];
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
    'firedWeapons', 'amsEngagements',
    'outsideHeat',
    'settledHeat',
    'heatDissipationConsumed',
    'spotting',
    'phaseStateChanged',
    'endTurnCheckpoint',
    'turnStep',
    'joinedStep',
    'pendingFallConsequences',
    'pendingCriticalEvents',
    'consciousnessRollsDue',
] as const);

const REQUIRED_TURN_KEYS = TURN_KEYS.filter(key =>
    key !== 'endTurnCheckpoint'
    && key !== 'firedWeapons' && key !== 'amsEngagements'
    && key !== 'outsideHeat'
    && key !== 'heatDissipationConsumed'
    && key !== 'joinedStep'
    && key !== 'pendingFallConsequences'
    && key !== 'pendingCriticalEvents'
    && key !== 'consciousnessRollsDue');

const PRISTINE_MEK_TURN_STATE = freezeMekTurnState({
    turnCounter: 0,
    airborne: null,
    cover: null,
    weaponsHeat: 0,
    settledHeat: new Map(),
    spotting: false,
    phaseStateChanged: false,
    turnStep: 0,
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
    requireKeys(record, REQUIRED_TURN_KEYS, '$');
    return freezeMekTurnState({
        ...(record['amsEngagements'] ? { amsEngagements: readFiredWeapons(record['amsEngagements'], '$.amsEngagements', fail, 2) } : {}),
        turnCounter: turnNumber(record['turnCounter'], '$.turnCounter'),
        airborne: nullableBoolean(record['airborne'], '$.airborne'),
        cover: nullableUnitCover(record['cover'], '$.cover'),
        weaponsHeat: heatPoints(record['weaponsHeat'], '$.weaponsHeat'),
        ...(record['firedWeapons'] === undefined
            ? {}
            : { firedWeapons: readFiredWeapons(record['firedWeapons'], '$.firedWeapons', fail) }),
        ...(record['outsideHeat'] === undefined || record['outsideHeat'] === 0
            ? {}
            : { outsideHeat: outsideHeat(record['outsideHeat'], '$.outsideHeat') }),
        ...canonicalTurnHeatLedger(
            iterableEntries(record['settledHeat'], '$.settledHeat'),
            record['heatDissipationConsumed'],
            '$',
            fail,
        ),
        spotting: record['spotting'] === 'tag' ? 'tag' : requiredBoolean(record['spotting'], '$.spotting'),
        phaseStateChanged: requiredBoolean(
            record['phaseStateChanged'],
            '$.phaseStateChanged',
        ),
        ...(record['endTurnCheckpoint'] === undefined
            ? {}
            : { endTurnCheckpoint: checkpoint(record['endTurnCheckpoint'], '$.endTurnCheckpoint') }),
        turnStep: turnStepNumber(record['turnStep'], '$.turnStep'),
        ...(record['joinedStep'] === undefined ? {} : { joinedStep: joinedStepNumber(record['joinedStep'], '$.joinedStep') }),
        ...(record['pendingFallConsequences'] === undefined
            ? {}
            : {
                pendingFallConsequences: canonicalPendingFallConsequences(
                    record['pendingFallConsequences'],
                    '$.pendingFallConsequences',
                ),
            }),
        ...(record['pendingCriticalEvents'] === undefined
            ? {}
            : {
                pendingCriticalEvents: canonicalPendingCriticalEvents(
                    record['pendingCriticalEvents'],
                    '$.pendingCriticalEvents',
                ),
            }),
        ...(record['consciousnessRollsDue'] === undefined
            ? {}
            : { consciousnessRollsDue: dueCrewPositionIds(record['consciousnessRollsDue'], '$.consciousnessRollsDue') }),
    });
}

export function serializeMekTurnStateV2(value: MekTurnStateV2): SerializedMekTurnStateV2 {
    const turn = canonicalizeMekTurnStateV2(value);
    return Object.freeze({
        ...serializeSharedTurnFacts(turn),
        ...(turn.pendingFallConsequences === undefined
            ? {}
            : { pendingFallConsequences: turn.pendingFallConsequences }),
        ...(turn.pendingCriticalEvents === undefined
            ? {}
            : { pendingCriticalEvents: turn.pendingCriticalEvents }),
        ...(turn.consciousnessRollsDue === undefined
            ? {}
            : { consciousnessRollsDue: turn.consciousnessRollsDue }),
    });
}

/** Strict wire decoder. */
export function deserializeMekTurnStateV2(value: unknown): MekTurnStateV2 {
    const record = requireRecord(value, '$');
    exactKeys(record, [...TURN_KEYS], '$');
    return freezeMekTurnState({
        turnCounter: sparsePositiveNumber(record['turnCounter'], '$.turnCounter'),
        airborne: record['airborne'] === undefined
            ? null
            : requiredBoolean(record['airborne'], '$.airborne'),
        cover: deserializeSparseCover(record['cover'], '$.cover'),
        weaponsHeat: record['weaponsHeat'] === undefined ? 0 : positiveHeatPoints(record['weaponsHeat'], '$.weaponsHeat'),
        ...(record['firedWeapons'] === undefined
            ? {}
            : { firedWeapons: readFiredWeapons(record['firedWeapons'], '$.firedWeapons', fail) }),
        ...(record['amsEngagements'] ? { amsEngagements: readFiredWeapons(record['amsEngagements'], '$.amsEngagements', fail, 2) } : {}),
        ...(record['outsideHeat'] === undefined
            ? {}
            : { outsideHeat: positiveOutsideHeat(record['outsideHeat'], '$.outsideHeat') }),
        ...readTurnHeatLedger(record['settledHeat'], record['heatDissipationConsumed'], '$', fail),
        spotting: record['spotting'] === 'tag' ? 'tag' : record['spotting'] !== undefined
            && requireExactBoolean(record['spotting'], true, '$.spotting'),
        phaseStateChanged: record['phaseStateChanged'] === undefined
            ? false
            : requireExactBoolean(record['phaseStateChanged'], true, '$.phaseStateChanged'),
        ...(record['endTurnCheckpoint'] === undefined
            ? {}
            : { endTurnCheckpoint: checkpoint(record['endTurnCheckpoint'], '$.endTurnCheckpoint') }),
        turnStep: sparseTurnStep(record['turnStep'], '$.turnStep'),
        ...(record['joinedStep'] === undefined ? {} : { joinedStep: joinedStepNumber(record['joinedStep'], '$.joinedStep') }),
        ...(record['pendingFallConsequences'] === undefined
            ? {}
            : {
                pendingFallConsequences: canonicalPendingFallConsequences(
                    record['pendingFallConsequences'],
                    '$.pendingFallConsequences',
                ),
            }),
        ...(record['pendingCriticalEvents'] === undefined
            ? {}
            : {
                pendingCriticalEvents: canonicalPendingCriticalEvents(
                    record['pendingCriticalEvents'],
                    '$.pendingCriticalEvents',
                ),
            }),
        ...(record['consciousnessRollsDue'] === undefined
            ? {}
            : { consciousnessRollsDue: dueCrewPositionIds(record['consciousnessRollsDue'], '$.consciousnessRollsDue') }),
    });
}

export function mekTurnStatesEqualV2(left: MekTurnStateV2, right: MekTurnStateV2): boolean {
    return JSON.stringify(serializeMekTurnStateV2(left)) === JSON.stringify(serializeMekTurnStateV2(right));
}

function freezeMekTurnState(value: MekTurnStateV2): MekTurnStateV2 {
    return Object.freeze({
        ...value,
        settledHeat: new ImmutableIndex(sortEntries(value.settledHeat)),
        ...(value.pendingFallConsequences === undefined
            ? {}
            : {
                pendingFallConsequences: Object.freeze({
                    ...value.pendingFallConsequences,
                    seatbeltPositionIds: Object.freeze([
                        ...value.pendingFallConsequences.seatbeltPositionIds,
                    ]),
                    ...(value.pendingFallConsequences.seatbeltFailures === undefined
                        ? {}
                        : {
                            seatbeltFailures: Object.freeze([
                                ...value.pendingFallConsequences.seatbeltFailures,
                            ]),
                        }),
                }),
            }),
        ...(value.pendingCriticalEvents === undefined
            ? {}
            : {
                pendingCriticalEvents: Object.freeze(value.pendingCriticalEvents.map(event =>
                    freezePendingCriticalEvent(event))),
            }),
    });
}

function canonicalPendingFallConsequences(
    value: unknown,
    path: string,
): MekPendingFallConsequencesV2 {
    const record = requireRecord(value, path);
    exactKeys(record, [
        'eventId', 'totalDamage', 'hitArcLabel', 'applyPilotHits',
        'forceSeatbeltFailure', 'seatbeltPositionIds', 'headHits', 'stage',
        'seatbeltFailures',
    ], path);
    requireKeys(record, [
        'eventId', 'totalDamage', 'hitArcLabel', 'applyPilotHits',
        'forceSeatbeltFailure', 'seatbeltPositionIds', 'headHits', 'stage',
    ], path);
    const stage = record['stage'];
    if (stage !== 'head-hits' && stage !== 'seatbelts' && stage !== 'crew-hits') {
        fail('must be a valid fall-consequence stage', `${path}.stage`);
    }
    const positions = canonicalCrewPositionIds(record['seatbeltPositionIds'], `${path}.seatbeltPositionIds`);
    const failures = record['seatbeltFailures'] === undefined
        ? undefined
        : canonicalCrewPositionIds(record['seatbeltFailures'], `${path}.seatbeltFailures`);
    if (stage !== 'crew-hits' && failures !== undefined) {
        fail('is only valid at the crew-hits stage', `${path}.seatbeltFailures`);
    }
    return Object.freeze({
        eventId: canonicalText(record['eventId'], `${path}.eventId`, MAX_MEK_TURN_EVENT_TEXT_LENGTH),
        totalDamage: turnNumber(record['totalDamage'], `${path}.totalDamage`),
        hitArcLabel: canonicalText(record['hitArcLabel'], `${path}.hitArcLabel`, MAX_MEK_TURN_TEXT_LENGTH),
        applyPilotHits: requiredBoolean(record['applyPilotHits'], `${path}.applyPilotHits`),
        forceSeatbeltFailure: requiredBoolean(
            record['forceSeatbeltFailure'],
            `${path}.forceSeatbeltFailure`,
        ),
        seatbeltPositionIds: positions,
        headHits: turnNumber(record['headHits'], `${path}.headHits`),
        stage,
        ...(failures === undefined ? {} : { seatbeltFailures: failures }),
    });
}

function canonicalPendingCriticalEvents(
    value: unknown,
    path: string,
): readonly MekPendingCriticalEventV2[] {
    const rows = requireArray(value, path);
    if (rows.length === 0) fail('sparse collection must not be empty', path);
    const seen = new Set<string>();
    return Object.freeze(rows.map((row, index) => {
        const event = canonicalPendingCriticalEvent(row, `${path}[${index}]`);
        if (seen.has(event.eventId)) fail('must contain unique event ids', `${path}[${index}].eventId`);
        seen.add(event.eventId);
        return event;
    }));
}

function canonicalPendingCriticalEvent(
    value: unknown,
    path: string,
): MekPendingCriticalEventV2 {
    const record = requireRecord(value, path);
    const type = record['type'];
    if (type !== 'critical-chance' && type !== 'critical-hit') {
        fail('must be a pending critical event', `${path}.type`);
    }
    const baseKeys = ['type', 'eventId', 'locationId', 'target', 'locationDestroyed'] as const;
    const rawTarget = record['target'];
    if (rawTarget !== 'committed' && rawTarget !== 'pending') {
        fail('must be committed or pending', `${path}.target`);
    }
    const target: 'committed' | 'pending' = rawTarget;
    if (record['locationDestroyed'] !== undefined && record['locationDestroyed'] !== true) {
        fail('canonical sparse value must be true', `${path}.locationDestroyed`);
    }
    const base = {
        eventId: canonicalText(record['eventId'], `${path}.eventId`, MAX_MEK_TURN_EVENT_TEXT_LENGTH),
        locationId: asLocationId(canonicalText(
            record['locationId'],
            `${path}.locationId`,
            MAX_MEK_TURN_TEXT_LENGTH,
        )),
        target,
        ...(record['locationDestroyed'] === true ? { locationDestroyed: true as const } : {}),
    };
    if (type === 'critical-hit') {
        exactKeys(record, [...baseKeys, 'remainingHits', 'caseIIDiscards', 'roll'], path);
        requireKeys(record, [...baseKeys.filter(key => key !== 'locationDestroyed'),
            'remainingHits', 'caseIIDiscards'], path);
        const remainingHits = canonicalInteger(record['remainingHits'], `${path}.remainingHits`, 1, 4);
        const caseIIDiscards = canonicalBooleanArray(record['caseIIDiscards'], `${path}.caseIIDiscards`);
        if (caseIIDiscards.length !== remainingHits) {
            fail('must contain one CASE II result per remaining hit', `${path}.caseIIDiscards`);
        }
        return Object.freeze({
            type,
            ...base,
            remainingHits,
            caseIIDiscards,
            ...(record['roll'] === undefined
                ? {}
                : { roll: canonicalDice(record['roll'], `${path}.roll`, 1, 2) }),
        });
    }
    exactKeys(record, [
        ...baseKeys, 'roll', 'modifier', 'total', 'result', 'breakdown', 'effects',
        'caseIIDiscards',
    ], path);
    requireKeys(record, [
        ...baseKeys.filter(key => key !== 'locationDestroyed'),
        'roll', 'modifier', 'total', 'result', 'breakdown', 'effects', 'caseIIDiscards',
    ], path);
    const result = canonicalCriticalChanceResult(record['result'], `${path}.result`);
    const caseIIDiscards = canonicalBooleanArray(record['caseIIDiscards'], `${path}.caseIIDiscards`);
    const expectedHits = typeof result === 'number' ? result : 0;
    if (caseIIDiscards.length !== expectedHits) {
        fail('must contain one CASE II result per critical hit', `${path}.caseIIDiscards`);
    }
    const breakdown = requireArray(record['breakdown'], `${path}.breakdown`).map((row, index) => {
        const itemPath = `${path}.breakdown[${index}]`;
        const item = requireRecord(row, itemPath);
        exactKeys(item, ['label', 'value'], itemPath);
        requireKeys(item, ['label', 'value'], itemPath);
        return Object.freeze({
            label: canonicalText(item['label'], `${itemPath}.label`, MAX_MEK_TURN_TEXT_LENGTH),
            value: canonicalInteger(item['value'], `${itemPath}.value`, -100, 100),
        });
    });
    const effects = requireArray(record['effects'], `${path}.effects`).map((row, index) =>
        canonicalText(row, `${path}.effects[${index}]`, MAX_MEK_TURN_EVENT_TEXT_LENGTH));
    return Object.freeze({
        type,
        ...base,
        roll: canonicalDice(record['roll'], `${path}.roll`, 2, 2) as readonly [number, number],
        modifier: canonicalInteger(record['modifier'], `${path}.modifier`, -100, 100),
        total: canonicalInteger(record['total'], `${path}.total`, -100, 100),
        result,
        breakdown: Object.freeze(breakdown),
        effects: Object.freeze(effects),
        caseIIDiscards,
    });
}

function freezePendingCriticalEvent(event: MekPendingCriticalEventV2): MekPendingCriticalEventV2 {
    return event.type === 'critical-chance'
        ? Object.freeze({
            ...event,
            roll: Object.freeze([event.roll[0], event.roll[1]] as const),
            breakdown: Object.freeze(event.breakdown.map(row => Object.freeze({ ...row }))),
            effects: Object.freeze([...event.effects]),
            caseIIDiscards: Object.freeze([...event.caseIIDiscards]),
        })
        : Object.freeze({
            ...event,
            caseIIDiscards: Object.freeze([...event.caseIIDiscards]),
            ...(event.roll === undefined ? {} : { roll: Object.freeze([...event.roll]) }),
        });
}

function canonicalCriticalChanceResult(
    value: unknown,
    path: string,
): MekPendingCriticalChanceResultV2 {
    if (value === 'none' || value === 'blown-off'
        || value === 1 || value === 2 || value === 3 || value === 4) return value;
    fail('must be a critical chance result', path);
}

function canonicalBooleanArray(value: unknown, path: string): readonly boolean[] {
    return Object.freeze(requireArray(value, path).map((row, index) =>
        requiredBoolean(row, `${path}[${index}]`)));
}

function canonicalDice(
    value: unknown,
    path: string,
    minimumLength: number,
    maximumLength: number,
): readonly number[] {
    const dice = requireArray(value, path);
    if (dice.length < minimumLength || dice.length > maximumLength) {
        fail(`must contain ${minimumLength === maximumLength ? minimumLength : `${minimumLength}-${maximumLength}`} dice`, path);
    }
    return Object.freeze(dice.map((die, index) =>
        canonicalInteger(die, `${path}[${index}]`, 1, 6)));
}

function canonicalInteger(value: unknown, path: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        fail(`must be an integer from ${minimum} to ${maximum}`, path);
    }
    return value as number;
}

/** A present list is never empty: nobody owing a roll is the absent field. */
function dueCrewPositionIds(value: unknown, path: string): readonly CrewPositionId[] {
    const ids = canonicalCrewPositionIds(value, path);
    if (ids.length === 0) fail('must name at least one crew position', path);
    return ids;
}

function canonicalCrewPositionIds(value: unknown, path: string): readonly CrewPositionId[] {
    const ids = requireArray(value, path).map((item, index) =>
        asCrewPositionId(canonicalText(item, `${path}[${index}]`, MAX_MEK_TURN_TEXT_LENGTH)));
    const unique = [...new Set(ids)].sort(compareText);
    if (unique.length !== ids.length || unique.some((id, index) => id !== ids[index])) {
        fail('must contain unique sorted crew positions', path);
    }
    return Object.freeze(unique);
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

function checkpoint(value: unknown, path: string): EndTurnCheckpoint {
    if (!isEndTurnCheckpoint(value)) fail('must be a valid End Turn checkpoint', path);
    return value;
}

function requireExactBoolean<T extends boolean>(value: unknown, expected: T, path: string): T {
    if (value !== expected) fail(`canonical sparse value must be ${expected}`, path);
    return expected;
}

/** Outside heat is capped at 15 a turn (TW p. 159; Core p. 102). */
function outsideHeat(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_OUTSIDE_HEAT_PER_TURN) {
        fail(`must be a whole number from 0 to ${MAX_OUTSIDE_HEAT_PER_TURN}`, path);
    }
    return value as number;
}

function positiveOutsideHeat(value: unknown, path: string): number {
    const heat = outsideHeat(value, path);
    if (heat === 0) fail('sparse number must be positive', path);
    return heat;
}

function heatPoints(value: unknown, path: string): number {
    if (!isHeatValue(value)) fail(`must be a whole number from 0 to ${MAX_HEAT_VALUE}`, path);
    return value;
}

function positiveHeatPoints(value: unknown, path: string): number {
    const heat = heatPoints(value, path);
    if (heat === 0) fail('sparse number must be positive', path);
    return heat;
}

function turnNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
        || value < 0 || value > MAX_MEK_TURN_NUMBER) {
        fail(`must be a canonical number from 0 to ${MAX_MEK_TURN_NUMBER}`, path);
    }
    return value;
}

/** Completed real-phase steps: only steps up to Heat are marked; Heat itself ends the turn. */
function turnStepNumber(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > HEAT_TURN_STEP) {
        fail(`must be an integer from 0 to ${HEAT_TURN_STEP}`, path);
    }
    return value as number;
}

/** A late join happens after Movement: a positive stored step. */
function joinedStepNumber(value: unknown, path: string): number {
    const step = turnStepNumber(value, path);
    if (step === 0) fail('must be a step after Movement', path);
    return step;
}

function sparseTurnStep(value: unknown, path: string): number {
    if (value === undefined) return 0;
    const step = turnStepNumber(value, path);
    if (step === 0) fail('sparse number must be positive', path);
    return step;
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

function fail(message: string, path: string): never {
    throw new MekTurnStateValidationError(message, path);
}
