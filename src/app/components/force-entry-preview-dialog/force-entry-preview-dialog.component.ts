// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Options } from '../../models/options.model';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceImportService } from '../../services/force-import.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { type ForceAddModePickerData, ForceAddModePickerDialogComponent, type ForceAddModePickerResult } from '../force-add-mode-picker-dialog/force-add-mode-picker-dialog.component';
import { firstValueFrom } from 'rxjs';
import { DialogsService } from '../../services/dialogs.service';
import { ForcePreviewPanelComponent } from '../force-preview-panel/force-preview-panel.component';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';

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
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ForcePreviewPanelComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './force-entry-preview-dialog.component.html',
    styleUrl: './force-entry-preview-dialog.component.scss'
})
export class ForceEntryPreviewDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    private data: ForceEntryPreviewDialogData = inject(DIALOG_DATA);
    private dialogsService = inject(DialogsService);
    private readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly forceImportService = inject(ForceImportService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    readonly displayMode = this.data.unitDisplayNameOverride ?? null;
    readonly force: LoadForceEntry = this.data.force;

    private loadedForce = computed(() => this.forceWorkspace.loadedForces()
        .find(slot => slot.force.instanceId() === this.force.instanceId)?.force);
    isForceLoaded = computed(() => !!this.loadedForce());
    busy = signal(false);

    async onDeploy(): Promise<void> {
        if (this.busy() || this.isForceLoaded()) return;
        this.busy.set(true);
        try {
            if (this.forceWorkspace.loadedForces().some(slot => slot.persistInUrl !== false)) {
                const ref = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
                    disableClose: true,
                    data: {
                        title: 'Deploy Force',
                        message: 'You already have forces deployed. Would you like to replace them or add this force alongside them?',
                        buttons: [
                            { label: 'REPLACE', value: 'replace' },
                            { label: 'ADD', value: 'add' },
                            { label: 'CANCEL', value: 'cancel' },
                        ],
                    } satisfies ConfirmDialogData<string>,
                });
                const answer = await firstValueFrom(ref.closed);
                if (answer === 'add') {
                    await this.onAdd();
                    return;
                }
                if (answer !== 'replace') return;
            }

            const loaded = await this.forceImportService.loadForceEntry(this.force, 'load');
            if (loaded) this.toastService.showToast(`"${this.force.name}" deployed.`, 'success');
        } finally {
            this.busy.set(false);
        }
    }

    private async onAdd(): Promise<void> {
        const currentForce = this.forceWorkspace.smartCurrentForce();
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
            const inserted = await this.forceImportService.loadForceEntry(this.force, 'insert');
            if (inserted) {
                this.toastService.showToast(`"${this.force.name}" inserted into "${currentForce!.name}".`, 'success');
                this.close();
            }
        } else {
            const added = await this.forceImportService.loadForceEntry(this.force, 'add', result, { activate: false });
            if (added) {
                this.toastService.showToast(`"${this.force.name}" added to loaded forces.`, 'success');
            }
        }
    }

    async onRecall(): Promise<void> {
        const force = this.loadedForce();
        if (this.busy() || !force) return;
        this.busy.set(true);
        try {
            await this.forceBuilderService.removeLoadedForce(force);
            if (!this.isForceLoaded()) {
                this.toastService.showToast(`"${this.force.name}" recalled.`, 'success');
            }
        } finally {
            this.busy.set(false);
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}
