// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

import type {
    AutomationReviewDialogData,
    AutomationReviewResult,
} from '../../models/automation-review.model';

type ReviewAction = Readonly<{
    kind: 'accept-all' | 'skip-all' | 'apply-choices';
    label: string;
    tone: 'primary' | 'success' | 'danger';
    disabled: boolean;
}>;

@Component({
    selector: 'automation-review-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './automation-review-dialog.component.html',
    styleUrl: './automation-review-dialog.component.scss',
})
export class AutomationReviewDialogComponent {
    readonly data = inject<AutomationReviewDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<AutomationReviewResult | undefined>>(DialogRef);
    private readonly decisions = signal<ReadonlyMap<string, boolean>>(new Map());

    readonly allDecided = computed(() => this.decisions().size === this.data.events.length);
    readonly reviewAction = computed<ReviewAction>(() => {
        const rejected = this.data.events.filter(event => this.decisions().get(event.id) === false).length;
        if (rejected === 0) {
            return { kind: 'accept-all', label: 'ACCEPT ALL', tone: 'success', disabled: false };
        }
        if (rejected === this.data.events.length) {
            return { kind: 'skip-all', label: 'SKIP ALL', tone: 'danger', disabled: false };
        }
        return {
            kind: 'apply-choices',
            label: 'APPLY CHOICES',
            tone: 'primary',
            disabled: !this.allDecided(),
        };
    });

    decision(eventId: string): boolean | undefined {
        return this.decisions().get(eventId);
    }

    signed(value: number): string {
        return value > 0 ? `+${value}` : String(value);
    }

    choose(eventId: string, accepted: boolean): void {
        this.decisions.set(new Map(this.decisions()).set(eventId, accepted));
    }

    performReviewAction(): void {
        const action = this.reviewAction();
        if (action.disabled) return;
        if (action.kind === 'accept-all') {
            this.close(this.data.events.map(event => event.id));
            return;
        }
        this.applyChoices();
    }

    applyChoices(): void {
        if (!this.allDecided()) return;
        this.close(this.data.events
            .filter(event => this.decisions().get(event.id) === true)
            .map(event => event.id));
    }

    resolveSingle(accepted: boolean): void {
        if (this.data.events.length !== 1) return;
        this.close(accepted ? [this.data.events[0].id] : []);
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }

    private close(acceptedEventIds: string[]): void {
        this.dialogRef.close({ acceptedEventIds });
    }
}
