// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    captureRuntimeCommandMutation,
    recordRuntimeCommandMutation,
    type CapturedRuntimeCommandMutation,
    type RuntimeCommandJournalUnitAccess,
} from './cbt-force-command-journal';
import {
    createRuntimeCommandSession,
    prepareRuntimeCommandRedo,
    prepareRuntimeCommandUndo,
    pruneRuntimeCommandSession,
    runtimeHistoryRows,
    serializeRuntimeHistory,
    type RuntimeCommandCheckpoint,
    type RuntimeCommandMove,
    type RuntimeCommandSession,
} from './runtime-command-session';
import { emptyRuntimeHistory } from './persistence-v2';
import type { SerializedRuntimeHistory } from './runtime-history';
import { preserveOperationalUnitState, type RuntimeHistoryInput } from './cbt-force-runtime-history';
import { isSerializedNonMekUnit } from './non-mek-unit-persistence';

/** Sole owner of session-only checkpoints and the durable semantic-history view. */
export class CBTForceRuntimeJournal {
    private session: RuntimeCommandSession = createRuntimeCommandSession();

    public constructor(private readonly units: RuntimeCommandJournalUnitAccess) {}

    public undoState(): Readonly<{ readonly canUndo: boolean; readonly canRedo: boolean }> {
        return Object.freeze({
            canUndo: this.session.cursor > 0,
            canRedo: this.session.cursor < this.session.entries.length,
        });
    }

    public history(durable: SerializedRuntimeHistory | null = this.units.history()) {
        return runtimeHistoryRows(durable ?? emptyRuntimeHistory(), this.session);
    }

    public capture(instanceIds: readonly string[]): CapturedRuntimeCommandMutation {
        return captureRuntimeCommandMutation(this.units, instanceIds);
    }

    public record(
        captured: CapturedRuntimeCommandMutation,
        history: RuntimeHistoryInput,
        boundary?: 'phase',
    ): readonly string[] {
        const recorded = recordRuntimeCommandMutation(
            this.units,
            this.session,
            captured,
            history,
            boundary,
        );
        this.session = recorded.session;
        return recorded.changedUnitIds;
    }

    public prepare(direction: 'undo' | 'redo'): RuntimeCommandMove | null {
        return direction === 'undo'
            ? prepareRuntimeCommandUndo(this.session)
            : prepareRuntimeCommandRedo(this.session);
    }

    /** Targeting and row-order UI state are deliberately outside gameplay undo. */
    public preserveCurrentOperationalState(
        checkpoint: RuntimeCommandCheckpoint,
    ): RuntimeCommandCheckpoint {
        return Object.freeze({
            ...checkpoint,
            units: Object.freeze(checkpoint.units.map(row => {
                const current = this.units.cbtUnit(row.instanceId)?.serialize();
                if (current === undefined) return row;
                if (isSerializedNonMekUnit(row.unit)) {
                    if (!isSerializedNonMekUnit(current)) {
                        throw new Error(`Runtime family changed for ${row.instanceId}`);
                    }
                    return Object.freeze({
                        ...row,
                        unit: preserveOperationalUnitState(row.unit, current),
                    });
                }
                if (isSerializedNonMekUnit(current)) {
                    throw new Error(`Runtime family changed for ${row.instanceId}`);
                }
                return Object.freeze({
                    ...row,
                    unit: preserveOperationalUnitState(row.unit, current),
                });
            })),
        });
    }

    public commit(move: RuntimeCommandMove): void {
        this.session = move.session;
    }

    public prune(removed: ReadonlySet<string>): void {
        this.session = pruneRuntimeCommandSession(this.session, removed);
    }

    public reset(): void {
        this.session = createRuntimeCommandSession();
    }

    public serialize(durable: SerializedRuntimeHistory): SerializedRuntimeHistory {
        return serializeRuntimeHistory(durable, this.session);
    }
}

export type { CapturedRuntimeCommandMutation } from './cbt-force-command-journal';
