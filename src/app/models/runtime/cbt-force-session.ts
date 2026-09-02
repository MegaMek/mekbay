// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import {
    queryTargetRegistry,
    reduceTargetRegistry,
    type TargetRegistryCommand,
    type TargetRegistryCommandResult,
    type TargetRegistrySnapshot,
} from './encounter-runtime';
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
import { preserveEquipmentRowOrder, type RuntimeHistoryInput } from './cbt-force-runtime-history';
import { isSerializedNonMekUnit } from './non-mek-unit-persistence';

/** Per-force owner of data that exists only for the lifetime of the loaded force. */
export class CBTForceSession {
    private commandSession: RuntimeCommandSession = createRuntimeCommandSession();
    private targetRegistryState: TargetRegistrySnapshot = queryTargetRegistry({
        revision: 0,
        targets: [],
    });
    private readonly targetRegistryVersionState = signal(0);

    public readonly targetRegistryVersion = this.targetRegistryVersionState.asReadonly();
    public readonly opforEnabled = signal(false);
    /** Presentation invalidation only; persistence deliberately never subscribes. */
    public readonly changed = new Subject<readonly string[] | null>();

    public constructor(private readonly units: RuntimeCommandJournalUnitAccess) {}

    public targetRegistry(): TargetRegistrySnapshot {
        return queryTargetRegistry(this.targetRegistryState);
    }

    public dispatchTargetRegistry(command: TargetRegistryCommand): TargetRegistryCommandResult {
        const result = reduceTargetRegistry(this.targetRegistryState, command);
        if (result.accepted && result.changed) {
            this.targetRegistryState = result.snapshot;
            this.targetRegistryVersionState.update(version => version + 1);
        }
        return result;
    }

    public resetTargets(): void {
        const changed = this.targetRegistryState.revision !== 0
            || this.targetRegistryState.targets.length > 0
            || this.opforEnabled();
        this.targetRegistryState = queryTargetRegistry({ revision: 0, targets: [] });
        this.opforEnabled.set(false);
        if (changed) this.targetRegistryVersionState.update(version => version + 1);
    }

    public publish(changedUnitIds: readonly string[] | null): void {
        this.changed.next(changedUnitIds === null
            ? null
            : Object.freeze([...new Set(changedUnitIds)]));
    }

    public undoState(): Readonly<{ readonly canUndo: boolean; readonly canRedo: boolean }> {
        return Object.freeze({
            canUndo: this.commandSession.cursor > 0,
            canRedo: this.commandSession.cursor < this.commandSession.entries.length,
        });
    }

    public history(durable: SerializedRuntimeHistory | null = this.units.history()) {
        return runtimeHistoryRows(durable ?? emptyRuntimeHistory(), this.commandSession);
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
            this.commandSession,
            captured,
            history,
            boundary,
        );
        this.commandSession = recorded.session;
        return recorded.changedUnitIds;
    }

    public prepare(direction: 'undo' | 'redo'): RuntimeCommandMove | null {
        return direction === 'undo'
            ? prepareRuntimeCommandUndo(this.commandSession)
            : prepareRuntimeCommandRedo(this.commandSession);
    }

    /** Targeting and row-order UI state are deliberately outside gameplay undo. */
    public preserveCurrentOperationalState(
        checkpoint: RuntimeCommandCheckpoint,
    ): RuntimeCommandCheckpoint {
        return Object.freeze({
            ...checkpoint,
            units: Object.freeze(checkpoint.units.map(row => {
                const current = this.units.cbtUnit(row.instanceId)?.serialize();
                const targeting = this.units.cbtUnit(row.instanceId)
                    ?.captureRuntime().query.attackerTargetingState();
                if (current === undefined || targeting === undefined) return row;
                if (isSerializedNonMekUnit(row.unit)) {
                    if (!isSerializedNonMekUnit(current)) {
                        throw new Error(`Runtime family changed for ${row.instanceId}`);
                    }
                    return Object.freeze({
                        ...row,
                        unit: preserveEquipmentRowOrder(row.unit, current),
                        attackerTargeting: targeting,
                    });
                }
                if (isSerializedNonMekUnit(current)) {
                    throw new Error(`Runtime family changed for ${row.instanceId}`);
                }
                return Object.freeze({
                    ...row,
                    unit: preserveEquipmentRowOrder(row.unit, current),
                    attackerTargeting: targeting,
                });
            })),
        });
    }

    public commit(move: RuntimeCommandMove): void {
        this.commandSession = move.session;
    }

    public prune(removed: ReadonlySet<string>): void {
        this.commandSession = pruneRuntimeCommandSession(this.commandSession, removed);
    }

    public resetRuntime(): void {
        this.commandSession = createRuntimeCommandSession();
    }

    public serializeHistory(durable: SerializedRuntimeHistory): SerializedRuntimeHistory {
        return serializeRuntimeHistory(durable, this.commandSession);
    }
}

export type { CapturedRuntimeCommandMutation } from './cbt-force-command-journal';
