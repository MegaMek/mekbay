// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnit } from './cbt-unit';
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
import {
    compareUnitInstanceIds,
    serializedUnitTurnCounter,
    unitHistory,
    type RuntimeHistoryInput,
} from './cbt-force-runtime-history';

export interface RuntimeCommandJournalUnitAccess {
    cbtUnit(instanceId: string): CBTUnit | null;
    history(): SerializedRuntimeHistory | null;
}

export interface CapturedRuntimeCommandMutation {
    readonly checkpoint: RuntimeCommandCheckpoint;
    readonly openingWitnesses: ReadonlyMap<string, Readonly<{
        unit: CBTUnit;
        revision: number;
    }>>;
}

export interface RecordedRuntimeCommandMutation {
    readonly session: RuntimeCommandSession;
    readonly changedUnitIds: readonly string[];
}

export function captureRuntimeCommandMutation(
    authority: RuntimeCommandJournalUnitAccess,
    instanceIds: readonly string[],
): CapturedRuntimeCommandMutation {
    const ids = [...new Set(instanceIds)].sort(compareUnitInstanceIds);
    const openingWitnesses = new Map<string, Readonly<{
        unit: CBTUnit;
        revision: number;
    }>>();
    const units = Object.freeze(ids.map(instanceId => {
        const unit = authority.cbtUnit(instanceId);
        if (!unit) throw new Error(`Cannot capture unknown runtime ${instanceId}`);
        openingWitnesses.set(instanceId, Object.freeze({ unit, revision: unit.revision() }));
        return Object.freeze({
            instanceId,
            unit: unit.serialize(),
            attackerTargeting: unit.captureRuntime().query.attackerTargetingState(),
        });
    }));
    return Object.freeze({
        checkpoint: Object.freeze({ units }),
        openingWitnesses,
    });
}

export function recordRuntimeCommandMutation(
    authority: RuntimeCommandJournalUnitAccess,
    session: RuntimeCommandSession,
    captured: CapturedRuntimeCommandMutation,
    history: RuntimeHistoryInput,
    boundary?: 'phase',
): RecordedRuntimeCommandMutation {
    const changedUnitIds = captured.checkpoint.units.flatMap(row => {
        const current = authority.cbtUnit(row.instanceId);
        if (!current) throw new Error(`Cannot record unknown runtime ${row.instanceId}`);
        const opening = captured.openingWitnesses.get(row.instanceId);
        return opening?.unit === current && opening.revision === current.revision()
            ? []
            : [row.instanceId];
    });
    if (changedUnitIds.length === 0) {
        return Object.freeze({ session, changedUnitIds: Object.freeze([]) });
    }

    const changed = new Set(changedUnitIds);
    const before = Object.freeze({
        units: Object.freeze(captured.checkpoint.units.filter(row => changed.has(row.instanceId))),
    });
    const after = Object.freeze({
        units: Object.freeze(changedUnitIds.map(instanceId => {
            const unit = authority.cbtUnit(instanceId);
            if (!unit) throw new Error(`Cannot record unknown runtime ${instanceId}`);
            return Object.freeze({
                instanceId,
                unit: unit.serialize(),
                attackerTargeting: unit.captureRuntime().query.attackerTargetingState(),
            });
        })),
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
            after,
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
            : beforeById.get(unitId);
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
