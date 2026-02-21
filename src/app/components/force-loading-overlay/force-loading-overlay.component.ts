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

import { ChangeDetectionStrategy, Component, inject, Signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DIALOG_DATA } from '@angular/cdk/dialog';

/*
 * Author: Drake
 *
 * Full-screen overlay shown while force units are being loaded and initialized.
 * Displays per-force progress (faction icon, force name, loaded/total units)
 * and a spinner. When some units fail to load, shows a retry button.
 */

/** Tracks loading progress for a single force. */
export interface ForceLoadingProgress {
    forceName: string;
    factionImg: string | null;
    loadedUnits: Signal<number>;
    totalUnits: number;
}

/** Data injected into the overlay dialog. */
export interface ForceLoadingOverlayData {
    forces: ForceLoadingProgress[];
    /** Number of units that failed to load in the last attempt. */
    failedCount: WritableSignal<number>;
    /** Whether a loading pass is currently in progress. */
    loading: WritableSignal<boolean>;
    /** Callback to retry loading failed units. */
    onRetry: () => void;
    /** Callback to skip/dismiss the overlay without waiting for completion. */
    onSkip: () => void;
}

@Component({
    selector: 'force-loading-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
        <div class="wide-dialog">
            <h2 class="wide-dialog-title">Loading Units</h2>
            <div class="wide-dialog-body">
                <div class="force-list">
                    @for (entry of data.forces; track entry.forceName) {
                        <div class="force-entry">
                            <div class="force-info">
                                @if (entry.factionImg) {
                                    <img [src]="entry.factionImg" class="faction-icon" />
                                }
                                <span class="force-name">{{ entry.forceName }}</span>
                            </div>
                            <span class="force-progress">
                                {{ entry.loadedUnits() }} / {{ entry.totalUnits }}
                            </span>
                        </div>
                    }
                </div>
            </div>
            <div class="wide-dialog-actions">
                @if (data.loading()) {
                    <div class="spinner-container">
                        <div class="spinner">
                            <div class="ring"></div>
                        </div>
                    </div>
                } @else if (data.failedCount() > 0) {
                    <div class="error-section">
                        <div class="error-message">
                            {{ data.failedCount() }} unit{{ data.failedCount() > 1 ? 's' : '' }} failed to load.
                        </div>
                        <div class="error-actions">
                            <button class="bt-button modal-btn" (click)="data.onRetry()">RETRY</button>
                            <button class="bt-button modal-btn danger" (click)="data.onSkip()">SKIP</button>
                        </div>
                    </div>
                }
            </div>
        </div>
    `,
    styles: [`
        .force-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            width: 100%;
        }

        .force-entry {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.05);
        }

        .force-info {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1 1 0;
            min-width: 0;
        }

        .faction-icon {
            width: 24px;
            height: 24px;
            object-fit: contain;
            flex-shrink: 0;
        }

        .force-name {
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text-color, #fff);
        }

        .force-progress {
            font-size: 0.9em;
            color: var(--text-color-secondary, #aaa);
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
        }

        .spinner-container {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .error-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }

        .error-message {
            color: #ff6644;
            font-size: 0.95em;
        }

        .error-actions {
            display: flex;
            gap: 8px;
        }

        .spinner {
            width: 44px;
            height: 44px;
            position: relative;
            display: inline-block;
        }

        .spinner .ring {
            box-sizing: border-box;
            position: absolute;
            width: 100%;
            height: 100%;
            border-top: 5px solid #BFC1C2;
            border-right: 5px solid #A00000;
            border-bottom: 5px solid #2357c6;
            border-left: 5px solid #2357c6;
            border-radius: 50%;
            animation: spin 1.1s cubic-bezier(0.77, 0, 0.175, 1) infinite;
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
export class ForceLoadingOverlayComponent {
    data = inject<ForceLoadingOverlayData>(DIALOG_DATA);
}
