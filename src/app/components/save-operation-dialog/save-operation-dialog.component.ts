/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { OpPreviewComponent, type OpPreviewForce } from '../op-preview/op-preview.component';

/*
 * Author: Drake
 */

export interface OperationDialogData {
    title: string;
    name: string;
    note: string;
    forces: OpPreviewForce[];
}

export interface OperationDialogResult {
    name: string;
    note?: string;
    forces?: OpPreviewForce[];
}

@Component({
    selector: 'save-operation-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, OpPreviewComponent],
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">{{ data.title }}</h2>
        <div class="wide-dialog-body">
            <div class="form-fields">
                <label class="field-label">Operation Name</label>
                <input
                    type="text"
                    class="field-input"
                    [value]="name()"
                    (input)="onNameChange($event)"
                    autocomplete="off"
                    (keydown.enter)="$event.preventDefault(); submit()"
                    autofocus />
            </div>

            @if (forces().length > 0) {
                <op-preview [(forces)]="forces" [allowDragDrop]="true"></op-preview>
            }

            <div class="form-fields">
                <label class="field-label">Note <span class="optional">(optional)</span></label>
                <textarea
                    class="field-input op-textarea"
                    [value]="note()"
                    (input)="onNoteChange($event)"
                    rows="2"
                    autocomplete="off"
                    placeholder="Add a description..."></textarea>
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button class="bt-button" (click)="submit()" [disabled]="!isValid()">SAVE</button>
            <button class="bt-button" (click)="close()">CANCEL</button>
        </div>
    </div>
    `,
    styles: [`
        .wide-dialog {
            max-width: 800px;
        }

        .op-textarea {
            font-size: 0.9em;
            resize: vertical;
            min-height: 6em;
            max-height: 24em;
        }
    `]
})
export class SaveOperationDialogComponent {
    dialogRef = inject(DialogRef<OperationDialogResult | null>);
    data: OperationDialogData = inject(DIALOG_DATA);

    name = signal(this.data.name || '');
    note = signal(this.data.note || '');
    forces = signal<OpPreviewForce[]>(this.data.forces || []);

    onNameChange(e: Event): void {
        this.name.set((e.target as HTMLInputElement).value);
    }

    onNoteChange(e: Event): void {
        this.note.set((e.target as HTMLTextAreaElement).value);
    }

    isValid(): boolean {
        return this.name().trim().length > 0;
    }

    submit(): void {
        if (!this.isValid()) return;
        this.dialogRef.close({
            name: this.name().trim(),
            note: this.note().trim() || undefined,
            forces: this.forces(),
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }
}
