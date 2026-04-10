/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Component, ElementRef, computed, input, signal, output, inject, ChangeDetectionStrategy, viewChild, afterNextRender, Injector, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkConnectedOverlay, Overlay, OverlayModule, type ConnectedOverlayPositionChange, type ConnectedPosition } from '@angular/cdk/overlay';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { LayoutService } from '../../services/layout.service';
import { highlightMatches, matchesSearch, parseSearchQuery } from '../../utils/search.util';

/*
 * Author: Drake
 */
export interface DropdownOption {
    name: string;
    displayName?: string;
    img?: string;
    available?: boolean;
    count?: number;
}

export type MultiState = false | 'or' | 'and' | 'not';

/** Operators for quantity constraints on countable filters */
export type CountOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface MultiStateOption {
    name: string;
    state: MultiState;
    count: number;
    /** Operator for quantity constraint (default is '=' for exact match) */
    countOperator?: CountOperator;
    /** Max value for range constraints (e.g., count=2, countMax=5 means 2-5) */
    countMax?: number;
    /** Include ranges for quantity (merged from multiple constraints) */
    countIncludeRanges?: [number, number][];
    /** Exclude ranges for quantity (merged from multiple constraints) */
    countExcludeRanges?: [number, number][];
}

export interface MultiStateSelection {
  [key: string]: MultiStateOption;
}

type ScrollRestoreState =
        | { kind: 'virtual'; optionName: string; scrollOffset: number; optionVisibleTop?: number }
        | { kind: 'dom'; optionName: string; visibleTop: number };

type TriggerRect = { left: number; top: number; width: number; height: number };

interface OpenDropdownOptions {
    focusInput: boolean;
    scrollToOptionName?: string;
}

@Component({
    selector: 'multi-select-dropdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, OverlayModule],
    templateUrl: './multi-select-dropdown.component.html',
    styleUrls: ['./multi-select-dropdown.component.css']
})
export class MultiSelectDropdownComponent {
    private static readonly BELOW_OVERLAY_POSITIONS: ConnectedPosition[] = [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
    ];
    private static readonly ABOVE_OVERLAY_POSITIONS: ConnectedPosition[] = [
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
    ];
    private elementRef = inject(ElementRef);
    private injector = inject(Injector);
    private layoutService = inject(LayoutService);
    private destroyRef = inject(DestroyRef);
    private overlay = inject(Overlay);
    private destroyed = false;
    private lastPointerType = '';
    private anchorFollowFrameId: number | null = null;
    private lastTriggerRect: TriggerRect | null = null;
    private overlayRefreshFrameId: number | null = null;
    private overlayRefreshNeedsMetrics = false;
    private lastOverlayPositionKey: string | null = null;
    private preferredOverlayPlacement = signal<'above' | 'below'>('below');
    displayAreaEl = viewChild<ElementRef<HTMLDivElement>>('displayArea');
    filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');
    optionsEl = viewChild<ElementRef<HTMLDivElement>>('optionsEl');
    optionsDropdownEl = viewChild<ElementRef<HTMLDivElement>>('optionsDropdown');
    optionsViewport = viewChild<CdkVirtualScrollViewport>('optionsViewport');
    connectedOverlay = viewChild(CdkConnectedOverlay);
    
    label = input<string>('');
    multiselect = input<boolean>(true);
    multistate = input<boolean>(false);
    countable = input<boolean>(false);
    keepUnavailableVisible = input<boolean>(false);
    semanticOnly = input<boolean>(false);
    displayText = input<string | undefined>();  // Text to display instead of pills when in semantic-only mode (fallback)
    displayItems = input<{ text: string; state: 'or' | 'and' | 'not' }[] | undefined>();  // Structured display items with state
    options = input<readonly DropdownOption[]>([]);
    selected = input<MultiStateSelection | string[]>([]);
    
    selectionChange = output<MultiStateSelection | readonly string[]>();

    showUnavailable = signal(false);
    showUnavailableToggle = computed(() => this.multistate() && this.options().some(o => o.available === false));
    isOpen = signal(false);
    filterText = signal('');
    private static readonly OVERLAY_GAP = 4;
    private static readonly DEFAULT_PANEL_HEIGHT_FALLBACK = 248;
    private static readonly FILTER_CONTAINER_HEIGHT_FALLBACK = 41;
    private static readonly VIEWPORT_MARGIN = 12;
    private openMaxHeight = signal(MultiSelectDropdownComponent.DEFAULT_PANEL_HEIGHT_FALLBACK);
    private overlayMinWidth = signal(0);
    readonly virtualScrollThreshold = 80;
    readonly optionItemSize = 44;
    readonly overlayWidth = computed(() => this.overlayMinWidth() || this.measureOverlayWidth());
    readonly repositionScrollStrategy = this.overlay.scrollStrategies.reposition();
    readonly overlayPlacement = signal<'above' | 'below'>('below');
    readonly overlayPositions = computed(() => this.preferredOverlayPlacement() === 'above'
        ? MultiSelectDropdownComponent.ABOVE_OVERLAY_POSITIONS
        : MultiSelectDropdownComponent.BELOW_OVERLAY_POSITIONS);

    private displayNameMap = computed(() => {
        const map = new Map<string, string>();
        for (const opt of this.options()) {
            if (opt.displayName) {
                map.set(opt.name, opt.displayName);
            }
        }
        return map;
    });

    getDisplayName(name: string): string {
        return this.displayNameMap().get(name) ?? name;
    }

    selectedOptions = computed(() => {
        if (this.multistate()) {
            const sel = (this.selected() as MultiStateSelection) || {};
            return Object.entries(sel)
                .filter(([_, selection]) => selection.state !== false)
                .map(([name, selection]) => ({ name, state: selection.state, count: selection.count }));
        }
        return (this.selected() as readonly string[] || []).map((name: string) => ({ name, state: 'or' as MultiState, count: 1 }));
    });

    /** When more than 5 pills, compress into summary pills grouped by state */
    private static readonly COMPRESS_THRESHOLD = 5;
    compressedPills = computed<{ state: MultiState; count: number }[] | null>(() => {
        const opts = this.selectedOptions();
        if (opts.length <= MultiSelectDropdownComponent.COMPRESS_THRESHOLD) return null;
        const counts = new Map<MultiState, number>();
        for (const o of opts) {
            counts.set(o.state, (counts.get(o.state) || 0) + 1);
        }
        const order: MultiState[] = ['or', 'and', 'not'];
        return order
            .filter(s => counts.has(s))
            .map(s => ({ state: s, count: counts.get(s)! }));
    });

    maxHeightOptions = computed(() => {
        if (!this.isOpen()) {
            return MultiSelectDropdownComponent.DEFAULT_PANEL_HEIGHT_FALLBACK;
        }
        return this.openMaxHeight();
    });

    viewportHeight = computed(() => {
        const maxHeight = this.maxHeightOptions();
        const contentHeight = this.filteredOptions().length * this.optionItemSize;
        return Math.min(maxHeight, contentHeight || this.optionItemSize);
    });

    filteredOptions = computed(() => {
        // Return empty array when closed
        if (!this.isOpen()) return [];
        
        const searchTokens = parseSearchQuery(this.filterText());
        const hasActiveFilter = this.filterText().trim().length > 0;
        const nameFiltered = this.options().filter(option => 
            matchesSearch(option.name, searchTokens, true) || 
            (option.displayName && matchesSearch(option.displayName, searchTokens, true))
        );

        // if the toggle is off, hide unavailable items
        if (!this.showUnavailable()) {
            if (hasActiveFilter || this.keepUnavailableVisible()) {
                return nameFiltered;
            }
            return nameFiltered.filter(option => option.available !== false || this.isSelected(option.name));
        }
        return nameFiltered;
    });

    useVirtualScroll = computed(() => this.filteredOptions().length >= this.virtualScrollThreshold);

    highlight(text: string): string {
        const searchTokens = parseSearchQuery(this.filterText());
        return highlightMatches(text, searchTokens, true);
    }

    toggleUnavailable(event: MouseEvent) {
        // prevent the click from closing the dropdown
        event.stopPropagation();
        this.showUnavailable.set(!this.showUnavailable());
    }

    private openListener = (ev: Event) => {
        const ce = ev as CustomEvent;
        // if another instance opened, close this one
        if (ce.detail !== this && this.isOpen()) {
            this.closeDropdown();
        }
    };

    private onOutsideDocumentClick = (event: MouseEvent) => {
        if (!this.isOpen()) return;
        const target = event.target;
        if (!(target instanceof Node)) return;

        const overlayElement = this.connectedOverlay()?.overlayRef?.overlayElement;
        if (overlayElement?.contains(target)) {
            return;
        }

        if (!this.elementRef.nativeElement.contains(target)) {
            this.closeDropdown();
        }
    };

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            this.stopAnchorFollowLoop();
            this.cancelScheduledOverlayRefresh();
            this.isOpen.set(false);
        });
        effect((cleanup) => {
            document.addEventListener('multi-select-dropdown-open', this.openListener as EventListener);
            cleanup(() => {
                document.removeEventListener('multi-select-dropdown-open', this.openListener as EventListener);
            });
        });

        effect((cleanup) => {
            if (!this.isOpen()) return;

            document.addEventListener('click', this.onOutsideDocumentClick, true);

            cleanup(() => {
                document.removeEventListener('click', this.onOutsideDocumentClick, true);
            });
        });

        effect((cleanup) => {
            if (!this.isOpen()) {
                return;
            }

            this.startAnchorFollowLoop();

            cleanup(() => {
                this.stopAnchorFollowLoop();
                this.cancelScheduledOverlayRefresh();
            });
        });

        effect(() => {
            if (!this.isOpen()) {
                return;
            }

            this.layoutService.windowWidth();
            this.layoutService.windowHeight();

            afterNextRender(() => {
                if (this.destroyed || !this.isOpen()) {
                    return;
                }

                this.scheduleOverlayRefresh(true);
            }, { injector: this.injector });
        });

        effect(() => {
            if (!this.isOpen() || !this.useVirtualScroll()) {
                return;
            }

            this.openMaxHeight();
            afterNextRender(() => {
                if (this.destroyed || !this.isOpen()) {
                    return;
                }

                this.optionsViewport()?.checkViewportSize();
            }, { injector: this.injector });
        });
    }

    private measureDropdownMaxHeight(placement = this.overlayPlacement()): number {
        const availableForList = this.measureAvailableListHeight(placement);
        if (!Number.isFinite(availableForList) || availableForList <= 0) {
            return MultiSelectDropdownComponent.DEFAULT_PANEL_HEIGHT_FALLBACK;
        }

        return availableForList;
    }

    private shouldShowFilterControls(): boolean {
        return this.options().length > 20 || this.showUnavailableToggle();
    }

    private measureAvailableVerticalSpace(placement: 'above' | 'below'): number {
        const displayArea = this.displayAreaEl()?.nativeElement;
        if (!displayArea) {
            return 0;
        }

        const triggerRect = displayArea.getBoundingClientRect();
        if (triggerRect.height === 0) {
            return 0;
        }

        const availableVerticalSpace = placement === 'below'
            ? this.layoutService.windowHeight() - triggerRect.bottom - MultiSelectDropdownComponent.VIEWPORT_MARGIN
            : triggerRect.top - MultiSelectDropdownComponent.VIEWPORT_MARGIN;

        if (!Number.isFinite(availableVerticalSpace) || availableVerticalSpace <= 0) {
            return 0;
        }

        return Math.floor(availableVerticalSpace);
    }

    private getFilterContainerHeightForMeasurements(): number {
        const measuredHeight = this.measureFilterContainerHeight();
        if (measuredHeight > 0) {
            return measuredHeight;
        }

        return this.shouldShowFilterControls()
            ? MultiSelectDropdownComponent.FILTER_CONTAINER_HEIGHT_FALLBACK
            : 0;
    }

    private measureAvailableListHeight(placement: 'above' | 'below'): number {
        const displayArea = this.displayAreaEl()?.nativeElement;
        if (!displayArea) {
            return 0;
        }

        const triggerRect = displayArea.getBoundingClientRect();
        if (triggerRect.height === 0) {
            return 0;
        }

        const filterRowHeight = this.getFilterContainerHeightForMeasurements();
        const availableVerticalSpace = placement === 'below'
            ? this.layoutService.windowHeight() - triggerRect.bottom - MultiSelectDropdownComponent.VIEWPORT_MARGIN
            : triggerRect.top - MultiSelectDropdownComponent.VIEWPORT_MARGIN;
        const availableForList = availableVerticalSpace - filterRowHeight - 8 - MultiSelectDropdownComponent.OVERLAY_GAP;

        if (!Number.isFinite(availableForList) || availableForList <= 0) {
            return 0;
        }

        return Math.floor(availableForList);
    }

    private determinePreferredOverlayPlacement(): 'above' | 'below' {
        const belowAvailableHeight = this.measureAvailableVerticalSpace('below');
        const aboveAvailableHeight = this.measureAvailableVerticalSpace('above');

        if (belowAvailableHeight < MultiSelectDropdownComponent.DEFAULT_PANEL_HEIGHT_FALLBACK
            && aboveAvailableHeight > belowAvailableHeight) {
            return 'above';
        }

        return 'below';
    }

    private updatePreferredOverlayPlacement(): 'above' | 'below' {
        const preferredPlacement = this.determinePreferredOverlayPlacement();
        this.preferredOverlayPlacement.set(preferredPlacement);
        return preferredPlacement;
    }

    private measureFilterContainerHeight(): number {
        const dropdown = this.optionsDropdownEl()?.nativeElement;
        if (!dropdown) {
            return 0;
        }

        const filterContainer = dropdown.querySelector<HTMLElement>('.filter-container:not([hidden])');
        if (!filterContainer) {
            return 0;
        }

        return Math.ceil(filterContainer.getBoundingClientRect().height);
    }

    private measureOverlayWidth(): number {
        const displayArea = this.displayAreaEl()?.nativeElement;
        if (!displayArea) {
            return 0;
        }

        return displayArea.getBoundingClientRect().width;
    }

    private captureOpenMetrics(placement = this.overlayPlacement()) {
        this.overlayMinWidth.set(this.measureOverlayWidth());
        this.openMaxHeight.set(this.measureDropdownMaxHeight(placement));
    }

    private measureTriggerRect(): TriggerRect | null {
        const triggerElement = this.displayAreaEl()?.nativeElement;
        if (!triggerElement?.isConnected) {
            return null;
        }

        const rect = triggerElement.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        };
    }

    private hasTriggerRectChanged(nextRect: TriggerRect, previousRect: TriggerRect | null): boolean {
        if (!previousRect) {
            return true;
        }

        return Math.abs(nextRect.left - previousRect.left) > 0.5
            || Math.abs(nextRect.top - previousRect.top) > 0.5
            || Math.abs(nextRect.width - previousRect.width) > 0.5
            || Math.abs(nextRect.height - previousRect.height) > 0.5;
    }

    private startAnchorFollowLoop() {
        if (this.anchorFollowFrameId !== null) {
            return;
        }

        const step = () => {
            this.anchorFollowFrameId = null;

            if (this.destroyed || !this.isOpen()) {
                return;
            }

            const nextRect = this.measureTriggerRect();
            if (!nextRect) {
                this.closeDropdown();
                return;
            }

            if (this.hasTriggerRectChanged(nextRect, this.lastTriggerRect)) {
                const preferredPlacement = this.updatePreferredOverlayPlacement();
                const widthOrHeightChanged = !this.lastTriggerRect
                    || Math.abs(nextRect.width - this.lastTriggerRect.width) > 0.5
                    || Math.abs(nextRect.height - this.lastTriggerRect.height) > 0.5;
                const placementPreferenceChanged = preferredPlacement !== this.overlayPlacement();

                this.lastTriggerRect = nextRect;

                if (widthOrHeightChanged || placementPreferenceChanged) {
                    this.captureOpenMetrics(preferredPlacement);
                }

                this.connectedOverlay()?.overlayRef?.updatePosition();
            }

            this.anchorFollowFrameId = requestAnimationFrame(step);
        };

        this.anchorFollowFrameId = requestAnimationFrame(step);
    }

    private stopAnchorFollowLoop() {
        if (this.anchorFollowFrameId !== null) {
            cancelAnimationFrame(this.anchorFollowFrameId);
            this.anchorFollowFrameId = null;
        }

        this.lastTriggerRect = null;
    }

    private resetOverlayState() {
        this.stopAnchorFollowLoop();
        this.cancelScheduledOverlayRefresh();
        this.lastOverlayPositionKey = null;
        this.preferredOverlayPlacement.set('below');
        this.overlayPlacement.set('below');
        this.openMaxHeight.set(MultiSelectDropdownComponent.DEFAULT_PANEL_HEIGHT_FALLBACK);
    }

    private closeDropdown() {
        this.isOpen.set(false);
        this.filterText.set('');
        this.resetOverlayState();
    }

    private focusFilterInput() {
        const inputEl = this.filterInput()?.nativeElement;
        if (inputEl) {
            inputEl.focus();
        }
    }

    private scrollToOption(optionName: string) {
        const options = this.filteredOptions();
        const optionIndex = options.findIndex(option => option.name === optionName);

        if (this.useVirtualScroll()) {
            const viewport = this.optionsViewport();
            if (viewport && optionIndex >= 0) {
                viewport.scrollToIndex(optionIndex, 'smooth');
            }
            return;
        }

        const container = this.optionsEl()?.nativeElement;
        if (!container) {
            return;
        }

        const items = Array.from(container.querySelectorAll<HTMLElement>('.option-item'));
        for (const item of items) {
            if (item.getAttribute('data-option-name') === optionName) {
                try {
                    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
                } catch {
                    item.scrollIntoView();
                }
                break;
            }
        }
    }

    private openDropdown({ focusInput, scrollToOptionName }: OpenDropdownOptions) {
        const preferredPlacement = this.updatePreferredOverlayPlacement();
        this.overlayPlacement.set(preferredPlacement);
        this.captureOpenMetrics(preferredPlacement);
        document.dispatchEvent(new CustomEvent('multi-select-dropdown-open', { detail: this }));
        this.isOpen.set(true);
        this.filterText.set('');

        afterNextRender(() => {
            if (this.destroyed || !this.isOpen()) {
                return;
            }

            if (scrollToOptionName) {
                this.scrollToOption(scrollToOptionName);
            }
            if (focusInput) {
                this.focusFilterInput();
            }
        }, { injector: this.injector });
    }

    private scheduleOverlayRefresh(recalculateMetrics = false) {
        if (recalculateMetrics) {
            this.overlayRefreshNeedsMetrics = true;
        }

        if (this.overlayRefreshFrameId !== null) {
            return;
        }

        this.overlayRefreshFrameId = requestAnimationFrame(() => {
            this.overlayRefreshFrameId = null;
            const shouldRecalculateMetrics = this.overlayRefreshNeedsMetrics;
            this.overlayRefreshNeedsMetrics = false;

            if (this.destroyed || !this.isOpen()) {
                return;
            }

            const triggerElement = this.displayAreaEl()?.nativeElement;
            if (!triggerElement?.isConnected) {
                this.closeDropdown();
                return;
            }

            const preferredPlacement = this.updatePreferredOverlayPlacement();
            if (shouldRecalculateMetrics) {
                this.captureOpenMetrics(preferredPlacement);
            }

            if (shouldRecalculateMetrics || preferredPlacement !== this.overlayPlacement()) {
                this.connectedOverlay()?.overlayRef?.updatePosition();
            }
        });
    }

    private cancelScheduledOverlayRefresh() {
        if (this.overlayRefreshFrameId === null) {
            return;
        }

        cancelAnimationFrame(this.overlayRefreshFrameId);
        this.overlayRefreshFrameId = null;
        this.overlayRefreshNeedsMetrics = false;
    }

    onPointerDown(event: PointerEvent) {
        this.lastPointerType = event.pointerType;
    }

    toggleDropdown() {
        if (this.semanticOnly()) return;
        const shouldFocusFilter = this.lastPointerType === 'mouse';
        this.lastPointerType = '';
        if (this.isOpen()) {
            this.closeDropdown();
            return;
        }

        this.openDropdown({ focusInput: shouldFocusFilter });
    }

    openAndScrollTo(optionName: string, event: MouseEvent) {
        event.stopPropagation();
        this.openDropdown({ focusInput: true, scrollToOptionName: optionName });
    }

    onOverlayAttached() {
        this.scheduleOverlayRefresh(true);
    }

    onOverlayDetached() {
        this.resetOverlayState();
    }

    onOverlayPositionChange(event: ConnectedOverlayPositionChange) {
        this.overlayPlacement.set(event.connectionPair.overlayY === 'top' ? 'below' : 'above');
        const positionKey = [
            event.connectionPair.originX,
            event.connectionPair.originY,
            event.connectionPair.overlayX,
            event.connectionPair.overlayY,
        ].join(':');
        const positionChanged = positionKey !== this.lastOverlayPositionKey;
        this.lastOverlayPositionKey = positionKey;
        this.scheduleOverlayRefresh(positionChanged);
    }

    onFilterInput(event: Event) {
        const inputElement = event.target as HTMLInputElement;
        this.filterText.set(inputElement.value);
    }

    onOptionToggle(optionName: string, event?: MouseEvent) {
        const restoreState = this.captureScrollRestoreState(optionName);

        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            const current = currentSelection[optionName] || { state: false as MultiState, count: 1 };
            let nextState: MultiState;
            switch (current.state) {
                case false: nextState = 'or'; break;
                case 'or': nextState = 'and'; break;
                case 'and': nextState = 'not'; break;
                case 'not': nextState = false; break;
                default: nextState = 'or';
            }
            if (nextState === false) {
                delete currentSelection[optionName];
            } else {
                const count = nextState === 'not' ? 1 : current.count;
                currentSelection[optionName] = { name: optionName, state: nextState, count };
            }
            this.selectionChange.emit(currentSelection);
        } else {
            const currentSelection = this.selectedOptions().map(o => o.name);
            const newSelection = [...currentSelection];
            const index = newSelection.indexOf(optionName);

            if (index > -1) {
                newSelection.splice(index, 1);
            } else {
                newSelection.push(optionName);
            }
            this.selectionChange.emit(newSelection);
        }
        
        this.restoreScrollPosition(restoreState);
    }

    private captureScrollRestoreState(optionName: string): ScrollRestoreState | null {
        if (this.useVirtualScroll()) {
            const viewport = this.optionsViewport();
            const scrollOffset = viewport?.measureScrollOffset('top');
            if (!viewport || scrollOffset === undefined) {
                return null;
            }

            const optionIndex = this.filteredOptions().findIndex(option => option.name === optionName);
            return {
                kind: 'virtual',
                optionName,
                scrollOffset,
                ...(optionIndex >= 0 ? { optionVisibleTop: optionIndex * this.optionItemSize - scrollOffset } : {}),
            };
        }

        const container = this.optionsEl()?.nativeElement;
        if (!container) {
            return null;
        }

        const item = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(optionName) + '"]');
        if (!item) {
            return null;
        }

        const containerRect = container.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        return {
            kind: 'dom',
            optionName,
            visibleTop: itemRect.top - containerRect.top,
        };
    }

    private restoreScrollPosition(restoreState: ScrollRestoreState | null) {
        // restore the preserved scroll after the DOM updates
        afterNextRender(() => {
            if (!restoreState) {
                return;
            }

            if (restoreState.kind === 'virtual') {
                const viewport = this.optionsViewport();
                if (!viewport) {
                    return;
                }

                let nextOffset = restoreState.scrollOffset;
                if (restoreState.optionVisibleTop !== undefined) {
                    const optionIndex = this.filteredOptions().findIndex(option => option.name === restoreState.optionName);
                    if (optionIndex >= 0) {
                        nextOffset = optionIndex * this.optionItemSize - restoreState.optionVisibleTop;
                    }
                }

                const maxOffset = Math.max(0, viewport.getDataLength() * this.optionItemSize - viewport.getViewportSize());
                viewport.scrollToOffset(Math.max(0, Math.min(maxOffset, nextOffset)));
                return;
            }

            const container = this.optionsEl()?.nativeElement;
            if (!container) {
                return;
            }

            // find the same item after update
            const itemAfter = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(restoreState.optionName) + '"]');
            if (!itemAfter) {
                return;
            }

            const containerRect = container.getBoundingClientRect();
            const itemRect = itemAfter.getBoundingClientRect();

            // item offset within the scrollable content (distance from content top)
            const itemAfterOffsetTop = (itemRect.top - containerRect.top) + container.scrollTop;

            // desired visible top within container is the preservedVisibleTop
            let newScrollTop = itemAfterOffsetTop - restoreState.visibleTop;
            newScrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, newScrollTop));

            // apply only if it meaningfully changes the scroll to avoid jitter
            if (Math.abs(container.scrollTop - newScrollTop) > 0.5) {
                container.scrollTop = newScrollTop;
            }
        }, { injector: this.injector });
    }

    getState(optionName: string): MultiState {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.state || false;
        }
        return this.isSelected(optionName) ? 'or' : false;
    }

    getCount(optionName: string): number {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.count || 1;
        }
        return 1;
    }

    setCount(optionName: string, count: number) {
        if (!this.countable() || !this.multistate()) return;
        const restoreState = this.captureScrollRestoreState(optionName);

        
        const sel = this.selected() as MultiStateSelection;
        const currentSelection: MultiStateSelection = { ...sel };
        const current = currentSelection[optionName];
        
        if (current && (current.state === 'and' || current.state === 'or')) {
            currentSelection[optionName] = { 
                name: optionName,
                state: current.state, 
                count: Math.max(1, count) 
            };
            this.selectionChange.emit(currentSelection);
        }
        this.restoreScrollPosition(restoreState);
    }

    trackOptionName = (_index: number, option: DropdownOption) => option.name;
 
    onQuantityInput(optionName: string, event: Event) {
        const inputElement = event.target as HTMLInputElement;
        const value = parseInt(inputElement.value, 10);
        if (!isNaN(value)) {
            this.setCount(optionName, value);
        }
    }

    onQuantityWheel(optionName: string, event: WheelEvent) {
        // stop the wheel from scrolling the outer container
        event.preventDefault();
        event.stopPropagation();

        // Adjust the count by 1 step per wheel event (wheel down -> decrease)
        const delta = event.deltaY;
        if (delta === 0) return;

        const step = delta > 0 ? -1 : 1;
        const current = this.getCount(optionName) || 1;
        const next = Math.max(1, current + step);
        if (next !== current) {
            this.setCount(optionName, next);
        }
    }

    onSingleSelect(optionName: string) {
        if (!this.multiselect()) {
            this.selectionChange.emit([optionName]);
            this.closeDropdown();
        }
    }

    removeOption(option: string, event: MouseEvent) {
        event.stopPropagation();
        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            delete currentSelection[option];
            this.selectionChange.emit(currentSelection);
        } else {
            this.onOptionToggle(option);
        }
    }

    removeCompressedState(state: MultiState, event: MouseEvent) {
        event.stopPropagation();

        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            for (const [optionName, selection] of Object.entries(currentSelection)) {
                if (selection.state === state) {
                    delete currentSelection[optionName];
                }
            }
            this.selectionChange.emit(currentSelection);
            return;
        }

        const remainingSelection = this.selectedOptions()
            .filter(option => option.state !== state)
            .map(option => option.name);
        this.selectionChange.emit(remainingSelection);
    }

    isSelected(optionName: string): MultiState | boolean {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.state || false;
        }
        return this.selectedOptions().some(o => o.name === optionName);
    }
}