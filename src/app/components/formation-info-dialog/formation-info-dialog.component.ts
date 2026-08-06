// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { FormationTypeDefinition } from '../../utils/formation-type.model';
import { FormationInfoComponent } from '../formation-info/formation-info.component';
import type { GameSystem } from '../../models/common.model';

/*
 *
 * Dialog that shows full formation details and abilities.
 * Opened from the (i) icon in the force-builder-viewer group header.
 */

export interface FormationInfoDialogData {
    formation: FormationTypeDefinition;
    /** Game system of the owning force. */
    gameSystem: GameSystem;
    /** Optional composed formation name for display (e.g. "Fire Support Lance") */
    formationDisplayName?: string;
    /** Optional unit count for concrete distribution labels */
    unitCount?: number;
    /** Whether the formation is valid for the current group composition */
    isValid?: boolean;
    /** Whether organization-level units were ignored while checking requirements */
    requirementsFiltered?: boolean;
    /** Optional org composition name that caused requirement filtering */
    requirementsFilterCompositionName?: string;
    /** Optional notice describing which structural units were ignored */
    requirementsFilterNotice?: string;
}

@Component({
    selector: 'formation-info-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormationInfoComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
        <div class="content">
            <h2 dialog-title>{{ data.formationDisplayName || data.formation.name }}</h2>
            <div dialog-content>
                <formation-info [formation]="data.formation" [gameSystem]="data.gameSystem" [unitCount]="data.unitCount" [isValid]="data.isValid" [requirementsFiltered]="data.requirementsFiltered ?? false" [requirementsFilterCompositionName]="data.requirementsFilterCompositionName" [requirementsFilterNotice]="data.requirementsFilterNotice" [showTitle]="false"></formation-info>
            </div>
            <div dialog-actions>
                <button (click)="close()" class="bt-button">DISMISS</button>
            </div>
        </div>
    `,
    styles: [`
        .content {
            display: block;
            max-width: 800px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] {
            width: 90vw;
            max-width: 800px;
            max-height: 70vh;
            overflow-y: auto;
            text-align: left;
            padding: 0 4px;
        }

        [dialog-actions] {
            padding-top: 12px;
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }

        .formation-warning {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 6px 10px;
            margin-bottom: 8px;
            font-size: 0.85em;
            color: red;
            background: rgba(255, 0, 0, 0.08);
            border-left: 3px solid red;
            text-align: left;
        }

        .formation-warning-body {
            display: flex;
            flex-direction: column;
        }
    `]
})
export class FormationInfoDialogComponent {
    public dialogRef = inject(DialogRef);
    readonly data: FormationInfoDialogData = inject(DIALOG_DATA) as FormationInfoDialogData;

    close(): void {
        this.dialogRef.close();
    }
}
