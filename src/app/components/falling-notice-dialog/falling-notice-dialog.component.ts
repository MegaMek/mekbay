// SPDX-License-Identifier: GPL-3.0-or-later

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import type { MekFallOrientation } from '../../models/runtime/mek-fall-rules';

export interface FallingNoticeDialogData {
    readonly unitName: string;
    readonly orientation: MekFallOrientation;
}

@Component({
    selector: 'falling-notice-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    templateUrl: './falling-notice-dialog.component.html',
    styleUrl: './falling-notice-dialog.component.scss',
})
export class FallingNoticeDialogComponent {
    readonly data = inject<FallingNoticeDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<void>>(DialogRef);

    dismiss(): void {
        this.dialogRef.close();
    }
}
