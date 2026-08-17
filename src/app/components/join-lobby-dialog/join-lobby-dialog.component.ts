// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DisplayNameService } from '../../services/display-name.service';
import { MAX_DISPLAY_NAME_LENGTH, normalizeDisplayName } from '../../utils/display-name.util';

export interface JoinLobbyDialogData {
    displayName: string;
    attemptJoin: (code: string, displayName: string) => Promise<void>;
}

@Component({
    selector: 'join-lobby-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <div class="wide-dialog join-lobby-dialog">
            <h2 class="wide-dialog-title">Join Operation Lobby</h2>
            <div class="wide-dialog-body">
                <p class="message">
                    Join a shared operation to see its participants and forces in real time. You can join as a spectator without loading a force.
                </p>
                <div class="join-fields">
                    <div class="form-fields code-field">
                        <label for="joinLobbyCode">Lobby Code</label>
                        <input
                            id="joinLobbyCode"
                            class="field-input"
                            type="text"
                            inputmode="text"
                            autocomplete="off"
                            autocapitalize="none"
                            spellcheck="false"
                            maxlength="4"
                            placeholder="code"
                            [disabled]="joining()"
                            [value]="code()"
                            (input)="onCodeInput($event)"
                            (keydown.enter)="submit($event)"
                        />
                        <span class="hint">Provided by the host</span>
                    </div>
                    <div class="form-fields name-field">
                        <label for="joinLobbyDisplayName">Display Name</label>
                        <div class="input-wrapper">
                            <input
                                id="joinLobbyDisplayName"
                                class="field-input"
                                type="text"
                                autocomplete="nickname"
                                [attr.maxlength]="maximumNameLength"
                                [disabled]="joining()"
                                [value]="displayName()"
                                (input)="onNameInput($event)"
                                (keydown.enter)="submit($event)"
                            />
                            <button
                                class="random-button"
                                type="button"
                                title="Generate random callsign"
                                aria-label="Generate random callsign"
                                [disabled]="generatingName() || joining()"
                                (click)="fillRandomName()"
                            ></button>
                        </div>
                        <span class="hint">Shown to the other lobby participants</span>
                    </div>
                </div>
                @if (joinError()) {
                    <div class="join-error" role="alert">{{ joinError() }}</div>
                }
            </div>
            <div class="wide-dialog-actions">
                <button class="bt-button" type="button" [disabled]="joining() || !isValid()" (click)="submit()">
                    {{ joining() ? 'JOINING...' : 'JOIN' }}
                </button>
                <button class="bt-button" type="button" [disabled]="joining()" (click)="close()">CANCEL</button>
            </div>
        </div>
    `,
    styles: [`
        .message {
            margin: 0;
            color: var(--text-color-secondary);
            font-size: 0.95em;
            text-align: center;
        }

        .join-fields {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 1rem;
            width: 100%;
        }

        .form-fields {
            align-items: center;
            width: min(18rem, 100%);
        }

        .field-input,
        .input-wrapper {
            width: 100%;
        }

        .field-input {
            text-align: center;
        }

        .name-field .field-input {
            padding-right: 36px;
        }

        .name-field .random-button {
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
        }

        .code-field .field-input {
            width: 9rem;
            flex: 0 0 auto;
            font-family: monospace;
            font-size: 1.4rem;
            font-weight: 700;
            text-transform: lowercase;
        }

        .hint {
            margin: 0;
            color: var(--text-color-tertiary);
            font-size: 0.8em;
            text-align: center;
        }

        .join-error {
            color: var(--danger);
            font-size: 0.9em;
            text-align: center;
        }

        @media (max-width: 620px) {
            .join-fields {
                flex-direction: column;
            }
        }
    `],
})
export class JoinLobbyDialogComponent {
    private readonly dialogRef = inject(DialogRef<boolean | null>);
    private readonly data: JoinLobbyDialogData = inject(DIALOG_DATA);
    private readonly displayNameService = inject(DisplayNameService);

    readonly maximumNameLength = MAX_DISPLAY_NAME_LENGTH;
    readonly code = signal('');
    readonly displayName = signal(this.data.displayName);
    readonly generatingName = signal(false);
    readonly joining = signal(false);
    readonly joinError = signal('');
    readonly isValid = computed(() => /^[a-z0-9]{4}$/.test(this.code()) && normalizeDisplayName(this.displayName()) !== null);

    onCodeInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const value = input.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
        input.value = value;
        this.code.set(value);
        this.joinError.set('');
    }

    onNameInput(event: Event): void {
        this.displayName.set((event.target as HTMLInputElement).value);
        this.joinError.set('');
    }

    async fillRandomName(): Promise<void> {
        if (this.generatingName() || this.joining()) return;
        this.generatingName.set(true);
        try {
            this.displayName.set(await this.displayNameService.generate());
            this.joinError.set('');
        } finally {
            this.generatingName.set(false);
        }
    }

    async submit(event?: Event): Promise<void> {
        event?.preventDefault();
        event?.stopPropagation();
        if (this.joining()) return;
        const displayName = normalizeDisplayName(this.displayName());
        if (!displayName || !/^[a-z0-9]{4}$/.test(this.code())) return;

        this.joining.set(true);
        this.joinError.set('');
        try {
            await this.data.attemptJoin(this.code(), displayName);
            this.dialogRef.close(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            this.joinError.set(message || 'Could not join the lobby.');
        } finally {
            this.joining.set(false);
        }
    }

    close(): void {
        if (this.joining()) return;
        this.dialogRef.close(null);
    }
}
