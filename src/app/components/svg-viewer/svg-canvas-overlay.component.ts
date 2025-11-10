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
import { ForceUnit } from '../../models/force-unit.model';
import { LoggerService } from '../../services/logger.service';

/*
 * Author: Drake
 */

interface BrushLocation {
    startX: number;
    startY: number;
    moved: boolean;
    x: number;
    y: number;
    mode: 'brush' | 'eraser';
    event: PointerEvent;
}

@Component({
    selector: 'svg-canvas-overlay',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: `./svg-canvas-overlay.component.html`,
    styleUrls: [`./svg-canvas-overlay.component.scss`],
})
export class SvgCanvasOverlayComponent {
    private readonly MULTITOUCH = false;
    private readonly INTERNAL_SCALE = 2;
    private readonly MOVE_THRESHOLD = 4; // in pixels
    private readonly INITIAL_BRUSH_SIZE = 4;
    private readonly INITIAL_ERASER_SIZE = 4;
    private readonly BRUSH_MULTIPLIER = 1.0;// * this.INTERNAL_SCALE;
    private readonly ERASER_MULTIPLIER = 2.0;// * this.INTERNAL_SCALE;
    MIN_STROKE_SIZE = 1;
    MAX_STROKE_SIZE = 10;
    logger = inject(LoggerService);
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

    activePointers = new Map<number, BrushLocation>();
    primaryPointerId: number | null = null;

    lastReducedIndex = 0;
    unit = input<ForceUnit | null>(null);
    mode = signal<'brush' | 'eraser' | 'none'>('none');
    brushColor = signal<string>('#f00');
    colorOptions = ['#f00', '#00f', '#0f0', '#f0f', '#0ff', '#ff0'];
    brushSize = signal<number>(this.optionsService.options().lastCanvasState?.brushSize ?? this.INITIAL_BRUSH_SIZE);
    eraserSize = signal<number>(this.optionsService.options().lastCanvasState?.eraserSize ?? this.INITIAL_ERASER_SIZE);
    strokeSize = computed(() => {
        return this.mode() === 'brush' ? this.brushSize() : this.eraserSize();
    });

    canvasHeight = computed(() => {
        this.unit();
        return this.height() * this.INTERNAL_SCALE;
    });
    canvasWidth = computed(() => {
        this.unit();
        return this.width() * this.INTERNAL_SCALE;
    });

    private nativePointerDown = (event: PointerEvent) => this.onPointerDown(event);
    private nativePointerUp = (event: PointerEvent) => this.onPointerUp(event);
    private nativePointerCancel = (event: PointerEvent) => this.onPointerCancel(event);
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
            const unit = this.unit();
            afterNextRender(() => {
                this.clearCanvas();
                if (!unit) return;
                this.dbService.getCanvasData(unit.id).then(data => {
                    if (!data) return;
                    this.importImageData(data);
                });
            }, { injector: this.injector });
        });
        afterNextRender(() => {
            this.addEventListeners();
        });
        this.destroyRef.onDestroy(() => {
            const container = this.canvasContainer().nativeElement;
            if (container) {
                container.removeEventListener('pointerdown', this.nativePointerDown);
            }
            this.removeEventListeners();
        });
    }

    addEventListeners() {
        const container = this.canvasContainer().nativeElement;
        if (container) {
            container.addEventListener('pointerdown', this.nativePointerDown);
        }
    }
    removeEventListeners() {
        window.removeEventListener('pointermove', this.nativePointerMove);
        window.removeEventListener('pointerup', this.nativePointerUp);
        window.removeEventListener('pointercancel', this.nativePointerCancel);
    }

    bubbleInterceptor(event: Event) {
        const inputFilter = this.optionsService.options().canvasInput;
        if (event instanceof PointerEvent) {
            if (inputFilter === 'pen' && event.pointerType !== 'pen') return;
            if (inputFilter === 'touch' && event.pointerType !== 'touch') return;
        }
        event.stopPropagation();
    }

    onStrokeSizeChange(event: Event) {
        const value = +(event.target as HTMLInputElement).value;
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

    toggleDrawMode() {
        this.activePointers.clear();
        if (this.mode() === 'none') {
            this.mode.set('brush');
        } else {
            this.mode.set('none');
        }
    }

    toggleEraser() {
        this.activePointers.clear();
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
            const unit = this.unit();
            if (!unit) return;
            this.dbService.deleteCanvasData(unit.id);
        }
    }

    print() {
        window.print();
    }

    private getStrokeSizeScaledByMode(mode: 'brush' | 'eraser'): number {
        const paintMode = mode === 'brush';
        const scaler = paintMode ? this.BRUSH_MULTIPLIER : this.ERASER_MULTIPLIER;
        return this.strokeSize() * scaler;
    }

    private getCanvasContext(): CanvasRenderingContext2D | null {
        return this.canvasRef()?.nativeElement.getContext('2d') ?? null;
    }

    clearCanvas() {
        this.activePointers.clear();
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

    draw(ctx: CanvasRenderingContext2D, mode: 'brush' | 'eraser', fromPos: { x: number, y: number }, toPos: { x: number, y: number }) {
        ctx.save();
        if (mode === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = this.brushColor();
        }
        ctx.lineWidth = this.getStrokeSizeScaledByMode(mode);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
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
            this.draw(ctx, pos.mode, { x: pos.startX, y: pos.startY }, { x: pos.x + 0.01, y: pos.y + 0.01 });
        }
    }

    onPointerDown(event: PointerEvent) {
        const mode = this.mode();
        if (mode === 'none') return;
        const inputFilter = this.optionsService.options().canvasInput;
        if (inputFilter === 'pen' && event.pointerType !== 'pen') return;
        if (inputFilter === 'touch' && event.pointerType !== 'touch') return;

        // single pointer mode handling: if there's already a primary pointer that hasn't moved
        // and the incoming pointer has the same pointerType, propagate the saved primary
        // pointerdown event (which was previously prevented/stopped) and then ignore this new pointer.
        // The idea is to drop the current drawing and switch to a zoom/pan interaction instead if I see 2 fingers without the first having had a movement.
        if (!this.MULTITOUCH && this.activePointers.size > 0) {
            const primaryId = this.primaryPointerId;
            const primary = primaryId !== null ? this.activePointers.get(primaryId) : undefined;
            if (primary && primary.moved === false && primary.event && primary.event.pointerType === event.pointerType) {
                try {
                    const orig = primary.event as PointerEvent;
                    const cloned = new PointerEvent(orig.type, {
                        bubbles: true,
                        cancelable: true,
                        pointerId: orig.pointerId,
                        pointerType: orig.pointerType,
                        clientX: orig.clientX,
                        clientY: orig.clientY,
                        button: orig.button,
                        buttons: orig.buttons,
                        pressure: orig.pressure,
                        tiltX: (orig as any).tiltX ?? 0,
                        tiltY: (orig as any).tiltY ?? 0,
                        isPrimary: orig.isPrimary,
                        ctrlKey: orig.ctrlKey,
                        altKey: orig.altKey,
                        shiftKey: orig.shiftKey,
                        metaKey: orig.metaKey,
                    });
                    const target = (orig.target as EventTarget) || this.canvasContainer().nativeElement;
                    target.dispatchEvent(cloned);
                } catch (err) {
                    // fall through silently if re-dispatch fails
                    this.logger.error('Failed to re-dispatch primary pointer event: ' + err);
                }
                this.activePointers.clear();
                this.primaryPointerId = null;
                this.removeEventListeners();
                return;
            }
            return;
        };
        const pos = this.getPointerPosition(event);
        if (!pos) return;
        event.stopPropagation();
        event.preventDefault();
        const interactionMode = this.isEraseButton(event.button) ? 'eraser' : this.mode() === 'brush' ? 'brush' : 'eraser';
        const moved = event.pointerType !== 'touch'; // pen and mouse are precise enough to not need a movement threshold check
        this.activePointers.set(event.pointerId, { ...pos, mode: interactionMode, startX: pos.x, startY: pos.y, moved, event });
        if (this.activePointers.size === 1) {
            this.primaryPointerId = event.pointerId;
        }
        if (this.activePointers.size === 1) {
            window.addEventListener('pointermove', this.nativePointerMove);
            window.addEventListener('pointerup', this.nativePointerUp);
            window.addEventListener('pointercancel', this.nativePointerCancel);
        }
        if (moved) {
            this.startDraw(event.pointerId);
        }
    }

    async onPointerUp(event: PointerEvent) {
        if (!this.activePointers.has(event.pointerId)) return;
        event.preventDefault();
        event.stopPropagation();
        const pointer = this.activePointers.get(event.pointerId);
        if (pointer && pointer.moved === false) {
            // draw a dot if no movement
            this.startDraw(event.pointerId);
        }
        this.activePointers.delete(event.pointerId);
        if (this.activePointers.size === 0) {
            this.primaryPointerId = null;
            this.removeEventListeners();
        }
        const unit = this.unit();
        if (!unit) return;
        const blob = await this.exportImageData();
        if (!blob) return;
        this.dbService.saveCanvasData(unit.id, blob);
        unit.setModified();
    }

    async onPointerCancel(event: PointerEvent) {
        if (!this.activePointers.has(event.pointerId)) return;
        this.activePointers.delete(event.pointerId);
        if (this.activePointers.size === 0) {
            this.primaryPointerId = null;
            this.removeEventListeners();
        }
    }

    onPointerMove(event: PointerEvent) {
        if (!this.activePointers.has(event.pointerId)) return;
        event.preventDefault();
        event.stopPropagation();
        const pos = this.getPointerPosition(event);
        if (!pos) return;
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        const fromPos = this.activePointers.get(event.pointerId);
        if (!fromPos) return;
        if (fromPos.moved === false) {
            // detect moved after threshold
            const dx = pos.x - fromPos.startX;
            const dy = pos.y - fromPos.startY;
            const distSq = dx * dx + dy * dy;
            const threshold = this.MOVE_THRESHOLD * this.INTERNAL_SCALE;
            if (distSq >= (threshold * threshold)) {
                fromPos.moved = true;
                this.startDraw(event.pointerId);
            }
        }
        if (fromPos.moved) {
            this.draw(ctx, fromPos.mode, fromPos, pos);
        }
        const newPos = { ...fromPos, x: pos.x, y: pos.y };
        this.activePointers.set(event.pointerId, newPos);
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
            URL.revokeObjectURL(img.src);
        };
        img.onerror = (err) => {
            this.logger.error('Failed to load image for canvas import: ' + err);
        };
        img.src = URL.createObjectURL(blob);
    }
}