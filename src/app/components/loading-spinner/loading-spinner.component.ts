// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
    selector: 'loading-spinner',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="spinner" role="status" [attr.aria-label]="ariaLabel()">
            <div class="ring"></div>
        </div>
        @if (message()) {
            <div class="spinner-message">{{ message() }}</div>
        }
    `,
    styles: [`
        :host {
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 16px;
            color: var(--text-color-secondary);
        }

        .spinner {
            width: var(--loading-spinner-size, 44px);
            height: var(--loading-spinner-size, 44px);
            position: relative;
            display: inline-block;
        }

        .ring {
            box-sizing: border-box;
            position: absolute;
            width: 100%;
            height: 100%;
            border-top: var(--loading-spinner-border-width, 5px) solid #BFC1C2;
            border-right: var(--loading-spinner-border-width, 5px) solid #A00000;
            border-bottom: var(--loading-spinner-border-width, 5px) solid #2357c6;
            border-left: var(--loading-spinner-border-width, 5px) solid #2357c6;
            border-radius: 50%;
            animation: spin 1.1s cubic-bezier(0.77, 0, 0.175, 1) infinite;
        }

        .spinner-message {
            text-align: center;
        }

        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }

            100% {
                transform: rotate(360deg);
            }
        }
    `]
})
export class LoadingSpinnerComponent {
    message = input<string | null>(null);
    ariaLabel = input('Loading');
}