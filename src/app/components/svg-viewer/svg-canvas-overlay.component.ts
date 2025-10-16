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
import { Component, ChangeDetectionStrategy, inject, Injector, input, signal, viewChild, Signal, effect, computed, DestroyRef, afterNextRender, ElementRef } from '@angular/core';
import { SvgZoomPanService } from './svg-zoom-pan.service';
import { OptionsService } from '../../services/options.service';
import { DbService } from '../../services/db.service';
import { DialogsService } from '../../services/dialogs.service';

/*
 * Author: Drake
 */

interface brushLocation {
    x: number;
    y: number;
    mode: 'brush' | 'eraser';
}

@Component({
    selector: 'svg-canvas-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div #canvasOverlay class="svg-canvas-overlay" [class.active]="mode() !== 'none'">
        <div #canvasContainer class="drawing-canvas"
            [ngStyle]="canvasTransformStyle()"
            (mousedown)="bubbleInterceptor($event)"
            (mouseup)="bubbleInterceptor($event)"
            (mousemove)="bubbleInterceptor($event)"
            (touchstart)="bubbleInterceptor($event)"
            (touchend)="bubbleInterceptor($event)"
            (touchmove)="bubbleInterceptor($event)"
        >
            <canvas #canvas [width]="canvasWidth()" [height]="canvasHeight()"></canvas>
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
    >
      <button class="fab main-fab"  
        [ngStyle]="mainFabStyle()"
        [class.active]="mode() !== 'none'"
        (click)="toggleDrawMode()"
        aria-label="Toggle Draw Mode"><img src="/images/draw.svg" alt="Draw"></button>
        @if (mode() !== 'none') {
        <div class="controls-fab-column">
            <button class="fab mini-fab print-fab" (click)="print()" aria-label="Print Canvas"><img src="/images/print.svg" alt="Print"></button>
            <button class="fab mini-fab clear-fab" (click)="requestClearCanvas()" aria-label="Clear Canvas"><img src="/images/delete.svg" alt="Delete"></button>
            <button class="fab mini-fab eraser-fab"
            [class.active]="mode() === 'eraser'"
            (click)="toggleEraser()"
            aria-label="Eraser"><img src="/images/eraser.svg" alt="Eraser"></button>
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
            min="{{ this.MIN_STROKE_SIZE }}"
            max="{{ this.MAX_STROKE_SIZE }}"
            [value]="strokeSize()"
            (input)="onStrokeSizeChange($event)"
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
          <span class="line-width-value">{{ strokeSize() }}</span>
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
        .drawing-canvas canvas {
            width: 100%;
            height: 100%;
            display: block;
            pointer-events: none;
        }
        /* Controls */
        .fab-container {
            position: fixed;
            bottom: 0;
            right: 0;
            z-index: 20;
            pointer-events: none;
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
            transition: box-shadow 0.2s, color 0.2s, border 0.2s, width 0.2s, height 0.2s, transform 0.15s;
            transform-origin: center;
        }
        .fab img {
            pointer-events: none;
        }
        .fab:hover {
            transform: scale(1.12);
            z-index: 2;
        }
        .fab.main-fab {
            position: absolute;
            background: gray;
            color: #fff;
            width: 96px;
            height: 96px;
            left: -48px;
            bottom: -48px;
            opacity: .8;
        }
        .fab.main-fab img {
            position: absolute;
            top: 16px;
            left: 16px;
        }
        .fab.main-fab.active {
            opacity: 1;
            transform: scale(1.15);
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
            left: -42px;
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
            right: 56px;
            bottom: 56px;
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
        @media print {
            .svg-canvas-overlay {
                transform: none !important;
            }
            .drawing-canvas {
                width: 8.5in !important;
                height: 11in !important;
                padding: 0 !important;
                transform: none !important;
                max-width: calc(100% - 0.32in);
                max-height: calc(100% - 0.32in);
                margin: 0.16in;
            }
            .drawing-canvas canvas {
                transform: none !important;
            }
            .fab-container {
                display: none !important;
            }
        }
`,
})
export class SvgCanvasOverlayComponent {
    private static INTERNAL_SCALE = 2;
    private static INITIAL_BRUSH_SIZE = 3;
    private static INITIAL_ERASER_SIZE = 3;
    private static BRUSH_MULTIPLIER = 1.0 * SvgCanvasOverlayComponent.INTERNAL_SCALE;
    private static ERASER_MULTIPLIER = 2.0 * SvgCanvasOverlayComponent.INTERNAL_SCALE;
    MIN_STROKE_SIZE = 1;
    MAX_STROKE_SIZE = 16;
    private destroyRef = inject(DestroyRef);
    private zoomPanService = inject(SvgZoomPanService);
    private injector = inject(Injector);
    private dialogsService = inject(DialogsService);
    optionsService = inject(OptionsService);
    dbService = inject(DbService);
    canvasOverlay = viewChild.required<ElementRef<HTMLDivElement>>('canvasOverlay');
    canvasContainer = viewChild.required<ElementRef<HTMLDivElement>>('canvasContainer');
    canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
    width = input(200);
    height = input(200);

    activePointers = new Map<number, brushLocation>();
    lastReducedIndex = 0;
    unitId = input<string | null>(null);
    mode = signal<'brush' | 'eraser' | 'none'>('none');
    brushColor = signal<string>('#f00');
    colorOptions = ['#f00', '#00f', '#0f0', '#f0f', '#0ff', '#ff0'];
    brushSize = signal<number>(SvgCanvasOverlayComponent.INITIAL_BRUSH_SIZE);
    eraserSize = signal<number>(SvgCanvasOverlayComponent.INITIAL_ERASER_SIZE);
    strokeSize = computed(() => {
        return this.mode() === 'brush' ? this.brushSize() : this.eraserSize();
    });

    canvasHeight = computed(() => {
        this.unitId();
        return this.height() * SvgCanvasOverlayComponent.INTERNAL_SCALE;
    });
    canvasWidth = computed(() => {
        return this.width() * SvgCanvasOverlayComponent.INTERNAL_SCALE;
    });

    private nativePointerDown = (event: PointerEvent) => this.onPointerDown(event);
    private nativePointerUp = (event: PointerEvent) => this.onPointerUp(event);
    private nativePointerMove = (event: PointerEvent) => this.onPointerMove(event);

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
        return this.canvasOverlay().nativeElement;
    }

    constructor() {
        effect(() => {
            const unitId = this.unitId();
            afterNextRender(() => {
                this.clearCanvas();
                if (!unitId) return;
                this.dbService.getCanvasData(unitId).then(data => {
                    if (!data) return;
                    this.importImageData(data);
                });
            }, { injector: this.injector});
        });
        afterNextRender(() => {
            this.addEventListeners();
        });
        this.destroyRef.onDestroy(() => {
            const container = this.canvasContainer().nativeElement;
            if (container) {
                container.removeEventListener('pointerdown', this.nativePointerDown);
            }
            this.removeMoveAndUpListeners();
        });
    }

    addEventListeners() {
        const container = this.canvasContainer().nativeElement;
        if (container) {
            container.addEventListener('pointerdown', this.nativePointerDown);
        }
    }
    removeMoveAndUpListeners() {
        window.removeEventListener('pointermove', this.nativePointerMove);
        window.removeEventListener('pointerup', this.nativePointerUp);
    }

    bubbleInterceptor(event: Event) {
        event.stopPropagation();
    }

    onStrokeSizeChange(event: Event) {
        const value = +(event.target as HTMLInputElement).value;
        if (this.mode() === 'brush') {
            this.brushSize.set(value);
        } else {
            this.eraserSize.set(value);
        }
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
        const confirmed = await this.dialogsService.showQuestion(
            'Are you sure you want to clear the canvas? This cannot be undone.',
            'Clear Canvas',
            'info'
        );
        if (confirmed === 'yes') {
            this.clearCanvas();
            const unitId = this.unitId();
            if (!unitId) return;
            this.dbService.deleteCanvasData(unitId);
        }
    }

    print() {
        window.print();
    }

    private getStrokeSizeScaledByMode(mode: 'brush' | 'eraser'): number {
        const paintMode = mode === 'brush';
        const scaler = paintMode ? SvgCanvasOverlayComponent.BRUSH_MULTIPLIER : SvgCanvasOverlayComponent.ERASER_MULTIPLIER;
        return this.strokeSize() * scaler;
    }
    
    private getCanvasContext(): CanvasRenderingContext2D | null {
        return this.canvasRef()?.nativeElement.getContext('2d') ?? null;
    }

    clearCanvas() {
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        ctx.clearRect(0, 0, this.canvasWidth(), this.canvasHeight());
    }

    private getPointerPosition(event: PointerEvent): { x: number, y: number } | null {
        const el = this.canvasRef()?.nativeElement;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (el.width / rect.width),
            y: (event.clientY - rect.top) * (el.height / rect.height)
        };
    }

    isEraseButton(button: number): boolean {
        return button === 5 || button === 2; // X1 (back) button or right-click
    }

    draw(ctx: CanvasRenderingContext2D, brushLocation: brushLocation, toPos: { x: number, y: number }) {
        ctx.save();
        if (brushLocation.mode === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = this.brushColor();
        }
        ctx.lineWidth = this.getStrokeSizeScaledByMode(brushLocation.mode);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(brushLocation.x, brushLocation.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();
        ctx.restore();
    }

    startDraw(pointerId: number) {
        const pos = this.activePointers.get(pointerId);
        if (!pos) return;
        // draw initial dot
        const ctx = this.getCanvasContext();
        if (ctx) {
            this.draw(ctx, pos, pos);
        }
    }

    onPointerDown(event: PointerEvent) {
        const mode = this.mode();
        if (mode === 'none') return;
        const inputFilter = this.optionsService.options().canvasInput;
        if (inputFilter === 'pen' && event.pointerType !== 'pen') return;
        if (inputFilter === 'touch' && event.pointerType !== 'touch') return;
        event.preventDefault();
        event.stopPropagation();
        const pos = this.getPointerPosition(event);
        if (!pos) return;
        const interactionMode = this.isEraseButton(event.button) ? 'eraser' : this.mode() === 'brush' ? 'brush' : 'eraser';
        this.activePointers.set(event.pointerId, { ...pos, mode: interactionMode });
        if (this.activePointers.size === 1) {
            window.addEventListener('pointermove', this.nativePointerMove);
            window.addEventListener('pointerup', this.nativePointerUp);
        }
        this.startDraw(event.pointerId);
    }

    async onPointerUp(event: PointerEvent) {
        if (this.activePointers.has(event.pointerId) === false) return;
        event.preventDefault();
        event.stopPropagation();
        this.activePointers.delete(event.pointerId);
        if (this.activePointers.size === 0) {
            this.removeMoveAndUpListeners();
        }
        const unitId = this.unitId();
        if (!unitId) return;
        const blob = await this.exportImageData();
        if (!blob) return;
        this.dbService.saveCanvasData(unitId, blob);
    }

    onPointerMove(event: PointerEvent) {
        if (this.activePointers.has(event.pointerId) === false) return;
        event.preventDefault();
        event.stopPropagation();
        const pos = this.getPointerPosition(event);
        if (!pos) return;
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        const fromPos = this.activePointers.get(event.pointerId);
        if (!fromPos) return;
        this.draw(ctx, fromPos ?? pos, pos);
        this.activePointers.set(event.pointerId, { x: pos.x, y: pos.y, mode: fromPos.mode });
    }

    public async exportImageData(): Promise<Blob | null> {
        const canvas = this.canvasRef();
        if (!canvas) return null;
        return new Promise<Blob | null>((resolve) => {
            canvas.nativeElement.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        });
    }

    public importImageData(blob: Blob) {
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        const img = new window.Image();
            
        img.onload = () => {
                const canvasWidth = this.canvasWidth();
                const canvasHeight = this.canvasHeight();
                ctx.clearRect(0, 0, canvasWidth, canvasHeight);
                ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
            };
            img.onerror = (err) => {
                console.error('Failed to load image for canvas import', err);
            };
            img.src = URL.createObjectURL(blob);
    }
}