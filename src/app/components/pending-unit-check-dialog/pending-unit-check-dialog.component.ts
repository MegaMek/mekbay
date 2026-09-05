// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, viewChildren } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { isFallPSRCheck } from '../../models/rules/unit-type-rules';
import {
    isConsciousnessCheck,
    isPendingUnitCheckEntry,
    pendingCheckReviewEntryKey,
    pendingCheckReviewGroupList,
    pendingPsrCommittedOutcome,
    pendingUnitCheckIsResolved,
    pendingUnitCheckDialogTitle,
    pendingUnitCheckOutcome,
    type PendingCheckReviewEntry,
} from '../../utils/unit-check.util';
import { PendingUnitCheckRowComponent } from './pending-unit-check-row.component';

export interface PendingUnitCheckDialogData {
    readonly units: readonly CBTForceUnit[];
    readonly atPhaseEnd?: boolean;
    readonly manualResolution?: boolean;
    readonly applyResolved: (
        entries: readonly PendingCheckReviewEntry[],
        forcedPsrFailures: ReadonlySet<string>,
    ) => void;
}

@Component({
    selector: 'pending-unit-check-dialog',
    standalone: true,
    imports: [PendingUnitCheckRowComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
            <div class="header unit-check-dialog-header">
                @if (showRollAll()) {
                    <button
                        type="button"
                        class="random-button unit-check-roll-all"
                        [disabled]="isAnyRolling()"
                        aria-label="Roll all checks"
                        title="Roll all checks"
                        (click)="rollAll()">
                    </button>
                }
                <span>{{ checkTitle() }}</span>
                @if (commonUnitName(); as unitName) {
                    <span>{{ unitName }}</span>
                }
            </div>
            <div class="body unit-check-dialog-body">
                <div class="unit-check-list">
                    @for (entry of entries(); track entryKey(entry)) {
                        <pending-unit-check-row
                            [entry]="entry"
                            [showUnitName]="commonUnitName() === null"
                            [forcedPsrFailure]="forcedPsrFailures().has(entryKey(entry))" />
                    }
                </div>
            </div>
            <div class="actions unit-check-dialog-actions">
                <button type="button" class="bt-button primary" [disabled]="!allResolved()" (click)="apply()">APPLY</button>
                <button type="button" class="bt-button" (click)="close()">CLOSE</button>
            </div>
        </div>
    `,
    styleUrls: [
        '../page-viewer/overlay/page-psr-warning-panel.component.scss',
        './pending-unit-check-dialog.component.scss',
    ],
})
export class PendingUnitCheckDialogComponent {
    readonly data = inject<PendingUnitCheckDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
    readonly rows = viewChildren(PendingUnitCheckRowComponent);
    readonly entries = computed<readonly PendingCheckReviewEntry[]>(() =>
        pendingCheckReviewGroupList(this.data.units, this.data.atPhaseEnd, this.data.manualResolution));
    readonly commonUnitName = computed(() => {
        const entries = this.entries();
        const firstUnit = entries[0]?.unit;
        return firstUnit && entries.every(entry => entry.unit.id === firstUnit.id)
            ? firstUnit.getNotificationDisplayName()
            : null;
    });
    readonly forcedPsrFailures = computed<ReadonlySet<string>>(() => {
        const failedControllers = new Set<string>();
        const failedFallChecks = new Set<string>();
        const forced = new Set<string>();

        for (const entry of this.entries()) {
            if (isPendingUnitCheckEntry(entry)) {
                if (isConsciousnessCheck(entry.check)
                    && pendingUnitCheckOutcome(
                        entry.unit.turnState().getPendingUnitCheck(entry.check.id) ?? entry.check,
                    ) === 'failed'
                    && entry.unit.rules.getActivePilotCrewId() === entry.check.crewId) {
                    failedControllers.add(entry.unit.id);
                }
                continue;
            }

            const entryKey = pendingCheckReviewEntryKey(entry);
            const checkId = entry.check.id;
            const isForced = failedControllers.has(entry.unit.id)
                || entry.unit.turnState().isPSRCheckAutomaticFailure(entry.check)
                || (entry.unit.turnState().autoFall() && isFallPSRCheck(entry.check))
                || (failedFallChecks.has(entry.unit.id) && isFallPSRCheck(entry.check));
            if (isForced) forced.add(entryKey);
            const outcome = isForced
                ? 'failed'
                : pendingPsrCommittedOutcome(entry.unit, entry.check)
                    ?? (checkId ? entry.unit.psrOutcomeSelections()[checkId] : undefined);
            if (outcome === 'failed' && isFallPSRCheck(entry.check)) {
                failedFallChecks.add(entry.unit.id);
            }
        }
        return forced;
    });
    readonly checkTitle = computed(() => {
        const entries = this.entries();
        const unitChecks = entries.flatMap(entry => isPendingUnitCheckEntry(entry) ? [entry.check] : []);
        if (unitChecks.length === entries.length && unitChecks.length > 0) {
            const title = pendingUnitCheckDialogTitle(unitChecks[0]);
            if (title && unitChecks.every(check => pendingUnitCheckDialogTitle(check) === title)) return title;
        }
        if (entries.length > 0 && entries.every(entry => !isPendingUnitCheckEntry(entry))) {
            return 'Piloting Skill Rolls';
        }
        return 'Resolve Pending Checks';
    });
    readonly allResolved = computed(() => this.entries().length > 0
        && this.entries().every(entry => {
            if (isPendingUnitCheckEntry(entry)) {
                return pendingUnitCheckIsResolved(entry.unit, entry.check);
            }
            return this.forcedPsrFailures().has(pendingCheckReviewEntryKey(entry))
                || pendingPsrCommittedOutcome(entry.unit, entry.check) !== undefined
                || (!!entry.check.id && entry.unit.psrOutcomeSelections()[entry.check.id] !== undefined);
        }));
    readonly rollableRows = computed(() => this.rows().filter(row => row.isPresent() && !row.isAutomatic()));
    readonly showRollAll = computed(() => this.rollableRows().length > 1);
    readonly isAnyRolling = computed(() => this.rollableRows().some(row => row.isRolling()));

    rollAll(): void {
        if (this.isAnyRolling()) return;
        this.rollableRows().forEach(row => row.roll());
    }

    apply(): void {
        const entries = this.entries();
        if (!entries.length || !this.allResolved()) return;
        this.data.applyResolved(entries, this.forcedPsrFailures());
        if (this.entries().length === 0) this.dialogRef.close(true);
    }

    close(): void {
        this.dialogRef.close(false);
    }

    entryKey(entry: PendingCheckReviewEntry): string {
        return pendingCheckReviewEntryKey(entry);
    }
}
