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
import { Component, ChangeDetectionStrategy, inject, input, DestroyRef, signal, viewChild, effect, computed, ElementRef, afterNextRender } from '@angular/core';
import { SvgZoomPanService } from './svg-zoom-pan.service';
import { Dialog } from '@angular/cdk/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { firstValueFrom } from 'rxjs';

/*
 * Author: Drake
 */

@Component({
    selector: 'svg-direct-canvas-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div #canvasOverlay class="svg-canvas-overlay" [class.active]="mode() !== 'none'">
      <canvas #canvas
        class="drawing-canvas"
        [width]="canvasWidth"
        [height]="canvasHeight"
        [ngStyle]="canvasTransformStyle()"
      ></canvas>
    </div>
    <div class="fab-container"
        (pointerdown)="$event.stopPropagation()"
        (pointerup)="$event.stopPropagation()"
        (pointermove)="$event.stopPropagation()"
        (mousedown)="$event.stopPropagation()"
        (mouseup)="$event.stopPropagation()"
        (mousemove)="$event.stopPropagation()"
        (click)="$event.stopPropagation()"
        (touchstart)="$event.stopPropagation()"
        (touchend)="$event.stopPropagation()"
        (touchmove)="$event.stopPropagation()"
        (contextmenu)="$event.stopPropagation()"
    >
      <button class="fab main-fab"
        [ngStyle]="mainFabStyle()"
        [class.active]="mode() !== 'none'"
        (click)="toggleDrawMode()"
        aria-label="Toggle Draw Mode">D</button>
        @if (mode() !== 'none') {
        <div class="controls-fab-column">
            <button class="fab mini-fab clear-fab" (click)="requestClearCanvas()" aria-label="Clear Canvas">C</button>
            <button class="fab mini-fab eraser-fab"
            [class.active]="mode() === 'eraser'"
            (click)="toggleEraser()"
            aria-label="Eraser">E</button>
        </div>
        <div class="color-fab-row">
          @for (color of colorOptions; let i = $index; track i) {
            <button
                class="fab mini-fab color-fab"
                [ngStyle]="{'background': color}"
                [class.selected]="brushColor() === color && mode() === 'brush'"
                (click)="setBrushColor(color)"
                [attr.aria-label]="'Set color ' + color">
            </button>
          }
        </div>
        <div class="line-width-slider-row">
          <input
            type="range"
            min="2"
            max="24"
            [value]="brushSize()"
            (input)="onBrushSizeChange($event)"
            aria-label="Brush Size"
            (pointerdown)="$event.stopPropagation()"
            (pointerup)="$event.stopPropagation()"
            (pointermove)="$event.stopPropagation()"
            (mousedown)="$event.stopPropagation()"
            (mouseup)="$event.stopPropagation()"
            (mousemove)="$event.stopPropagation()"
            (click)="$event.stopPropagation()"
            (touchstart)="$event.stopPropagation()"
            (touchend)="$event.stopPropagation()"
            (touchmove)="$event.stopPropagation()"
            (contextmenu)="$event.stopPropagation()"
          />
          <span class="line-width-value">{{ brushSize() }}</span>
        </div>
        }
    </div>
    `,
    styles: `
        :host {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            transform: translateX(0px);
            pointer-events: none;
            overflow: hidden;
        }
        .svg-canvas-overlay {
            position: absolute;
            pointer-events: none;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: 5;
            box-sizing: border-box;
            transform: translateX(0px);
            box-sizing: border-box;
        }
        .drawing-canvas {
            pointer-events: none;
            width: 100%;
            height: 100%;
            display: block;
            background: transparent;
            cursor: crosshair;
            opacity: 0.95;
            box-sizing: border-box;
        }
        .svg-canvas-overlay.active .drawing-canvas {
            pointer-events: auto;
        }
        /* Controls */
        .fab-container {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 20;
            pointer-events: none;
            width: 56px;
            height: 56px;
        }
        .fab {
            border: none;
            outline: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            min-width: 32px;
            min-height: 32px;
            background: #fff;
            color: #222;
            box-shadow: 0 2px 8px rgba(0,0,0,0.18);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 24px;
            position: relative;
            pointer-events: auto;
            transition: box-shadow 0.2s, color 0.2s, border 0.2s, width 0.2s, height 0.2s;
        }
        .fab.main-fab {
            background: gray;
            color: #fff;
            width: 56px;
            height: 56px;
            min-width: 56px;
            min-height: 56px;
        }
        .fab.mini-fab.active,
        .fab.mini-fab.selected {
            background: #1976d2;
            color: #fff;
        }
        .fab.eraser-fab.active {
            background: #fbc02d;
            color: #222;
        }
        .fab.clear-fab {
            background: #fff;
            color: #f44336;
        }
        .controls-fab-column {
            position: absolute;
            bottom: 64px;
            left: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
        }
        .color-fab-row {
            position: absolute;
            height: 32px;
            right: 64px;
            bottom: 12px;
            display: flex;
            flex-direction: row;
            gap: 4px;
            z-index: 1;
            align-items: center;
        }
        .fab.color-fab {
            border: 2px solid #fff;
            width: 24px;
            height: 24px;
            min-width: 24px;
            min-height: 24px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        }
        .fab.color-fab.selected {
            width: 32px;
            height: 32px;
            min-width: 32px;
            min-height: 32px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        }
        .line-width-slider-row {
            position: absolute;
            right: 64px;
            bottom: 48px;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 1;
            width: 120px;
            pointer-events: auto;
        }
        .line-width-slider-row input[type="range"] {
            pointer-events: auto;
            flex: 1;
            accent-color: #1976d2;
        }
        .line-width-value {
            min-width: 24px;
            text-align: center;
            font-size: 14px;
            color: #222;
            background: #fff;
            border-radius: 8px;
            padding: 2px 6px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }`,
})
export class SvgDirectCanvasOverlayComponent {
    private static INTERNAL_SCALE = 2;
    private static BRUSH_SIZE = 4;
    private static ERASER_SIZE_MULTIPLIER = 2;
    private destroyRef = inject(DestroyRef);
    private zoomPanService = inject(SvgZoomPanService);
    private dialog = inject(Dialog);
    canvasOverlayRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasOverlay');
    canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
    width = input(612);
    height = input(792);
    canvasWidth = 612;
    canvasHeight = 792;
    canvasData = input<string | null>(null);
    lastPoint: { x: number, y: number } | null = null;
    isPaint = false;
    private isRightPaint = false; // right-click eraser
    mode = signal<'brush' | 'eraser' | 'none'>('none');
    brushColor = signal<string>('#f00');
    colorOptions = ['#f00', '#00f', '#0f0', '#f0f', '#0ff', '#ff0'];
    brushSize = signal<number>(SvgDirectCanvasOverlayComponent.BRUSH_SIZE);

    private nativePointerDown = (event: MouseEvent | TouchEvent) => this.onPointerDown(event);
    private nativePointerUp = (event: MouseEvent | TouchEvent) => this.onPointerUp(event);
    private nativePointerMove = (event: MouseEvent | TouchEvent) => this.onPointerMove(event);

    canvasTransformStyle = computed(() => {
        const state = this.zoomPanService.getState();
        const scale = state.scale();
        const translate = state.translate();
        return {
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            width: this.width() + 'px',
            height: this.height() + 'px',
        };
    });

    mainFabStyle = computed(() => {
        if (this.mode() === 'brush') {
            return { background: this.brushColor(), color: '#fff' };
        }
        if (this.mode() === 'eraser') {
            return { background: '#fbc02d', color: '#222' };
        }
        // Default (inactive)
        return { background: 'gray', color: '#fff' };
    });

    get nativeElement(): HTMLElement {
        return this.canvasOverlayRef().nativeElement;
    }

    constructor() {
        effect(() => {
            this.canvasWidth = this.width() * SvgDirectCanvasOverlayComponent.INTERNAL_SCALE;
            this.canvasHeight = this.height() * SvgDirectCanvasOverlayComponent.INTERNAL_SCALE;
        });
        effect(() => {
            console.log('Canvas data changed, importing...');
            const data = this.canvasData();
            this.clearCanvas();
            if (data) {
                this.importImageData(data);
            }
        });
        afterNextRender(() => {
            this.addEventListeners();
        });
        this.destroyRef.onDestroy(() => {
            const canvas = this.canvasRef()?.nativeElement;
            if (canvas) {
                canvas.removeEventListener('pointerdown', this.nativePointerDown);
                canvas.removeEventListener('touchstart', this.nativePointerDown);
                canvas.removeEventListener('pointerup', this.nativePointerUp);
                canvas.removeEventListener('touchend', this.nativePointerUp);
                canvas.removeEventListener('pointermove', this.nativePointerMove);
                canvas.removeEventListener('touchmove', this.nativePointerMove);
            }
        });
    }

     addEventListeners() {
        const canvas = this.canvasRef()?.nativeElement;
        if (canvas) {
            canvas.addEventListener('pointerdown', this.nativePointerDown);
            canvas.addEventListener('touchstart', this.nativePointerDown, { passive: false });
            canvas.addEventListener('pointerup', this.nativePointerUp);
            canvas.addEventListener('touchend', this.nativePointerUp, { passive: false });
            canvas.addEventListener('pointermove', this.nativePointerMove);
            canvas.addEventListener('touchmove', this.nativePointerMove, { passive: false });
        }
    }
    
    onBrushSizeChange(event: Event) {
        const value = +(event.target as HTMLInputElement).value;
        this.brushSize.set(value);
    }

    toggleDrawMode() {
        if (this.mode() === 'none') {
            this.mode.set('brush');
        } else {
            this.mode.set('none');
        }
    }

    toggleEraser() {
        if (this.mode() === 'eraser') {
            this.mode.set('brush');
        } else {
            this.mode.set('eraser');
        }
    }

    setBrushColor(color: string) {
        this.brushColor.set(color);
        this.mode.set('brush');
    }

    async requestClearCanvas() {
        const dialogRef = this.dialog.open<string>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<string>>{
                title: 'Clear Canvas',
                message: 'Are you sure you want to clear the canvas?',
                buttons: [
                    { label: 'CONFIRM', value: 'clear', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' }
                ]
            }
        });
        const result = await firstValueFrom(dialogRef.closed);

        if (result === 'clear') {
            this.clearCanvas();
        }
    }

    clearCanvas() {
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    private getCanvasContext(): CanvasRenderingContext2D | null {
        return this.canvasRef()?.nativeElement.getContext('2d') ?? null;
    }

    private getPointerPosition(event: MouseEvent | TouchEvent): { x: number, y: number } | null {
        const el = this.canvasRef()?.nativeElement;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        let clientX: number, clientY: number;
        if (event instanceof TouchEvent) {
            if (event.touches.length === 0) return null;
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        return {
            x: (clientX - rect.left) * (el.width / rect.width),
            y: (clientY - rect.top) * (el.height / rect.height)
        };
    }

    onPointerDown(event: MouseEvent | TouchEvent) {
        if (this.mode() === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        const pos = this.getPointerPosition(event);
        if (!pos) return;
        this.isPaint = true;
        this.lastPoint = pos;
        if (event instanceof MouseEvent && event.button === 2) {
            this.isRightPaint = true;
        }
        // draw initial dot
        const ctx = this.getCanvasContext();
        if (ctx) {
            this.draw(ctx, pos);
        }
    }

    draw(ctx: CanvasRenderingContext2D, pos: { x: number, y: number }) {
        if (!this.lastPoint) return;
        ctx.save();
        if (this.mode() === 'eraser' || this.isRightPaint) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.lineWidth = this.brushSize() * SvgDirectCanvasOverlayComponent.ERASER_SIZE_MULTIPLIER;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = this.brushColor();
            ctx.lineWidth = this.brushSize();
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.restore();
    }

    onPointerUp(event: MouseEvent | TouchEvent) {
        if (this.mode() === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        if (!this.isPaint) return;
        if (event instanceof MouseEvent && event.button === 2) {
            this.isRightPaint = false;
        }
        this.isPaint = false;
        this.lastPoint = null;
        // Export canvas data
        const canvasData = this.exportImageData();
        // Memory evaluation
        const blob = new Blob([canvasData ?? '']);
        const sizeKB = blob.size / 1024;
        console.log(`Canvas image size is ${sizeKB.toFixed(2)} KB`);
    }

    onPointerMove(event: MouseEvent | TouchEvent) {
        if (this.mode() === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        if (!this.isPaint || !this.lastPoint) return;
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        const pos = this.getPointerPosition(event);
        if (!pos) return;
        this.draw(ctx, pos);
        this.lastPoint = pos;
    }

    reduceNearPoints(points: number[], minDist = 2, angleEpsilon = 0.01): number[] {
        if (points.length < 4) return points;
        const reduced: number[] = [points[0], points[1]];

        for (let i = 2; i < points.length; i += 2) {
            const lastX = reduced[reduced.length - 2];
            const lastY = reduced[reduced.length - 1];
            const x = points[i];
            const y = points[i + 1];
            const dx = x - lastX;
            const dy = y - lastY;
            if (dx * dx + dy * dy >= minDist * minDist) {
                reduced.push(x, y);
            }
        }

        // Further optimize by removing collinear points (straight lines)
        let i = 2;
        while (i < reduced.length - 2) {
            const x0 = reduced[i - 2], y0 = reduced[i - 1];
            const x1 = reduced[i],     y1 = reduced[i + 1];
            const x2 = reduced[i + 2], y2 = reduced[i + 3];

            // Vectors: v1 = (x1-x0, y1-y0), v2 = (x2-x1, y2-y1)
            const v1x = x1 - x0, v1y = y1 - y0;
            const v2x = x2 - x1, v2y = y2 - y1;
            const len1 = Math.hypot(v1x, v1y);
            const len2 = Math.hypot(v2x, v2y);

            if (len1 > 0 && len2 > 0) {
                // Calculate angle between vectors
                const dot = v1x * v2x + v1y * v2y;
                const cos = dot / (len1 * len2);
                // If angle is very close to 0 (cos ~ 1), remove the middle point
                if (Math.abs(1 - cos) < angleEpsilon) {
                    reduced.splice(i, 2);
                    continue; // Stay at same index to check next triplet
                }
            }
            i += 2;
        }

        return reduced;
    }

    public exportImageData(): string | null {
        const canvas = this.canvasRef();
        if (!canvas) return null;
        return canvas.nativeElement.toDataURL('image/webp');
    }

    public importImageData(dataUrl: string) {
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        const img = new window.Image();
        img.onload = () => {
            ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
            ctx.drawImage(img, 0, 0, this.canvasWidth, this.canvasHeight);
        };
        img.src = dataUrl;
    }
}