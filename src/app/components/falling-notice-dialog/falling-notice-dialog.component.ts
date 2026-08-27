// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

export interface FallingNoticeOrientation {
    readonly facingInstruction: string;
    readonly rulesExplanation: string;
}

export interface FallingNoticeDialogData {
    readonly unitName: string;
    readonly orientation: FallingNoticeOrientation;
}

@Component({
    selector: 'falling-notice-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass',
    },
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
