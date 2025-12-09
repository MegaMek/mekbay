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

import {
    Component,
    input,
    output,
    ElementRef,
    AfterViewInit,
    Renderer2,
    Injector,
    signal,
    effect,
    inject,
    ChangeDetectionStrategy,
    viewChild,
    computed,
    DestroyRef,
    untracked,
    runInInjectionContext,
    createComponent,
    ApplicationRef,
    ComponentRef
} from '@angular/core';

import { ViewportTransform } from '../../models/force-serialization';
import {
    PageViewerZoomPanService,
    SwipeCallbacks,
    PAGE_WIDTH,
    PAGE_HEIGHT,
    PAGE_GAP
} from './page-viewer-zoom-pan.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { OptionsService } from '../../services/options.service';
import { LayoutService } from '../../services/layout.service';
import { DbService } from '../../services/db.service';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { CBTForce } from '../../models/cbt-force.model';
import { SvgInteractionService } from '../svg-viewer/svg-interaction.service';
import { HeatDiffMarkerComponent, HeatDiffMarkerData } from '../heat-diff-marker/heat-diff-marker.component';
import {
    PageViewerCanvasService,
    PageCanvasOverlayComponent,
    PageViewerCanvasControlsComponent
} from './canvas';
import { PageInteractionOverlayComponent } from './overlay';

/*
 * Author: Drake
 * 
 * PageViewerComponent - A multi-page SVG viewer with zoom/pan and continuous swipe navigation.
 * 
 * Features:
 * - Auto-fit content on load
 * - Zoom/pan with mouse wheel and touch pinch
 * - Continuous swipe between pages (one page at a time with loop support)
 * - Multi-page side-by-side view when viewport allows
 * - Pre-caching of neighbor pages for smooth transitions
 * - Per-page interaction services for full interactivity on all visible pages
 */

const SWIPE_COMMIT_THRESHOLD = 0.15; // 15% of page width
const SWIPE_VELOCITY_THRESHOLD = 300; // px/s for flick gesture

@Component({
    selector: 'page-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [PageViewerZoomPanService, PageViewerCanvasService],
    imports: [HeatDiffMarkerComponent, PageViewerCanvasControlsComponent],
    templateUrl: './page-viewer.component.html',
    styleUrls: ['./page-viewer.component.css']
})
export class PageViewerComponent implements AfterViewInit {
    private injector = inject(Injector);
    private renderer = inject(Renderer2);
    private appRef = inject(ApplicationRef);
    private zoomPanService = inject(PageViewerZoomPanService);
    private forceBuilder = inject(ForceBuilderService);
    private optionsService = inject(OptionsService);
    private dbService = inject(DbService);
    canvasService = inject(PageViewerCanvasService);
    layoutService = inject(LayoutService);

    // Inputs
    unit = input<CBTForceUnit | null>(null);
    force = input<CBTForce | null>(null);
    spaceEvenly = input(false);
    readOnly = input(false);

    // View children
    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    swipeWrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('swipeWrapper');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');

    // State
    loadError = signal<string | null>(null);
    currentSvg = signal<SVGSVGElement | null>(null);
    isPickerOpen = signal(false);

    // Heat diff marker data for each interaction service
    heatDiffMarkers = signal<Map<number, { data: HeatDiffMarkerData | null; visible: boolean }>>(new Map());

    // Computed properties
    isFullyVisible = computed(() => this.zoomPanService.isFullyVisible());
    visiblePageCount = computed(() => this.zoomPanService.visiblePageCount());

    // Swipe is allowed only when total pages > visible pages and not in canvas paint mode
    swipeAllowed = computed(() => {
        if (this.optionsService.options().swipeToNextSheet === 'disabled') {
            return false;
        }
        // Block swipe when canvas drawing is active
        if (this.canvasService.isActive()) {
            return false;
        }
        const totalPages = this.getTotalPageCount();
        const visiblePages = this.visiblePageCount();
        // Only allow swipe if we have more pages than can be shown at once
        return totalPages > visiblePages;
    });

    // Computed array of heat markers for template iteration
    heatDiffMarkerArray = computed(() => {
        const markers = this.heatDiffMarkers();
        return Array.from(markers.entries()).map(([index, state]) => ({
            index,
            data: state.data,
            visible: state.visible
        }));
    });

    // Private state
    private resizeObserver: ResizeObserver | null = null;
    private lastViewState: ViewportTransform | null = null;

    // Current displayed units for multi-page view
    private displayedUnits: CBTForceUnit[] = [];
    private pageElements: HTMLDivElement[] = [];

    // Interaction services - one per visible page
    private interactionServices = new Map<number, SvgInteractionService>();

    // Canvas overlay component refs - keyed by unit ID for reuse during swipe transitions
    private canvasOverlayRefs = new Map<string, ComponentRef<PageCanvasOverlayComponent>>();

    // Interaction overlay component refs - keyed by unit ID for reuse during swipe transitions
    private interactionOverlayRefs = new Map<string, ComponentRef<PageInteractionOverlayComponent>>();

    // Swipe state - track which units are displayed during swipe
    private baseDisplayStartIndex = 0; // The starting index before swipe began
    private swipeDisplayedIndices: number[] = []; // Indices of units shown during swipe
    private isSwiping = false; // Whether we're currently in a swipe gesture

    // View start index - tracks the leftmost displayed unit, independent of selection
    // This allows swiping without changing the selected unit
    private viewStartIndex = signal(0);

    // Track if view is initialized
    private viewInitialized = false;

    // Track display version to handle async loads
    private displayVersion = 0;

    constructor() {
        // Watch for unit changes
        let previousUnit: CBTForceUnit | null = null;

        effect(async () => {
            const currentUnit = this.unit();

            // Skip if view isn't ready yet
            if (!this.viewInitialized) {
                return;
            }

            // Load unit if needed
            if (currentUnit) {
                await currentUnit.load();
            }

            // Save previous unit's view state
            if (previousUnit && previousUnit !== currentUnit) {
                this.saveViewState(previousUnit);
            }

            // Check if the new unit is already displayed (no need to scroll/redisplay)
            const alreadyDisplayed = currentUnit && this.displayedUnits.some(u => u.id === currentUnit.id);
            
            if (alreadyDisplayed) {
                // Just update the selected state visually without redisplaying
                untracked(() => this.updateSelectedPageHighlight());
            } else {
                // Update viewStartIndex to show the selected unit and redisplay
                untracked(() => {
                    const force = this.forceBuilder.currentForce();
                    const allUnits = force?.units() ?? [];
                    if (currentUnit) {
                        const newIndex = allUnits.indexOf(currentUnit);
                        if (newIndex >= 0) {
                            this.viewStartIndex.set(newIndex);
                        }
                    }
                    this.displayUnit();
                });
            }

            previousUnit = currentUnit;
        }, { injector: this.injector });

        inject(DestroyRef).onDestroy(() => this.cleanup());
    }

    ngAfterViewInit(): void {
        this.viewInitialized = true;
        this.setupResizeObserver();
        this.setupPageClickCapture();
        this.initializeZoomPan();
        this.initializePickerMonitoring();
        this.updateDimensions();

        // Initial display after view is ready - load unit first if needed
        const currentUnit = this.unit();
        if (currentUnit) {
            currentUnit.load().then(() => {
                this.displayUnit();
            });
        }
    }

    // ========== Initialization ==========

    private setupResizeObserver(): void {
        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });
            this.resizeObserver.observe(this.containerRef().nativeElement);
        }
    }

    private initializeZoomPan(): void {
        // Swipe callbacks for continuous scroll behavior
        const swipeCallbacks: SwipeCallbacks = {
            onSwipeStart: () => this.onSwipeStart(),
            onSwipeMove: (dx) => this.onSwipeMove(dx),
            onSwipeEnd: (dx, velocity) => this.onSwipeEnd(dx, velocity)
        };

        // Non-interactive selectors that shouldn't trigger zoom reset on double-tap
        const nonInteractiveSelectors = {
            selectors: [
                '.interactive',
                '.pip',
                '.critSlot',
                '.critLoc',
                '.armor',
                '.structure',
                '.inventoryEntry',
                '.preventZoomReset'
            ]
        };

        this.zoomPanService.initialize(
            this.containerRef(),
            this.contentRef(),
            swipeCallbacks,
            nonInteractiveSelectors,
            this.spaceEvenly()
        );
    }

    // ========== Continuous Swipe Navigation ==========

    private async onSwipeStart(): Promise<void> {
        if (!this.swipeAllowed()) return;
        
        // Store the current display state as the base for swipe calculations
        // Use viewStartIndex (the leftmost displayed unit) as the base
        this.isSwiping = true;
        this.baseDisplayStartIndex = this.viewStartIndex();
        // Clear swipe indices to force a re-render on first move
        this.swipeDisplayedIndices = [];
        
        // Pre-load immediate neighbors BEFORE rendering so they're available
        await this.preloadImmediateNeighbors();
        
        // Immediately render current pages with swipe positioning
        this.updateSwipeVisiblePages(0);
    }

    private onSwipeMove(totalDx: number): void {
        if (!this.swipeAllowed()) return;
        
        // Apply swipe transform to the wrapper
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translateX(${totalDx}px)`;
        
        // Calculate which additional pages should be visible based on swipe offset
        this.updateSwipeVisiblePages(totalDx);
    }

    private onSwipeEnd(totalDx: number, velocity: number): void {
        if (!this.swipeAllowed()) {
            this.resetSwipeTransform();
            return;
        }

        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const scaledPageWidth = PAGE_WIDTH * scale + PAGE_GAP * scale;
        const threshold = scaledPageWidth * SWIPE_COMMIT_THRESHOLD;

        // Determine if swipe should commit based on velocity (flick)
        const flickPrev = velocity > SWIPE_VELOCITY_THRESHOLD;
        const flickNext = velocity < -SWIPE_VELOCITY_THRESHOLD;
        
        // Calculate how many pages we've swiped past
        // For a flick, only move 1 page; for a drag, move based on distance
        let pagesToMove = 0;
        
        if (flickPrev) {
            // Quick flick to go to previous - only move 1
            pagesToMove = -1;
        } else if (flickNext) {
            // Quick flick to go to next - only move 1
            pagesToMove = 1;
        } else if (Math.abs(totalDx) > threshold) {
            // Slow drag - calculate based on distance
            // Use 50% of page width as the point where we commit to the next page
            const halfPageWidth = scaledPageWidth * 0.5;
            if (totalDx > 0) {
                // Swiping right (going to previous pages)
                pagesToMove = -Math.round(totalDx / scaledPageWidth);
            } else {
                // Swiping left (going to next pages)
                pagesToMove = -Math.round(totalDx / scaledPageWidth);
            }
        }
        
        // Clamp pagesToMove to avoid going past available units
        const force = this.forceBuilder.currentForce();
        const totalUnits = force?.units().length ?? 0;
        if (totalUnits > 0) {
            // Allow wraparound, so no clamping needed, but limit to reasonable range
            pagesToMove = Math.max(-totalUnits + 1, Math.min(totalUnits - 1, pagesToMove));
        }

        if (pagesToMove !== 0) {
            // Calculate the final position to animate to
            const targetOffset = -pagesToMove * scaledPageWidth;
            
            // Animate to the target position
            swipeWrapper.style.transition = 'transform 0.25s ease-out';
            swipeWrapper.style.transform = `translateX(${targetOffset}px)`;

            setTimeout(() => {
                this.resetSwipeTransform(true); // Clear displayed units so effect triggers full redisplay
                this.navigateByPages(pagesToMove);
            }, 250);
        } else {
            // Snap back - restore original state
            swipeWrapper.style.transition = 'transform 0.2s ease-out';
            swipeWrapper.style.transform = '';

            setTimeout(() => {
                this.resetSwipeTransform(false); // Don't clear displayed units - restoreBaseDisplay will handle it
                this.restoreBaseDisplay();
            }, 200);
        }
    }

    private resetSwipeTransform(clearDisplayedUnits: boolean = false): void {
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = '';
        swipeWrapper.style.transform = '';
        this.isSwiping = false;
        
        // When navigating to a new unit, clear displayedUnits so the effect
        // triggers a full redisplay rather than just updating highlights
        if (clearDisplayedUnits) {
            this.displayedUnits = [];
            this.swipeDisplayedIndices = [];
        }
    }

    /**
     * Pre-load immediate neighbors that will be visible at swipe start.
     * Uses baseDisplayStartIndex directly since swipeDisplayedIndices isn't populated yet.
     */
    private async preloadImmediateNeighbors(): Promise<void> {
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        if (totalUnits <= 1) return;

        const visiblePages = this.visiblePageCount();
        const indicesToLoad: number[] = [];
        
        // Load 1 unit before and 1 unit after the visible range
        const firstIdx = this.baseDisplayStartIndex;
        const lastIdx = (this.baseDisplayStartIndex + visiblePages - 1) % totalUnits;
        
        const prevIdx = (firstIdx - 1 + totalUnits) % totalUnits;
        const nextIdx = (lastIdx + 1) % totalUnits;
        
        indicesToLoad.push(prevIdx);
        if (nextIdx !== prevIdx) {
            indicesToLoad.push(nextIdx);
        }

        // Load the neighbor units
        await Promise.all(indicesToLoad.map(idx => (allUnits[idx] as CBTForceUnit).load()));
    }

    /**
     * Pre-load additional neighbor units during swipe for smoother transitions.
     * Called during swipe to preload units that might come into view with further swiping.
     */
    private async preloadSwipeNeighbors(): Promise<void> {
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        if (totalUnits === 0) return;

        // Load a few units on each side
        const indicesToLoad: number[] = [];
        const currentIndices = this.swipeDisplayedIndices;
        
        if (currentIndices.length > 0) {
            const firstIdx = currentIndices[0];
            const lastIdx = currentIndices[currentIndices.length - 1];
            
            // Add 2 units before and after
            for (let i = 1; i <= 2; i++) {
                const prevIdx = (firstIdx - i + totalUnits) % totalUnits;
                const nextIdx = (lastIdx + i) % totalUnits;
                if (!currentIndices.includes(prevIdx)) indicesToLoad.push(prevIdx);
                if (!currentIndices.includes(nextIdx)) indicesToLoad.push(nextIdx);
            }
        }

        // Load all neighbor units
        await Promise.all(indicesToLoad.map(idx => (allUnits[idx] as CBTForceUnit).load()));
    }

    /**
     * Update which pages are visible during swipe based on the swipe offset.
     * Adds/removes pages dynamically as they come into view.
     */
    private updateSwipeVisiblePages(totalDx: number): void {
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        if (totalUnits <= 1) return;

        const scale = this.zoomPanService.scale();
        const scaledPageWidth = PAGE_WIDTH * scale;
        const scaledGap = PAGE_GAP * scale;
        const containerWidth = this.containerRef().nativeElement.clientWidth;

        // Calculate the visible range in "page space" 
        // totalDx > 0 means swiping right (revealing left pages)
        // totalDx < 0 means swiping left (revealing right pages)
        
        const basePositions = this.zoomPanService.getPagePositions(this.visiblePageCount());
        const firstBasePosition = (basePositions[0] ?? 0) * scale;
        
        // Calculate how many extra pages we need on each side
        let pagesNeededLeft = 1;
        let pagesNeededRight = 1;
        
        if (totalDx > 0) {
            // Swiping right - need pages on the left
            pagesNeededLeft = Math.max(1, Math.ceil((totalDx) / (scaledPageWidth + scaledGap)));
        } else if (totalDx < 0) {
            // Swiping left - need pages on the right
            pagesNeededRight = Math.max(1, Math.ceil((-totalDx) / (scaledPageWidth + scaledGap)));
        }

        // Build the list of indices that should be visible
        const visiblePages = this.visiblePageCount();
        const newIndices: number[] = [];
        
        // Add pages to the left
        for (let i = pagesNeededLeft; i >= 1; i--) {
            const idx = (this.baseDisplayStartIndex - i + totalUnits) % totalUnits;
            if (!newIndices.includes(idx)) newIndices.push(idx);
        }
        
        // Add base visible pages
        for (let i = 0; i < visiblePages; i++) {
            const idx = (this.baseDisplayStartIndex + i) % totalUnits;
            if (!newIndices.includes(idx)) newIndices.push(idx);
        }
        
        // Add pages to the right
        for (let i = 1; i <= pagesNeededRight; i++) {
            const idx = (this.baseDisplayStartIndex + visiblePages - 1 + i) % totalUnits;
            if (!newIndices.includes(idx)) newIndices.push(idx);
        }

        // Check if we need to update the display
        const currentIndicesSet = new Set(this.swipeDisplayedIndices);
        const newIndicesSet = new Set(newIndices);
        
        const needsUpdate = newIndices.length !== this.swipeDisplayedIndices.length ||
            newIndices.some(idx => !currentIndicesSet.has(idx));

        if (needsUpdate) {
            this.swipeDisplayedIndices = newIndices;
            this.updateDisplayedUnitsForSwipe(newIndices, totalDx);
            
            // Pre-load additional neighbors for smoother transitions
            this.preloadSwipeNeighbors();
        }
    }

    /**
     * Update the displayed units and re-render pages for swipe state
     */
    private updateDisplayedUnitsForSwipe(indices: number[], totalDx: number): void {
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        
        // Map indices to units
        const newUnits = indices.map(idx => allUnits[idx] as CBTForceUnit).filter(u => u);
        
        // Update displayed units
        this.displayedUnits = newUnits;
        
        // Re-render pages with new positions
        this.renderPagesForSwipe(indices, totalDx);
    }

    /**
     * Render pages during swipe with adjusted positions
     */
    private renderPagesForSwipe(indices: number[], totalDx: number): void {
        const content = this.contentRef().nativeElement;
        const scale = this.zoomPanService.scale();
        
        // Clean up existing pages and services (but keep canvas overlays for reuse)
        this.cleanupInteractionServices();
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.pageElements = [];

        // Calculate positions relative to the base display
        // The base pages should be at their normal positions
        const basePositions = this.zoomPanService.getPagePositions(this.visiblePageCount());
        
        // Find where the base start index is in our new indices array
        const baseIndexPosition = indices.indexOf(this.baseDisplayStartIndex);
        
        // Track which units are being displayed for canvas cleanup
        const displayedUnitIds = new Set<string>();
        
        this.displayedUnits.forEach((unit, arrayIndex) => {
            const svg = unit.svg();
            if (!svg) return;

            displayedUnitIds.add(unit.id);

            const pageWrapper = this.renderer.createElement('div') as HTMLDivElement;
            this.renderer.addClass(pageWrapper, 'page-wrapper');
            
            // Store unit ID for click handling and selection
            pageWrapper.dataset['unitId'] = unit.id;
            
            // Add selected class if this is the current unit and multiple pages will be visible at rest
            // Use visiblePageCount() instead of displayedUnits.length since during swipe we show extra pages
            const isSelected = unit.id === this.unit()?.id;
            const multipleVisible = this.visiblePageCount() > 1;
            if (isSelected && multipleVisible) {
                this.renderer.addClass(pageWrapper, 'selected');
            }

            // Calculate position relative to where base pages would be
            const offsetFromBase = arrayIndex - baseIndexPosition;
            let unscaledLeft: number;
            
            if (offsetFromBase >= 0 && offsetFromBase < basePositions.length) {
                // This is one of the base visible pages
                unscaledLeft = basePositions[offsetFromBase];
            } else if (offsetFromBase < 0) {
                // This page is to the left of the base
                unscaledLeft = basePositions[0] - ((-offsetFromBase) * (PAGE_WIDTH + PAGE_GAP));
            } else {
                // This page is to the right of the base
                const lastBasePos = basePositions[basePositions.length - 1] ?? basePositions[0];
                unscaledLeft = lastBasePos + ((offsetFromBase - basePositions.length + 1) * (PAGE_WIDTH + PAGE_GAP));
            }

            // Store original position and apply scaled position
            pageWrapper.dataset['originalLeft'] = String(unscaledLeft);
            pageWrapper.style.width = `${PAGE_WIDTH * scale}px`;
            pageWrapper.style.height = `${PAGE_HEIGHT * scale}px`;
            pageWrapper.style.position = 'absolute';
            pageWrapper.style.left = `${unscaledLeft * scale}px`;
            pageWrapper.style.top = '0';

            // Apply scale to SVG
            svg.style.transform = `scale(${scale})`;
            svg.style.transformOrigin = 'top left';
            pageWrapper.appendChild(svg);

            // Create interaction service for this page
            if (!this.readOnly()) {
                const interactionService = this.createInteractionService(arrayIndex);
                interactionService.updateUnit(unit);
                interactionService.setupInteractions(svg);
                this.interactionServices.set(arrayIndex, interactionService);

                // Get or create canvas overlay (reuses existing if available)
                this.getOrCreateCanvasOverlay(pageWrapper, unit);

                // Get or create interaction overlay (reuses existing if available)
                this.getOrCreateInteractionOverlay(pageWrapper, unit);
            }

            content.appendChild(pageWrapper);
            this.pageElements.push(pageWrapper);
        });

        // Clean up canvas overlays for units no longer displayed
        this.cleanupUnusedCanvasOverlays(displayedUnitIds);

        // Clean up interaction overlays for units no longer displayed
        this.cleanupUnusedInteractionOverlays(displayedUnitIds);
    }

    /**
     * Restore the display to the base state (before swipe started)
     */
    private restoreBaseDisplay(): void {
        // Re-display the original pages
        this.displayUnit();
    }

    /**
     * Creates an interaction service for a specific page.
     * Uses runInInjectionContext to properly create the service with DI.
     */
    private createInteractionService(pageIndex: number): SvgInteractionService {
        // Create the service within an injection context so inject() calls work
        const service = runInInjectionContext(this.injector, () => new SvgInteractionService());

        service.initialize(
            this.containerRef(),
            this.injector,
            this.zoomPanService
        );

        // Monitor heat marker state for this service
        effect(() => {
            const markerData = service.getHeatDiffMarkerData();
            const visible = service.getState().diffHeatMarkerVisible();

            // Update the markers map using untracked to avoid reading the signal
            untracked(() => {
                this.heatDiffMarkers.update(markers => {
                    const newMarkers = new Map(markers);
                    newMarkers.set(pageIndex, { data: markerData, visible });
                    return newMarkers;
                });
            });
        }, { injector: this.injector });

        return service;
    }

    /**
     * Gets or creates a canvas overlay component for the given unit.
     * Reuses existing canvas if one already exists for the unit to prevent flickering.
     */
    private getOrCreateCanvasOverlay(pageWrapper: HTMLDivElement, unit: CBTForceUnit): ComponentRef<PageCanvasOverlayComponent> {
        const unitId = unit.id;
        
        // Check if we already have a canvas for this unit
        const existingRef = this.canvasOverlayRefs.get(unitId);
        if (existingRef) {
            // Reuse existing canvas - just move it to the new page wrapper
            const canvasElement = existingRef.location.nativeElement as HTMLElement;
            pageWrapper.appendChild(canvasElement);
            return existingRef;
        }
        
        // Create new canvas overlay
        const componentRef = createComponent(PageCanvasOverlayComponent, {
            environmentInjector: this.appRef.injector,
            elementInjector: this.injector
        });

        // Set inputs
        componentRef.setInput('unit', unit);
        componentRef.setInput('width', PAGE_WIDTH);
        componentRef.setInput('height', PAGE_HEIGHT);

        // Subscribe to drawingStarted output to select unit when drawing on its canvas
        componentRef.instance.drawingStarted.subscribe((drawnUnit) => {
            this.forceBuilder.selectUnit(drawnUnit as CBTForceUnit);
        });

        // Attach to Angular's change detection
        this.appRef.attachView(componentRef.hostView);

        // Add the component's DOM element to the page wrapper
        const canvasElement = componentRef.location.nativeElement as HTMLElement;
        canvasElement.style.position = 'absolute';
        canvasElement.style.top = '0';
        canvasElement.style.left = '0';
        canvasElement.style.width = '100%';
        canvasElement.style.height = '100%';
        pageWrapper.appendChild(canvasElement);

        // Store in map
        this.canvasOverlayRefs.set(unitId, componentRef);

        return componentRef;
    }

    /**
     * Cleans up canvas overlays that are no longer displayed.
     * Keeps canvas overlays for currently displayed units to prevent flickering.
     */
    private cleanupUnusedCanvasOverlays(keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];
        
        this.canvasOverlayRefs.forEach((ref, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                this.appRef.detachView(ref.hostView);
                ref.destroy();
                toRemove.push(unitId);
            }
        });
        
        toRemove.forEach(id => this.canvasOverlayRefs.delete(id));
    }

    /**
     * Cleans up all canvas overlay component refs.
     */
    private cleanupCanvasOverlays(): void {
        this.canvasOverlayRefs.forEach(ref => {
            this.appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.canvasOverlayRefs.clear();
    }

    /**
     * Gets or creates an interaction overlay component for the given unit.
     * Reuses existing overlay if one already exists for the unit to prevent flickering.
     */
    private getOrCreateInteractionOverlay(pageWrapper: HTMLDivElement, unit: CBTForceUnit): ComponentRef<PageInteractionOverlayComponent> {
        const unitId = unit.id;
        
        // Check if we already have an overlay for this unit
        const existingRef = this.interactionOverlayRefs.get(unitId);
        if (existingRef) {
            // Reuse existing overlay - just move it to the new page wrapper
            const overlayElement = existingRef.location.nativeElement as HTMLElement;
            pageWrapper.appendChild(overlayElement);
            return existingRef;
        }
        
        // Create new interaction overlay
        const componentRef = createComponent(PageInteractionOverlayComponent, {
            environmentInjector: this.appRef.injector,
            elementInjector: this.injector
        });

        // Set inputs
        componentRef.setInput('unit', unit);
        componentRef.setInput('force', this.forceBuilder.currentForce());

        // Attach to Angular's change detection
        this.appRef.attachView(componentRef.hostView);

        // Add the component's DOM element to the page wrapper
        const overlayElement = componentRef.location.nativeElement as HTMLElement;
        overlayElement.style.position = 'absolute';
        overlayElement.style.top = '0';
        overlayElement.style.left = '0';
        overlayElement.style.width = '100%';
        overlayElement.style.height = '100%';
        pageWrapper.appendChild(overlayElement);

        // Store in map
        this.interactionOverlayRefs.set(unitId, componentRef);

        return componentRef;
    }

    /**
     * Cleans up interaction overlays that are no longer displayed.
     * Keeps interaction overlays for currently displayed units to prevent flickering.
     */
    private cleanupUnusedInteractionOverlays(keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];
        
        this.interactionOverlayRefs.forEach((ref, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                this.appRef.detachView(ref.hostView);
                ref.destroy();
                toRemove.push(unitId);
            }
        });
        
        toRemove.forEach(id => this.interactionOverlayRefs.delete(id));
    }

    /**
     * Cleans up all interaction overlay component refs.
     */
    private cleanupInteractionOverlays(): void {
        this.interactionOverlayRefs.forEach(ref => {
            this.appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.interactionOverlayRefs.clear();
    }

    /**
     * Cleans up all interaction services.
     */
    private cleanupInteractionServices(): void {
        this.interactionServices.forEach(service => service.cleanup());
        this.interactionServices.clear();
        this.heatDiffMarkers.set(new Map());
    }

    private initializePickerMonitoring(): void {
        if (this.readOnly()) return;

        // Monitor picker open state from primary service
        effect(() => {
            const primaryService = this.interactionServices.get(0);
            const pickerOpen = primaryService?.isAnyPickerOpen() ?? false;
            this.isPickerOpen.set(pickerOpen);
        }, { injector: this.injector });
    }

    private updateDimensions(): void {
        const container = this.containerRef().nativeElement;
        const pageCount = this.getTotalPageCount();

        this.zoomPanService.updateDimensions(
            container.clientWidth,
            container.clientHeight,
            pageCount
        );
    }

    private handleResize(): void {
        const previousVisibleCount = this.visiblePageCount();
        this.updateDimensions();
        this.zoomPanService.handleResize();

        // If visible page count changed, re-render pages
        const newVisibleCount = this.visiblePageCount();
        if (newVisibleCount !== previousVisibleCount && this.unit()) {
            this.displayUnit();
        }
    }

    // ========== Unit Display ==========

    private displayUnit(options: { fromSwipe?: boolean } = {}): void {
        const currentUnit = this.unit();
        const content = this.contentRef().nativeElement;
        const fromSwipe = options.fromSwipe ?? false;

        // Clear existing page DOM elements
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.pageElements = [];
        this.displayedUnits = [];

        this.loadError.set(null);
        this.currentSvg.set(null);

        if (!currentUnit) return;

        const svg = currentUnit.svg();
        if (!svg) {
            this.loadError.set('Loading record sheet...');
            return;
        }

        // Determine how many pages to display
        const visiblePages = this.visiblePageCount();
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        
        // Use viewStartIndex for display positioning (independent of selected unit)
        const startIndex = this.viewStartIndex();

        // Build list of units to display
        // If we have fewer units than visible pages, show all units (no swipe)
        if (totalUnits <= visiblePages) {
            // Show all units, no swipe needed
            for (const unit of allUnits) {
                this.displayedUnits.push(unit as CBTForceUnit);
            }
        } else {
            // Show visible pages starting from viewStartIndex
            for (let i = 0; i < visiblePages; i++) {
                const unitIndex = (startIndex + i) % totalUnits;
                const unitToDisplay = allUnits[unitIndex] as CBTForceUnit;
                if (unitToDisplay && !this.displayedUnits.includes(unitToDisplay)) {
                    this.displayedUnits.push(unitToDisplay);
                }
            }
        }

        // Capture version to detect stale callbacks
        const currentVersion = ++this.displayVersion;

        // Load all displayed units first
        const loadPromises = this.displayedUnits.map(u => u.load());

        Promise.all(loadPromises).then(() => {
            // Check if this call is still valid
            if (this.displayVersion !== currentVersion) {
                return;
            }
            this.renderPages({ fromSwipe });
        });
    }

    private renderPages(options: { fromSwipe?: boolean } = {}): void {
        const content = this.contentRef().nativeElement;
        const fromSwipe = options.fromSwipe ?? false;

        // Clean up existing interaction services before creating new ones
        this.cleanupInteractionServices();

        // Get page positions based on spaceEvenly setting
        const positions = this.zoomPanService.getPagePositions(this.displayedUnits.length);

        // Track which units are being displayed for canvas cleanup
        const displayedUnitIds = new Set<string>();

        // Create page elements for each displayed unit
        this.displayedUnits.forEach((unit, index) => {
            const svg = unit.svg();
            if (svg) {
                displayedUnitIds.add(unit.id);

                const pageWrapper = this.renderer.createElement('div') as HTMLDivElement;
                this.renderer.addClass(pageWrapper, 'page-wrapper');
                
                // Store unit ID for click handling and selection
                pageWrapper.dataset['unitId'] = unit.id;
                
                // Add selected class if this is the current unit and multiple pages visible at rest
                const isSelected = unit.id === this.unit()?.id;
                const multipleVisible = this.visiblePageCount() > 1;
                if (isSelected && multipleVisible) {
                    this.renderer.addClass(pageWrapper, 'selected');
                }

                // Set page dimensions
                pageWrapper.style.width = `${PAGE_WIDTH}px`;
                pageWrapper.style.height = `${PAGE_HEIGHT}px`;
                pageWrapper.style.position = 'absolute';
                pageWrapper.style.left = `${positions[index] ?? (index * (PAGE_WIDTH + PAGE_GAP))}px`;
                pageWrapper.style.top = '0';

                // Use original SVG for all pages (allows interaction on all)
                pageWrapper.appendChild(svg);

                // Set the first page as the "current" SVG
                if (index === 0) {
                    this.currentSvg.set(svg);
                }

                // Create a dedicated interaction service for this page
                if (!this.readOnly()) {
                    const interactionService = this.createInteractionService(index);
                    interactionService.updateUnit(unit);
                    interactionService.setupInteractions(svg);
                    this.interactionServices.set(index, interactionService);

                    // Get or create canvas overlay (reuses existing if available)
                    this.getOrCreateCanvasOverlay(pageWrapper, unit);

                    // Get or create interaction overlay (reuses existing if available)
                    this.getOrCreateInteractionOverlay(pageWrapper, unit);
                }

                content.appendChild(pageWrapper);
                this.pageElements.push(pageWrapper);
            }
        });

        // Clean up canvas overlays for units no longer displayed
        this.cleanupUnusedCanvasOverlays(displayedUnitIds);

        // Clean up interaction overlays for units no longer displayed
        this.cleanupUnusedInteractionOverlays(displayedUnitIds);

        // Tell the service how many pages we're actually displaying
        this.zoomPanService.setDisplayedPages(this.pageElements.length);

        // Update dimensions and restore view state
        this.updateDimensions();
        this.restoreViewState({ fromSwipe });
    }

    private clearPages(): void {
        const content = this.contentRef().nativeElement;
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.pageElements = [];
        this.displayedUnits = [];
    }

    private getTotalPageCount(): number {
        const currentForce = this.forceBuilder.currentForce();
        if (!currentForce) return 1;
        return Math.max(1, currentForce.units().length);
    }

    // ========== View State Management ==========

    private saveViewState(unit: CBTForceUnit): void {
        const viewState = this.zoomPanService.viewState();
        this.lastViewState = {
            scale: viewState.scale,
            translateX: viewState.translateX,
            translateY: viewState.translateY
        };
        unit.viewState = { ...this.lastViewState };
    }

    private restoreViewState(options: { fromSwipe?: boolean } = {}): void {
        const syncZoom = this.optionsService.options().syncZoomBetweenSheets;
        const isMultiPageMode = this.visiblePageCount() > 1;
        const isSwipe = options.fromSwipe ?? false;

        // Conditions for restoring unit-specific view state:
        // 1. syncZoomBetweenSheets must be false
        // 2. Must be in single-page mode (multi-page always syncs zoom)
        // 3. Must NOT be a swipe navigation (swipe always syncs zoom)
        const shouldRestoreUnitViewState = !syncZoom && !isMultiPageMode && !isSwipe;

        if (shouldRestoreUnitViewState) {
            // Restore the unit's saved view state
            const viewState = this.unit()?.viewState ?? null;
            this.zoomPanService.restoreViewState(viewState);
            return;
        }

        // In all other cases, use synced zoom (last view state or reset)
        if (this.lastViewState) {
            this.zoomPanService.restoreViewState(this.lastViewState);
        } else {
            this.zoomPanService.restoreViewState(null);
        }
    }

    /**
     * Updates the visual highlight on page wrappers to show which unit is selected.
     * Called when the selected unit changes but is already displayed.
     */
    private updateSelectedPageHighlight(): void {
        const currentUnitId = this.unit()?.id;
        const multipleVisible = this.visiblePageCount() > 1;
        
        this.pageElements.forEach((wrapper) => {
            const unitId = wrapper.dataset['unitId'];
            const isSelected = unitId === currentUnitId;
            
            // Update selected class
            if (isSelected && multipleVisible) {
                this.renderer.addClass(wrapper, 'selected');
            } else {
                this.renderer.removeClass(wrapper, 'selected');
            }
        });
    }

    /**
     * Setup a capture-phase click listener to detect page clicks.
     * Using capture phase ensures we see the click before any stopPropagation.
     */
    private setupPageClickCapture(): void {
        if (this.readOnly()) return;
        
        const container = this.containerRef().nativeElement;
        
        const handlePageSelection = (event: Event) => {
            // Don't handle if we're in the middle of a gesture
            if (this.zoomPanService.pointerMoved || this.zoomPanService.isPanning || this.isSwiping) {
                return;
            }
            
            // Only handle if multiple pages are visible
            if (this.displayedUnits.length <= 1) {
                return;
            }
            
            // Find which page wrapper was clicked
            const target = event.target as HTMLElement;
            const pageWrapper = target.closest('.page-wrapper') as HTMLElement;
            if (!pageWrapper) return;
            
            const clickedUnitId = pageWrapper.dataset['unitId'];
            if (!clickedUnitId) return;
            
            // Find the unit and select it if different from current
            const currentUnitId = this.unit()?.id;
            if (clickedUnitId !== currentUnitId) {
                const clickedUnit = this.displayedUnits.find(u => u.id === clickedUnitId);
                if (clickedUnit) {
                    this.forceBuilder.selectUnit(clickedUnit);
                }
            }
        };

        // Use capture phase to intercept clicks before stopPropagation
        container.addEventListener('click', handlePageSelection, { capture: true });
        
        // Also listen for custom event from svg-interaction service
        // This is needed because interactive elements prevent the native click event
        container.addEventListener('svg-interaction-click', handlePageSelection);
    }

    /**
     * Navigate by a specified number of pages (positive = forward, negative = backward).
     * Updates viewStartIndex without changing the selected unit.
     * Handles wraparound.
     */
    private navigateByPages(count: number): void {
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        if (totalUnits === 0) return;

        // Calculate new view start index with wraparound
        const currentStartIndex = this.viewStartIndex();
        const newStartIndex = ((currentStartIndex + count) % totalUnits + totalUnits) % totalUnits;
        
        // Update viewStartIndex and redisplay
        // Pass fromSwipe flag to preserve zoom during view restore
        this.viewStartIndex.set(newStartIndex);
        this.displayUnit({ fromSwipe: true });
        
        // After display, check if currently selected unit is still visible
        // If not, select the leftmost or rightmost unit based on swipe direction
        const selectedUnit = this.unit();
        const isSelectedVisible = selectedUnit && this.displayedUnits.some(u => u.id === selectedUnit.id);
        
        if (!isSelectedVisible && this.displayedUnits.length > 0) {
            // count > 0 means swiping left (going forward) -> select leftmost
            // count < 0 means swiping right (going backward) -> select rightmost
            const unitToSelect = count > 0 
                ? this.displayedUnits[0] 
                : this.displayedUnits[this.displayedUnits.length - 1];
            
            if (unitToSelect) {
                this.forceBuilder.selectUnit(unitToSelect);
            }
        }
    }

    // ========== Public Methods ==========

    retryLoad(): void {
        const currentUnit = this.unit();
        if (currentUnit) {
            currentUnit.load().then(() => {
                this.displayUnit();
            });
        }
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

    // ========== Cleanup ==========

    private cleanup(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        this.cleanupInteractionServices();
        this.cleanupCanvasOverlays();
        this.cleanupInteractionOverlays();
        this.clearPages();
    }
}
