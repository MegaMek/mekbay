// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

/** One editable name of a design: the construction field's id, label and current text. */
export interface ConstructionRenameField {
    readonly id: string;
    readonly label: string;
    value: string;
}

/** Edits a design's name fields together; closes with the fields as typed, or nothing when dismissed. */
@Component({
    selector: 'construction-rename-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <form class="wide-dialog construction-rename-dialog" (ngSubmit)="dialogRef.close(fields)">
            <h2 class="wide-dialog-title">Rename Unit</h2>
            <div class="wide-dialog-body">
                @for (field of fields; track field.id) {
                    <label class="form-fields">
                        <span class="field-label">{{ field.label }}</span>
                        <input class="field-input" type="text" autocomplete="off" [name]="field.id" [(ngModel)]="field.value" />
                    </label>
                }
            </div>
            <div class="wide-dialog-actions">
                <button class="bt-button" type="submit">CONFIRM</button>
                <button class="bt-button" type="button" (click)="dialogRef.close()">DISMISS</button>
            </div>
        </form>
    `,
    styles: [`
        .construction-rename-dialog {
            width: min(30rem, 100dvw);
        }
    `],
})
export class ConstructionRenameDialogComponent {
    readonly dialogRef = inject(DialogRef<readonly ConstructionRenameField[]>);
    readonly fields = inject<readonly ConstructionRenameField[]>(DIALOG_DATA).map((field) => ({ ...field }));
}
