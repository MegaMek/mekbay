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
import { SvgInteractionService } from './svg-interaction.service';
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
    styleUrls: ['./page-viewer.component.scss']
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

    // Swipe state - slot-based system for smooth transitions
    // Slots are positional containers (left neighbors, visible, right neighbors)
    // SVGs are only attached to slots when they become visible
    private swipeSlots: HTMLDivElement[] = []; // Array of slot elements by position
    private swipeSlotUnitAssignments: (number | null)[] = []; // Which unit index is assigned to each slot
    private swipeTotalSlots = 0; // Total number of slots (visiblePages * 3 typically)
    private swipeBasePositions: number[] = []; // Unscaled left position for each slot
    private swipeUnitsToLoad: CBTForceUnit[] = []; // Units that are pre-loaded for swipe
    private swipeDirection: 'left' | 'right' | 'none' = 'none'; // Current swipe direction for resolving conflicts
    private lastSwipeTranslateX = 0; // Track last translateX to determine direction

    // View start index - tracks the leftmost displayed unit, independent of selection
    // This allows swiping without changing the selected unit
    private viewStartIndex = signal(0);

    // Track if view is initialized
    private viewInitialized = false;

    // Track display version to handle async loads
    private displayVersion = 0;

    // Effect ref for fluff image visibility
    private fluffImageInjectEffectRef: EffectRef | null = null;

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

        // Watch for fluff image visibility option changes
        this.fluffImageInjectEffectRef = effect(() => {
            // Track the option - when it changes, update visibility on all displayed SVGs
            this.optionsService.options().recordSheetCenterPanelContent;
            this.setFluffImageVisibility();
        });

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
     * Creates empty slot wrappers for all potential positions.
     * SVGs are only attached when their slot becomes visible.
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
        
        // Calculate all unit indices we might need during swipe
        // These are unique unit indices that could potentially be shown
        const indicesToPrepare = new Set<number>();
        
        // Add pages to the left (for swiping right)
        for (let i = visiblePages; i >= 1; i--) {
            const idx = (this.baseDisplayStartIndex - i + totalUnits) % totalUnits;
            indicesToPrepare.add(idx);
        }
        
        // Add base visible pages
        for (let i = 0; i < visiblePages; i++) {
            const idx = (this.baseDisplayStartIndex + i) % totalUnits;
            indicesToPrepare.add(idx);
        }
        
        // Add pages to the right (for swiping left)
        for (let i = 1; i <= visiblePages; i++) {
            const idx = (this.baseDisplayStartIndex + visiblePages - 1 + i) % totalUnits;
            indicesToPrepare.add(idx);
        }
        
        // Pre-load all these units
        this.swipeUnitsToLoad = Array.from(indicesToPrepare).map(idx => allUnits[idx] as CBTForceUnit);
        await Promise.all(this.swipeUnitsToLoad.map(u => u.load()));
        
        // Store base positions for visible pages
        this.swipeBasePositions = this.zoomPanService.getPagePositions(visiblePages);
        
        // Create slot-based swipe pages
        this.setupSwipeSlots(allUnits as CBTForceUnit[]);
    }

    /**
     * Called during swipe movement.
     * Updates CSS transform and reassigns SVGs to visible slots.
     */
    private onSwipeMove(totalDx: number): void {
        if (!this.swipeAllowed() || !this.isSwiping) return;
        
        // Apply swipe transform to the wrapper
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translateX(${totalDx}px)`;
        
        // Update SVG assignments based on current visibility
        this.updateSwipeSlotVisibility(totalDx);
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
     * Sets up slot-based page wrappers for swipe.
     * Creates empty slots for: left neighbors + visible pages + right neighbors.
     * SVGs are only attached when their slot becomes visible.
     * 
     * Slot layout example with 2 visible pages and 4 units (A, B, C, D):
     * Starting with B, C visible:
     *   Slot: [0]  [1]  [2]  [3]  [4]  [5]
     *   Unit:  _    A    B    C    D    _
     *         ↑left     ↑visible↑      ↑right
     * 
     * Only slots 2 and 3 (visible area) will have SVGs attached initially.
     * As user swipes, SVGs are dynamically moved to/from visible slots.
     */
    private setupSwipeSlots(allUnits: CBTForceUnit[]): void {
        const content = this.contentRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const visiblePages = this.visiblePageCount();
        const totalUnits = allUnits.length;
        
        // Clear any existing slot elements
        this.swipeSlots.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.swipeSlots = [];
        this.swipeSlotUnitAssignments = [];
        
        // Also clear the normal page elements temporarily
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.pageElements = [];
        
        // Calculate total slots: visiblePages on left + visiblePages center + visiblePages on right
        this.swipeTotalSlots = visiblePages * 3;
        
        // Calculate slot positions (unscaled)
        // Center slots start at swipeBasePositions[0]
        const baseLeft = this.swipeBasePositions[0] ?? 0;
        const pageStep = PAGE_WIDTH + PAGE_GAP;
        const slotPositions: number[] = [];
        
        for (let i = 0; i < this.swipeTotalSlots; i++) {
            // Offset from center start: i - visiblePages
            const offset = i - visiblePages;
            slotPositions.push(baseLeft + offset * pageStep);
        }
        
        // Determine which unit index goes to each slot
        // Center slots (visiblePages to 2*visiblePages-1) show base displayed units
        // Left slots show previous units, right slots show next units
        const assignments: (number | null)[] = [];
        
        for (let slotIdx = 0; slotIdx < this.swipeTotalSlots; slotIdx++) {
            // Calculate the offset from the center (slot visiblePages is offset 0)
            const offsetFromCenter = slotIdx - visiblePages;
            // Calculate which unit index this slot represents
            const unitIndex = (this.baseDisplayStartIndex + offsetFromCenter + totalUnits) % totalUnits;
            assignments.push(unitIndex);
        }
        
        this.swipeSlotUnitAssignments = assignments;
        
        // Create all slot wrapper elements
        // Center slots are indices [visiblePages, 2*visiblePages-1]
        const centerSlotStart = visiblePages;
        const centerSlotEnd = visiblePages * 2 - 1;
        
        for (let slotIdx = 0; slotIdx < this.swipeTotalSlots; slotIdx++) {
            const slotWrapper = this.renderer.createElement('div') as HTMLDivElement;
            this.renderer.addClass(slotWrapper, 'page-wrapper');
            slotWrapper.dataset['slotIndex'] = String(slotIdx);
            
            // Add neighbor-page class to all non-center slots
            const isNeighborSlot = slotIdx < centerSlotStart || slotIdx > centerSlotEnd;
            if (isNeighborSlot) {
                this.renderer.addClass(slotWrapper, 'neighbor-page');
            }
            
            const unscaledLeft = slotPositions[slotIdx];
            slotWrapper.dataset['originalLeft'] = String(unscaledLeft);
            slotWrapper.style.width = `${PAGE_WIDTH * scale}px`;
            slotWrapper.style.height = `${PAGE_HEIGHT * scale}px`;
            slotWrapper.style.position = 'absolute';
            slotWrapper.style.left = `${unscaledLeft * scale}px`;
            slotWrapper.style.top = '0';
            
            content.appendChild(slotWrapper);
            this.swipeSlots.push(slotWrapper);
        }
        
        // Initial SVG assignment - only for visible slots (center slots)
        this.updateSwipeSlotVisibility(0);
    }
    
    /**
     * Updates which slots have SVGs attached based on current visibility.
     * An SVG can only be in one place at a time, so we need to:
     * 1. Determine which slots are currently visible (even partially)
     * 2. For each visible slot, attach its assigned unit's SVG if not already attached elsewhere
     * 3. Remove SVGs from slots that are no longer visible
     * 4. When the same unit is assigned to multiple visible slots, prioritize based on swipe direction
     */
    private updateSwipeSlotVisibility(translateX: number): void {
        const container = this.containerRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const containerWidth = container.clientWidth;
        const translate = this.zoomPanService.translate();
        
        // Update swipe direction based on movement
        if (translateX > this.lastSwipeTranslateX + 1) {
            this.swipeDirection = 'right'; // Swiping right (content moves right, showing left pages)
        } else if (translateX < this.lastSwipeTranslateX - 1) {
            this.swipeDirection = 'left'; // Swiping left (content moves left, showing right pages)
        }
        this.lastSwipeTranslateX = translateX;
        
        // Calculate the visible area in content coordinates (accounting for transform)
        // The content is transformed by translateX (swipe) and the base translate
        const totalTranslateX = translate.x + translateX;
        
        // Visible range in scaled coordinates
        const visibleLeft = -totalTranslateX;
        const visibleRight = visibleLeft + containerWidth;
        
        const force = this.forceBuilder.currentForce();
        const allUnits = force?.units() ?? [];
        const visiblePages = this.visiblePageCount();
        const centerSlotStart = visiblePages; // Index of first center slot
        const centerSlotEnd = visiblePages * 2 - 1; // Index of last center slot
        
        // Track which unit indices currently have their SVGs attached and in which slot
        const unitToSlotMap = new Map<number, number>(); // unitIndex -> slotIndex where SVG is attached
        
        // First pass: find which units have SVGs attached and mark visible slots
        const visibleSlotIndices: number[] = [];
        
        for (let slotIdx = 0; slotIdx < this.swipeSlots.length; slotIdx++) {
            const slot = this.swipeSlots[slotIdx];
            const slotLeft = parseFloat(slot.style.left);
            const slotRight = slotLeft + PAGE_WIDTH * scale;
            
            // Check if this slot is visible (even partially)
            const isVisible = slotRight > visibleLeft && slotLeft < visibleRight;
            
            if (isVisible) {
                visibleSlotIndices.push(slotIdx);
            }
            
            // Check if slot has an SVG
            const svg = slot.querySelector('svg');
            if (svg) {
                const unitIndex = this.swipeSlotUnitAssignments[slotIdx];
                if (unitIndex !== null) {
                    unitToSlotMap.set(unitIndex, slotIdx);
                }
            }
        }
        
        // Build a map of unitIndex -> list of visible slots that want this unit
        const unitToVisibleSlots = new Map<number, number[]>();
        for (const slotIdx of visibleSlotIndices) {
            const unitIndex = this.swipeSlotUnitAssignments[slotIdx];
            if (unitIndex === null) continue;
            if (!unitToVisibleSlots.has(unitIndex)) {
                unitToVisibleSlots.set(unitIndex, []);
            }
            unitToVisibleSlots.get(unitIndex)!.push(slotIdx);
        }
        
        // Determine winning slot for each unit when there are conflicts
        // Priority: center slots first, then direction-based (swipe left = prefer right slots)
        const winningSlotForUnit = new Map<number, number>();
        for (const [unitIndex, slots] of unitToVisibleSlots) {
            if (slots.length === 1) {
                winningSlotForUnit.set(unitIndex, slots[0]);
            } else {
                // Multiple visible slots want the same unit - resolve conflict
                // First, check if any is a center slot (always wins)
                const centerSlot = slots.find(s => s >= centerSlotStart && s <= centerSlotEnd);
                if (centerSlot !== undefined) {
                    winningSlotForUnit.set(unitIndex, centerSlot);
                } else {
                    // No center slot visible - use swipe direction
                    // Swiping left = showing right pages = prefer higher slot index
                    // Swiping right = showing left pages = prefer lower slot index
                    if (this.swipeDirection === 'left') {
                        winningSlotForUnit.set(unitIndex, Math.max(...slots));
                    } else {
                        winningSlotForUnit.set(unitIndex, Math.min(...slots));
                    }
                }
            }
        }
        
        // Second pass: remove SVGs from non-visible slots AND from non-winning visible slots
        for (let slotIdx = 0; slotIdx < this.swipeSlots.length; slotIdx++) {
            const slot = this.swipeSlots[slotIdx];
            const unitIndex = this.swipeSlotUnitAssignments[slotIdx];
            const svg = slot.querySelector('svg') as SVGSVGElement | null;
            
            if (!svg || svg.parentElement !== slot) continue;
            
            const isVisible = visibleSlotIndices.includes(slotIdx);
            const isWinningSlot = unitIndex !== null && winningSlotForUnit.get(unitIndex) === slotIdx;
            
            // Remove if not visible OR if visible but not the winning slot for this unit
            if (!isVisible || !isWinningSlot) {
                slot.removeChild(svg);
                // Remove neighbor-visible class when removing
                this.renderer.removeClass(slot, 'neighbor-visible');
                if (unitIndex !== null) {
                    unitToSlotMap.delete(unitIndex);
                }
            }
        }
        
        // Third pass: attach SVGs to winning visible slots that need them
        const displayedUnitIds = new Set<string>();
        
        // In single-page mode, determine which slot is most visible for 'fixed' overlay mode
        // Calculate visibility percentage for each winning slot
        let mostVisibleSlotIdx: number | null = null;
        if (visiblePages === 1) {
            let maxVisibility = 0;
            for (const [, slotIdx] of winningSlotForUnit) {
                const slot = this.swipeSlots[slotIdx];
                const slotLeft = parseFloat(slot.style.left);
                const slotRight = slotLeft + PAGE_WIDTH * scale;
                
                // Calculate how much of the slot is within the visible area
                const overlapLeft = Math.max(slotLeft, visibleLeft);
                const overlapRight = Math.min(slotRight, visibleRight);
                const overlapWidth = Math.max(0, overlapRight - overlapLeft);
                const slotWidth = PAGE_WIDTH * scale;
                const visibilityPercent = slotWidth > 0 ? overlapWidth / slotWidth : 0;
                
                if (visibilityPercent > maxVisibility) {
                    maxVisibility = visibilityPercent;
                    mostVisibleSlotIdx = slotIdx;
                }
            }
        }
        
        for (const [unitIndex, winningSlotIdx] of winningSlotForUnit) {
            const slot = this.swipeSlots[winningSlotIdx];
            const unit = allUnits[unitIndex] as CBTForceUnit;
            if (!unit) continue;
            
            const svg = unit.svg();
            if (!svg) continue;
            
            displayedUnitIds.add(unit.id);
            
            // Check if this slot already has this SVG
            const existingSvg = slot.querySelector('svg');
            if (existingSvg === svg) {
                // Already in place, but still need to update overlay mode in single-page mode
                if (!this.readOnly() && visiblePages === 1) {
                    const overlayMode = winningSlotIdx === mostVisibleSlotIdx ? 'fixed' : 'page';
                    this.getOrCreateInteractionOverlay(slot, unit, overlayMode);
                }
                continue;
            }
            
            // Check if this unit's SVG is still attached elsewhere (shouldn't happen after cleanup)
            if (unitToSlotMap.has(unitIndex)) {
                continue;
            }
            
            // Update slot data attributes
            slot.dataset['unitId'] = unit.id;
            slot.dataset['unitIndex'] = String(unitIndex);
            
            // Check if this is a neighbor slot (non-center)
            const isNeighborSlot = winningSlotIdx < centerSlotStart || winningSlotIdx > centerSlotEnd;
            
            // Add selected class if this is the current unit (only for center slots)
            const isSelected = unit.id === this.unit()?.id;
            const multipleVisible = visiblePages > 1;
            this.containerRef().nativeElement.classList.toggle('multiple-visible', multipleVisible);
            if (isSelected) {
                this.renderer.addClass(slot, 'selected');
            } else {
                this.renderer.removeClass(slot, 'selected');
            }
            
            // Add neighbor-visible class for neighbor slots (non-center)
            if (isNeighborSlot) {
                this.renderer.addClass(slot, 'neighbor-visible');
            } else {
                this.renderer.removeClass(slot, 'neighbor-visible');
            }
            
            // Apply scale to SVG and attach
            svg.style.transform = `scale(${scale})`;
            svg.style.transformOrigin = 'top left';
            slot.appendChild(svg);
            unitToSlotMap.set(unitIndex, winningSlotIdx);
            
            // Set up interactions if needed
            if (!this.readOnly()) {
                this.getOrCreateInteractionService(unit, svg);
                this.getOrCreateCanvasOverlay(slot, unit);
                // In single-page mode, use 'fixed' for most visible slot, 'page' for others
                // In multi-page mode, always use 'page' (all pages are equally important)
                const overlayMode = visiblePages === 1 && winningSlotIdx === mostVisibleSlotIdx ? 'fixed' : 'page';
                this.getOrCreateInteractionOverlay(slot, unit, overlayMode);
            }
        }
        
        // Update displayed units list (use unique units from winning slots)
        const uniqueUnitIndices = new Set(winningSlotForUnit.keys());
        this.displayedUnits = Array.from(uniqueUnitIndices)
            .map(idx => allUnits[idx] as CBTForceUnit)
            .filter(u => u);
        
        // Clean up unused overlays (keep only displayed ones)
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
        
        // Clear swipe slot elements (they'll be recreated by displayUnit)
        const content = this.contentRef().nativeElement;
        this.swipeSlots.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
        });
        this.swipeSlots = [];
        this.swipeSlotUnitAssignments = [];
        this.swipeTotalSlots = 0;
        this.swipeBasePositions = [];
        this.swipeUnitsToLoad = [];
        this.swipeDirection = 'none';
        this.lastSwipeTranslateX = 0;
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
                this.containerRef().nativeElement.classList.toggle('multiple-visible', multipleVisible);
                if (isSelected) {
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
        
        // Apply fluff image visibility setting to newly rendered SVGs
        this.setFluffImageVisibility();
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
            this.containerRef().nativeElement.classList.toggle('multiple-visible', multipleVisible);
            if (isSelected) {
                this.renderer.addClass(wrapper, 'selected');
            } else {
                this.renderer.removeClass(wrapper, 'selected');
            }
        });
    }

    /**
     * Sets the visibility of fluff images vs reference tables in all displayed SVGs.
     * Controlled by the recordSheetCenterPanelContent option.
     */
    private setFluffImageVisibility(): void {
        const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
        const showFluff = centerContent === 'fluffImage';
        
        // Apply to all displayed units' SVGs
        for (const unit of this.displayedUnits) {
            const svg = unit.svg();
            if (!svg) continue;
            
            const injectedEl = svg.getElementById('fluff-image-fo') as HTMLElement | null;
            if (!injectedEl) continue; // this unit doesn't have a fluff image
            
            const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
            if (referenceTables.length === 0) continue; // no reference tables to hide/show
            
            if (showFluff) {
                injectedEl.style.setProperty('display', 'block');
                referenceTables.forEach((rt) => {
                    rt.style.display = 'none';
                });
            } else {
                injectedEl.style.setProperty('display', 'none');
                referenceTables.forEach((rt) => {
                    rt.style.display = 'block';
                });
            }
        }
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
        
        // Clean up fluff image effect
        if (this.fluffImageInjectEffectRef) {
            this.fluffImageInjectEffectRef.destroy();
            this.fluffImageInjectEffectRef = null;
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
