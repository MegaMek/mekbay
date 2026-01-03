/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import {
    Component,
    ChangeDetectionStrategy,
    input,
    computed,
    inject
} from '@angular/core';
import { ASForce } from '../../models/as-force.model';
import { DialogsService } from '../../services/dialogs.service';

/*
 * Author: Drake
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
            z-index: 100;
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
            transition: filter 0.2s;
            font-size: 0.9em;

            &.end-phase-button {
                background-color: #f00;
                color: white;
            }

            &:hover {
                filter: brightness(1.2);
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
