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
    inject,
    computed,
    output
} from '@angular/core';
import { PageViewerCanvasService } from './page-viewer-canvas.service';
import { DialogsService } from '../../../services/dialogs.service';

/*
 * Author: Drake
 * 
 * PageViewerCanvasControlsComponent - Global FAB controls for canvas drawing.
 * 
 * This component renders:
 * - Main FAB toggle for draw mode
 * - Color selection buttons
 * - Eraser toggle
 * - Stroke size slider
 * - Print and clear buttons
 * 
 * All controls update the global PageViewerCanvasService state.
 */

@Component({
    selector: 'page-viewer-canvas-controls',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="fab-container" 
             (pointerdown)="$event.stopPropagation()" 
             (pointerup)="$event.stopPropagation()"
             (pointermove)="$event.stopPropagation()" 
             (click)="$event.stopPropagation()" 
             (dblclick)="$event.stopPropagation()">
            
            <button class="fab main-fab" 
                    [style]="mainFabStyle()" 
                    [class.active]="canvasService.isActive()"
                    (click)="canvasService.toggleDrawMode()" 
                    aria-label="Toggle Draw Mode">
                @if (canvasService.mode() === 'eraser') {
                    <svg fill="currentColor" width="28px" height="28px" viewBox="0 5 20 22" version="1.1"
                         xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.125 13.781l7.938-7.938c0.719-0.719 1.813-0.719 2.531 0l7.688 7.688c0.719 0.719 0.719 1.844 0 2.563l-7.938 7.938c-2.813 2.813-7.375 2.813-10.219 0-2.813-2.813-2.813-7.438 0-10.25zM11.063 22.75l-7.656-7.688c-2.125 2.125-2.125 5.563 0 7.688s5.531 2.125 7.656 0z"></path>
                    </svg>
                } @else {
                    <svg fill="currentColor" width="24px" height="24px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                        <path d="M290.74 93.24l128.02 128.02-277.99 277.99-114.14 12.6C11.35 513.54-1.56 500.62.14 485.34l12.7-114.22 277.9-277.88zm207.2-19.06l-60.11-60.11c-18.75-18.75-49.16-18.75-67.91 0l-56.55 56.55 128.02 128.02 56.55-56.55c18.75-18.76 18.75-49.16 0-67.91z" />
                    </svg>
                }
            </button>

            @if (canvasService.isActive()) {
                <div class="controls-fab-column">
                    <button class="fab cornered-fab print-fab" 
                            (click)="canvasService.print()" 
                            aria-label="Print Canvas">
                        <img src="/images/print.svg" alt="Print">
                    </button>
                    <button class="fab cornered-fab clear-fab" 
                            (click)="requestClearAllCanvases()" 
                            aria-label="Clear All Canvases">
                        <img src="/images/delete.svg" alt="Delete">
                    </button>
                    <button class="fab cornered-fab eraser-fab" 
                            [class.active]="canvasService.mode() === 'eraser'" 
                            (click)="canvasService.toggleEraser()"
                            aria-label="Eraser">
                        <svg fill="currentColor" width="20px" height="20px" viewBox="0 5 20 22" version="1.1"
                             xmlns="http://www.w3.org/2000/svg">
                            <path d="M2.125 13.781l7.938-7.938c0.719-0.719 1.813-0.719 2.531 0l7.688 7.688c0.719 0.719 0.719 1.844 0 2.563l-7.938 7.938c-2.813 2.813-7.375 2.813-10.219 0-2.813-2.813-2.813-7.438 0-10.25zM11.063 22.75l-7.656-7.688c-2.125 2.125-2.125 5.563 0 7.688s5.531 2.125 7.656 0z"></path>
                        </svg>
                    </button>
                </div>

                <div class="color-fab-row">
                    @for (color of canvasService.colorOptions; let i = $index; track i) {
                        <button class="fab cornered-fab color-fab" 
                                [style.backgroundColor]="color"
                                [class.selected]="canvasService.brushColor() === color && canvasService.mode() === 'brush'" 
                                (click)="canvasService.setBrushColor(color)"
                                [attr.aria-label]="'Set color ' + color">
                        </button>
                    }
                </div>

                <div class="line-width-slider-row">
                    <input type="range" 
                           [min]="canvasService.MIN_STROKE_SIZE" 
                           [max]="canvasService.MAX_STROKE_SIZE" 
                           [value]="canvasService.strokeSize()"
                           (input)="onStrokeSizeChange($event)" 
                           aria-label="Brush Size" 
                           (pointerdown)="$event.stopPropagation()"
                           (pointerup)="$event.stopPropagation()" 
                           (pointermove)="$event.stopPropagation()"
                           (click)="$event.stopPropagation()" 
                           (dblclick)="$event.stopPropagation()"
                           (contextmenu)="$event.stopPropagation()" />
                    <span class="line-width-value">{{ canvasService.strokeSize() }}</span>
                </div>
            }
        </div>
    `,
    styleUrl: './page-viewer-canvas-controls.component.scss'
})
export class PageViewerCanvasControlsComponent {
    canvasService = inject(PageViewerCanvasService);
    private dialogsService = inject(DialogsService);

    clearRequested = output<void>();

    mainFabStyle = computed(() => {
        const mode = this.canvasService.mode();
        if (mode === 'brush') {
            return { background: this.canvasService.brushColor(), color: '#fff' };
        }
        if (mode === 'eraser') {
            return { background: '#fbc02d', color: '#222' };
        }
        return { background: 'gray', color: '#fff' };
    });

    onStrokeSizeChange(event: Event): void {
        const value = +(event.target as HTMLInputElement).value;
        this.canvasService.setStrokeSize(value);
    }

    async requestClearAllCanvases(): Promise<void> {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to clear all canvases? This cannot be undone.',
            'Clear All Canvases',
            'info'
        );
        if (confirmed) {
            this.canvasService.clearAllCanvases();
            this.clearRequested.emit();
        }
    }
}
