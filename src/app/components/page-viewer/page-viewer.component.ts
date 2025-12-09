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
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { CBTForce } from '../../models/cbt-force.model';
import { SvgInteractionService } from '../svg-viewer/svg-interaction.service';
import { HeatDiffMarkerComponent, HeatDiffMarkerData } from '../heat-diff-marker/heat-diff-marker.component';

/*
 * Author: Drake
 * 
 * PageViewerComponent - A multi-page SVG viewer with zoom/pan and swipe navigation.
 * 
 * Features:
 * - Auto-fit content on load
 * - Zoom/pan with mouse wheel and touch pinch
 * - Swipe between pages when at minimum zoom
 * - Multi-page side-by-side view when viewport allows
 * - Lazy loading of neighbor pages during swipe
 */

const SWIPE_COMMIT_THRESHOLD = 0.3; // 30% of page width
const SWIPE_VELOCITY_THRESHOLD = 500; // px/s for flick gesture

@Component({
    selector: 'page-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [PageViewerZoomPanService],
    imports: [HeatDiffMarkerComponent],
    templateUrl: './page-viewer.component.html',
    styleUrls: ['./page-viewer.component.css']
})
export class PageViewerComponent implements AfterViewInit {
    private injector = inject(Injector);
    private renderer = inject(Renderer2);
    private zoomPanService = inject(PageViewerZoomPanService);
    private forceBuilder = inject(ForceBuilderService);
    private optionsService = inject(OptionsService);
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
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');
    swipeWrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('swipeWrapper');
    swipeOverlayRef = viewChild.required<ElementRef<HTMLDivElement>>('swipeOverlay');
    prevSlideRef = viewChild.required<ElementRef<HTMLDivElement>>('prevSlide');
    nextSlideRef = viewChild.required<ElementRef<HTMLDivElement>>('nextSlide');

    // State
    loadError = signal<string | null>(null);
    currentSvg = signal<SVGSVGElement | null>(null);
    swipeActive = signal(false);
    isPickerOpen = signal(false);
    
    // Heat diff marker data for each interaction service
    heatDiffMarkers = signal<Map<number, { data: HeatDiffMarkerData | null; visible: boolean }>>(new Map());

    // Computed properties
    swipeAllowed = computed(() => {
        if (this.optionsService.options().swipeToNextSheet === 'disabled') {
            return false;
        }
        const currentForce = this.forceBuilder.currentForce();
        if (!currentForce) return false;
        return currentForce.units().length >= 2;
    });

    isFullyVisible = computed(() => this.zoomPanService.isFullyVisible());
    visiblePageCount = computed(() => this.zoomPanService.visiblePageCount());
    
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

    // Neighbor units for swipe
    private prevUnit: CBTForceUnit | null = null;
    private nextUnit: CBTForceUnit | null = null;

    // Interaction services - one per visible page
    private interactionServices = new Map<number, SvgInteractionService>();

    // Track if we're in the middle of a swipe navigation
    private swipeNavigating = false;
    
    // Track if view is initialized
    private viewInitialized = false;
    
    // Track if we're in the middle of loading/displaying
    private displayInProgress = false;
    private displayVersion = 0;

    constructor() {
        // Watch for unit changes
        let previousUnit: CBTForceUnit | null = null;

        effect(async () => {
            const currentUnit = this.unit();

            // Skip if view isn't ready yet or we're navigating via swipe
            if (!this.viewInitialized || this.swipeNavigating) {
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
        const currentIndex = allUnits.indexOf(currentUnit);

        // Build list of units to display - always include current unit first
        this.displayedUnits.push(currentUnit);
        
        // Add additional units if space allows and they exist
        if (visiblePages > 1 && currentIndex >= 0) {
            for (let i = 1; i < visiblePages && currentIndex + i < allUnits.length; i++) {
                const additionalUnit = allUnits[currentIndex + i] as CBTForceUnit;
                if (additionalUnit) {
                    this.displayedUnits.push(additionalUnit);
                }
            }
        }

        // Capture version to detect stale callbacks
        const currentVersion = ++this.displayVersion;

        // If we have additional units to load, load them first
        if (this.displayedUnits.length > 1) {
            const additionalUnits = this.displayedUnits.slice(1);
            Promise.all(additionalUnits.map(u => u.load())).then(() => {
                // Check if this call is still valid (not superseded by another displayUnit call)
                if (this.displayVersion !== currentVersion) {
                    return;
                }
                this.renderPages();
            });
        } else {
            // Single page, render immediately
            this.renderPages();
        }
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

        // Tell the service how many pages we're actually displaying
        this.zoomPanService.setDisplayedPages(this.pageElements.length);

        // Update dimensions and restore view state
        this.updateDimensions();
        this.restoreViewState();
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

    // ========== Swipe Navigation ==========

    private async onSwipeStart(): Promise<void> {
        if (!this.swipeAllowed()) return;

        this.swipeActive.set(true);

        // Preload neighbors
        await this.preloadNeighbors();

        // Setup swipe slides
        this.setupSwipeSlides();
    }

    private onSwipeMove(totalDx: number): void {
        if (!this.swipeActive()) return;

        const containerWidth = this.containerRef().nativeElement.clientWidth;
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const prevSlide = this.prevSlideRef().nativeElement;
        const nextSlide = this.nextSlideRef().nativeElement;

        // Move the swipe wrapper (which contains the content)
        swipeWrapper.style.transform = `translateX(${totalDx}px)`;

        // Position neighbor slides
        if (this.prevUnit) {
            prevSlide.style.transform = `translateX(${-containerWidth + totalDx}px)`;
        }
        if (this.nextUnit) {
            nextSlide.style.transform = `translateX(${containerWidth + totalDx}px)`;
        }
    }

    private onSwipeEnd(totalDx: number, velocity: number): void {
        if (!this.swipeActive()) return;

        const containerWidth = this.containerRef().nativeElement.clientWidth;
        const threshold = containerWidth * SWIPE_COMMIT_THRESHOLD;

        // Determine if swipe should commit
        const flickPrev = velocity > SWIPE_VELOCITY_THRESHOLD;
        const flickNext = velocity < -SWIPE_VELOCITY_THRESHOLD;
        const commitPrev = (totalDx > threshold || flickPrev) && this.prevUnit;
        const commitNext = (totalDx < -threshold || flickNext) && this.nextUnit;

        if (commitPrev && this.prevUnit) {
            this.commitSwipe('prev');
        } else if (commitNext && this.nextUnit) {
            this.commitSwipe('next');
        } else {
            this.cancelSwipe();
        }
    }

    private commitSwipe(direction: 'prev' | 'next'): void {
        const containerWidth = this.containerRef().nativeElement.clientWidth;
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const targetSlide = direction === 'prev' 
            ? this.prevSlideRef().nativeElement 
            : this.nextSlideRef().nativeElement;

        // Save current view state
        const currentUnit = this.unit();
        if (currentUnit) {
            this.saveViewState(currentUnit);
        }

        // Set flag to prevent effect from triggering during navigation
        this.swipeNavigating = true;

        // Animate transition
        swipeWrapper.style.transition = 'transform 250ms ease-out';
        targetSlide.style.transition = 'transform 250ms ease-out';

        const contentOffset = direction === 'prev' ? containerWidth : -containerWidth;
        swipeWrapper.style.transform = `translateX(${contentOffset}px)`;
        targetSlide.style.transform = 'translateX(0)';

        // Wait for animation, then navigate
        this.awaitTransitionEnd(swipeWrapper, () => {
            // Clean up
            swipeWrapper.style.transition = '';
            swipeWrapper.style.transform = '';
            targetSlide.style.transition = '';
            
            this.swipeActive.set(false);
            this.cleanupSwipeSlides();

            // Navigate to new unit - this will trigger the parent to update the unit input
            if (direction === 'prev') {
                this.forceBuilder.selectPreviousUnit();
            } else {
                this.forceBuilder.selectNextUnit();
            }

            // Allow the effect to run for the newly selected unit
            // Use a longer timeout to ensure Angular change detection has run
            setTimeout(async () => {
                this.swipeNavigating = false;
                // Ensure the new unit is loaded before displaying
                const newUnit = this.unit();
                if (newUnit) {
                    await newUnit.load();
                }
                this.displayUnit();
            }, 50);
        });
    }

    private cancelSwipe(): void {
        const containerWidth = this.containerRef().nativeElement.clientWidth;
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const prevSlide = this.prevSlideRef().nativeElement;
        const nextSlide = this.nextSlideRef().nativeElement;

        // Animate back to original positions
        swipeWrapper.style.transition = 'transform 250ms ease-out';
        prevSlide.style.transition = 'transform 250ms ease-out';
        nextSlide.style.transition = 'transform 250ms ease-out';

        swipeWrapper.style.transform = 'translateX(0)';
        prevSlide.style.transform = `translateX(${-containerWidth}px)`;
        nextSlide.style.transform = `translateX(${containerWidth}px)`;

        // Wait for animation then cleanup
        this.awaitTransitionEnd(swipeWrapper, () => {
            swipeWrapper.style.transition = '';
            prevSlide.style.transition = '';
            nextSlide.style.transition = '';
            
            this.swipeActive.set(false);
            this.cleanupSwipeSlides();
        });
    }

    private async preloadNeighbors(): Promise<void> {
        const current = this.unit();
        if (!current) return;

        this.prevUnit = this.forceBuilder.getPreviousUnit(current) as CBTForceUnit | null;
        this.nextUnit = this.forceBuilder.getNextUnit(current) as CBTForceUnit | null;

        // Load SVGs
        const loadPromises: Promise<void>[] = [];
        if (this.prevUnit) {
            loadPromises.push(this.prevUnit.load());
        }
        if (this.nextUnit) {
            loadPromises.push(this.nextUnit.load());
        }

        await Promise.all(loadPromises);
    }

    private setupSwipeSlides(): void {
        const containerWidth = this.containerRef().nativeElement.clientWidth;
        const containerHeight = this.containerRef().nativeElement.clientHeight;
        const minScale = this.zoomPanService.minScale();
        const prevSlide = this.prevSlideRef().nativeElement;
        const nextSlide = this.nextSlideRef().nativeElement;

        // Clear existing content
        prevSlide.innerHTML = '';
        nextSlide.innerHTML = '';

        // Setup prev slide
        if (this.prevUnit) {
            const svg = this.prevUnit.svg();
            if (svg) {
                const clone = svg.cloneNode(true) as SVGSVGElement;
                this.applyFitTransform(clone, minScale, containerWidth, containerHeight);
                prevSlide.appendChild(clone);
            }
            prevSlide.style.transform = `translateX(${-containerWidth}px)`;
        }

        // Setup next slide
        if (this.nextUnit) {
            const svg = this.nextUnit.svg();
            if (svg) {
                const clone = svg.cloneNode(true) as SVGSVGElement;
                this.applyFitTransform(clone, minScale, containerWidth, containerHeight);
                nextSlide.appendChild(clone);
            }
            nextSlide.style.transform = `translateX(${containerWidth}px)`;
        }
    }

    private applyFitTransform(
        svg: SVGSVGElement, 
        scale: number, 
        containerWidth: number, 
        containerHeight: number
    ): void {
        const scaledWidth = PAGE_WIDTH * scale;
        const scaledHeight = PAGE_HEIGHT * scale;
        const x = Math.max(0, (containerWidth - scaledWidth) / 2);
        const y = Math.max(0, (containerHeight - scaledHeight) / 2);

        svg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        svg.style.transformOrigin = 'top left';
    }

    private cleanupSwipeSlides(): void {
        const prevSlide = this.prevSlideRef().nativeElement;
        const nextSlide = this.nextSlideRef().nativeElement;
        
        prevSlide.innerHTML = '';
        nextSlide.innerHTML = '';
        
        this.prevUnit = null;
        this.nextUnit = null;
    }

    private awaitTransitionEnd(element: HTMLElement, callback: () => void): void {
        const handler = () => {
            element.removeEventListener('transitionend', handler);
            requestAnimationFrame(callback);
        };
        element.addEventListener('transitionend', handler, { once: true });

        // Fallback timeout in case transitionend doesn't fire
        setTimeout(() => {
            element.removeEventListener('transitionend', handler);
            callback();
        }, 300);
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
