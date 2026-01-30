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

import { Component, ChangeDetectionStrategy, input, output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { GameService } from '../../services/game.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { TaggingService } from '../../services/tagging.service';
import { DialogsService } from '../../services/dialogs.service';
import { REMOTE_HOST } from '../../models/common.model';
import { copyTextToClipboard } from '../../utils/clipboard.util';
import { BasePanelComponent } from '../base-panel/base-panel.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, TagClickEvent } from '../unit-tags/unit-tags.component';
import { UnitDetailsGeneralTabComponent } from '../unit-details-dialog/tabs/unit-details-general-tab.component';
import { UnitDetailsIntelTabComponent } from '../unit-details-dialog/tabs/unit-details-intel-tab.component';
import { UnitDetailsFactionTabComponent } from '../unit-details-dialog/tabs/unit-details-factions-tab.component';
import { UnitDetailsSheetTabComponent } from '../unit-details-dialog/tabs/unit-details-sheet-tab.component';
import { UnitDetailsCardTabComponent } from '../unit-details-dialog/tabs/unit-details-card-tab.component';
import { UnitDetailsVariantsTabComponent, VariantsTabState, DEFAULT_VARIANTS_TAB_STATE } from '../unit-details-dialog/tabs/unit-details-variants-tab.component';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';

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
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    private taggingService = inject(TaggingService);
    private dialogsService = inject(DialogsService);
    readonly unit = input<Unit | null>(null);
    readonly gunnerySkill = input<number | undefined>(undefined);
    readonly pilotingSkill = input<number | undefined>(undefined);
    readonly hasPrev = input<boolean>(false);
    readonly hasNext = input<boolean>(false);
    readonly add = output<Unit>();
    readonly prev = output<void>();
    readonly next = output<void>();

    readonly tabs = computed<string[]>(() => {
        return ['General', 'Intel', 'Factions', 'Variants', 'Sheet', 'Card'];
    });
    /** Currently active tab */
    readonly activeTab = signal<string>(this.gameService.isAlphaStrike() ? 'Card' : 'General');

    /** View mode for variants tab (persisted while panel is open) */
    readonly variantsTabState = signal<VariantsTabState>({ ...DEFAULT_VARIANTS_TAB_STATE });

    /** Whether the force is read-only */
    readonly readOnlyForce = computed(() => this.forceBuilderService.readOnlyForce());

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
        return `${REMOTE_HOST}/images/fluff/${u.fluff.img}`;
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
