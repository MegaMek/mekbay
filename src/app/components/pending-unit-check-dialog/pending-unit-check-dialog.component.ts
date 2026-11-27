// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChildren } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import type {
    AutomationCheckDialogData,
    AutomationCheckOutcome,
    AutomationCheckResolution,
    AutomationCheckSelection,
} from '../../models/automation-check.model';
import {
    PendingUnitCheckRowComponent,
    type AutomationCheckDisplayResolution,
} from './pending-unit-check-row.component';

@Component({
    selector: 'pending-unit-check-dialog',
    imports: [PendingUnitCheckRowComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './pending-unit-check-dialog.component.html',
    styleUrls: [
        '../page-viewer/overlay/page-psr-warning-panel.component.scss',
        './pending-unit-check-dialog.component.scss',
    ],
})
export class PendingUnitCheckDialogComponent {
    readonly data = inject<AutomationCheckDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<readonly AutomationCheckResolution[]>>(DialogRef);
    private readonly selectedOutcomes = signal<Readonly<Record<string, AutomationCheckOutcome>>>(
        Object.fromEntries((this.data.initialSelections ?? []).map(selection => [
            selection.id,
            selection.outcome,
        ])),
    );
    private readonly selectedDice = signal<Readonly<Record<string, readonly [number, number]>>>(
        Object.fromEntries((this.data.initialSelections ?? []).flatMap(selection =>
            selection.dice ? [[selection.id, selection.dice] as const] : [])),
    );
    private readonly selectedChoices = signal<Readonly<Record<string, string>>>(
        Object.fromEntries((this.data.initialSelections ?? []).flatMap(selection =>
            selection.selectionId ? [[selection.id, selection.selectionId] as const] : [])),
    );
    readonly rows = viewChildren(PendingUnitCheckRowComponent);
    readonly commonSubject = computed(() => {
        const first = this.data.checks[0]?.subject;
        return first && this.data.checks.every(check => check.subject === first) ? first : null;
    });
    readonly resolutions = computed<ReadonlyMap<string, AutomationCheckDisplayResolution>>(() => {
        const resolutions = new Map<string, AutomationCheckDisplayResolution>();
        const failedGroups = new Set(this.data.initiallyFailedGroups);
        const selected = this.selectedOutcomes();
        const dice = this.selectedDice();
        const choices = this.selectedChoices();
        for (const check of this.data.checks) {
            let resolution: AutomationCheckDisplayResolution | undefined;
            if (check.automaticOutcome) {
                resolution = {
                    outcome: check.automaticOutcome,
                    source: 'automatic',
                    dice: null,
                };
            } else if (check.failureGroup && failedGroups.has(check.failureGroup)) {
                resolution = { outcome: 'failed', source: 'cascade', dice: null };
            } else if (selected[check.id]) {
                resolution = {
                    outcome: selected[check.id],
                    source: 'selected',
                    dice: dice[check.id] ?? null,
                };
            }
            if (!resolution) continue;
            const selectionId = choices[check.id]
                ?? (check.failureChoices?.length === 1 ? check.failureChoices[0]!.id : undefined);
            resolutions.set(check.id, selectionId === undefined
                ? resolution
                : { ...resolution, selectionId });
            if (resolution.outcome === 'failed' && check.failureGroup) {
                failedGroups.add(check.failureGroup);
            }
        }
        return resolutions;
    });
    readonly allResolved = computed(() => this.data.checks.length > 0
        && this.data.checks.every(check => {
            const resolution = this.resolutions().get(check.id);
            return resolution !== undefined
                && (resolution.outcome !== 'failed'
                    || !check.failureChoices?.length
                    || resolution.selectionId !== undefined);
        }));
    readonly rollableRows = computed(() => this.rows().filter(row => !row.isAutomatic()));
    readonly showRollAll = computed(() => this.rollableRows().length > 1);
    readonly isAnyRolling = computed(() => this.rollableRows().some(row => row.isRolling()));

    resolution(checkId: string): AutomationCheckDisplayResolution | undefined {
        return this.resolutions().get(checkId);
    }

    select(
        checkId: string,
        selection: Readonly<{ outcome: AutomationCheckOutcome; dice: readonly [number, number] | null }>,
    ): void {
        this.selectedOutcomes.update(current => ({ ...current, [checkId]: selection.outcome }));
        this.selectedDice.update(current => {
            if (selection.dice) return { ...current, [checkId]: selection.dice };
            const { [checkId]: _removed, ...remaining } = current;
            return remaining;
        });
        this.publishSelections();
    }

    selectChoice(checkId: string, selectionId: string): void {
        const check = this.data.checks.find(candidate => candidate.id === checkId);
        if (!check?.failureChoices?.some(choice => choice.id === selectionId)) return;
        this.selectedChoices.update(current => ({ ...current, [checkId]: selectionId }));
        this.publishSelections();
    }

    rollAll(): void {
        if (!this.isAnyRolling()) this.rollableRows().forEach(row => row.roll());
    }

    apply(): void {
        if (!this.allResolved()) return;
        const resolutions = this.resolutions();
        this.dialogRef.close(Object.freeze(this.data.checks.map(check => {
            const resolution = resolutions.get(check.id)!;
            return Object.freeze({
                id: check.id,
                outcome: resolution.outcome,
                dice: resolution.dice,
                automatic: resolution.source !== 'selected',
                ...(resolution.selectionId === undefined
                    ? {}
                    : { selectionId: resolution.selectionId }),
            });
        })));
    }

    close(): void {
        this.publishSelections();
        this.dialogRef.close();
    }

    private publishSelections(): void {
        this.data.selectionsChanged?.(this.currentSelections());
    }

    private currentSelections(): readonly AutomationCheckSelection[] {
        const outcomes = this.selectedOutcomes();
        const dice = this.selectedDice();
        const choices = this.selectedChoices();
        return Object.freeze(this.data.checks.flatMap(check => {
            const outcome = outcomes[check.id];
            return outcome === undefined ? [] : [Object.freeze({
                id: check.id,
                outcome,
                dice: dice[check.id] ?? null,
                ...(choices[check.id] === undefined
                    ? {}
                    : { selectionId: choices[check.id] }),
            } satisfies AutomationCheckSelection)];
        }));
    }
}
