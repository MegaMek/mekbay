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