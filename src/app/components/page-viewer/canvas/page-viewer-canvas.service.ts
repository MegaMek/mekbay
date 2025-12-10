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

import { Injectable, signal, computed, inject } from '@angular/core';
import { OptionsService } from '../../../services/options.service';

/*
 * Author: Drake
 * 
 * PageViewerCanvasService - Global state service for canvas drawing across multiple pages.
 * 
 * This service manages:
 * - Drawing mode (brush/eraser/none)
 * - Brush color selection
 * - Stroke sizes for brush and eraser
 * - Coordination between multiple canvas overlays and the controls
 */

export type CanvasMode = 'brush' | 'eraser' | 'none';

export interface CanvasState {
    brushSize: number;
    eraserSize: number;
}

@Injectable()
export class PageViewerCanvasService {
    private readonly INITIAL_BRUSH_SIZE = 4;
    private readonly INITIAL_ERASER_SIZE = 4;
    readonly MIN_STROKE_SIZE = 1;
    readonly MAX_STROKE_SIZE = 10;

    private optionsService = inject(OptionsService);

    // Global drawing state
    readonly mode = signal<CanvasMode>('none');
    readonly brushColor = signal<string>('#f00');
    readonly colorOptions = ['#f00', '#00f', '#0f0', '#f0f', '#0ff', '#ff0'];
    
    readonly brushSize = signal<number>(
        this.optionsService.options().lastCanvasState?.brushSize ?? this.INITIAL_BRUSH_SIZE
    );
    readonly eraserSize = signal<number>(
        this.optionsService.options().lastCanvasState?.eraserSize ?? this.INITIAL_ERASER_SIZE
    );

    readonly strokeSize = computed(() => {
        return this.mode() === 'brush' ? this.brushSize() : this.eraserSize();
    });

    readonly isActive = computed(() => this.mode() !== 'none');

    // Registered canvas overlays (for clear all functionality)
    private registeredCanvases = new Map<string, () => void>();

    /**
     * Toggle drawing mode on/off
     */
    toggleDrawMode(): void {
        if (this.mode() === 'none') {
            this.mode.set('brush');
        } else {
            this.mode.set('none');
        }
    }

    /**
     * Toggle eraser mode
     */
    toggleEraser(): void {
        if (this.mode() === 'eraser') {
            this.mode.set('brush');
        } else {
            this.mode.set('eraser');
        }
    }

    /**
     * Set brush color and switch to brush mode
     */
    setBrushColor(color: string): void {
        this.brushColor.set(color);
        this.mode.set('brush');
    }

    /**
     * Update stroke size based on current mode
     */
    setStrokeSize(value: number): void {
        const canvasState = this.optionsService.options().lastCanvasState ?? {
            brushSize: this.INITIAL_BRUSH_SIZE,
            eraserSize: this.INITIAL_ERASER_SIZE
        };

        if (this.mode() === 'brush') {
            this.brushSize.set(value);
            canvasState.brushSize = value;
        } else {
            this.eraserSize.set(value);
            canvasState.eraserSize = value;
        }

        this.optionsService.setOption('lastCanvasState', { ...canvasState });
    }

    /**
     * Register a canvas clear callback for global clear functionality
     */
    registerCanvas(id: string, clearCallback: () => void): void {
        this.registeredCanvases.set(id, clearCallback);
    }

    /**
     * Unregister a canvas when it's destroyed
     */
    unregisterCanvas(id: string): void {
        this.registeredCanvases.delete(id);
    }

    /**
     * Clear a specific canvas by its ID (unit ID)
     */
    clearCanvas(id: string): void {
        const callback = this.registeredCanvases.get(id);
        if (callback) {
            callback();
        }
    }

    /**
     * Clear all registered canvases
     */
    clearAllCanvases(): void {
        this.registeredCanvases.forEach(callback => callback());
    }

    /**
     * Print the current view
     */
    print(): void {
        window.print();
    }
}
