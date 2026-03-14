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
    afterNextRender,
    input,
    type ElementRef,
    type AfterViewInit,
    Renderer2,
    Injector,
    signal,
    effect,
    inject,
    ChangeDetectionStrategy,
    viewChild,
    viewChildren,
    computed,
    type EffectRef,
    DestroyRef,
    untracked,
    runInInjectionContext,
    ApplicationRef
} from '@angular/core';

import type { ViewportTransform } from '../../models/force-serialization';
import {
    PageViewerZoomPanService,
    type SwipeCallbacks,
    PAGE_WIDTH,
    PAGE_HEIGHT,
    PAGE_GAP
} from './page-viewer-zoom-pan.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { OptionsService } from '../../services/options.service';
import { DbService } from '../../services/db.service';
import type { LayoutService } from '../../services/layout.service';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { CBTForce } from '../../models/cbt-force.model';
import { SvgInteractionService } from './svg-interaction.service';
import { HeatDiffMarkerComponent, type HeatDiffMarkerData } from '../heat-diff-marker/heat-diff-marker.component';
import {
    PageViewerCanvasService,
    PageViewerCanvasControlsComponent
} from './canvas';
import { ViewerStageComponent } from './parts/viewer-stage/viewer-stage.component';
import { ViewerPageComponent } from './parts/viewer-page/viewer-page.component';
import { ViewerShadowPageComponent } from './parts/viewer-shadow-page/viewer-shadow-page.component';
import { PageViewerStateService } from './internal/page-viewer-state.service';
import { PageViewerNavigationService } from './internal/page-viewer-navigation.service';
import { PageViewerRenderModelService } from './internal/page-viewer-render-model.service';
import { PageViewerViewStateService } from './internal/page-viewer-view-state.service';
import { PageViewerActiveRenderService } from './internal/page-viewer-active-render.service';
import { PageViewerActiveDisplayService } from './internal/page-viewer-active-display.service';
import { PageViewerOverlayService } from './internal/page-viewer-overlay.service';
import { PageViewerShadowService } from './internal/page-viewer-shadow.service';
import { PageViewerShadowNavigationService } from './internal/page-viewer-shadow-navigation.service';
import { PageViewerShadowRenderService } from './internal/page-viewer-shadow-render.service';
import { PageViewerDisplayWindowService } from './internal/page-viewer-display-window.service';
import { PageViewerEffectStateService } from './internal/page-viewer-effect-state.service';
import { PageViewerForceChangeService } from './internal/page-viewer-force-change.service';
import { PageViewerForceUnitsReactionService } from './internal/page-viewer-force-units-reaction.service';
import { PageViewerOptionReactionService } from './internal/page-viewer-option-reaction.service';
import { PageViewerPresentationService } from './internal/page-viewer-presentation.service';
import { PageViewerSelectionChangeService } from './internal/page-viewer-selection-change.service';
import { PageViewerInPlaceUpdateService } from './internal/page-viewer-in-place-update.service';
import { PageViewerUiGlueService } from './internal/page-viewer-ui-glue.service';
import { PageViewerSwipeSlotService } from './internal/page-viewer-swipe-slot.service';
import { PageViewerSwipeLoadService } from './internal/page-viewer-swipe-load.service';
import { PageViewerSwipeFrameService } from './internal/page-viewer-swipe-frame.service';
import { PageViewerSwipeAnimationService } from './internal/page-viewer-swipe-animation.service';
import { PageViewerSwipeDecisionService } from './internal/page-viewer-swipe-decision.service';
import { PageViewerSwipeSessionService } from './internal/page-viewer-swipe-session.service';
import { PageViewerSwipeBindingService } from './internal/page-viewer-swipe-binding.service';
import { PageViewerSwipeDomService } from './internal/page-viewer-swipe-dom.service';
import { PageViewerSwipeRenderPlanService } from './internal/page-viewer-swipe-render-plan.service';
import { PageViewerSwipeRendererService } from './internal/page-viewer-swipe-renderer.service';
import { PageViewerWrapperLayoutService } from './internal/page-viewer-wrapper-layout.service';
import type { PageViewerPageDescriptor, PageViewerShadowDescriptor } from './internal/types';

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

type ShadowDirection = 'left' | 'right';

@Component({
    selector: 'page-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        PageViewerZoomPanService,
        PageViewerCanvasService,
        PageViewerStateService,
        PageViewerNavigationService,
        PageViewerRenderModelService,
        PageViewerViewStateService,
        PageViewerActiveDisplayService,
        PageViewerActiveRenderService,
        PageViewerOverlayService,
        PageViewerShadowService,
        PageViewerShadowNavigationService,
        PageViewerShadowRenderService,
        PageViewerDisplayWindowService,
        PageViewerEffectStateService,
        PageViewerForceChangeService,
        PageViewerForceUnitsReactionService,
        PageViewerOptionReactionService,
        PageViewerPresentationService,
        PageViewerSelectionChangeService,
        PageViewerInPlaceUpdateService,
        PageViewerUiGlueService,
        PageViewerSwipeSlotService,
        PageViewerSwipeLoadService,
        PageViewerSwipeFrameService,
        PageViewerSwipeAnimationService,
        PageViewerSwipeDecisionService,
        PageViewerSwipeSessionService,
        PageViewerSwipeBindingService,
        PageViewerSwipeDomService,
        PageViewerSwipeRenderPlanService,
        PageViewerSwipeRendererService,
        PageViewerWrapperLayoutService
    ],
    imports: [ViewerStageComponent, ViewerPageComponent, ViewerShadowPageComponent, HeatDiffMarkerComponent, PageViewerCanvasControlsComponent],
    host: {
        '(window:keydown)': 'onWindowKeyDown($event)',
        '(window:keyup)': 'onWindowKeyUp($event)'
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
    private pageViewerState = inject(PageViewerStateService);
    private pageViewerNavigation = inject(PageViewerNavigationService);
    private pageViewerRenderModel = inject(PageViewerRenderModelService);
    private pageViewerViewState = inject(PageViewerViewStateService);
    private pageViewerActiveDisplay = inject(PageViewerActiveDisplayService);
    private pageViewerActiveRender = inject(PageViewerActiveRenderService);
    private pageViewerOverlay = inject(PageViewerOverlayService);
    private pageViewerShadow = inject(PageViewerShadowService);
    private pageViewerShadowNavigation = inject(PageViewerShadowNavigationService);
    private pageViewerShadowRender = inject(PageViewerShadowRenderService);
    private pageViewerEffectState = inject(PageViewerEffectStateService);
    private pageViewerForceChange = inject(PageViewerForceChangeService);
    private pageViewerForceUnitsReaction = inject(PageViewerForceUnitsReactionService);
    private pageViewerOptionReaction = inject(PageViewerOptionReactionService);
    private pageViewerPresentation = inject(PageViewerPresentationService);
    private pageViewerSelectionChange = inject(PageViewerSelectionChangeService);
    private pageViewerUiGlue = inject(PageViewerUiGlueService);
    private pageViewerSwipeSlot = inject(PageViewerSwipeSlotService);
    private pageViewerSwipeLoad = inject(PageViewerSwipeLoadService);
    private pageViewerSwipeFrame = inject(PageViewerSwipeFrameService);
    private pageViewerSwipeAnimation = inject(PageViewerSwipeAnimationService);
    private pageViewerSwipeDecision = inject(PageViewerSwipeDecisionService);
    private pageViewerSwipeSession = inject(PageViewerSwipeSessionService);
    private pageViewerSwipeDom = inject(PageViewerSwipeDomService);
    private pageViewerSwipeRenderer = inject(PageViewerSwipeRendererService);
    private pageViewerWrapperLayout = inject(PageViewerWrapperLayoutService);
    canvasService = inject(PageViewerCanvasService);

    readonly rewriteActivePages = this.pageViewerRenderModel.activePages;
    readonly rewriteShadowPages = this.pageViewerRenderModel.shadowPages;
    readonly rewriteCanNavigate = this.pageViewerNavigation.canNavigate;
    readonly stageSwiping = computed(() => this.isSwiping);

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
    containerRef = viewChild.required<ViewerStageComponent>('container');
    swipeWrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('swipeWrapper');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');
    fixedOverlayContainerRef = viewChild.required<ElementRef<HTMLDivElement>>('fixedOverlayContainer');
    private activePageComponentRefs = viewChildren(ViewerPageComponent);
    private shadowPageComponentRefs = viewChildren(ViewerShadowPageComponent);

    // State
    loadError = signal<string | null>(null);
    currentSvg = signal<SVGSVGElement | null>(null);

    // Track displayed units
    private displayedUnits = signal<CBTForceUnit[]>([]);
    private displayedUnitIds = computed(() => this.displayedUnits().map((unit) => unit.id));

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
    private pageElements: HTMLDivElement[] = [];
    private shadowPageElements: HTMLDivElement[] = []; // Cloned shadow pages for neighbor preview
    private shadowPageCleanups: (() => void)[] = []; // Cleanup functions for shadow page event listeners
    private shadowRenderFrameId: number | null = null; // RAF handle for deferred shadow rendering
    private shadowRenderVersion = 0; // Version counter for async shadow rendering
    private asyncNavigationVersion = 0; // Version counter for async keyboard/fallback navigation
    private pendingDirectionalNavigation = 0; // Queued discrete left/right page moves while an animation is in flight
    private activeDirectionalKey: 'left' | 'right' | null = null; // Tracks the currently held arrow key so key repeat cannot pool navigation

    // Interaction services - keyed by unit ID for persistence across renders
    private interactionServices = new Map<string, SvgInteractionService>();

    // Effect refs for interaction service heat markers - keyed by unit ID
    private interactionServiceEffectRefs = new Map<string, EffectRef>();

    // Track which SVGs have had interactions set up (to avoid re-setup)
    private setupInteractionsSvgs = new WeakSet<SVGSVGElement>();

    // Event listener cleanup functions
    private eventListenerCleanups: (() => void)[] = [];

    // Swipe state - track which units are displayed during swipe
    private baseDisplayStartIndex = 0; // The starting index before swipe began
    private isSwiping = false; // Whether we're currently in a swipe gesture
    private swipeVersion = 0; // Version counter to cancel stale animation callbacks

    // Swipe state - slot-based system for smooth transitions
    // Slots are positional containers (left neighbors, visible, right neighbors)
    // SVGs are only attached to slots when they become visible
    private swipeSlots: HTMLDivElement[] = []; // Array of slot elements by position
    private swipeSlotUnitAssignments: (number | null)[] = []; // Which unit index is assigned to each slot
    private swipeSlotSvgs: (SVGSVGElement | null)[] = []; // Root SVG currently attached to each slot
    private swipeTotalSlots = 0; // Total number of slots
    private swipeBasePositions: number[] = []; // Unscaled left position for each slot
    private swipeDirection: 'left' | 'right' | 'none' = 'none'; // Current swipe direction for resolving conflicts
    private lastSwipeTranslateX = 0; // Track last translateX to determine direction
    private lastSwipeVisibleOffsets: { left: number; right: number } | null = null; // Current visible offset window
    
    // Lazy swipe state - track the range of created slots for dynamic extension
    private swipeLeftmostOffset = 0; // Leftmost slot offset from baseDisplayStartIndex
    private swipeRightmostOffset = 0; // Rightmost slot offset from baseDisplayStartIndex
    private swipeAllUnits: CBTForceUnit[] = []; // Cached reference to all units during swipe

    // View start index - tracks the leftmost displayed unit, independent of selection
    // This allows swiping without changing the selected unit
    private viewStartIndex = this.pageViewerState.viewStartIndex;

    // Track if view is initialized
    private viewInitialized = signal(false);
    
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
            if (!this.viewInitialized()) {
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

                const selectionPlan = this.pageViewerSelectionChange.buildPlan({
                    previousUnit,
                    currentUnit,
                    displayedUnits: this.displayedUnits(),
                    allUnits: this.forceUnits() as CBTForceUnit[],
                    selectionRedisplaySuppressed: this.pageViewerNavigation.consumeSelectionRedisplaySuppression(previousUnit?.id ?? null, currentUnit?.id ?? null)
                });

                if (selectionPlan.unitToSave) {
                    this.saveViewState(selectionPlan.unitToSave);
                }

                if (selectionPlan.shouldUpdateHighlight) {
                    untracked(() => {
                        this.pageViewerPresentation.updateSelectedPageHighlight(this.pageElements, selectionPlan.selectedUnitId);
                    });
                } else if (selectionPlan.shouldDisplay) {
                    untracked(() => {
                        if (selectionPlan.nextViewStartIndex !== null) {
                            this.viewStartIndex.set(selectionPlan.nextViewStartIndex);
                        }
                        this.displayUnit({ fromSwipe: selectionPlan.fromSwipe });
                    });
                }

                previousUnit = selectionPlan.nextPreviousUnit;
            })();
        }, { injector: this.injector });

        // Watch for force units changes (additions, removals, reordering)
        effect(() => {
            const force = this.force();
            const allUnits = force?.units() ?? [];
            const currentUnitIds = allUnits.map(u => u.id);

            const forceUnitsReaction = this.pageViewerForceUnitsReaction.evaluate({
                currentUnitIds,
                viewInitialized: this.viewInitialized()
            });

            if (forceUnitsReaction.shouldHandleChange) {
                untracked(() => this.handleForceUnitsChanged(forceUnitsReaction.previousUnitCount));
            }
        }, { injector: this.injector });

        effect(() => {
            this.pageViewerEffectState.syncViewerState({
                state: this.pageViewerState,
                forceUnits: this.forceUnits() as CBTForceUnit[],
                selectedUnitId: this.unit()?.id ?? null,
                visiblePageCount: this.visiblePageCount(),
                maxVisiblePageCount: this.maxVisiblePageCount(),
                allowMultipleActiveSheets: this.optionsService.options().allowMultipleActiveSheets
            });
        }, { injector: this.injector });

        effect(() => {
            if (!this.viewInitialized()) {
                return;
            }

            const snapshot = this.pageViewerEffectState.captureViewStateSnapshot(this.zoomPanService.viewState());

            this.lastViewState = snapshot;
            this.pageViewerViewState.saveSharedViewState(snapshot);
        }, { injector: this.injector });

        // Watch for fluff image visibility option changes
        this.fluffImageInjectEffectRef = effect(() => {
            // Track the option - when it changes, update visibility on all displayed SVGs
            this.optionsService.options().recordSheetCenterPanelContent;
            this.setFluffImageVisibility();
        });

        // Watch for allowMultipleActiveSheets option changes
        effect(() => {
            const allowMultiple = this.optionsService.options().allowMultipleActiveSheets;

            if (this.pageViewerOptionReaction.shouldRedisplayForAllowMultipleChange({
                allowMultiple,
                viewInitialized: this.viewInitialized(),
                isSwiping: this.isSwiping
            })) {
                untracked(() => {
                    this.displayUnit();
                });
            }
        });

        // Watch for readOnly changes (e.g., after cloning a shared force)
        effect(() => {
            const isReadOnly = this.readOnly();

            if (this.pageViewerOptionReaction.shouldRedisplayForReadOnlyChange({
                isReadOnly,
                viewInitialized: this.viewInitialized(),
                isSwiping: this.isSwiping
            })) {
                untracked(() => {
                    this.displayUnit();
                });
            }
        });

        inject(DestroyRef).onDestroy(() => this.cleanup());
    }

    ngAfterViewInit(): void {
        this.setupResizeObserver();
        this.setupPageClickCapture();
        this.initializeZoomPan();
        this.updateDimensions();
        // Setting this signal triggers the unit effect to re-run, which handles
        // the initial displayUnit() call with the correct viewStartIndex.
        this.viewInitialized.set(true);
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
    private onSwipeStart(): void {
        if (!this.swipeAllowed()) return;
        
        // Cancel any pending animation callback from a previous swipe
        // This prevents stale callbacks from interfering with the new swipe
        this.swipeVersion++;
        if (this.pageViewerSwipeAnimation.hasActiveAnimation()) {
            this.cancelSwipeAnimation({ applyPendingMove: true, resetTransform: true });
        }
        
        // Close any open interaction overlays before swiping
        this.closeInteractionOverlays();
        
        // Clear shadow pages during swipe
        this.clearShadowPages();
        
        // Remove any stale 'leaving-page' classes from previous interrupted animations
        this.pageElements.forEach(el => this.renderer.removeClass(el, 'leaving-page'));
        
        this.isSwiping = true;
        this.baseDisplayStartIndex = this.viewStartIndex();
        this.pageViewerSwipeFrame.startSession();
        this.lastSwipeVisibleOffsets = null;
        this.containerRef().nativeElement.classList.add('swiping');
        
        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        const effectiveVisible = this.effectiveVisiblePageCount();
        const initialRangePlan = this.pageViewerSwipeSlot.buildInitialRangePlan({
            totalUnits,
            effectiveVisible,
            baseDisplayStartIndex: this.baseDisplayStartIndex
        });

        this.pageViewerSwipeLoad.startSession();

        // Store base positions for visible pages
        this.swipeBasePositions = this.zoomPanService.getPagePositions(effectiveVisible);
        const initialVisibleOffsets = this.pageViewerSwipeSlot.resolveVisibleOffsets({
            containerWidth: this.containerRef().nativeElement.clientWidth,
            scale: this.zoomPanService.scale(),
            baseLeft: this.swipeBasePositions[0] ?? 0,
            translateX: 0,
            panTranslateX: this.zoomPanService.translate().x,
            pageWidth: PAGE_WIDTH,
            pageGap: PAGE_GAP
        });
        const sessionStartState = this.pageViewerSwipeSession.buildStartState({
            viewStartIndex: this.viewStartIndex(),
            units: allUnits as CBTForceUnit[],
            initialRangePlan,
            initialVisibleOffsets
        });
        this.baseDisplayStartIndex = sessionStartState.baseDisplayStartIndex;
        this.swipeAllUnits = sessionStartState.swipeAllUnits;
        this.swipeLeftmostOffset = sessionStartState.swipeLeftmostOffset;
        this.swipeRightmostOffset = sessionStartState.swipeRightmostOffset;
        this.lastSwipeVisibleOffsets = sessionStartState.lastSwipeVisibleOffsets;

        // Create initial slot-based swipe pages
        this.setupSwipeSlots();

        // Load initial units after slot creation so fast flicks can't outrun slot setup.
        for (const idx of initialRangePlan.unitIndicesToPrepare) {
            this.queueSwipeUnitLoad(idx);
        }
    }

    /**
     * Called during swipe movement.
     * Updates CSS transform, extends slots if needed, and reassigns SVGs to visible slots.
     */
    private onSwipeMove(totalDx: number): void {
        if (!this.swipeAllowed() || !this.isSwiping) return;

        this.pageViewerSwipeFrame.setPendingTranslateX(totalDx);

        const nextVisibleOffsets = this.pageViewerSwipeSlot.resolveVisibleOffsets({
            containerWidth: this.containerRef().nativeElement.clientWidth,
            scale: this.zoomPanService.scale(),
            baseLeft: this.swipeBasePositions[0] ?? 0,
            translateX: totalDx,
            panTranslateX: this.zoomPanService.translate().x,
            pageWidth: PAGE_WIDTH,
            pageGap: PAGE_GAP
        });
        const refreshState = this.pageViewerSwipeSlot.resolveVisibleOffsetRefresh({
            currentVisibleOffsets: this.lastSwipeVisibleOffsets,
            nextVisibleOffsets
        });
        this.lastSwipeVisibleOffsets = refreshState.nextTrackedOffsets;

        this.scheduleSwipeFrame({ refreshVisibility: refreshState.shouldRefresh });
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

        this.cancelPendingSwipeFrame();
        this.flushPendingSwipeFrame();

        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const scale = this.zoomPanService.scale();
        const scaledPageStep = PAGE_WIDTH * scale + PAGE_GAP * scale;
        const totalUnits = this.forceUnits().length;
        const swipeEndPlan = this.pageViewerSwipeDecision.resolveSwipeEndPlan({
            totalDx,
            velocity,
            scaledPageStep,
            totalUnits,
            commitThreshold: SWIPE_COMMIT_THRESHOLD,
            velocityThreshold: SWIPE_VELOCITY_THRESHOLD
        });
        const { pagesToMove, targetOffset } = swipeEndPlan;

        if (pagesToMove !== 0) {
            // Store the last view state before animating so that we can restore it later
            this.pageViewerViewState.saveSharedViewState(this.captureCurrentViewState());
            
            // Pre-attach SVGs for the target position before animation starts
            // This ensures the destination page is visible during the animation, not blank
            // Using addOnly mode adds incoming SVGs without removing outgoing ones
            this.updateSwipeSlotVisibility(targetOffset, { addOnly: true });
            
            // Store the pending move so we can apply it if cancelled
            this.pageViewerSwipeAnimation.setPendingPagesToMove(pagesToMove);

            // Capture version to detect if a new swipe started during animation
            const animationVersion = this.swipeVersion;
            
            // After animation completes, update state
            this.startSwipeAnimation({
                durationMs: 250,
                easing: 'ease-out',
                transform: `translate3d(${targetOffset}px, 0, 0)`,
                onComplete: () => {
                this.pageViewerSwipeAnimation.clearPendingPagesToMove();
                
                // If a new swipe started during the animation, don't run cleanup
                if (this.swipeVersion !== animationVersion) {
                    return;
                }
                
                // Calculate new view start index
                const newStartIndex = this.pageViewerSwipeDecision.resolveViewStartIndex({
                    baseDisplayStartIndex: this.baseDisplayStartIndex,
                    pagesToMove,
                    totalUnits
                });
                this.viewStartIndex.set(newStartIndex);
                
                // Reset transform before re-render to prevent flicker
                swipeWrapper.style.transition = 'none';
                swipeWrapper.style.transform = '';
                
                // Clean up swipe state and re-render with new positions
                this.cleanupSwipeState();
                this.displayUnit({ fromSwipe: true });
                
                // Update selection if needed
                const selectedUnit = this.unit();
                const displayedUnits = this.displayedUnits();
                const isSelectedVisible = selectedUnit && displayedUnits.some(u => u.id === selectedUnit.id);
                if (!isSelectedVisible && displayedUnits.length > 0) {
                    const unitToSelect = pagesToMove > 0 
                        ? displayedUnits[0]
                        : displayedUnits[displayedUnits.length - 1];
                    if (unitToSelect) {
                        this.forceBuilder.selectUnit(unitToSelect);
                    }
                }
                }
            });
        } else {
            // Capture version to detect if a new swipe started during animation
            const snapBackVersion = this.swipeVersion;

            this.startSwipeAnimation({
                durationMs: 200,
                easing: 'ease-out',
                transform: 'translate3d(0, 0, 0)',
                onComplete: () => {
                    // If a new swipe started during the animation, don't run cleanup
                    if (this.swipeVersion !== snapBackVersion) {
                        return;
                    }
                    
                    this.cleanupSwipeState();
                    // Restore normal display without full re-render
                    this.displayUnit();
                }
            });
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
        const baseLeft = this.swipeBasePositions[0] ?? 0;
        const setupState = this.pageViewerSwipeDom.setupSlots({
            content,
            existingSwipeSlots: this.swipeSlots,
            existingPageElements: this.pageElements,
            scale,
            effectiveVisible,
            totalUnits,
            leftmostOffset: this.swipeLeftmostOffset,
            rightmostOffset: this.swipeRightmostOffset,
            baseDisplayStartIndex: this.baseDisplayStartIndex,
            baseLeft
        });
        this.swipeSlots = setupState.swipeSlots;
        this.swipeSlotUnitAssignments = setupState.swipeSlotUnitAssignments;
        this.swipeSlotSvgs = setupState.swipeSlotSvgs;
        this.swipeTotalSlots = setupState.swipeTotalSlots;
        this.pageElements = [];
        
        // Initial SVG assignment
        this.updateSwipeSlotVisibility(0);
    }

    private scheduleSwipeFrame(options: { refreshVisibility?: boolean } = {}): void {
        this.pageViewerSwipeFrame.schedule({
            refreshVisibility: options.refreshVisibility,
            onFrame: () => this.flushPendingSwipeFrame()
        });
    }

    private flushPendingSwipeFrame(): void {
        const flushState = this.pageViewerSwipeFrame.consumeFlushState({
            isSwiping: this.isSwiping,
            hasActiveAnimation: this.pageViewerSwipeAnimation.hasActiveAnimation()
        });
        if (!flushState) {
            return;
        }

        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translate3d(${flushState.pendingTranslateX}px, 0, 0)`;

        if (flushState.shouldExtend) {
            this.extendSwipeSlotsIfNeeded(flushState.pendingTranslateX);
        }

        if (!flushState.shouldRefresh) {
            return;
        }

        this.updateSwipeSlotVisibility(flushState.pendingTranslateX);
    }

    private cancelPendingSwipeFrame(): void {
        this.pageViewerSwipeFrame.cancelPendingFrame();
    }

    private cancelSwipeAnimation(options: { applyPendingMove?: boolean; resetTransform?: boolean } = {}): void {
        this.pageViewerSwipeAnimation.cancel({
            swipeWrapper: this.swipeWrapperRef().nativeElement,
            applyPendingMove: options.applyPendingMove
                ? () => {
                    const totalUnits = this.forceUnits().length;
                    const pendingPagesToMove = this.pageViewerSwipeAnimation.getPendingPagesToMove();
                    if (totalUnits > 0 && pendingPagesToMove !== 0) {
                        const newStartIndex = ((this.baseDisplayStartIndex + pendingPagesToMove) % totalUnits + totalUnits) % totalUnits;
                        this.viewStartIndex.set(newStartIndex);
                    }
                }
                : undefined,
            resetTransform: options.resetTransform
        });
    }

    private startSwipeAnimation(options: {
        durationMs: number;
        easing: string;
        transform: string;
        onComplete: () => void;
    }): void {
        this.pageViewerSwipeAnimation.start({
            swipeWrapper: this.swipeWrapperRef().nativeElement,
            durationMs: options.durationMs,
            easing: options.easing,
            transform: options.transform,
            onComplete: options.onComplete
        });
    }

    private getCurrentSwipeWrapperTranslateX(): number {
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const computedTransform = window.getComputedStyle(swipeWrapper).transform;

        if (!computedTransform || computedTransform === 'none') {
            return 0;
        }

        try {
            return new DOMMatrixReadOnly(computedTransform).m41;
        } catch {
            const matrix3dMatch = computedTransform.match(/^matrix3d\((.+)\)$/);
            if (matrix3dMatch) {
                const values = matrix3dMatch[1].split(',').map(value => Number.parseFloat(value.trim()));
                return Number.isFinite(values[12]) ? values[12] : 0;
            }

            const matrixMatch = computedTransform.match(/^matrix\((.+)\)$/);
            if (matrixMatch) {
                const values = matrixMatch[1].split(',').map(value => Number.parseFloat(value.trim()));
                return Number.isFinite(values[4]) ? values[4] : 0;
            }

            return 0;
        }
    }

    private reverseDirectionalNavigationToOrigin(): void {
        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        const currentTranslateX = this.getCurrentSwipeWrapperTranslateX();
        const scale = this.zoomPanService.scale();
        const reversePlan = this.pageViewerSwipeDecision.resolveReversePlan({
            currentTranslateX,
            fullPageDistance: (PAGE_WIDTH + PAGE_GAP) * scale
        });

        this.pendingDirectionalNavigation = 0;
        this.pageViewerNavigation.reverseTransition();
        this.cancelSwipeAnimation();

        if (reversePlan.shouldSnapImmediately) {
            swipeWrapper.style.transition = 'none';
            swipeWrapper.style.transform = '';
            this.pageViewerNavigation.cancelTransition();
            this.displayUnit({ fromSwipe: true });
            return;
        }

        swipeWrapper.style.transition = 'none';
        swipeWrapper.style.transform = `translate3d(${currentTranslateX}px, 0, 0)`;

        this.startSwipeAnimation({
            durationMs: reversePlan.durationMs,
            easing: 'ease-out',
            transform: 'translate3d(0, 0, 0)',
            onComplete: () => {
                swipeWrapper.style.transition = 'none';
                swipeWrapper.style.transform = '';
                this.pageViewerNavigation.cancelTransition();
                this.displayUnit({ fromSwipe: true });
            }
        });
    }

    private queueSwipeUnitLoad(unitIndex: number): void {
        const unit = this.swipeAllUnits[unitIndex];
        if (!this.pageViewerSwipeLoad.canQueueLoad(unitIndex, !!unit)) {
            return;
        }

        const loadSessionId = this.pageViewerSwipeLoad.markQueued(unitIndex);

        unit.load().then(() => {
            const shouldRefresh = this.pageViewerSwipeLoad.resolveLoadCompletion({
                unitIndex,
                sessionId: loadSessionId,
                isSwiping: this.isSwiping,
                hasActiveAnimation: this.pageViewerSwipeAnimation.hasActiveAnimation(),
                isUnitAssigned: this.swipeSlotUnitAssignments.includes(unitIndex)
            });

            if (!shouldRefresh) {
                return;
            }

            this.scheduleSwipeFrame({ refreshVisibility: true });
        }).catch(() => {
            this.pageViewerSwipeLoad.markLoadFailure(unitIndex);
        });
    }

    private setPageWrapperContentState(wrapper: HTMLDivElement, hasSvg: boolean): void {
        this.renderer[hasSvg ? 'addClass' : 'removeClass'](wrapper, 'has-svg');
        this.renderer[hasSvg ? 'removeClass' : 'addClass'](wrapper, 'is-empty');
    }

    private setWrapperSelectedState(wrapper: HTMLDivElement, isSelected: boolean): void {
        this.renderer[isSelected ? 'addClass' : 'removeClass'](wrapper, 'selected');
    }

    private setSwipeNeighborVisibilityState(wrapper: HTMLDivElement, isVisible: boolean): void {
        this.renderer[isVisible ? 'addClass' : 'removeClass'](wrapper, 'neighbor-visible');
    }

    private setPromotedShadowState(wrapper: HTMLDivElement, isPromoted: boolean): void {
        this.renderer[isPromoted ? 'addClass' : 'removeClass'](wrapper, 'promoted-shadow-page');
    }

    private applyWrapperLayout(wrapper: HTMLDivElement, options: { originalLeft: number; scale?: number }): void {
        const layout = options.scale === undefined
            ? this.pageViewerWrapperLayout.buildUnscaledLayout(options.originalLeft)
            : this.pageViewerWrapperLayout.buildScaledLayout(options.originalLeft, options.scale);

        wrapper.dataset['originalLeft'] = String(layout.originalLeft);
        wrapper.style.width = `${layout.width}px`;
        wrapper.style.height = `${layout.height}px`;
        wrapper.style.position = 'absolute';
        wrapper.style.left = `${layout.left}px`;
        wrapper.style.top = '0';
    }

    private attachSvgToWrapper(options: {
        wrapper: HTMLDivElement;
        svg: SVGSVGElement;
        scale?: number;
        setAsCurrent?: boolean;
    }): void {
        const { wrapper, svg, scale, setAsCurrent = false } = options;

        if (scale === undefined) {
            svg.style.transform = '';
            svg.style.transformOrigin = '';
        } else {
            svg.style.transform = `scale(${scale})`;
            svg.style.transformOrigin = 'top left';
        }

        const existingSvg = wrapper.querySelector(':scope > svg');
        if (existingSvg && existingSvg !== svg && existingSvg.parentElement === wrapper) {
            wrapper.removeChild(existingSvg);
        }

        if (svg.parentElement !== wrapper) {
            wrapper.insertBefore(svg, wrapper.firstChild);
        }

        this.setPageWrapperContentState(wrapper, true);

        if (setAsCurrent) {
            this.currentSvg.set(svg);
        }
    }

    private bindWrapperInteractiveLayers(
        wrapper: HTMLDivElement,
        unit: CBTForceUnit,
        svg: SVGSVGElement,
        overlayMode: 'fixed' | 'page'
    ): void {
        if (this.readOnly()) {
            return;
        }

        this.getOrCreateInteractionService(unit, svg);
        this.getOrCreateCanvasOverlay(wrapper, unit);
        this.getOrCreateInteractionOverlay(wrapper, unit, overlayMode);
    }

    private syncZoomPanTransformTargets(): void {
        const pageTargets = [...this.pageElements, ...this.shadowPageElements].map((wrapper) => ({
            wrapper,
            rootSvg: wrapper.querySelector(':scope > svg') as SVGSVGElement | null
        }));
        const canvasElements = this.pageViewerOverlay.getCanvasOverlayElements(this.displayedUnitIds());

        this.zoomPanService.setTransformTargets(pageTargets, canvasElements);
    }

    private scheduleRenderShadowPages(): void {
        if (this.isSwiping) {
            return;
        }

        const requestVersion = ++this.shadowRenderVersion;

        if (this.shadowRenderFrameId !== null) {
            cancelAnimationFrame(this.shadowRenderFrameId);
        }

        this.shadowRenderFrameId = requestAnimationFrame(() => {
            this.shadowRenderFrameId = null;
            void this.renderShadowPages(requestVersion);
        });
    }

    private cancelScheduledShadowRender(): void {
        if (this.shadowRenderFrameId !== null) {
            cancelAnimationFrame(this.shadowRenderFrameId);
            this.shadowRenderFrameId = null;
        }
    }

    private extendSwipeSlotsIfNeeded(translateX: number): void {
        const effectiveVisible = this.effectiveVisiblePageCount();
        const scale = this.zoomPanService.scale();
        const totalUnits = this.swipeAllUnits.length;
        const { left: leftmostVisibleOffset, right: rightmostVisibleOffset } = this.pageViewerSwipeSlot.resolveVisibleOffsets({
            containerWidth: this.containerRef().nativeElement.clientWidth,
            scale,
            baseLeft: this.swipeBasePositions[0] ?? 0,
            translateX,
            panTranslateX: this.zoomPanService.translate().x,
            pageWidth: PAGE_WIDTH,
            pageGap: PAGE_GAP
        });

        const content = this.contentRef().nativeElement;
        const baseLeft = this.swipeBasePositions[0] ?? 0;

        const extensionPlan = this.pageViewerSwipeSlot.buildExtensionPlan({
            totalUnits,
            effectiveVisible,
            baseDisplayStartIndex: this.baseDisplayStartIndex,
            currentLeftmostOffset: this.swipeLeftmostOffset,
            currentRightmostOffset: this.swipeRightmostOffset,
            leftmostVisibleOffset,
            rightmostVisibleOffset,
            currentAssignedUnitIndices: this.swipeSlotUnitAssignments.filter((unitIndex): unitIndex is number => unitIndex !== null)
        });

        const extendedState = this.pageViewerSwipeDom.extendSlots({
            content,
            swipeSlots: this.swipeSlots,
            swipeSlotUnitAssignments: this.swipeSlotUnitAssignments,
            swipeSlotSvgs: this.swipeSlotSvgs,
            scale,
            effectiveVisible,
            baseLeft,
            extensionPlan,
            leftmostOffset: this.swipeLeftmostOffset,
            rightmostOffset: this.swipeRightmostOffset,
            swipeTotalSlots: this.swipeTotalSlots,
            queueSwipeUnitLoad: (unitIndex) => this.queueSwipeUnitLoad(unitIndex)
        });

        this.swipeLeftmostOffset = extendedState.leftmostOffset;
        this.swipeRightmostOffset = extendedState.rightmostOffset;
        this.swipeTotalSlots = extendedState.swipeTotalSlots;
    }

    private getShadowKey(unitIndex: number, direction: ShadowDirection): string {
        return this.pageViewerShadow.getShadowKey(unitIndex, direction);
    }

    private removeShadowPageElement(shadowElement: HTMLDivElement): void {
        if (shadowElement.parentElement) {
            shadowElement.parentElement.removeChild(shadowElement);
        }

        shadowElement.innerHTML = '';
    }

    private renderDeclarativeShadowPages(
        scale: number,
        showFluff: boolean,
        options: {
            renderVersion?: number;
            requireAnimation?: boolean;
            onReady?: (wrappers: HTMLDivElement[]) => void;
        } = {}
    ): void {
        afterNextRender(() => {
            if (options.renderVersion !== undefined && options.renderVersion !== this.shadowRenderVersion) {
                return;
            }

            if (options.requireAnimation && !this.pageViewerSwipeAnimation.hasActiveAnimation()) {
                return;
            }

            this.shadowPageElements = this.shadowPageComponentRefs().map(component => component.nativeElement);
            this.shadowPageCleanups = this.pageViewerShadowRender.bindDeclarativeShadowPages({
                wrappers: this.shadowPageElements,
                currentCleanups: this.shadowPageCleanups,
                descriptors: this.rewriteShadowPages(),
                scale,
                showFluff,
                setPromotedShadowState: (wrapper, isPromoted) => this.setPromotedShadowState(wrapper, isPromoted),
                applyWrapperLayout: (wrapper, layoutOptions) => this.applyWrapperLayout(wrapper, layoutOptions),
                setPageWrapperContentState: (wrapper, hasSvg) => this.setPageWrapperContentState(wrapper, hasSvg),
                applyFluffImageVisibilityToSvg: (svg, shouldShowFluff) => this.pageViewerPresentation.applyFluffImageVisibilityToSvg(svg, shouldShowFluff),
                onShadowClick: (descriptor, wrapper, event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.navigateToShadowPage(descriptor.unit, descriptor.unitIndex, wrapper, 'shadow');
                }
            });

            this.syncZoomPanTransformTargets();
            options.onReady?.(this.shadowPageElements);
        }, { injector: this.injector });
    }

    private upsertTransientShadowPage(
        descriptor: PageViewerShadowDescriptor,
        scale: number,
        showFluff: boolean,
        options: {
            onReady?: (wrapper: HTMLDivElement) => void;
        } = {}
    ): void {
        this.pageViewerState.transientShadowPages.update((currentShadows) => {
            if (currentShadows.some((shadow) => shadow.key === descriptor.key)) {
                return currentShadows.map((shadow) => shadow.key === descriptor.key ? descriptor : shadow);
            }

            return [...currentShadows, descriptor];
        });

        this.renderDeclarativeShadowPages(scale, showFluff, {
            requireAnimation: options.onReady === undefined,
            onReady: options.onReady
                ? (wrappers) => {
                    const matchingWrapper = wrappers.find((wrapper) => wrapper.dataset['shadowKey'] === descriptor.key);
                    if (matchingWrapper) {
                        options.onReady?.(matchingWrapper);
                    }
                }
                : undefined
        });
    }

    private queueDirectionalNavigation(direction: 'left' | 'right'): void {
        this.pendingDirectionalNavigation += direction === 'right' ? 1 : -1;
    }

    private flushQueuedDirectionalNavigation(): void {
        if (this.pendingDirectionalNavigation === 0 || this.isSwiping || this.pageViewerSwipeAnimation.hasActiveAnimation()) {
            return;
        }

        const nextDirection = this.pendingDirectionalNavigation > 0 ? 'right' : 'left';
        this.pendingDirectionalNavigation = nextDirection === 'right'
            ? Math.max(0, this.pendingDirectionalNavigation - 1)
            : Math.min(0, this.pendingDirectionalNavigation + 1);

        this.navigateByDirection(nextDirection);
    }

    private interruptDirectionalNavigation(nextDirection: 'left' | 'right'): void {
        if (!this.pageViewerSwipeAnimation.hasActiveAnimation()) {
            this.queueDirectionalNavigation(nextDirection);
            this.flushQueuedDirectionalNavigation();
            return;
        }

        const pendingPagesToMove = this.pageViewerSwipeAnimation.getPendingPagesToMove();
        const currentDirection = pendingPagesToMove > 0
            ? 'right'
            : pendingPagesToMove < 0
                ? 'left'
                : null;

        if (currentDirection && currentDirection !== nextDirection) {
            this.reverseDirectionalNavigationToOrigin();
            return;
        }

        this.queueDirectionalNavigation(nextDirection);

        const committedTargetUnitId = this.pageViewerNavigation.getTransitionTargetUnitId();
        const committedTargetUnit = committedTargetUnitId
            ? this.forceUnits().find((unit) => unit.id === committedTargetUnitId) as CBTForceUnit | undefined
            : undefined;

        this.cancelSwipeAnimation({ applyPendingMove: true, resetTransform: true });

        if (committedTargetUnit) {
            this.pageViewerNavigation.suppressNextSelectionRedisplay();
            this.forceBuilder.selectUnit(committedTargetUnit);
            this.pageViewerNavigation.finishTransition(this.viewStartIndex(), committedTargetUnit.id);
        } else {
            this.pageViewerNavigation.cancelTransition();
        }

        this.displayUnit({ fromSwipe: true });
    }

    private finalizeSwipeSlotVisibility(options: {
        addOnly: boolean;
        displayedUnitIds: Set<string>;
        winningUnitIndices: Iterable<number>;
    }): void {
        const { addOnly, displayedUnitIds, winningUnitIndices } = options;
        const nextDisplayedUnits = this.pageViewerSwipeDom.resolveDisplayedUnits({
            addOnly,
            winningUnitIndices,
            units: this.forceUnits() as CBTForceUnit[]
        });

        if (!nextDisplayedUnits) {
            return;
        }

        this.displayedUnits.set(nextDisplayedUnits);
        this.cleanupUnusedCanvasOverlays(displayedUnitIds);
        this.cleanupUnusedInteractionOverlays(displayedUnitIds);
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

        const totalTranslateX = translate.x + translateX;
        const visibleLeft = -totalTranslateX;
        const visibleRight = visibleLeft + containerWidth;
        const visiblePages = this.effectiveVisiblePageCount();
        const scaledPageWidth = PAGE_WIDTH * scale;
        const allUnits = this.forceUnits();
        const slotStates = this.pageViewerSwipeDom.buildSlotStates({
            swipeSlots: this.swipeSlots,
            swipeSlotUnitAssignments: this.swipeSlotUnitAssignments,
            swipeSlotSvgs: this.swipeSlotSvgs,
            scaledPageWidth
        });
        const renderUpdate = this.pageViewerSwipeRenderer.buildUpdate({
            slots: slotStates,
            units: allUnits.map((unit) => ({
                unitId: unit.id,
                svg: unit.svg()
            })),
            visibleLeft,
            visibleRight,
            scaledPageWidth,
            visiblePages,
            addOnly,
            translateX,
            lastTranslateX: this.lastSwipeTranslateX,
            currentDirection: this.swipeDirection,
            selectedUnitId: this.unit()?.id ?? null
        });

        this.swipeDirection = renderUpdate.nextDirection;
        this.lastSwipeTranslateX = renderUpdate.nextLastTranslateX;

        const displayedUnitIds = this.pageViewerSwipeDom.applyRenderUpdate({
            addOnly,
            slotStates,
            swipeSlotSvgs: this.swipeSlotSvgs,
            renderUpdate,
            resolveUnit: (unitIndex) => allUnits[unitIndex] as CBTForceUnit | undefined,
            scale,
            visiblePages,
            readOnly: this.readOnly(),
            showFluff: this.optionsService.options().recordSheetCenterPanelContent === 'fluffImage',
            setPageWrapperContentState: (wrapper, hasSvg) => this.setPageWrapperContentState(wrapper, hasSvg),
            setWrapperSelectedState: (wrapper, isSelected) => this.setWrapperSelectedState(wrapper, isSelected),
            setSwipeNeighborVisibilityState: (wrapper, isVisible) => this.setSwipeNeighborVisibilityState(wrapper, isVisible),
            attachSvgToWrapper: (options) => this.attachSvgToWrapper(options),
            applyFluffImageVisibilityToSvg: (svg, showFluff) => this.pageViewerPresentation.applyFluffImageVisibilityToSvg(svg, showFluff),
            bindWrapperInteractiveLayers: (wrapper, unit, svg, overlayMode) => this.bindWrapperInteractiveLayers(wrapper, unit, svg, overlayMode),
            getOrCreateInteractionOverlay: (wrapper, unit, overlayMode) => this.getOrCreateInteractionOverlay(wrapper, unit, overlayMode)
        });

        this.finalizeSwipeSlotVisibility({
            addOnly,
            displayedUnitIds,
            winningUnitIndices: renderUpdate.winningUnitIndices
        });
    }

    /**
     * Cleans up swipe-specific state after swipe ends.
     */
    private cleanupSwipeState(): void {
        this.cancelPendingSwipeFrame();

        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        swipeWrapper.style.transition = '';
        swipeWrapper.style.transform = '';
        this.isSwiping = false;
        this.pageViewerSwipeAnimation.cancel({ swipeWrapper });
        this.pageViewerSwipeFrame.clear();
        this.lastSwipeVisibleOffsets = null;
        this.pageViewerSwipeLoad.clear();
        this.containerRef().nativeElement.classList.remove('swiping');

        const slotState = this.pageViewerSwipeDom.resetSlots({
            content: this.contentRef().nativeElement,
            swipeSlots: this.swipeSlots
        });
        this.swipeSlots = slotState.swipeSlots;
        this.swipeSlotUnitAssignments = slotState.swipeSlotUnitAssignments;
        this.swipeSlotSvgs = slotState.swipeSlotSvgs;
        this.swipeTotalSlots = slotState.swipeTotalSlots;
        this.swipeBasePositions = [];
        const resetState = this.pageViewerSwipeSession.buildResetState();
        this.baseDisplayStartIndex = resetState.baseDisplayStartIndex;
        this.swipeDirection = resetState.swipeDirection;
        this.lastSwipeTranslateX = resetState.lastSwipeTranslateX;
        this.lastSwipeVisibleOffsets = resetState.lastSwipeVisibleOffsets;
        this.swipeLeftmostOffset = resetState.swipeLeftmostOffset;
        this.swipeRightmostOffset = resetState.swipeRightmostOffset;
        this.swipeAllUnits = resetState.swipeAllUnits;
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

    private getOrCreateCanvasOverlay(pageWrapper: HTMLDivElement, unit: CBTForceUnit): void {
        this.pageViewerOverlay.getOrCreateCanvasOverlay({
            appRef: this.appRef,
            injector: this.injector,
            pageWrapper,
            unit,
            onDrawingStarted: (drawnUnit) => this.forceBuilder.selectUnit(drawnUnit)
        });
    }

    /**
     * Cleans up canvas overlays that are no longer displayed.
     * Keeps canvas overlays for currently displayed units to prevent flickering.
     */
    private cleanupUnusedCanvasOverlays(keepUnitIds: Set<string>): void {
        this.pageViewerOverlay.cleanupUnusedCanvasOverlays(this.appRef, keepUnitIds);
    }

    /**
     * Cleans up all canvas overlay component refs.
     */
    private cleanupCanvasOverlays(): void {
        this.pageViewerOverlay.cleanupCanvasOverlays(this.appRef);
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
    ): void {
        this.pageViewerOverlay.getOrCreateInteractionOverlay({
            appRef: this.appRef,
            injector: this.injector,
            pageWrapper,
            fixedOverlayContainer: this.fixedOverlayContainerRef().nativeElement,
            unit,
            force: this.force(),
            mode
        });
    }

    /**
     * Cleans up interaction overlays that are no longer displayed.
     * Keeps interaction overlays for currently displayed units to prevent flickering.
     */
    private cleanupUnusedInteractionOverlays(keepUnitIds: Set<string>): void {
        this.pageViewerOverlay.cleanupUnusedInteractionOverlays(this.appRef, keepUnitIds);
    }

    /**
     * Cleans up all interaction overlay component refs.
     */
    private cleanupInteractionOverlays(): void {
        this.pageViewerOverlay.cleanupInteractionOverlays(this.appRef);
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
        this.pageViewerOverlay.closeInteractionOverlays();
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

    private captureCurrentViewState(): ViewportTransform {
        this.lastViewState = this.pageViewerEffectState.captureViewStateSnapshot(this.zoomPanService.viewState());

        return this.lastViewState;
    }

    private handleResize(): void {
        const previousVisibleCount = this.effectiveVisiblePageCount();
        this.updateDimensions();
        this.zoomPanService.handleResize();
        this.pageViewerViewState.saveSharedViewState(this.captureCurrentViewState());

        const newVisibleCount = this.effectiveVisiblePageCount();
        const resizePlan = this.pageViewerUiGlue.buildResizePlan({
            previousVisibleCount,
            nextVisibleCount: newVisibleCount,
            hasCurrentUnit: !!this.unit(),
            initialRenderComplete: this.initialRenderComplete,
            shadowPagesEnabled: this.shadowPages(),
            totalUnits: this.forceUnits().length,
            renderedShadowCount: this.shadowPageComponentRefs().length
        });

        if (resizePlan.shouldCloseInteractionOverlays) {
            this.closeInteractionOverlays();
        }

        if (resizePlan.shouldRedisplay) {
            this.displayUnit({ fromSwipe: true });
            return;
        }

        if (resizePlan.shouldScheduleShadowRender) {
            this.scheduleRenderShadowPages();
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
        if (event.repeat) return;

        if (event.key === 'ArrowLeft') {
            if (this.activeDirectionalKey === 'left') {
                event.preventDefault();
                return;
            }
            this.activeDirectionalKey = 'left';
            this.handleArrowNavigation('left');
            event.preventDefault();
        } else if (event.key === 'ArrowRight') {
            if (this.activeDirectionalKey === 'right') {
                event.preventDefault();
                return;
            }
            this.activeDirectionalKey = 'right';
            this.handleArrowNavigation('right');
            event.preventDefault();
        }
    }

    onWindowKeyUp(event: KeyboardEvent): void {
        if (event.key === 'ArrowLeft' && this.activeDirectionalKey === 'left') {
            this.activeDirectionalKey = null;
            this.pendingDirectionalNavigation = 0;
        } else if (event.key === 'ArrowRight' && this.activeDirectionalKey === 'right') {
            this.activeDirectionalKey = null;
            this.pendingDirectionalNavigation = 0;
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
        const displayedUnits = this.displayedUnits();
        const selectedIndex = displayedUnits.findIndex(u => u.id === currentUnit.id);
        
        if (direction === 'left') {
            // Can we move selection left within visible pages?
            if (selectedIndex > 0) {
                // Select the previous visible unit
                this.forceBuilder.selectUnit(displayedUnits[selectedIndex - 1]);
            } else if (this.hasPrev()) {
                // At left boundary with more pages before, navigate to previous page
                this.navigateByDirection('left');
            } else if (totalUnits > this.effectiveVisiblePageCount()) {
                // At left boundary and at the start of the list, loop to the end
                this.navigateByDirection('left');
            }
        } else {
            // Can we move selection right within visible pages?
            if (selectedIndex >= 0 && selectedIndex < displayedUnits.length - 1) {
                // Select the next visible unit
                this.forceBuilder.selectUnit(displayedUnits[selectedIndex + 1]);
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

        if (this.pageViewerSwipeAnimation.hasActiveAnimation()) {
            this.interruptDirectionalNavigation(direction);
            return;
        }
        
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
            this.navigateToShadowPage(targetUnit, targetIndex, existingShadow, 'keyboard');
            return;
        }
        
        // No shadow page exists - create temporary one and animate
        this.closeInteractionOverlays();
        const navigationVersion = ++this.asyncNavigationVersion;
        
        // Load target unit first
        targetUnit.load().then(() => {
            const currentUnits = this.forceUnits();
            const currentEffectiveVisible = this.effectiveVisiblePageCount();
            const currentStart = this.viewStartIndex();

            if (navigationVersion !== this.asyncNavigationVersion
                || this.isSwiping
                || currentStart !== currentStartIndex
                || currentEffectiveVisible !== effectiveVisible
                || currentUnits.length === 0) {
                return;
            }

            const resolvedTargetIndex = direction === 'left'
                ? (currentStart - 1 + currentUnits.length) % currentUnits.length
                : (currentStart + currentEffectiveVisible) % currentUnits.length;

            if (resolvedTargetIndex !== targetIndex || currentUnits[resolvedTargetIndex] !== targetUnit) {
                return;
            }

            const svg = targetUnit.svg();
            if (!svg) {
                // Fallback to instant navigation if no SVG
                this.pageViewerNavigation.suppressNextSelectionRedisplay();
                this.forceBuilder.selectUnit(targetUnit);
                this.pageViewerNavigation.startTransition(
                    this.pageViewerNavigation.buildRequest(direction, 'keyboard'),
                    targetUnit.id
                );
                this.pageViewerNavigation.finishTransition(currentStartIndex + pagesToMove, targetUnit.id);
                this.displayUnit({ fromSwipe: true });
                return;
            }
            
            const scale = this.zoomPanService.scale();
            const scaledPageStep = (PAGE_WIDTH + PAGE_GAP) * scale;
            
            // Get position for the incoming page
            const displayedPositions = this.zoomPanService.getPagePositions(effectiveVisible);
            const basePosition = direction === 'left'
                ? (displayedPositions[0] ?? 0) * scale - scaledPageStep
                : ((displayedPositions[effectiveVisible - 1] ?? 0) * scale) + scaledPageStep;

            // Apply fluff visibility
            const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
            const showFluff = centerContent === 'fluffImage';
            const shadowKey = this.getShadowKey(targetIndex, direction);

            this.upsertTransientShadowPage({
                key: shadowKey,
                unit: targetUnit,
                unitId: targetUnit.id,
                unitIndex: targetIndex,
                direction,
                originalLeft: basePosition / scale,
                scaledLeft: basePosition,
                isDimmed: true
            }, scale, showFluff, {
                onReady: (wrapper) => {
                    if (this.pageViewerSwipeAnimation.hasActiveAnimation() || this.isSwiping) {
                        return;
                    }

                    this.navigateToShadowPage(targetUnit, targetIndex, wrapper, 'keyboard');
                }
            });
        });
    }

    // ========== Unit Display ==========

    private displayUnit(options: { fromSwipe?: boolean } = {}): void {
        this.asyncNavigationVersion++;

        const currentUnit = this.unit();
        const content = this.contentRef().nativeElement;
        const fromSwipe = options.fromSwipe ?? false;

        // Close any open interaction overlays when recreating pages
        this.closeInteractionOverlays();
        
        // Note: Shadow pages are cleaned up smartly in renderPages() to avoid flicker

        // Clear existing page DOM elements
        this.pageElements = this.pageViewerActiveDisplay.clearActivePageElements(content, this.pageElements);
        this.displayedUnits.set([]);

        this.loadError.set(null);
        this.currentSvg.set(null);

        const displayPreparation = this.pageViewerActiveDisplay.prepareDisplay({
            currentUnit,
            allUnits: this.forceUnits() as CBTForceUnit[],
            visiblePages: this.effectiveVisiblePageCount(),
            viewStartIndex: this.viewStartIndex()
        });
        if (!displayPreparation.canRender) {
            this.loadError.set(displayPreparation.loadError);
            return;
        }

        this.displayedUnits.set(displayPreparation.displayedUnits);

        // Capture version to detect stale callbacks
        const currentVersion = ++this.displayVersion;

        // Load all displayed units first
        const loadPromises = this.displayedUnits().map(u => u.load());

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
        const visiblePages = this.effectiveVisiblePageCount();
        const totalUnits = allUnits.length;

        if (totalUnits === 0) {
            this.clearPages();
            return;
        }
        const inPlacePreparation = this.pageViewerActiveDisplay.prepareInPlaceUpdate({
            allUnits: allUnits as CBTForceUnit[],
            visiblePages,
            viewStartIndex: this.viewStartIndex(),
            currentWrapperUnitIds: this.pageElements.map((element) => element.dataset['unitId'] ?? ''),
            preserveSelectedUnitId
        });
        const { expectedUnits, patchPlan } = inPlacePreparation;

        // If wrapper count doesn't match, fall back to full render
        if (!patchPlan.canPatchInPlace) {
            this.displayUnit();
            return;
        }

        // Capture version to avoid stale async updates
        const currentVersion = ++this.displayVersion;
        const loadPromises = expectedUnits.map(u => u.load());

        Promise.all(loadPromises).then(() => {
            if (this.displayVersion !== currentVersion) {
                return;
            }

            const displayedUnitIds = new Set<string>();
            const activeDescriptors = this.rewriteActivePages();

            for (const slotPlan of patchPlan.slots) {
                const unit = slotPlan.unit;
                const wrapper = this.pageElements[slotPlan.slotIndex];
                if (!unit || !wrapper) continue;

                displayedUnitIds.add(unit.id);

                // Preserve the selected unit's existing wrapper/SVG to prevent flicker.
                if (slotPlan.preserveExisting) {
                    continue;
                }
                this.bindActivePageWrapper({
                    unit,
                    wrapper,
                    slotIndex: slotPlan.slotIndex,
                    descriptor: activeDescriptors[slotPlan.slotIndex]
                });
            }

            // Replace displayed units (model) without rebuilding wrappers
            this.displayedUnits.set(expectedUnits);
            this.finalizeActivePageRender(displayedUnitIds, { applyCurrentTransform: true });
        });
    }

    private renderPages(options: { fromSwipe?: boolean } = {}): void {
        const fromSwipe = options.fromSwipe ?? false;
        const renderVersion = this.displayVersion;

        afterNextRender(() => {
            if (this.displayVersion !== renderVersion) {
                return;
            }

            this.pageElements = this.activePageComponentRefs().map(component => component.nativeElement);

            // Smart cleanup: remove only shadows that will overlap with active sheets
            // This prevents the "blink" effect when transitioning
            const activeUnitIds = new Set(this.displayedUnits().map(u => u.id));
            this.shadowPageElements = this.pageViewerActiveRender.pruneOverlappingShadows({
                shadowPageElements: this.shadowPageElements,
                activeUnitIds,
                removeShadowPageElement: (element) => this.removeShadowPageElement(element)
            });

            const displayedUnitIds = new Set<string>();
            const activeDescriptors = this.rewriteActivePages();

            this.displayedUnits().forEach((unit, index) => {
                const pageWrapper = this.pageElements[index];
                if (!pageWrapper) {
                    return;
                }

                displayedUnitIds.add(unit.id);
                const descriptor = activeDescriptors[index];
                this.bindActivePageWrapper({
                    unit,
                    wrapper: pageWrapper,
                    slotIndex: index,
                    descriptor
                });
            });
            this.finalizeActivePageRender(displayedUnitIds, { fromSwipe });
        }, { injector: this.injector });
    }

    private bindActivePageWrapper(options: {
        unit: CBTForceUnit;
        wrapper: HTMLDivElement;
        slotIndex: number;
        descriptor: PageViewerPageDescriptor | undefined;
    }): void {
        this.pageViewerActiveRender.bindActivePageWrapper({
            ...options,
            setWrapperSelectedState: (wrapper, isSelected) => this.setWrapperSelectedState(wrapper, isSelected),
            applyWrapperLayout: (wrapper, layoutOptions) => this.applyWrapperLayout(wrapper, layoutOptions),
            attachSvgToWrapper: (attachOptions) => this.attachSvgToWrapper(attachOptions),
            bindWrapperInteractiveLayers: (wrapper, unit, svg, overlayMode) => this.bindWrapperInteractiveLayers(wrapper, unit, svg, overlayMode)
        });
    }

    private finalizeActivePageRender(
        displayedUnitIds: Set<string>,
        options: {
            fromSwipe?: boolean;
            applyCurrentTransform?: boolean;
        } = {}
    ): void {
        this.cleanupUnusedInteractionServices(displayedUnitIds);
        this.cleanupUnusedCanvasOverlays(displayedUnitIds);
        this.cleanupUnusedInteractionOverlays(displayedUnitIds);

        this.zoomPanService.setDisplayedPages(this.pageElements.length);
        this.syncZoomPanTransformTargets();

        const finalizePlan = this.pageViewerActiveRender.buildFinalizePlan({
            applyCurrentTransform: options.applyCurrentTransform ?? false,
            initialRenderComplete: this.initialRenderComplete,
            fromSwipe: options.fromSwipe ?? false
        });

        if (finalizePlan.shouldApplyCurrentTransform) {
            this.zoomPanService.applyCurrentTransform();
        } else if (finalizePlan.shouldResetView) {
            this.updateDimensions();
            this.zoomPanService.resetView();
        } else if (finalizePlan.shouldRestoreViewState) {
            this.updateDimensions();
            this.restoreViewState({ fromSwipe: finalizePlan.fromSwipe });
        }

        this.setFluffImageVisibility();
        this.scheduleRenderShadowPages();

        if (finalizePlan.shouldFlushQueuedDirectionalNavigation) {
            this.flushQueuedDirectionalNavigation();
        }

        if (finalizePlan.shouldMarkInitialRenderComplete) {
            this.initialRenderComplete = true;
        }
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
    private async renderShadowPages(renderVersion: number = this.shadowRenderVersion): Promise<void> {
        const content = this.contentRef().nativeElement;

        if (renderVersion !== this.shadowRenderVersion || this.isSwiping) {
            return;
        }
        
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
        // Get the positions of the currently displayed pages (these are unscaled)
        const displayedPositions = this.zoomPanService.getPagePositions(effectiveVisible);
        
        // Get container dimensions and translate to calculate visible area
        const container = this.containerRef().nativeElement;
        const containerWidth = container.clientWidth;
        const translate = this.zoomPanService.translate();
        const desiredShadows = this.pageViewerRenderModel.buildSteadyStateShadowPages({
            units: allUnits as CBTForceUnit[],
            startIndex,
            visibleCount: effectiveVisible,
            scale,
            containerWidth,
            translateX: translate.x,
            displayedPositions
        });

        this.shadowPageCleanups.forEach(cleanup => cleanup());
        this.shadowPageCleanups = [];
        this.pageViewerState.transientShadowPages.set([]);

        for (const element of this.shadowPageElements) {
            if (element.dataset['renderMode'] !== 'declarative-shadow') {
                this.removeShadowPageElement(element);
            }
        }

        if (desiredShadows.length === 0) {
            this.pageViewerState.shadowPages.set([]);
            this.shadowPageElements = [];
            this.pageViewerPresentation.setShadowFluffImageVisibility(this.shadowPageElements, false);
            this.syncZoomPanTransformTargets();
            return;
        }
        
        // Pre-load shadow units to ensure SVGs are available
        const shadowUnits = desiredShadows.map(s => allUnits[s.unitIndex] as CBTForceUnit).filter(u => u);
        await Promise.all(shadowUnits.map(u => u.load()));

        if (renderVersion !== this.shadowRenderVersion || this.isSwiping) {
            return;
        }
        
        const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
        const showFluff = centerContent === 'fluffImage';

        this.pageViewerState.shadowPages.set(desiredShadows);
        this.renderDeclarativeShadowPages(scale, showFluff, { renderVersion });
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
    private navigateToShadowPage(
        unit: CBTForceUnit,
        targetIndex: number,
        clickedShadow: HTMLDivElement,
        source: 'keyboard' | 'shadow' = 'shadow'
    ): void {
        // Cancel any pending animation callback from a previous navigation
        if (this.pageViewerSwipeAnimation.hasActiveAnimation()) {
            this.cancelSwipeAnimation({ applyPendingMove: true, resetTransform: true });
            this.pageViewerNavigation.cancelTransition();
            this.displayUnit({ fromSwipe: true });
            return;
        }

        const allUnits = this.forceUnits();
        const totalUnits = allUnits.length;
        const currentStartIndex = this.viewStartIndex();
        const effectiveVisible = this.effectiveVisiblePageCount();
        const direction = clickedShadow.dataset['shadowDirection'];
        const scale = this.zoomPanService.scale();
        const shadowNavigationPlan = this.pageViewerShadowNavigation.buildPlan({
            rawDirection: direction ?? undefined,
            source,
            unitId: unit.id,
            currentStartIndex,
            effectiveVisible,
            targetIndex,
            totalUnits,
            scale
        });
        
        // Remove any stale 'leaving-page' classes from previous interrupted animations
        this.pageElements.forEach(el => this.renderer.removeClass(el, 'leaving-page'));

        if (shadowNavigationPlan.shouldStartTransition) {
            this.pageViewerViewState.saveSharedViewState(this.captureCurrentViewState());
            this.pageViewerShadowNavigation.startTransitionIfNeeded({
                plan: shadowNavigationPlan,
                source,
                unitId: unit.id
            });
        }
        
        // Replace the cloned SVG with the real SVG in the shadow wrapper
        // This prevents the "black flash" when the shadow is cleared
        const realSvg = unit.svg();
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
            this.pageViewerPresentation.applyFluffImageVisibilityToSvg(realSvg, showFluff);

            // Promote the clicked shadow visually without mutating its declarative base class.
            this.setPromotedShadowState(clickedShadow, true);
        }
        
        // Create incoming shadow pages that will slide into view during animation
        // These are the pages beyond the clicked shadow in the direction of movement
        if (direction) {
            this.createIncomingShadowPages(clickedShadow, targetIndex, direction, shadowNavigationPlan.pagesToMove, scale, showFluff, allUnits as CBTForceUnit[]);
        }

        const swipeWrapper = this.swipeWrapperRef().nativeElement;
        
        // Store state for animation
        this.swipeVersion++;
        this.pageViewerSwipeAnimation.setPendingPagesToMove(shadowNavigationPlan.pagesToMove);
        this.baseDisplayStartIndex = currentStartIndex;
        
        const animationVersion = this.swipeVersion;

        this.startSwipeAnimation({
            durationMs: 300,
            easing: 'ease-out',
            transform: `translate3d(${shadowNavigationPlan.targetOffset}px, 0, 0)`,
            onComplete: () => {
                this.pageViewerSwipeAnimation.clearPendingPagesToMove();
                
                if (this.swipeVersion !== animationVersion) {
                    return;
                }
                
                // Update view start index
                this.pageViewerNavigation.finishTransition(shadowNavigationPlan.nextViewStartIndex, unit.id);

                // Reset wrapper transform before re-rendering the steady-state layout.
                swipeWrapper.style.transition = 'none';
                swipeWrapper.style.transform = '';
                
                // Note: Don't clear shadow pages here - displayUnit will do smart cleanup
                
                // Select the clicked shadow page's unit (after animation to prevent early re-render)
                this.pageViewerNavigation.suppressNextSelectionRedisplay();
                this.forceBuilder.selectUnit(unit);
                this.pageViewerState.transientShadowPages.set([]);
                
                // Re-render with new position
                this.displayUnit({ fromSwipe: true });
            }
        });
    }
    
    /**
     * Creates shadow pages for the units that will slide into view during animation.
     * These are positioned beyond the current visible area in the direction of movement.
     */
    private createIncomingShadowPages(
        clickedShadow: HTMLDivElement,
        targetIndex: number,
        direction: string,
        pagesToMove: number,
        scale: number,
        showFluff: boolean,
        allUnits: CBTForceUnit[]
    ): void {
        this.pageViewerShadowRender.createIncomingShadowPages({
            clickedShadow,
            targetIndex,
            direction: direction === 'right' ? 'right' : 'left',
            pagesToMove,
            scale,
            showFluff,
            allUnits,
            shadowPageElements: this.shadowPageElements,
            activeUnitIds: new Set(this.displayedUnits().map((unit) => unit.id)),
            getShadowKey: (unitIndex, shadowDirection) => this.getShadowKey(unitIndex, shadowDirection),
            isAnimationActive: () => this.pageViewerSwipeAnimation.hasActiveAnimation(),
            upsertTransientShadowPage: (descriptor, shadowScale, shouldShowFluff) => this.upsertTransientShadowPage(descriptor, shadowScale, shouldShowFluff)
        });
    }

    /**
     * Clears all shadow page elements.
     */
    private clearShadowPages(): void {
        this.cancelScheduledShadowRender();
        this.pageViewerState.shadowPages.set([]);
        this.pageViewerState.transientShadowPages.set([]);

        const clearedState = this.pageViewerShadowRender.clearShadowPages({
            shadowPageElements: this.shadowPageElements,
            shadowPageCleanups: this.shadowPageCleanups
        });
        this.shadowPageElements = clearedState.shadowPageElements;
        this.shadowPageCleanups = clearedState.shadowPageCleanups;
        this.syncZoomPanTransformTargets();
    }
    
    private clearPages(): void {
        // Clear shadow pages first
        this.clearShadowPages();
        
        // Remove page elements from DOM and clear references
        this.pageElements.forEach(el => {
            if (el.dataset['renderMode'] !== 'declarative' && el.parentElement) {
                el.parentElement.removeChild(el);
            }
            el.innerHTML = '';
        });
        this.pageElements = [];
        this.displayedUnits.set([]);
        this.syncZoomPanTransformTargets();
    }

    private getTotalPageCount(): number {
        return Math.max(1, this.forceUnits().length);
    }

    // ========== View State Management ==========

    private saveViewState(unit: CBTForceUnit): void {
        this.pageViewerViewState.saveUnitViewState(unit, this.captureCurrentViewState());
    }

    private restoreViewState(options: { fromSwipe?: boolean } = {}): void {
        const syncZoom = this.optionsService.options().syncZoomBetweenSheets;
        const isMultiPageMode = this.effectiveVisiblePageCount() > 1;
        const isSwipe = options.fromSwipe ?? false;

        const restoredViewState = this.pageViewerViewState.resolveRestoredViewState({
            unit: this.unit(),
            syncZoomBetweenSheets: syncZoom,
            isMultiPageMode,
            fromSwipe: isSwipe
        }) ?? this.lastViewState;

        this.zoomPanService.restoreViewState(restoredViewState);
    }

    /**
     * Sets the visibility of fluff images vs reference tables in all displayed SVGs.
     * Controlled by the recordSheetCenterPanelContent option.
     */
    private setFluffImageVisibility(): void {
        const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
        const showFluff = centerContent === 'fluffImage';

        this.pageViewerPresentation.setDisplayedFluffImageVisibility(this.displayedUnits(), showFluff);
        this.pageViewerPresentation.setShadowFluffImageVisibility(this.shadowPageElements, showFluff);
    }

    /**
     * Setup a capture-phase click listener to detect page clicks.
     * Using capture phase ensures we see the click before any stopPropagation.
     */
    private setupPageClickCapture(): void {
        if (this.readOnly()) return;
        
        const container = this.containerRef().nativeElement;
        
        const handlePageSelection = (event: Event) => {
            const clickedUnit = this.pageViewerUiGlue.resolvePageSelectionUnit({
                eventTarget: event.target,
                pointerMoved: this.zoomPanService.pointerMoved,
                isPanning: this.zoomPanService.isPanning,
                isSwiping: this.isSwiping,
                displayedUnits: this.displayedUnits(),
                currentUnitId: this.unit()?.id ?? null
            });

            if (clickedUnit) {
                this.forceBuilder.selectUnit(clickedUnit);
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

        const forceChangePlan = this.pageViewerForceChange.buildActionPlan({
            allUnits: allUnits as CBTForceUnit[],
            displayedUnits: this.displayedUnits(),
            selectedUnitId: this.unit()?.id ?? null,
            visibleCount: this.effectiveVisiblePageCount(),
            previousUnitCount,
            currentViewStartIndex: this.viewStartIndex(),
            hasPageElements: this.pageElements.length > 0
        });

        if (forceChangePlan.shouldClearPages) {
            this.clearPages();
        }
        if (forceChangePlan.shouldClearShadows) {
            this.clearShadowPages();
        }

        if (forceChangePlan.shouldClearPages || forceChangePlan.shouldClearShadows) {
            return;
        }

        if (forceChangePlan.shouldUpdateDimensions) {
            this.updateDimensions();
        }

        if (forceChangePlan.nextViewStartIndex !== null) {
            this.viewStartIndex.set(forceChangePlan.nextViewStartIndex);
        }

        if (forceChangePlan.shouldCloseInteractionOverlays) {
            this.closeInteractionOverlays();
        }

        if (forceChangePlan.renderStrategy === 'in-place' && forceChangePlan.preserveSelectedUnitId) {
            this.updateDisplayedPagesInPlace({ preserveSelectedUnitId: forceChangePlan.preserveSelectedUnitId });
        } else if (forceChangePlan.renderStrategy === 'full') {
            this.displayUnit();
        }
    }

    // ========== Cleanup ==========

    private cleanup(): void {
        this.pendingDirectionalNavigation = 0;
        this.pageViewerState.reset();
        this.pageViewerViewState.clearAll();

        // Cancel any pending swipe animation
        if (this.pageViewerSwipeAnimation.hasActiveAnimation()) {
            this.cancelSwipeAnimation();
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
    }
}
