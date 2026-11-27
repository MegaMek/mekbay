// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, type Signal } from '@angular/core';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { getFactionImg } from '../../models/factions.model';
import type { ForceLoadingProgress } from '../../models/force-loading-progress.model';
import { DataService } from '../../services/data.service';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';

export interface ForceLoadingOverlayData {
    readonly message: Signal<string>;
    readonly forces: Signal<readonly ForceLoadingProgress[]>;
}

/** Blocks workspace interaction until a force link has finished restoring. */
@Component({
    selector: 'force-loading-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingSpinnerComponent],
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <div class="wide-dialog force-loading-dialog" aria-busy="true">
            <h2 class="wide-dialog-title">Loading Forces</h2>
            <div class="wide-dialog-body">
                <p>Please wait while your forces and units are loaded.</p>
                <div class="force-list" role="list" aria-label="Forces being loaded">
                    @for (entry of entries(); track entry.instanceId) {
                        <div class="force-entry" role="listitem">
                            @if (entry.factionImg) {
                                <img [src]="entry.factionImg" [alt]="entry.factionName" class="faction-icon" />
                            }
                            <div class="force-info">
                                <span class="force-name">{{ entry.name }}</span>
                                @if (entry.eraName) {
                                    <span class="force-era">{{ entry.eraName }}</span>
                                }
                            </div>
                            <span class="force-status" [class.failed]="entry.status === 'failed'">
                                @switch (entry.status) {
                                    @case ('pending') { Waiting }
                                    @case ('loading') { Loading… }
                                    @case ('loaded') { Ready }
                                    @case ('failed') { Unavailable }
                                }
                            </span>
                        </div>
                    }
                </div>
                <loading-spinner [message]="data.message()" ariaLabel="Loading forces"></loading-spinner>
            </div>
        </div>
    `,
    styles: [`
        .force-loading-dialog {
            width: min(480px, calc(100vw - 32px));
        }

        .wide-dialog-body {
            text-align: center;
        }

        p {
            margin: 0 0 24px;
        }

        .force-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 24px;
        }

        .force-list:empty { display: none; }

        .force-entry {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.05);
            text-align: left;
        }

        .faction-icon {
            width: 32px;
            height: 32px;
            object-fit: contain;
            flex-shrink: 0;
        }

        .force-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .force-name { font-weight: 600; }
        .force-era, .force-status { font-size: 0.9em; color: var(--text-color-secondary); }
        .force-status { flex-shrink: 0; }
        .failed { color: #ff6644; }
    `],
})
export class ForceLoadingOverlayComponent {
    protected readonly data = inject<ForceLoadingOverlayData>(DIALOG_DATA);
    private readonly dataService = inject(DataService);
    protected readonly entries = computed(() => this.data.forces().map((force, index) => {
        const faction = force.factionId === undefined ? null : this.dataService.getFactionById(force.factionId);
        const era = force.eraId === undefined ? null : this.dataService.getEraById(force.eraId);
        return {
            ...force,
            name: force.name || `Force ${index + 1}`,
            factionImg: faction ? getFactionImg(faction) : undefined,
            factionName: faction?.name ?? '',
            eraName: era?.name,
        };
    }));
}
