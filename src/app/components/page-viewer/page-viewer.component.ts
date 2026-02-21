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
import { LayoutService } from '../../services/layout.service';
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
    host: {
        '(window:keydown)': 'onWindowKeyDown($event)'
    },
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

    readonly unit = computed(() => {
        const selectedUnit = this.forceBuilder.selectedUnit();
        if (selectedUnit instanceof CBTForceUnit) {
            return selectedUnit;
        }
        return null;
    }, { equal: () => false });
    readonly force = computed(() => {
        const force = this.unit()?.force;
        if (force instanceof CBTForce) {
            return force;
        }
        return null;
    });
    readonly forceUnits = computed(() => this.force()?.units() ?? []);

    spaceEvenly = input(false);
    maxVisiblePageCount = input(99); // Limits max pages displayed even if viewport fits more
    shadowPages = input(true); // When true, shows faded clones of neighbor pages that can be clicked to navigate

    // Computed from force
    readOnly = computed(() => this.force()?.readOnly() ?? false);

    // View children
    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    swipeWrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('swipeWrapper');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');
    fixedOverlayContainerRef = viewChild.required<ElementRef<HTMLDivElement>>('fixedOverlayContainer');

    // State
    loadError = signal<string | null>(null);
    currentSvg = signal<SVGSVGElement | null>(null);

    // Track displayed units
    private displayedUnitIds = signal<string[]>([]);

    isPickerOpen = computed(() => {
        if (this.readOnly()) {
            return false;
        }

        const displayedIds = this.displayedUnitIds();
        let anyPickerOpen = false;

        for (const unitId of displayedIds) {
            const service = this.interactionServices.get(unitId);
            if (service?.isAnyPickerOpen()) {
                anyPickerOpen = true;
                break;
            }
        }

        return anyPickerOpen;
    });

    // Heat diff marker data for each interaction service (keyed by unitId for stability)
    heatDiffMarkers = signal<Map<string, { data: HeatDiffMarkerData | null; visible: boolean }>>(new Map());

    // Computed properties
    isFullyVisible = computed(() => this.zoomPanService.isFullyVisible());
    visiblePageCount = computed(() => this.zoomPanService.visiblePageCount());
    
    // Effective visible page count respects maxVisiblePageCount limit and allowMultipleActiveSheets option
    effectiveVisiblePageCount = computed(() => {
        const allowMultiple = this.optionsService.options().allowMultipleActiveSheets;
        if (!allowMultiple) {
            return 1;
        }
        return Math.min(this.visiblePageCount(), this.maxVisiblePageCount());
    });

    // Navigation computed properties for keyboard and button navigation
    hasPrev = computed(() => this.viewStartIndex() > 0);
    hasNext = computed(() => {
        const totalPages = this.getTotalPageCount();
        const visiblePages = this.effectiveVisiblePageCount();
        return this.viewStartIndex() + visiblePages < totalPages;
    });

    // Swipe is allowed only when total pages > effective visible pages and not in canvas paint mode
    swipeAllowed = computed(() => {
        if (this.optionsService.options().swipeToNextSheet === 'disabled') {
            return false;
        }
        // Block swipe when canvas drawing is active
        if (this.canvasService.isActive()) {
            return false;
        }
        const totalPages = this.getTotalPageCount();
        const visiblePages = this.effectiveVisiblePageCount();
        // Only allow swipe if we have more pages than can be shown at once
        return totalPages > visiblePages;
    });

    // Computed array of heat markers for template iteration
    heatDiffMarkerArray = computed(() => {
        const markers = this.heatDiffMarkers();
        const displayedIds = this.displayedUnitIds();

        return displayedIds.map((unitId, index) => {
            const state = markers.get(unitId);
            return {
                index,
                unitId,
                data: state?.data ?? null,
                visible: state?.visible ?? false
            };
        });
    });

    // Private state
    private resizeObserver: ResizeObserver | null = null;
    private lastViewState: ViewportTransform | null = null;

    // Current displayed units for multi-page view
    private displayedUnits: CBTForceUnit[] = [];
    private pageElements: HTMLDivElement[] = [];
    private shadowPageElements: HTMLDivElement[] = []; // Cloned shadow pages for neighbor preview
    private shadowPageCleanups: (() => void)[] = []; // Cleanup functions for shadow page event listeners

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
    private swipeVersion = 0; // Version counter to cancel stale animation callbacks
    private swipeAnimationCallback: (() => void) | null = null; // Current animation callback
    private pendingPagesToMove = 0; // Pages to move when animation completes (used for cancellation)

    // Swipe state - slot-based system for smooth transitions
    // Slots are positional containers (left neighbors, visible, right neighbors)
    // SVGs are only attached to slots when they become visible
    private swipeSlots: HTMLDivElement[] = []; // Array of slot elements by position
    private swipeSlotUnitAssignments: (number | null)[] = []; // Which unit index is assigned to each slot
    private swipeTotalSlots = 0; // Total number of slots
    private swipeBasePositions: number[] = []; // Unscaled left position for each slot
    private swipeUnitsToLoad: CBTForceUnit[] = []; // Units that are pre-loaded for swipe
    private swipeDirection: 'left' | 'right' | 'none' = 'none'; // Current swipe direction for resolving conflicts
    private lastSwipeTranslateX = 0; // Track last translateX to determine direction
    
    // Lazy swipe state - track the range of created slots for dynamic extension
    private swipeLeftmostOffset = 0; // Leftmost slot offset from baseDisplayStartIndex
    private swipeRightmostOffset = 0; // Rightmost slot offset from baseDisplayStartIndex
    private swipeAllUnits: CBTForceUnit[] = []; // Cached reference to all units during swipe

    // View start index - tracks the leftmost displayed unit, independent of selection
    // This allows swiping without changing the selected unit
    private viewStartIndex = signal(0);

    // Track if view is initialized
    private viewInitialized = false;
    
    // Track if initial render is complete (prevents resize handler from creating shadows prematurely)
    private initialRenderComplete = false;

    // Track display version to handle async loads
    private displayVersion = 0;

    // Effect ref for fluff image visibility
    private fluffImageInjectEffectRef: EffectRef | null = null;

    constructor() {
        // Watch for unit changes
        let previousUnit: CBTForceUnit | null = null;
        let unitEffectRunId = 0;

        effect((onCleanup) => {
            const runId = ++unitEffectRunId;
            let cancelled = false;

            onCleanup(() => {
                cancelled = true;
            });

            const currentUnit = this.unit();

            // Skip if view isn't ready yet
            if (!this.viewInitialized) {
                return;
            }

            void (async () => {
                // Load unit if needed
                if (currentUnit) {
                    await currentUnit.load();
                }

                // Ignore stale async continuations
                if (cancelled || runId !== unitEffectRunId) {
                    return;
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
                        if (currentUnit) {
                            const allUnits = this.forceUnits();
                            const newIndex = allUnits.indexOf(currentUnit);
                            if (newIndex >= 0) {
                                this.viewStartIndex.set(newIndex);
                            }
                        }
                        this.displayUnit();
                    });
                }

                previousUnit = currentUnit;
            })();
        }, { injector: this.injector });

        // Watch for force units changes (additions, removals, reordering)
        let previousUnitIds: string[] = [];
        let previousUnitCount = 0;
        effect(() => {
            const force = this.force();
            const allUnits = force?.units() ?? [];
            const currentUnitIds = allUnits.map(u => u.id);
            const currentUnitCount = allUnits.length;

            // Skip if view isn't ready yet
            if (!this.viewInitialized) {
                previousUnitIds = currentUnitIds;
                previousUnitCount = currentUnitCount;
                return;
            }

            // Check if units have changed (different IDs or different order)
            const unitsChanged = currentUnitIds.length !== previousUnitIds.length ||
                currentUnitIds.some((id, idx) => id !== previousUnitIds[idx]);

            if (unitsChanged) {
                // Units have changed - update view
                untracked(() => this.handleForceUnitsChanged(previousUnitCount));
            }

            previousUnitIds = currentUnitIds;
            previousUnitCount = currentUnitCount;
        }, { injector: this.injector });

        // Watch for fluff image visibility option changes
        this.fluffImageInjectEffectRef = effect(() => {
            // Track the option - when it changes, update visibility on all displayed SVGs
            this.optionsService.options().recordSheetCenterPanelContent;
            this.setFluffImageVisibility();
        });

        // Watch for allowMultipleActiveSheets option changes
        let previousAllowMultiple: boolean | undefined;
        effect(() => {
            const allowMultiple = this.optionsService.options().allowMultipleActiveSheets;
            
            // Skip initial run or if value hasn't changed
            if (previousAllowMultiple === undefined) {
                previousAllowMultiple = allowMultiple;
                return;
            }
            
            if (allowMultiple !== previousAllowMultiple) {
                previousAllowMultiple = allowMultiple;
                
                // Re-display units with new effective visible count
                if (this.viewInitialized && !this.isSwiping) {
                    untracked(() => {
                        this.displayUnit();
                    });
                }
            }
        });

        // Watch for readOnly changes (e.g., after cloning a shared force)
        let previousReadOnly: boolean | undefined;
        effect(() => {
            const isReadOnly = this.readOnly();
            
            // Skip initial run
            if (previousReadOnly === undefined) {
                previousReadOnly = isReadOnly;
                return;
            }
            
            // Re-display when transitioning from readOnly to editable
            if (previousReadOnly && !isReadOnly && this.viewInitialized && !this.isSwiping) {
                previousReadOnly = isReadOnly;
                untracked(() => {
                    this.displayUnit();
                });
            } else {
                previousReadOnly = isReadOnly;
            }
        });

        inject(DestroyRef).onDestroy(() => this.cleanup());
    }

    ngAfterViewInit(): void {
        this.viewInitialized = true;
        this.setupResizeObserver();
        this.setupPageClickCapture();
        this.initializeZoomPan();
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
        
        // Cancel any pending animation callback from a previous swipe
        // This prevents stale callbacks from interfering with the new swipe
        this.swipeVersion++;
        if (this.swipeAnimationCallback) {
            const swipeWrapper = this.swipeWrapperRef().nativeElement;
            swipeWrapper.removeEventListener('transitionend', this.swipeAnimationCallback);
            this.swipeAnimationCallback = null;
            
            // Apply the pending page move that the animation was heading toward
            if (this.pendingPagesToMove !== 0) {
                const totalUnits = this.forceUnits().length;
                if (totalUnits > 0) {
                    const newStartIndex = ((this.baseDisplayStartIndex + this.pendingPagesToMove) % totalUnits + totalUnits) % totalUnits;
                    this.viewStartIndex.set(newStartIndex);
                }
                this.pendingPagesToMove = 0;
            }
            
            // Reset the wrapper transform immediately since we're starting a new swipe
            swipeWrapper.style.transition = 'none';
            swipeWrapper.style.transform = '';
        }
        
        // Close any open interaction overlays before swiping
        this.closeInteractionOverlays();
        
        // Clear shadow pages during swipe
        this.clearShadowPages();
        
        // Remove any stale 'leaving-page' classes from previous interrupted animations
        this.pageElements.forEach(el => this.renderer.removeClass(el, 'leaving-page'));
        
        this.isSwiping = true;
        this.baseDisplayStartIndex = this.viewStartIndex();
        
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        const effectiveVisible = this.effectiveVisiblePageCount();
        const viewportCapacity = this.visiblePageCount();
        
        // Cache all units for lazy slot extension
        this.swipeAllUnits = allUnits as CBTForceUnit[];
        
        // Calculate initial slots: what's visible + 1 neighbor on each side
        // This is the minimum needed for smooth initial swipe
        const initialLeftNeighbors = 1;
        const initialRightNeighbors = 1;
        
        // Calculate initial range (offsets from baseDisplayStartIndex)
        this.swipeLeftmostOffset = -initialLeftNeighbors;
        this.swipeRightmostOffset = effectiveVisible - 1 + initialRightNeighbors;
        
        // Clamp to avoid creating more slots than units
        const maxOffset = totalUnits - 1;
        const totalRange = this.swipeRightmostOffset - this.swipeLeftmostOffset + 1;
        if (totalRange > totalUnits) {
            // We have more slots than units, adjust
            this.swipeLeftmostOffset = -(Math.floor((totalUnits - effectiveVisible) / 2));
            this.swipeRightmostOffset = this.swipeLeftmostOffset + totalUnits - 1;
        }
        
        // Pre-load initial units
        const indicesToPrepare = new Set<number>();
        for (let offset = this.swipeLeftmostOffset; offset <= this.swipeRightmostOffset; offset++) {
            const idx = (this.baseDisplayStartIndex + offset + totalUnits) % totalUnits;
            indicesToPrepare.add(idx);
        }
        
        this.swipeUnitsToLoad = Array.from(indicesToPrepare).map(idx => allUnits[idx] as CBTForceUnit);
        await Promise.all(this.swipeUnitsToLoad.map(u => u.load()));
        
        // Store base positions for visible pages
        this.swipeBasePositions = this.zoomPanService.getPagePositions(effectiveVisible);
        
        // Create initial slot-based swipe pages
        this.setupSwipeSlots();
    }

    /**
     * Called during swipe movement.
     * Updates CSS transform, extends slots if needed, and reassigns SVGs to visible slots.
     */
    private onSwipeMove(totalDx: number): void {
        if (!this.swipeAllowed() || !this.isSwiping) return;
        
        // Apply swipe transform to the wrapper
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translateX(${totalDx}px)`;
        
        // Extend slots dynamically if user has swiped far enough
        this.extendSwipeSlotsIfNeeded(totalDx);
        
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

        // Calculate how many pages we've swiped past based on distance first
        let pagesToMove = 0;
        
        if (Math.abs(totalDx) > threshold) {
            pagesToMove = -Math.round(totalDx / scaledPageWidth);
        }
        
        // Only check velocity (flick) if distance-based calculation resulted in 0 pages
        if (pagesToMove === 0) {
            const flickPrev = velocity > SWIPE_VELOCITY_THRESHOLD;
            const flickNext = velocity < -SWIPE_VELOCITY_THRESHOLD;
            
            if (flickPrev) {
                pagesToMove = -1;
            } else if (flickNext) {
                pagesToMove = 1;
            }
        }
        
        // Clamp pagesToMove
        const totalUnits = this.forceUnits().length;
        if (totalUnits > 0) {
            pagesToMove = Math.max(-totalUnits + 1, Math.min(totalUnits - 1, pagesToMove));
        }

        if (pagesToMove !== 0) {
            // Store the last view state before animating so that we can restore it later
            const viewState = this.zoomPanService.viewState();
            this.lastViewState = {
                scale: viewState.scale,
                translateX: viewState.translateX,
                translateY: viewState.translateY
            };
            // Calculate final position to animate to
            const targetOffset = -pagesToMove * scaledPageWidth;
            
            // Pre-attach SVGs for the target position before animation starts
            // This ensures the destination page is visible during the animation, not blank
            // Using addOnly mode adds incoming SVGs without removing outgoing ones
            this.updateSwipeSlotVisibility(targetOffset, { addOnly: true });
            
            // Animate to the target position
            swipeWrapper.style.transition = 'transform 0.25s ease-out';
            swipeWrapper.style.transform = `translateX(${targetOffset}px)`;

            // Store the pending move so we can apply it if cancelled
            this.pendingPagesToMove = pagesToMove;

            // Capture version to detect if a new swipe started during animation
            const animationVersion = this.swipeVersion;
            
            // After animation completes, update state
            const onAnimationEnd = () => {
                swipeWrapper.removeEventListener('transitionend', onAnimationEnd);
                this.swipeAnimationCallback = null;
                this.pendingPagesToMove = 0;
                
                // If a new swipe started during the animation, don't run cleanup
                if (this.swipeVersion !== animationVersion) {
                    return;
                }
                
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
            
            // Store reference so we can cancel if a new swipe starts
            this.swipeAnimationCallback = onAnimationEnd;
            swipeWrapper.addEventListener('transitionend', onAnimationEnd, { once: true });
        } else {
            // Snap back - animate to original position
            swipeWrapper.style.transition = 'transform 0.2s ease-out';
            swipeWrapper.style.transform = '';
            
            // Capture version to detect if a new swipe started during animation
            const snapBackVersion = this.swipeVersion;

            const onSnapBack = () => {
                swipeWrapper.removeEventListener('transitionend', onSnapBack);
                this.swipeAnimationCallback = null;
                
                // If a new swipe started during the animation, don't run cleanup
                if (this.swipeVersion !== snapBackVersion) {
                    return;
                }
                
                this.cleanupSwipeState();
                // Restore normal display without full re-render
                this.displayUnit();
            };
            
            // Store reference so we can cancel if a new swipe starts
            this.swipeAnimationCallback = onSnapBack;
            swipeWrapper.addEventListener('transitionend', onSnapBack, { once: true });
        }
    }

    /**
     * Sets up slot-based page wrappers for swipe using the tracked offset range.
     * Creates slots from swipeLeftmostOffset to swipeRightmostOffset.
     * SVGs are only attached when their slot becomes visible.
     * 
     * Slots are identified by their offset from baseDisplayStartIndex.
     * Offset 0 is the first active page, negative offsets are left neighbors,
     * positive offsets beyond effectiveVisible-1 are right neighbors.
     */
    private setupSwipeSlots(): void {
        const content = this.contentRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const effectiveVisible = this.effectiveVisiblePageCount();
        const totalUnits = this.swipeAllUnits.length;
        
        // Clear any existing slot elements
        this.swipeSlots.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
            el.innerHTML = '';
        });
        this.swipeSlots = [];
        this.swipeSlotUnitAssignments = [];
        
        // Also clear the normal page elements temporarily
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
            el.innerHTML = '';
        });
        this.pageElements = [];
        
        // Calculate slot count from offset range
        this.swipeTotalSlots = this.swipeRightmostOffset - this.swipeLeftmostOffset + 1;
        
        // Calculate slot positions (unscaled)
        const baseLeft = this.swipeBasePositions[0] ?? 0;
        const pageStep = PAGE_WIDTH + PAGE_GAP;
        
        // Center slots are offsets [0, effectiveVisible-1]
        const centerSlotStartOffset = 0;
        const centerSlotEndOffset = effectiveVisible - 1;
        
        for (let offset = this.swipeLeftmostOffset; offset <= this.swipeRightmostOffset; offset++) {
            const slotIdx = offset - this.swipeLeftmostOffset; // Convert offset to array index
            const unitIndex = (this.baseDisplayStartIndex + offset + totalUnits) % totalUnits;
            
            this.swipeSlotUnitAssignments.push(unitIndex);
            
            const slotWrapper = this.renderer.createElement('div') as HTMLDivElement;
            this.renderer.addClass(slotWrapper, 'page-wrapper');
            slotWrapper.dataset['slotIndex'] = String(slotIdx);
            slotWrapper.dataset['slotOffset'] = String(offset);
            
            // Add neighbor-page class to all non-center slots
            const isNeighborSlot = offset < centerSlotStartOffset || offset > centerSlotEndOffset;
            if (isNeighborSlot) {
                this.renderer.addClass(slotWrapper, 'neighbor-page');
            }
            
            const unscaledLeft = baseLeft + offset * pageStep;
            slotWrapper.dataset['originalLeft'] = String(unscaledLeft);
            slotWrapper.style.width = `${PAGE_WIDTH * scale}px`;
            slotWrapper.style.height = `${PAGE_HEIGHT * scale}px`;
            slotWrapper.style.position = 'absolute';
            slotWrapper.style.left = `${unscaledLeft * scale}px`;
            slotWrapper.style.top = '0';
            
            content.appendChild(slotWrapper);
            this.swipeSlots.push(slotWrapper);
        }
        
        // Initial SVG assignment
        this.updateSwipeSlotVisibility(0);
    }
    
    /**
     * Extends swipe slots dynamically as the user swipes further.
     * Creates new slots on the left or right as needed.
     * 
     * @param translateX Current swipe translateX offset
     */
    private extendSwipeSlotsIfNeeded(translateX: number): void {
        const container = this.containerRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const containerWidth = container.clientWidth;
        const translate = this.zoomPanService.translate();
        const totalUnits = this.swipeAllUnits.length;
        const effectiveVisible = this.effectiveVisiblePageCount();
        
        if (totalUnits === 0) return;
        
        // Calculate visible area bounds in content coordinates (accounting for swipe offset)
        const visibleLeft = -translate.x - translateX;
        const visibleRight = visibleLeft + containerWidth;
        
        // Calculate page dimensions
        const scaledPageWidth = PAGE_WIDTH * scale;
        const pageStep = PAGE_WIDTH + PAGE_GAP;
        const scaledPageStep = pageStep * scale;
        const baseLeft = (this.swipeBasePositions[0] ?? 0) * scale;
        
        // Calculate which offsets are currently visible
        const leftmostVisibleOffset = Math.floor((visibleLeft - baseLeft) / scaledPageStep);
        const rightmostVisibleOffset = Math.ceil((visibleRight - baseLeft - scaledPageWidth) / scaledPageStep);
        
        // Add 1 buffer on each side for smooth scrolling
        const neededLeftOffset = leftmostVisibleOffset - 1;
        const neededRightOffset = rightmostVisibleOffset + 1;
        
        // Calculate max range we can extend (limited by total units to avoid overlap)
        const maxRange = totalUnits - 1;
        
        // Check if we've already created all possible slots
        const currentRange = this.swipeRightmostOffset - this.swipeLeftmostOffset;
        if (currentRange >= maxRange) {
            return; // Already have all units as slots
        }
        
        const content = this.contentRef().nativeElement;
        const centerSlotStartOffset = 0;
        const centerSlotEndOffset = effectiveVisible - 1;
        
        // Extend left if needed
        while (neededLeftOffset < this.swipeLeftmostOffset && currentRange < maxRange) {
            const newOffset = this.swipeLeftmostOffset - 1;
            
            // Check if this would create a duplicate (wrap around)
            const newUnitIndex = (this.baseDisplayStartIndex + newOffset + totalUnits) % totalUnits;
            if (this.swipeSlotUnitAssignments.includes(newUnitIndex)) {
                break; // Would create duplicate, stop extending
            }
            
            this.swipeLeftmostOffset = newOffset;
            
            // Create new slot at the beginning
            const slotWrapper = this.createSwipeSlot(newOffset, newUnitIndex, scale, centerSlotStartOffset, centerSlotEndOffset);
            content.appendChild(slotWrapper);
            
            // Insert at beginning of arrays
            this.swipeSlots.unshift(slotWrapper);
            this.swipeSlotUnitAssignments.unshift(newUnitIndex);
            this.swipeTotalSlots++;
            
            // Update slot indices
            for (let i = 1; i < this.swipeSlots.length; i++) {
                this.swipeSlots[i].dataset['slotIndex'] = String(i);
            }
            
            // Load unit lazily
            const unit = this.swipeAllUnits[newUnitIndex];
            if (unit && !this.swipeUnitsToLoad.includes(unit)) {
                this.swipeUnitsToLoad.push(unit);
                unit.load(); // Fire and forget - will be available when needed
            }
        }
        
        // Extend right if needed
        while (neededRightOffset > this.swipeRightmostOffset && currentRange < maxRange) {
            const newOffset = this.swipeRightmostOffset + 1;
            
            // Check if this would create a duplicate (wrap around)
            const newUnitIndex = (this.baseDisplayStartIndex + newOffset + totalUnits) % totalUnits;
            if (this.swipeSlotUnitAssignments.includes(newUnitIndex)) {
                break; // Would create duplicate, stop extending
            }
            
            this.swipeRightmostOffset = newOffset;
            
            // Create new slot at the end
            const slotWrapper = this.createSwipeSlot(newOffset, newUnitIndex, scale, centerSlotStartOffset, centerSlotEndOffset);
            content.appendChild(slotWrapper);
            
            // Append to arrays
            this.swipeSlots.push(slotWrapper);
            this.swipeSlotUnitAssignments.push(newUnitIndex);
            this.swipeTotalSlots++;
            
            // Load unit lazily
            const unit = this.swipeAllUnits[newUnitIndex];
            if (unit && !this.swipeUnitsToLoad.includes(unit)) {
                this.swipeUnitsToLoad.push(unit);
                unit.load(); // Fire and forget - will be available when needed
            }
        }
        
        // Trim slots that are too far out of view (keep 2 buffer slots beyond visible)
        const trimBuffer = 2;
        const trimLeftBoundary = leftmostVisibleOffset - trimBuffer;
        const trimRightBoundary = rightmostVisibleOffset + trimBuffer;
        
        // Trim from left (slots that are too far left)
        while (this.swipeLeftmostOffset < trimLeftBoundary && this.swipeSlots.length > effectiveVisible + 2) {
            const slotToRemove = this.swipeSlots.shift();
            if (slotToRemove) {
                if (slotToRemove.parentElement === content) {
                    content.removeChild(slotToRemove);
                }
                slotToRemove.innerHTML = '';
            }
            this.swipeSlotUnitAssignments.shift();
            this.swipeLeftmostOffset++;
            this.swipeTotalSlots--;
        }
        
        // Trim from right (slots that are too far right)
        while (this.swipeRightmostOffset > trimRightBoundary && this.swipeSlots.length > effectiveVisible + 2) {
            const slotToRemove = this.swipeSlots.pop();
            if (slotToRemove) {
                if (slotToRemove.parentElement === content) {
                    content.removeChild(slotToRemove);
                }
                slotToRemove.innerHTML = '';
            }
            this.swipeSlotUnitAssignments.pop();
            this.swipeRightmostOffset--;
            this.swipeTotalSlots--;
        }
    }
    
    /**
     * Creates a single swipe slot element.
     */
    private createSwipeSlot(offset: number, unitIndex: number, scale: number, centerStart: number, centerEnd: number): HTMLDivElement {
        const baseLeft = this.swipeBasePositions[0] ?? 0;
        const pageStep = PAGE_WIDTH + PAGE_GAP;
        
        const slotWrapper = this.renderer.createElement('div') as HTMLDivElement;
        this.renderer.addClass(slotWrapper, 'page-wrapper');
        slotWrapper.dataset['slotOffset'] = String(offset);
        
        // Add neighbor-page class to all non-center slots
        const isNeighborSlot = offset < centerStart || offset > centerEnd;
        if (isNeighborSlot) {
            this.renderer.addClass(slotWrapper, 'neighbor-page');
        }
        
        const unscaledLeft = baseLeft + offset * pageStep;
        slotWrapper.dataset['originalLeft'] = String(unscaledLeft);
        slotWrapper.style.width = `${PAGE_WIDTH * scale}px`;
        slotWrapper.style.height = `${PAGE_HEIGHT * scale}px`;
        slotWrapper.style.position = 'absolute';
        slotWrapper.style.left = `${unscaledLeft * scale}px`;
        slotWrapper.style.top = '0';
        
        return slotWrapper;
    }
    
    /**
     * Updates which slots have SVGs attached based on current visibility.
     * An SVG can only be in one place at a time, so we need to:
     * 1. Determine which slots are currently visible (even partially)
     * 2. For each visible slot, attach its assigned unit's SVG if not already attached elsewhere
     * 3. Remove SVGs from slots that are no longer visible (unless addOnly=true)
     * 4. When the same unit is assigned to multiple visible slots, prioritize based on swipe direction
     * 
     * @param translateX The current swipe translateX offset
     * @param options.addOnly When true, only adds SVGs without removing existing ones. Used before
     *                        animation to pre-attach incoming pages without disrupting outgoing ones.
     */
    private updateSwipeSlotVisibility(translateX: number, options: { addOnly?: boolean } = {}): void {
        const addOnly = options.addOnly ?? false;
        const container = this.containerRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const containerWidth = container.clientWidth;
        const translate = this.zoomPanService.translate();
        
        // Update swipe direction based on movement (skip in addOnly mode to preserve direction)
        if (!addOnly) {
            if (translateX > this.lastSwipeTranslateX + 1) {
                this.swipeDirection = 'right'; // Swiping right (content moves right, showing left pages)
            } else if (translateX < this.lastSwipeTranslateX - 1) {
                this.swipeDirection = 'left'; // Swiping left (content moves left, showing right pages)
            }
            this.lastSwipeTranslateX = translateX;
        }
        
        // Calculate the visible area in content coordinates (accounting for transform)
        // The content is transformed by translateX (swipe) and the base translate
        const totalTranslateX = translate.x + translateX;
        
        // Visible range in scaled coordinates
        const visibleLeft = -totalTranslateX;
        const visibleRight = visibleLeft + containerWidth;
        
        const allUnits = this.forceUnits();
        const visiblePages = this.effectiveVisiblePageCount();
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
        // Skip this pass entirely in addOnly mode - we don't want to remove any SVGs
        if (!addOnly) {
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
        }
        
        // Third pass: attach SVGs to visible slots that need them
        // In addOnly mode, we use a simpler approach - just attach if slot is empty and SVG is free
        const displayedUnitIds = new Set<string>();
        
        // In single-page mode, determine which slot is most visible for 'fixed' overlay mode
        // Calculate visibility percentage for each winning slot (skip in addOnly mode)
        let mostVisibleSlotIdx: number | null = null;
        if (!addOnly && visiblePages === 1) {
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
        
        // In addOnly mode, iterate visible slots directly instead of winning slots
        // This is simpler and avoids moving SVGs that are already attached elsewhere
        const slotsToProcess = addOnly 
            ? visibleSlotIndices.map(slotIdx => [this.swipeSlotUnitAssignments[slotIdx], slotIdx] as [number | null, number])
            : Array.from(winningSlotForUnit.entries());
        
        for (const [unitIndex, slotIdx] of slotsToProcess) {
            if (unitIndex === null) continue;
            
            const slot = this.swipeSlots[slotIdx];
            const unit = allUnits[unitIndex] as CBTForceUnit;
            if (!unit) continue;
            
            const svg = unit.svg();
            if (!svg) continue;
            
            // Check if this slot already has an SVG
            const existingSvg = slot.querySelector('svg');
            if (existingSvg) {
                // In addOnly mode, skip if slot already has any SVG
                if (addOnly) continue;
                
                // In normal mode, check if it's the correct SVG
                if (existingSvg === svg) {
                    displayedUnitIds.add(unit.id);
                    // Already in place, but still need to update overlay mode in single-page mode
                    if (!this.readOnly() && visiblePages === 1) {
                        const overlayMode = slotIdx === mostVisibleSlotIdx ? 'fixed' : 'page';
                        this.getOrCreateInteractionOverlay(slot, unit, overlayMode);
                    }
                    continue;
                }
            }
            
            // Check if this unit's SVG is attached elsewhere
            // In addOnly mode, skip this unit - we can't move it without disrupting outgoing page
            // In normal mode, this shouldn't happen after cleanup
            if (svg.parentElement && svg.parentElement !== slot) {
                if (addOnly) continue;
                if (unitToSlotMap.has(unitIndex)) continue;
            }
            
            displayedUnitIds.add(unit.id);
            
            // Update slot data attributes
            slot.dataset['unitId'] = unit.id;
            slot.dataset['unitIndex'] = String(unitIndex);
            
            // Skip class updates in addOnly mode (we're just pre-attaching)
            if (!addOnly) {
                // Check if this is a neighbor slot (non-center)
                const isNeighborSlot = slotIdx < centerSlotStart || slotIdx > centerSlotEnd;
                
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
            }
            
            // Apply scale to SVG and attach
            svg.style.transform = `scale(${scale})`;
            svg.style.transformOrigin = 'top left';
            slot.appendChild(svg);
            unitToSlotMap.set(unitIndex, slotIdx);
            
            // Set up interactions if needed
            if (!this.readOnly()) {
                this.getOrCreateInteractionService(unit, svg);
                this.getOrCreateCanvasOverlay(slot, unit);
                // In addOnly mode, use 'page' mode (we're pre-attaching)
                // In normal mode with single-page, use 'fixed' for most visible slot
                const overlayMode = !addOnly && visiblePages === 1 && slotIdx === mostVisibleSlotIdx ? 'fixed' : 'page';
                this.getOrCreateInteractionOverlay(slot, unit, overlayMode);
            }
        }
        
        // Update displayed units list and cleanup (skip in addOnly mode)
        if (!addOnly) {
            const uniqueUnitIndices = new Set(winningSlotForUnit.keys());
            this.displayedUnits = Array.from(uniqueUnitIndices)
                .map(idx => allUnits[idx] as CBTForceUnit)
                .filter(u => u);

            // Keep reactive ordering in sync (for marker ordering & picker state)
            this.displayedUnitIds.set(this.displayedUnits.map(u => u.id));
            
            // Clean up unused overlays (keep only displayed ones)
            this.cleanupUnusedCanvasOverlays(displayedUnitIds);
            this.cleanupUnusedInteractionOverlays(displayedUnitIds);
        }
        
        // Apply fluff image visibility to newly attached SVGs (neighbor pages during swipe)
        this.setFluffImageVisibility();
    }

    /**
     * Cleans up swipe-specific state after swipe ends.
     */
    private cleanupSwipeState(): void {
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = '';
        swipeWrapper.style.transform = '';
        this.isSwiping = false;
        this.swipeAnimationCallback = null;
        this.pendingPagesToMove = 0;
        
        // Clear swipe slot elements (they'll be recreated by displayUnit)
        const content = this.contentRef().nativeElement;
        this.swipeSlots.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
            el.innerHTML = '';
        });
        this.swipeSlots = [];
        this.swipeSlotUnitAssignments = [];
        this.swipeTotalSlots = 0;
        this.swipeBasePositions = [];
        this.swipeUnitsToLoad = [];
        this.swipeDirection = 'none';
        this.lastSwipeTranslateX = 0;
        
        // Clear lazy swipe state
        this.swipeLeftmostOffset = 0;
        this.swipeRightmostOffset = 0;
        this.swipeAllUnits = [];
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
                    newMarkers.set(unitId, { data: markerData, visible });
                    return newMarkers;
                });
            });
        }, { injector: this.injector });
        
        this.interactionServiceEffectRefs.set(unitId, effectRef);
        this.interactionServices.set(unitId, service);
        
        return service;
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
        componentRef.setInput('force', this.force());
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
        const previousVisibleCount = this.effectiveVisiblePageCount();
        this.updateDimensions();
        this.zoomPanService.handleResize();

        // If effective visible page count changed, re-render pages (which includes shadow pages)
        const newVisibleCount = this.effectiveVisiblePageCount();
        if (newVisibleCount !== previousVisibleCount && this.unit()) {
            // Close interaction overlays before re-rendering
            this.closeInteractionOverlays();
            this.displayUnit();
        } else if (this.initialRenderComplete) {
            // Only update shadow pages if initial render is complete
            // This prevents creating shadows with wrong scale during initialization
            this.renderShadowPages();
        }
    }

    // ========== Keyboard Navigation ==========

    onWindowKeyDown(event: KeyboardEvent): void {
        // Ignore if typing in an input/textarea/contentEditable
        const target = event.target as HTMLElement | null;
        if (target) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
        }
        // Ignore with modifiers
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        if (event.key === 'ArrowLeft') {
            this.handleArrowNavigation('left');
            event.preventDefault();
        } else if (event.key === 'ArrowRight') {
            this.handleArrowNavigation('right');
            event.preventDefault();
        }
    }

    /**
     * Handle arrow key navigation.
     * First tries to move selection within visible pages.
     * Only navigates to new pages when selection is at the boundary.
     * Supports looping from first to last page and vice versa.
     */
    private handleArrowNavigation(direction: 'left' | 'right'): void {
        if (this.isSwiping) return;
        
        const currentUnit = this.unit();
        if (!currentUnit) return;
        
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        if (totalUnits === 0) return;
        
        // Find the index of the current selected unit within displayed units
        const selectedIndex = this.displayedUnits.findIndex(u => u.id === currentUnit.id);
        
        if (direction === 'left') {
            // Can we move selection left within visible pages?
            if (selectedIndex > 0) {
                // Select the previous visible unit
                this.forceBuilder.selectUnit(this.displayedUnits[selectedIndex - 1]);
            } else if (this.hasPrev()) {
                // At left boundary with more pages before, navigate to previous page
                this.navigateByDirection('left');
            } else if (totalUnits > this.effectiveVisiblePageCount()) {
                // At left boundary and at the start of the list, loop to the end
                this.navigateByDirection('left');
            }
        } else {
            // Can we move selection right within visible pages?
            if (selectedIndex >= 0 && selectedIndex < this.displayedUnits.length - 1) {
                // Select the next visible unit
                this.forceBuilder.selectUnit(this.displayedUnits[selectedIndex + 1]);
            } else if (this.hasNext()) {
                // At right boundary with more pages after, navigate to next page
                this.navigateByDirection('right');
            } else if (totalUnits > this.effectiveVisiblePageCount()) {
                // At right boundary and at the end of the list, loop to the start
                this.navigateByDirection('right');
            }
        }
    }

    /**
     * Navigate one page in the given direction with animation.
     * Used by keyboard navigation and shadow page clicks.
     * Supports looping from first to last page and vice versa.
     */
    navigateByDirection(direction: 'left' | 'right'): void {
        if (this.isSwiping) return;
        
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        if (totalUnits === 0) return;
        
        const effectiveVisible = this.effectiveVisiblePageCount();
        // Don't navigate if all units fit on screen
        if (totalUnits <= effectiveVisible) return;
        
        const currentStartIndex = this.viewStartIndex();
        const pagesToMove = direction === 'right' ? 1 : -1;
        
        // Calculate target unit index with wrap-around (the one that will slide in)
        const targetIndex = direction === 'left' 
            ? (currentStartIndex - 1 + totalUnits) % totalUnits
            : (currentStartIndex + effectiveVisible) % totalUnits;
        const targetUnit = allUnits[targetIndex] as CBTForceUnit;
        if (!targetUnit) return;
        
        // Check if there's an existing shadow page we can use
        const existingShadow = this.shadowPageElements.find(
            el => el.dataset['shadowDirection'] === direction
        );
        
        if (existingShadow) {
            // Use the existing shadow page navigation
            this.navigateToShadowPage(targetUnit, targetIndex, existingShadow);
            return;
        }
        
        // No shadow page exists - create temporary one and animate
        this.closeInteractionOverlays();
        
        // Load target unit first
        targetUnit.load().then(() => {
            const svg = targetUnit.svg();
            if (!svg) {
                // Fallback to instant navigation if no SVG
                this.viewStartIndex.set(currentStartIndex + pagesToMove);
                this.displayUnit();
                return;
            }
            
            const scale = this.zoomPanService.scale();
            const scaledPageStep = (PAGE_WIDTH + PAGE_GAP) * scale;
            const content = this.contentRef().nativeElement;
            
            // Get position for the incoming page
            const displayedPositions = this.zoomPanService.getPagePositions(effectiveVisible);
            const basePosition = direction === 'left'
                ? (displayedPositions[0] ?? 0) * scale - scaledPageStep
                : ((displayedPositions[effectiveVisible - 1] ?? 0) * scale) + scaledPageStep;
            
            // Create temporary page wrapper with cloned SVG
            const tempWrapper = this.renderer.createElement('div') as HTMLDivElement;
            this.renderer.addClass(tempWrapper, 'page-wrapper');
            this.renderer.addClass(tempWrapper, 'shadow-page');
            tempWrapper.dataset['unitId'] = targetUnit.id;
            tempWrapper.dataset['unitIndex'] = String(targetIndex);
            tempWrapper.dataset['shadowDirection'] = direction;
            
            const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
            clonedSvg.style.transform = `scale(${scale})`;
            clonedSvg.style.transformOrigin = 'top left';
            clonedSvg.style.pointerEvents = 'none';
            
            tempWrapper.style.width = `${PAGE_WIDTH * scale}px`;
            tempWrapper.style.height = `${PAGE_HEIGHT * scale}px`;
            tempWrapper.style.position = 'absolute';
            tempWrapper.style.left = `${basePosition}px`;
            tempWrapper.style.top = '0';
            tempWrapper.appendChild(clonedSvg);
            
            // Apply fluff visibility
            const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
            this.applyFluffImageVisibilityToSvg(clonedSvg, centerContent === 'fluffImage');
            
            content.appendChild(tempWrapper);
            this.shadowPageElements.push(tempWrapper);
            
            // Now navigate using the shadow page mechanism
            this.navigateToShadowPage(targetUnit, targetIndex, tempWrapper);
        });
    }

    // ========== Unit Display ==========

    private displayUnit(options: { fromSwipe?: boolean } = {}): void {
        const currentUnit = this.unit();
        const content = this.contentRef().nativeElement;
        const fromSwipe = options.fromSwipe ?? false;

        // Close any open interaction overlays when recreating pages
        this.closeInteractionOverlays();
        
        // Note: Shadow pages are cleaned up smartly in renderPages() to avoid flicker

        // Clear existing page DOM elements
        this.pageElements.forEach(el => {
            if (el.parentElement === content) {
                content.removeChild(el);
            }
            el.innerHTML = '';
        });
        this.pageElements = [];
        this.displayedUnits = [];
        this.displayedUnitIds.set([]);

        this.loadError.set(null);
        this.currentSvg.set(null);

        if (!currentUnit) return;

        // Guard: ensure the unit is a CBT unit with an svg signal (AS units don't have one)
        if (typeof currentUnit.svg !== 'function') return;

        const svg = currentUnit.svg();
        if (!svg) {
            this.loadError.set('Loading record sheet...');
            return;
        }

        // Determine how many pages to display
        const visiblePages = this.effectiveVisiblePageCount();
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        
        // Use viewStartIndex for display positioning (independent of selected unit)
        let startIndex = this.viewStartIndex();

        // When all units fit on screen, reset viewStartIndex to 0
        // This ensures proper display when transitioning to "all fit" mode
        if (totalUnits <= visiblePages && startIndex !== 0) {
            this.viewStartIndex.set(0);
            startIndex = 0;
        }

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

        // Keep reactive ordering in sync (for marker ordering & picker state)
        this.displayedUnitIds.set(this.displayedUnits.map(u => u.id));

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

    /**
     * Update currently displayed pages without clearing/recreating wrappers.
     * Used to avoid flicker when force units are reordered and the selected unit remains visible.
     *
     * Preserves the selected unit's existing wrapper/SVG and updates the other slots in-place.
     */
    private updateDisplayedPagesInPlace(options: { preserveSelectedUnitId: string } ): void {
        const content = this.contentRef().nativeElement;
        const preserveSelectedUnitId = options.preserveSelectedUnitId;

        if (this.pageElements.length === 0) {
            this.displayUnit();
            return;
        }

        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        const visiblePages = this.effectiveVisiblePageCount();
        let startIndex = this.viewStartIndex();

        if (totalUnits === 0) {
            this.clearPages();
            return;
        }

        // When all units fit on screen, reset viewStartIndex to 0
        // This ensures proper display when transitioning to "all fit" mode
        if (totalUnits <= visiblePages && startIndex !== 0) {
            this.viewStartIndex.set(0);
            startIndex = 0;
        }

        // Compute expected units for each visible slot (same logic as displayUnit)
        const expectedUnits: CBTForceUnit[] = [];
        if (totalUnits <= visiblePages) {
            for (const unit of allUnits) {
                expectedUnits.push(unit as CBTForceUnit);
            }
        } else {
            for (let i = 0; i < visiblePages; i++) {
                const unitIndex = (startIndex + i) % totalUnits;
                const unitToDisplay = allUnits[unitIndex] as CBTForceUnit;
                if (unitToDisplay && !expectedUnits.includes(unitToDisplay)) {
                    expectedUnits.push(unitToDisplay);
                }
            }
        }

        // If wrapper count doesn't match, fall back to full render
        if (expectedUnits.length !== this.pageElements.length) {
            this.displayUnit();
            return;
        }

        const preservedSlotIndex = this.pageElements.findIndex(el => el.dataset['unitId'] === preserveSelectedUnitId);

        // Capture version to avoid stale async updates
        const currentVersion = ++this.displayVersion;
        const loadPromises = expectedUnits.map(u => u.load());

        Promise.all(loadPromises).then(() => {
            if (this.displayVersion !== currentVersion) {
                return;
            }

            const displayedUnitIds = new Set<string>();

            for (let slotIndex = 0; slotIndex < expectedUnits.length; slotIndex++) {
                const unit = expectedUnits[slotIndex];
                const wrapper = this.pageElements[slotIndex];
                if (!unit || !wrapper) continue;

                displayedUnitIds.add(unit.id);

                // Preserve the selected unit's existing wrapper/SVG to prevent flicker.
                if (slotIndex === preservedSlotIndex && wrapper.dataset['unitId'] === preserveSelectedUnitId) {
                    continue;
                }

                const svg = unit.svg();
                if (!svg) {
                    continue;
                }

                // Clear any stale per-SVG scaling (e.g., from swipe slot assignment).
                // Normal rendering relies on PageViewerZoomPanService to apply scaling.
                svg.style.transform = '';
                svg.style.transformOrigin = '';

                // Update wrapper metadata
                wrapper.dataset['unitId'] = unit.id;

                // Replace the root SVG in this wrapper (without disturbing overlays)
                const existingSvg = wrapper.querySelector('svg');
                if (existingSvg && existingSvg !== svg && existingSvg.parentElement === wrapper) {
                    wrapper.removeChild(existingSvg);
                }

                // Ensure SVG is attached here and sits under overlays
                if (svg.parentElement !== wrapper) {
                    wrapper.insertBefore(svg, wrapper.firstChild);
                }

                // Maintain currentSvg semantics (first slot)
                if (slotIndex === 0) {
                    this.currentSvg.set(svg);
                }

                if (!this.readOnly()) {
                    this.getOrCreateInteractionService(unit, svg);
                    this.getOrCreateCanvasOverlay(wrapper, unit);
                    const overlayMode = this.effectiveVisiblePageCount() === 1 ? 'fixed' : 'page';
                    this.getOrCreateInteractionOverlay(wrapper, unit, overlayMode);
                }
            }

            // Replace displayed units (model) without rebuilding wrappers
            this.displayedUnits = expectedUnits;
            this.displayedUnitIds.set(expectedUnits.map(u => u.id));

            // Update selected highlight (classes) in case unit IDs moved
            this.updateSelectedPageHighlight();

            // Clean up services/overlays for units no longer displayed
            this.cleanupUnusedInteractionServices(displayedUnitIds);
            this.cleanupUnusedCanvasOverlays(displayedUnitIds);
            this.cleanupUnusedInteractionOverlays(displayedUnitIds);

            // Keep zoom-pan centering aware of actual page count (unchanged)
            this.zoomPanService.setDisplayedPages(this.pageElements.length);

            // Ensure any newly attached SVGs receive the current transform.
            // Without this, swapped-in SVGs can render at the wrong scale after reorder.
            this.zoomPanService.applyCurrentTransform();

            // Apply fluff image visibility setting to any newly attached SVGs
            this.setFluffImageVisibility();
            
            // Re-render shadow pages
            this.renderShadowPages();
        });
    }

    private renderPages(options: { fromSwipe?: boolean } = {}): void {
        const content = this.contentRef().nativeElement;
        const fromSwipe = options.fromSwipe ?? false;

        // Get page positions based on spaceEvenly setting
        const positions = this.zoomPanService.getPagePositions(this.displayedUnits.length);

        // Smart cleanup: remove only shadows that will overlap with active sheets
        // This prevents the "blink" effect when transitioning
        const activeUnitIds = new Set(this.displayedUnits.map(u => u.id));
        this.shadowPageElements = this.shadowPageElements.filter(el => {
            const shadowUnitId = el.dataset['unitId'];
            // Remove shadows whose unit is now an active sheet
            if (shadowUnitId && activeUnitIds.has(shadowUnitId)) {
                if (el.parentElement === content) {
                    content.removeChild(el);
                }
                return false;
            }
            return true;
        });

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
                const multipleVisible = this.effectiveVisiblePageCount() > 1;
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
                    const overlayMode = this.effectiveVisiblePageCount() === 1 ? 'fixed' : 'page';
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
        
        // Render shadow pages if enabled (smart update - reuses existing shadows)
        this.renderShadowPages();
        
        // Mark initial render complete - allows resize handler to update shadows
        this.initialRenderComplete = true;
    }

    /**
     * Renders shadow pages - faded clones of neighbor pages positioned at the edges
     * of the currently visible pages. These provide a visual hint that there are more
     * pages to swipe to, and clicking them triggers navigation to that page.
     * Only shown when at minimum zoom (when swiping is possible).
     * 
     * This method is smart about reusing existing shadow elements to avoid flicker:
     * - Keeps existing shadows that should remain in the new view
     * - Only removes shadows that are no longer needed
     * - Only creates new shadows for positions not already covered
     */
    private async renderShadowPages(): Promise<void> {
        const content = this.contentRef().nativeElement;
        
        // Only render if shadowPages is enabled
        if (!this.shadowPages()) {
            this.clearShadowPages();
            return;
        }
        
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        
        // Can't have shadow pages if there are no extra units to show
        const effectiveVisible = this.effectiveVisiblePageCount();
        if (totalUnits <= effectiveVisible) {
            this.clearShadowPages();
            return;
        }
        
        const scale = this.zoomPanService.scale();
        const startIndex = this.viewStartIndex();
        const scaledPageStep = (PAGE_WIDTH + PAGE_GAP) * scale;
        
        // Get the positions of the currently displayed pages (these are unscaled)
        const displayedPositions = this.zoomPanService.getPagePositions(effectiveVisible);
        
        // Get container dimensions and translate to calculate visible area
        const container = this.containerRef().nativeElement;
        const containerWidth = container.clientWidth;
        const translate = this.zoomPanService.translate();
        const scaledPageWidth = PAGE_WIDTH * scale;
        
        // Calculate visible area bounds in content coordinates
        const visibleLeft = -translate.x;
        const visibleRight = visibleLeft + containerWidth;
        
        // Calculate active pages area bounds (in scaled coordinates)
        const firstPageScaledLeft = (displayedPositions[0] ?? 0) * scale;
        const lastPageUnscaledLeft = displayedPositions[effectiveVisible - 1] ?? ((effectiveVisible - 1) * (PAGE_WIDTH + PAGE_GAP));
        const lastPageScaledRight = lastPageUnscaledLeft * scale + scaledPageWidth;
        
        // Build list of desired shadow configurations
        const desiredShadows: { unitIndex: number; scaledLeftPosition: number; direction: 'left' | 'right' }[] = [];
        
        // Fill left side with shadow pages
        let leftPosition = firstPageScaledLeft - scaledPageStep;
        let leftUnitOffset = 1;
        while (leftPosition + scaledPageWidth > visibleLeft && leftUnitOffset < totalUnits) {
            const unitIndex = (startIndex - leftUnitOffset + totalUnits) % totalUnits;
            desiredShadows.push({ unitIndex, scaledLeftPosition: leftPosition, direction: 'left' });
            leftPosition -= scaledPageStep;
            leftUnitOffset++;
        }
        
        // Fill right side with shadow pages
        let rightPosition = lastPageScaledRight + PAGE_GAP * scale;
        let rightUnitOffset = effectiveVisible;
        while (rightPosition < visibleRight && rightUnitOffset < totalUnits) {
            const unitIndex = (startIndex + rightUnitOffset) % totalUnits;
            desiredShadows.push({ unitIndex, scaledLeftPosition: rightPosition, direction: 'right' });
            rightPosition += scaledPageStep;
            rightUnitOffset++;
        }
        
        // Build a set of desired unit indices for quick lookup
        const desiredUnitIndices = new Set(desiredShadows.map(s => s.unitIndex));
        
        // Also exclude units that are now active sheets
        const activeUnitIds = new Set(this.displayedUnits.map(u => u.id));
        
        // Smart cleanup: keep shadows that match desired positions, remove others
        const shadowsToKeep: HTMLDivElement[] = [];
        const keptUnitIndices = new Set<number>();
        
        for (const el of this.shadowPageElements) {
            const shadowUnitIndex = parseInt(el.dataset['unitIndex'] ?? '-1', 10);
            const shadowUnitId = el.dataset['unitId'];
            
            // Remove if this unit is now an active sheet
            if (shadowUnitId && activeUnitIds.has(shadowUnitId)) {
                if (el.parentElement === content) {
                    content.removeChild(el);
                }
                continue;
            }
            
            // Check if this shadow should still exist
            const matchingDesired = desiredShadows.find(d => d.unitIndex === shadowUnitIndex);
            if (matchingDesired && !keptUnitIndices.has(shadowUnitIndex)) {
                // Update position in case it changed
                el.style.left = `${matchingDesired.scaledLeftPosition}px`;
                el.style.width = `${PAGE_WIDTH * scale}px`;
                el.style.height = `${PAGE_HEIGHT * scale}px`;
                el.dataset['originalLeft'] = String(matchingDesired.scaledLeftPosition / scale);
                el.dataset['shadowDirection'] = matchingDesired.direction;
                
                // Update SVG scale if needed
                const svg = el.querySelector('svg');
                if (svg) {
                    (svg as SVGSVGElement).style.transform = `scale(${scale})`;
                }
                
                shadowsToKeep.push(el);
                keptUnitIndices.add(shadowUnitIndex);
            } else {
                // Remove shadow that's no longer needed
                if (el.parentElement === content) {
                    content.removeChild(el);
                }
            }
        }
        
        this.shadowPageElements = shadowsToKeep;
        
        // Determine which shadows need to be created (not already covered)
        const shadowsToCreate = desiredShadows.filter(s => !keptUnitIndices.has(s.unitIndex));
        
        // If no new shadows needed, just apply fluff visibility and exit
        if (shadowsToCreate.length === 0) {
            this.setFluffImageVisibilityForShadows();
            return;
        }
        
        // Pre-load shadow units to ensure SVGs are available
        const shadowUnits = shadowsToCreate.map(s => allUnits[s.unitIndex] as CBTForceUnit).filter(u => u);
        await Promise.all(shadowUnits.map(u => u.load()));
        
        const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
        const showFluff = centerContent === 'fluffImage';
        
        // Create new shadow page elements using the unified helper
        for (const shadow of shadowsToCreate) {
            const unit = allUnits[shadow.unitIndex] as CBTForceUnit;
            if (!unit) continue;
            
            this.createShadowPageElement(
                unit,
                shadow.unitIndex,
                shadow.scaledLeftPosition,
                shadow.direction,
                scale,
                showFluff
            );
        }
    }
    
    /**
     * Navigates to a shadow page by animating to it.
     * First replaces the shadow with the real SVG, then animates the transition.
     * 
     * @param unit The unit to navigate to
     * @param targetIndex The index of the target unit in the force
     * @param clickedShadow The actual shadow element that was clicked (passed directly to avoid
     *                      incorrect lookups when the same unit appears on multiple sides)
     */
    private navigateToShadowPage(unit: CBTForceUnit, targetIndex: number, clickedShadow: HTMLDivElement): void {
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        const currentStartIndex = this.viewStartIndex();
        const effectiveVisible = this.effectiveVisiblePageCount();
        
        // Cancel any pending animation callback from a previous navigation
        if (this.swipeAnimationCallback) {
            const swipeWrapper = this.swipeWrapperRef().nativeElement;
            swipeWrapper.removeEventListener('transitionend', this.swipeAnimationCallback);
            this.swipeAnimationCallback = null;
            swipeWrapper.style.transition = 'none';
            swipeWrapper.style.transform = '';
        }
        
        // Remove any stale 'leaving-page' classes from previous interrupted animations
        this.pageElements.forEach(el => this.renderer.removeClass(el, 'leaving-page'));
        
        const direction = clickedShadow.dataset['shadowDirection'];
        
        // Calculate how many pages to move to make the clicked shadow become the center/active page
        // We need to move it into the active area (centered within effectiveVisible pages)
        let pagesToMove: number;
        if (direction === 'right') {
            // Shadow is to the right, need to move forward
            // Calculate distance from end of visible area to target
            const endIndex = (currentStartIndex + effectiveVisible - 1) % totalUnits;
            if (targetIndex > endIndex) {
                pagesToMove = targetIndex - endIndex;
            } else {
                // Wrapped around
                pagesToMove = (totalUnits - endIndex) + targetIndex;
            }
        } else {
            // Shadow is to the left, need to move backward
            // Calculate distance from start of visible area to target
            if (targetIndex < currentStartIndex) {
                pagesToMove = -(currentStartIndex - targetIndex);
            } else {
                // Wrapped around
                pagesToMove = -(currentStartIndex + (totalUnits - targetIndex));
            }
        }
        
        // Replace the cloned SVG with the real SVG in the shadow wrapper
        // This prevents the "black flash" when the shadow is cleared
        const realSvg = unit.svg();
        const scale = this.zoomPanService.scale();
        const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
        const showFluff = centerContent === 'fluffImage';
        
        if (realSvg) {
            // Remove the cloned SVG
            const clonedSvg = clickedShadow.querySelector('svg');
            if (clonedSvg) {
                clickedShadow.removeChild(clonedSvg);
            }
            
            // Apply scale to the real SVG (matching shadow page setup)
            realSvg.style.transform = `scale(${scale})`;
            realSvg.style.transformOrigin = 'top left';
            
            // Add the real SVG to the shadow wrapper
            clickedShadow.appendChild(realSvg);
            
            // Apply fluff image visibility to the real SVG
            this.applyFluffImageVisibilityToSvg(realSvg, showFluff);
            
            // Remove the shadow styling so it looks like a real page
            this.renderer.removeClass(clickedShadow, 'shadow-page');
        }
        
        // Keep all shadow pages during animation - they will be cleared after animation ends
        // Just mark the pages that will be leaving (sliding out of view)
        // For each page in the direction we're moving away from, add leaving-page class
        
        // Add shadow styling to the active page(s) that will be leaving (sliding out)
        // Right shadow clicked: leftmost active pages are leaving
        // Left shadow clicked: rightmost active pages are leaving
        const leavingPageIndex = direction === 'right' ? 0 : this.pageElements.length - 1;
        const leavingPage = this.pageElements[leavingPageIndex];
        if (leavingPage) {
            this.renderer.addClass(leavingPage, 'leaving-page');
        }
        
        // Create incoming shadow pages that will slide into view during animation
        // These are the pages beyond the clicked shadow in the direction of movement
        if (direction) {
            this.createIncomingShadowPages(targetIndex, direction, pagesToMove, scale, showFluff, allUnits as CBTForceUnit[]);
        }
        
        // Animate the swipe
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const scaledPageWidth = PAGE_WIDTH * scale + PAGE_GAP * scale;
        const targetOffset = -pagesToMove * scaledPageWidth;
        
        // Store state for animation
        this.swipeVersion++;
        this.pendingPagesToMove = pagesToMove;
        this.baseDisplayStartIndex = currentStartIndex;
        
        // Animate to target position
        swipeWrapper.style.transition = 'transform 0.3s ease-out';
        swipeWrapper.style.transform = `translateX(${targetOffset}px)`;
        
        const animationVersion = this.swipeVersion;
        
        const onAnimationEnd = () => {
            swipeWrapper.removeEventListener('transitionend', onAnimationEnd);
            this.swipeAnimationCallback = null;
            this.pendingPagesToMove = 0;
            
            if (this.swipeVersion !== animationVersion) {
                return;
            }
            
            // Update view start index
            const newStartIndex = ((currentStartIndex + pagesToMove) % totalUnits + totalUnits) % totalUnits;
            this.viewStartIndex.set(newStartIndex);
            
            // Reset transform
            swipeWrapper.style.transition = 'none';
            swipeWrapper.style.transform = '';
            
            // Note: Don't clear shadow pages here - displayUnit will do smart cleanup
            
            // Select the clicked shadow page's unit (after animation to prevent early re-render)
            this.forceBuilder.selectUnit(unit);
            
            // Re-render with new position
            this.displayUnit({ fromSwipe: true });
        };
        
        this.swipeAnimationCallback = onAnimationEnd;
        swipeWrapper.addEventListener('transitionend', onAnimationEnd, { once: true });
    }
    
    /**
     * Creates shadow pages for the units that will slide into view during animation.
     * These are positioned beyond the current visible area in the direction of movement.
     */
    private createIncomingShadowPages(
        targetIndex: number,
        direction: string,
        pagesToMove: number,
        scale: number,
        showFluff: boolean,
        allUnits: CBTForceUnit[]
    ): void {
        const totalUnits = allUnits.length;
        const scaledPageStep = (PAGE_WIDTH + PAGE_GAP) * scale;
        
        // Find the clicked shadow to get its position as reference
        const clickedShadow = this.shadowPageElements.find(
            el => el.dataset['unitIndex'] === String(targetIndex)
        );
        if (!clickedShadow) return;
        
        const clickedShadowLeft = parseFloat(clickedShadow.style.left) || 0;
        
        // Calculate how many incoming shadows we need
        // We want to show pages that will be visible after the animation
        // These are the pages beyond the clicked shadow in the direction of movement
        const incomingCount = Math.abs(pagesToMove);
        
        // Get existing shadow unit indices to avoid duplicates
        const existingShadowIndices = new Set(
            this.shadowPageElements.map(el => parseInt(el.dataset['unitIndex'] ?? '-1', 10))
        );
        
        // Get active page unit IDs to avoid duplicates
        const activeUnitIds = new Set(this.displayedUnits.map(u => u.id));
        
        for (let i = 1; i <= incomingCount; i++) {
            // Calculate unit index for this incoming page
            const unitOffset = direction === 'right' ? i : -i;
            const incomingUnitIndex = (targetIndex + unitOffset + totalUnits) % totalUnits;
            
            // Skip if already exists as shadow or active page
            if (existingShadowIndices.has(incomingUnitIndex)) continue;
            const unit = allUnits[incomingUnitIndex];
            if (!unit || activeUnitIds.has(unit.id)) continue;
            
            // Calculate position for this incoming shadow
            const positionOffset = direction === 'right' ? i : -i;
            const incomingPosition = clickedShadowLeft + positionOffset * scaledPageStep;
            
            // Load the unit (fire and forget - may already be loaded)
            unit.load().then(() => {
                // Check if we're still in animation (component might have moved on)
                if (this.swipeAnimationCallback === null) return;
                
                // Use unified helper to create shadow page with click handler
                const shadowDirection = direction === 'right' ? 'right' : 'left';
                this.createShadowPageElement(
                    unit,
                    incomingUnitIndex,
                    incomingPosition,
                    shadowDirection,
                    scale,
                    showFluff
                );
            });
        }
    }

    /**
     * Clears all shadow page elements.
     */
    private clearShadowPages(): void {
        // Run cleanup functions for shadow page event listeners
        this.shadowPageCleanups.forEach(cleanup => cleanup());
        this.shadowPageCleanups = [];
        
        // Remove shadow elements from DOM and clear references
        this.shadowPageElements.forEach(el => {
            if (el.parentElement) {
                el.parentElement.removeChild(el);
            }
            el.innerHTML = '';
        });
        this.shadowPageElements = [];
    }
    
    /**
     * Creates a single shadow page element with click handler.
     */
    private createShadowPageElement(
        unit: CBTForceUnit,
        unitIndex: number,
        scaledLeftPosition: number,
        direction: 'left' | 'right',
        scale: number,
        showFluff: boolean
    ): HTMLDivElement | null {
        const svg = unit.svg();
        if (!svg) return null;
        
        const content = this.contentRef().nativeElement;
        
        // Clone the SVG (deep clone without event listeners)
        const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
        clonedSvg.style.transform = `scale(${scale})`;
        clonedSvg.style.transformOrigin = 'top left';
        clonedSvg.style.pointerEvents = 'none';
        
        // Create shadow page wrapper
        const shadowWrapper = this.renderer.createElement('div') as HTMLDivElement;
        this.renderer.addClass(shadowWrapper, 'page-wrapper');
        this.renderer.addClass(shadowWrapper, 'shadow-page');
        shadowWrapper.dataset['unitId'] = unit.id;
        shadowWrapper.dataset['unitIndex'] = String(unitIndex);
        shadowWrapper.dataset['shadowDirection'] = direction;
        
        // Position the shadow page
        shadowWrapper.dataset['originalLeft'] = String(scaledLeftPosition / scale);
        shadowWrapper.style.width = `${PAGE_WIDTH * scale}px`;
        shadowWrapper.style.height = `${PAGE_HEIGHT * scale}px`;
        shadowWrapper.style.position = 'absolute';
        shadowWrapper.style.left = `${scaledLeftPosition}px`;
        shadowWrapper.style.top = '0';
        
        // Append cloned SVG
        shadowWrapper.appendChild(clonedSvg);
        
        // Apply fluff visibility
        this.applyFluffImageVisibilityToSvg(clonedSvg, showFluff);
        
        // Add click handler to navigate to this page
        const clickHandler = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.navigateToShadowPage(unit, unitIndex, shadowWrapper);
        };
        shadowWrapper.addEventListener('click', clickHandler);
        
        // Store cleanup function for this specific shadow page
        this.shadowPageCleanups.push(() => {
            shadowWrapper.removeEventListener('click', clickHandler);
        });
        
        // Add to DOM and tracking array
        content.appendChild(shadowWrapper);
        this.shadowPageElements.push(shadowWrapper);
        
        return shadowWrapper;
    }
    
    /**
     * Applies fluff image visibility to shadow page clones.
     */
    private setFluffImageVisibilityForShadows(): void {
        const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
        const showFluff = centerContent === 'fluffImage';
        
        for (const wrapper of this.shadowPageElements) {
            const svg = wrapper.querySelector('svg');
            if (!svg) continue;
            
            this.applyFluffImageVisibilityToSvg(svg, showFluff);
        }
    }
    
    /**
     * Applies fluff image visibility to a single SVG element.
     */
    private applyFluffImageVisibilityToSvg(svg: SVGSVGElement, showFluff: boolean): void {
        const injectedEl = svg.getElementById('fluff-image-fo') as HTMLElement | null;
        if (!injectedEl) return; // this SVG doesn't have a fluff image
        
        const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
        if (referenceTables.length === 0) return; // no reference tables to hide/show
        
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

    private clearPages(): void {
        // Clear shadow pages first
        this.clearShadowPages();
        
        // Remove page elements from DOM and clear references
        this.pageElements.forEach(el => {
            // Try to remove from parent, regardless of whether it's the expected content element
            if (el.parentElement) {
                el.parentElement.removeChild(el);
            }
            // Also clear any internal references the element might have
            el.innerHTML = '';
        });
        this.pageElements = [];
        this.displayedUnits = [];
        this.displayedUnitIds.set([]);
    }

    private getTotalPageCount(): number {
        return Math.max(1, this.forceUnits().length);
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
        const isMultiPageMode = this.effectiveVisiblePageCount() > 1;
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
        const multipleVisible = this.effectiveVisiblePageCount() > 1;
        
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
            
            this.applyFluffImageVisibilityToSvg(svg, showFluff);
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

    /**
     * Handle print request from controls - trigger browser print dialog
     */
    onPrintRequested(): void {
        window.print();
    }

    // ========== Force Units Change Handling ==========

    /**
     * Handle changes to the force's units array (additions, removals, reordering).
     * Updates the view if currently displayed units no longer match their expected positions.
     * 
     * @param previousUnitCount The number of units before this change (used to detect count changes)
     */
    private handleForceUnitsChanged(previousUnitCount: number): void {
        const allUnits = this.forceUnits();
        
        if (allUnits.length === 0) {
            // Force is empty, clear display
            this.clearPages();
            this.renderShadowPages(); // Clear shadow pages too
            return;
        }

        // Update dimensions first - this updates the zoom service's page count
        // which affects visiblePageCount and effectiveVisiblePageCount
        this.updateDimensions();

        // Check if any of our currently displayed units are no longer at the expected indices
        let viewStart = this.viewStartIndex();
        const visibleCount = this.effectiveVisiblePageCount();
        let needsRedisplay = false;

        // Force redisplay when unit count changes - this affects how many pages should be shown
        if (allUnits.length !== previousUnitCount) {
            needsRedisplay = true;
        }

        // When all units fit on screen, reset viewStartIndex to 0
        // This prevents issues where a stale viewStartIndex causes incorrect display
        // after transitioning from paginated mode to "all fit" mode
        if (allUnits.length <= visibleCount && viewStart !== 0) {
            this.viewStartIndex.set(0);
            viewStart = 0;
            needsRedisplay = true;
        }

        // If the currently selected unit was visible, follow it and keep its relative slot.
        // Example: if selected unit was in slot 1 of 3, keep it in slot 1 after reorder.
        const selectedUnitId = this.unit()?.id;
        let preserveSelectedSlot = false;
        if (selectedUnitId && this.displayedUnits.length > 0 && allUnits.length > 0) {
            const previousSlotIndex = this.displayedUnits.findIndex(u => u.id === selectedUnitId);
            preserveSelectedSlot = previousSlotIndex >= 0;

            if (previousSlotIndex >= 0 && allUnits.length > visibleCount) {
                const newSelectedIndex = allUnits.findIndex(u => u.id === selectedUnitId);
                if (newSelectedIndex >= 0) {
                    const rawStartIndex = newSelectedIndex - previousSlotIndex;
                    const normalizedStartIndex = ((rawStartIndex % allUnits.length) + allUnits.length) % allUnits.length;
                    if (normalizedStartIndex !== viewStart) {
                        this.viewStartIndex.set(normalizedStartIndex);
                        viewStart = normalizedStartIndex;
                        needsRedisplay = true;
                    }
                }
            }
        }

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
            // Close interaction overlays before re-rendering
            this.closeInteractionOverlays();
            
            // Determine if we're transitioning between display modes
            // (from paginated/swipe mode to all-fit mode or vice versa)
            // In such cases, page positions need to be recalculated, so we must do a full re-render
            const wasInPaginatedMode = previousUnitCount > visibleCount;
            const nowInPaginatedMode = allUnits.length > visibleCount;
            const modeChanged = wasInPaginatedMode !== nowInPaginatedMode;
            
            // If the selected unit is already visible and display mode hasn't changed,
            // update non-selected pages in-place to prevent flicker.
            if (selectedUnitId && preserveSelectedSlot && this.pageElements.length > 0 && !modeChanged) {
                this.updateDisplayedPagesInPlace({ preserveSelectedUnitId: selectedUnitId });
            } else {
                this.displayUnit();
            }
        }
    }

    // ========== Cleanup ==========

    private cleanup(): void {
        // Cancel any pending swipe animation
        if (this.swipeAnimationCallback) {
            const swipeWrapper = this.swipeWrapperRef()?.nativeElement;
            if (swipeWrapper) {
                swipeWrapper.removeEventListener('transitionend', this.swipeAnimationCallback);
            }
            this.swipeAnimationCallback = null;
        }
        
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
        this.cleanupSwipeState();
        this.clearPages();
        this.lastViewState = null;
        this.heatDiffMarkers.set(new Map());
        this.interactionOverlayModes.clear();
    }
}
