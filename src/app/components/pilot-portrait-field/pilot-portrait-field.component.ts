// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, DestroyRef, inject, model } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DialogsService } from '../../services/dialogs.service';
import { CrewPortraitComponent } from '../crew-portrait/crew-portrait.component';

@Component({
    selector: 'pilot-portrait-field',
    imports: [CrewPortraitComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button type="button" class="bt-button portrait-field" (click)="select($event)" aria-haspopup="dialog"
            [attr.aria-label]="value() ? 'Change or remove portrait' : 'Select portrait'"
            [title]="value() ? 'Change or remove portrait' : 'Select portrait'">
            @if (value()) {
                <crew-portrait [name]="value()" [width]="88" />
            } @else {
                <svg class="portrait-placeholder" width="88" height="110" viewBox="0 0 256 320"
                    fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true" focusable="false">
                    <path d="M128 8C82 8 54 39 54 83L57 121
                        C49 116 45 124 47 137C48 149 52 157 59 158
                        C63 180 75 196 87 206L86 224
                        C69 236 43 242 24 253L2 267V318H254V267L232 253
                        C213 242 187 236 170 224L169 206C181 196 193 180 197 158
                        C204 157 208 149 209 137C211 124 207 116 199 121
                        L202 83C202 39 174 8 128 8Z"
                        fill="currentColor" fill-opacity=".05" stroke-width="4"
                        pathLength="100" stroke-dasharray="1 1" stroke-dashoffset=".5" />
                    <path d="M106 160h44M128 138v44" stroke-width="7" />
                </svg>
                <span>PORTRAIT</span>
            }
        </button>
    `,
    styles: `
        :host { display: block; flex: 0 0 auto; }
        .portrait-field { flex-direction: column; width: 100%; height: 100%; gap: 6px; padding: 5px; }
        .portrait-placeholder { display: block; flex-shrink: 0; }
        .portrait-field span { font-size: 10px; letter-spacing: .05em; }
    `,
})
export class PilotPortraitFieldComponent {
    readonly value = model<string>();
    private readonly dialogs = inject(DialogsService);
    private readonly destroyRef = inject(DestroyRef);

    async select(event: Event): Promise<void> {
        const trigger = event.currentTarget as HTMLButtonElement;
        const { PortraitPickerDialogComponent } = await import('../portrait-picker-dialog/portrait-picker-dialog.component');
        if (this.destroyRef.destroyed) return;
        const result = await firstValueFrom(this.dialogs.createDialog<string | null>(PortraitPickerDialogComponent, {
            data: { portrait: this.value() }, autoFocus: '[role="tab"][aria-selected="true"]',
        }).closed);
        if (this.destroyRef.destroyed) return;
        if (result !== undefined) this.value.set(result ?? undefined);
        trigger.focus();
    }
}
