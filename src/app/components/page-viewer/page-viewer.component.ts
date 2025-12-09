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
    runInInjectionContext
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
    imports: [HeatDiffMarkerComponent, PageCanvasOverlayComponent, PageViewerCanvasControlsComponent],
    templateUrl: './page-viewer.component.html',
    styleUrls: ['./page-viewer.component.css']
})
export class PageViewerComponent implements AfterViewInit {
    private injector = inject(Injector);
    private renderer = inject(Renderer2);
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

    // Outputs
    unitSelected = output<CBTForceUnit>();

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

    // Swipe is allowed only when total pages > visible pages
    swipeAllowed = computed(() => {
        if (this.optionsService.options().swipeToNextSheet === 'disabled') {
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

    // Current displayed units for multi-page view (exposed as signal for canvas overlays)
    displayedUnitsSignal = signal<CBTForceUnit[]>([]);
    private displayedUnits: CBTForceUnit[] = [];
    private pageElements: HTMLDivElement[] = [];

    // Current page index (first visible page in the view)
    private currentPageIndex = signal(0);

    // Interaction services - one per visible page
    private interactionServices = new Map<number, SvgInteractionService>();

    // Pre-cached neighbor units (for smooth transitions)
    private cachedPrevUnit: CBTForceUnit | null = null;
    private cachedNextUnit: CBTForceUnit | null = null;

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

            // Display the new unit
            untracked(() => this.displayUnit());

            previousUnit = currentUnit;
        }, { injector: this.injector });

        inject(DestroyRef).onDestroy(() => this.cleanup());
    }

    ngAfterViewInit(): void {
        this.viewInitialized = true;
        this.setupResizeObserver();
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

    private onSwipeStart(): void {
        if (!this.swipeAllowed()) return;
        
        // Render neighbor pages off-screen so they're visible during swipe
        this.renderNeighborPages();
    }

    private onSwipeMove(totalDx: number): void {
        if (!this.swipeAllowed()) return;
        
        // Apply swipe transform to the wrapper (NOT content - that has zoom)
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translateX(${totalDx}px)`;
    }

    private onSwipeEnd(totalDx: number, velocity: number): void {
        if (!this.swipeAllowed()) {
            this.resetSwipeTransform();
            return;
        }

        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const scaledPageWidth = PAGE_WIDTH * this.zoomPanService.scale() + PAGE_GAP * this.zoomPanService.scale();
        const threshold = scaledPageWidth * SWIPE_COMMIT_THRESHOLD;

        // Determine if swipe should commit
        const flickPrev = velocity > SWIPE_VELOCITY_THRESHOLD;
        const flickNext = velocity < -SWIPE_VELOCITY_THRESHOLD;
        const commitPrev = totalDx > threshold || flickPrev;
        const commitNext = totalDx < -threshold || flickNext;

        if (commitPrev) {
            // Animate to show previous page sliding in
            swipeWrapper.style.transition = 'transform 0.25s ease-out';
            swipeWrapper.style.transform = `translateX(${scaledPageWidth}px)`;

            setTimeout(() => {
                this.resetSwipeTransform();
                this.removeNeighborPages();
                this.navigateToPrevious();
            }, 250);
        } else if (commitNext) {
            // Animate to show next page sliding in
            swipeWrapper.style.transition = 'transform 0.25s ease-out';
            swipeWrapper.style.transform = `translateX(${-scaledPageWidth}px)`;

            setTimeout(() => {
                this.resetSwipeTransform();
                this.removeNeighborPages();
                this.navigateToNext();
            }, 250);
        } else {
            // Snap back
            swipeWrapper.style.transition = 'transform 0.2s ease-out';
            swipeWrapper.style.transform = '';

            setTimeout(() => {
                this.resetSwipeTransform();
                this.removeNeighborPages();
            }, 200);
        }
    }

    private resetSwipeTransform(): void {
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = '';
        swipeWrapper.style.transform = '';
    }

    // Neighbor page elements rendered during swipe (positioned off-screen)
    private neighborPageElements: HTMLDivElement[] = [];

    /**
     * Render neighbor pages off-screen so they're visible during swipe.
     * Previous page is positioned to the left, next page to the right.
     */
    private renderNeighborPages(): void {
        // Remove any existing neighbor pages first
        this.removeNeighborPages();

        const content = this.contentRef().nativeElement;

        // Get the actual positions used by current pages
        const positions = this.zoomPanService.getPagePositions(this.displayedUnits.length);
        const firstPageLeft = positions[0] ?? 0;
        const lastPageLeft = positions[positions.length - 1] ?? 0;

        // Render previous page to the left of the first visible page
        if (this.cachedPrevUnit) {
            const prevSvg = this.cachedPrevUnit.svg();
            if (prevSvg) {
                const prevWrapper = this.renderer.createElement('div') as HTMLDivElement;
                this.renderer.addClass(prevWrapper, 'page-wrapper');
                this.renderer.addClass(prevWrapper, 'neighbor-page');

                prevWrapper.style.width = `${PAGE_WIDTH}px`;
                prevWrapper.style.height = `${PAGE_HEIGHT}px`;
                prevWrapper.style.position = 'absolute';
                prevWrapper.style.top = '0';
                // Position to the left of the first page (firstPageLeft - gap - pageWidth)
                prevWrapper.style.left = `${firstPageLeft - PAGE_GAP - PAGE_WIDTH}px`;

                // Clone the SVG so we don't steal it from the original unit
                const clonedSvg = prevSvg.cloneNode(true) as SVGSVGElement;
                prevWrapper.appendChild(clonedSvg);

                content.appendChild(prevWrapper);
                this.neighborPageElements.push(prevWrapper);
            }
        }

        // Render next page to the right of the last visible page
        if (this.cachedNextUnit) {
            const nextSvg = this.cachedNextUnit.svg();
            if (nextSvg) {
                const nextWrapper = this.renderer.createElement('div') as HTMLDivElement;
                this.renderer.addClass(nextWrapper, 'page-wrapper');
                this.renderer.addClass(nextWrapper, 'neighbor-page');

                nextWrapper.style.width = `${PAGE_WIDTH}px`;
                nextWrapper.style.height = `${PAGE_HEIGHT}px`;
                nextWrapper.style.position = 'absolute';
                nextWrapper.style.top = '0';
                // Position to the right of the last page (lastPageLeft + pageWidth + gap)
                nextWrapper.style.left = `${lastPageLeft + PAGE_WIDTH + PAGE_GAP}px`;

                // Clone the SVG so we don't steal it from the original unit
                const clonedSvg = nextSvg.cloneNode(true) as SVGSVGElement;
                nextWrapper.appendChild(clonedSvg);

                content.appendChild(nextWrapper);
                this.neighborPageElements.push(nextWrapper);
            }
        }
    }

    /**
     * Remove neighbor pages after swipe completes.
     */
    private removeNeighborPages(): void {
        const content = this.contentRef().nativeElement;
        this.neighborPageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.neighborPageElements = [];
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

    private displayUnit(): void {
        const currentUnit = this.unit();
        const content = this.contentRef().nativeElement;

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
        const currentIndex = allUnits.indexOf(currentUnit);

        // Update current page index
        this.currentPageIndex.set(currentIndex);

        // Build list of units to display
        // If we have fewer units than visible pages, show all units (no swipe)
        if (totalUnits <= visiblePages) {
            // Show all units, no swipe needed
            for (const unit of allUnits) {
                this.displayedUnits.push(unit as CBTForceUnit);
            }
        } else {
            // Show visible pages starting from current unit
            this.displayedUnits.push(currentUnit);

            // Add additional units if space allows (with wraparound)
            for (let i = 1; i < visiblePages; i++) {
                const nextIndex = (currentIndex + i) % totalUnits;
                const additionalUnit = allUnits[nextIndex] as CBTForceUnit;
                if (additionalUnit && !this.displayedUnits.includes(additionalUnit)) {
                    this.displayedUnits.push(additionalUnit);
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
            this.renderPages();
            // Pre-cache neighbors after rendering
            this.precacheNeighbors();
        });
    }

    private renderPages(): void {
        const content = this.contentRef().nativeElement;

        // Clean up existing interaction services before creating new ones
        this.cleanupInteractionServices();

        // Get page positions based on spaceEvenly setting
        const positions = this.zoomPanService.getPagePositions(this.displayedUnits.length);

        // Create page elements for each displayed unit
        this.displayedUnits.forEach((unit, index) => {
            const svg = unit.svg();
            if (svg) {
                const pageWrapper = this.renderer.createElement('div') as HTMLDivElement;
                this.renderer.addClass(pageWrapper, 'page-wrapper');

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
                }

                content.appendChild(pageWrapper);
                this.pageElements.push(pageWrapper);
            }
        });

        // Update the displayed units signal for canvas overlays
        this.displayedUnitsSignal.set([...this.displayedUnits]);

        // Tell the service how many pages we're actually displaying
        this.zoomPanService.setDisplayedPages(this.pageElements.length);

        // Update dimensions and restore view state
        this.updateDimensions();
        this.restoreViewState();
    }

    /**
     * Pre-cache the next non-visible units for smooth swipe transitions.
     */
    private async precacheNeighbors(): Promise<void> {
        if (!this.swipeAllowed()) return;

        const currentUnit = this.unit();
        if (!currentUnit) return;

        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        const currentIndex = allUnits.indexOf(currentUnit);

        // Calculate prev and next indices with wraparound
        const prevIndex = (currentIndex - 1 + totalUnits) % totalUnits;
        const nextEndIndex = (currentIndex + this.visiblePageCount()) % totalUnits;

        // Cache prev unit (the one that would slide in from left)
        if (prevIndex !== currentIndex) {
            this.cachedPrevUnit = allUnits[prevIndex] as CBTForceUnit;
            await this.cachedPrevUnit?.load();
        }

        // Cache next unit (the one that would slide in from right)
        if (nextEndIndex !== currentIndex && !this.displayedUnits.includes(allUnits[nextEndIndex] as CBTForceUnit)) {
            this.cachedNextUnit = allUnits[nextEndIndex] as CBTForceUnit;
            await this.cachedNextUnit?.load();
        }
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

    private restoreViewState(): void {
        const syncZoom = this.optionsService.options().syncZoomBetweenSheets;

        if (syncZoom && this.lastViewState) {
            this.zoomPanService.restoreViewState(this.lastViewState);
            return;
        }

        const viewState = this.unit()?.viewState ?? null;
        this.zoomPanService.restoreViewState(viewState);
    }

    private navigateToPrevious(): void {
        const currentUnit = this.unit();
        if (!currentUnit) return;

        // Save view state before navigating
        this.saveViewState(currentUnit);

        // Navigate (with wraparound)
        this.forceBuilder.selectPreviousUnit();

        // The effect will handle displaying the new unit
    }

    private navigateToNext(): void {
        const currentUnit = this.unit();
        if (!currentUnit) return;

        // Save view state before navigating
        this.saveViewState(currentUnit);

        // Navigate (with wraparound)
        this.forceBuilder.selectNextUnit();

        // The effect will handle displaying the new unit
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
     * Get the X position for a page at the given index.
     * Used by canvas overlays to position themselves over the corresponding page.
     */
    getPagePosition(index: number): number {
        const positions = this.zoomPanService.getPagePositions(this.displayedUnits.length);
        return positions[index] ?? (index * (PAGE_WIDTH + PAGE_GAP));
    }

    /**
     * Handle canvas clear request from controls - delete all canvas data
     */
    onCanvasClearRequested(): void {
        // Delete canvas data for all displayed units
        for (const unit of this.displayedUnits) {
            this.dbService.deleteCanvasData(unit.id);
        }
    }

    // ========== Cleanup ==========

    private cleanup(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        this.cleanupInteractionServices();
        this.clearPages();
    }
}
