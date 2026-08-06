// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { SemanticGuideComponent } from '../semantic-guide/semantic-guide.component';



@Component({
    selector: 'semantic-guide-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BaseDialogComponent, SemanticGuideComponent],
    templateUrl: './semantic-guide-dialog.component.html',
    styleUrls: ['./semantic-guide-dialog.component.css']
})
export class SemanticGuideDialogComponent {
    private dialogRef = inject(DialogRef);

    onClose(): void {
        this.dialogRef.close();
    }
}
