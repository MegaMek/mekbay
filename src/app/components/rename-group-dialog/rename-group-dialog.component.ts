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


import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ForceBuilderService } from '../../services/force-builder.service';
import { UnitGroup } from '../../models/force.model';
/*
 * Author: Drake
 */
export interface RenameGroupDialogData {
    group: UnitGroup;
}

@Component({
    selector: 'rename-group-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
      <h2 dialog-title></h2>
      <div dialog-content>
        <p>Group Name</p>
        <div class="input-wrapper">
          <div
            class="input"
            contentEditable="true"
            #inputRef
            [textContent]="data.group.name()"
            (keydown.enter)="submit()"
            required
          ></div>
          <button
            type="button"
            class="random-button"
            (click)="fillRandomName()"
            aria-label="Generate random force name"
          ></button>
        </div>
        @if (formationsText) {
          <details class="faction-accordion">
            <summary>Formations ({{ formationsText.length }})</summary>
            <div class="formation-list">
              @for (formation of formationsText; let isLast = $last; track formation) {
                <span class="formation-item" (click)="selectFormation(formation)">{{ formation }}</span>@if (!isLast) {<span class="formation-separator">, </span>}
              }
            </div>
          </details>
        }
      </div>
      <div dialog-actions>
        <button (click)="submit()" class="bt-button">CONFIRM</button>
        <button (click)="submitEmpty()" class="bt-button">UNSET</button>
        <button (click)="close()" class="bt-button">DISMISS</button>
      </div>
    </div>
    `,
    styles: [`
        .content {
            display: block;
            max-width: 1000px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] .input {
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

        [dialog-content] .input:focus {
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

        .formation-list {
            padding: 0 16px 12px;
            font-size: 0.95em;
            line-height: 1.6;
        }

        .formation-item {
            display: inline;
            cursor: pointer;
            transition: opacity 0.2s ease-in-out;
        }

        .formation-item:hover {
            opacity: 0.7;
        }

        .formation-separator {
            margin-right: 4px;
        }
    `]
})

export class RenameGroupDialogComponent {
    inputRef = viewChild.required<ElementRef<HTMLDivElement>>('inputRef');
    public dialogRef: DialogRef<string | number | null, RenameGroupDialogComponent> = inject(DialogRef);
    readonly data: RenameGroupDialogData = inject(DIALOG_DATA);
    private forceBuilder = inject(ForceBuilderService);
    formationsText = this.computeFormationsText();

    constructor() {}

    submit() {
        const value = this.inputRef().nativeElement.textContent?.trim() || '';
        this.dialogRef.close(value);
    }

    submitEmpty() {
        this.dialogRef.close('');
    }

    fillRandomName() {
        const randomName = this.forceBuilder.generateGroupName(this.data.group);
        const nativeEl = this.inputRef().nativeElement;
        if (!nativeEl) return;
        nativeEl.textContent = randomName;
        nativeEl.focus();
        const range = document.createRange();
        range.selectNodeContents(nativeEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    selectFormation(formationName: string) {
        const nativeEl = this.inputRef().nativeElement;
        if (!nativeEl) return;
        nativeEl.textContent = formationName;
        nativeEl.focus();
    }

    private computeFormationsText(): string[] | null {
        const formations = this.forceBuilder.getAllFormationsAvailable(this.data.group);
        if (!formations || formations.length === 0) {
            return null;
        }
        return formations;
    }

    close(value = null) {
        this.dialogRef.close(value);
    }
}