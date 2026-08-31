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
    /** Eligible concrete groups for formations that copy another formation's bonus. */
    formationTargetOptions?: readonly { id: string; label: string }[];
    formationTargetGroupId?: string | null;
    formationTargetEditable?: boolean;
}

export interface FormationInfoDialogResult {
    formationTargetGroupId: string | null;
}

@Component({
    selector: 'formation-info-dialog',
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
                @if (data.formationTargetOptions) {
                    <div class="formation-target">
                        <label for="formation-target-group">Supported formation</label>
                        <select id="formation-target-group" class="bt-select formation-target-select" [value]="selectedTargetGroupId ?? ''" [disabled]="data.formationTargetEditable === false" (change)="onTargetChange($event)">
                            <option value="" [selected]="!selectedTargetGroupId">Select a formation</option>
                            @for (option of data.formationTargetOptions; track option.id) {
                                <option [value]="option.id" [selected]="option.id === selectedTargetGroupId">{{ option.label }}</option>
                            }
                        </select>
                        @if (data.formationTargetEditable !== false && data.formationTargetOptions.length === 0) {
                            <div class="formation-target-warning">No eligible formation is available in this force.</div>
                        } @else if (data.formationTargetEditable !== false && !selectedTargetGroupId) {
                            <div class="formation-target-warning">Select the formation whose assigned abilities this formation copies.</div>
                        }
                    </div>
                }
            </div>
            <div dialog-actions>
                @if (data.formationTargetOptions && data.formationTargetEditable !== false) {
                    <button (click)="apply()" class="bt-button">APPLY</button>
                }
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

        .formation-target {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 14px;
            padding: 12px;
            border: 1px solid var(--border-color);
            text-align: left;
        }

        .formation-target label {
            font-weight: 700;
        }

        .formation-target-select {
            width: 100%;
        }

        .formation-target-warning {
            color: var(--bt-orange, #f2a900);
            font-size: 0.85em;
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
    selectedTargetGroupId: string | null = this.data.formationTargetGroupId ?? null;

    onTargetChange(event: Event): void {
        this.selectedTargetGroupId = (event.target as HTMLSelectElement).value || null;
    }

    apply(): void {
        this.dialogRef.close({ formationTargetGroupId: this.selectedTargetGroupId } satisfies FormationInfoDialogResult);
    }

    close(): void {
        this.dialogRef.close();
    }
}
