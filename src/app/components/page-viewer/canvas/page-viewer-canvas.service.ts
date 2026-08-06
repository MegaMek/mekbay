// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal, computed, inject } from '@angular/core';
import { OptionsService } from '../../../services/options.service';

/*
 * 
 * PageViewerCanvasService - Global state service for canvas drawing across multiple pages.
 * 
 * This service manages:
 * - Drawing mode (brush/eraser/none)
 * - Brush color selection
 * - Stroke sizes for brush and eraser
 * - Coordination between multiple canvas overlays and the controls
 * - Global multitouch detection across canvases for zoom/pan passthrough
 */

export type CanvasMode = 'brush' | 'eraser' | 'none';

export interface CanvasState {
    brushSize: number;
    eraserSize: number;
}

/**
 * Tracked pointer info for cross-canvas multitouch detection.
 */
interface TrackedPointer {
    pointerId: number;
    pointerType: string;
    canvasId: string;
    hasMoved: boolean;
    originalEvent: PointerEvent;
}

/**
 * Callback to notify a canvas to abort its current drawing gesture.
 */
export type AbortDrawingCallback = () => void;

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

    // Abort callbacks for multitouch coordination - called when canvas should stop drawing
    private abortCallbacks = new Map<string, AbortDrawingCallback>();

    // Global pointer tracking for multitouch detection across canvases
    private globalPointers = new Map<number, TrackedPointer>();

    // When true, multitouch is active and canvases should not capture new pointers
    readonly isMultitouchActive = signal(false);

    // Track active pointers during multitouch zoom (at window level)
    private multitouchPointerCount = 0;

    // Bound handlers for window-level multitouch tracking
    private boundOnWindowPointerUp = this.onWindowPointerUp.bind(this);

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
        this.abortCallbacks.delete(id);
        // Clean up any pointers from this canvas
        for (const [pointerId, pointer] of this.globalPointers) {
            if (pointer.canvasId === id) {
                this.globalPointers.delete(pointerId);
            }
        }
        // Reset multitouch if no pointers left
        if (this.globalPointers.size === 0) {
            this.isMultitouchActive.set(false);
        }
    }

    /**
     * Register an abort callback for multitouch coordination.
     * Called when the canvas should abort drawing and allow zoom/pan.
     */
    registerAbortCallback(id: string, callback: AbortDrawingCallback): void {
        this.abortCallbacks.set(id, callback);
    }

    /**
     * Check if a new pointer should be handled by the canvas for drawing.
     * Call this BEFORE the canvas starts processing the pointer.
     * 
     * @returns true if canvas should handle this pointer for drawing,
     *          false if it should let the event pass through for zoom/pan
     */
    shouldHandlePointer(event: PointerEvent, canvasId: string): boolean {
        // If multitouch is already active, don't capture new pointers
        if (this.isMultitouchActive()) {
            return false;
        }

        // Count existing pointers of the same type (touch/pen)
        const sameTypeCount = Array.from(this.globalPointers.values())
            .filter(p => p.pointerType === event.pointerType).length;

        // If there's already a pointer of the same type somewhere, this is multitouch
        if (sameTypeCount >= 1) {
            // Check if any existing pointer has moved (already started drawing)
            const existingPointer = Array.from(this.globalPointers.values())
                .find(p => p.pointerType === event.pointerType);
            
            if (existingPointer && !existingPointer.hasMoved) {
                // First pointer hasn't moved yet - abort it and switch to zoom mode
                this.isMultitouchActive.set(true);
                this.abortAllDrawing();
                return false;
            } else if (existingPointer && existingPointer.hasMoved) {
                // First pointer already moved (drawing started) - too late to switch
                // Just ignore this new pointer for drawing
                return false;
            }
        }

        return true;
    }

    /**
     * Register a pointer that the canvas is now handling.
     * Call this AFTER deciding to handle the pointer and stopping propagation.
     */
    registerPointer(event: PointerEvent, canvasId: string): void {
        this.globalPointers.set(event.pointerId, {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            canvasId,
            hasMoved: false,
            originalEvent: event
        });
    }

    /**
     * Mark that a pointer has moved (drawing has started).
     * Once moved, we can't switch to zoom mode for this gesture.
     */
    markPointerMoved(pointerId: number): void {
        const pointer = this.globalPointers.get(pointerId);
        if (pointer) {
            pointer.hasMoved = true;
        }
    }

    /**
     * Unregister a pointer when it's released.
     */
    unregisterPointer(pointerId: number): void {
        this.globalPointers.delete(pointerId);

        // If no more pointers, reset multitouch state
        if (this.globalPointers.size === 0) {
            this.isMultitouchActive.set(false);
        }
    }

    /**
     * Abort all drawing on all canvases and re-dispatch pointer events for zoom.
     * Called when multitouch is detected before any drawing started.
     */
    private abortAllDrawing(): void {
        // Collect all pointers before clearing
        const pointersToRedispatch = Array.from(this.globalPointers.values());

        // Get unique canvas IDs from active pointers
        const canvasIds = new Set(pointersToRedispatch.map(p => p.canvasId));

        // Tell each canvas to abort
        for (const canvasId of canvasIds) {
            const callback = this.abortCallbacks.get(canvasId);
            if (callback) {
                callback();
            }
        }

        // Start tracking pointers at window level to detect when zoom gesture ends
        this.multitouchPointerCount = pointersToRedispatch.length + 1; // +1 for the incoming pointer
        window.addEventListener('pointerup', this.boundOnWindowPointerUp, true);
        window.addEventListener('pointercancel', this.boundOnWindowPointerUp, true);

        // Clear all pointers since we're switching to zoom mode
        this.globalPointers.clear();

        // Re-dispatch all pointer events to the container so zoom service can handle them
        for (const pointer of pointersToRedispatch) {
            const event = pointer.originalEvent;
            if (event.target) {
                // Find the page-viewer container to dispatch to
                const container = (event.target as HTMLElement).closest('.page-viewer-container');
                if (container) {
                    const cloned = new PointerEvent('pointerdown', {
                        bubbles: true,
                        cancelable: true,
                        pointerId: event.pointerId,
                        pointerType: event.pointerType,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        button: event.button,
                        buttons: event.buttons,
                        pressure: event.pressure,
                        tiltX: event.tiltX ?? 0,
                        tiltY: event.tiltY ?? 0,
                        isPrimary: event.isPrimary,
                        ctrlKey: event.ctrlKey,
                        altKey: event.altKey,
                        shiftKey: event.shiftKey,
                        metaKey: event.metaKey,
                    });
                    container.dispatchEvent(cloned);
                }
            }
        }
    }

    /**
     * Handle pointer up at window level during multitouch mode.
     * When all pointers are released, reset multitouch state.
     */
    private onWindowPointerUp(_event: PointerEvent): void {
        this.multitouchPointerCount--;
        
        if (this.multitouchPointerCount <= 0) {
            this.multitouchPointerCount = 0;
            this.isMultitouchActive.set(false);
            window.removeEventListener('pointerup', this.boundOnWindowPointerUp, true);
            window.removeEventListener('pointercancel', this.boundOnWindowPointerUp, true);
        }
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
}
