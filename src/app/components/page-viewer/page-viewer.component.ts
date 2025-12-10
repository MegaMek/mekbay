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
    EffectRef,
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

    // Inputs
    unit = input<CBTForceUnit | null>(null);
    force = input<CBTForce | null>(null);
    spaceEvenly = input(false);
    readOnly = input(false);

    // View children
    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    swipeWrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('swipeWrapper');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');
    fixedOverlayContainerRef = viewChild.required<ElementRef<HTMLDivElement>>('fixedOverlayContainer');

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

    // Interaction services - keyed by unit ID for persistence across renders
    private interactionServices = new Map<string, SvgInteractionService>();

    // Effect refs for interaction service heat markers - keyed by unit ID
    private interactionServiceEffectRefs = new Map<string, EffectRef>();

    // Track which SVGs have had interactions set up (to avoid re-setup)
    private setupInteractionsSvgs = new WeakSet<SVGSVGElement>();

    // Canvas overlay component refs - keyed by unit ID for reuse during swipe transitions
    private canvasOverlayRefs = new Map<string, ComponentRef<PageCanvasOverlayComponent>>();

    // Canvas overlay subscriptions - need to unsubscribe on cleanup
    private canvasOverlaySubscriptions = new Map<string, { unsubscribe: () => void }>();

    // Interaction overlay component refs - keyed by unit ID for reuse during swipe transitions
    private interactionOverlayRefs = new Map<string, ComponentRef<PageInteractionOverlayComponent>>();
    
    // Track overlay mode for each unit - 'fixed' when attached to container, 'page' when attached to page-wrapper
    private interactionOverlayModes = new Map<string, 'fixed' | 'page'>();

    // Event listener cleanup functions
    private eventListenerCleanups: (() => void)[] = [];

    // Swipe state - track which units are displayed during swipe
    private baseDisplayStartIndex = 0; // The starting index before swipe began
    private isSwiping = false; // Whether we're currently in a swipe gesture

    // Swipe page elements - created at swipe start and reused during swipe
    // Maps unit index to its page wrapper element
    private swipePageElements = new Map<number, HTMLDivElement>();
    private swipeBasePositions: number[] = []; // Base page positions at swipe start

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

        // Watch for force units changes (additions, removals, reordering)
        let previousUnitIds: string[] = [];
        effect(() => {
            const force = this.force();
            const allUnits = force?.units() ?? [];
            const currentUnitIds = allUnits.map(u => u.id);

            // Skip if view isn't ready yet
            if (!this.viewInitialized) {
                previousUnitIds = currentUnitIds;
                return;
            }

            // Check if units have changed (different IDs or different order)
            const unitsChanged = currentUnitIds.length !== previousUnitIds.length ||
                currentUnitIds.some((id, idx) => id !== previousUnitIds[idx]);

            if (unitsChanged && previousUnitIds.length > 0) {
                // Units have changed - check if currently displayed units are still valid
                untracked(() => this.handleForceUnitsChanged(currentUnitIds));
            }

            previousUnitIds = currentUnitIds;
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

    /**
     * Called when swipe gesture starts.
     * Pre-creates all potentially needed page elements (visiblePageCount on each side).
     * This allows smooth CSS-only transforms during swipe without DOM manipulation.
     */
    private async onSwipeStart(): Promise<void> {
        if (!this.swipeAllowed()) return;
        
        // Close any open interaction overlays before swiping
        this.closeInteractionOverlays();
        
        this.isSwiping = true;
        this.baseDisplayStartIndex = this.viewStartIndex();
        
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const totalUnits = allUnits.length;
        const visiblePages = this.visiblePageCount();
        
        // Calculate all indices we might need during swipe
        // visiblePages on the left + base visible pages + visiblePages on the right
        const indicesToPrepare: number[] = [];
        
        // Add pages to the left (for swiping right)
        for (let i = visiblePages; i >= 1; i--) {
            const idx = (this.baseDisplayStartIndex - i + totalUnits) % totalUnits;
            if (!indicesToPrepare.includes(idx)) indicesToPrepare.push(idx);
        }
        
        // Add base visible pages
        for (let i = 0; i < visiblePages; i++) {
            const idx = (this.baseDisplayStartIndex + i) % totalUnits;
            if (!indicesToPrepare.includes(idx)) indicesToPrepare.push(idx);
        }
        
        // Add pages to the right (for swiping left)
        for (let i = 1; i <= visiblePages; i++) {
            const idx = (this.baseDisplayStartIndex + visiblePages - 1 + i) % totalUnits;
            if (!indicesToPrepare.includes(idx)) indicesToPrepare.push(idx);
        }
        
        // Pre-load all these units
        await Promise.all(indicesToPrepare.map(idx => (allUnits[idx] as CBTForceUnit).load()));
        
        // Store base positions for position calculations
        this.swipeBasePositions = this.zoomPanService.getPagePositions(visiblePages);
        
        // Create all swipe page elements upfront
        this.setupSwipePages(indicesToPrepare, allUnits as CBTForceUnit[]);
    }

    /**
     * Called during swipe movement.
     * ONLY updates the CSS transform - no DOM manipulation for 60fps performance.
     */
    private onSwipeMove(totalDx: number): void {
        if (!this.swipeAllowed() || !this.isSwiping) return;
        
        // Apply swipe transform to the wrapper - this is the ONLY operation during swipe move
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translateX(${totalDx}px)`;
    }

    /**
     * Called when swipe gesture ends.
     * Animates to final position, then updates state cleanly without flicker.
     */
    private onSwipeEnd(totalDx: number, velocity: number): void {
        if (!this.swipeAllowed()) {
            this.cleanupSwipeState();
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
        let pagesToMove = 0;
        
        if (flickPrev) {
            pagesToMove = -1;
        } else if (flickNext) {
            pagesToMove = 1;
        } else if (Math.abs(totalDx) > threshold) {
            pagesToMove = -Math.round(totalDx / scaledPageWidth);
        }
        
        // Clamp pagesToMove
        const force = this.forceBuilder.currentForce();
        const totalUnits = force?.units().length ?? 0;
        if (totalUnits > 0) {
            pagesToMove = Math.max(-totalUnits + 1, Math.min(totalUnits - 1, pagesToMove));
        }

        if (pagesToMove !== 0) {
            // Calculate final position to animate to
            const targetOffset = -pagesToMove * scaledPageWidth;
            
            // Animate to the target position
            swipeWrapper.style.transition = 'transform 0.25s ease-out';
            swipeWrapper.style.transform = `translateX(${targetOffset}px)`;

            // After animation completes, update state
            const onAnimationEnd = () => {
                swipeWrapper.removeEventListener('transitionend', onAnimationEnd);
                
                // Calculate new view start index
                const newStartIndex = ((this.baseDisplayStartIndex + pagesToMove) % totalUnits + totalUnits) % totalUnits;
                this.viewStartIndex.set(newStartIndex);
                
                // Reset transform before re-render to prevent flicker
                swipeWrapper.style.transition = 'none';
                swipeWrapper.style.transform = '';
                
                // Clean up swipe state and re-render with new positions
                this.cleanupSwipeState();
                this.displayUnit({ fromSwipe: true });
                
                // Update selection if needed
                const selectedUnit = this.unit();
                const isSelectedVisible = selectedUnit && this.displayedUnits.some(u => u.id === selectedUnit.id);
                if (!isSelectedVisible && this.displayedUnits.length > 0) {
                    const unitToSelect = pagesToMove > 0 
                        ? this.displayedUnits[0] 
                        : this.displayedUnits[this.displayedUnits.length - 1];
                    if (unitToSelect) {
                        this.forceBuilder.selectUnit(unitToSelect);
                    }
                }
            };
            
            swipeWrapper.addEventListener('transitionend', onAnimationEnd, { once: true });
        } else {
            // Snap back - animate to original position
            swipeWrapper.style.transition = 'transform 0.2s ease-out';
            swipeWrapper.style.transform = '';

            const onSnapBack = () => {
                swipeWrapper.removeEventListener('transitionend', onSnapBack);
                this.cleanupSwipeState();
                // Restore normal display without full re-render
                this.displayUnit();
            };
            
            swipeWrapper.addEventListener('transitionend', onSnapBack, { once: true });
        }
    }

    /**
     * Sets up all page elements needed for swipe at swipe start.
     * Creates page wrappers for all potentially visible indices.
     */
    private setupSwipePages(indices: number[], allUnits: CBTForceUnit[]): void {
        const content = this.contentRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const visiblePages = this.visiblePageCount();
        const totalUnits = allUnits.length;
        
        // Clear any existing swipe page elements
        this.swipePageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.swipePageElements.clear();
        
        // Also clear the normal page elements temporarily
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.pageElements = [];
        
        // Track displayed units for canvas/overlay cleanup
        const displayedUnitIds = new Set<string>();
        
        // Find where the base start index is in our indices array
        const baseIndexPosition = indices.indexOf(this.baseDisplayStartIndex);
        
        indices.forEach((unitIndex, arrayIndex) => {
            const unit = allUnits[unitIndex];
            if (!unit) return;
            
            const svg = unit.svg();
            if (!svg) return;
            
            displayedUnitIds.add(unit.id);
            
            const pageWrapper = this.renderer.createElement('div') as HTMLDivElement;
            this.renderer.addClass(pageWrapper, 'page-wrapper');
            pageWrapper.dataset['unitId'] = unit.id;
            pageWrapper.dataset['unitIndex'] = String(unitIndex);
            
            // Add selected class if this is the current unit
            const isSelected = unit.id === this.unit()?.id;
            const multipleVisible = visiblePages > 1;
            if (isSelected && multipleVisible) {
                this.renderer.addClass(pageWrapper, 'selected');
            }
            
            // Calculate position relative to base display
            const offsetFromBase = arrayIndex - baseIndexPosition;
            let unscaledLeft: number;
            
            if (offsetFromBase >= 0 && offsetFromBase < this.swipeBasePositions.length) {
                unscaledLeft = this.swipeBasePositions[offsetFromBase];
            } else if (offsetFromBase < 0) {
                unscaledLeft = this.swipeBasePositions[0] - ((-offsetFromBase) * (PAGE_WIDTH + PAGE_GAP));
            } else {
                const lastBasePos = this.swipeBasePositions[this.swipeBasePositions.length - 1] ?? this.swipeBasePositions[0];
                unscaledLeft = lastBasePos + ((offsetFromBase - this.swipeBasePositions.length + 1) * (PAGE_WIDTH + PAGE_GAP));
            }
            
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
            
            // Get or create interaction service for this unit (keyed by unit ID)
            if (!this.readOnly()) {
                this.getOrCreateInteractionService(unit, svg);
                this.getOrCreateCanvasOverlay(pageWrapper, unit);
                this.getOrCreateInteractionOverlay(pageWrapper, unit, 'page');
            }
            
            content.appendChild(pageWrapper);
            this.swipePageElements.set(unitIndex, pageWrapper);
        });
        
        // Update displayed units list
        this.displayedUnits = indices.map(idx => allUnits[idx]).filter(u => u);
        
        // Clean up unused overlays
        this.cleanupUnusedCanvasOverlays(displayedUnitIds);
        this.cleanupUnusedInteractionOverlays(displayedUnitIds);
    }

    /**
     * Cleans up swipe-specific state after swipe ends.
     */
    private cleanupSwipeState(): void {
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = '';
        swipeWrapper.style.transform = '';
        this.isSwiping = false;
        
        // Clear swipe page elements (they'll be recreated by displayUnit)
        const content = this.contentRef().nativeElement;
        this.swipePageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.swipePageElements.clear();
        this.swipeBasePositions = [];
    }

    /**
     * Gets or creates an interaction service for a unit.
     * Services are keyed by unit ID and persist across re-renders.
     * This avoids constantly re-creating services and re-attaching event listeners.
     */
    private getOrCreateInteractionService(unit: CBTForceUnit, svg: SVGSVGElement): SvgInteractionService {
        const unitId = unit.id;
        
        // Check if we already have a service for this unit
        const existingService = this.interactionServices.get(unitId);
        if (existingService) {
            // Check if this SVG already has interactions set up
            if (!this.setupInteractionsSvgs.has(svg)) {
                existingService.updateUnit(unit);
                existingService.setupInteractions(svg);
                this.setupInteractionsSvgs.add(svg);
            }
            return existingService;
        }
        
        // Create new service within an injection context
        const service = runInInjectionContext(this.injector, () => new SvgInteractionService());
        
        service.initialize(
            this.containerRef(),
            this.injector,
            this.zoomPanService
        );
        
        service.updateUnit(unit);
        service.setupInteractions(svg);
        this.setupInteractionsSvgs.add(svg);
        
        // Monitor heat marker state for this service
        const effectRef = effect(() => {
            const markerData = service.getHeatDiffMarkerData();
            const visible = service.getState().diffHeatMarkerVisible();
            
            untracked(() => {
                this.heatDiffMarkers.update(markers => {
                    const newMarkers = new Map(markers);
                    // Use index-based key for heat markers to maintain compatibility
                    const markerIndex = this.getMarkerIndexForUnit(unitId);
                    newMarkers.set(markerIndex, { data: markerData, visible });
                    return newMarkers;
                });
            });
        }, { injector: this.injector });
        
        this.interactionServiceEffectRefs.set(unitId, effectRef);
        this.interactionServices.set(unitId, service);
        
        return service;
    }

    /**
     * Gets a stable marker index for a unit ID.
     * This maintains compatibility with the heat diff marker array.
     */
    private getMarkerIndexForUnit(unitId: string): number {
        const displayedIndex = this.displayedUnits.findIndex(u => u.id === unitId);
        return displayedIndex >= 0 ? displayedIndex : 0;
    }

    /**
     * Cleans up interaction services for units no longer in the force.
     * Services are kept as long as the unit is in the force.
     */
    private cleanupUnusedInteractionServices(keepUnitIds: Set<string>): void {
        const toRemove: string[] = [];
        
        this.interactionServices.forEach((service, unitId) => {
            if (!keepUnitIds.has(unitId)) {
                // Clean up effect ref
                const effectRef = this.interactionServiceEffectRefs.get(unitId);
                if (effectRef) {
                    effectRef.destroy();
                    this.interactionServiceEffectRefs.delete(unitId);
                }
                
                service.cleanup();
                toRemove.push(unitId);
            }
        });
        
        toRemove.forEach(id => this.interactionServices.delete(id));
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
        const subscription = componentRef.instance.drawingStarted.subscribe((drawnUnit) => {
            this.forceBuilder.selectUnit(drawnUnit as CBTForceUnit);
        });

        // Store subscription for cleanup
        this.canvasOverlaySubscriptions.set(unitId, subscription);

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
                // Clean up subscription first
                const subscription = this.canvasOverlaySubscriptions.get(unitId);
                if (subscription) {
                    subscription.unsubscribe();
                    this.canvasOverlaySubscriptions.delete(unitId);
                }
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
        // Clean up all subscriptions
        this.canvasOverlaySubscriptions.forEach(sub => sub.unsubscribe());
        this.canvasOverlaySubscriptions.clear();
        
        this.canvasOverlayRefs.forEach(ref => {
            this.appRef.detachView(ref.hostView);
            ref.destroy();
        });
        this.canvasOverlayRefs.clear();
    }

    /**
     * Gets or creates an interaction overlay component for the given unit.
     * Reuses existing overlay if one already exists for the unit to prevent flickering.
     * 
     * @param pageWrapper The page wrapper element (used in 'page' mode)
     * @param unit The unit to create the overlay for
     * @param mode 'fixed' places overlay in container (stable during zoom), 'page' places in page-wrapper
     */
    private getOrCreateInteractionOverlay(
        pageWrapper: HTMLDivElement, 
        unit: CBTForceUnit,
        mode: 'fixed' | 'page' = 'page'
    ): ComponentRef<PageInteractionOverlayComponent> {
        const unitId = unit.id;
        const targetContainer = mode === 'fixed' 
            ? this.fixedOverlayContainerRef().nativeElement 
            : pageWrapper;
        
        // Check if we already have an overlay for this unit
        const existingRef = this.interactionOverlayRefs.get(unitId);
        const existingMode = this.interactionOverlayModes.get(unitId);
        
        if (existingRef) {
            // Check if mode changed - if so, we need to update positioning and mode input
            if (existingMode !== mode) {
                existingRef.setInput('mode', mode);
                this.interactionOverlayModes.set(unitId, mode);
                
                // Update positioning based on new mode
                const overlayElement = existingRef.location.nativeElement as HTMLElement;
                if (mode === 'fixed') {
                    // Fixed mode: fill the container
                    overlayElement.style.top = '0';
                    overlayElement.style.left = '0';
                    overlayElement.style.width = '100%';
                    overlayElement.style.height = '100%';
                } else {
                    // Page mode: fill the page wrapper
                    overlayElement.style.top = '0';
                    overlayElement.style.left = '0';
                    overlayElement.style.width = '100%';
                    overlayElement.style.height = '100%';
                }
            }
            
            // Move overlay to the correct container
            const overlayElement = existingRef.location.nativeElement as HTMLElement;
            targetContainer.appendChild(overlayElement);
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
        componentRef.setInput('mode', mode);

        // Attach to Angular's change detection
        this.appRef.attachView(componentRef.hostView);

        // Add the component's DOM element to the appropriate container
        const overlayElement = componentRef.location.nativeElement as HTMLElement;
        overlayElement.style.position = 'absolute';
        overlayElement.style.top = '0';
        overlayElement.style.left = '0';
        overlayElement.style.width = '100%';
        overlayElement.style.height = '100%';
        targetContainer.appendChild(overlayElement);

        // Store in maps
        this.interactionOverlayRefs.set(unitId, componentRef);
        this.interactionOverlayModes.set(unitId, mode);

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
        
        toRemove.forEach(id => {
            this.interactionOverlayRefs.delete(id);
            this.interactionOverlayModes.delete(id);
        });
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
        this.interactionOverlayModes.clear();
    }

    /**
     * Cleans up all interaction services.
     * Only called during full component cleanup - services persist across normal renders.
     */
    private cleanupInteractionServices(): void {
        // Destroy effect refs first
        this.interactionServiceEffectRefs.forEach(effectRef => effectRef.destroy());
        this.interactionServiceEffectRefs.clear();
        
        this.interactionServices.forEach(service => service.cleanup());
        this.interactionServices.clear();
        this.heatDiffMarkers.set(new Map());
        
        // Also clear the SVG tracking set (WeakSet doesn't need explicit clearing but we note it)
        this.setupInteractionsSvgs = new WeakSet<SVGSVGElement>();
    }

    /**
     * Closes all overlays on interaction overlay components.
     */
    private closeInteractionOverlays(): void {
        this.interactionOverlayRefs.forEach(ref => {
            ref.instance.closeAllOverlays();
        });
    }

    private initializePickerMonitoring(): void {
        if (this.readOnly()) return;

        // Monitor picker open state from any service
        effect(() => {
            // Check all services for picker state
            let anyPickerOpen = false;
            this.interactionServices.forEach(service => {
                if (service.isAnyPickerOpen()) {
                    anyPickerOpen = true;
                }
            });
            this.isPickerOpen.set(anyPickerOpen);
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
            // Close interaction overlays before re-rendering
            this.closeInteractionOverlays();
            this.displayUnit();
        }
    }

    // ========== Unit Display ==========

    private displayUnit(options: { fromSwipe?: boolean } = {}): void {
        const currentUnit = this.unit();
        const content = this.contentRef().nativeElement;
        const fromSwipe = options.fromSwipe ?? false;

        // Close any open interaction overlays when recreating pages
        this.closeInteractionOverlays();

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

        // Get page positions based on spaceEvenly setting
        const positions = this.zoomPanService.getPagePositions(this.displayedUnits.length);

        // Track which units are being displayed for cleanup
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

                // Set page dimensions and position
                // Store original (unscaled) position for zoom calculations
                const unscaledLeft = positions[index] ?? (index * (PAGE_WIDTH + PAGE_GAP));
                pageWrapper.dataset['originalLeft'] = String(unscaledLeft);
                pageWrapper.style.width = `${PAGE_WIDTH}px`;
                pageWrapper.style.height = `${PAGE_HEIGHT}px`;
                pageWrapper.style.position = 'absolute';
                pageWrapper.style.left = `${unscaledLeft}px`;
                pageWrapper.style.top = '0';

                // Use original SVG for all pages (allows interaction on all)
                pageWrapper.appendChild(svg);

                // Set the first page as the "current" SVG
                if (index === 0) {
                    this.currentSvg.set(svg);
                }

                // Get or create interaction service for this unit (keyed by unit ID)
                if (!this.readOnly()) {
                    this.getOrCreateInteractionService(unit, svg);

                    // Get or create canvas overlay (reuses existing if available)
                    this.getOrCreateCanvasOverlay(pageWrapper, unit);

                    // Get or create interaction overlay (reuses existing if available)
                    // Use 'fixed' mode when only 1 page is visible (overlay stays fixed during zoom)
                    // Use 'page' mode when 2+ pages are visible (overlay moves with page)
                    const overlayMode = this.visiblePageCount() === 1 ? 'fixed' : 'page';
                    this.getOrCreateInteractionOverlay(pageWrapper, unit, overlayMode);
                }

                content.appendChild(pageWrapper);
                this.pageElements.push(pageWrapper);
            }
        });

        // Clean up services/overlays for units no longer in force
        this.cleanupUnusedInteractionServices(displayedUnitIds);
        this.cleanupUnusedCanvasOverlays(displayedUnitIds);
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
        
        // Store cleanup functions for event listeners
        this.eventListenerCleanups.push(
            () => container.removeEventListener('click', handlePageSelection, { capture: true }),
            () => container.removeEventListener('svg-interaction-click', handlePageSelection)
        );
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

    // ========== Force Units Change Handling ==========

    /**
     * Handle changes to the force's units array (additions, removals, reordering).
     * Updates the view if currently displayed units no longer match their expected positions.
     */
    private handleForceUnitsChanged(currentUnitIds: string[]): void {
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        
        if (allUnits.length === 0) {
            // Force is empty, clear display
            this.clearPages();
            return;
        }

        // Check if any of our currently displayed units are no longer at the expected indices
        const viewStart = this.viewStartIndex();
        const visibleCount = this.visiblePageCount();
        let needsRedisplay = false;

        // Check each displayed unit against what should be at that index
        for (let i = 0; i < this.displayedUnits.length; i++) {
            const displayedUnit = this.displayedUnits[i];
            const expectedIndex = (viewStart + i) % allUnits.length;
            const expectedUnit = allUnits[expectedIndex];

            if (!expectedUnit || displayedUnit.id !== expectedUnit.id) {
                needsRedisplay = true;
                break;
            }
        }

        // Also check if we need to display more/fewer units now
        const targetDisplayCount = Math.min(visibleCount, allUnits.length);
        if (this.displayedUnits.length !== targetDisplayCount) {
            needsRedisplay = true;
        }

        // If viewStartIndex is now out of bounds, adjust it
        if (viewStart >= allUnits.length) {
            this.viewStartIndex.set(Math.max(0, allUnits.length - 1));
            needsRedisplay = true;
        }

        if (needsRedisplay) {
            this.displayUnit();
        }
    }

    // ========== Cleanup ==========

    private cleanup(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        
        // Clean up event listeners
        this.eventListenerCleanups.forEach(cleanup => cleanup());
        this.eventListenerCleanups = [];
        
        this.cleanupInteractionServices();
        this.cleanupCanvasOverlays();
        this.cleanupInteractionOverlays();
        this.clearPages();
    }
}
