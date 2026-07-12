/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

/**
 * Author: Drake
 * 
 * Panel component to display a matrix of gunnery/piloting skill combinations and their corresponding BV values.
 * Used in the EditAsPilotDialogComponent for skill selection with BV preview.
 */

export interface SkillMatrixCell {
    gunnery: number;
    piloting: number;
    bv: number;
}

@Component({
    selector: 'skill-matrix-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    template: `
        <div class="matrix-panel glass has-shadow framed-borders">
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th class="corner-header">
                            <div class="corner-header-inner">
                                <span class="header-piloting">P</span>
                                <span class="header-gunnery">G</span>
                            </div>
                            <span class="header-separator"></span>
                        </th>
                        @for (p of skills; track p) {
                            <th class="col-header" [class.active-col]="p === selectedPiloting()" [class.hover-highlight]="p === hoveredP()">{{ p }}</th>
                        }
                    </tr>
                </thead>
                <tbody>
                    @for (g of skills; track g) {
                        <tr>
                            <th class="row-header" [class.active-row]="g === selectedGunnery()" [class.hover-highlight]="g === hoveredG()">{{ g }}</th>
                            @for (p of skills; track p) {
                                <td class="matrix-cell"
                                    [class.active]="g === selectedGunnery() && p === selectedPiloting()"
                                    [class.active-row]="g === selectedGunnery() && p !== selectedPiloting()"
                                    [class.active-col]="p === selectedPiloting() && g !== selectedGunnery()"
                                    (mouseenter)="hoveredG.set(g); hoveredP.set(p)"
                                    (mouseleave)="hoveredG.set(-1); hoveredP.set(-1)"
                                    (click)="onCellClick(g, p)">
                                    {{ getCellBv(g, p) }}
                                </td>
                            }
                        </tr>
                    }
                </tbody>
            </table>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: fit-content;
            max-width: 100vw;
        }

        .matrix-panel {
            box-sizing: border-box;
            overflow: auto;
            padding: 8px;
        }

        .matrix-table {
            border-collapse: collapse;
            font-size: 0.82em;
        }

        .corner-header {
            position: relative;
            padding: 0;
            color: var(--text-color-tertiary);
            font-size: 0.85em;
            font-weight: 600;
        }

        .corner-header-inner {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr;
            min-width: 24px;
            min-height: 24px;
        }

        .header-piloting {
            grid-column: 2;
            grid-row: 1;
            text-align: right;
            padding: 1px 3px 0 0;
            line-height: 1;
        }

        .header-gunnery {
            grid-column: 1;
            grid-row: 2;
            text-align: left;
            padding: 0 0 1px 3px;
            line-height: 1;
        }

        .header-separator {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to top right, transparent calc(50% - 0.5px), var(--text-color-tertiary) calc(50% - 0.5px), var(--text-color-tertiary) calc(50% + 0.5px), transparent calc(50% + 0.5px));
            pointer-events: none;
        }

        .col-header,
        .row-header {
            padding: 4px 4px;
            text-align: center;
            font-weight: 700;
            font-size: 0.95em;
            color: var(--text-color-tertiary);
        }

        .col-header.active-col,
        .row-header.active-row {
            color: var(--bt-yellow);
        }

        .col-header.hover-highlight,
        .row-header.hover-highlight {
            color: var(--text-color);
        }

        .col-header.active-col.hover-highlight,
        .row-header.active-row.hover-highlight {
            color: var(--bt-yellow);
        }

        .matrix-cell {
            padding: 4px 6px;
            min-width: 42px;
            text-align: center;
            cursor: pointer;
            color: var(--text-color-secondary);
            border: 1px solid rgba(255, 255, 255, 0.06);
            transition: background-color 0.1s;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        @media (max-width: 599px) {
            .matrix-table {
                font-family: 'Roboto Condensed', sans-serif;
            }

            .matrix-cell {
                min-width: 32px;
                padding: 4px 2px;
            }
        }

        @media (min-width: 600px) {
            .matrix-cell {
                padding: 6px 10px;
            }

            .col-header,
            .row-header {
                padding: 6px 8px;
            }
        }

        .matrix-cell:hover {
            background: rgba(255, 255, 255, 0.12);
            color: var(--text-color);
        }

        .matrix-cell.active-row,
        .matrix-cell.active-col {
            background: rgba(255, 255, 255, 0.06);
        }

        .matrix-cell.active {
            background: var(--bt-yellow-background-transparent);
            color: var(--bt-yellow);
            font-weight: 700;
        }

        .matrix-cell.active:hover {
            background: var(--bt-yellow-background-bright-transparent);
        }
    `]
})
export class SkillMatrixPanelComponent {
    matrix = input.required<number[][]>();
    selectedGunnery = input<number>(4);
    selectedPiloting = input<number>(5);

    selected = output<SkillMatrixCell>();

    hoveredG = signal(-1);
    hoveredP = signal(-1);

    readonly skills = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    getCellBv(gunnery: number, piloting: number): string {
        const bv = this.matrix()[gunnery]?.[piloting] ?? 0;
        return bv.toLocaleString();
    }

    onCellClick(gunnery: number, piloting: number): void {
        const bv = this.matrix()[gunnery]?.[piloting] ?? 0;
        this.selected.emit({ gunnery, piloting, bv });
    }
}
