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

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { AvailableAuthProvider, OAuthProvider } from '../../models/account-auth.model';

/*
 * Author: Drake
 */

export interface OAuthProviderPickerDialogData {
    title: string;
    message: string;
    providers: AvailableAuthProvider[];
}

export type OAuthProviderPickerDialogResult = OAuthProvider | 'dismiss';

@Component({
    selector: 'oauth-provider-picker-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2>{{ data.title }}</h2>
        <p class="subtitle">{{ data.message }}</p>

        <div class="provider-actions">
            @for (provider of data.providers; track provider.provider) {
            <button class="bt-button provider-action-button provider-login-button" [attr.data-provider]="provider.provider"
                (click)="pick(provider.provider)">
                <span class="provider-action-content">
                    <span class="provider-icon-frame">
                        <img class="provider-icon" [src]="'/images/' + provider.provider + '.svg'" alt="" aria-hidden="true" />
                    </span>
                    <span class="provider-action-label">Sign in with {{ provider.label }}</span>
                </span>
            </button>
            }
        </div>

        <div class="dialog-actions">
            <button class="bt-button" (click)="dismiss()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .content {
            display: block;
            width: min(460px, calc(100dvw - 32px));
            max-width: 460px;
        }

        h2 {
            margin: 8px 0 10px;
            text-align: center;
        }

        .subtitle {
            margin: 0 0 18px;
            color: var(--text-color-secondary);
            text-align: center;
            line-height: 1.45;
        }

        .provider-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            align-items: stretch;
            gap: 0.75rem;
        }

        .provider-action-button {
            width: 100%;
            min-height: 46px;
            min-width: 0;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            background-image: none;
            box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
            color: var(--text-color);
            overflow: hidden;
        }

        .provider-action-button:hover:not(:disabled),
        .provider-action-button:focus-visible:not(:disabled) {
            background-image: none;
        }

        .provider-actions > .provider-action-button:last-child:nth-child(odd):not(:first-child) {
            grid-column: 1 / -1;
            width: min(100%, calc((100% - 0.75rem) / 2));
            justify-self: center;
        }

        .provider-action-content {
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            gap: 0.75rem;
            width: 100%;
            min-width: 0;
            padding: 0 16px;
        }

        .provider-action-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            text-align: left;
            font-size: 0.95rem;
            font-weight: 600;
        }

        .provider-icon-frame {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border: none;
            border-radius: 0;
            background: transparent;
            flex-shrink: 0;
        }

        .provider-icon {
            display: block;
            width: 18px;
            height: 18px;
        }

        .provider-action-button[data-provider="google"] {
            border-color: #dadce0;
            background: #ffffff;
            color: #1f1f1f;
        }

        .provider-action-button[data-provider="google"]:hover:not(:disabled),
        .provider-action-button[data-provider="google"]:focus-visible:not(:disabled) {
            border-color: #c7cdd3;
            background: #f8fafd;
            color: #1f1f1f;
        }

        .provider-action-button[data-provider="google"]:focus-visible {
            outline: 2px solid #4285f4;
            outline-offset: 2px;
        }

        .provider-action-button[data-provider="apple"] {
            border-color: #2c2c2c;
            background: #000000;
            color: #ffffff;
        }

        .provider-action-button[data-provider="apple"]:hover:not(:disabled),
        .provider-action-button[data-provider="apple"]:focus-visible:not(:disabled) {
            border-color: #3a3a3a;
            background: #161616;
            color: #ffffff;
        }

        .provider-action-button[data-provider="apple"]:focus-visible {
            outline: 2px solid rgba(255, 255, 255, 0.7);
            outline-offset: 2px;
        }

        .provider-action-button[data-provider="discord"] {
            border-color: #6f79f7;
            background: #5865f2;
            color: #ffffff;
        }

        .provider-action-button[data-provider="discord"]:hover:not(:disabled),
        .provider-action-button[data-provider="discord"]:focus-visible:not(:disabled) {
            border-color: #7b84fb;
            background: #4752c4;
            color: #ffffff;
        }

        .provider-action-button[data-provider="discord"]:focus-visible {
            outline: 2px solid rgba(111, 121, 247, 0.75);
            outline-offset: 2px;
        }

        .dialog-actions {
            display: flex;
            justify-content: center;
            margin-top: 16px;
        }

        .dialog-actions .bt-button {
            min-width: 120px;
            padding: 8px 14px;
        }

        @media (max-width: 520px) {
            .provider-actions {
                grid-template-columns: 1fr;
            }

            .provider-actions > .provider-action-button:last-child:nth-child(odd):not(:first-child) {
                grid-column: auto;
                width: 100%;
                justify-self: stretch;
            }
        }
    `]
})
export class OAuthProviderPickerDialogComponent {
    private dialogRef = inject(DialogRef<OAuthProviderPickerDialogResult, OAuthProviderPickerDialogComponent>);
    readonly data = inject<OAuthProviderPickerDialogData>(DIALOG_DATA);

    pick(provider: OAuthProvider) {
        this.dialogRef.close(provider);
    }

    dismiss() {
        this.dialogRef.close('dismiss');
    }
}