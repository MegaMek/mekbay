// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    Component,
    ChangeDetectionStrategy,
    inject,
    input,
    output,
    signal,
    viewChild,
    computed,
    DestroyRef,
    afterNextRender,
    type ElementRef,
    effect,
    Injector
} from '@angular/core';
import { PageViewerCanvasService } from './page-viewer-canvas.service';
import { OptionsService } from '../../../services/options.service';
import { DbService } from '../../../services/db.service';
import { LoggerService } from '../../../services/logger.service';
import { isCBTForceMember } from '../../../models/force-member.model';
import type { PageCanvasMember } from '../internal/types';
import type { GameSystem } from '../../../models/common.model';

/*
 * 
 * PageCanvasOverlayComponent - Canvas overlay for a single page in the page viewer.
 * 
 * This component:
 * - Renders a canvas overlay on top of a single page/SVG
 * - Handles drawing interactions (pointer events)
 * - Saves/loads canvas data to IndexedDB per unit
 * - Receives global drawing state from PageViewerCanvasService
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
    selector: 'page-canvas-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div #canvasOverlay class="page-canvas-overlay" [class.active]="canvasService.isActive()">
            <div #canvasContainer class="drawing-canvas">
                <canvas #canvas [width]="canvasWidth()" [height]="canvasHeight()"></canvas>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;

            @media print {
                top: 0 !important;
                left: 0 !important;
                height: 100% !important;
                width: 100% !important;
                transform: none !important;
                display: none !important;
            }
        }

        .page-canvas-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }

        .drawing-canvas {
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: block;
            background: transparent;
            cursor: crosshair;
            opacity: 0.95;
            box-sizing: border-box;
        }

        .page-canvas-overlay.active .drawing-canvas {
            pointer-events: auto;
            touch-action: none; /* Prevent browser scroll/pan during drawing */
        }

        .drawing-canvas canvas {
            width: 100%;
            height: 100%;
            display: block;
            pointer-events: none;
        }

        @media print {
            .page-canvas-overlay {
                transform: none !important;
            }

            .drawing-canvas {
                width: 100% !important;
                height: 100% !important;
                padding: 0 !important;
                transform: none !important;
            }

            .drawing-canvas canvas {
                transform: none !important;
            }
        }
    `]
})
export class PageCanvasOverlayComponent {
    private readonly INTERNAL_SCALE = 2;
    private readonly MOVE_THRESHOLD = 4;
    private readonly BRUSH_MULTIPLIER = 1.0;
    private readonly ERASER_MULTIPLIER = 2.0;
    private readonly MULTITOUCH = false;

    private logger = inject(LoggerService);
    private injector = inject(Injector);
    private optionsService = inject(OptionsService);
    private dbService = inject(DbService);
    canvasService = inject(PageViewerCanvasService);

    // View children
    canvasOverlay = viewChild.required<ElementRef<HTMLDivElement>>('canvasOverlay');
    canvasContainer = viewChild.required<ElementRef<HTMLDivElement>>('canvasContainer');
    canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

    // Inputs
    unit = input<PageCanvasMember | null>(null);
    width = input(612); // PAGE_WIDTH
    height = input(792); // PAGE_HEIGHT

    // Outputs
    drawingStarted = output<PageCanvasMember>();

    // Computed canvas dimensions (internal scale for higher resolution)
    canvasHeight = computed(() => this.height() * this.INTERNAL_SCALE);
    canvasWidth = computed(() => this.width() * this.INTERNAL_SCALE);

    // Pointer tracking
    private activePointers = new Map<number, BrushLocation>();
    private primaryPointerId: number | null = null;

    // Canvas ID for registration
    private canvasId = signal<string>('');

    // ID used for storing canvas data in DB
    private unitCanvasId = computed<string>(() => {
        const unit = this.unit();
        if (!unit) return '';
        return unit.id;
    });

    // Bound event handlers
    private nativePointerDown = (event: PointerEvent) => this.onPointerDown(event);
    private nativePointerUp = (event: PointerEvent) => this.onPointerUp(event);
    private nativePointerCancel = (event: PointerEvent) => this.onPointerCancel(event);
    private nativePointerMove = (event: PointerEvent) => this.onPointerMove(event);

    get nativeElement(): HTMLElement {
        return this.canvasOverlay().nativeElement;
    }

    // Destroyed flag to prevent async callbacks from running after component is destroyed
    private destroyed = false;

    constructor() {
        // Track pending afterNextRender to clean up on destroy or re-run
        let pendingAfterRenderRef: { destroy: () => void } | null = null;
        
        // Load canvas data when unit changes
        effect(() => {
            const unit = this.unit();
            // Cancel any previous pending render callback
            pendingAfterRenderRef?.destroy();
            pendingAfterRenderRef = afterNextRender(() => {
                pendingAfterRenderRef = null;
                this.clearCanvas();
                if (!unit) return;
                
                // Set canvas ID based on unit
                this.canvasId.set(`canvas-${this.unitCanvasId()}`);
                
                // Register with service for clear functionality
                this.canvasService.registerCanvas(this.canvasId(), () => this.clearCanvas());
                
                // Register abort callback for cross-canvas multitouch coordination
                this.canvasService.registerAbortCallback(this.canvasId(), () => this.abortDrawing());
                
                // Load saved canvas data
                this.dbService.getCanvasData(this.unitCanvasId()).then(data => {
                    if (!data || this.destroyed) return;
                    this.importImageData(data);
                });
            }, { injector: this.injector });
        });

        // Setup event listeners after render
        const initialRenderRef = afterNextRender(() => {
            this.addEventListeners();
        });

        // Cleanup on destroy
        inject(DestroyRef).onDestroy(() => {
            this.destroyed = true;
            pendingAfterRenderRef?.destroy();
            initialRenderRef.destroy();
            
            const container = this.canvasContainer()?.nativeElement;
            if (container) {
                container.removeEventListener('pointerdown', this.nativePointerDown);
            }
            this.removeEventListeners();
            
            // Unregister from service
            if (this.canvasId()) {
                this.canvasService.unregisterCanvas(this.canvasId());
            }
        });
    }

    private addEventListeners(): void {
        const container = this.canvasContainer()?.nativeElement;
        if (container) {
            container.addEventListener('pointerdown', this.nativePointerDown);
        }
    }

    private removeEventListeners(): void {
        window.removeEventListener('pointermove', this.nativePointerMove);
        window.removeEventListener('pointerup', this.nativePointerUp);
        window.removeEventListener('pointercancel', this.nativePointerCancel);
    }

    private getCanvasContext(): CanvasRenderingContext2D | null {
        return this.canvasRef()?.nativeElement.getContext('2d') ?? null;
    }

    clearCanvas(): void {
        this.activePointers.clear();
        const ctx = this.getCanvasContext();
        if (!ctx) return;
        ctx.clearRect(0, 0, this.canvasWidth(), this.canvasHeight());
    }

    /**
     * Abort the current drawing gesture.
     * Called by the global canvas service when cross-canvas multitouch is detected.
     * This releases all pointers and removes event listeners without saving.
     */
    private abortDrawing(): void {
        this.activePointers.clear();
        this.primaryPointerId = null;
        this.removeEventListeners();
    }

    private getPointerPosition(event: PointerEvent): { x: number; y: number } | null {
        const el = this.canvasRef()?.nativeElement;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (el.width / rect.width),
            y: (event.clientY - rect.top) * (el.height / rect.height)
        };
    }

    private isEraseButton(button: number): boolean {
        return button === 5 || button === 2; // X1 (back) button or right-click
    }

    private getStrokeSizeScaledByMode(mode: 'brush' | 'eraser'): number {
        const paintMode = mode === 'brush';
        const scaler = paintMode ? this.BRUSH_MULTIPLIER : this.ERASER_MULTIPLIER;
        return this.canvasService.strokeSize() * scaler;
    }

    private draw(
        ctx: CanvasRenderingContext2D,
        mode: 'brush' | 'eraser',
        fromPos: { x: number; y: number },
        toPos: { x: number; y: number }
    ): void {
        ctx.save();
        if (mode === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = this.canvasService.brushColor();
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

    private startDraw(pointerId: number): void {
        const pos = this.activePointers.get(pointerId);
        if (!pos) return;
        const ctx = this.getCanvasContext();
        if (ctx) {
            this.draw(ctx, pos.mode, { x: pos.startX, y: pos.startY }, { x: pos.x + 0.01, y: pos.y + 0.01 });
        }
    }

    private onPointerDown(event: PointerEvent): void {
        const mode = this.canvasService.mode();
        if (mode === 'none') return;

        const inputFilter = this.optionsService.options().canvasInput;
        if (inputFilter === 'pen' && event.pointerType !== 'pen') return;
        if (inputFilter === 'touch' && event.pointerType !== 'touch') return;

        // Check with global service if we should handle this pointer
        // This detects cross-canvas multitouch and returns false if zoom/pan should take over
        const canvasId = this.canvasId();
        if (!this.canvasService.shouldHandlePointer(event, canvasId)) {
            // Multitouch detected - let event propagate to zoom service
            return;
        }

        // Handle multitouch detection within this canvas (2nd finger on same canvas)
        if (!this.MULTITOUCH && this.activePointers.size > 0) {
            const primaryId = this.primaryPointerId;
            const primary = primaryId !== null ? this.activePointers.get(primaryId) : undefined;
            if (primary && primary.moved === false && primary.event && primary.event.pointerType === event.pointerType) {
                // First pointer hasn't moved yet - switch to zoom mode
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
                        tiltX: orig.tiltX,
                        tiltY: orig.tiltY,
                        isPrimary: orig.isPrimary,
                        ctrlKey: orig.ctrlKey,
                        altKey: orig.altKey,
                        shiftKey: orig.shiftKey,
                        metaKey: orig.metaKey,
                    });
                    const target = (orig.target as EventTarget) || this.canvasContainer().nativeElement;
                    target.dispatchEvent(cloned);
                } catch (err) {
                    this.logger.error('Failed to re-dispatch primary pointer event: ' + err);
                }
                // Unregister pointers from global service
                for (const pointerId of this.activePointers.keys()) {
                    this.canvasService.unregisterPointer(pointerId);
                }
                this.activePointers.clear();
                this.primaryPointerId = null;
                this.removeEventListeners();
                return;
            }
            // Already have a pointer, ignore additional ones
            return;
        }

        const pos = this.getPointerPosition(event);
        if (!pos) return;

        // Now we're committed to handling this pointer - stop propagation
        event.stopPropagation();
        event.preventDefault();

        // Register pointer with global service AFTER deciding to handle it
        this.canvasService.registerPointer(event, canvasId);

        const interactionMode = this.isEraseButton(event.button) ? 'eraser' : mode === 'brush' ? 'brush' : 'eraser';
        const moved = event.pointerType !== 'touch';

        this.activePointers.set(event.pointerId, {
            ...pos,
            mode: interactionMode,
            startX: pos.x,
            startY: pos.y,
            moved,
            event
        });

        if (this.activePointers.size === 1) {
            this.primaryPointerId = event.pointerId;
            window.addEventListener('pointermove', this.nativePointerMove);
            window.addEventListener('pointerup', this.nativePointerUp);
            window.addEventListener('pointercancel', this.nativePointerCancel);

            // Emit drawing started to select this unit
            const unit = this.unit();
            if (unit) {
                this.drawingStarted.emit(unit);
            }
        }

        if (moved) {
            this.startDraw(event.pointerId);
        }
    }

    private async onPointerUp(event: PointerEvent): Promise<void> {
        if (!this.activePointers.has(event.pointerId)) return;

        event.preventDefault();
        event.stopPropagation();

        const pointer = this.activePointers.get(event.pointerId);
        if (pointer && pointer.moved === false) {
            this.startDraw(event.pointerId);
        }

        this.activePointers.delete(event.pointerId);
        this.canvasService.unregisterPointer(event.pointerId);
        if (this.activePointers.size === 0) {
            this.primaryPointerId = null;
            this.removeEventListeners();
        }

        // Save canvas data
        const unit = this.unit();
        if (!unit) return;

        const blob = await this.exportImageData();
        if (!blob) return;

        this.dbService.saveCanvasData(this.unitCanvasId(), blob);
        if (!isCBTForceMember(unit) && !unit.modified) {
            unit.setModified();
        }
    }

    private onPointerCancel(event: PointerEvent): void {
        if (!this.activePointers.has(event.pointerId)) return;

        this.activePointers.delete(event.pointerId);
        this.canvasService.unregisterPointer(event.pointerId);
        if (this.activePointers.size === 0) {
            this.primaryPointerId = null;
            this.removeEventListeners();
        }
    }

    private onPointerMove(event: PointerEvent): void {
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
            const dx = pos.x - fromPos.startX;
            const dy = pos.y - fromPos.startY;
            const distSq = dx * dx + dy * dy;
            const threshold = this.MOVE_THRESHOLD * this.INTERNAL_SCALE;
            if (distSq >= threshold * threshold) {
                fromPos.moved = true;
                // Notify global service that drawing has started - can't switch to zoom anymore
                this.canvasService.markPointerMoved(event.pointerId);
                this.startDraw(event.pointerId);
            }
        }

        if (fromPos.moved) {
            this.draw(ctx, fromPos.mode, fromPos, pos);
        }

        const newPos = { ...fromPos, x: pos.x, y: pos.y };
        this.activePointers.set(event.pointerId, newPos);
    }

    async exportImageData(): Promise<Blob | null> {
        const canvas = this.canvasRef();
        if (!canvas) return null;
        return new Promise<Blob | null>((resolve) => {
            canvas.nativeElement.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        });
    }

    importImageData(blob: Blob): void {
        const ctx = this.getCanvasContext();
        if (!ctx) return;

        const img = new window.Image();
        const objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
            const canvasWidth = this.canvasWidth();
            const canvasHeight = this.canvasHeight();
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
            URL.revokeObjectURL(objectUrl);
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl);
            this.logger.error('Failed to load image for canvas import: ' + err);
        };
        img.src = objectUrl;
    }

    /**
     * Request to clear this canvas with confirmation
     */
    async requestClear(): Promise<void> {
        this.clearCanvas();
        const unit = this.unit();
        if (unit) {
            this.dbService.deleteCanvasData(this.unitCanvasId());
        }
    }
}
