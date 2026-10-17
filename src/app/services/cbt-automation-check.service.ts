// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PendingUnitCheckDialogComponent } from '../components/pending-unit-check-dialog/pending-unit-check-dialog.component';
import type {
    AutomationCheck,
    AutomationCheckDialogData,
    AutomationCheckResolution,
    AutomationCheckSelection,
} from '../models/automation-check.model';
import type { CBTAutomationKey } from '../models/options.model';
import { roll2D6, twoD6Total } from '../models/runtime/mek-automation-rules';
import { DialogsService } from './dialogs.service';
import { OptionsService } from './options.service';

export interface AutomationCheckOptions {
    readonly title: string;
    readonly initiallyFailedGroups?: ReadonlySet<string>;
    /** Badge-driven resume keeps disabled checks disabled, but opens configured automatic checks. */
    readonly interactive?: boolean;
    /** Explicit user resolution opens the check dialog regardless of its configured mode. */
    readonly manualResolution?: boolean;
}

interface PendingAutomationCheckBatch {
    readonly checks: AutomationCheck[];
    readonly callers: Array<Readonly<{
        checkIds: ReadonlySet<string>;
        sessionId: string;
        resolve: (result: readonly AutomationCheckResolution[] | null) => void;
        reject: (reason?: unknown) => void;
    }>>;
    readonly failedGroups: Set<string>;
    readonly title: string;
}

/** Resolves real dice checks while preserving the global yes/ask/no policy. */
@Injectable({ providedIn: 'root' })
export class CBTAutomationCheckService {
    private readonly dialogs = inject(DialogsService);
    private readonly options = inject(OptionsService);
    /** In-progress physical/virtual dice entries; this is workflow state, not derived-data caching. */
    private readonly pendingSelections = new Map<string, readonly AutomationCheckSelection[]>();
    /** Same-boundary Mek/non-Mek checks share one rules-ordered dialog. */
    private readonly pendingBatches = new Map<string, PendingAutomationCheckBatch>();

    async resolve(
        key: CBTAutomationKey,
        checks: readonly AutomationCheck[],
        options: AutomationCheckOptions,
    ): Promise<readonly AutomationCheckResolution[] | null> {
        if (checks.length === 0) return Object.freeze([]);
        const initiallyFailedGroups = options.initiallyFailedGroups ?? new Set<string>();
        const sessionId = automationCheckSessionId(key, checks);
        const configured = this.options.cbtAutomationMode(key);
        const mode = options.manualResolution
            ? 'ask'
            : options.interactive && configured === 'yes' ? 'ask' : configured;
        switch (mode) {
            case 'no':
                this.pendingSelections.delete(sessionId);
                return Object.freeze([]);
            case 'yes':
                this.pendingSelections.delete(sessionId);
                return resolveAutomationChecksAutomatically(checks, initiallyFailedGroups);
            case 'ask': return this.enqueueChecks(
                key,
                checks,
                options,
                sessionId,
                initiallyFailedGroups,
            );
        }
    }

    private enqueueChecks(
        key: CBTAutomationKey,
        checks: readonly AutomationCheck[],
        options: AutomationCheckOptions,
        sessionId: string,
        initiallyFailedGroups: ReadonlySet<string>,
    ): Promise<readonly AutomationCheckResolution[] | null> {
        const batchKey = `${key}\u001f${options.title}`;
        return new Promise((resolve, reject) => {
            const caller = Object.freeze({
                checkIds: new Set(checks.map(check => check.id)),
                sessionId,
                resolve,
                reject,
            });
            const pending = this.pendingBatches.get(batchKey);
            if (pending) {
                for (const check of checks) {
                    if (!pending.checks.some(candidate => candidate.id === check.id)) {
                        pending.checks.push(check);
                    }
                }
                initiallyFailedGroups.forEach(group => pending.failedGroups.add(group));
                pending.callers.push(caller);
                return;
            }
            this.pendingBatches.set(batchKey, {
                checks: [...checks],
                callers: [caller],
                failedGroups: new Set(initiallyFailedGroups),
                title: options.title,
            });
            queueMicrotask(() => void this.flushChecks(batchKey));
        });
    }

    private async flushChecks(batchKey: string): Promise<void> {
        const pending = this.pendingBatches.get(batchKey);
        if (!pending) return;
        this.pendingBatches.delete(batchKey);
        const initialSelections = pending.callers.flatMap(caller =>
            this.pendingSelections.get(caller.sessionId) ?? []);
        try {
            const ref = this.dialogs.createDialog<readonly AutomationCheckResolution[]>(
                PendingUnitCheckDialogComponent,
                {
                    disableClose: false,
                    data: {
                        title: pending.title,
                        checks: Object.freeze(pending.checks),
                        initiallyFailedGroups: pending.failedGroups,
                        ...(initialSelections.length === 0
                            ? {}
                            : { initialSelections: Object.freeze(initialSelections) }),
                        selectionsChanged: selections => {
                            for (const caller of pending.callers) {
                                const own = selections.filter(selection =>
                                    caller.checkIds.has(selection.id));
                                if (own.length === 0) this.pendingSelections.delete(caller.sessionId);
                                else this.pendingSelections.set(caller.sessionId, Object.freeze(own));
                            }
                        },
                    } satisfies AutomationCheckDialogData,
                },
            );
            const result = (await firstValueFrom(ref.closed)) ?? null;
            for (const caller of pending.callers) {
                if (result !== null) this.pendingSelections.delete(caller.sessionId);
                caller.resolve(result === null
                    ? null
                    : Object.freeze(result.filter(row => caller.checkIds.has(row.id))));
            }
        } catch (error) {
            pending.callers.forEach(caller => caller.reject(error));
        }
    }
}

function automationCheckSessionId(
    key: CBTAutomationKey,
    checks: readonly AutomationCheck[],
): string {
    return `${key}:${checks.map(check => check.id).join('\u001f')}`;
}

/** The rules-ordered walk: a failed check fails every later check in its failure group. */
function cascadeAutomationChecks<Row extends { readonly outcome: 'success' | 'failed' }>(
    checks: readonly AutomationCheck[],
    initiallyFailedGroups: ReadonlySet<string>,
    decide: (check: AutomationCheck, cascaded: boolean) => Row,
): Row[] {
    const failedGroups = new Set(initiallyFailedGroups);
    return checks.map(check => {
        const row = decide(check, check.failureGroup !== undefined && failedGroups.has(check.failureGroup));
        if (row.outcome === 'failed' && check.failureGroup) failedGroups.add(check.failureGroup);
        return row;
    });
}

/** The outcome a check reaches without dice, or undefined when it needs a roll. */
function automaticCheckOutcome(
    check: AutomationCheck,
    cascaded: boolean,
): 'success' | 'failed' | undefined {
    if (cascaded) return 'failed';
    return check.automaticOutcome ?? (check.targetNumber === undefined ? 'failed' : undefined);
}

export function resolveAutomationChecksAutomatically(
    checks: readonly AutomationCheck[],
    initiallyFailedGroups: ReadonlySet<string> = new Set<string>(),
): readonly AutomationCheckResolution[] {
    return Object.freeze(cascadeAutomationChecks(checks, initiallyFailedGroups, (check, cascaded) => {
        const automatic = automaticCheckOutcome(check, cascaded);
        const dice = automatic === undefined ? roll2D6() : null;
        const outcome = automatic
            ?? (twoD6Total(dice!) >= check.targetNumber! ? 'success' as const : 'failed' as const);
        const failureChoices = outcome === 'failed' ? check.failureChoices ?? [] : [];
        const selectionId = failureChoices.length === 0
            ? undefined
            : failureChoices[Math.floor(Math.random() * failureChoices.length)]!.id;
        return Object.freeze({
            id: check.id,
            outcome,
            dice,
            automatic: automatic !== undefined,
            ...(selectionId === undefined ? {} : { selectionId }),
        });
    }));
}

/** True when resolving the batch cannot require dice or a manual outcome. */
export function automationCheckBatchIsFullyAutomatic(
    checks: readonly AutomationCheck[],
    initiallyFailedGroups: ReadonlySet<string> = new Set<string>(),
): boolean {
    return checks.length > 0 && cascadeAutomationChecks(checks, initiallyFailedGroups, (check, cascaded) => {
        const outcome = automaticCheckOutcome(check, cascaded);
        return { outcome: outcome ?? 'failed', automatic: outcome !== undefined };
    }).every(row => row.automatic);
}

/** Dice evidence for reducers that derive outcomes from 2d6 instead of accepting a manual flag. */
export function automationCheckEvidenceDice(
    resolution: AutomationCheckResolution,
    targetNumber: number,
): readonly [number, number] {
    if (resolution.dice) return resolution.dice;
    const total = resolution.outcome === 'success'
        ? Math.max(2, Math.min(12, targetNumber))
        : Math.max(2, Math.min(12, targetNumber - 1));
    const first = Math.max(1, Math.min(6, total - 1));
    return [first, total - first];
}
