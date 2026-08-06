// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Options } from '../../models/options.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { type ForceAddModePickerData, ForceAddModePickerDialogComponent, type ForceAddModePickerResult } from '../force-add-mode-picker-dialog/force-add-mode-picker-dialog.component';
import { firstValueFrom } from 'rxjs';
import { DialogsService } from '../../services/dialogs.service';
import { ForcePreviewPanelComponent } from '../force-preview-panel/force-preview-panel.component';

export interface ForceEntryPreviewDialogData {
    force: LoadForceEntry;
    unitDisplayNameOverride?: Options['unitDisplayName'];
}

/**
 * 
 * Dialog component that shows a detailed preview of a force entry, including its name, faction icon,
 * and other relevant details.
 */
@Component({
    selector: 'force-entry-preview-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ForcePreviewPanelComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './force-entry-preview-dialog.component.html',
    styleUrls: ['./force-entry-preview-dialog.component.scss']
})
export class ForceEntryPreviewDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    private data: ForceEntryPreviewDialogData = inject(DIALOG_DATA);
    private dialogsService = inject(DialogsService);
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    readonly displayMode = this.data.unitDisplayNameOverride ?? null;
    force: LoadForceEntry;

    isForceLoaded = signal(false);
    canLoadForce = computed(() => !this.isForceLoaded() && this.force.owned);

    constructor() {
        this.force = this.data.force;
        this.isForceLoaded.set(
            this.forceBuilderService.loadedForces().some(s => s.force.instanceId() === this.force.instanceId)
        );
    }

    async onLoad(): Promise<void> {
        const loaded = await this.forceBuilderService.loadForceEntry(this.force, 'load');
        if (loaded) this.close();
    }

    async onAdd(): Promise<void> {
        const currentForce = this.forceBuilderService.smartCurrentForce();
        const showInsert = !!currentForce && currentForce.owned();
        const ref = this.dialogsService.createDialog<ForceAddModePickerResult>(
            ForceAddModePickerDialogComponent,
            {
                data: {
                    showInsert,
                    currentForceName: currentForce?.name,
                } as ForceAddModePickerData
            }
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;
        if (result === 'insert') {
            const inserted = await this.forceBuilderService.loadForceEntry(this.force, 'insert');
            if (inserted) {
                this.toastService.showToast(`"${this.force.name}" inserted into "${currentForce!.name}".`, 'success');
                this.close();
            }
        } else {
            const added = await this.forceBuilderService.loadForceEntry(this.force, 'add', result, { activate: false });
            if (added) {
                this.isForceLoaded.set(true);
                this.toastService.showToast(`"${this.force.name}" added to loaded forces.`, 'success');
                this.close();
            }
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}
