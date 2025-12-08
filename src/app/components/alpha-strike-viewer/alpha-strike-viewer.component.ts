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

import { Component, ChangeDetectionStrategy, input, inject, computed, effect, ElementRef, viewChildren, signal, DestroyRef, viewChild, afterNextRender, untracked } from '@angular/core';
import { AlphaStrikeCardComponent } from '../alpha-strike-card/alpha-strike-card.component';
import { OptionsService } from '../../services/options.service';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { ASForce } from '../../models/as-force.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';

/*
 * Author: Drake
 */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const BASE_CARD_WIDTH = 350;
const MIN_CARD_WIDTH = 280;
const CARD_GAP = 8;
const CONTAINER_PADDING = 16;

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
        '(wheel)': 'onWheel($event)'
    }
})
export class AlphaStrikeViewerComponent {
    private readonly optionsService = inject(OptionsService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly layoutService = inject(LayoutService);
    private readonly destroyRef = inject(DestroyRef);
    
    unit = input<ASForceUnit | null>(null);
    force = input<ASForce | null>(null);
    
    private readonly cardWrappers = viewChildren<ElementRef<HTMLElement>>('cardWrapper');
    private readonly viewerContainer = viewChild<ElementRef<HTMLElement>>('viewerContainer');
    
    readonly useHex = computed(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().ASCardStyle);
    
    // Zoom state
    readonly zoom = signal(1);
    private currentColumnCount = 1;
    private isInitialized = false;
    
    // Computed card width
    readonly cardWidth = computed(() => Math.max(MIN_CARD_WIDTH, BASE_CARD_WIDTH * this.zoom()));
    
    // Pointer tracking state
    private readonly pointers = new Map<number, Point>();
    private pinchState: { initialDistance: number; initialZoom: number; lastCenter: Point } | null = null;
    private panState: { lastPosition: Point } | null = null;
    
    constructor() {
        this.setupEffects();
        this.destroyRef.onDestroy(() => this.pointers.clear());
    }
    
    private setupEffects(): void {
        // Scroll to selected unit
        effect(() => {
            const selectedUnit = this.unit();
            if (selectedUnit) {
                setTimeout(() => this.scrollToSelectedUnit(selectedUnit), 0);
            }
        });
        
        // React to window resize
        effect(() => {
            this.layoutService.windowWidth();
            if (!this.layoutService.isPhone()) {
                this.layoutService.isMenuOpen(); // We track this to handle menu compact/expand
            }
            if (this.isInitialized) {
                untracked(() => this.adjustZoomForResize());
            }
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
        this.currentColumnCount = numColumns;
    }
    
    private calculateZoomForColumnCount(availableWidth: number, numColumns: number): number {
        const idealCardWidth = (availableWidth - (numColumns - 1) * CARD_GAP) / numColumns;
        const zoom = idealCardWidth / BASE_CARD_WIDTH;
        
        // Clamp and ensure minimum card width
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        return BASE_CARD_WIDTH * clampedZoom < MIN_CARD_WIDTH 
            ? MIN_CARD_WIDTH / BASE_CARD_WIDTH 
            : clampedZoom;
    }
    
    private isValidZoomForColumns(availableWidth: number, numColumns: number): boolean {
        const idealCardWidth = (availableWidth - (numColumns - 1) * CARD_GAP) / numColumns;
        const zoom = idealCardWidth / BASE_CARD_WIDTH;
        const minZoomForColumns = MIN_CARD_WIDTH / BASE_CARD_WIDTH;
        return zoom >= MIN_ZOOM && zoom >= minZoomForColumns && zoom <= MAX_ZOOM;
    }
    
    private adjustZoomForResize(): void {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return;
        
        // Try to maintain current column count
        if (this.isValidZoomForColumns(availableWidth, this.currentColumnCount)) {
            this.zoom.set(this.calculateZoomForColumnCount(availableWidth, this.currentColumnCount));
            return;
        }
        
        // Calculate unbounded zoom for current columns
        const idealCardWidth = (availableWidth - (this.currentColumnCount - 1) * CARD_GAP) / this.currentColumnCount;
        const unboundedZoom = idealCardWidth / BASE_CARD_WIDTH;
        
        // Adjust columns incrementally
        const searchDirection = unboundedZoom > MAX_ZOOM ? 1 : -1;
        const startCols = this.currentColumnCount + searchDirection;
        const endCols = searchDirection > 0 ? 10 : 1;
        
        for (let cols = startCols; searchDirection > 0 ? cols <= endCols : cols >= endCols; cols += searchDirection) {
            if (this.isValidZoomForColumns(availableWidth, cols)) {
                this.zoom.set(this.calculateZoomForColumnCount(availableWidth, cols));
                this.currentColumnCount = cols;
                return;
            }
        }
        
        // Fallback
        this.zoom.set(searchDirection > 0 ? MAX_ZOOM : Math.max(MIN_ZOOM, MIN_CARD_WIDTH / BASE_CARD_WIDTH));
        if (searchDirection < 0) this.currentColumnCount = 1;
    }
    
    private getMinZoomForCurrentLayout(): number {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return MIN_ZOOM;
        
        // Check if another column can fit
        const nextColumnCount = this.currentColumnCount + 1;
        const cardWidthForNextColumn = (availableWidth - (nextColumnCount - 1) * CARD_GAP) / nextColumnCount;
        
        if (cardWidthForNextColumn >= MIN_CARD_WIDTH) {
            return MIN_ZOOM; // Can fit another column, allow full zoom out
        }
        
        // Can't fit another column - clamp to optimal zoom for current columns
        const optimalCardWidth = (availableWidth - (this.currentColumnCount - 1) * CARD_GAP) / this.currentColumnCount;
        return Math.max(MIN_ZOOM, optimalCardWidth / BASE_CARD_WIDTH);
    }
    
    /**
     * Calculate the optimal zoom level that would show the next column count.
     * Returns null if the next column count isn't valid (e.g., cards would be too small).
     */
    private getZoomForNextColumn(): number | null {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return null;
        
        const nextColumnCount = this.currentColumnCount + 1;
        const optimalZoom = this.calculateZoomForColumnCount(availableWidth, nextColumnCount);
        
        // Check if this zoom is valid (respects MIN_CARD_WIDTH and MIN_ZOOM)
        const resultingCardWidth = BASE_CARD_WIDTH * optimalZoom;
        if (resultingCardWidth < MIN_CARD_WIDTH || optimalZoom < MIN_ZOOM) {
            return null;
        }
        
        return optimalZoom;
    }
    
    /**
     * Clamp zoom value within valid range.
     * Always applies layout-aware minimum to prevent over-zooming that leaves empty space.
     */
    private clampZoom(value: number): number {
        const minZoom = this.getMinZoomForCurrentLayout();
        return Math.max(minZoom, Math.min(MAX_ZOOM, value));
    }
    
    private updateColumnCount(): void {
        const availableWidth = this.getAvailableWidth();
        if (availableWidth <= 0) return;
        
        const currentCardWidth = this.cardWidth();
        this.currentColumnCount = Math.max(1, Math.floor((availableWidth + CARD_GAP) / (currentCardWidth + CARD_GAP)));
    }
    
    // ==================== Zoom with Center Point ====================
    
    private applyZoomAtPoint(newZoom: number, centerX: number, centerY: number): void {
        const container = this.viewerContainer()?.nativeElement;
        if (!container) {
            this.zoom.set(newZoom);
            return;
        }
        
        const oldZoom = this.zoom();
        const oldColumnCount = this.currentColumnCount;
        
        // Get scroll position relative to the zoom center point
        const rect = container.getBoundingClientRect();
        const pointInContainer = {
            x: centerX - rect.left,
            y: centerY - rect.top
        };
        
        // Calculate the content position at the zoom point before zoom
        const contentXBefore = container.scrollLeft + pointInContainer.x;
        const contentYBefore = container.scrollTop + pointInContainer.y;
        
        // Apply new zoom
        this.zoom.set(newZoom);
        this.updateColumnCount();
        
        // If column count changed, don't try to maintain position (layout shifts too much)
        if (this.currentColumnCount !== oldColumnCount) {
            return;
        }
        
        // Calculate scale ratio
        const scaleRatio = newZoom / oldZoom;
        
        // Calculate new scroll position to keep the zoom point stationary
        const newScrollLeft = contentXBefore * scaleRatio - pointInContainer.x;
        const newScrollTop = contentYBefore * scaleRatio - pointInContainer.y;
        
        // Apply new scroll position (will be clamped by browser)
        container.scrollLeft = Math.max(0, newScrollLeft);
        container.scrollTop = Math.max(0, newScrollTop);
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
            ? this.currentColumnCount + 1 
            : this.currentColumnCount - 1;
        
        // Validate the target column count
        if (targetColumns < 1) return;
        if (!this.isValidZoomForColumns(availableWidth, targetColumns)) return;
        
        // Apply optimal zoom for the new column count
        const newZoom = this.calculateZoomForColumnCount(availableWidth, targetColumns);
        this.zoom.set(newZoom);
        this.currentColumnCount = targetColumns;
    }
    
    onPointerDown(event: PointerEvent): void {
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        
        if (this.pointers.size === 2) {
            this.initPinch();
        } else if (this.pointers.size === 1) {
            this.initPan(event);
        }
    }
    
    onPointerMove(event: PointerEvent): void {
        if (!this.pointers.has(event.pointerId)) return;
        
        const prevPosition = this.pointers.get(event.pointerId)!;
        const newPosition = { x: event.clientX, y: event.clientY };
        this.pointers.set(event.pointerId, newPosition);
        
        if (this.pointers.size === 2 && this.pinchState) {
            this.handlePinchMove(prevPosition, newPosition);
        } else if (this.pointers.size === 1 && this.panState) {
            this.handlePanMove(newPosition);
        }
    }
    
    onPointerUp(event: PointerEvent): void {
        this.pointers.delete(event.pointerId);
        
        if (this.pointers.size < 2) {
            this.pinchState = null;
        }
        if (this.pointers.size === 0) {
            this.panState = null;
        }
        // If one pointer remains after pinch, start panning from that pointer
        if (this.pointers.size === 1 && !this.panState) {
            const [remainingPointer] = this.pointers.values();
            this.panState = { lastPosition: { ...remainingPointer } };
        }
    }
    
    onPointerCancel(event: PointerEvent): void {
        this.onPointerUp(event);
    }
    
    // ==================== Pinch Handling ====================
    
    private initPinch(): void {
        const points = Array.from(this.pointers.values());
        if (points.length < 2) return;
        
        this.pinchState = {
            initialDistance: this.getDistance(points[0], points[1]),
            initialZoom: this.zoom(),
            lastCenter: this.getCenter(points[0], points[1])
        };
        this.panState = null; // Stop single-finger pan when pinch starts
    }
    
    private handlePinchMove(_prevPosition: Point, _newPosition: Point): void {
        if (!this.pinchState) return;
        
        const points = Array.from(this.pointers.values());
        if (points.length < 2) return;
        
        const currentDistance = this.getDistance(points[0], points[1]);
        const currentCenter = this.getCenter(points[0], points[1]);
        
        // Calculate target zoom from pinch scale
        const scale = currentDistance / this.pinchState.initialDistance;
        let targetZoom = this.pinchState.initialZoom * scale;
        const currentZoom = this.zoom();
        const isZoomingOut = targetZoom < currentZoom;
        
        // Handle zoom clamping with column snapping
        let newZoom: number;
        if (isZoomingOut) {
            const nextColumnZoom = this.getZoomForNextColumn();
            if (nextColumnZoom !== null && targetZoom <= nextColumnZoom) {
                // Snap to optimal zoom for the new column count
                newZoom = nextColumnZoom;
            } else {
                newZoom = this.clampZoom(targetZoom);
            }
        } else {
            newZoom = Math.min(MAX_ZOOM, targetZoom);
        }
        
        // Handle simultaneous pan
        const container = this.viewerContainer()?.nativeElement;
        if (container) {
            const panDeltaX = currentCenter.x - this.pinchState.lastCenter.x;
            const panDeltaY = currentCenter.y - this.pinchState.lastCenter.y;
            
            // Apply pan before zoom to keep gesture feeling natural
            container.scrollLeft -= panDeltaX;
            container.scrollTop -= panDeltaY;
        }
        
        // Apply zoom centered on pinch midpoint
        if (newZoom !== currentZoom) {
            this.applyZoomAtPoint(newZoom, currentCenter.x, currentCenter.y);
        }
        
        // Always reset baseline when zoom was clamped to prevent flickering
        // This makes the pinch "stick" at the clamped value
        if (newZoom !== targetZoom) {
            this.pinchState.initialDistance = currentDistance;
            this.pinchState.initialZoom = newZoom;
        }
        
        // Update last center for next pan delta
        this.pinchState.lastCenter = currentCenter;
    }
    
    // ==================== Pan Handling ====================
    
    private initPan(event: PointerEvent): void {
        // Only allow pan for touch or middle mouse button
        if (event.pointerType === 'mouse' && event.button !== 1) return;
        
        this.panState = { lastPosition: { x: event.clientX, y: event.clientY } };
    }
    
    private handlePanMove(newPosition: Point): void {
        if (!this.panState) return;
        
        const container = this.viewerContainer()?.nativeElement;
        if (!container) return;
        
        const dx = newPosition.x - this.panState.lastPosition.x;
        const dy = newPosition.y - this.panState.lastPosition.y;
        
        container.scrollLeft -= dx;
        container.scrollTop -= dy;
        
        this.panState.lastPosition = newPosition;
    }
    
    // ==================== Utilities ====================
    
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
    
    private getCenter(p1: Point, p2: Point): Point {
        return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        };
    }
}
