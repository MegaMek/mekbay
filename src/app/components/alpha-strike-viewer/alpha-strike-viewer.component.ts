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

import { Component, ChangeDetectionStrategy, input, inject, computed, effect, ElementRef, viewChildren, signal, DestroyRef, viewChild } from '@angular/core';
import { AlphaStrikeCardComponent } from '../alpha-strike-card/alpha-strike-card.component';
import { OptionsService } from '../../services/options.service';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { ASForce } from '../../models/as-force.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { getLayoutForUnitType } from '../alpha-strike-card/card-layout.config';
import { PageViewerCanvasControlsComponent } from '../page-viewer/canvas/page-viewer-canvas-controls.component';
import { PageCanvasOverlayComponent } from '../page-viewer/canvas/page-canvas-overlay.component';
import { PageViewerCanvasService } from '../page-viewer/canvas/page-viewer-canvas.service';
import { DbService } from '../../services/db.service';
import { ASInteractionOverlayComponent } from './as-interaction-overlay.component';

/**
 * Author: Drake
 */
export interface CardRenderItem {
    forceUnit: ASForceUnit;
    cardIndex: number;
    trackKey: string;
}

// Layout constants
const BASE_CELL_WIDTH = 350;
const MIN_CELL_WIDTH = 280;
const CELL_GAP = 4;
const CONTAINER_PADDING = 8 * 2; // left + right padding

// Pinch zoom threshold: computed from container/viewport diagonal.
// Using a ratio keeps gesture sensitivity consistent across device sizes.
const PINCH_THRESHOLD_RATIO = 0.06;
const PINCH_THRESHOLD_MIN_PX = 40;
const PINCH_THRESHOLD_MAX_PX = 140;

// Ctrl+Wheel zoom threshold: accumulated delta (in pixels) required per column change.
// Touchpads often emit a continuous stream of small deltas; we quantize them into discrete "ticks".
const WHEEL_TICK_THRESHOLD_PX = 60;
// If wheel events pause longer than this, discard any partial accumulation.
const WHEEL_IDLE_RESET_MS = 200;

interface Point {
    x: number;
    y: number;
}

@Component({
    selector: 'alpha-strike-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlphaStrikeCardComponent, PageCanvasOverlayComponent, PageViewerCanvasControlsComponent, ASInteractionOverlayComponent],
    templateUrl: './alpha-strike-viewer.component.html',
    styleUrl: './alpha-strike-viewer.component.scss',
    providers: [PageViewerCanvasService],
    host: {
        '(wheel)': 'onWheel($event)',
        // Prevent iOS Safari's native gesture handling
        '(gesturestart)': '$event.preventDefault()',
        '(gesturechange)': '$event.preventDefault()',
        '(gestureend)': '$event.preventDefault()'
    }
})
export class AlphaStrikeViewerComponent {
    private readonly optionsService = inject(OptionsService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dbService = inject(DbService);
    
    unit = input<ASForceUnit | null>(null);
    force = input<ASForce | null>(null);
    
    private readonly cardWrappers = viewChildren<ElementRef<HTMLElement>>('cardWrapper');
    private readonly viewerContainer = viewChild<ElementRef<HTMLElement>>('viewerContainer');
    
    readonly useHex = computed(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().ASCardStyle);
    
    // Column count is the source of truth
    readonly columnCount = signal(1);
    
    // Cell width is derived from column count and container width
    private containerWidth = signal(0);
    
    readonly cellWidth = computed(() => {
        const width = this.containerWidth();
        const cols = this.columnCount();
        if (width <= 0) return BASE_CELL_WIDTH;
        
        // Calculate cell width that fits exactly `cols` columns
        // Formula: cols * cellWidth + (cols - 1) * gap + padding = containerWidth
        const availableWidth = width - CONTAINER_PADDING;
        const cellWidth = (availableWidth - (cols - 1) * CELL_GAP) / cols;
        return Math.floor(Math.max(MIN_CELL_WIDTH, cellWidth));
    });
    
    // Pinch gesture state
    private readonly pointers = new Map<number, Point>();
    
    // Cache for CardRenderItems to prevent object recreation
    private readonly cardRenderItemsCache = new Map<string, CardRenderItem[]>();
    private pinchState: {
        lastDistance: number;
        accumulatedDelta: number;
    } | null = null;

    // Ctrl+wheel zoom state (quantized)
    private wheelState: {
        accumulatedDeltaPx: number;
        lastDirection: -1 | 0 | 1;
        lastEventTime: number;
    } | null = null;
    
    // Flag to prevent scroll effect when selection is made by clicking a card
    private internalSelectionInProgress = false;
    
    // First scroll should be instant (when the viewer first appears with a selection)
    private firstScroll = true;
    
    // Signal to trigger closing pickers in all cards (increments to trigger)
    readonly updatePickerPositionTrigger = signal(0);
    
    constructor() {
        this.setupEffects();
        this.destroyRef.onDestroy(() => {
            this.cardRenderItemsCache.clear();
            this.pointers.clear();
        });
    }
    
    /**
     * Get the number of cards for a given unit type.
     */
    getCardCount(forceUnit: ASForceUnit): number {
        const unitType = forceUnit.getUnit().as.TP;
        return getLayoutForUnitType(unitType).cards.length;
    }
    
    /**
     * Generate card render items for a unit (handles multi-card units).
     * Results are cached to prevent object recreation on every change detection cycle
     */
    getCardRenderItems(forceUnit: ASForceUnit): CardRenderItem[] {
        const cacheKey = forceUnit.id;
        const cached = this.cardRenderItemsCache.get(cacheKey);
        
        // Return cached if exists
        if (cached) {
            return cached;
        }
        
        // Create new items and cache them
        const items: CardRenderItem[] = [];
        const cardCount = this.getCardCount(forceUnit);
        for (let i = 0; i < cardCount; i++) {
            items.push({
                forceUnit,
                cardIndex: i,
                trackKey: `${forceUnit.id}-card-${i}`
            });
        }
        this.cardRenderItemsCache.set(cacheKey, items);
        return items;
    }
    
    /**
     * Handle canvas clear request from controls - delete canvas data for current unit
     */
    onCanvasClearRequested(): void {
        const currentUnit = this.unit();
        if (currentUnit) {
            this.dbService.deleteCanvasData(currentUnit.id);
        }
    }
    
    /**
     * Handle print request from controls
     */
    onPrintRequested(): void {
        this.forceBuilderService.printAll();
    }

    private setupEffects(): void {
        // Clean up stale cardRenderItemsCache entries when force changes
        effect(() => {
            const currentForce = this.force();
            if (!currentForce) {
                this.cardRenderItemsCache.clear();
                return;
            }

            const currentUnitIds = new Set(currentForce.units().map(u => u.id));
            // Remove stale cache entries
            this.cardRenderItemsCache.forEach((_, id) => {
                if (!currentUnitIds.has(id)) this.cardRenderItemsCache.delete(id);
            });
        });
        
        // Scroll to selected unit when selection changes externally
        effect(() => {
            const selectedUnit = this.unit();
            if (selectedUnit && !this.internalSelectionInProgress) {
                setTimeout(() => this.scrollToSelectedUnit(selectedUnit), 0);
            }
            this.internalSelectionInProgress = false;
        });
        
        // Setup touch event listeners to prevent iOS native pinch gestures
        effect((onCleanup) => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            const preventPinchZoom = (e: TouchEvent) => {
                if (e.touches.length >= 2) {
                    e.preventDefault();
                }
            };
            
            container.addEventListener('touchmove', preventPinchZoom, { passive: false });
            
            onCleanup(() => {
                container.removeEventListener('touchmove', preventPinchZoom);
            });
        });
        
        // Setup ResizeObserver to track container width
        effect((onCleanup) => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            const observer = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (entry) {
                    this.containerWidth.set(entry.contentRect.width);
                }
            });
            
            observer.observe(container);
            
            onCleanup(() => {
                observer.disconnect();
            });
        });
        
        // Calculate optimal column count on initial render
        let initialColumnsCalculated = false;
        effect(() => {
            const width = this.containerWidth();
            if (width > 0 && !initialColumnsCalculated) {
                initialColumnsCalculated = true;
                this.calculateOptimalColumns();
            }
        });
        
        // On resize, clamp columns if they no longer fit
        effect(() => {
            const width = this.containerWidth();
            this.updatePickerPositionTrigger.update(v => v + 1);
            if (width > 0) {
                this.clampColumnsToFit();
            }
        });
        
        // Setup scroll listeners to update picker position
        effect((onCleanup) => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            const onScroll = () => {
                this.updatePickerPositionTrigger.update(v => v + 1);
            };
            
            container.addEventListener('scroll', onScroll, { passive: true });
            
            onCleanup(() => {
                container.removeEventListener('scroll', onScroll);
            });
        });
    }
    
    onCardCellClick(event: MouseEvent, unit: ASForceUnit): void {
        // Mark as internal selection to prevent the effect from scrolling
        this.internalSelectionInProgress = true;
        this.forceBuilderService.selectUnit(unit);
        
        // Scroll to the clicked card cell
        const cardCell = (event.currentTarget as HTMLElement);
        cardCell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    onEditPilot(unit: ASForceUnit): void {
        this.forceBuilderService.editPilotOfUnit(unit);
    }
    
    toggleHexMode(): void {
        this.optionsService.setOption('ASUseHex', !this.useHex());
    }
    
    toggleCardStyle(): void {
        this.optionsService.setOption('ASCardStyle', this.cardStyle() === 'colored' ? 'monochrome' : 'colored');
    }
    
    resetZoom(): void {
        this.calculateOptimalColumns();
    }
    
    /**
     * Calculate optimal column count based on container width and base cell width.
     */
    private calculateOptimalColumns(): void {
        const width = this.containerWidth();
        if (width <= 0) return;
        
        const availableWidth = width - CONTAINER_PADDING;
        // How many BASE_CELL_WIDTH cells fit?
        const cols = Math.max(1, Math.floor((availableWidth + CELL_GAP) / (BASE_CELL_WIDTH + CELL_GAP)));
        if (cols != this.columnCount()) {
            this.updatePickerPositionTrigger.update(v => v + 1);
        }
        this.columnCount.set(cols);
    }
    
    /**
     * Clamp column count to what can fit at MIN_CELL_WIDTH.
     * Called on resize to prevent horizontal overflow
     */
    private clampColumnsToFit(): void {
        const currentCols = this.columnCount();
        const maxCols = this.getMaxColumns();
        
        // Only reduce columns if current count exceeds what can fit
        if (currentCols > maxCols) {
            this.columnCount.set(maxCols);
        }
    }
    
    /**
     * Get maximum number of columns that can fit (at minimum cell width).
     */
    private getMaxColumns(): number {
        const width = this.containerWidth();
        if (width <= 0) return 1;
        
        const availableWidth = width - CONTAINER_PADDING;
        return Math.max(1, Math.floor((availableWidth + CELL_GAP) / (MIN_CELL_WIDTH + CELL_GAP)));
    }
    
    // Ctrl+Wheel to change column count
    onWheel(event: WheelEvent): void {
        if (!event.ctrlKey) return;
        event.preventDefault();

        const deltaY = event.deltaY;
        if (deltaY === 0) return;

        const direction = (deltaY > 0 ? 1 : -1) as -1 | 1;
        const maxCols = this.getMaxColumns();

        const applyRequestedCols = (requestedCols: number) => {
            const nextCols = Math.min(maxCols, Math.max(1, requestedCols));
            if (nextCols !== this.columnCount()) {
                this.columnCount.set(nextCols);
            }
        };

        // For LINE/PAGE modes, treat each wheel event as a discrete tick.
        // Pixel mode (common for touchpads) can spam tiny deltas, so we accumulate and threshold.
        if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
            this.wheelState = null;

            applyRequestedCols(this.columnCount() + direction);
            return;
        }

        const now = (typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp)) ? event.timeStamp : Date.now();

        const deltaPx = deltaY;

        if (!this.wheelState) {
            this.wheelState = {
                accumulatedDeltaPx: 0,
                lastDirection: 0,
                lastEventTime: now
            };
        }

        // If the gesture paused, or direction changed, restart accumulation.
        if (
            (now - this.wheelState.lastEventTime) > WHEEL_IDLE_RESET_MS ||
            (this.wheelState.lastDirection !== 0 && this.wheelState.lastDirection !== direction)
        ) {
            this.wheelState.accumulatedDeltaPx = 0;
        }

        this.wheelState.lastEventTime = now;
        this.wheelState.lastDirection = direction;
        this.wheelState.accumulatedDeltaPx += deltaPx;

        const tickCount = Math.trunc(Math.abs(this.wheelState.accumulatedDeltaPx) / WHEEL_TICK_THRESHOLD_PX);
        if (tickCount <= 0) return;

        // Apply the column changes, 1 step, regardless of the number of tickCount detected.
        applyRequestedCols(this.columnCount() + direction);

        // Reset accumulation
        this.wheelState.accumulatedDeltaPx = 0;
    }
    
    private scrollToSelectedUnit(selectedUnit: ASForceUnit): void {
        const targetWrapper = this.cardWrappers().find(
            wrapper => wrapper.nativeElement.getAttribute('data-unit-id') === selectedUnit.id
        );
        const behavior = this.firstScroll ? 'instant' as ScrollBehavior : 'smooth';
        this.firstScroll = false;
        targetWrapper?.nativeElement.scrollIntoView({ behavior, block: 'center' });
    }
    
    // ==================== Pinch Gesture ====================
    
    onPointerDown(event: PointerEvent): void {
        if (event.pointerType !== 'touch') return;
        if (this.pointers.size >= 2) return;
        
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        
        if (this.pointers.size === 2) {
            this.initPinch();
        }
    }
    
    onPointerMove(event: PointerEvent): void {
        if (!this.pointers.has(event.pointerId)) return;
        
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        
        if (this.pointers.size === 2 && this.pinchState) {
            this.handlePinch();
        }
    }
    
    onPointerUp(event: PointerEvent): void {
        this.pointers.delete(event.pointerId);
        
        if (this.pointers.size < 2) {
            this.pinchState = null;
        }
    }
    
    private initPinch(): void {
        const points = Array.from(this.pointers.values());
        if (points.length < 2) return;
        
        const distance = this.getDistance(points[0], points[1]);
        
        this.pinchState = {
            lastDistance: distance,
            accumulatedDelta: 0
        };
    }
    
    private handlePinch(): void {
        if (!this.pinchState) return;
        
        const points = Array.from(this.pointers.values());
        if (points.length < 2) return;
        
        const currentDistance = this.getDistance(points[0], points[1]);
        const delta = currentDistance - this.pinchState.lastDistance;
        
        this.pinchState.lastDistance = currentDistance;
        this.pinchState.accumulatedDelta += delta;
        
        const currentCols = this.columnCount();
        const maxCols = this.getMaxColumns();

        const thresholdPx = this.getPinchThresholdPx();
        
        // Check if we've accumulated enough delta to trigger a column change
        if (this.pinchState.accumulatedDelta >= thresholdPx) {
            // Pinch out (zoom in) = fewer columns
            if (currentCols > 1) {
                this.columnCount.set(currentCols - 1);
            }
            this.pinchState.accumulatedDelta = 0;
        } else if (this.pinchState.accumulatedDelta <= -thresholdPx) {
            // Pinch in (zoom out) = more columns
            if (currentCols < maxCols) {
                this.columnCount.set(currentCols + 1);
            }
            this.pinchState.accumulatedDelta = 0;
        }
    }

    private getPinchThresholdPx(): number {
        const container = this.viewerContainer()?.nativeElement;
        const width = container?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
        const height = container?.clientHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 0);

        // Fallback to a sensible default if sizes are unavailable.
        if (width <= 0 || height <= 0) return 80;

        const diagonal = Math.sqrt(width * width + height * height);
        const threshold = Math.round(diagonal * PINCH_THRESHOLD_RATIO);
        return Math.min(PINCH_THRESHOLD_MAX_PX, Math.max(PINCH_THRESHOLD_MIN_PX, threshold));
    }
    
    private getDistance(p1: Point, p2: Point): number {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
