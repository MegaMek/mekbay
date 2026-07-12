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

const OPERATION_NAME_MAX_LENGTH = 100;
const OPERATION_NOTE_MAX_LENGTH = 2000;
const OPERATION_LENGTH_META_THRESHOLD = 0.9;

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
                    [attr.maxlength]="nameLimit"
                    (keydown.enter)="$event.preventDefault(); submit()"
                    autofocus />
                @if (showNameMeta()) {
                <div class="field-meta">
                    <span class="field-limit">Max {{ nameLimit }} characters</span>
                    <span class="field-counter">{{ name().length }}/{{ nameLimit }}</span>
                </div>
                }
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
                    [attr.maxlength]="noteLimit"
                    placeholder="Add a description..."></textarea>
                @if (showNoteMeta()) {
                <div class="field-meta">
                    <span class="field-limit">Max {{ noteLimit }} characters</span>
                    <span class="field-counter">{{ note().length }}/{{ noteLimit }}</span>
                </div>
                }
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

        .field-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            margin-top: 0.35rem;
            font-size: 0.78em;
            opacity: 0.72;
        }

        .field-counter {
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
    `]
})
export class SaveOperationDialogComponent {
    dialogRef = inject(DialogRef<OperationDialogResult | null>);
    data: OperationDialogData = inject(DIALOG_DATA);

    readonly nameLimit = OPERATION_NAME_MAX_LENGTH;
    readonly noteLimit = OPERATION_NOTE_MAX_LENGTH;

    name = signal(this.clampText(this.data.name || '', this.nameLimit));
    note = signal(this.clampText(this.data.note || '', this.noteLimit));
    forces = signal<OpPreviewForce[]>(this.data.forces || []);

    onNameChange(e: Event): void {
        this.name.set(this.clampText((e.target as HTMLInputElement).value, this.nameLimit));
    }

    onNoteChange(e: Event): void {
        this.note.set(this.clampText((e.target as HTMLTextAreaElement).value, this.noteLimit));
    }

    showNameMeta(): boolean {
        return this.shouldShowLengthMeta(this.name().length, this.nameLimit);
    }

    showNoteMeta(): boolean {
        return this.shouldShowLengthMeta(this.note().length, this.noteLimit);
    }

    isValid(): boolean {
        return this.name().trim().length > 0;
    }

    submit(): void {
        const name = this.clampText(this.name().trim(), this.nameLimit);
        const note = this.clampText(this.note().trim(), this.noteLimit);
        if (!this.isValid()) return;
        this.dialogRef.close({
            name,
            note: note || undefined,
            forces: this.forces(),
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }

    private clampText(value: string, maxLength: number): string {
        return value.slice(0, maxLength);
    }

    private shouldShowLengthMeta(currentLength: number, maxLength: number): boolean {
        return currentLength > maxLength * OPERATION_LENGTH_META_THRESHOLD;
    }
}
