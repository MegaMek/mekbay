// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { GameSystem } from '../../models/common.model';
import type { PrintAllOptions } from '../../models/print-options.model';
import { OptionsService } from '../../services/options.service';


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
                        <label for="cleanPrint">Units condition:</label>
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
                        <label for="printPilotData">Pilot data:</label>
                        <select id="printPilotData" class="bt-select option-select"
                            [value]="printOptions().printPilotData"
                            (change)="onBooleanChange('printPilotData', $event)">
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                </div>

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
                        <label for="ASPrintCardSize">Card size:</label>
                        <select id="ASPrintCardSize" class="bt-select option-select"
                            [value]="printOptions().ASPrintCardSize"
                            (change)="onASPrintCardSizeChange($event)">
                            <option value="standard">Standard (8 per page)</option>
                            <option value="enlarged">Enlarged (4 per page)</option>
                        </select>
                    </div>
                </div>

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

        .option-row > label {
            text-align: left;
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

            .option-row:has(> label + select) {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                align-items: center;
            }

            .option-row > label + select {
                width: max-content;
                min-width: 140px;
                max-width: min(360px, 55vw);
            }
        }
    `]
})
export class PrintOptionsDialogComponent {
    private dialogRef = inject(DialogRef<PrintAllOptions | null>);
    private data = inject<PrintOptionsDialogData>(DIALOG_DATA);
    private optionsService = inject(OptionsService);

    protected readonly printOptions = signal<PrintAllOptions>({
        ...this.optionsService.options().printAllOptions,
    });

    protected readonly isClassic = computed(() => this.data.gameSystem === GameSystem.CLASSIC);
    protected readonly isAlphaStrike = computed(() => this.data.gameSystem === GameSystem.ALPHA_STRIKE);

    protected onBooleanChange(key: 'clean' | 'printPilotData' | 'printRosterSummary' | 'ASPrintPageBreakOnGroups', event: Event): void {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.printOptions.update(current => ({ ...current, [key]: value }));
    }

    protected onCenterPanelChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as PrintAllOptions['recordSheetCenterPanelContent'];
        this.printOptions.update(current => ({ ...current, recordSheetCenterPanelContent: value }));
    }

    protected onASPrintCardSizeChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as PrintAllOptions['ASPrintCardSize'];
        this.printOptions.update(current => ({ ...current, ASPrintCardSize: value }));
    }

    protected onPrintMarginChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as PrintAllOptions['printMargin'];
        this.printOptions.update(current => ({ ...current, printMargin: value }));
    }

    protected onClose(): void {
        this.dialogRef.close(null);
    }

    protected async onPrint(): Promise<void> {
        const printOptions = this.printOptions();
        await this.optionsService.setOption('printAllOptions', printOptions);
        this.dialogRef.close(printOptions);
    }
}
