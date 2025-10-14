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
import { Component, ChangeDetectionStrategy, inject, input, signal, viewChild, Signal, effect, computed } from '@angular/core';
import { Stage, StageConfig } from 'konva/lib/Stage';
import { Layer } from 'konva/lib/Layer';
import { Line, LineConfig } from 'konva/lib/shapes/Line';
import { SvgZoomPanService } from './svg-zoom-pan.service';
import { StageComponent, CoreShapeComponent, NgKonvaEventObject } from 'ng2-konva';
import { gzip, ungzip, Data } from 'pako';

/*
 * Author: Drake
 */

@Component({
    selector: 'svg-canvas-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, StageComponent, CoreShapeComponent],
    template: `
    <div class="svg-canvas-overlay" [class.active]="mode() !== 'none'"
      [ngStyle]="overlayTransformStyle()">
      <ko-stage #stage
        [config]="stageConfig"
        (mousedown)="onPointerDown($event)"
        (touchstart)="onPointerDown($event)"
        (mouseup)="onPointerUp($event)"
        (touchend)="onPointerUp($event)"
        (mousemove)="onPointerMove($event)"
        (touchmove)="onPointerMove($event)"
      ><ko-layer #drawLayer></ko-layer></ko-stage>
    </div>
    <div class="tools">
        <select class="tool-select" [value]="mode()" (change)="setMode($event)">
            <option value="none">None</option>
            <option value="brush">Brush</option>
            <option value="eraser">Eraser</option>
        </select>
        <select class="color-select" [value]="brushColor()" (change)="setBrushColor($event)">
            <option value="#f00">Red</option>
            <option value="#00f">Blue</option>
            <option value="#0f0">Green</option>
            <option value="#f0f">Fuchsia</option>
            <option value="#0ff">Cyan</option>
            <option value="#ff0">Yellow</option>
        </select>
        <button class="undo-btn" (click)="undo()">Undo</button>
        <button class="clear-btn" (click)="clearCanvas()">Clear</button>
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
            opacity: 0.9;
            background: transparent;
            cursor: crosshair;
        }
        .tools {
            pointer-events: auto;
            position: fixed;
            top: 8px;
            left: 8px;
            z-index: 10;
        }`,
})
export class SvgCanvasOverlayComponent {
    private static INTERNAL_SCALE = 1;
    private static REDUCE_WINDOW_SIZE = 10;
    private static MAX_LINES = 1000;
    private static MAX_LINE_POINTS = 3000;
    private zoomPanService = inject(SvgZoomPanService);
    stageComponent = viewChild('stage') as Signal<StageComponent | undefined>;
    drawLayerComponent = viewChild('drawLayer') as Signal<CoreShapeComponent | undefined>;
    width = input(200);
    height = input(200);

    stageConfig: Partial<StageConfig> = {};
    isPaint = false;
    lines: Line[] = [];
    private currentLine?: Line;
    lastReducedIndex = 0;
    mode = signal<'brush' | 'eraser' | 'none'>('brush');
    brushColor = signal<string>('#f00');
    
    overlayTransformStyle = computed(() => {
        const state = this.zoomPanService.getState();
        const scale = state.scale() * (1 / SvgCanvasOverlayComponent.INTERNAL_SCALE);
        const translate = state.translate();
        return {
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: '0 0'
        };
    });

    constructor() {
        effect(() => {
            this.updateStageConfig();
        });
        // Generate random lines to fill MAX_LINES and MAX_LINE_POINTS at startup
        setTimeout(() => {
            const stage = this.stageComponent()?.getStage();
            const layer = stage?.getLayers()[0] as Layer | undefined;
            if (!layer) return;

            // Helper to generate a random point within canvas
            const randPoint = () => [
                Math.random() * (this.width() * SvgCanvasOverlayComponent.INTERNAL_SCALE),
                Math.random() * (this.height() * SvgCanvasOverlayComponent.INTERNAL_SCALE)
            ];

            for (let i = 0; i < SvgCanvasOverlayComponent.MAX_LINES; i++) {
                // Distribute points so total does not exceed MAX_LINE_POINTS
                const pointsPerLine = Math.floor(SvgCanvasOverlayComponent.MAX_LINE_POINTS / SvgCanvasOverlayComponent.MAX_LINES);
                const points: number[] = [];
                let last = randPoint();
                points.push(...last);

                for (let j = 1; j < pointsPerLine; j++) {
                    // Next point is a small random step from last
                    last = [
                        Math.max(0, Math.min(this.width() * SvgCanvasOverlayComponent.INTERNAL_SCALE, last[0] + (Math.random() - 0.5) * 40)),
                        Math.max(0, Math.min(this.height() * SvgCanvasOverlayComponent.INTERNAL_SCALE, last[1] + (Math.random() - 0.5) * 40))
                    ];
                    points.push(...last);
                }

                const line = new Line({
                    points,
                    stroke: `hsl(${Math.random() * 360}, 80%, 50%)`,
                    strokeWidth: Math.random() > 0.5 ? 2 : 8,
                    globalCompositeOperation: Math.random() > 0.5 ? 'source-over' : 'destination-out',
                    lineCap: 'round',
                    lineJoin: 'round'
                });
                layer.add(line);
                this.lines.push(line);
            }
            layer.batchDraw();
        }, 0);
    }

    updateStageConfig() {
        this.stageConfig = {
            width: this.width() * SvgCanvasOverlayComponent.INTERNAL_SCALE,
            height: this.height() * SvgCanvasOverlayComponent.INTERNAL_SCALE,
        };
    }

    setMode(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'brush' | 'eraser' | 'none';
        this.mode.set(value);
    }

    setBrushColor(event: Event) {
        const value = (event.target as HTMLSelectElement).value;
        this.brushColor.set(value);
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

    clearCanvas() {
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage.getLayers()[0] as Layer | null;
        if (!layer) return;
        this.lines.forEach(line => line.destroy());
        this.lines = [];
        layer.batchDraw();
    }

    onWheel(event: WheelEvent) {
    }

    onPointerDown(event: NgKonvaEventObject<MouseEvent | TouchEvent>) {       
        if (this.isPaint) return;
        const stage = this.stageComponent()?.getStage();
        if (!stage) return;
        const layer = stage.getLayers()[0] as Layer | null;
        if (!layer) return;
        const pos = (stage as Stage).getPointerPosition();
        if (!pos) return;
        const mode = this.mode();
        this.isPaint = true;
        this.currentLine = new Line({
            points: [pos.x, pos.y, pos.x, pos.y],
            stroke: mode === 'brush' ? this.brushColor() : '#000',
            strokeWidth: mode === 'brush' ? 2 : 8,
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

    onPointerUp(event: NgKonvaEventObject<MouseEvent | TouchEvent>) {
        if (!this.isPaint) return;
        this.isPaint = false;
        this.currentLine?.points(this.reduceNearPoints(this.currentLine.points(), 1, 0.03));
        this.currentLine = undefined;
        // Calculate how much memory we are using for lines
        const linesData = this.compressVectorData();
        const sizeInKB = new Blob([linesData as any]).size / 1024;
        console.log(`Current vector data size: ${sizeInKB.toFixed(2)} KB`);
    }

    onPointerMove(event: NgKonvaEventObject<MouseEvent | TouchEvent>) {
        if (!this.isPaint || !this.currentLine) return;
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
        const start = Math.max(0, newPoints.length - SvgCanvasOverlayComponent.REDUCE_WINDOW_SIZE * 2);
        const prefix = newPoints.slice(0, start);
        const segment = newPoints.slice(start);
        const reducedSegment = this.reduceNearPoints(segment, 1, 0.02);
        const reducedPoints = [...prefix, ...reducedSegment];
        this.currentLine.points(reducedPoints);
        // Limit the number of points to prevent memory issues, we remove the oldest points
        if (this.currentLine.points().length > SvgCanvasOverlayComponent.MAX_LINE_POINTS) {
            const excessPoints = this.currentLine.points().length - SvgCanvasOverlayComponent.MAX_LINE_POINTS;
            this.currentLine.points(this.currentLine.points().slice(excessPoints));
        }
        layer.batchDraw();
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