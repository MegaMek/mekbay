// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { AutomationReviewDialogData, AutomationReviewResult } from '../../models/automation-review.model';

interface ReviewActionData {
    kind: 'accept-all' | 'skip-all' | 'apply-choices',
    label: string,
    tone: 'primary' | 'success' | 'danger' | 'muted' | undefined;
    disabled: boolean;
}

@Component({
    selector: 'automation-review-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './automation-review-dialog.component.html',
    styleUrls: [
        '../page-viewer/overlay/page-psr-warning-panel.component.scss',
        './automation-review-dialog.component.scss',
    ],
})
export class AutomationReviewDialogComponent {
    readonly data = inject<AutomationReviewDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<AutomationReviewResult | undefined, AutomationReviewDialogComponent>>(DialogRef);
    private readonly decisions = signal<ReadonlyMap<string, boolean>>(new Map());

    readonly allDecided = computed(() => this.decisions().size === this.data.events.length);
    readonly reviewAction = computed<ReviewActionData>(() => {
        const decisions = this.decisions();
        const rejectedCount = this.data.events.reduce(
            (count, event) => count + (decisions.get(event.id) === false ? 1 : 0),
            0,
        );

        if (rejectedCount === 0) {
            return { kind: 'accept-all', label: 'ACCEPT ALL', tone: 'success', disabled: false } as const;
        }
        if (rejectedCount === this.data.events.length) {
            return { kind: 'skip-all', label: 'SKIP ALL', tone: 'danger', disabled: false } as const;
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
        const next = new Map(this.decisions());
        next.set(eventId, accepted);
        this.decisions.set(next);
    }

    acceptAll(): void {
        this.closeWithAccepted(this.data.events.map(event => event.id));
    }

    performReviewAction(): void {
        const action = this.reviewAction();
        if (action.disabled) return;
        if (action.kind === 'accept-all') {
            this.acceptAll();
            return;
        }
        this.applyChoices();
    }

    applyChoices(): void {
        if (!this.allDecided()) return;
        const acceptedEventIds = this.data.events
            .filter(event => this.decisions().get(event.id) === true)
            .map(event => event.id);
        this.closeWithAccepted(acceptedEventIds);
    }

    resolveSingle(accepted: boolean): void {
        if (this.data.events.length !== 1) return;
        this.closeWithAccepted(accepted ? [this.data.events[0].id] : []);
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }

    private closeWithAccepted(acceptedEventIds: string[]): void {
        this.dialogRef.close({ acceptedEventIds });
    }
}
