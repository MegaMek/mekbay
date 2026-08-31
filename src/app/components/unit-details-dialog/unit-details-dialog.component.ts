// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, inject, ElementRef, signal, ChangeDetectionStrategy, output, viewChild, effect, computed, type Signal, isSignal, DestroyRef } from '@angular/core';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import type { UnitSummary } from '../../models/unit-summary.model';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../services/toast.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { shareUrlWithClipboardFallback } from '../../utils/clipboard.util';
import { FloatingOverlayService } from '../../services/floating-overlay.service';
import { SwipeDirective, type SwipeEndEvent, type SwipeMoveEvent, type SwipeStartEvent } from '../../directives/swipe.directive';
import { LongPressDirective } from '../../directives/long-press.directive';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { GameSystem } from '../../models/common.model';
import { UnitDetailsGeneralTabComponent } from './tabs/unit-details-general-tab.component';
import { UnitDetailsIntelTabComponent } from './tabs/unit-details-intel-tab.component';
import { UnitDetailsFactionTabComponent } from './tabs/unit-details-factions-tab.component';
import { UnitDetailsSheetTabComponent } from './tabs/unit-details-sheet-tab.component';
import { UnitDetailsVariantsTabComponent, type VariantsTabState, DEFAULT_VARIANTS_TAB_STATE } from './tabs/unit-details-variants-tab.component';
import { GameService } from '../../services/game.service';
import { UnitDetailsCardTabComponent } from './tabs/unit-details-card-tab.component';
import { UnitTagsComponent, type TagClickEvent } from '../unit-tags/unit-tags.component';
import { TaggingService } from '../../services/tagging.service';
import { UrlService } from '../../services/url.service';
import { DialogsService } from '../../services/dialogs.service';
import { LayoutService } from '../../services/layout.service';
import { buildUnitShareLinks } from '../../utils/force-url.util';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { UnitDetailsFooterComponent } from '../unit-details-footer/unit-details-footer.component';
import { getNormalizationGunnery, getNormalizationPiloting, type UnitSearchNormalizationMatch } from '../../models/unit-search-result.model';
import { UnitFluffImageService } from '../../services/catalogs/unit-fluff-image.service';
import { UnitDetailsSummaryService } from '../../services/unit-details-summary.service';


export interface UnitDetailsDialogData {
    unitList: UnitSummary[] | Signal<ASForceUnit[]>;
    unitIndex: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
    /** Search normalization context keyed by unit UUID. */
    searchResultContexts?: ReadonlyMap<string, UnitSearchNormalizationMatch>;
    hideAddButton?: boolean;
    /** When true, ADD only emits the unit without adding to force */
    selectMode?: boolean;
    changeAction?: UnitDetailsChangeAction;
    showChangeButton?: boolean;
    /** Override game system when the unit list contains summaries. */
    gameSystem?: GameSystem;
}

export interface UnitDetailsChangeAction {
    originalUnit: UnitSummary;
    apply: (unit: UnitSummary) => boolean | void | Promise<boolean | void>;
    disabled?: () => boolean;
    closeParentOnChange?: boolean;
}

@Component({
    selector: 'unit-details-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BaseDialogComponent, SwipeDirective, LongPressDirective, UnitIconComponent, UnitDetailsGeneralTabComponent, UnitDetailsIntelTabComponent, UnitDetailsFactionTabComponent, UnitDetailsSheetTabComponent, UnitDetailsCardTabComponent, UnitDetailsVariantsTabComponent, UnitTagsComponent, UnitDetailsFooterComponent],
    templateUrl: './unit-details-dialog.component.html',
    styleUrl: './unit-details-dialog.component.css',
    host: {
        '[class.fluff-background]': 'hostHasFluff',
        '[style.--fluff-bg]': 'hostFluffBg'
    }
})
export class UnitDetailsDialogComponent {
    gameService = inject(GameService);
    protected readonly forceWorkspace = inject(ForceWorkspaceStateService);

    private readonly forceCommands = inject(ForceWorkspaceCommandsService);
    private dialogRef = inject(DialogRef<void>);
    data = inject(DIALOG_DATA) as UnitDetailsDialogData;
    toastService = inject(ToastService);
    layoutService = inject(LayoutService);
    floatingOverlayService = inject(FloatingOverlayService);
    private taggingService = inject(TaggingService);
    private urlService = inject(UrlService);
    private dialogsService = inject(DialogsService);
    private keyboardShortcutService = inject(KeyboardShortcutService);
    private destroyRef = inject(DestroyRef);
    private fluffImages = inject(UnitFluffImageService);
    private detailsSummaries = inject(UnitDetailsSummaryService);
    add = output<UnitSummary>();
    select = output<UnitSummary>();
    change = output<{ oldUnit: ASForceUnit; newUnit: UnitSummary }>();
    indexChange = output<number>();
    baseDialogRef = viewChild('baseDialog', { read: ElementRef });
    sheetTabRef = viewChild<UnitDetailsSheetTabComponent>(UnitDetailsSheetTabComponent);
    currentPanelRef = viewChild<ElementRef<HTMLElement>>('currentPanel');
    incomingPanelRef = viewChild<ElementRef<HTMLElement>>('incomingPanel');
    shareButtonInActions = computed(() => this.layoutService.windowWidth() > 600);

    /** Computed property to determine if we're in change mode */
    isChangeMode = computed(() => {
        return !!this.activeChangeAction();
    });

    isChangeDisabled = computed(() => {
        const action = this.activeChangeAction();
        return !action || action.disabled?.() === true || action.originalUnit.name === this.unit.name;
    });

    tabs = computed<string[]>(() => {
        return ['General', 'Intel', 'Factions', 'Variants', 'Sheet', 'Card'];
    });
    activeTab = signal(this.deriveInitialIsAlphaStrike() ? 'Card' : 'General');

    unitList = computed<UnitSummary[] | ASForceUnit[]>(() => {
        const input = this.data.unitList;
        return isSignal(input) ? input() : input;
    });
    unitIndex = signal(this.data.unitIndex);
    private readonly resolvedActiveUnit = signal<{
        readonly source: UnitSummary;
        readonly summary: UnitSummary;
    } | null>(null);
    prevUnit = computed<UnitSummary | null>(() => {
        if (!this.hasPrev) return null;
        return this.getUnitAtIndex(this.unitIndex() - 1);
    });
    nextUnit = computed<UnitSummary | null>(() => {
        if (!this.hasNext) return null;
        return this.getUnitAtIndex(this.unitIndex() + 1);
    });
    /** Derives game system from an Alpha Strike member, otherwise uses the explicit/global context. */
    currentGameSystem = computed<GameSystem>(() => {
        const list = this.unitList();
        const item = list[this.unitIndex()];
        if (item instanceof ASForceUnit) {
            return item.force.gameSystem;
        }
        return this.data.gameSystem ?? this.gameService.currentGameSystem();
    });

    isAlphaStrike = computed<boolean>(() => {
        return this.currentGameSystem() === GameSystem.ALPHA_STRIKE;
    });
    readonly searchResultContext = computed<UnitSearchNormalizationMatch | null>(() => {
        const currentUnit = this.unitList()[this.unitIndex()];
        const unitUuid = currentUnit instanceof ASForceUnit ? currentUnit.getSummary().uuid : currentUnit?.uuid;
        return unitUuid ? this.data.searchResultContexts?.get(unitUuid) ?? null : null;
    });
    gunnerySkill = computed<number | undefined>(() => {
        const currentUnit = this.unitList()[this.unitIndex()]
        if (currentUnit instanceof ASForceUnit) return currentUnit.getPilotSkill();
        const context = this.searchResultContext();
        return context ? getNormalizationGunnery(context) : this.data.gunnerySkill;
    });
    pilotingSkill = computed<number | undefined>(() => {
        const currentUnit = this.unitList()[this.unitIndex()]
        if (currentUnit instanceof ASForceUnit) return currentUnit.getPilotSkill();
        const context = this.searchResultContext();
        return context ? getNormalizationPiloting(context) : this.data.pilotingSkill;
    });

    // Swipe animation state
    isSwipeAnimating = signal(false);
    incomingUnit = signal<UnitSummary | null>(null);
    readonly incomingSearchResultContext = computed<UnitSearchNormalizationMatch | null>(() => {
        const unitUuid = this.incomingUnit()?.uuid;
        return unitUuid ? this.data.searchResultContexts?.get(unitUuid) ?? null : null;
    });
    readonly incomingGunnerySkill = computed<number | undefined>(() => {
        const context = this.incomingSearchResultContext();
        return context ? getNormalizationGunnery(context) : this.data.gunnerySkill;
    });
    readonly incomingPilotingSkill = computed<number | undefined>(() => {
        const context = this.incomingSearchResultContext();
        return context ? getNormalizationPiloting(context) : this.data.pilotingSkill;
    });

    // Real-time swipe following state
    isSwiping = signal(false);
    swipeDeltaX = signal(0); // Raw swipe delta for header calculation
    incomingPanelScrollTop = signal(0);

    // CSS custom properties for panel positions
    currentPanelOffset = signal('0');
    incomingPanelOffset = signal('100%');

    /** View mode for variants tab (persisted while dialog is open) */
    variantsTabState = signal<VariantsTabState>({ ...DEFAULT_VARIANTS_TAB_STATE });
    // Header unit - shows the most visible unit during swipe
    headerUnit = computed(() => {
        const incoming = this.incomingUnit();
        if (!incoming) return this.unit;

        // Get the dialog width to calculate 50% threshold
        const dialogEl = this.baseDialogRef()?.nativeElement;
        const containerWidth = dialogEl?.querySelector('.swipe-container')?.clientWidth || 400;
        const threshold = containerWidth / 2;

        const delta = Math.abs(this.swipeDeltaX());

        // If we've swiped more than 50% of the width, show the incoming unit
        if (delta > threshold) {
            return incoming;
        }
        return this.unit;
    });

    // Fluff background image URL - based on header unit (most visible during swipe)
    headerFluffImageUrl = computed(() => {
        return this.fluffImages.resolveUrl(this.headerUnit());
    });

    get unit(): UnitSummary {
        const source = this.getUnitAtIndex(this.unitIndex());
        const resolved = this.resolvedActiveUnit();
        return resolved?.source === source ? resolved.summary : source;
    }

    /** Reads the game system directly from dialog data (used for field initializers before computeds are available). */
    private deriveInitialIsAlphaStrike(): boolean {
        const input = this.data.unitList;
        const list = isSignal(input) ? input() : input;
        const item = list[this.data.unitIndex];
        if (item instanceof ASForceUnit) {
            return item.force.gameSystem === GameSystem.ALPHA_STRIKE;
        }
        if (this.data.gameSystem) {
            return this.data.gameSystem === GameSystem.ALPHA_STRIKE;
        }
        return this.gameService.isAlphaStrike();
    }

    get hostHasFluff(): boolean {
        return !!this.headerFluffImageUrl();
    }

    get hostFluffBg(): string | null {
        const url = this.headerFluffImageUrl();
        return url ? `url("${url}")` : null;
    }

    constructor() {
        effect(onCleanup => {
            const current = this.unitList()[this.unitIndex()];
            this.resolvedActiveUnit.set(null);
            if (current instanceof ASForceUnit) return;

            let active = true;
            void this.detailsSummaries.resolve(current).then(summary => {
                if (active) this.resolvedActiveUnit.set({ source: current, summary });
            });
            onCleanup(() => { active = false; });
        });

        this.keyboardShortcutService.register({
            id: 'unit-details-dialog',
            dialogRef: this.dialogRef,
            handle: (event) => this.handleShortcutKeyDown(event),
        }, this.destroyRef);

        effect(() => {
            this.unit;
            const activeTab = this.activeTab();
            this.urlService.setQueryParams({
                shareUnit: this.unit.name,
                tab: activeTab,
            });
        });
        
        let isFirstRun = true;
        effect(() => {
            const index = this.unitIndex();
            if (isFirstRun) {
                isFirstRun = false;
                return; // Skip initial emission to prevent scroll on dialog open
            }
            this.indexChange.emit(index);
        });
        
        // Clean up URL params when dialog closes
        firstValueFrom(this.dialogRef.closed).then(() => {
            this.urlService.setQueryParams({
                shareUnit: null,
                tab: null,
            });
        });
    }

    private handleShortcutKeyDown(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.altKey || event.metaKey) return false;

        if (event.key === 'ArrowLeft') {
            if (this.hasPrev) {
                this.onPrev();
            }
            return true;
        } else if (event.key === 'ArrowRight') {
            if (this.hasNext) {
                this.onNext();
            }
            return true;
        }

        return false;
    }

    get hasPrev(): boolean {
        return this.unitList() && this.unitIndex() > 0;
    }

    get hasNext(): boolean {
        return this.unitList() && this.unitIndex() < this.unitList().length - 1;
    }

    private getUnitAtIndex(index: number): UnitSummary {
        const item = this.unitList()[index];
        if (item instanceof ASForceUnit) {
            return item.getSummary();
        }
        return item;
    }

    onPrev() {
        if (this.hasPrev && !this.isSwipeAnimating() && !this.isSwiping()) {
            // Emulate RIGHT swipe: current goes right, prev comes from left
            this.floatingOverlayService.hide();
            this.unitIndex.update(v => v - 1);
        }
    }

    onNext() {
        if (this.hasNext && !this.isSwipeAnimating() && !this.isSwiping()) {
            // Emulate LEFT swipe: current goes left, next comes from right
            this.floatingOverlayService.hide();
            this.unitIndex.update(v => v + 1);
        }
    }

    async onSelect() {
        const selectedUnit = this.unit;
        this.select.emit(selectedUnit);
        this.onClose();
        return;
    }


    async onAdd(event?: MouseEvent) {
        this._addUnit(event?.ctrlKey ?? false);
    }

    async onAddLongPress() {
        this._addUnit(true);
    }

    /**
     * When adding the first unit, if the active tab doesn't match the current game system,
     * ask the user which game system to use for the new force.
     * Returns the chosen GameSystem, or `null` if the user cancelled.
     */
    private async resolveGameSystemForFirstUnit(): Promise<GameSystem | undefined | null> {
        // Only relevant when no force exists yet (first unit creates the force)
        if (this.forceWorkspace.smartCurrentForce()) return undefined;

        const tab = this.activeTab();
        const gameSystem = this.gameService.currentGameSystem();
        const isMismatch =
            (tab === 'Sheet' && gameSystem === GameSystem.ALPHA_STRIKE) ||
            (tab === 'Card' && gameSystem === GameSystem.CLASSIC);
        if (!isMismatch) return undefined;

        const ref = this.dialogsService.createDialog<GameSystem | undefined>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<GameSystem>>{
                title: 'Game System',
                message: 'Which game system should the new force use?',
                buttons: [
                    { label: 'Classic BattleTech', value: GameSystem.CLASSIC },
                    { label: 'Alpha Strike', value: GameSystem.ALPHA_STRIKE },
                ]
            }
        });
        const chosen = await firstValueFrom(ref.closed);
        return chosen ?? null; // null = cancelled
    }

    private async _addUnit(keepOpen: boolean) {
        if (this.data.selectMode) return;

        const gameSystemOverride = await this.resolveGameSystemForFirstUnit();
        if (gameSystemOverride === null) return; // user cancelled

        const selectedUnit = this.unit;
        const currentItem = this.unitList()[this.unitIndex()];
        let gunnery;
        let piloting;
        if (currentItem instanceof ASForceUnit) {
            gunnery = currentItem.getPilotSkill();
            piloting = currentItem.getPilotSkill();
        } else {
            gunnery = this.gunnerySkill();
            piloting = this.pilotingSkill();
        }
        const addedUnit = await this.forceCommands.addUnit(
            selectedUnit,
            gunnery,
            piloting,
            undefined,
            gameSystemOverride
        );
        if (addedUnit) {
            this.toastService.showToast(`${selectedUnit.chassis} ${selectedUnit.model} added to the force.`, 'success');
            this.add.emit(selectedUnit);
        }
        if (!keepOpen) {
            this.onClose();
        }
    }

    async onAddMultiple() {
        if (this.data.selectMode) return;

        const gameSystemOverride = await this.resolveGameSystemForFirstUnit();
        if (gameSystemOverride === null) return; // user cancelled

        const ref = this.dialogsService.createDialog<number | undefined>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<number>>{
                title: 'Add Multiple',
                message: `How many copies of ${this.unit.chassis} ${this.unit.model}?`,
                buttons: [
                    { label: '1', value: 1, class: 'square' },
                    { label: '2', value: 2, class: 'square' },
                    { label: '3', value: 3, class: 'square' },
                    { label: '4', value: 4, class: 'square' },
                    { label: '5', value: 5, class: 'square' },
                    { label: '6', value: 6, class: 'square' },
                ]
            }
        });
        const count = await firstValueFrom(ref.closed);
        if (count == null) return;

        const selectedUnit = this.unit;
        let gunnery: number | undefined;
        let piloting: number | undefined;
        const currentItem = this.unitList()[this.unitIndex()];
        if (currentItem instanceof ASForceUnit) {
            gunnery = currentItem.getPilotSkill();
            piloting = currentItem.getPilotSkill();
        } else {
            gunnery = this.gunnerySkill();
            piloting = this.pilotingSkill();
        }

        let addedCount = 0;
        for (let i = 0; i < count; i++) {
            const added = await this.forceCommands.addUnit(selectedUnit, gunnery, piloting, undefined, gameSystemOverride);
            if (added) addedCount++;
        }
        if (addedCount > 0) {
            this.toastService.showToast(
                `${addedCount}x ${selectedUnit.chassis} ${selectedUnit.model} added to the force.`,
                'success'
            );
        }
    }

    async onChange() {
        const action = this.activeChangeAction();
        if (!action) return;

        const result = await action.apply(this.unit);
        if (result === false) return;

        this.onClose();
    }

    onClose() {
        this.dialogRef.close();
    }

    formatThousands(value: number): string {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    async onShare() {
        const { httpsUrl } = buildUnitShareLinks(
            window.location.origin,
            window.location.pathname,
            this.currentGameSystem(),
            this.unit.name,
            this.activeTab(),
        );
        const shareTitle = `${this.unit.chassis} ${this.unit.model}`;
        const result = await shareUrlWithClipboardFallback({ title: shareTitle, url: httpsUrl });
        if (result === 'copied') {
            this.toastService.showToast('Unit links copied to clipboard.', 'success');
        }
    }

    async onTagClick({ unit, event }: TagClickEvent) {
        event.stopPropagation();
        const anchorEl = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        await this.taggingService.openTagSelector([unit], anchorEl);
    }

    /** Handle variant card click - opens a new dialog for that variant */
    onVariantClick(event: { variant: UnitSummary; variants: UnitSummary[] }): void {
        if (this.data.selectMode) return;

        const changeAction = this.wrapParentClose(this.variantChangeAction());
    
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: event.variants,
                unitIndex: event.variants.indexOf(event.variant),
                gunnerySkill: this.gunnerySkill(),
                pilotingSkill: this.pilotingSkill(),
                hideAddButton: this.data.hideAddButton,
                selectMode: this.data.selectMode,
                changeAction,
                showChangeButton: !!changeAction,
            }
        });
    }

    private activeChangeAction(): UnitDetailsChangeAction | null {
        return this.data.showChangeButton === true ? this.data.changeAction ?? null : null;
    }

    private variantChangeAction(): UnitDetailsChangeAction | undefined {
        const currentItem = this.unitList()[this.unitIndex()];
        if (currentItem instanceof ASForceUnit) {
            return this.forceUnitChangeAction(currentItem);
        }

        return this.data.showChangeButton === true ? undefined : this.data.changeAction;
    }

    private forceUnitChangeAction(originalForceUnit: ASForceUnit): UnitDetailsChangeAction {
        return {
            originalUnit: originalForceUnit.getSummary(),
            disabled: () => originalForceUnit.readOnly(),
            closeParentOnChange: true,
            apply: async (selectedUnit: UnitSummary) => {
                const result = await this.forceCommands.replaceAlphaStrikeUnit(originalForceUnit, selectedUnit);
                if (!result) return false;

                this.toastService.showToast(
                    `Changed ${originalForceUnit.getSummary().chassis} ${originalForceUnit.getSummary().model} to ${selectedUnit.chassis} ${selectedUnit.model}.`,
                    'success'
                );
                this.change.emit({ oldUnit: originalForceUnit, newUnit: selectedUnit });

                const newIndex = this.unitList().findIndex((unit) => unit instanceof ASForceUnit && unit.id === result.id);
                if (newIndex >= 0) {
                    this.unitIndex.set(newIndex);
                }
                return true;
            },
        };
    }

    private wrapParentClose(action: UnitDetailsChangeAction | undefined): UnitDetailsChangeAction | undefined {
        if (!action?.closeParentOnChange) {
            return action;
        }

        return {
            ...action,
            closeParentOnChange: false,
            apply: async (unit: UnitSummary) => {
                const result = await action.apply(unit);
                if (result === false) return false;

                this.onClose();
                return true;
            },
        };
    }

    public shouldBlockSwipe = (): boolean => {
        // Don't block if already swiping - only block before swipe starts
        if (this.isSwiping()) return false;

        if (this.activeTab() === 'Sheet' && this.isSheetSwipeBlocked()) return true;

        // Block if animation is in progress
        if (this.isSwipeAnimating()) return true;

        // Block if single item list (no prev and no next)
        const index = this.unitIndex();
        return (index === 0 && !this.hasNext) || (index === this.unitList().length - 1 && !this.hasPrev);
    };

    private isSheetSwipeBlocked(): boolean {
        return this.sheetTabRef()?.isZoomPanActive() ?? false;
    }

    public onSwipeStart(event: SwipeStartEvent): void {
        if (this.isSwipeAnimating()) return;
        this.floatingOverlayService.hide();
        this.isSwiping.set(true);
        this.swipeDeltaX.set(0);
        this.incomingPanelScrollTop.set(this.getIncomingPanelInitialScrollTop());
        this.currentPanelOffset.set('0');
        this.incomingUnit.set(null);
    }

    public onSwipeMove(event: SwipeMoveEvent): void {
        if (this.isSwipeAnimating()) return;

        const deltaX = event.deltaX;
        this.swipeDeltaX.set(deltaX);

        // Determine which unit would be incoming based on swipe direction
        // Swiping right (deltaX > 0) = going to previous unit, incoming from LEFT
        // Swiping left (deltaX < 0) = going to next unit, incoming from RIGHT
        if (deltaX > 0 && this.hasPrev) {
            // Swiping right - show previous unit coming from the left
            const prevUnit = this.getUnitAtIndex(this.unitIndex() - 1);
            if (this.incomingUnit() !== prevUnit) {
                this.prepareIncomingUnit(prevUnit);
            }
            // Current panel moves right by deltaX
            this.currentPanelOffset.set(`${deltaX}px`);
            // Incoming panel starts at -100% and moves right with the swipe
            this.incomingPanelOffset.set(`calc(-100% + ${deltaX}px)`);
        } else if (deltaX < 0 && this.hasNext) {
            // Swiping left - show next unit coming from the right
            const nextUnit = this.getUnitAtIndex(this.unitIndex() + 1);
            if (this.incomingUnit() !== nextUnit) {
                this.prepareIncomingUnit(nextUnit);
            }
            // Current panel moves left by deltaX (negative)
            this.currentPanelOffset.set(`${deltaX}px`);
            // Incoming panel starts at 100% and moves left with the swipe
            this.incomingPanelOffset.set(`calc(100% + ${deltaX}px)`);
        } else {
            // Dampen the swipe if at boundary (no prev/next available)
            this.currentPanelOffset.set(`${deltaX * 0.3}px`);
            this.incomingUnit.set(null);
        }
    }

    public onSwipeEnd(event: SwipeEndEvent): void {
        // If animation is already in progress, just stop tracking the swipe.
        // Don't reset state - the ongoing animation will handle that.
        if (this.isSwipeAnimating()) {
            this.isSwiping.set(false);
            return;
        }

        this.isSwiping.set(false);

        if (!event.success) {
            // Animate back to original position
            this.animateSwipeCancel();
            return;
        }

        const direction = event.direction;
        // Swipe left = go to next unit
        // Swipe right = go to previous unit
        if (direction === 'left' && this.hasNext) {
            this.completeSwipeAnimation('left', this.unitIndex() + 1);
        } else if (direction === 'right' && this.hasPrev) {
            this.completeSwipeAnimation('right', this.unitIndex() - 1);
        } else {
            this.animateSwipeCancel();
        }
    }

    private async animateSwipeCancel(): Promise<void> {
        // Animate back to start position
        this.isSwipeAnimating.set(true);
        this.currentPanelOffset.set('0');

        // Determine where to animate incoming panel back to
        const incoming = this.incomingUnit();
        if (incoming) {
            const currentIdx = this.unitIndex();
            const incomingIdx = this.unitList().findIndex(u => {
                const unit = u instanceof ASForceUnit ? u.getSummary() : u;
                return unit === incoming;
            });
            if (incomingIdx < currentIdx) {
                // Was coming from left, animate back to left
                this.incomingPanelOffset.set('-100%');
            } else {
                // Was coming from right, animate back to right
                this.incomingPanelOffset.set('100%');
            }
        }

        await this.waitForTransitionEnd();

        this.resetSwipeState();
    }

    /**
     * Wait for the incoming panel's CSS transition to complete.
     * Returns a promise that resolves when the transition ends.
     */
    private waitForTransitionEnd(): Promise<void> {
        return new Promise((resolve) => {
            const panel = this.incomingPanelRef()?.nativeElement;
            if (!panel) {
                // Fallback if no panel reference
                setTimeout(resolve, 320);
                return;
            }

            const handler = (event: TransitionEvent) => {
                // Only listen for transform transitions on this element
                if (event.propertyName === 'transform' && event.target === panel) {
                    panel.removeEventListener('transitionend', handler);
                    // Small buffer for rendering
                    requestAnimationFrame(() => resolve());
                }
            };

            panel.addEventListener('transitionend', handler);

            // Safety timeout in case transitionend doesn't fire
            setTimeout(() => {
                panel.removeEventListener('transitionend', handler);
                resolve();
            }, 400);
        });
    }

    private async completeSwipeAnimation(swipeDirection: 'left' | 'right', newIndex: number): Promise<void> {
        this.isSwipeAnimating.set(true);

        if (swipeDirection === 'left') {
            // Swiping left: current goes to -100%, incoming goes to 0
            this.currentPanelOffset.set('-100%');
            this.incomingPanelOffset.set('0');
        } else {
            // Swiping right: current goes to 100%, incoming goes to 0
            this.currentPanelOffset.set('100%');
            this.incomingPanelOffset.set('0');
        }

        // Wait for the CSS transition to actually complete
        await this.waitForTransitionEnd();

        // Now update the index - this triggers re-render of current panel with new unit
        this.commitSwipeToIndex(newIndex);
        setTimeout(() => this.resetSwipeState(), 100);
    }

    private prepareIncomingUnit(unit: UnitSummary): void {
        this.incomingPanelScrollTop.set(this.getIncomingPanelInitialScrollTop());
        this.incomingUnit.set(unit);
        requestAnimationFrame(() => this.syncIncomingPanelScrollTop());
    }

    private getIncomingPanelInitialScrollTop(): number {
        return this.shouldPreserveSwipeScroll() ? this.currentPanelScrollTop() : 0;
    }

    private shouldPreserveSwipeScroll(): boolean {
        return this.activeTab() === 'General';
    }

    private currentPanelScrollTop(): number {
        return this.currentPanelRef()?.nativeElement.scrollTop ?? 0;
    }

    private syncIncomingPanelScrollTop(): void {
        const panel = this.incomingPanelRef()?.nativeElement;
        if (!panel) return;

        panel.scrollTop = Math.max(0, Math.min(this.incomingPanelScrollTop(), panel.scrollHeight - panel.clientHeight));
        this.incomingPanelScrollTop.set(panel.scrollTop);
    }

    private commitSwipeToIndex(newIndex: number): void {
        const shouldPreserveScroll = this.shouldPreserveSwipeScroll();
        if (shouldPreserveScroll) {
            this.syncIncomingPanelScrollTop();
        } else {
            this.incomingPanelScrollTop.set(0);
        }

        const scrollTop = shouldPreserveScroll ? this.incomingPanelScrollTop() : 0;
        this.unitIndex.set(newIndex);
        this.setPanelScrollTop(this.currentPanelRef()?.nativeElement, scrollTop, !shouldPreserveScroll);
        requestAnimationFrame(() => {
            this.setPanelScrollTop(this.currentPanelRef()?.nativeElement, scrollTop, !shouldPreserveScroll);
        });
    }

    private setPanelScrollTop(panel: HTMLElement | undefined, scrollTop: number, includeDescendants = false): void {
        if (!panel) return;

        panel.scrollTop = scrollTop;

        if (!includeDescendants) return;

        for (const element of panel.querySelectorAll<HTMLElement>('*')) {
            element.scrollTop = scrollTop;
        }
    }

    private resetSwipeState(): void {
        this.isSwipeAnimating.set(false);
        this.isSwiping.set(false);
        this.swipeDeltaX.set(0);
        this.currentPanelOffset.set('0');
        this.incomingPanelOffset.set('100%');
        this.incomingUnit.set(null);
    }
}
