// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { ToastService } from '../../services/toast.service';

/** Following another player's design. Its creator is listed with the sources; updates come from `custom-unit-update`. */
@Component({
    selector: 'custom-unit-actions',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `@if (unit().isCustom && !sync.library.isOwned(unit().uuid)) {
        <button type="button" class="modal-btn bt-button" [disabled]="busy()" (click)="toggleSubscription()">{{ record()?.subscribed ? 'Unsubscribe' : 'Subscribe' }}</button>
    }`,
    styles: `
        :host { display: contents; }
        .modal-btn { width: auto; padding: 8px 16px; text-transform: uppercase; }
    `,
})
export class CustomUnitActionsComponent {
    readonly unit = input.required<UnitSummary>();
    readonly sync = inject(CustomUnitSyncService);
    private readonly toast = inject(ToastService);
    readonly busy = signal(false);
    readonly record = computed(() => this.sync.library.records().find(r => r.uuid === this.unit().uuid));
    async toggleSubscription(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try {
            if (this.record()?.subscribed) await this.sync.unsubscribe(this.unit().uuid);
            else await this.sync.subscribe(this.unit().uuid);
        } catch (error) {
            this.toast.showToast(error instanceof Error ? error.message : 'Custom unit action failed.', 'error');
        } finally {
            this.busy.set(false);
        }
    }
}
