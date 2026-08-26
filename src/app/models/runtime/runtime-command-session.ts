// SPDX-License-Identifier: GPL-3.0-or-later

import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import type { UnitInstanceId } from './runtime-state';
import type {
    RuntimeHistoryEvent,
    RuntimeHistoryEventInput,
    SerializedRuntimeHistory,
    SerializedRuntimeHistoryMessage,
    SerializedRuntimeHistoryTurn,
} from './runtime-history';
import {
    appendSerializedRuntimeHistoryTurn,
    expandSerializedRuntimeHistoryMessage,
    RUNTIME_HISTORY_MESSAGE,
    runtimeHistoryMessageUnitId,
} from './runtime-history';

/** Session-only restoration data. It is never part of force persistence. */
export interface RuntimeCommandCheckpoint {
    readonly units: readonly Readonly<{
        readonly instanceId: UnitInstanceId;
        readonly unit: SerializedCBTUnitV2 | SerializedNonMekUnit;
    }>[];
}

export interface RuntimeCommandEntry {
    readonly turn: number;
    readonly phase: number;
    readonly events: readonly RuntimeHistoryEvent[];
    readonly before: RuntimeCommandCheckpoint;
    readonly after: RuntimeCommandCheckpoint;
}

export interface RuntimeCommandSession {
    readonly turn: number;
    readonly phase: number;
    readonly cursor: number;
    readonly entries: readonly RuntimeCommandEntry[];
}

export interface RuntimeCommandEntryInput {
    readonly history?: RuntimeHistoryEventInput | readonly RuntimeHistoryEventInput[];
    readonly boundary?: 'phase';
    readonly before: RuntimeCommandCheckpoint;
    readonly after: RuntimeCommandCheckpoint;
}

export interface RuntimeCommandMove {
    readonly entry: RuntimeCommandEntry;
    readonly checkpoint: RuntimeCommandCheckpoint;
    readonly session: RuntimeCommandSession;
}

export function createRuntimeCommandSession(turn = 1): RuntimeCommandSession {
    return Object.freeze({ turn, phase: 1, cursor: 0, entries: Object.freeze([]) });
}

/**
 * Adds one reversible command. Completing a phase folds that phase into one
 * undo step while retaining each small semantic event for the log panel.
 */
export function appendRuntimeCommandEntry(
    session: RuntimeCommandSession,
    input: RuntimeCommandEntryInput,
): RuntimeCommandSession {
    const applied = session.entries.slice(0, session.cursor);
    const history = input.history === undefined
        ? []
        : Array.isArray(input.history) ? input.history : [input.history];
    const events = history.map(item => Object.freeze({
        turn: item.turn ?? session.turn,
        phase: item.phase ?? session.phase,
        message: Object.freeze([
            item.messageId,
            ...(item.data ?? []),
        ]) as SerializedRuntimeHistoryMessage,
    } satisfies RuntimeHistoryEvent));
    const entry = Object.freeze({
        turn: events[0]?.turn ?? session.turn,
        phase: events[0]?.phase ?? session.phase,
        events: Object.freeze(events),
        before: input.before,
        after: input.after,
    } satisfies RuntimeCommandEntry);

    if (input.boundary !== 'phase') {
        const entries = Object.freeze([...applied, entry]);
        return Object.freeze({ ...session, cursor: entries.length, entries });
    }

    const scope = runtimeCommandScope(entry);
    let phaseStart = applied.length;
    while (phaseStart > 0) {
        const candidate = applied[phaseStart - 1]!;
        if (candidate.turn !== entry.turn
            || candidate.phase !== entry.phase
            || runtimeCommandScope(candidate) !== scope) break;
        phaseStart -= 1;
    }
    const phaseEntries = [...applied.slice(phaseStart), entry];
    const settledEvents = settleCommittedPendingEvents(
        phaseEntries.flatMap(candidate => candidate.events),
    );
    const collapsed = Object.freeze({
        turn: entry.turn,
        phase: entry.phase,
        events: settledEvents,
        before: mergeCheckpoints(phaseEntries, 'before'),
        after: mergeCheckpoints(phaseEntries, 'after'),
    } satisfies RuntimeCommandEntry);
    const entries = Object.freeze([...applied.slice(0, phaseStart), collapsed]);
    return Object.freeze({
        turn: session.turn,
        phase: Math.max(session.phase, entry.phase + 1),
        cursor: entries.length,
        entries,
    });
}

export function prepareRuntimeCommandUndo(session: RuntimeCommandSession): RuntimeCommandMove | null {
    const entry = session.entries[session.cursor - 1];
    if (!entry) return null;
    return Object.freeze({
        entry,
        checkpoint: entry.before,
        session: Object.freeze({ ...session, cursor: session.cursor - 1 }),
    });
}

export function prepareRuntimeCommandRedo(session: RuntimeCommandSession): RuntimeCommandMove | null {
    const entry = session.entries[session.cursor];
    if (!entry) return null;
    return Object.freeze({
        entry,
        checkpoint: entry.after,
        session: Object.freeze({ ...session, cursor: session.cursor + 1 }),
    });
}

export function appliedRuntimeHistoryEvents(
    session: RuntimeCommandSession,
): readonly RuntimeHistoryEvent[] {
    return Object.freeze(session.entries.slice(0, session.cursor).flatMap(entry => entry.events));
}

export function runtimeHistoryRows(
    durable: SerializedRuntimeHistory,
    session: RuntimeCommandSession,
    includePhaseBoundaries = false,
): readonly Readonly<{ readonly event: RuntimeHistoryEvent; readonly applied: boolean }>[] {
    const rows: Readonly<{ readonly event: RuntimeHistoryEvent; readonly applied: boolean }>[] = [];
    durable.t.forEach(turn => turn.p.forEach((phase, phaseIndex) => phase.forEach(message => rows.push(Object.freeze({
        event: Object.freeze({
            turn: turn.n,
            phase: phaseIndex + 1,
            message: expandSerializedRuntimeHistoryMessage(durable, message),
        }),
        applied: true,
    })))));
    session.entries.forEach((entry, index) => {
        entry.events.forEach(event => rows.push(Object.freeze({ event, applied: index < session.cursor })));
    });
    const coalesced = settleCommittedPendingRows(coalesceRuntimeHistoryRows(rows));
    const retainedTurns = new Set([...new Set(coalesced.map(row => row.event.turn))]
        .sort((left, right) => left - right)
        .slice(-2));
    return Object.freeze(coalesced.filter(row => retainedTurns.has(row.event.turn)
        && (includePhaseBoundaries
            || row.event.message[0] !== RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED)));
}

/** Saves applied semantic events only, retaining the current and previous numbered turns. */
export function serializeRuntimeHistory(
    durable: SerializedRuntimeHistory,
    session: RuntimeCommandSession,
): SerializedRuntimeHistory {
    const events: RuntimeHistoryEvent[] = [];
    durable.t.forEach(turn => turn.p.forEach((phase, phaseIndex) => phase.forEach(message => {
        events.push(Object.freeze({
            turn: turn.n,
            phase: phaseIndex + 1,
            message: expandSerializedRuntimeHistoryMessage(durable, message),
        }));
    })));
    events.push(...appliedRuntimeHistoryEvents(session));
    const effectiveEvents = settleCommittedPendingRows(coalesceRuntimeHistoryRows(events.map(event => Object.freeze({
        event,
        applied: true,
    })))).map(row => row.event);

    const retainedTurns = [...new Set(effectiveEvents.map(event => event.turn))]
        .sort((left, right) => left - right)
        .slice(-2);
    const retained = new Set(retainedTurns);
    const grouped = new Map<number, Map<number, SerializedRuntimeHistoryMessage[]>>();
    for (const event of effectiveEvents) {
        if (!retained.has(event.turn)) continue;
        let phases = grouped.get(event.turn);
        if (!phases) {
            phases = new Map();
            grouped.set(event.turn, phases);
        }
        const messages = phases.get(event.phase) ?? [];
        messages.push(event.message);
        phases.set(event.phase, messages);
    }

    let serialized: SerializedRuntimeHistory = Object.freeze({
        u: Object.freeze([]),
        t: Object.freeze([]),
    });
    for (const turn of retainedTurns) {
        const phases = grouped.get(turn);
        if (!phases) continue;
        serialized = appendSerializedRuntimeHistoryTurn(serialized, Object.freeze({
            n: turn,
            p: Object.freeze([...phases]
                .sort(([left], [right]) => left - right)
                .map(([, messages]) => Object.freeze(messages))),
        }));
    }
    return serialized;
}

type RuntimeHistoryRow = Readonly<{
    readonly event: RuntimeHistoryEvent;
    readonly applied: boolean;
}>;

/** Fold reversible state edits inside one unit/turn/phase to their net effect. */
function coalesceRuntimeHistoryRows(rows: readonly RuntimeHistoryRow[]): readonly RuntimeHistoryRow[] {
    const result: (RuntimeHistoryRow | null)[] = [];
    const indexes = new Map<string, number>();
    for (const row of rows) {
        const transition = runtimeHistoryTransitionKey(row.event.message);
        if (transition === null) {
            result.push(row);
            continue;
        }
        const key = JSON.stringify([
            row.event.turn,
            row.event.phase,
            row.applied,
            transition,
        ]);
        const index = indexes.get(key);
        if (index === undefined) {
            indexes.set(key, result.length);
            result.push(row);
            continue;
        }
        const first = result[index]!;
        const message = mergeRuntimeHistoryTransition(first.event.message, row.event.message);
        if (message === null) {
            result[index] = null;
            indexes.delete(key);
            continue;
        }
        result[index] = Object.freeze({
            event: Object.freeze({ ...first.event, message }),
            applied: row.applied,
        });
    }
    return Object.freeze(result.filter((row): row is RuntimeHistoryRow => row !== null));
}

function runtimeHistoryTransitionKey(message: SerializedRuntimeHistoryMessage): readonly unknown[] | null {
    switch (message[0]) {
        case RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED: return [message[0], message[1], message[2]];
        case RUNTIME_HISTORY_MESSAGE.CREW_CHANGED: return [message[0], message[1], message[2]];
        case RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED: return [message[0], message[1], message[2]];
        case RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED: return [message[0], message[1], message[2], message[3]];
        case RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED: return [message[0], message[1], message[2], message[3], message[6]];
        case RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED: return [message[0], message[1]];
        case RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED: return [message[0], message[1]];
        case RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED: return [message[0], message[1]];
        case RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED: return [message[0], message[1], message[2]];
        case RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED: return [message[0], message[1]];
        case RUNTIME_HISTORY_MESSAGE.COVER_CHANGED: return [message[0], message[1]];
        default: return null;
    }
}

function mergeRuntimeHistoryTransition(
    first: SerializedRuntimeHistoryMessage,
    last: SerializedRuntimeHistoryMessage,
): SerializedRuntimeHistoryMessage | null {
    let merged: SerializedRuntimeHistoryMessage;
    switch (first[0]) {
        case RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED:
            merged = Object.freeze([first[0], first[1], first[2], first[3], last[4]]);
            return merged[3] === merged[4] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.CREW_CHANGED:
            merged = Object.freeze([
                first[0], first[1], first[2], first[3], last[4], first[5], last[6],
            ]);
            return merged[3] === merged[4] && merged[5] === merged[6] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED:
            merged = Object.freeze([first[0], first[1], first[2], first[3], last[4]]);
            return merged[3] === merged[4] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED:
            merged = Object.freeze([
                first[0], first[1], first[2], first[3], first[4], last[5],
            ]);
            return merged[4] === merged[5] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED:
            merged = Object.freeze([
                first[0], first[1], first[2], first[3], first[4], last[5], first[6],
            ]);
            return merged[4] === merged[5] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED:
            merged = Object.freeze([first[0], first[1], first[2], last[3]]);
            return merged[2] === merged[3] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED:
            merged = Object.freeze([
                first[0], first[1], first[2], first[3], last[4], last[5],
            ]);
            return merged[2] === merged[4] && merged[3] === merged[5] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED:
            merged = Object.freeze([first[0], first[1], first[2], last[3]]);
            return merged[2] === merged[3] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED:
            merged = Object.freeze([first[0], first[1], first[2], first[3], last[4]]);
            return merged[3] === merged[4] ? null : merged;
        case RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED:
        case RUNTIME_HISTORY_MESSAGE.COVER_CHANGED:
            merged = Object.freeze([first[0], first[1], first[2], last[3]]);
            return merged[2] === merged[3] ? null : merged;
        default:
            return first;
    }
}

export function pruneRuntimeCommandSession(
    session: RuntimeCommandSession,
    removed: ReadonlySet<UnitInstanceId>,
): RuntimeCommandSession {
    const entries: RuntimeCommandEntry[] = [];
    let cursor = 0;
    session.entries.forEach((entry, index) => {
        if ([...entry.before.units, ...entry.after.units].some(row => removed.has(row.instanceId))) return;
        entries.push(entry);
        if (index < session.cursor) cursor += 1;
    });
    return Object.freeze({ ...session, cursor, entries: Object.freeze(entries) });
}

function mergeCheckpoints(
    entries: readonly RuntimeCommandEntry[],
    side: 'before' | 'after',
): RuntimeCommandCheckpoint {
    const units = new Map<UnitInstanceId, RuntimeCommandCheckpoint['units'][number]>();
    const rows = side === 'before' ? entries : [...entries].reverse();
    for (const entry of rows) {
        const checkpoint = entry[side];
        for (const unit of checkpoint.units) {
            if (!units.has(unit.instanceId)) units.set(unit.instanceId, unit);
        }
    }
    return Object.freeze({
        units: Object.freeze([...units.values()].sort((left, right) =>
            left.instanceId < right.instanceId ? -1 : left.instanceId > right.instanceId ? 1 : 0)),
    });
}

function runtimeCommandScope(entry: RuntimeCommandEntry): string {
    const instanceIds = [...new Set([
        ...entry.before.units.map(unit => unit.instanceId),
        ...entry.after.units.map(unit => unit.instanceId),
    ])].sort();
    return JSON.stringify([
        instanceIds,
    ]);
}

function settleCommittedPendingEvents(
    events: readonly RuntimeHistoryEvent[],
): readonly RuntimeHistoryEvent[] {
    const committedUnits = new Set(events.flatMap(event =>
        event.message[0] === RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED
            ? [runtimeHistoryMessageUnitId(event.message)]
            : []).filter((instanceId): instanceId is string => instanceId !== null));
    if (committedUnits.size === 0) return Object.freeze(events);
    return Object.freeze(events.map(event => {
        const unitId = runtimeHistoryMessageUnitId(event.message);
        if (unitId === null || !committedUnits.has(unitId)) return event;
        const message = settlePendingHistoryMessage(event.message);
        return message === event.message ? event : Object.freeze({ ...event, message });
    }));
}

/** Settles pending rows even when the edit was restored from durable history before commit. */
function settleCommittedPendingRows(rows: readonly RuntimeHistoryRow[]): readonly RuntimeHistoryRow[] {
    const committed = new Set(rows.flatMap(row => {
        if (!row.applied || row.event.message[0] !== RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED) return [];
        const unitId = runtimeHistoryMessageUnitId(row.event.message);
        return unitId === null ? [] : [`${row.event.turn}:${row.event.phase}:${unitId}`];
    }));
    if (committed.size === 0) return rows;
    return Object.freeze(rows.map(row => {
        if (!row.applied) return row;
        const unitId = runtimeHistoryMessageUnitId(row.event.message);
        if (unitId === null || !committed.has(`${row.event.turn}:${row.event.phase}:${unitId}`)) return row;
        const message = settlePendingHistoryMessage(row.event.message);
        return message === row.event.message
            ? row
            : Object.freeze({ ...row, event: Object.freeze({ ...row.event, message }) });
    }));
}

function settlePendingHistoryMessage(
    message: SerializedRuntimeHistoryMessage,
): SerializedRuntimeHistoryMessage {
    switch (message[0]) {
        case RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR:
        case RUNTIME_HISTORY_MESSAGE.REPAIR_ARMOR:
        case RUNTIME_HISTORY_MESSAGE.DAMAGE_INTERNAL:
        case RUNTIME_HISTORY_MESSAGE.REPAIR_INTERNAL:
        case RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL:
        case RUNTIME_HISTORY_MESSAGE.REPAIR_CRITICAL:
        case RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS:
        case RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED:
            return message.at(-1) === 'pending'
                ? Object.freeze(message.slice(0, -1)) as SerializedRuntimeHistoryMessage
                : message;
        default:
            return message;
    }
}
