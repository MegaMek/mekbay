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

import { CommonModule } from '@angular/common';
import { Component, signal, ElementRef, computed, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, input, viewChild, ChangeDetectorRef, DestroyRef, untracked, ComponentRef } from '@angular/core';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { UnitSearchFiltersService, SORT_OPTIONS, SortOption, SerializedSearchFilter } from '../../services/unit-search-filters.service';
import { HighlightToken, tokenizeForHighlight } from '../../utils/semantic-filter-ast.util';
import { Unit } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { LongPressDirective } from '../../directives/long-press.directive';
import { SearchFavoritesMenuComponent } from '../search-favorites-menu/search-favorites-menu.component';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ShareSearchDialogComponent } from './share-search.component';
import { SemanticGuideDialogComponent } from '../semantic-guide-dialog/semantic-guide-dialog.component';
import { SemanticGuideComponent } from '../semantic-guide/semantic-guide.component';
import { highlightMatches } from '../../utils/search.util';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, TagClickEvent } from '../unit-tags/unit-tags.component';
import { RangeModel, UnitSearchFilterRangeDialogComponent, UnitSearchFilterRangeDialogData } from '../unit-search-filter-range-dialog/unit-search-filter-range-dialog.component';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { TaggingService } from '../../services/tagging.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { SyntaxInputComponent } from '../syntax-input/syntax-input.component';
import { SavedSearchesService } from '../../services/saved-searches.service';
import { generateUUID } from '../../services/ws.service';
import { GameSystem } from '../../models/common.model';
import { UnitDetailsPanelComponent } from '../unit-details-panel/unit-details-panel.component';
import { UnitCardExpandedComponent } from '../unit-card-expanded/unit-card-expanded.component';

@Component({
    selector: 'unit-search',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, RangeSliderComponent, LongPressDirective, MultiSelectDropdownComponent, AdjustedPV, FormatNumberPipe, UnitIconComponent, UnitTagsComponent, SyntaxInputComponent, SemanticGuideComponent, UnitDetailsPanelComponent, UnitCardExpandedComponent],
    templateUrl: './unit-search.component.html',
    styleUrl: './unit-search.component.scss',
    host: {
        '(keydown)': 'onKeydown($event)'
    }
})
export class UnitSearchComponent {
    layoutService = inject(LayoutService);
    filtersService = inject(UnitSearchFiltersService);
    dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    gameService = inject(GameService);
    overlayManager = inject(OverlayManagerService);

    private destroyRef = inject(DestroyRef);
    private injector = inject(Injector);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private cdr = inject(ChangeDetectorRef);
    private abilityLookup = inject(AsAbilityLookupService);
    private optionsService = inject(OptionsService);
    private taggingService = inject(TaggingService);
    private savedSearchesService = inject(SavedSearchesService);

    readonly useHex = computed(() => this.optionsService.options().ASUseHex);
    /** Whether the layout is filters-list-panel (filters on left) */
    readonly filtersOnLeft = computed(() => this.optionsService.options().unitSearchExpandedViewLayout === 'filters-list-panel');

    public readonly SORT_OPTIONS = SORT_OPTIONS;
    
    readonly dropdownFilters = this.filtersService.dropdownConfigs;
    readonly rangeFilters = this.filtersService.rangeConfigs;

    private searchDebounceTimer: any;
    private heightTrackingDebounceTimer: any;
    private readonly SEARCH_DEBOUNCE_MS = 300;
    /** Reference to the favorites overlay component for in-place updates. */
    private favoritesCompRef: ComponentRef<SearchFavoritesMenuComponent> | null = null;
    /** Flag to track when a favorites dialog (rename/delete) is in progress. */
    private favoritesDialogActive = false;
    /** Immediate input value for instant highlighting (not debounced). */
    readonly immediateSearchText = signal('');

    syntaxInput = viewChild<SyntaxInputComponent>('syntaxInput');
    advBtn = viewChild.required<ElementRef<HTMLButtonElement>>('advBtn');
    favBtn = viewChild.required<ElementRef<HTMLButtonElement>>('favBtn');
    advPanel = viewChild<ElementRef<HTMLElement>>('advPanel');
    
    /** Query the active dropdown element directly from DOM to avoid viewChild retention */
    private getActiveDropdownElement(): HTMLElement | null {
        return document.querySelector('.results-dropdown') as HTMLElement | null;
    }
    
    /** viewChild for CdkVirtualScrollViewport - only used for scrolling operations!!! */
    private viewport = viewChild(CdkVirtualScrollViewport);

    gameSystem = computed(() => this.gameService.currentGameSystem());
    autoFocus = input(false);
    buttonOnly = signal(false);
    expandedView = this.filtersService.expandedView;
    advOpen = this.filtersService.advOpen;
    advPanelDocked = computed(() => this.expandedView() && this.advOpen() && this.layoutService.windowWidth() >= 900);
    advPanelUserColumns = signal<1 | 2 | null>(null);
    focused = signal(false);
    activeIndex = signal<number | null>(null);
    selectedUnits = signal<Set<string>>(new Set());
    private unitDetailsDialogOpen = signal(false);
    
    /** Unit currently selected for inline details panel in expanded view */
    inlinePanelUnit = signal<Unit | null>(null);
    
    /** Minimum window width to show the inline details panel */
    private readonly INLINE_PANEL_MIN_WIDTH = 2100;
    
    /** Whether to show the inline details panel (expanded view + sufficient screen width) */
    showInlinePanel = computed(() => {
        return this.expandedView() && this.layoutService.windowWidth() >= this.INLINE_PANEL_MIN_WIDTH;
    });
    
    /** Index of the currently selected unit in the filtered list */
    private inlinePanelIndex = computed(() => {
        const unit = this.inlinePanelUnit();
        if (!unit) return -1;
        return this.filtersService.filteredUnits().findIndex(u => u.name === unit.name);
    });
    
    /** Whether there is a previous unit to navigate to in the inline panel */
    inlinePanelHasPrev = computed(() => this.inlinePanelIndex() > 0);
    
    /** Whether there is a next unit to navigate to in the inline panel */
    inlinePanelHasNext = computed(() => {
        const index = this.inlinePanelIndex();
        return index >= 0 && index < this.filtersService.filteredUnits().length - 1;
    });

    /**
     * For AS table view: returns the sort slot header label if the current sort
     * is not already visible in the table columns, otherwise null.
     */
    readonly asTableSortSlotHeader = computed((): string | null => {
        const key = this.filtersService.selectedSort();
        if (!key) return null;
        
        // Check if key is directly in table columns
        if (UnitSearchComponent.AS_TABLE_VISIBLE_KEYS.includes(key)) return null;
        
        // Check if key is in a group that's in table columns
        for (const groupName of UnitSearchComponent.AS_TABLE_VISIBLE_GROUPS) {
            const group = UnitSearchComponent.SORT_KEY_GROUPS[groupName];
            if (group && group.includes(key)) return null;
        }
        
        // Key is not displayed in table - return the label
        const opt: SortOption | undefined = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel || opt?.label || key;
    });

    /** Current sort key for expanded card highlighting */
    readonly currentSortKey = computed(() => this.filtersService.selectedSort());

    /** Current sort slot label for expanded card (when sort key not visible) */
    readonly currentSortSlotLabel = computed(() => {
        const key = this.filtersService.selectedSort();
        if (!key) return null;
        const opt = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel ?? null;
    });
    
    advPanelStyle = signal<{ left: string, top: string, width: string, height: string, columnsCount: number }>({
        left: '0px',
        top: '0px',
        width: '100%',
        height: '100%',
        columnsCount: 1,
    });
    resultsDropdownStyle = signal<{ top: string, width: string, height: string }>({
        top: '0px',
        width: '100%',
        height: '100%',
    });
    
    /** Style for the expanded results wrapper when advanced panel is docked */
    expandedWrapperStyle = computed(() => {
        const { top: safeTop, bottom: safeBottom, right: safeRight } = this.layoutService.getSafeAreaInsets();
        const gap = 4;
        const top = safeTop + 4 + 40 + gap; // top margin + searchbar height + gap
        const bottom = Math.max(4, safeBottom);
        const filtersOnLeft = this.filtersOnLeft();

        let left = 4;
        let right = 4;
        if (this.advPanelDocked()) {
            const advPanelWidth = parseInt(this.advPanelStyle().width, 10) || 300;
            if (filtersOnLeft) {
                left = advPanelWidth + 8;
            } else {
                right = advPanelWidth + 8;
            }
        }

        return {
            top: `${top}px`,
            left: `${left}px`,
            right: `${right}px`,
            bottom: `${bottom}px`,
            flexDirection: filtersOnLeft ? 'row-reverse' : 'row' as 'row' | 'row-reverse',
        };
    });

    overlayVisible = computed(() => {
        return this.advOpen() || this.resultsVisible();
    });

    public readonly resultsVisible = computed(() => {
        if (this.expandedView()) {
            return true;
        }
        return (this.focused() || this.advOpen() || this.unitDetailsDialogOpen()) &&
            (this.filtersService.searchText() || this.isAdvActive());
    });

    /**
     * Tokenized search text for syntax highlighting.
     * Uses the AST lexer to produce tokens with type info.
     * Uses immediateSearchText for instant feedback (no debounce).
     */
    readonly highlightTokens = computed((): HighlightToken[] => {
        const text = this.immediateSearchText();
        if (!text) return [];
        return tokenizeForHighlight(text, this.gameService.currentGameSystem());
    });

    /**
     * Whether there are any parse errors.
     */
    readonly hasParseErrors = computed((): boolean => {
        return this.highlightTokens().some(t => t.type === 'error');
    });

    /**
     * Tooltip text for the search input when there are parse errors.
     * Shows all error messages joined by newlines.
     */
    readonly errorTooltip = computed((): string => {
        const errors = this.highlightTokens().filter(t => t.type === 'error' && t.errorMessage);
        if (errors.length === 0) return '';
        return errors.map(e => e.errorMessage).join('\n');
    });

    /**
     * Whether the query is too complex to represent in flat UI filters.
     * When true, filter dropdowns are hidden in favor of the query.
     */
    readonly isComplexQuery = computed(() => this.filtersService.isComplexQuery());

    itemSize = signal(75);

    private resizeObserver?: ResizeObserver;
    private advPanelDragStartX = 0;
    private advPanelDragStartWidth = 0;

    constructor() {
        // Sync immediateSearchText when searchText changes externally (favorites, etc.)
        // We use untracked to avoid re-triggering when we set immediateSearchText
        effect(() => {
            const text = this.filtersService.searchText();
            untracked(() => {
                if (this.immediateSearchText() !== text) {
                    this.immediateSearchText.set(text);
                }
            });
        });
        // Auto-refresh favorites overlay when saved searches change (e.g., from cloud sync)
        effect(() => {
            this.savedSearchesService.version(); // Subscribe to changes
            untracked(() => this.refreshFavoritesOverlay());
        });
        effect(() => {
            if (this.advOpen()) {
                this.layoutService.windowWidth();
                this.layoutService.windowHeight();
                this.advPanelUserColumns();
                this.updateAdvPanelPosition();
                this.updateResultsDropdownPosition();
            }
        });
        effect(() => {
            this.advPanelUserColumns();
            this.expandedView();
            if (this.resultsVisible()) {
                this.layoutService.windowWidth();
                this.layoutService.windowHeight();
                this.updateResultsDropdownPosition();
            }
        });
        // Track pending afterNextRender callbacks to cancel on effect re-run or destroy
        let pendingFocusRef: { destroy: () => void } | null = null;
        let pendingResizeObserverRef: { destroy: () => void } | null = null;
        
        effect(() => {
            // Cancel any previous pending focus callback
            pendingFocusRef?.destroy();
            pendingFocusRef = null;
            
            if (this.autoFocus() &&
                this.filtersService.isDataReady() &&
                this.syntaxInput()) {
                pendingFocusRef = afterNextRender(() => {
                    pendingFocusRef = null;
                    this.syntaxInput()?.focus();
                }, { injector: this.injector });
            }
        });
        pendingResizeObserverRef = afterNextRender(() => {
            pendingResizeObserverRef = null;
            // We use a ResizeObserver to track changes to the search bar container size,
            // so we can update the dropdown/panel positions accordingly.
            const container = document.querySelector('.searchbar-container') as HTMLElement;
            if (container) {
                this.resizeObserver = new ResizeObserver(() => {
                    if (this.advOpen()) {
                        this.updateAdvPanelPosition();
                    }
                    if (this.resultsVisible() && !this.expandedView()) {
                        this.updateResultsDropdownPosition();
                    }
                });
                this.resizeObserver.observe(container);
            }
        }, { injector: this.injector });

        const visualViewport = window.visualViewport;
        if (visualViewport) {
            const onViewportChange = () => {
                if (this.advOpen()) {
                    this.updateAdvPanelPosition();
                }
                if (this.resultsVisible() && !this.expandedView()) {
                    this.updateResultsDropdownPosition();
                }
            };
            visualViewport.addEventListener('resize', onViewportChange);
            visualViewport.addEventListener('scroll', onViewportChange);
            this.destroyRef.onDestroy(() => {
                visualViewport.removeEventListener('resize', onViewportChange);
                visualViewport.removeEventListener('scroll', onViewportChange);
            });
        }
        this.setupItemHeightTracking();
        inject(DestroyRef).onDestroy(() => {
            pendingFocusRef?.destroy();
            pendingResizeObserverRef?.destroy();
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
            }
            if (this.heightTrackingDebounceTimer) {
                clearTimeout(this.heightTrackingDebounceTimer);
            }
            this.resizeObserver?.disconnect();
            this.overlayManager.closeAllManagedOverlays();
        });
    }

    private setupItemHeightTracking() {
        const DEBOUNCE_MS = 100;
        const SCROLL_DEBOUNCE_MS = 250;
        let prevExpandedView: boolean | undefined;

        const measureHeights = () => {
            // Query DOM directly
            const dropdown = this.getActiveDropdownElement();
            if (!dropdown) return;
            
            const items = dropdown.querySelectorAll('.results-dropdown-item:not(.no-results)');
            if (items.length === 0) return;
            const heights = Array.from(items).slice(0, 100).map(el => (el as HTMLElement).offsetHeight);
            let avg = Math.round(heights.reduce((a, b) => a + b, 0) / heights.length);
            const currentAvg = this.itemSize();
            if (currentAvg !== avg) {
                this.itemSize.set(avg);
            }
        };

        const debouncedUpdateHeights = (debounceMs = DEBOUNCE_MS) => {
            if (this.heightTrackingDebounceTimer) {
                clearTimeout(this.heightTrackingDebounceTimer);
            }
            this.heightTrackingDebounceTimer = setTimeout(() => {
                // Early exit if results are no longer visible
                if (!this.resultsVisible()) return;
                measureHeights();
            }, debounceMs);
        };

        effect(() => {
            const currentExpandedView = this.expandedView();
            
            // Cancel any pending timer and reset itemSize when view mode changes
            untracked(() => {
                if (this.heightTrackingDebounceTimer) {
                    clearTimeout(this.heightTrackingDebounceTimer);
                    this.heightTrackingDebounceTimer = undefined;
                }
                // Reset to default on view mode change (will be refined by height tracking)
                if (prevExpandedView !== undefined && prevExpandedView !== currentExpandedView) {
                    this.itemSize.set(75);
                }
                prevExpandedView = currentExpandedView;
            });
            
            if (!this.resultsVisible()) return;
            this.layoutService.isMobile();
            this.gameService.currentGameSystem();
            if (currentExpandedView) {
                this.layoutService.windowWidth();
                this.filtersService.advOpen();
                this.advPanelUserColumns();
            }
            this.filtersService.filteredUnits();
            debouncedUpdateHeights();
        });
    }

    public closeAllPanels() {
        this.focused.set(false);
        this.advOpen.set(false);
        this.activeIndex.set(null);
        this.blurInput();
    }

    onOverlayClick() {
        if (this.expandedView()) return;
        this.closeAllPanels();
    }

    trackByUnitId(index: number, unit: Unit) {
        // Track by index to force position-based recycling in virtual scroll
        // Tracking by unit.name causes orphaned DOM nodes for who knows what reason...
        return index;
    }

    focusInput() {
        afterNextRender(() => {
            try { this.syntaxInput()?.focus(); } catch { /* ignore */ }
        }, { injector: this.injector });
    }

    blurInput() {
        try { this.syntaxInput()?.blur(); } catch { /* ignore */ }
    }

    setSearch(val: string) {
        // Update immediately for instant highlighting
        this.immediateSearchText.set(val);
        // Debounce the actual search/filtering
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        this.searchDebounceTimer = setTimeout(() => {
            this.filtersService.searchText.set(val);
            this.activeIndex.set(null);
        }, this.SEARCH_DEBOUNCE_MS);
    }

    closeAdvPanel() {
        this.advOpen.set(false);
    }

    toggleAdv() {
        this.advOpen.set(!this.advOpen());
        if (!this.advOpen()) {
            this.syntaxInput()?.focus();
        } else {
            this.focused.set(true);
        }
    }

    updateResultsDropdownPosition() {
        const gap = 4;

        const { top: safeTop, bottom: safeBottom } = this.layoutService.getSafeAreaInsets();
        const visualViewport = window.visualViewport;
        const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        let dropdownWidth: number;
        let top: number;
        let baseTop: number;
        let right: string | undefined;

        if (this.expandedView()) {
            // When expanded, container is fixed at top with 4px margins
            // Calculate position based on the expanded state, not current DOM position
            dropdownWidth = window.innerWidth - 8; // 4px left + 4px right margin
            baseTop = safeTop + 4 + 40 + gap; // top margin + searchbar height + gap
            top = baseTop + viewportOffsetTop;
            if (this.advPanelDocked()) {
                const advPanelWidth = this.advPanelStyle().width;
                right = advPanelWidth ? `${parseInt(advPanelWidth, 10) + 8}px` : `308px`;
            }
        } else {
            // Normal mode: use actual container position
            const container = document.querySelector('.searchbar-container') as HTMLElement;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            dropdownWidth = containerRect.width;
            baseTop = containerRect.bottom + gap;
            top = baseTop + viewportOffsetTop;
        }

        let height;
        if (this.filtersService.filteredUnits().length > 0) {
            const availableHeight = viewportHeight - baseTop - Math.max(4, safeBottom);
            height = `${availableHeight}px`;
        } else {
            height = 'auto';
        }

        this.resultsDropdownStyle.set({
            top: `${top}px`,
            width: `${dropdownWidth}px`,
            height: height,
        });
    }

    updateAdvPanelPosition() {
        const advBtn = this.advBtn();
        if (!advBtn) return;

        const { top: safeTop, bottom: safeBottom, left: safeLeft, right: safeRight } = this.layoutService.getSafeAreaInsets();
        const buttonRect = advBtn.nativeElement.getBoundingClientRect();
        const singlePanelWidth = 300;
        const doublePanelWidth = 600;
        const gap = 4;
        const filtersOnLeft = this.filtersOnLeft() && this.expandedView(); // Only applies in expanded view
        
        // Calculate available space based on layout direction
        const spaceAvailable = filtersOnLeft 
            ? buttonRect.left - gap - 10  // Space to the left of button
            : window.innerWidth - buttonRect.right - gap - 10;  // Space to the right of button

        // Use user override if set, else auto
        let columns = (spaceAvailable >= doublePanelWidth ? 2 : 1);
        if (this.expandedView() && this.advPanelDocked()) {
            const columnsCountOverride = this.advPanelUserColumns();
            if (columnsCountOverride) {
                columns = columnsCountOverride;
            }
        }
        let panelWidth = columns === 2 ? doublePanelWidth : singlePanelWidth;

        let left: number;
        let top: number;
        let availableHeight: number;

        if (filtersOnLeft) {
            // Filters on left: panel opens to the left of the button
            if (spaceAvailable >= panelWidth) {
                left = buttonRect.left - panelWidth - gap;
                top = buttonRect.top;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            } else {
                left = gap;
                top = buttonRect.bottom + gap;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            }
            left = Math.max(gap, left);
        } else {
            // Default: panel opens to the right of the button
            if (spaceAvailable >= panelWidth) {
                left = buttonRect.right + gap;
                top = buttonRect.top;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            } else {
                left = buttonRect.right - panelWidth;
                top = buttonRect.bottom + gap;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
                left = Math.max(10, left);
            }
        }

        this.advPanelStyle.set({
            left: `${left}px`,
            top: `${top}px`,
            width: `${panelWidth}px`,
            height: `${availableHeight}px`,
            columnsCount: columns
        });
    }

    setAdvFilter(key: string, value: any) {
        this.filtersService.setFilter(key, value);
        this.activeIndex.set(null);
    }

    clearAdvFilters() {
        this.viewport()?.scrollToIndex(0);
        this.filtersService.resetFilters();
        this.activeIndex.set(null);
    }

    isAdvActive() {
        const state = this.filtersService.filterState();
        return Object.values(state).some(s => s.interactedWith);
    }

    onKeydown(event: KeyboardEvent) {
        // SELECT ALL
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            const isInInput = event.target instanceof HTMLElement && Boolean(event.target.closest('input, textarea, select, [contenteditable]'));
            if (!isInInput) {
                event.preventDefault();
                this.selectAll();
                return;
            }
        }
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (this.advOpen()) {
                this.closeAdvPanel();
                this.syntaxInput()?.focus();
                return;
            } else {
                if (this.expandedView()) {
                    this.expandedView.set(false);
                    return;
                }
                this.focused.set(false);
                this.blurInput();
            }
            return;
        }
        if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            const items = this.filtersService.filteredUnits();
            if (items.length === 0) return;
            const currentActiveIndex = this.activeIndex();
            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    const nextIndex = currentActiveIndex !== null ? Math.min(currentActiveIndex + 1, items.length - 1) : 0;
                    this.activeIndex.set(nextIndex);
                    this.scrollToIndex(nextIndex);
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    if (currentActiveIndex !== null && currentActiveIndex > 0) {
                        const prevIndex = currentActiveIndex - 1;
                        this.activeIndex.set(prevIndex);
                        this.scrollToIndex(prevIndex);
                    } else {
                        this.activeIndex.set(null);
                        this.syntaxInput()?.focus();
                    }
                    break;
                case 'Enter':
                    event.preventDefault();
                    if (currentActiveIndex !== null) {
                        this.showUnitDetails(items[currentActiveIndex]);
                    } else if (items.length > 0) {
                        this.showUnitDetails(items[0]);
                    }
                    break;
            }
        }
    }

    private scrollToIndex(index: number) {
        this.viewport()?.scrollToIndex(index, 'smooth');
    }

    /**
     * Scroll to make the item at the given index visible, but only if it's not already visible.
     * If scrolling is needed, positions the item at the nearest edge (top or bottom).
     */
    private scrollToMakeVisible(index: number) {
        const vp = this.viewport();
        if (!vp) return;
        
        const vpElement = vp.elementRef.nativeElement;
        const renderedRange = vp.getRenderedRange();
        
        // Check if the item is within the rendered range
        if (index < renderedRange.start || index >= renderedRange.end) {
            // Item is not rendered at all, need to scroll to it
            vp.scrollToIndex(index, 'smooth');
            return;
        }
        
        // Find the rendered items
        const items = vpElement.querySelectorAll('.results-dropdown-item:not(.no-results)');
        const localIndex = index - renderedRange.start;
        
        if (localIndex < 0 || localIndex >= items.length) {
            // Safety fallback
            vp.scrollToIndex(index, 'smooth');
            return;
        }
        
        const itemElement = items[localIndex] as HTMLElement;
        const itemRect = itemElement.getBoundingClientRect();
        const vpRect = vpElement.getBoundingClientRect();
        
        // Check if item is fully visible within the viewport
        const isAbove = itemRect.top < vpRect.top;
        const isBelow = itemRect.bottom > vpRect.bottom;
        
        if (!isAbove && !isBelow) {
            // Item is fully visible, no scrolling needed
            return;
        }
        
        const currentOffset = vp.measureScrollOffset();
        
        if (isAbove) {
            // Item is above the visible area - scroll up by the exact amount needed
            const scrollAmount = vpRect.top - itemRect.top;
            vp.scrollToOffset(currentOffset - scrollAmount, 'smooth');
        } else {
            // Item is below the visible area - scroll down by the exact amount needed
            const scrollAmount = itemRect.bottom - vpRect.bottom;
            vp.scrollToOffset(currentOffset + scrollAmount, 'smooth');
        }
    }

    highlight(text: string): string {
        const searchGroups = this.filtersService.searchTokens();
        return highlightMatches(text, searchGroups, true);
    }

    async openRangeValueDialog(filterKey: string, currentValue: number[], totalRange: [number, number]) {
        const currentFilter = this.filtersService.advOptions()[filterKey];
        if (!currentFilter || currentFilter.type !== 'range') {
            return;
        }
        const filterName = currentFilter?.label || filterKey;
        const message = `Enter the ${filterName} range values:`;

        const ref = this.dialogsService.createDialog<RangeModel | null>(UnitSearchFilterRangeDialogComponent, {
            data: {
                title: filterName,
                message: message,
                range: {
                    from: currentValue[0],
                    to: currentValue[1]
                }
            } as UnitSearchFilterRangeDialogData
        });
        let newValues = await firstValueFrom(ref.closed);
        if (newValues === undefined || newValues === null) return;

        let newFrom = newValues.from ?? 0;
        let newTo = newValues.to ?? Number.MAX_SAFE_INTEGER;
        if (newFrom < totalRange[0]) {
            newFrom = totalRange[0];
        } else if (newTo > totalRange[1]) {
            newTo = totalRange[1];
        }

        const currentRange = [...currentFilter.value] as [number, number];
        if (newFrom > currentRange[1]) {
            newFrom = currentRange[1];
        }
        currentRange[0] = newFrom;
        if (newTo < currentRange[0]) {
            newTo = currentRange[0];
        }
        currentRange[1] = newTo;

        this.setAdvFilter(filterKey, currentRange);
    }

    showUnitDetails(unit: Unit) {
        const filteredUnits = this.filtersService.filteredUnits();
        const filteredUnitIndex = filteredUnits.findIndex(u => u.name === unit.name);
        const ref = this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: filteredUnits,
                unitIndex: filteredUnitIndex,
                gunnerySkill: this.filtersService.pilotGunnerySkill(),
                pilotingSkill: this.filtersService.pilotPilotingSkill()
            }
        });
        this.unitDetailsDialogOpen.set(true);

        // Track navigation within the dialog to keep activeIndex in sync
        const indexChangeSub = ref.componentInstance?.indexChange.subscribe((newIndex: number) => {
            this.activeIndex.set(newIndex);
            this.scrollToMakeVisible(newIndex);
            // Fetch fresh to avoid closure over stale filteredUnits
            const currentFilteredUnits = this.filtersService.filteredUnits();
            if (newIndex < currentFilteredUnits.length) {
                this.inlinePanelUnit.set(currentFilteredUnits[newIndex]);
            }
        });

        const addSub = ref.componentInstance?.add.subscribe(() => {
            if (this.forceBuilderService.currentForce()?.units().length === 1) {
                this.closeAllPanels();
                this.expandedView.set(false);
            }
            this.blurInput();
            this.unitDetailsDialogOpen.set(false);
        });

        firstValueFrom(ref.closed).then(() => {
            this.unitDetailsDialogOpen.set(false);
            indexChangeSub?.unsubscribe();
            addSub?.unsubscribe();
        });

        if (!this.advPanelDocked()) {
            this.advOpen.set(false);
        }
        this.activeIndex.set(null);
        try {
            (document.activeElement as HTMLElement)?.blur();
        } catch { /* ignore */ }
    }

    /**
     * Keys that are grouped together in the UI display.
     * When any key in a group is displayed, sorting by any other key in the group
     * should highlight that display (not create a separate sort slot).
     */
    private static readonly SORT_KEY_GROUPS: Record<string, readonly string[]> = {
        // AS damage displayed as S/M/L composite
        'as.damage': ['as.dmg._dmgS', 'as.dmg._dmgM', 'as.dmg._dmgL', 'as.dmg._dmgE'],
        // CBT movement displayed as "walk / run / jump / umu"
        'movement': ['walk', 'run', 'jump', 'umu'],
    };

    /** 
     * Check if the current sort key matches any of the provided keys or groups.
     * Use in templates: [class.sort-slot]="isSortActive('as.PV')" or isSortActive('as.damage')
     */
    isSortActive(...keysOrGroups: string[]): boolean {
        const currentSort = this.filtersService.selectedSort();
        if (!currentSort) return false;
        
        for (const keyOrGroup of keysOrGroups) {
            // Check if it's a group name
            const group = UnitSearchComponent.SORT_KEY_GROUPS[keyOrGroup];
            if (group) {
                if (group.includes(currentSort)) return true;
            } else if (keyOrGroup === currentSort) {
                return true;
            }
        }
        return false;
    }

    /** 
     * Keys always visible in the AS table row.
     * Used by both asTableSortSlotHeader and getAsTableSortSlot.
     */
    private static readonly AS_TABLE_VISIBLE_KEYS = ['as.TP', 'role', 'as.PV', 'as.SZ', 'as._mv', 'as.TMM', 'as.Arm', 'as.Str', 'as.OV'];
    private static readonly AS_TABLE_VISIBLE_GROUPS = ['as.damage'];

    /**
     * Get the sort slot value for AS table row view.
     * Returns null if the sort key is already visible in the table columns.
     */
    getAsTableSortSlot(unit: Unit): string | null {
        const key = this.filtersService.selectedSort();
        if (!key) return null;
        
        // Check if key is directly in table columns
        if (UnitSearchComponent.AS_TABLE_VISIBLE_KEYS.includes(key)) return null;
        
        // Check if key is in a group that's in table columns
        for (const groupName of UnitSearchComponent.AS_TABLE_VISIBLE_GROUPS) {
            const group = UnitSearchComponent.SORT_KEY_GROUPS[groupName];
            if (group && group.includes(key)) return null;
        }
        
        // Key is not displayed in table - return the formatted value
        const raw = this.getNestedProperty(unit, key);
        if (raw == null) return '—';
        
        const numeric = typeof raw === 'number';
        return numeric ? FormatNumberPipe.formatValue(raw, true, false) : String(raw);
    }

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: any, key: string): any {
        if (!obj || !key) return undefined;
        if (!key.includes('.')) return obj[key];
        const parts = key.split('.');
        let cur: any = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    async onAddTag({ unit, event }: TagClickEvent) {
        event.stopPropagation();

        // Determine which units to tag: selected units if any.
        const selectedNames = this.selectedUnits();
        const allUnits = this.filtersService.filteredUnits();
        let unitsToTag: Unit[];
        if (selectedNames.size > 0) {
            // Always include the clicked unit, even if not in the selection
            const selectedSet = new Set(selectedNames);
            selectedSet.add(unit.name);
            unitsToTag = allUnits.filter(u => selectedSet.has(u.name));
        } else {
            unitsToTag = [unit];
        }

        // Get anchor element for positioning
        const evtTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorEl = (evtTarget.closest('.add-tag-btn') as HTMLElement) || evtTarget;

        await this.taggingService.openTagSelector(unitsToTag, anchorEl);
        this.cdr.markForCheck();
    }

    setPilotSkill(type: 'gunnery' | 'piloting', value: number) {
        const currentGunnery = this.filtersService.pilotGunnerySkill();
        const currentPiloting = this.filtersService.pilotPilotingSkill();
        if (type === 'gunnery') {
            this.filtersService.setPilotSkills(value, currentPiloting);
        } else {
            this.filtersService.setPilotSkills(currentGunnery, value);
        }

        this.activeIndex.set(null);
    }

    openSelect(event: Event, select: HTMLSelectElement) {
        event.preventDefault();
        event.stopPropagation();
        select.showPicker?.() ?? select.focus();
    }

    /* Adv Panel Dragging */
    onAdvPanelDragStart(event: PointerEvent) {
        if (!this.advPanelDocked() || !this.expandedView()) return;
        event.preventDefault();
        event.stopPropagation();
        this.advPanelDragStartX = event.clientX;
        this.advPanelDragStartWidth = parseInt(this.advPanelStyle().width, 10) || 300;

        window.addEventListener('pointermove', this.onAdvPanelDragMove);
        window.addEventListener('pointerup', this.onAdvPanelDragEnd);
        window.addEventListener('pointercancel', this.onAdvPanelDragEnd);
        try {
            (event.target as HTMLElement).setPointerCapture(event.pointerId);
        } catch (e) { /* ignore */ }
    }

    onAdvPanelDragMove = (event: PointerEvent) => {
        const delta = event.clientX - this.advPanelDragStartX;
        // When filters are on left, dragging right increases width; otherwise dragging left increases width
        const newWidth = this.filtersOnLeft() 
            ? this.advPanelDragStartWidth + delta 
            : this.advPanelDragStartWidth - delta;
        // Snap to 1 or 2 columns
        if (newWidth > 450) {
            this.advPanelUserColumns.set(2);
        } else {
            this.advPanelUserColumns.set(1);
        }
    };

    onAdvPanelDragEnd = (event: PointerEvent) => {
        try {
            (event.target as HTMLElement).releasePointerCapture(event.pointerId);
        } catch (e) { /* ignore */ }
        window.removeEventListener('pointermove', this.onAdvPanelDragMove);
        window.removeEventListener('pointerup', this.onAdvPanelDragEnd);
        window.removeEventListener('pointercancel', this.onAdvPanelDragEnd);
    };

    multiSelectUnit(unit: Unit) {
        const selected = new Set(this.selectedUnits());
        if (selected.has(unit.name)) {
            selected.delete(unit.name);
        } else {
            selected.add(unit.name);
        }
        this.selectedUnits.set(selected);
    }

    // Multi-select logic: click with Ctrl/Cmd or Shift to select multiple units
    onUnitCardClick(unit: Unit, event: MouseEvent) {
        const multiSelect = event ? (event.ctrlKey || event.metaKey || event.shiftKey) : false;
        if (event && multiSelect) {
            // Multi-select logic
            const selected = new Set(this.selectedUnits());
            if (selected.has(unit.name)) {
                selected.delete(unit.name);
            } else {
                selected.add(unit.name);
            }
            this.selectedUnits.set(selected);
            event.stopPropagation();
            return;
        }
        // Single click: show inline panel if available, otherwise open dialog
        this.inlinePanelUnit.set(unit);
        if (this.showInlinePanel()) {
            // Update activeIndex to match clicked unit
            const filteredUnits = this.filtersService.filteredUnits();
            const index = filteredUnits.findIndex(u => u.name === unit.name);
            if (index >= 0) {
                this.activeIndex.set(index);
            }
        } else {
            this.showUnitDetails(unit);
        }
    }

    /** Handle unit added from inline panel */
    onInlinePanelAdd(unit: Unit): void {
        if (this.forceBuilderService.currentForce()?.units().length === 1) {
            // If this is the first unit being added, close the search panel
            this.closeAllPanels();
            this.expandedView.set(false);
        }
        this.blurInput();
    }

    /** Navigate to previous unit in inline panel */
    onInlinePanelPrev(): void {
        const index = this.inlinePanelIndex();
        if (index > 0) {
            const prevUnit = this.filtersService.filteredUnits()[index - 1];
            this.inlinePanelUnit.set(prevUnit);
            this.activeIndex.set(index - 1);
            this.scrollToMakeVisible(index - 1);
        }
    }

    /** Navigate to next unit in inline panel */
    onInlinePanelNext(): void {
        const index = this.inlinePanelIndex();
        const filteredUnits = this.filtersService.filteredUnits();
        if (index >= 0 && index < filteredUnits.length - 1) {
            const nextUnit = filteredUnits[index + 1];
            this.inlinePanelUnit.set(nextUnit);
            this.activeIndex.set(index + 1);
            this.scrollToMakeVisible(index + 1);
        }
    }

    isUnitSelected(unit: Unit): boolean {
        return this.selectedUnits().has(unit.name);
    }

    clearSelection() {
        if (this.selectedUnits().size > 0) {
            this.selectedUnits.set(new Set());
        }
    }

    selectAll() {
        const allUnits = this.filtersService.filteredUnits();
        const allNames = new Set(allUnits.map(u => u.name));
        this.selectedUnits.set(allNames);
    }

    async addSelectedUnits() {
        const gunnery = this.filtersService.pilotGunnerySkill();
        const piloting = this.filtersService.pilotPilotingSkill();
        const selectedUnits = this.selectedUnits();
        for (let selectedUnit of selectedUnits) {
            const unit = this.dataService.getUnitByName(selectedUnit);
            if (unit) {
                if (!await this.forceBuilderService.addUnit(unit, gunnery, piloting)) {
                    break;
                }
            }
        };
        this.clearSelection();
        this.closeAllPanels();
    }

    /**
     * Show ability info dialog for an Alpha Strike special ability.
     * @param abilityText The original ability text (e.g., "ECM", "LRM1/2/2")
     */
    showAbilityInfoDialog(abilityText: string): void {
        const parsedAbility = this.abilityLookup.parseAbility(abilityText);
        this.dialogsService.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }

    /**
     * Format movement value for Alpha Strike expanded view.
     * Converts inches to hexes if hex mode is enabled.
     * Handles different movement modes (j for jump, etc.)
     */
    formatASMovement(unit: Unit): string {
        const mvm = unit.as.MVm;
        if (!mvm) return unit.as.MV ?? '';

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        if (entries.length === 0) return unit.as.MV ?? '';

        // Sort so default movement comes first
        entries.sort((a, b) => {
            if (a[0] === '') return -1;
            if (b[0] === '') return 1;
            return 0;
        });

        return entries
            .map(([mode, inches]) => {
                if (this.useHex()) {
                    return Math.ceil(inches / 2) + mode;
                }
                return inches + '"' + mode;
            })
            .join('/');
    }

    toggleExpandedView() {
        const isExpanded = this.expandedView();
        
        if (isExpanded) {
            const currentForce = this.forceBuilderService.currentForce();
            if (currentForce && currentForce.units().length > 0) {
                this.closeAllPanels();
                this.blurInput();
            } else {
                this.focusInput();   
            }
        } else {
            this.focusInput();
        }
        this.expandedView.set(!isExpanded);
    }

    clearSearch() {
        this.immediateSearchText.set('');
        this.filtersService.searchText.set('');
        this.activeIndex.set(null);
    }

    openShareSearch(event: MouseEvent) {
        event.stopPropagation();
        this.dialogsService.createDialog(ShareSearchDialogComponent);
    }

    openSemanticGuide(event: MouseEvent) {
        event.stopPropagation();
        this.dialogsService.createDialog(SemanticGuideDialogComponent);
    }

    /* ------------------------------------------
     * Favorites overlay/menu
     */

    openFavorites(event: MouseEvent) {
        event.stopPropagation();

        // If already open, close it
        if (this.overlayManager.has('favorites')) {
            this.overlayManager.closeManagedOverlay('favorites');
            this.favoritesCompRef = null;
            return;
        }
        const target = this.favBtn()?.nativeElement || (event.target as HTMLElement);
        const portal = new ComponentPortal(SearchFavoritesMenuComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay('favorites', target, portal, {
            hasBackdrop: false,
            panelClass: 'favorites-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });
        this.favoritesCompRef = componentRef;

        // Get favorites - filter by game system only if a force is loaded
        const hasForce = this.forceBuilderService.currentForce() !== null;
        const favorites = hasForce
            ? this.savedSearchesService.getSearchesForGameSystem(this.gameService.currentGameSystem())
            : this.savedSearchesService.getAllSearches();
        componentRef.setInput('favorites', favorites);
        
        // Determine if saving is allowed (has search text or filters)
        const hasSearchText = (this.filtersService.searchText() ?? '').trim().length > 0;
        const filterState = this.filtersService.filterState();
        const hasActiveFilters = Object.values(filterState).some(s => s.interactedWith);
        componentRef.setInput('canSave', hasSearchText || hasActiveFilters);
        
        outputToObservable(componentRef.instance.select).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((favorite: SerializedSearchFilter) => {
            if (favorite) this.applyFavorite(favorite);
            this.overlayManager.closeManagedOverlay('favorites');
            this.favoritesCompRef = null;
        });
        outputToObservable(componentRef.instance.rename).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((favorite: SerializedSearchFilter) => {
            this.renameSearch(favorite);
        });
        outputToObservable(componentRef.instance.delete).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((favorite: SerializedSearchFilter) => {
            this.deleteSearch(favorite);
        });
        outputToObservable(componentRef.instance.saveRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.saveCurrentSearch();
        });
        outputToObservable(componentRef.instance.menuOpened).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.blockCloseUntil('favorites');
        });
        outputToObservable(componentRef.instance.menuClosed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            // Delay unblock to allow menu item click to process first
            // But don't unblock if a dialog operation is in progress
            setTimeout(() => {
                if (!this.favoritesDialogActive) {
                    this.overlayManager.unblockClose('favorites');
                }
            }, 50);
        });
    }

    closeFavorites() {
        this.overlayManager.closeManagedOverlay('favorites');
        this.favoritesCompRef = null;
    }

    private async saveCurrentSearch() {
        // Block favorites overlay from closing while dialog is open
        this.favoritesDialogActive = true;
        this.overlayManager.blockCloseUntil('favorites');
        try {
            // Check if there's anything to save (text or filters)
            const hasSearchText = (this.filtersService.searchText() ?? '').trim().length > 0;
            const filterState = this.filtersService.filterState();
            const hasActiveFilters = Object.values(filterState).some(s => s.interactedWith);
            
            if (!hasSearchText && !hasActiveFilters) {
                await this.dialogsService.showNotice(
                    'Please enter a search query or set some filters before saving a bookmark.',
                    'Nothing to Save'
                );
                return;
            }

            const name = await this.dialogsService.prompt(
                'Enter a name for this Tactical Bookmark (e.g. "Clan Raid 3052")',
                'Save Tactical Bookmark',
                ''
            );
            if (name === null) return; // cancelled
            const trimmed = (name || '').trim();
            if (!trimmed) return;

            const gameSystem = this.gameService.currentGameSystem();
            const gsKey = gameSystem === GameSystem.ALPHA_STRIKE ? 'as' : 'cbt';
            const id = generateUUID();
            const filter = this.filtersService.serializeCurrentSearchFilter(id, trimmed, gsKey);
            
            await this.savedSearchesService.saveSearch(filter);
            // Refresh the overlay with the new bookmark
            this.refreshFavoritesOverlay();
        } finally {
            this.favoritesDialogActive = false;
            // Unblock after small delay to prevent immediate close from residual events
            setTimeout(() => this.overlayManager.unblockClose('favorites'), 100);
        }
    }

    private async renameSearch(favorite: SerializedSearchFilter) {
        // Block favorites overlay from closing while dialog is open
        this.favoritesDialogActive = true;
        this.overlayManager.blockCloseUntil('favorites');
        try {
            const newName = await this.dialogsService.prompt(
                'Enter a new name for this bookmark:',
                'Rename Tactical Bookmark',
                favorite.name
            );
            if (newName === null) return; // cancelled
            const trimmed = (newName || '').trim();
            if (!trimmed || trimmed === favorite.name) return;

            await this.savedSearchesService.renameSearch(favorite.id, trimmed);
            // Refresh the overlay with updated data
            this.refreshFavoritesOverlay();
        } finally {
            this.favoritesDialogActive = false;
            // Unblock after small delay to prevent immediate close from residual events
            setTimeout(() => this.overlayManager.unblockClose('favorites'), 100);
        }
    }

    private async deleteSearch(favorite: SerializedSearchFilter) {
        // Block favorites overlay from closing while dialog is open
        this.favoritesDialogActive = true;
        this.overlayManager.blockCloseUntil('favorites');
        try {
            const confirmed = await this.dialogsService.requestConfirmation(
                `Delete "${favorite.name}"?`,
                'Delete Tactical Bookmark',
                'danger'
            );
            if (!confirmed) return;

            await this.savedSearchesService.deleteSearch(favorite.id);
            // Refresh the overlay with updated data
            this.refreshFavoritesOverlay();
        } finally {
            this.favoritesDialogActive = false;
            // Unblock after small delay to prevent immediate close from residual events
            setTimeout(() => this.overlayManager.unblockClose('favorites'), 100);
        }
    }

    private refreshFavoritesOverlay() {
        // Update favorites data in-place without closing overlay
        if (this.favoritesCompRef && this.overlayManager.has('favorites')) {
            // Get favorites - filter by game system only if a force is loaded
            const hasForce = this.forceBuilderService.currentForce() !== null;
            const favorites = hasForce
                ? this.savedSearchesService.getSearchesForGameSystem(this.gameService.currentGameSystem())
                : this.savedSearchesService.getAllSearches();
            this.favoritesCompRef.setInput('favorites', favorites);
            
            // Also update canSave state
            const hasSearchText = (this.filtersService.searchText() ?? '').trim().length > 0;
            const filterState = this.filtersService.filterState();
            const hasActiveFilters = Object.values(filterState).some(s => s.interactedWith);
            this.favoritesCompRef.setInput('canSave', hasSearchText || hasActiveFilters);
        }
    }

    private applyFavorite(fav: SerializedSearchFilter) {
        // Switch game mode only if the saved search has a specific game system
        // Game-agnostic searches (no gameSystem) don't switch the mode
        if (fav.gameSystem) {
            const currentGs = this.gameService.currentGameSystem();
            const favGs = fav.gameSystem === 'as' ? GameSystem.ALPHA_STRIKE : GameSystem.CLASSIC;
            if (favGs !== currentGs) {
                this.gameService.setMode(favGs);
            }
        }
        this.filtersService.applySerializedSearchFilter(fav);
        // Focus search input after applying
        afterNextRender(() => {
            this.focusInput();
        }, { injector: this.injector });
    }
}