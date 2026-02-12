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

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { ForceAlignment } from '../../models/force-slot.model';

/*
 * Author: Drake
 */

@Component({
    selector: 'alignment-picker-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2>Add as…</h2>
        <div class="alignment-options">
            <button class="bt-button alignment-btn friendly" (click)="pick('friendly')">
                <svg fill="currentColor" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                    <path d="M256,32C174,69.06,121.38,86.46,32,96c0,77.59,5.27,133.36,25.29,184.51a348.86,348.86,0,0,0,71.43,112.41C178.32,445.58,232.89,473.32,256,480c23.11-6.68,77.68-34.42,127.28-87.08a348.86,348.86,0,0,0,71.43-112.41C474.73,229.36,480,173.59,480,96,390.62,86.46,338,69.06,256,32Z"/>
                </svg>
                <span>Friendly</span>
            </button>
            <button class="bt-button alignment-btn enemy" (click)="pick('enemy')">
                <svg fill="currentColor" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
                    <path d="M 33.9,94.4 31.4,94.3 31.1,93.8 30.8,93.2 30.4,91 c -0.4,-2.2 -1,-6.2 -1.7,-9.9 -0.2,-1 -0.6,-3 -0.8,-4.5 -0.3,-1.6 -0.6,-3.5 -0.8,-4.4 l -0.3,-1.6 h -0.3 c -0.1,-0.1 -0.7,-0.3 -1.2,-0.5 -0.5,-0.3 -1,-0.5 -1.1,-0.5 -0.2,0 -0.6,-0.2 -1,-0.4 -0.4,-0.1 -2.8,-1.1 -5.3,-2.1 -2.5,-1 -4.7,-1.9 -4.8,-2 -0.2,0 -0.6,-0.6 -1,-1.3 -0.4,-0.7 -1.4,-2.4 -2.16,-3.7 L 8.52,57.7 v -0.6 c 0,-0.6 0,-0.9 0.84,-4.2 L 9.81,51 9.1,49.8 8.4,48.5 7.94,46.4 C 7.68,45.2 7.35,43.5 7.19,42.6 L 6.91,40.9 7.02,38.3 C 7.49,27.5 12.5,17.8 21.1,10.8 28.1,5.17 35,2.54 44.3,1.86 L 48,1.6 51.7,1.86 c 9.3,0.68 16.2,3.31 23.2,8.94 8.6,7 13.6,16.7 14.1,27.5 l 0.1,2.6 -0.3,1.7 c -0.1,0.9 -0.5,2.6 -0.7,3.8 l -0.5,2.1 -0.7,1.3 -0.7,1.2 0.5,1.9 c 0.8,3.3 0.8,3.6 0.8,4.2 v 0.6 l -1.4,2.4 c -0.8,1.3 -1.8,3 -2.2,3.7 -0.4,0.7 -0.8,1.3 -1,1.3 -0.1,0.1 -2.3,1 -4.8,2 -2.5,1 -4.9,2 -5.3,2.1 -0.4,0.2 -0.8,0.4 -1,0.4 -0.1,0 -0.6,0.2 -1.1,0.5 -0.5,0.2 -1.1,0.4 -1.2,0.5 h -0.3 l -0.3,1.6 c -0.2,0.9 -0.5,2.8 -0.8,4.4 -0.2,1.5 -0.6,3.5 -0.8,4.5 -0.7,3.7 -1.3,7.7 -1.7,9.9 l -0.4,2.2 -0.3,0.6 -0.3,0.5 -2.6,0.1 c -1.4,0 -3.1,0 -3.6,-0.1 L 57.3,94.1 57.1,93.9 57,93.6 58.4,86.7 c 0.7,-3.8 1.3,-7 1.3,-7.1 l 0.1,-0.2 h -1 -0.9 l -0.2,0.8 c 0,0.4 -0.6,3.7 -1.2,7.3 l -1.1,6.4 -0.3,0.2 -0.3,0.2 h -2.9 -3 L 48.8,94 c 0,-0.1 -0.1,-3.6 -0.1,-7.6 L 48.6,79.1 H 48 47.4 l -0.1,7.3 c 0,4 -0.1,7.5 -0.1,7.6 l -0.1,0.3 h -3 -2.9 l -0.3,-0.2 -0.3,-0.2 -1.1,-6.4 c -0.6,-3.6 -1.2,-6.9 -1.2,-7.3 l -0.2,-0.8 h -0.9 -1 l 0.1,0.2 c 0,0.1 0.6,3.3 1.3,7.1 l 1.4,7 -0.3,0.3 -0.3,0.3 h -0.7 c -0.4,0 -0.8,0.1 -1,0.1 -0.2,0 -1.4,0 -2.8,0 z m 17.4,-27.2 2.9,-1.7 v -0.4 c 0,-1.4 -6.1,-21.4 -6.3,-21.1 -0.2,0.2 -6.1,20.6 -6.1,21.1 v 0.4 l 2.9,1.7 c 3.6,2 3,2 6.6,0 z M 35.3,52.6 C 37,50.9 38.5,49.3 38.6,49 l 0.3,-0.5 -0.8,-1.3 C 37.4,46 37.1,45.5 36,43.5 35.7,43 35.3,42.3 35,41.9 l -0.5,-0.6 h -9.1 -9.1 l -2.4,1.8 -2.4,1.8 v 3 3 l 2.4,2.4 2.3,2.3 8.1,0.1 h 8 z m 46.8,0.7 2.4,-2.4 v -3 -3 L 82.1,43.1 79.7,41.3 H 70.6 61.5 L 61,41.9 c -0.3,0.4 -0.7,1.1 -1,1.6 -1.1,2 -1.4,2.5 -2.1,3.7 l -0.8,1.3 0.3,0.5 c 0.1,0.3 1.6,1.9 3.3,3.6 l 3,3.1 h 8 8 z"/>
                </svg>
                <span>Enemy</span>
            </button>
        </div>
    </div>
    `,
    styles: [`
        .content {
            display: block;
            max-width: 400px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 16px;
        }

        .alignment-options {
            display: flex;
            gap: 16px;
            justify-content: center;
            padding-bottom: 8px;
        }

        .alignment-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            padding: 20px 28px;
            cursor: pointer;
            min-width: 120px;
        }

        .alignment-btn svg {
            width: 48px;
            height: 48px;
        }

        .alignment-btn span {
            font-size: 0.95em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .alignment-btn.friendly {
            color: rgb(var(--friendly-color));
            background-image:
                linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))), linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))),
                linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))), linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))),
                linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))), linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))),
                linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color))), linear-gradient(rgb(var(--friendly-color)), rgb(var(--friendly-color)));
        }

        .alignment-btn.friendly:hover {
            background-color: rgba(var(--friendly-color), 0.1);
        }

        .alignment-btn.friendly:active {
            transform: scale(0.96);
        }

        .alignment-btn.enemy {
            color: rgb(var(--enemy-color));
            background-image:
                linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))), linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))),
                linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))), linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))),
                linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))), linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))),
                linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color))), linear-gradient(rgb(var(--enemy-color)), rgb(var(--enemy-color)));
        }

        .alignment-btn.enemy:hover {
            background-color: rgba(var(--enemy-color), 0.1);
        }

        .alignment-btn.enemy:active {
            transform: scale(0.96);
        }
    `]
})
export class AlignmentPickerDialogComponent {
    private dialogRef = inject(DialogRef<ForceAlignment | null>);

    pick(alignment: ForceAlignment) {
        this.dialogRef.close(alignment);
    }
}
