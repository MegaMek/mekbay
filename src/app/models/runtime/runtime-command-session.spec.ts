// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    RUNTIME_HISTORY_MESSAGE,
    type SerializedRuntimeHistory,
    type SerializedRuntimeHistoryMessage,
} from './runtime-history';
import {
    appendRuntimeCommandEntry,
    createRuntimeCommandSession,
    prepareRuntimeCommandRedo,
    prepareRuntimeCommandUndo,
    runtimeHistoryRows,
    serializeRuntimeHistory,
    type RuntimeCommandCheckpoint,
} from './runtime-command-session';

const BEFORE = Object.freeze({ units: Object.freeze([]) }) satisfies RuntimeCommandCheckpoint;
const AFTER = Object.freeze({
    units: Object.freeze([]),
    encounter: Object.freeze({
        schemaVersion: 2 as const,
        encounterRevision: 1,
        facts: Object.freeze([]),
    }),
}) satisfies RuntimeCommandCheckpoint;

function unitCheckpoint(instanceId: string): RuntimeCommandCheckpoint {
    return Object.freeze({
        units: Object.freeze([Object.freeze({
            instanceId: instanceId,
            unit: Object.freeze({}) as never,
        })]),
    });
}

describe('runtime command session', () => {
    it('appends, undoes, and redoes session-only checkpoints', () => {
        const session = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            history: { messageId: RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, data: ['damage-armor'] },
            before: BEFORE,
            after: AFTER,
        });

        expect(session.cursor).toBe(1);
        const undo = prepareRuntimeCommandUndo(session)!;
        expect(undo.checkpoint).toBe(BEFORE);
        expect(undo.session.cursor).toBe(0);

        const redo = prepareRuntimeCommandRedo(undo.session)!;
        expect(redo.checkpoint).toBe(AFTER);
        expect(redo.session.cursor).toBe(1);
        expect(redo.session.entries).toBe(session.entries);
    });

    it('drops an abandoned redo tail and collapses a completed phase into one undo step', () => {
        const first = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            history: { messageId: RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, data: ['first'] },
            before: BEFORE,
            after: AFTER,
        });
        const second = appendRuntimeCommandEntry(first, {
            history: { messageId: RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, data: ['second'] },
            before: AFTER,
            after: BEFORE,
        });
        const undone = prepareRuntimeCommandUndo(second)!.session;
        const branched = appendRuntimeCommandEntry(undone, {
            history: { messageId: RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED },
            boundary: 'phase',
            before: AFTER,
            after: BEFORE,
        });

        expect(branched.entries).toHaveSize(1);
        expect(branched.entries[0].events.map(event => event.message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.FORCE_ACTION,
            RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED,
        ]);
        expect(branched.phase).toBe(2);
        expect(prepareRuntimeCommandRedo(branched)).toBeNull();
    });

    it('settles pending history rows and keeps the phase boundary out of the visible log', () => {
        const unit = unitCheckpoint('unit:test');
        let session = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            history: {
                messageId: RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
                data: ['unit:test', 'f:ct', 9, 'pending'],
            },
            before: unit,
            after: unit,
        });

        const pendingMessage = runtimeHistoryRows({ u: [], t: [] }, session)[0].event.message;
        const pendingMarker = String(pendingMessage[pendingMessage.length - 1]);
        expect(pendingMarker).toBe('pending');

        session = appendRuntimeCommandEntry(session, {
            history: {
                messageId: RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED,
                data: ['unit:test'],
            },
            boundary: 'phase',
            before: unit,
            after: unit,
        });

        expect(JSON.stringify(runtimeHistoryRows({ u: [], t: [] }, session)
            .map(row => [...row.event.message]))).toBe(JSON.stringify([
                [RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR, 'unit:test', 'f:ct', 9],
            ]));
        expect(runtimeHistoryRows({ u: [], t: [] }, session, true).map(row => row.event.message[0]))
            .toEqual([
                RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
                RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED,
            ]);

        const saved = serializeRuntimeHistory({ u: [], t: [] }, session);
        expect(JSON.stringify(saved.t[0].p[0][0])).toBe(JSON.stringify([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            0,
            'f:ct',
            9,
        ]));
    });

    it('settles a restored pending history row when its phase is committed after reload', () => {
        const unit = unitCheckpoint('unit:test');
        const pending = Object.freeze([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            0,
            'f:ct',
            9,
            'pending',
        ]) as SerializedRuntimeHistoryMessage;
        const durable: SerializedRuntimeHistory = Object.freeze({
            u: Object.freeze(['unit:test']),
            t: Object.freeze([Object.freeze({
                n: 1,
                p: Object.freeze([Object.freeze([pending])]),
            })]),
        });
        const session = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            history: {
                messageId: RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED,
                data: ['unit:test'],
            },
            boundary: 'phase',
            before: unit,
            after: unit,
        });

        expect(JSON.stringify(runtimeHistoryRows(durable, session)[0].event.message)).toBe(JSON.stringify([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            'unit:test',
            'f:ct',
            9,
        ]));
        expect(JSON.stringify(serializeRuntimeHistory(durable, session).t[0].p[0][0])).toBe(JSON.stringify([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            0,
            'f:ct',
            9,
        ]));
    });

    it('never folds another independently progressing unit into a phase undo step', () => {
        const unitA = unitCheckpoint('unit:a');
        const unitB = unitCheckpoint('unit:b');
        let session = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.UNIT_ACTION,
                data: ['unit:a', 'first'],
            },
            before: unitA,
            after: unitA,
        });
        session = appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.UNIT_ACTION,
                data: ['unit:b', 'second'],
            },
            before: unitB,
            after: unitB,
        });
        session = appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED,
                data: ['unit:a'],
            },
            boundary: 'phase',
            before: unitA,
            after: unitA,
        });

        expect(session.entries).toHaveSize(3);
        expect(JSON.stringify(session.entries[1].events[0].message)).toBe(JSON.stringify([
            RUNTIME_HISTORY_MESSAGE.UNIT_ACTION,
            'unit:b',
            'second',
        ]));
        expect(session.entries[2].turn).toBe(1);
        expect(session.entries[2].phase).toBe(1);
    });

    it('serializes applied current history and retains only the latest two numbered turns', () => {
        let session = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            history: { turn: 18, phase: 1, messageId: RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, data: ['old'] },
            before: BEFORE,
            after: AFTER,
        });
        session = appendRuntimeCommandEntry(session, {
            history: { turn: 19, phase: 1, messageId: RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, data: ['previous'] },
            before: AFTER,
            after: BEFORE,
        });
        session = appendRuntimeCommandEntry(session, {
            history: { turn: 20, phase: 2, messageId: RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, data: ['current'] },
            before: BEFORE,
            after: AFTER,
        });

        expect(JSON.stringify(serializeRuntimeHistory({ u: [], t: [] }, session))).toBe(JSON.stringify({
            u: [],
            t: [{ n: 19, p: [[[RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, 'previous']]] }, {
                n: 20,
                p: [[[RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, 'current']]],
            }],
        }));

        const undone = prepareRuntimeCommandUndo(session)!.session;
        expect(serializeRuntimeHistory({ u: [], t: [] }, undone).t.map(turn => turn.n)).toEqual([18, 19]);
    });

    it('keeps undo checkpoints for silent edits and accepts multiple semantic rows for one edit', () => {
        const silent = appendRuntimeCommandEntry(createRuntimeCommandSession(), {
            before: BEFORE,
            after: AFTER,
        });
        const withSkills = appendRuntimeCommandEntry(silent, {
            history: [{
                messageId: RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
                data: ['unit:test', 0, 0, 4, 3],
            }, {
                messageId: RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
                data: ['unit:test', 0, 1, 5, 4],
            }],
            before: AFTER,
            after: BEFORE,
        });

        expect(silent.entries[0].events).toEqual([]);
        expect(silent.cursor).toBe(1);
        expect(withSkills.entries[1].events.map(event => event.message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
            RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
        ]);
    });

    it('keeps only the effective Mek state change inside each phase', () => {
        const action = (
            session: ReturnType<typeof createRuntimeCommandSession>,
            before: number,
            after: number,
            phase: number,
        ) => appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase,
                messageId: RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED,
                data: ['unit:test', before, after],
            },
            before: BEFORE,
            after: AFTER,
        });
        let cancelled = createRuntimeCommandSession();
        cancelled = action(cancelled, 0, 1, 1);
        cancelled = action(cancelled, 1, 0, 1);
        cancelled = action(cancelled, 0, 1, 1);
        cancelled = action(cancelled, 1, 0, 1);

        expect(runtimeHistoryRows({ u: [], t: [] }, cancelled)).toEqual([]);
        expect(serializeRuntimeHistory({ u: [], t: [] }, cancelled)).toEqual({ u: [], t: [] });

        let separated = createRuntimeCommandSession();
        separated = action(separated, 0, 1, 1);
        separated = action(separated, 1, 0, 2);
        expect(runtimeHistoryRows({ u: [], t: [] }, separated).map(row => row.event.phase)).toEqual([1, 2]);
        expect(serializeRuntimeHistory({ u: [], t: [] }, separated).t[0].p).toHaveSize(2);
    });

    it('folds repeated movement edits to the phase result and drops a net reset', () => {
        const movement = (
            session: ReturnType<typeof createRuntimeCommandSession>,
            beforeMode: number,
            beforeDistance: number,
            afterMode: number,
            afterDistance: number,
        ) => appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED,
                data: ['unit:test', beforeMode, beforeDistance, afterMode, afterDistance],
            },
            before: BEFORE,
            after: AFTER,
        });
        let session = createRuntimeCommandSession();
        session = movement(session, 0, 0, 2, 3);
        session = movement(session, 2, 3, 3, 5);
        const message = [...runtimeHistoryRows({ u: [], t: [] }, session)[0].event.message];
        expect(JSON.stringify(message)).toBe(JSON.stringify([
            RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED,
            'unit:test',
            0,
            0,
            3,
            5,
        ]));

        session = movement(session, 3, 5, 0, 0);
        expect(runtimeHistoryRows({ u: [], t: [] }, session)).toEqual([]);
    });

    it('keeps only the final cover and spotting state in a phase', () => {
        const cover = (
            session: ReturnType<typeof createRuntimeCommandSession>,
            before: number,
            after: number,
        ) => appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
                data: ['unit:test', before, after],
            },
            before: BEFORE,
            after: AFTER,
        });
        let covers = createRuntimeCommandSession();
        covers = cover(covers, 0, 1);
        covers = cover(covers, 1, 4);
        covers = cover(covers, 4, 2);
        expect(JSON.stringify(runtimeHistoryRows({ u: [], t: [] }, covers)[0].event.message))
            .toBe(JSON.stringify([
                RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
                'unit:test',
                0,
                2,
            ]));

        covers = cover(covers, 2, 0);
        expect(runtimeHistoryRows({ u: [], t: [] }, covers)).toEqual([]);

        const spotting = (
            session: ReturnType<typeof createRuntimeCommandSession>,
            before: boolean,
            after: boolean,
        ) => appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED,
                data: ['unit:test', before, after],
            },
            before: BEFORE,
            after: AFTER,
        });
        let spotter = createRuntimeCommandSession();
        spotter = spotting(spotter, false, true);
        spotter = spotting(spotter, true, false);
        expect(runtimeHistoryRows({ u: [], t: [] }, spotter)).toEqual([]);
    });

    it('folds component mode churn to its first-to-final transition', () => {
        const mode = (
            session: ReturnType<typeof createRuntimeCommandSession>,
            before: string,
            after: string,
        ) => appendRuntimeCommandEntry(session, {
            history: {
                turn: 1,
                phase: 1,
                messageId: RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED,
                data: ['unit:test', 'c:ac20', before, after],
            },
            before: BEFORE,
            after: AFTER,
        });
        let session = createRuntimeCommandSession();
        session = mode(session, 'Single', 'Rapid');
        session = mode(session, 'Rapid', 'Ultra');
        expect(JSON.stringify(runtimeHistoryRows({ u: [], t: [] }, session)[0].event.message))
            .toBe(JSON.stringify([
                RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED,
                'unit:test',
                'c:ac20',
                'Single',
                'Ultra',
            ]));

        session = mode(session, 'Ultra', 'Single');
        expect(runtimeHistoryRows({ u: [], t: [] }, session)).toEqual([]);
    });
});
