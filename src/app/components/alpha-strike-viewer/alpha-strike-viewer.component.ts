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
import { PageViewerCanvasControlsComponent } from '../page-viewer/canvas/page-viewer-canvas-controls.component';
import { PageCanvasOverlayComponent } from '../page-viewer/canvas/page-canvas-overlay.component';
import { PageViewerCanvasService } from '../page-viewer/canvas/page-viewer-canvas.service';
import { DbService } from '../../services/db.service';

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
const CONTAINER_PADDING = 16 * 2; // left + right padding

// Pinch zoom threshold: distance change (in pixels) required to trigger a column change
const PINCH_THRESHOLD = 40;

interface Point {
    x: number;
    y: number;
}

@Component({
    selector: 'alpha-strike-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlphaStrikeCardComponent, PageCanvasOverlayComponent, PageViewerCanvasControlsComponent],
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
    
    private resizeObserver: ResizeObserver | null = null;
    
    // Pinch gesture state
    private readonly pointers = new Map<number, Point>();
    private pinchState: {
        lastDistance: number;
        accumulatedDelta: number;
    } | null = null;
    
    // Flag to prevent scroll effect when selection is made by clicking a card
    private internalSelectionInProgress = false;
    
    constructor() {
        this.setupEffects();
        this.destroyRef.onDestroy(() => {
            this.resizeObserver?.disconnect();
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
    
    /**
     * Handle canvas clear request from controls - delete canvas data for current unit
     */
    onCanvasClearRequested(): void {
        const currentUnit = this.unit();
        if (currentUnit) {
            // AS cards use a different canvas ID format
            this.dbService.deleteCanvasData(`${currentUnit.id}-as`);
        }
    }

    private setupEffects(): void {
        // Scroll to selected unit when selection changes externally
        effect(() => {
            const selectedUnit = this.unit();
            if (selectedUnit && !this.internalSelectionInProgress) {
                setTimeout(() => this.scrollToSelectedUnit(selectedUnit), 0);
            }
            this.internalSelectionInProgress = false;
        });
        
        // Setup touch event listeners to prevent iOS native pinch gestures
        effect(() => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            const preventPinchZoom = (e: TouchEvent) => {
                if (e.touches.length >= 2) {
                    e.preventDefault();
                }
            };
            
            container.addEventListener('touchmove', preventPinchZoom, { passive: false });
            
            this.destroyRef.onDestroy(() => {
                container.removeEventListener('touchmove', preventPinchZoom);
            });
        });
        
        // Setup ResizeObserver to track container width
        effect(() => {
            const container = this.viewerContainer()?.nativeElement;
            if (!container) return;
            
            this.resizeObserver?.disconnect();
            
            this.resizeObserver = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (entry) {
                    this.containerWidth.set(entry.contentRect.width);
                }
            });
            
            this.resizeObserver.observe(container);
        });
        
        // Calculate optimal column count on initial render and when container resizes
        afterNextRender(() => {
            this.calculateOptimalColumns();
        });
        
        // Recalculate optimal columns when container width changes significantly
        effect(() => {
            const width = this.containerWidth();
            if (width > 0) {
                this.calculateOptimalColumns();
            }
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
        this.columnCount.set(cols);
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
        
        const currentCols = this.columnCount();
        const maxCols = this.getMaxColumns();
        
        if (event.deltaY > 0) {
            // Scroll down = zoom out = more columns
            if (currentCols < maxCols) {
                this.columnCount.set(currentCols + 1);
            }
        } else {
            // Scroll up = zoom in = fewer columns
            if (currentCols > 1) {
                this.columnCount.set(currentCols - 1);
            }
        }
    }
    
    private scrollToSelectedUnit(selectedUnit: ASForceUnit): void {
        const targetWrapper = this.cardWrappers().find(
            wrapper => wrapper.nativeElement.getAttribute('data-unit-id') === selectedUnit.id
        );
        targetWrapper?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        
        // Check if we've accumulated enough delta to trigger a column change
        if (this.pinchState.accumulatedDelta >= PINCH_THRESHOLD) {
            // Pinch out (zoom in) = fewer columns
            if (currentCols > 1) {
                this.columnCount.set(currentCols - 1);
            }
            this.pinchState.accumulatedDelta = 0;
        } else if (this.pinchState.accumulatedDelta <= -PINCH_THRESHOLD) {
            // Pinch in (zoom out) = more columns
            if (currentCols < maxCols) {
                this.columnCount.set(currentCols + 1);
            }
            this.pinchState.accumulatedDelta = 0;
        }
    }
    
    private getDistance(p1: Point, p2: Point): number {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
