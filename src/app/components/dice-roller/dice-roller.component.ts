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

import { ChangeDetectionStrategy, Component, inject, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { CdkDrag, CdkDragEnd, CdkDragStart } from '@angular/cdk/drag-drop';

/*
 * Author: Drake
 */
export interface DiceRollResult {
    die1: number;
    die2: number;
    modifier: number;
    total: number;
}

export interface DiceRollerData {
    caption: string;
    modifier: number;
}

@Component({
    selector: 'app-dice-roller',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, DialogModule, CdkDrag],
    template: `<div class="dice-roller-content" 
     cdkDrag
     cdkDragRootElement=".cdk-overlay-pane"
     [cdkDragBoundary]="'.cdk-overlay-container'"
     (cdkDragStarted)="onDragStart($event)"
     (cdkDragEnded)="onDragEnd($event)"
     (click)="close()">
    <div class="caption">{{ data.caption }}</div>
    <div class="dice-body">
        <div class="dice-faces">
            <div class="die">{{ rollResult()?.die1 }}</div>
            <div class="die">{{ rollResult()?.die2 }}</div>
            @if (rollResult()?.modifier; as mod) {
                <div class="die">
                    <span *ngIf="mod > 0"> + {{ mod }}</span>
                    <span *ngIf="mod < 0"> - {{ -mod }}</span>
                </div>
            }
        </div>
        <div class="dice-result">
            <span class="result-total">= {{ rollResult()?.total }}</span>
        </div>
    </div>
</div>`,
styles: [
    `
        :host {
            display: block;
            background: #000;
            border-radius: 8px;
            padding: 8px 16px;
        }

        .caption {
            text-align: center;
            margin-bottom: 8px;
            font-size: 1.2em;
            color: #ccc;
            font-weight: bold;
        }

        .dice-roller-content {
            font-family: 'Roboto', sans-serif;
            color: #fff;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .dice-body {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .dice-faces {
            display: flex;
            gap: 6px;
        }

        .die {
            width: 32px;
            height: 32px;
            border: 1px solid #888;
            border-radius: 4px;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 20px;
            font-weight: bold;
            background-color: #eee;
            color: #000;
        }

        .dice-result {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }

        .result-total {
            font-size: 24px;
            font-weight: bold;
        }
        
        .cdk-drag-dragging {
            cursor: move;
        }

        .result-total {
            font-size: 24px;
            font-weight: bold;
        }`]
})
export class DiceRollerComponent implements OnInit {
    rollResult = signal<DiceRollResult | null>(null);
    instance: any;
    protected isDragging = false;
    public dialogRef: DialogRef<void> = inject(DialogRef);
    readonly data: DiceRollerData = inject(DIALOG_DATA);

    constructor() {}

    ngOnInit(): void {
        this.roll();
    }

    roll(): void {
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2 + this.data.modifier;
        this.rollResult.set({ die1, die2, modifier: this.data.modifier, total });
    }

    reroll(): void {
        this.roll();
    }

    close(): void {
        this.dialogRef.close();
    }

    onDragStart(event: CdkDragStart): void {
        this.isDragging = true;
        event.event.stopPropagation();
    }

    onDragEnd(event: CdkDragEnd): void {
        event.event.stopPropagation();
        setTimeout(() => {
            this.isDragging = false;
        }, 50);
    }
}