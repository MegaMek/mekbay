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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, Inject, ViewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ForceBuilderService } from '../../services/force-builder.service';

/*
 * Author: Drake
 */
export interface RenameForceDialogData {
    title: string;
    message: string;
    inputType?: 'text';
    placeholder?: string;
    defaultValue?: string | number;
    buttons?: { label: string; value: 'ok' | 'cancel'; class?: string }[];
}

@Component({
    selector: 'rename-force-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div class="content">
        <h2 dialog-title>{{ data.title }}</h2>
        <div dialog-content>
            <p>{{ data.message }}</p>
            <div class="input-wrapper">
                <input
                    #inputRef
                    [type]="data.inputType || 'text'"
                    [placeholder]="data.placeholder"
                    [value]="data.defaultValue ?? ''"
                    (keydown.enter)="submit()"
                    required
                />
                <button
                    type="button"
                    class="random-button"
                    (click)="fillRandomName()"
                    aria-label="Generate random force name"
                ></button>
            </div>
            <details class="faction-accordion" *ngIf="factionsText">
                <summary>Factions</summary>
                <p>{{ factionsText }}</p>
            </details>
        </div>
        <div dialog-actions>
            <button
                *ngFor="let btn of buttons"
                (click)="btn.value === 'ok' ? submit() : close(null)"
                class="bt-button {{ btn.class }}"
            >
                {{ btn.label }}
            </button>
        </div>
    </div>
    `,
    styles: [`
        :host {
            display: flex;
            justify-content: center;
            box-sizing: border-box;
            background-color: rgba(45, 45, 45, 0.8);
            backdrop-filter: blur(5px);
            width: 100vw;
            pointer-events: auto;
            padding: 16px;
        }

        :host-context(.cdk-overlay-pane) {
            transform: translateY(-10vh);
        }

        .content {
            display: block;
            max-width: 1000px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] input {
            width: calc(90vw - 32px);
            max-width: 500px;
            margin-bottom: 16px;
            font-size: 1.5em;
            background: var(--background-input);
            color: white;
            border: 0;
            border-bottom: 1px solid #666;
            text-align: center;
            outline: none;
            transition: all 0.2s ease-in-out;
            padding-left: 32px;
        }

        [dialog-content] input:focus {
            border-bottom: 1px solid #fff;
            outline: none;
        }

        .input-wrapper {
            position: relative;
            display: inline-flex;
            align-items: center;
            box-sizing: border-box;
        }

        .random-button {
            align-self: baseline;
            height: 32px;
            width: 32px;
            border: none;
            background: transparent url('/images/random.svg') center/24px 24px no-repeat;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s ease-in-out;
        }

        .random-button:hover,
        .random-button:focus {
            opacity: 1;
        }

        [dialog-actions] {
            padding-top: 8px;
            display: flex;
            gap: 8px;
            justify-content: center;
            flex-wrap: wrap;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }

        .faction-accordion {
            margin: 0 auto 16px;
            width: 90vw;
            max-width: 500px;
            text-align: left;
            background: rgba(255, 255, 255, 0.05);
        }

        .faction-accordion summary {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            padding: 8px 16px;
            font-weight: 600;
            list-style: none;
        }

        .faction-accordion summary::before {
            content: '▶';
            font-size: 0.9em;
            transition: transform 0.2s ease-in-out;
        }

        .faction-accordion[open] summary::before {
            content: '▼';
        }

        .faction-accordion summary::-webkit-details-marker {
            display: none;
        }

        .faction-accordion p {
            margin: 0;
            padding: 0 16px 12px;
            font-size: 0.95em;
            line-height: 1.4;
        }
    `]
})

export class RenameForceDialogComponent {
    @ViewChild('inputRef') inputRef!: ElementRef<HTMLInputElement>;
    public dialogRef: DialogRef<string | number | null, RenameForceDialogComponent> = inject(DialogRef);
    readonly data: RenameForceDialogData = inject(DIALOG_DATA);
    private forceBuilder = inject(ForceBuilderService);
    factionsText = this.computeFactionsText();
    buttons: { label: string; value: 'ok' | 'cancel'; class?: string }[];

    constructor() {
        this.buttons = this.data.buttons ?? [
            { label: 'OK', value: 'ok' },
            { label: 'CANCEL', value: 'cancel' }
        ];
    }

    submit() {
        const value = this.inputRef.nativeElement.value;
        this.dialogRef.close(value);
    }

    fillRandomName() {
        const randomName = this.forceBuilder.generateForceName();
        this.inputRef.nativeElement.value = randomName;
        this.inputRef.nativeElement.focus();
        this.inputRef.nativeElement.select();
    }

    private computeFactionsText(): string | null {
        const factions = this.forceBuilder.getAllFactionsAvailable();
        const totalUnits = this.forceBuilder.forceUnits().length;
        if (!totalUnits || !factions || factions.size === 0) {
            return null;
        }
        const formatted = Array.from(factions.entries()).sort((a, b) => b[1] - a[1]).map(([name, percentage]) => {
            const percent = Math.round(percentage * 100);
            if (percent < 100) {
                return `${name} (${percent}%)`;
            } else {
                return name;
            }
        });
        return formatted.join(', ');
    }

    close(value: null) {
        this.dialogRef.close(value);
    }
}