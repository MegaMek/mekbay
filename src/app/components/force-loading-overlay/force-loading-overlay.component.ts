// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, type Signal, type WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';

/*
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
    imports: [CommonModule, LoadingSpinnerComponent],
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
                    <loading-spinner class="spinner-container"></loading-spinner>
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

        .wide-dialog-actions {
            border: 0;
            margin-top: 0;
        }

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

    `]
})
export class ForceLoadingOverlayComponent {
    data = inject<ForceLoadingOverlayData>(DIALOG_DATA);
}
