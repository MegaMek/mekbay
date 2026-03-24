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

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { GameSystem } from '../../models/common.model';
import type { PrintAllOptions } from '../../models/print-options.model';
import { OptionsService } from '../../services/options.service';

/*
 * Author: Drake
 */
export interface PrintOptionsDialogData {
    gameSystem: GameSystem;
}

@Component({
    selector: 'print-options-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog print-dialog">
        <h2 class="wide-dialog-title">Print Options</h2>
        <div class="wide-dialog-body">
            <p class="message">These settings only apply to this print job.</p>

            <div class="option-grid">
                <div class="option-col">
                    <div class="option-row">
                        <label for="printRosterSummary">Roster summary:</label>
                        <select id="printRosterSummary" class="bt-select option-select"
                            [value]="printOptions().printRosterSummary"
                            (change)="onBooleanChange('printRosterSummary', $event)">
                            <option value="false">No</option>
                            <option value="true">Yes</option>
                        </select>
                    </div>
                </div>

                <div class="option-col">
                    <div class="option-row">
                        <label for="cleanPrint">Fresh units:</label>
                        <select id="cleanPrint" class="bt-select option-select" [value]="printOptions().clean"
                            (change)="onBooleanChange('clean', $event)">
                            <option value="false">Keep current state</option>
                            <option value="true">Print fresh</option>
                        </select>
                    </div>
                </div>

                @if (isClassic()) {
                <div class="option-col">
                    <div class="option-row">
                        <label for="recordSheetCenterPanelContent">Center panel:</label>
                        <select id="recordSheetCenterPanelContent" class="bt-select option-select"
                            [value]="printOptions().recordSheetCenterPanelContent"
                            (change)="onCenterPanelChange($event)">
                            <option value="clusterTable">Hit location and cluster table</option>
                            <option value="fluffImage">Artwork</option>
                        </select>
                    </div>
                </div>
                }

                @if (isAlphaStrike()) {
                <div class="option-col">
                    <div class="option-row">
                        <label for="ASPrintPageBreakOnGroups">Group page breaks:</label>
                        <select id="ASPrintPageBreakOnGroups" class="bt-select option-select"
                            [value]="printOptions().ASPrintPageBreakOnGroups"
                            (change)="onBooleanChange('ASPrintPageBreakOnGroups', $event)">
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                    <div class="description">
                        <p>Start each Alpha Strike group on its own printed page.</p>
                    </div>
                </div>
                }

                <div class="option-col">
                    <div class="option-row">
                        <label for="printMargin">Print margins:</label>
                        <select id="printMargin" class="bt-select option-select"
                            [value]="printOptions().printMargin"
                            (change)="onPrintMarginChange($event)">
                            <option value="none">None</option>
                            <option value="browserDefined">Handled by browser</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button class="bt-button primary" (click)="onPrint()">PRINT</button>
            <button class="bt-button" (click)="onClose()">CANCEL</button>
        </div>
    </div>
    `,
    styles: [`
        .print-dialog {
            width: min(680px, calc(100vw - 32px));
        }

        .message {
            margin: 0;
            font-size: 0.95em;
            color: var(--text-color-secondary);
            margin-bottom: 1rem;
        }

        .option-grid {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .option-col {
            display: flex;
            flex-direction: column;
            padding-left: 0.5rem;
            padding-right: 0.5rem;
        }

        .option-row {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            gap: 0.75rem;
        }

        .description {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .description p {
            margin-top: 0;
            margin-bottom: 0.3em;
        }

        .option-select {
            width: 50%;
            min-width: 220px;
            max-width: 260px;
        }

        @media (max-width: 600px) {
            .print-dialog {
                width: calc(100vw - 16px);
            }

            .option-row {
                flex-direction: column;
                align-items: stretch;
            }

            .option-select {
                min-width: 0;
                width: 100%;
                max-width: none;
            }
        }
    `]
})
export class PrintOptionsDialogComponent {
    private dialogRef = inject(DialogRef<PrintAllOptions | null>);
    private data = inject<PrintOptionsDialogData>(DIALOG_DATA);
    private optionsService = inject(OptionsService);

    protected readonly printOptions = signal<PrintAllOptions>({
        clean: false,
        printRosterSummary: this.optionsService.options().printRosterSummary,
        recordSheetCenterPanelContent: this.optionsService.options().recordSheetCenterPanelContent,
        ASPrintPageBreakOnGroups: this.optionsService.options().ASPrintPageBreakOnGroups,
        printMargin: this.optionsService.options().printMargin,
    });

    protected readonly isClassic = computed(() => this.data.gameSystem === GameSystem.CLASSIC);
    protected readonly isAlphaStrike = computed(() => this.data.gameSystem === GameSystem.ALPHA_STRIKE);

    protected onBooleanChange(key: 'clean' | 'printRosterSummary' | 'ASPrintPageBreakOnGroups' | 'debugPreview', event: Event): void {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.printOptions.update(current => ({ ...current, [key]: value }));
    }

    protected onCenterPanelChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as PrintAllOptions['recordSheetCenterPanelContent'];
        this.printOptions.update(current => ({ ...current, recordSheetCenterPanelContent: value }));
    }

    protected onPrintMarginChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as PrintAllOptions['printMargin'];
        this.printOptions.update(current => ({ ...current, printMargin: value }));
    }

    protected onClose(): void {
        this.dialogRef.close(null);
    }

    protected async onPrint(): Promise<void> {
        await this.optionsService.setOption('printMargin', this.printOptions().printMargin);
        this.dialogRef.close(this.printOptions());
    }
}