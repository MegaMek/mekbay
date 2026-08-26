// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { jsonValuesEqual } from '../../utils/json-value.util';
import type { ReadyClassicUnit } from './ready-classic-unit';
import { emptyRuntimeHistory } from './persistence-v2';
import {
    appendRuntimeCommandEntry,
    runtimeHistoryRows,
    type RuntimeCommandCheckpoint,
    type RuntimeCommandSession,
} from './runtime-command-session';
import {
    RUNTIME_HISTORY_MESSAGE,
    runtimeHistoryMessageCanReferenceUnit,
    runtimeHistoryMessageUnitId,
    type RuntimeHistoryEventInput,
    type SerializedRuntimeHistory,
} from './runtime-history';
import { asUnitInstanceId, type UnitInstanceId } from './runtime-state';
import {
    compareUnitInstanceIds,
    serializedUnitTurnCounter,
    unitHistory,
    type RuntimeHistoryInput,
} from './cbt-force-runtime-history';

export interface RuntimeCommandJournalUnitAccess {
    readyUnit(instanceId: UnitInstanceId): ReadyClassicUnit | null;
    history(): SerializedRuntimeHistory | null;
}

export interface CapturedRuntimeCommandMutation {
    readonly checkpoint: RuntimeCommandCheckpoint;
}

export interface RecordedRuntimeCommandMutation {
    readonly session: RuntimeCommandSession;
    readonly changedUnitIds: readonly UnitInstanceId[];
}

export function captureRuntimeCommandMutation(
    authority: RuntimeCommandJournalUnitAccess,
    instanceIds: readonly UnitInstanceId[],
): CapturedRuntimeCommandMutation {
    const ids = [...new Set(instanceIds)].sort(compareUnitInstanceIds);
    const units = Object.freeze(ids.map(instanceId => {
        const unit = authority.readyUnit(instanceId);
        if (!unit) throw new Error(`Cannot capture unknown runtime ${instanceId}`);
        return Object.freeze({ instanceId, unit: unit.serialize() });
    }));
    return Object.freeze({
        checkpoint: Object.freeze({ units }),
    });
}

export function recordRuntimeCommandMutation(
    authority: RuntimeCommandJournalUnitAccess,
    session: RuntimeCommandSession,
    captured: CapturedRuntimeCommandMutation,
    history: RuntimeHistoryInput,
    boundary?: 'phase',
): RecordedRuntimeCommandMutation {
    const after = captureRuntimeCommandMutation(
        authority,
        captured.checkpoint.units.map(row => row.instanceId),
    ).checkpoint;
    const beforeById = new Map(captured.checkpoint.units.map(row => [row.instanceId, row] as const));
    const changedUnitIds = after.units
        .filter(row => !jsonValuesEqual(beforeById.get(row.instanceId)!.unit, row.unit))
        .map(row => row.instanceId);
    if (changedUnitIds.length === 0) {
        return Object.freeze({ session, changedUnitIds: Object.freeze([]) });
    }

    const changed = new Set(changedUnitIds);
    const before = Object.freeze({
        units: Object.freeze(captured.checkpoint.units.filter(row => changed.has(row.instanceId))),
    });
    const next = Object.freeze({
        units: Object.freeze(after.units.filter(row => changed.has(row.instanceId))),
    });
    const positionedHistory = positionRuntimeHistory(
        authority.history() ?? emptyRuntimeHistory(),
        session,
        history,
        captured.checkpoint,
        after,
    );
    return Object.freeze({
        session: appendRuntimeCommandEntry(session, {
            history: positionedHistory,
            ...(boundary === 'phase' ? { boundary: 'phase' as const } : {}),
            before,
            after: next,
        }),
        changedUnitIds: Object.freeze(changedUnitIds),
    });
}

function positionRuntimeHistory(
    persistedHistory: SerializedRuntimeHistory,
    session: RuntimeCommandSession,
    history: RuntimeHistoryInput,
    before: RuntimeCommandCheckpoint,
    after: RuntimeCommandCheckpoint,
): RuntimeHistoryInput {
    const source = history === undefined ? [] : Array.isArray(history) ? history : [history];
    const beforeById = new Map(before.units.map(row => [row.instanceId, row.unit] as const));
    const afterById = new Map(after.units.map(row => [row.instanceId, row.unit] as const));
    const expanded = source.flatMap(event => {
        if (event.messageId !== RUNTIME_HISTORY_MESSAGE.TURN_ENDED
            || (event.data?.length ?? 0) > 0) return [event];
        return before.units.flatMap(row => {
            const beforeTurn = serializedUnitTurnCounter(row.unit);
            const afterUnit = afterById.get(row.instanceId);
            const afterTurn = afterUnit === undefined ? null : serializedUnitTurnCounter(afterUnit);
            return beforeTurn !== null && afterTurn !== null && afterTurn > beforeTurn
                ? [unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_ENDED, row.instanceId)]
                : [];
        });
    });
    if (expanded.length === 0) return undefined;

    const existing = runtimeHistoryRows(persistedHistory, session, true);
    const forceTurn = Math.max(
        1,
        ...existing.map(row => row.event.turn),
        ...before.units.map(row => serializedUnitTurnCounter(row.unit) + 1),
    );
    return Object.freeze(expanded.map(event => {
        const data = event.data ?? [];
        const unitId = runtimeHistoryMessageCanReferenceUnit(event.messageId)
            && typeof data[0] === 'string'
            ? data[0]
            : null;
        const capturedUnit = unitId === null
            ? undefined
            : beforeById.get(asUnitInstanceId(unitId));
        const capturedTurn = capturedUnit === undefined
            ? null
            : serializedUnitTurnCounter(capturedUnit);
        const unitTurns = unitId === null
            ? []
            : existing
                .filter(row => runtimeHistoryMessageUnitId(row.event.message) === unitId)
                .map(row => row.event.turn);
        const turn = event.turn ?? (capturedTurn === null
            ? Math.max(forceTurn, ...unitTurns)
            : capturedTurn + 1);
        const sameTurn = existing.filter(row => row.event.turn === turn
            && (unitId === null
                ? runtimeHistoryMessageUnitId(row.event.message) === null
                : runtimeHistoryMessageUnitId(row.event.message) === unitId));
        const latestPhase = Math.max(1, ...sameTurn.map(row => row.event.phase));
        const latestPhaseEnded = sameTurn.some(row => row.event.phase === latestPhase
            && (row.event.message[0] === RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED
                || row.event.message[0] === RUNTIME_HISTORY_MESSAGE.PHASE_DISCARDED));
        return Object.freeze({
            ...event,
            turn,
            phase: event.phase ?? latestPhase + (latestPhaseEnded ? 1 : 0),
        } satisfies RuntimeHistoryEventInput);
    }));
}
