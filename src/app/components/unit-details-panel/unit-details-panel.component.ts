// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitNameService } from '../../services/unit-name.service';
import { Component, ChangeDetectionStrategy, input, output, signal, computed, inject, DestroyRef, viewChild, effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { UnitSummary } from '../../models/unit-summary.model';
import { GameService } from '../../services/game.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { ToastService } from '../../services/toast.service';
import { TaggingService } from '../../services/tagging.service';
import { DialogsService } from '../../services/dialogs.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { copyTextToClipboard } from '../../utils/clipboard.util';
import { BasePanelComponent } from '../base-panel/base-panel.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, type TagClickEvent } from '../unit-tags/unit-tags.component';
import { UnitDetailsGeneralTabComponent } from '../unit-details-dialog/tabs/unit-details-general-tab.component';
import { UnitDetailsIntelTabComponent } from '../unit-details-dialog/tabs/unit-details-intel-tab.component';
import { UnitDetailsFactionTabComponent } from '../unit-details-dialog/tabs/unit-details-factions-tab.component';
import { UnitDetailsSheetTabComponent } from '../unit-details-dialog/tabs/unit-details-sheet-tab.component';
import { UnitDetailsCardTabComponent } from '../unit-details-dialog/tabs/unit-details-card-tab.component';
import { UnitDetailsVariantsTabComponent, type VariantsTabState, DEFAULT_VARIANTS_TAB_STATE } from '../unit-details-dialog/tabs/unit-details-variants-tab.component';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { UnitDetailsFooterComponent } from '../unit-details-footer/unit-details-footer.component';
import { UnitFluffImageService } from '../../services/catalogs/unit-fluff-image.service';
import { UnitDetailsSummaryService } from '../../services/unit-details-summary.service';

/**
 * Inline unit details panel for expanded view mode.
 * Shows the same content as unit-details-dialog but without the dialog wrapper.
 * Displayed when screen space permits in expanded view mode.
 */
@Component({
    selector: 'unit-details-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        BasePanelComponent,
        UnitIconComponent,
        UnitTagsComponent,
        UnitDetailsGeneralTabComponent,
        UnitDetailsIntelTabComponent,
        UnitDetailsFactionTabComponent,
        UnitDetailsSheetTabComponent,
        UnitDetailsCardTabComponent,
        UnitDetailsVariantsTabComponent,
        UnitDetailsFooterComponent
    ],
    templateUrl: './unit-details-panel.component.html',
    styleUrl: './unit-details-panel.component.scss',
    host: {
        '[class.has-unit]': '!!unit()',
        '[class.has-fluff]': 'hasFluff()',
        '[style.--fluff-bg]': 'fluffBgStyle()'
    }
})
export class UnitDetailsPanelComponent {
    readonly unitNames = inject(UnitNameService);
    private gameService = inject(GameService);
    protected readonly forceWorkspace = inject(ForceWorkspaceStateService);

    private readonly forceCommands = inject(ForceWorkspaceCommandsService);
    private toastService = inject(ToastService);
    private taggingService = inject(TaggingService);
    private dialogsService = inject(DialogsService);
    private keyboardShortcutService = inject(KeyboardShortcutService);
    private destroyRef = inject(DestroyRef);
    private fluffImages = inject(UnitFluffImageService);
    private detailsSummaries = inject(UnitDetailsSummaryService);
    public readonly sourceUnit = input<UnitSummary | null>(null, { alias: 'unit' });
    private readonly resolvedUnit = signal<{
        readonly source: UnitSummary;
        readonly summary: UnitSummary;
    } | null>(null);
    readonly unit = computed(() => {
        const source = this.sourceUnit();
        const resolved = this.resolvedUnit();
        return source && resolved?.source === source ? resolved.summary : source;
    });
    readonly prevUnit = input<UnitSummary | null>(null);
    readonly nextUnit = input<UnitSummary | null>(null);
    readonly gunnerySkill = input<number | undefined>(undefined);
    readonly pilotingSkill = input<number | undefined>(undefined);
    readonly adjustedValueOverride = input<number | undefined>(undefined);
    readonly hasPrev = input<boolean>(false);
    readonly hasNext = input<boolean>(false);
    readonly add = output<UnitSummary>();
    readonly prev = output<void>();
    readonly next = output<void>();

    readonly tabs = computed<string[]>(() => {
        return ['General', 'Intel', 'Factions', 'Variants', 'Sheet', 'Card'];
    });
    /** Currently active tab */
    readonly activeTab = signal<string>(this.gameService.isAlphaStrike() ? 'Card' : 'General');

    /** View mode for variants tab (persisted while panel is open) */
    readonly variantsTabState = signal<VariantsTabState>({ ...DEFAULT_VARIANTS_TAB_STATE });
    readonly currentGameSystem = computed(() => this.gameService.currentGameSystem());
    readonly sheetTabRef = viewChild(UnitDetailsSheetTabComponent);

    constructor() {
        effect(onCleanup => {
            const source = this.sourceUnit();
            this.resolvedUnit.set(null);
            if (!source) return;

            let active = true;
            void this.detailsSummaries.resolve(source).then(summary => {
                if (active) this.resolvedUnit.set({ source, summary });
            });
            onCleanup(() => { active = false; });
        });

        this.keyboardShortcutService.register({
            id: 'unit-details-panel',
            active: () => !!this.unit(),
            handle: (event) => this.handleShortcutKeyDown(event),
        }, this.destroyRef);
    }

    /** Check if unit has fluff background image */
    readonly hasFluff = computed(() => {
        return this.fluffImageUrl() !== null;
    });

    /** Fluff background URL */
    readonly fluffImageUrl = computed(() => {
        return this.fluffImages.resolveUrl(this.unit());
    });

    /** CSS background style for fluff */
    readonly fluffBgStyle = computed(() => {
        const url = this.fluffImageUrl();
        return url ? `url("${url}")` : null;
    });

    /** Format thousands with commas */
    formatThousands(value: number): string {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    private handleShortcutKeyDown(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.altKey || event.metaKey) return false;

        if (event.key === 'ArrowLeft') {
            if (this.hasPrev()) {
                this.prev.emit();
            }
            return true;
        } else if (event.key === 'ArrowRight') {
            if (this.hasNext()) {
                this.next.emit();
            }
            return true;
        }

        return false;
    }

    /** Handle ADD button click */
    async onAdd(): Promise<void> {
        const unit = this.unit();
        if (!unit) return;

        const addedUnit = await this.forceCommands.addUnit(
            unit,
            this.gunnerySkill(),
            this.pilotingSkill()
        );

        if (addedUnit) {
            this.toastService.showToast(`${this.unitNames.name(unit)} added to force`, 'success');
            this.add.emit(unit);
        }
    }

    /** Handle ADD multiple button click */
    async onAddMultiple(): Promise<void> {
        const unit = this.unit();
        if (!unit) return;

        const ref = this.dialogsService.createDialog<number | undefined>(ConfirmDialogComponent, {
            data: <ConfirmDialogData<number>>{
                title: 'Add Multiple',
                message: `How many copies of ${this.unitNames.name(unit)}?`,
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

        let addedCount = 0;
        for (let index = 0; index < count; index++) {
            const addedUnit = await this.forceCommands.addUnit(
                unit,
                this.gunnerySkill(),
                this.pilotingSkill()
            );
            if (addedUnit) {
                addedCount++;
            }
        }

        if (addedCount > 0) {
            this.toastService.showToast(
                `${addedCount}x ${this.unitNames.name(unit)} added to force`,
                'success'
            );
            this.add.emit(unit);
        }
    }

    /** Handle tag clicks */
    async onTagClick({ unit, event }: TagClickEvent): Promise<void> {
        event.stopPropagation();
        const anchorEl = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        await this.taggingService.openTagSelector([unit], anchorEl);
    }

    /** Handle variant card click - opens a dialog for that variant */
    onVariantClick(event: { variant: UnitSummary; variants: UnitSummary[] }): void {
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: event.variants,
                unitIndex: event.variants.indexOf(event.variant),
                gunnerySkill: this.gunnerySkill(),
                pilotingSkill: this.pilotingSkill()
            }
        });
    }

    /** Handle share button click */
    onShare(): void {
        const unit = this.unit();
        if (!unit) return;
        
        const domain = window.location.origin + window.location.pathname;
        const unitName = encodeURIComponent(unit.name);
        const tab = encodeURIComponent(this.activeTab());
        const shareUrl = `${domain}?gs=${this.gameService.currentGameSystem()}&shareUnit=${unitName}&tab=${tab}`;
        const shareText = `${this.unitNames.name(unit)}`;
        
        if (navigator.share) {
            navigator.share({
                title: shareText,
                url: shareUrl
            }).catch(() => {
                copyTextToClipboard(shareUrl);
                this.toastService.showToast('Unit link copied to clipboard.', 'success');
            });
        } else {
            copyTextToClipboard(shareUrl);
            this.toastService.showToast('Unit link copied to clipboard.', 'success');
        }
    }
}
