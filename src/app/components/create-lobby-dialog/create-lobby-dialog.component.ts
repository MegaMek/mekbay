// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DisplayNameService } from '../../services/display-name.service';
import { MAX_DISPLAY_NAME_LENGTH, normalizeDisplayName } from '../../utils/display-name.util';

export interface CreateLobbyDialogData {
    displayName: string;
}

@Component({
    selector: 'create-lobby-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <div class="wide-dialog create-lobby-dialog">
            <h2 class="wide-dialog-title">Create Operation Lobby</h2>
            <div class="wide-dialog-body">
                <p class="message">Choose the name other lobby participants will see.</p>
                <div class="form-fields">
                    <label for="createLobbyDisplayName">Display Name</label>
                    <div class="input-wrapper">
                        <input
                            id="createLobbyDisplayName"
                            class="field-input"
                            type="text"
                            autocomplete="nickname"
                            [attr.maxlength]="maximumNameLength"
                            [value]="displayName()"
                            (input)="onNameInput($event)"
                            (keydown.enter)="submit($event)"
                        />
                        <button
                            class="random-button"
                            type="button"
                            title="Generate random callsign"
                            aria-label="Generate random callsign"
                            [disabled]="generatingName()"
                            (click)="fillRandomName()"
                        ></button>
                    </div>
                    <span class="hint">You can change this later in Account.</span>
                </div>
            </div>
            <div class="wide-dialog-actions">
                <button class="bt-button" type="button" [disabled]="!isValid()" (click)="submit()">CREATE</button>
                <button class="bt-button" type="button" (click)="close()">CANCEL</button>
            </div>
        </div>
    `,
    styles: [`
        .create-lobby-dialog {
            width: min(30rem, calc(100dvw - 2rem));
        }

        .message {
            margin: 0;
            color: var(--text-color-secondary);
            font-size: 0.95em;
            text-align: center;
        }

        .form-fields {
            align-items: center;
            width: min(18rem, 100%);
            margin-inline: auto;
        }

        .input-wrapper,
        .field-input {
            width: 100%;
        }

        .field-input {
            text-align: center;
        }

        .hint {
            color: var(--text-color-tertiary);
            font-size: 0.8em;
            text-align: center;
        }
    `],
})
export class CreateLobbyDialogComponent {
    private readonly dialogRef = inject(DialogRef<string | null>);
    private readonly data: CreateLobbyDialogData = inject(DIALOG_DATA);
    private readonly displayNameService = inject(DisplayNameService);

    readonly maximumNameLength = MAX_DISPLAY_NAME_LENGTH;
    readonly displayName = signal(this.data.displayName);
    readonly generatingName = signal(false);
    readonly isValid = computed(() => normalizeDisplayName(this.displayName()) !== null);

    onNameInput(event: Event): void {
        this.displayName.set((event.target as HTMLInputElement).value);
    }

    async fillRandomName(): Promise<void> {
        if (this.generatingName()) return;
        this.generatingName.set(true);
        try {
            this.displayName.set(await this.displayNameService.generate());
        } finally {
            this.generatingName.set(false);
        }
    }

    submit(event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        const displayName = normalizeDisplayName(this.displayName());
        if (displayName) this.dialogRef.close(displayName);
    }

    close(): void {
        this.dialogRef.close(null);
    }
}


