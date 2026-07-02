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

import { Component, ChangeDetectionStrategy, input, output, signal, computed, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { Unit } from '../../models/units.model';
import { GameService } from '../../services/game.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { TaggingService } from '../../services/tagging.service';
import { DialogsService } from '../../services/dialogs.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { getUnitServerHost } from '../../models/common.model';
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

/**
 * Inline unit details panel for expanded view mode.
 * Shows the same content as unit-details-dialog but without the dialog wrapper.
 * Displayed when screen space permits in expanded view mode.
 */
@Component({
    selector: 'unit-details-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        BasePanelComponent,
        UnitIconComponent,
        UnitTagsComponent,
        UnitDetailsGeneralTabComponent,
        UnitDetailsIntelTabComponent,
        UnitDetailsFactionTabComponent,
        UnitDetailsSheetTabComponent,
        UnitDetailsCardTabComponent,
        UnitDetailsVariantsTabComponent
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
    private gameService = inject(GameService);
    forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    private taggingService = inject(TaggingService);
    private dialogsService = inject(DialogsService);
    private keyboardShortcutService = inject(KeyboardShortcutService);
    private destroyRef = inject(DestroyRef);
    readonly unit = input<Unit | null>(null);
    readonly prevUnit = input<Unit | null>(null);
    readonly nextUnit = input<Unit | null>(null);
    readonly gunnerySkill = input<number | undefined>(undefined);
    readonly pilotingSkill = input<number | undefined>(undefined);
    readonly hasPrev = input<boolean>(false);
    readonly hasNext = input<boolean>(false);
    readonly add = output<Unit>();
    readonly prev = output<void>();
    readonly next = output<void>();

    readonly prevUnitLabel = computed(() => {
        const unit = this.prevUnit();
        return unit ? this.formatUnitLabel(unit) : '';
    });

    readonly nextUnitLabel = computed(() => {
        const unit = this.nextUnit();
        return unit ? this.formatUnitLabel(unit) : '';
    });

    readonly tabs = computed<string[]>(() => {
        return ['General', 'Intel', 'Factions', 'Variants', 'Sheet', 'Card'];
    });
    /** Currently active tab */
    readonly activeTab = signal<string>(this.gameService.isAlphaStrike() ? 'Card' : 'General');

    /** View mode for variants tab (persisted while panel is open) */
    readonly variantsTabState = signal<VariantsTabState>({ ...DEFAULT_VARIANTS_TAB_STATE });

    constructor() {
        this.keyboardShortcutService.register({
            id: 'unit-details-panel',
            active: () => !!this.unit(),
            handle: (event) => this.handleShortcutKeyDown(event),
        }, this.destroyRef);
    }

    /** Check if unit has fluff background image */
    readonly hasFluff = computed(() => {
        const u = this.unit();
        if (!u?.fluff?.img) return false;
        if (u.fluff.img.endsWith('hud.png')) return false;
        return true;
    });

    /** Fluff background URL */
    readonly fluffImageUrl = computed(() => {
        const u = this.unit();
        if (!u?.fluff?.img) return null;
        if (u.fluff.img.endsWith('hud.png')) return null;
        return `${getUnitServerHost(u)}/images/fluff/${u.fluff.img}`;
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

    private formatUnitLabel(unit: Unit): string {
        return [unit.chassis, unit.model].filter(Boolean).join(' ') || unit.name;
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

        const addedUnit = await this.forceBuilderService.addUnit(
            unit,
            this.gunnerySkill(),
            this.pilotingSkill()
        );

        if (addedUnit) {
            this.toastService.showToast(`${unit.chassis} ${unit.model} added to force`, 'success');
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
                message: `How many copies of ${unit.chassis} ${unit.model}?`,
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
            const addedUnit = await this.forceBuilderService.addUnit(
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
                `${addedCount}x ${unit.chassis} ${unit.model} added to force`,
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
    onVariantClick(event: { variant: Unit; variants: Unit[] }): void {
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
        const shareText = `${unit.chassis} ${unit.model}`;
        
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
