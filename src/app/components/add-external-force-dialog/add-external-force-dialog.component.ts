// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, type ElementRef, type Type, computed, inject, signal, viewChild } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';



@Component({
    selector: 'add-external-force-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgComponentOutlet],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">Add Force</h2>
        <div class="wide-dialog-body">
            <p class="message">Enter the Force Instance ID or a MekBay URL.</p>
            <div class="form-fields">
                <div class="input-row">
                    <input
                        #inputRef
                        class="field-input"
                        type="text"
                        [value]="inputValue()"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        (keydown.enter)="$event.preventDefault(); $event.stopPropagation(); submit()"
                        (input)="onInputChange($event)"
                        required
                    />
                    <button
                        type="button"
                        class="bt-button square scan-btn"
                        aria-label="Scan QR code"
                        title="Scan QR code"
                        [disabled]="scanPending()"
                        [class.active]="scannerOpen()"
                        (click)="toggleScanner()"
                    >
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M4,4h6v6H4V4M20,4v6H14V4h6M14,15h2V13H14V11h2v2h2V11h2v2H18v2h2v3H18v2H16V18H13v2H11V16h3V15m2,0v3h2V15H16M4,20V14h6v6H4M6,6V8H8V6H6M16,6V8h2V6H16M6,16v2H8V16H6M4,11H6v2H4V11m5,0h4v4H11V13H9V11m2-5h2v4H11V6M2,2V6H0V2A2,2,0,0,1,2,0H6V2H2M22,0a2,2,0,0,1,2,2V6H22V2H18V0h4M2,18v4H6v2H2a2,2,0,0,1-2-2V18H2m20,4V18h2v4a2,2,0,0,1-2,2H18V22Z" fill="currentColor"/>
                        </svg>
                    </button>
                </div>
                @if (scannerOpen() && scannerComponent()) {
                    <div class="scanner-inline">
                        <ng-container *ngComponentOutlet="scannerComponent(); inputs: scannerInputs"></ng-container>
                    </div>
                }
                <p class="hint">You can paste an Instance ID or a full MekBay URL containing one. To directly add one of your own forces, use the DEPLOY button in the Load dialog instead.</p>
                @if (scanError()) {
                    <p class="hint error">{{ scanError() }}</p>
                }
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button class="bt-button" [disabled]="!canSubmit()" (click)="submit()">CONFIRM</button>
            <button class="bt-button" (click)="dismiss()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .message {
            margin: 0;
            font-size: 0.95em;
            color: var(--text-color-secondary);
        }

        .form-fields {
            align-items: stretch;
        }

        .input-row {
            display: flex;
            gap: 12px;
            align-items: stretch;
        }

        .field-input {
            flex: 1 1 auto;
            min-width: 0;
        }

        .scan-btn svg {
            width: 26px;
            height: 26px;
        }

        .scan-btn.active {
            color: var(--bt-yellow);
        }

        .scanner-inline {
            width: 100%;
            margin-top: 10px;
        }

        .hint {
            font-size: 0.85em;
            color: var(--text-color-tertiary);
            margin-top: 2px;
        }

        .hint.error {
            color: rgb(var(--enemy-color));
        }

        @media (max-width: 640px) {
            .input-row {
                gap: 8px;
            }
        }
    `]
})
export class AddExternalForceDialogComponent {
    inputRef = viewChild<ElementRef<HTMLInputElement>>('inputRef');

    private dialogRef = inject(DialogRef<string | null>);

    inputValue = signal('');
    scannerOpen = signal(false);
    scannerComponent = signal<Type<unknown> | null>(null);
    scanPending = signal(false);
    scanError = signal<string | null>(null);
    canSubmit = computed(() => this.inputValue().trim().length > 0);
    scannerInputs = {
        onScan: (value: string) => this.applyScannedValue(value),
    };

    onInputChange(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.inputValue.set(value);
    }

    async toggleScanner(): Promise<void> {
        if (this.scannerOpen()) {
            this.scannerOpen.set(false);
            this.scanError.set(null);
            return;
        }

        this.scanPending.set(true);
        this.scanError.set(null);

        try {
            if (!this.scannerComponent()) {
                const { QrScannerInlineComponent } = await import('../qr-scanner-dialog/qr-scanner-dialog.component');
                this.scannerComponent.set(QrScannerInlineComponent);
            }

            this.scannerOpen.set(true);
        } catch (error) {
            this.scanError.set(error instanceof Error ? error.message : 'Scanner could not be opened.');
        } finally {
            this.scanPending.set(false);
        }
    }

    submit(): void {
        const value = this.inputValue().trim();
        if (!value) return;
        this.dialogRef.close(value);
    }

    dismiss(): void {
        this.dialogRef.close(null);
    }

    private focusInput(): void {
        const input = this.inputRef()?.nativeElement;
        if (!input) return;

        input.focus();
        input.select();
    }

    private applyScannedValue(value: string): void {
        const scannedValue = value.trim();
        if (!scannedValue) return;

        this.inputValue.set(scannedValue);
        this.scannerOpen.set(false);
        this.scanError.set(null);
        this.focusInput();
    }
}