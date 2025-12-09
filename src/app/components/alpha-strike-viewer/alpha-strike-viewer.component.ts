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

import { Component, ChangeDetectionStrategy, input, inject, computed, effect, ElementRef, viewChildren, signal, DestroyRef, viewChild, afterNextRender } from '@angular/core';
import { AlphaStrikeCardComponent } from '../alpha-strike-card/alpha-strike-card.component';
import { OptionsService } from '../../services/options.service';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { ASForce } from '../../models/as-force.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { getLayoutForUnitType } from '../alpha-strike-card/card-layout.config';

/**
 * Represents a renderable card item (a single card for a unit).
 * Multi-card units will produce multiple CardRenderItem entries.
 */
export interface CardRenderItem {
    forceUnit: ASForceUnit;
    cardIndex: number;
    /** Unique key for tracking in @for loops */
    trackKey: string;
}

/*
 * Author: Drake
 */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const BASE_CARD_WIDTH = 350;
const MIN_CARD_WIDTH = 280;
const CARD_GAP = 8;
const CONTAINER_PADDING = 16;

// Pinch distance change required to trigger a column change (in pixels)
const PINCH_COLUMN_STEP_THRESHOLD = 40;

interface Point {
    x: number;
    y: number;
}

@Component({
    selector: 'alpha-strike-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlphaStrikeCardComponent],
    templateUrl: './alpha-strike-viewer.component.html',
    styleUrl: './alpha-strike-viewer.component.scss',
    host: {
        '(wheel)': 'onWheel($event)',
        // Prevent iOS Safari's native gesture handling (pinch-to-close)
        '(gesturestart)': 'onGestureStart($event)',
        '(gesturechange)': 'onGestureChange($event)',
        '(gestureend)': 'onGestureEnd($event)'
    }
})
export class AlphaStrikeViewerComponent {
    private readonly optionsService = inject(OptionsService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly destroyRef = inject(DestroyRef);
    
    unit = input<ASForceUnit | null>(null);
    force = input<ASForce | null>(null);
    
    private readonly cardWrappers = viewChildren<ElementRef<HTMLElement>>('cardWrapper');
    private readonly viewerContainer = viewChild<ElementRef<HTMLElement>>('viewerContainer');
    
    readonly useHex = computed(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().ASCardStyle);
    
    // Zoom state - zoom controls card size, columnCount controls grid columns
    readonly zoom = signal(1);
    readonly columnCount = signal(1);
    private isInitialized = false;
    private resizeObserver: ResizeObserver | null = null;
    private lastObservedWidth = 0;
    
    /**
     * Get the number of cards for a given unit type.
     */
    getCardCount(forceUnit: ASForceUnit): number {
        const unitType = forceUnit.getUnit().as.TP;
        return getLayoutForUnitType(unitType).cards.length;
    }
    
    /**
     * Generate card render items for a unit (handles multi-card units).
     */
    getCardRenderItems(forceUnit: ASForceUnit): CardRenderItem[] {
        const cardCount = this.getCardCount(forceUnit);
        const items: CardRenderItem[] = [];
        for (let i = 0; i < cardCount; i++) {
            items.push({
                forceUnit,
                cardIndex: i,
                trackKey: `${forceUnit.id}-card-${i}`
            });
        }
        return items;
    }
    
    // Computed card width - use floor to ensure consistent pixel widths that don't cause wrapping
    readonly cardWidth = computed(() => Math.floor(Math.max(MIN_CARD_WIDTH, BASE_CARD_WIDTH * this.zoom())));
    
    // Pointer tracking state for pinch gesture
    private readonly pointers = new Map<number, Point>();
    private pinchState: {
        /** Distance at the start of the pinch or after a column step */
        baselineDistance: number;
        /** Accumulated distance change since last column step (positive = zoom in, negative = zoom out) */
        accumulatedDelta: number;
        /** Whether we're in smooth zoom mode (at 1 column, zoomed in beyond optimal) */
        smoothZoomMode: boolean;
        /** Baseline zoom when smooth zoom mode started */
        smoothZoomBaselineZoom: number;
        /** Baseline distance when smooth zoom mode started */
        smoothZoomBaselineDistance: number;
    } | null = null;
    private gestureStarted = false;
    private pointerStartPosition: Point | null = null;
    
    constructor() {
        this.setupEffects();
        this.destroyRef.onDestroy(() => {
            this.pointers.clear();
            this.resizeObserver?.disconnect();
        });
    }
    
    private setupEffects(): void {
        // Scroll to selected unit
        effect(() => {
            const selectedUnit = this.unit();
            if (selectedUnit) {
                setTimeout(() => this.scrollToSelectedUnit(selectedUnit), 0);
            }
        });
        
        // Setup touch event listener to intercept multi-touch early (iOS fix)
        effect(() => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            // Use native touchstart with passive: false to intercept multi-touch
            const handleTouchStart = (e: TouchEvent) => {
                if (e.touches.length >= 2) {
                    // Prevent iOS from starting its gesture recognition
                    e.preventDefault();
                }
            };
            
            const handleTouchMove = (e: TouchEvent) => {
                if (e.touches.length >= 2) {
                    // Prevent iOS pinch-to-close during multi-touch
                    e.preventDefault();
                }
            };
            
            container.addEventListener('touchstart', handleTouchStart, { passive: false });
            container.addEventListener('touchmove', handleTouchMove, { passive: false });
            
            this.destroyRef.onDestroy(() => {
                container.removeEventListener('touchstart', handleTouchStart);
                container.removeEventListener('touchmove', handleTouchMove);
            });
        });
        
        // Setup ResizeObserver for instant container width tracking
        effect(() => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            // Clean up previous observer if container changed
            this.resizeObserver?.disconnect();
            
            this.resizeObserver = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (!entry) return;
                
                const newWidth = entry.contentRect.width;
                // Only react if width actually changed (avoid height-only changes)
                if (Math.abs(newWidth - this.lastObservedWidth) < 1) return;
                this.lastObservedWidth = newWidth;
                
                if (this.isInitialized) {
                    this.adjustZoomForResize();
                }
            });
            
            this.resizeObserver.observe(container);
        });
        
        // Auto-zoom on initial render
        afterNextRender(() => {
            this.calculateOptimalZoom();
            this.isInitialized = true;
        });
    }
    
    onUnitSelected(unit: ASForceUnit): void {
        this.forceBuilderService.selectUnit(unit);
    }
    
    toggleHexMode(): void {
        this.optionsService.setOption('ASUseHex', !this.useHex());
    }
    
    toggleCardStyle(): void {
        this.optionsService.setOption('ASCardStyle', this.cardStyle() === 'colored' ? 'monochrome' : 'colored');
    }
    
    resetZoom(): void {
        this.calculateOptimalZoom();
    }
    
    // ==================== Zoom Calculation ====================
    
    private getAvailableWidth(): number {
        const container = this.viewerContainer()?.nativeElement;
        return container ? container.clientWidth - CONTAINER_PADDING : 0;
    }
    
    private calculateOptimalZoom(): void {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return;
        
        const columnsAtZoom1 = (availableWidth + CARD_GAP) / (BASE_CARD_WIDTH + CARD_GAP);
        const numColumns = Math.max(1, Math.floor(columnsAtZoom1));
        const optimalZoom = this.calculateZoomForColumnCount(availableWidth, numColumns);
        
        this.zoom.set(optimalZoom);
        this.columnCount.set(numColumns);
    }
    
    private calculateZoomForColumnCount(availableWidth: number, numColumns: number): number {
        // Calculate the card width that fits numColumns exactly
        // Formula: numColumns * cardWidth + (numColumns - 1) * gap = availableWidth
        const idealCardWidth = (availableWidth - (numColumns - 1) * CARD_GAP) / numColumns;
        const zoom = idealCardWidth / BASE_CARD_WIDTH;
        
        // Clamp and ensure minimum card width
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        const resultingCardWidth = Math.floor(BASE_CARD_WIDTH * clampedZoom);
        
        return resultingCardWidth < MIN_CARD_WIDTH 
            ? MIN_CARD_WIDTH / BASE_CARD_WIDTH 
            : clampedZoom;
    }
    
    /**
     * Check if a given number of columns can fit at a valid zoom level.
     */
    private isValidZoomForColumns(availableWidth: number, numColumns: number): boolean {
        const idealCardWidth = (availableWidth - (numColumns - 1) * CARD_GAP) / numColumns;
        const zoom = idealCardWidth / BASE_CARD_WIDTH;
        
        // Check zoom bounds
        if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return false;
        
        // Check resulting card width
        const resultingCardWidth = Math.floor(BASE_CARD_WIDTH * zoom);
        return resultingCardWidth >= MIN_CARD_WIDTH;
    }
    
    private adjustZoomForResize(): void {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return;
        
        const currentCols = this.columnCount();
        
        // Try to maintain current column count
        if (this.isValidZoomForColumns(availableWidth, currentCols)) {
            this.zoom.set(this.calculateZoomForColumnCount(availableWidth, currentCols));
            return;
        }
        
        // Calculate unbounded zoom for current columns
        const idealCardWidth = (availableWidth - (currentCols - 1) * CARD_GAP) / currentCols;
        const unboundedZoom = idealCardWidth / BASE_CARD_WIDTH;
        
        // Adjust columns incrementally
        const searchDirection = unboundedZoom > MAX_ZOOM ? 1 : -1;
        const startCols = currentCols + searchDirection;
        const endCols = searchDirection > 0 ? 10 : 1;
        
        for (let cols = startCols; searchDirection > 0 ? cols <= endCols : cols >= endCols; cols += searchDirection) {
            if (this.isValidZoomForColumns(availableWidth, cols)) {
                this.zoom.set(this.calculateZoomForColumnCount(availableWidth, cols));
                this.columnCount.set(cols);
                return;
            }
        }
        
        // Fallback
        this.zoom.set(searchDirection > 0 ? MAX_ZOOM : Math.max(MIN_ZOOM, MIN_CARD_WIDTH / BASE_CARD_WIDTH));
        if (searchDirection < 0) this.columnCount.set(1);
    }
    
    /**
     * Get the optimal zoom level for a given column count.
     * Returns null if the column count is invalid.
     */
    private getOptimalZoomForColumns(columns: number): number | null {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0 || columns < 1) return null;
        
        if (!this.isValidZoomForColumns(availableWidth, columns)) {
            return null;
        }
        
        return this.calculateZoomForColumnCount(availableWidth, columns);
    }
    
    /**
     * Calculate the maximum number of columns that can fit at MIN_ZOOM,
     * and return both the column count and the optimal zoom for that count.
     * This determines the "most zoomed out" state.
     */
    private getMaxZoomOutState(): { columns: number; zoom: number } {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return { columns: 1, zoom: MIN_ZOOM };
        
        // Calculate card width at MIN_ZOOM
        const cardWidthAtMinZoom = Math.floor(BASE_CARD_WIDTH * MIN_ZOOM);
        
        // If card at MIN_ZOOM is smaller than minimum, use minimum card width
        const effectiveCardWidth = Math.max(MIN_CARD_WIDTH, cardWidthAtMinZoom);
        
        // How many columns fit at this card width?
        const maxColumns = Math.max(1, Math.floor((availableWidth + CARD_GAP) / (effectiveCardWidth + CARD_GAP)));
        
        // Calculate optimal zoom for that column count
        const optimalZoom = this.calculateZoomForColumnCount(availableWidth, maxColumns);
        
        return { columns: maxColumns, zoom: optimalZoom };
    }
    
    // ==================== Event Handlers ====================
    
    onWheel(event: WheelEvent): void {
        if (!event.ctrlKey) return;
        
        event.preventDefault();
        
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return;
        
        // Wheel changes column count directly
        const isZoomingOut = event.deltaY > 0;
        const targetColumns = isZoomingOut 
            ? this.columnCount() + 1 
            : this.columnCount() - 1;
        
        // Validate the target column count
        if (targetColumns < 1) return;
        if (!this.isValidZoomForColumns(availableWidth, targetColumns)) return;
        
        // Apply optimal zoom for the new column count
        const newZoom = this.calculateZoomForColumnCount(availableWidth, targetColumns);
        this.zoom.set(newZoom);
        this.columnCount.set(targetColumns);
    }
    
    onPointerDown(event: PointerEvent): void {
        // Only track touch pointers for pinch gesture
        if (event.pointerType !== 'touch') return;
        
        // Ignore additional pointers beyond 2
        if (this.pointers.size >= 2) return;
        
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        
        if (this.pointers.size === 2) {
            // Two fingers - start pinch, prevent native scroll during pinch
            event.preventDefault();
            this.initPinch();
        } else if (this.pointers.size === 1) {
            // Single finger - track start position for threshold check
            this.pointerStartPosition = { x: event.clientX, y: event.clientY };
            this.gestureStarted = false;
        }
    }
    
    onPointerMove(event: PointerEvent): void {
        if (!this.pointers.has(event.pointerId)) return;
        
        const newPosition = { x: event.clientX, y: event.clientY };
        this.pointers.set(event.pointerId, newPosition);
        
        // Only handle pinch gesture (2 fingers)
        if (this.pointers.size !== 2 || !this.pinchState) return;
        
        // Check if we've moved past threshold to start gesture
        if (!this.gestureStarted && this.pointerStartPosition) {
            this.gestureStarted = true;
        }
        
        // Prevent default to stop native pinch-zoom
        event.preventDefault();
        this.handlePinchMove();
    }
    
    onPointerUp(event: PointerEvent): void {
        this.pointers.delete(event.pointerId);
        
        if (this.pointers.size < 2) {
            this.pinchState = null;
        }
        if (this.pointers.size === 0) {
            this.gestureStarted = false;
            this.pointerStartPosition = null;
        }
    }
    
    onPointerCancel(event: PointerEvent): void {
        this.onPointerUp(event);
    }
    
    // Prevent iOS Safari's native gesture events
    onGestureStart(event: Event): void {
        event.preventDefault();
    }
    
    onGestureChange(event: Event): void {
        event.preventDefault();
    }
    
    onGestureEnd(event: Event): void {
        event.preventDefault();
    }
    
    // ==================== Pinch Handling ====================

    private initPinch(): void {
        const points = Array.from(this.pointers.values());
        if (points.length < 2) return;
        
        const distance = this.getDistance(points[0], points[1]);
        const currentZoom = this.zoom();
        const optimalZoomFor1Col = this.getOptimalZoomForColumns(1);
        
        // Check if we're in smooth zoom mode (at 1 column, zoomed in beyond optimal)
        const inSmoothZoomMode = this.columnCount() === 1 && 
            optimalZoomFor1Col !== null && 
            currentZoom > optimalZoomFor1Col + 0.001;
        
        this.pinchState = {
            baselineDistance: distance,
            accumulatedDelta: 0,
            smoothZoomMode: inSmoothZoomMode,
            smoothZoomBaselineZoom: currentZoom,
            smoothZoomBaselineDistance: distance
        };
        this.gestureStarted = false;
    }
    
    private handlePinchMove(): void {
        if (!this.pinchState) return;
        
        const points = Array.from(this.pointers.values());
        if (points.length < 2) return;
        
        const currentDistance = this.getDistance(points[0], points[1]);
        const currentCols = this.columnCount();
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return;
        
        // Get zoom boundaries
        const maxZoomOutState = this.getMaxZoomOutState();
        const maxColumns = maxZoomOutState.columns;
        const optimalZoomFor1Col = this.getOptimalZoomForColumns(1) ?? 1;
        
        if (this.pinchState.smoothZoomMode) {
            // In smooth zoom mode - apply continuous zoom scaling
            // Don't accumulate delta in smooth zoom mode - we use direct scaling instead
            const scale = currentDistance / this.pinchState.smoothZoomBaselineDistance;
            let targetZoom = this.pinchState.smoothZoomBaselineZoom * scale;
            
            // Clamp between optimal 1-col zoom and MAX_ZOOM
            targetZoom = Math.max(optimalZoomFor1Col, Math.min(MAX_ZOOM, targetZoom));
            this.zoom.set(targetZoom);
            
            // Check if we should exit smooth zoom mode (zoomed out to optimal)
            if (targetZoom <= optimalZoomFor1Col + 0.001) {
                this.pinchState.smoothZoomMode = false;
                // Reset baseline for step-based mode - important to prevent immediate column jump
                this.pinchState.baselineDistance = currentDistance;
                this.pinchState.accumulatedDelta = 0;
            }
            // Always return in smooth zoom mode - column changes handled separately
            return;
        }
        
        // Step-based column changes
        // Calculate distance delta from baseline (only for step mode)
        const distanceDelta = currentDistance - this.pinchState.baselineDistance;
        this.pinchState.accumulatedDelta += distanceDelta;
        this.pinchState.baselineDistance = currentDistance;
        
        // Process one step at a time
        if (Math.abs(this.pinchState.accumulatedDelta) >= PINCH_COLUMN_STEP_THRESHOLD) {
            const isZoomingIn = this.pinchState.accumulatedDelta > 0;
            
            // Consume one step worth of delta
            this.pinchState.accumulatedDelta = isZoomingIn 
                ? this.pinchState.accumulatedDelta - PINCH_COLUMN_STEP_THRESHOLD
                : this.pinchState.accumulatedDelta + PINCH_COLUMN_STEP_THRESHOLD;
            
            if (isZoomingIn) {
                // Zooming in - decrease columns by 1
                if (currentCols > 1) {
                    const targetCols = currentCols - 1;
                    const newZoom = this.getOptimalZoomForColumns(targetCols);
                    if (newZoom !== null) {
                        this.columnCount.set(targetCols);
                        this.zoom.set(newZoom);
                    }
                } else {
                    // Already at 1 column - enter smooth zoom mode
                    this.pinchState.smoothZoomMode = true;
                    this.pinchState.smoothZoomBaselineZoom = this.zoom();
                    this.pinchState.smoothZoomBaselineDistance = currentDistance;
                    this.pinchState.accumulatedDelta = 0;
                }
            } else {
                // Zooming out - increase columns by 1
                if (currentCols < maxColumns) {
                    const targetCols = currentCols + 1;
                    const newZoom = this.getOptimalZoomForColumns(targetCols);
                    if (newZoom !== null) {
                        this.columnCount.set(targetCols);
                        this.zoom.set(newZoom);
                        // Clamp scroll position after layout change to prevent content disappearing
                        this.clampScrollPosition();
                    }
                }
                // If at max columns already, delta will keep accumulating but no action taken
            }
        }
    }
    
    // ==================== Utilities ====================
    
    /**
     * Clamp scroll position to valid range after layout changes.
     * This prevents the view from being scrolled beyond content bounds
     * when transitioning between column counts (which changes content height).
     */
    private clampScrollPosition(): void {
        const container = this.viewerContainer()?.nativeElement;
        if (!container) return;
        
        // Use requestAnimationFrame to wait for layout to update
        requestAnimationFrame(() => {
            const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
            const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
            
            if (container.scrollTop > maxScrollTop) {
                container.scrollTop = maxScrollTop;
            }
            if (container.scrollLeft > maxScrollLeft) {
                container.scrollLeft = maxScrollLeft;
            }
        });
    }
    
    private scrollToSelectedUnit(selectedUnit: ASForceUnit): void {
        const targetWrapper = this.cardWrappers().find(
            wrapper => wrapper.nativeElement.getAttribute('data-unit-id') === selectedUnit.id
        );
        targetWrapper?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    private getDistance(p1: Point, p2: Point): number {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
