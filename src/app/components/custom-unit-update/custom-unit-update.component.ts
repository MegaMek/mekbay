// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { CBTForceMember } from '../../models/force-member.model';
import { CustomUnitSyncService } from '../../services/custom-unit-sync.service';
import { DataService } from '../../services/data.service';
import { PlayerNamesService } from '../../services/player-names.service';
import { ToastService } from '../../services/toast.service';
import { ConstructionForceService } from '../../construction/construction-force.service';
import { constructionCanUpdateDesign } from '../../construction/domain/construction-repairs';

/** One line offering a force unit the newer saved version of its custom design. */
@Component({
    selector: 'custom-unit-update',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `@if (updateAvailable()) {
        <section class="design-update framed-borders" aria-label="Design update" role="status">
            <p>
                {{ message() }}
                @if (!canUpdate()) { <span class="blocked">Repair this unit and finish its pending changes to update it.</span> }
            </p>
            <button type="button" class="bt-button" [disabled]="busy() || !canUpdate()" (click)="update()">Update unit</button>
        </section>
    }`,
    styles: `
        .design-update {
            --frame-color: var(--bt-yellow);
            display: flex;
            align-items: center;
            gap: 8px 16px;
            padding: 8px 8px 8px 12px;
            border-color: var(--bt-yellow);
            background-color: var(--bt-yellow-background-transparent);
        }
        p {
            flex: 1;
            margin: 0;
            font-size: 0.9em;
            line-height: 1.4;
        }
        .blocked {
            color: var(--text-color-secondary);
        }
        .bt-button {
            flex: 0 0 auto;
            width: auto;
            padding: 6px 14px;
            text-transform: uppercase;
        }
    `,
})
export class CustomUnitUpdateComponent {
    readonly unit = input.required<UnitSummary>();
    readonly member = input.required<CBTForceMember>();
    private readonly sync = inject(CustomUnitSyncService);
    private readonly data = inject(DataService);
    private readonly playerNames = inject(PlayerNamesService);
    private readonly toast = inject(ToastService);
    private readonly construction = inject(ConstructionForceService);
    readonly busy = signal(false);
    private readonly record = computed(() => this.sync.library.records().find(r => r.uuid === this.unit().uuid));
    /** Follows the member's runtime so the line reacts to damage, repairs and applied updates. */
    private readonly snapshot = computed(() => {
        const member = this.member();
        member.mekRecordSheetSnapshot(); member.nonMekRecordSheetSnapshot();
        return member.force.getUnitSnapshot(member.id);
    });
    readonly updateAvailable = computed(() =>
        this.sync.library.hasUpdate(this.unit().uuid, this.snapshot()?.nativeSource?.sourceHash));
    readonly canUpdate = computed(() => {
        const snapshot = this.snapshot();
        return !this.member().force.readOnly() && !!snapshot && constructionCanUpdateDesign(snapshot);
    });
    /** Who saved the newer version and when, and how its BV differs from this unit's. */
    readonly message = computed(() => {
        const record = this.record();
        const by = !record ? '' : record.owned !== false ? 'by you'
            : record.ownerId ? `by ${this.playerNames.label(record.ownerId)}` : '';
        const on = record?.updatedAt
            ? `on ${new Date(record.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '';
        // The catalog lists the saved version; the dialog's unit is the force's copy.
        const current = this.unit().bv;
        const saved = this.data.getUnitByUuid(this.unit().uuid)?.bv;
        const bv = saved === undefined || saved === current ? '' : ` (BV ${current.toLocaleString()} → ${saved.toLocaleString()})`;
        return ['A newer version of this design was saved', by, on].filter(Boolean).join(' ') + bv + '.';
    });

    async update(): Promise<void> {
        if (this.busy() || !this.canUpdate() || !this.updateAvailable()) return;
        const member = this.member(), record = this.record();
        if (!record) return;
        this.busy.set(true);
        try {
            const draft = this.sync.library.parseDraft(record.source, record.format);
            const origins = this.construction.captureOrigins(member, draft);
            await this.construction.applySavedConstruction(member, record, draft, origins, undefined, true);
            this.toast.showToast('Unit design updated.', 'success');
        } catch (error) {
            this.toast.showToast(error instanceof Error ? error.message : 'Custom unit update failed.', 'error');
        } finally {
            this.busy.set(false);
        }
    }
}
