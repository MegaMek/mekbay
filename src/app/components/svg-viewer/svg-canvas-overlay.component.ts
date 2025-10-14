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
import { Component, ChangeDetectionStrategy, inject, input, signal, viewChild, Signal, effect, computed, DestroyRef, afterNextRender } from '@angular/core';
import { Stage, StageConfig } from 'konva/lib/Stage';
import { Layer } from 'konva/lib/Layer';
import { Line, LineConfig } from 'konva/lib/shapes/Line';
import { SvgZoomPanService } from './svg-zoom-pan.service';
import { StageComponent, CoreShapeComponent, NgKonvaEventObject } from 'ng2-konva';
import { gzip, ungzip, Data } from 'pako';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { Dialog } from '@angular/cdk/dialog';

/*
 * Author: Drake
 */

@Component({
    selector: 'svg-canvas-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, StageComponent, CoreShapeComponent],
    template: `
    <div class="svg-canvas-overlay" [class.active]="mode() !== 'none'">
      <div #stageContainer class="stageContainer">
      <ko-stage #stage
        class="drawing-canvas"
        [ngStyle]="canvasTransformStyle()"
        [config]="stageConfig"
      ><ko-layer #drawLayer></ko-layer></ko-stage>
      </div>
    </div>
    <div class="fab-container"
        (pointerdown)="$event.stopPropagation()"
        (pointerup)="$event.stopPropagation()"
        (pointermove)="$event.stopPropagation()"
        (mousedown)="$event.stopPropagation()"
        (mouseup)="$event.stopPropagation()"
        (mousemove)="$event.stopPropagation()"
        (click)="$event.stopPropagation()"
        (dblclick)="$event.stopPropagation()"
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
            <button class="fab mini-fab undo-fab" (click)="undo()" aria-label="Undo">U</button>
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
            min="4"
            max="20"
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
            (dblclick)="$event.stopPropagation()"
            (touchstart)="$event.stopPropagation()"
            (touchend)="$event.stopPropagation()"
            (touchmove)="$event.stopPropagation()"
            (contextmenu)="$event.stopPropagation()"
          />
          <span class="line-width-value">{{ brushSize() }}</span>
          <div class="notice">TEST: this will not be saved!</div>
        </div>
    }
    </div>    
  `,
    styles: `
        .svg-canvas-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            pointer-events: none;
            z-index: 5;
        }
        .svg-canvas-overlay ko-stage {
            width: 100%;
            height: 100%;
            display: block;
            pointer-events: none;
        }
        .svg-canvas-overlay.active ko-stage {
            pointer-events: auto;
        }
        ko-stage {
            opacity: 0.95;
            background: transparent;
            cursor: crosshair;
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
            bottom: 0px;
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
            right: 60px;
            bottom: 35px;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 1;
            pointer-events: auto;
        }
        .line-width-slider-row input[type="range"] {
            width: 100px;
            pointer-events: auto;
            flex: 1;
            accent-color: black;
        }
        :host-context(.night-mode) .line-width-slider-row input[type="range"] {
            accent-color: white;
        }
        
        .line-width-value {
            min-width: 20px;
            text-align: center;
            font-size: 14px;
            color: #fff;
            background: #222;
            border-radius: 8px;
            padding: 2px 6px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }
        :host-context(.night-mode) .line-width-value {
            color: #222;
            background: #fff;
        }
        .notice {
            position: absolute;
            top: -20px;
            right: 2px;
            font-weight: bold;
            color: #f00;
            width: 204px;
        }
`,
})
export class SvgCanvasOverlayComponent {
    private static INTERNAL_SCALE = 1;
    private static REDUCE_WINDOW_SIZE = 40;
    private static MAX_LINES = 1000;
    private static MAX_STROKE_POINTS = 1000;
    private static MAX_STROKE_ERASER_POINTS = 10000;
    private static BRUSH_SIZE = 3;
    private static ERASER_SIZE_MULTIPLIER = 2;
    private destroyRef = inject(DestroyRef);
    private zoomPanService = inject(SvgZoomPanService);
    private dialog = inject(Dialog);
    stageContainer = viewChild.required('stageContainer') as Signal<HTMLDivElement>;
    stageComponent = viewChild('stage') as Signal<StageComponent | undefined>;
    drawLayerComponent = viewChild('drawLayer') as Signal<CoreShapeComponent | undefined>;
    width = input(200);
    height = input(200);

    stageConfig: Partial<StageConfig> = {};
    isPaint = false;
    lines: Line[] = [];
    private currentLine?: Line;
    lastReducedIndex = 0;
    canvasData = input<string | null>(null);
    mode = signal<'brush' | 'eraser' | 'none'>('none');
    brushColor = signal<string>('#f00');
    colorOptions = ['#f00', '#00f', '#0f0', '#f0f', '#0ff', '#ff0'];
    brushSize = signal<number>(SvgCanvasOverlayComponent.BRUSH_SIZE);


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

    get nativeElement(): HTMLElement | undefined {
        return this.stageComponent()?.getStage().content;
    }

    constructor() {
        effect(() => {
            this.updateStageConfig();
        });
        effect(() => {
            console.log('Canvas data changed, importing...');
            const data = this.canvasData();
            this.clearCanvas();
        });
        afterNextRender(() => {
            this.addEventListeners();
        });
        this.destroyRef.onDestroy(() => {
            const stageContent = this.stageComponent()?.getStage().content;
            if (stageContent) {
                stageContent.removeEventListener('pointerdown', this.nativePointerDown);
                stageContent.removeEventListener('touchstart', this.nativePointerDown);
                stageContent.removeEventListener('pointerup', this.nativePointerUp);
                stageContent.removeEventListener('touchend', this.nativePointerUp);
                stageContent.removeEventListener('pointermove', this.nativePointerMove);
                stageContent.removeEventListener('touchmove', this.nativePointerMove);
            }
        });
    }

    addEventListeners() {
        const stageContent = this.stageComponent()?.getStage().content;
        if (stageContent) {
            stageContent.addEventListener('pointerdown', this.nativePointerDown);
            stageContent.addEventListener('touchstart', this.nativePointerDown, { passive: false });
            stageContent.addEventListener('pointerup', this.nativePointerUp);
            stageContent.addEventListener('touchend', this.nativePointerUp, { passive: false });
            stageContent.addEventListener('pointermove', this.nativePointerMove);
            stageContent.addEventListener('touchmove', this.nativePointerMove, { passive: false });
        }
    }

    updateStageConfig() {
        this.stageConfig = {
            width: this.width() * SvgCanvasOverlayComponent.INTERNAL_SCALE,
            height: this.height() * SvgCanvasOverlayComponent.INTERNAL_SCALE,
        };
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

    undo() {
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage.getLayers()[0] as Layer | null;
        if (!layer) return;
        const lastLine = this.lines.pop();
        if (!lastLine) return;
        lastLine?.destroy();
        layer.batchDraw();
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
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage.getLayers()[0] as Layer | null;
        if (!layer) return;
        this.lines.forEach(line => line.destroy());
        this.lines = [];
        layer.batchDraw();
    }

    onPointerDown(event: MouseEvent | TouchEvent) {
        const mode = this.mode();
        if (mode === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        if (this.isPaint) return;
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage.getLayers()[0] as Layer | null;
        if (!layer) return;
        const pos = (stage as Stage).getPointerPosition();
        if (!pos) return;
        this.isPaint = true;
        this.currentLine = new Line({
            points: [pos.x, pos.y, pos.x, pos.y],
            stroke: mode === 'brush' ? this.brushColor() : '#000',
            strokeWidth: mode === 'brush' ? this.brushSize() : this.brushSize() * SvgCanvasOverlayComponent.ERASER_SIZE_MULTIPLIER,
            globalCompositeOperation: mode === 'brush' ? 'source-over' : 'destination-out',
            lineCap: 'round',
            lineJoin: 'round'
        });
        layer.add(this.currentLine);
        if (this.lines.length >= SvgCanvasOverlayComponent.MAX_LINES) {
            const oldLine = this.lines.shift();
            oldLine?.destroy();
        }
        this.lines.push(this.currentLine);
        this.lastReducedIndex = 0;
        layer.batchDraw();
    }

    onPointerUp(event: MouseEvent | TouchEvent) {
        if (!this.isPaint) return;
        const mode = this.mode();
        if (mode === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        this.isPaint = false;
        this.currentLine?.points(this.reduceNearPoints(this.currentLine.points(), 1, 0.01));
        this.currentLine = undefined;
        // Calculate how much memory we are using for lines
        const linesData = this.compressVectorData();
        const sizeInKB = new Blob([linesData as any]).size / 1024;
        console.log(`Current vector data size: ${sizeInKB.toFixed(2)} KB`);
    }

    onPointerMove(event: MouseEvent | TouchEvent) {
        if (!this.isPaint || !this.currentLine) return;
        const mode = this.mode();
        if (mode === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage.getLayers()[0] as Layer | null;
        if (!layer) return;
        const pos = (stage as Stage).getPointerPosition();
        if (!pos) return;
        const lastIndex = this.lines.length - 1;
        if (lastIndex < 0) return;
        const oldPoints = this.currentLine.points();
        const newPoints = [...oldPoints, pos.x, pos.y];
        const start = Math.max(0, newPoints.length - SvgCanvasOverlayComponent.REDUCE_WINDOW_SIZE);
        const prefix = newPoints.slice(0, start);
        const segment = newPoints.slice(start);
        const reducedSegment = this.reduceNearPoints(segment, 1, 0.01);
        const reducedPoints = [...prefix, ...reducedSegment];
        this.currentLine.points(reducedPoints);
        // Limit the number of points to prevent memory issues, we remove the oldest points
        if (this.mode() === 'eraser' && this.currentLine.points().length > SvgCanvasOverlayComponent.MAX_STROKE_ERASER_POINTS) {
            const excessPoints = this.currentLine.points().length - SvgCanvasOverlayComponent.MAX_STROKE_ERASER_POINTS;
            this.currentLine.points(this.currentLine.points().slice(excessPoints));
        } else if (this.currentLine.points().length > SvgCanvasOverlayComponent.MAX_STROKE_POINTS) {
            const excessPoints = this.currentLine.points().length - SvgCanvasOverlayComponent.MAX_STROKE_POINTS;
            this.currentLine.points(this.currentLine.points().slice(excessPoints));
        }
        layer.batchDraw();
    }

    reduceNearPoints(points: number[], minDist = 2, angleEpsilon = 0.01): number[] {
        if (points.length <= 4) return points;
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
            const x1 = reduced[i], y1 = reduced[i + 1];
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
                    if (reduced.length <= 4) break;
                    continue; // Stay at same index to check next triplet
                }
            }
            i += 2;
        }
        if (reduced.length < 4 && points.length >= 4) {
            return points.slice(0, 4);
        }
        return reduced;
    }

    public compressVectorData(): pako.Data {
        const compact = this.lines.map(line => [
            line.points().map(n => +Math.round(n)),
            line.stroke(),
            line.strokeWidth(),
            line.globalCompositeOperation()
        ]);
        return gzip(JSON.stringify(compact));
    }

    public decompressVectorData(gzipCompressedData: Data): any[] {
        const lines = [];
        const compact = JSON.parse(ungzip(gzipCompressedData, { to: 'string' }));
        for (const [points, stroke, strokeWidth, gco] of compact) {
            const line = {
                points,
                stroke,
                strokeWidth,
                globalCompositeOperation: gco,
                lineCap: 'round',
                lineJoin: 'round'
            };
            lines.push(line);
        }
        return lines;
    }

    public exportVectorData() {
        return this.lines.map(line => ({
            points: line.points(),
            stroke: line.stroke(),
            strokeWidth: line.strokeWidth(),
            globalCompositeOperation: line.globalCompositeOperation(),
            lineCap: line.lineCap(),
            lineJoin: line.lineJoin()
        }));
    }

    public importVectorData(vectorData: LineConfig[]) {
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage?.getLayer() as Layer | null;
        if (!layer) return;
        this.lines.forEach(line => line.destroy());
        this.lines = [];
        for (const cfg of vectorData) {
            const line = new Line(cfg);
            layer.add(line);
            this.lines.push(line);
        }
        layer.batchDraw();
    }
}