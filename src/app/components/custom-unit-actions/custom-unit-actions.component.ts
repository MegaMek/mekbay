// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { CBTForceMember } from '../../models/force-member.model';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { ToastService } from '../../services/toast.service';
import { ConstructionForceService } from '../../construction/construction-force.service';
import { constructionCanUpdateDesign } from '../../construction/domain/construction-repairs';

@Component({
    selector: 'custom-unit-actions',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `@if (unit().isCustom) {
        <div class="actions">
            @if (!sync.library.isOwned(unit().uuid)) {
                <button class="bt-button" [disabled]="busy()" (click)="toggleSubscription()">{{ record()?.subscribed ? 'Unsubscribe' : 'Subscribe' }}</button>
            }
            @if (updateAvailable()) {
                <span class="update-badge">Update available</span>
                <button class="bt-button" [disabled]="busy() || !canUpdate()" (click)="update()">Update design</button>
                @if (!canUpdate()) { <span>Fully repair this unit and finish pending changes to update.</span> }
            }
        </div>
    }`,
    styles: [`.actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:6px 0; font-size:.85rem; } .update-badge { border:1px solid var(--bt-yellow, #dab25a); color:var(--bt-yellow, #dab25a); border-radius:3px; padding:3px 7px; }`],
})
export class CustomUnitActionsComponent {
    readonly unit = input.required<UnitSummary>();
    readonly member = input<CBTForceMember | undefined>();
    readonly sync = inject(CustomUnitSyncService);
    private readonly toast = inject(ToastService);
    private readonly construction = inject(ConstructionForceService);
    readonly busy = signal(false);
    readonly record = computed(() => this.sync.library.records().find(r => r.uuid === this.unit().uuid));
    readonly updateAvailable = computed(() => {
        const member = this.member();
        member?.mekRecordSheetSnapshot(); member?.nonMekRecordSheetSnapshot();
        return !!member && this.sync.library.hasUpdate(
            this.unit().uuid, member.force.getUnitSnapshot(member.id)?.nativeSource?.sourceHash,
        );
    });
    readonly canUpdate = computed(() => {
        const member = this.member();
        if (!member || member.force.readOnly()) return false;
        member.mekRecordSheetSnapshot(); member.nonMekRecordSheetSnapshot();
        const snapshot = member.force.getUnitSnapshot(member.id);
        return !!snapshot && constructionCanUpdateDesign(snapshot);
    });
    async toggleSubscription(): Promise<void> {
        await this.run(async () => {
            if (this.record()?.subscribed) await this.sync.unsubscribe(this.unit().uuid);
            else await this.sync.subscribe(this.unit().uuid);
        });
    }
    async update(): Promise<void> {
        if (!this.canUpdate() || !this.updateAvailable()) return;
        await this.run(async () => {
            const member = this.member()!, record = this.record()!;
            const draft = this.sync.library.parseDraft(record.source, record.format);
            const origins = this.construction.captureOrigins(member, draft);
            await this.construction.applySavedConstruction(member, record, draft, origins, undefined, true);
            this.toast.showToast('Unit design updated.', 'success');
        });
    }
    private async run(action: () => Promise<void>): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try { await action(); } catch (error) { this.toast.showToast(error instanceof Error ? error.message : 'Custom unit action failed.', 'error'); }
        finally { this.busy.set(false); }
    }
}
