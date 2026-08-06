// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    Component,
    ChangeDetectionStrategy,
    input,
    computed,
    inject
} from '@angular/core';
import type { ASForce } from '../../models/as-force.model';
import { DialogsService } from '../../services/dialogs.service';

/*
 * 
 * ASInteractionOverlayComponent - Global overlay for Alpha Strike force interactions.
 * Shows "Commit and End Turn" button when any unit has uncommitted changes.
 */

@Component({
    selector: 'as-interaction-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (hasDirtyUnits()) {
            <div class="phase-controls">
                <button role="button" 
                        class="phase-button end-phase-button preventZoomRese" 
                        tabindex="0"
                        (click)="commitAll($event)">
                    COMMIT AND END TURN
                </button>
            </div>
        }
    `,
    styles: [`
        :host {
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 10;
            box-sizing: border-box;
            overflow: hidden;
        }

        .phase-controls {
            bottom: 8px;
            left: 0;
            right: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            position: absolute;
            width: fit-content;
            margin-inline: auto;
            pointer-events: auto;
            gap: 8px;
        }

        .phase-button {
            cursor: pointer;
            opacity: 1.0;
            margin-inline: auto;
            width: fit-content;
            border: 1px solid #000;
            padding: 8px;
            text-align: center;
            font-weight: bold;
            transition: background-color 0.2s;
            font-size: 0.9em;

            &.end-phase-button {
                background-color: #a00;
                color: white;
            }

            &:hover {
                background-color: #f00;
            }
        }

        @media print {
            :host {
                display: none !important;
            }
        }
    `]
})
export class ASInteractionOverlayComponent {
    private dialogsService = inject(DialogsService);

    force = input<ASForce | null>(null);

    hasDirtyUnits = computed<boolean>(() => {
        const f = this.force();
        if (!f) return false;
        
        const units = f.units();
        return units.some(unit => unit.isDirty());
    });

    async commitAll(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        
        const f = this.force();
        if (!f) return;

        const units = f.units();
        for (const unit of units) {
            if (unit.isDirty()) {
                unit.commitPending();
            }
        }
    }

    async discardAll(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        
        const f = this.force();
        if (!f) return;

        const confirm = await this.dialogsService.requestConfirmation(
            'Are you sure you want to discard all pending changes?',
            'Discard Changes',
            'danger'
        );

        if (!confirm) return;

        const units = f.units();
        for (const unit of units) {
            if (unit.isDirty()) {
                unit.discardPending();
            }
        }
    }
}
