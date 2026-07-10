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

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkMenuModule } from '@angular/cdk/menu';
import type { Unit } from '../../models/units.model';
import { GameSystem } from '../../models/common.model';
import { ToastService } from '../../services/toast.service';
import { isMegaMekRaritySortKey, SORT_OPTIONS } from '../../services/unit-search-filters.model';
import { SimpleSliderComponent } from '../simple-slider/simple-slider.component';
import type { UnitDetailsSheetTabComponent } from '../unit-details-dialog/tabs/unit-details-sheet-tab.component';
import type { UnitDetailsCardTabComponent } from '../unit-details-dialog/tabs/unit-details-card-tab.component';
import {
    DEFAULT_VARIANTS_TAB_STATE,
    type VariantsTabState,
} from '../unit-details-dialog/tabs/unit-details-variants-tab.component';

@Component({
    selector: 'unit-details-footer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, CdkMenuModule, SimpleSliderComponent],
    templateUrl: './unit-details-footer.component.html',
    styleUrl: './unit-details-footer.component.scss',
})
export class UnitDetailsFooterComponent {
    private toastService = inject(ToastService);

    readonly activeTab = input.required<string>();
    readonly prevUnit = input<Unit | null>(null);
    readonly nextUnit = input<Unit | null>(null);
    readonly hasPrev = input(false);
    readonly hasNext = input(false);
    readonly sheetTab = input<UnitDetailsSheetTabComponent | undefined>(undefined);
    readonly cardTab = input<UnitDetailsCardTabComponent | undefined>(undefined);
    readonly variantsTabState = input<VariantsTabState>({ ...DEFAULT_VARIANTS_TAB_STATE });
    readonly gameSystem = input<GameSystem>(GameSystem.CLASSIC);

    readonly prev = output<void>();
    readonly next = output<void>();
    readonly variantsTabStateChange = output<VariantsTabState>();

    readonly prevUnitLabel = computed(() => {
        const unit = this.prevUnit();
        return unit ? this.formatUnitLabel(unit) : '';
    });

    readonly nextUnitLabel = computed(() => {
        const unit = this.nextUnit();
        return unit ? this.formatUnitLabel(unit) : '';
    });

    readonly minZoomPercent = computed(() => this.sheetTab()?.minZoomPercent ?? 100);
    readonly maxZoomPercent = computed(() => this.sheetTab()?.maxZoomPercent ?? 300);
    readonly zoomPercent = computed(() => this.sheetTab()?.zoomPercent() ?? this.minZoomPercent());

    readonly variantSortOptions = computed(() => {
        return SORT_OPTIONS.filter(opt =>
            opt.key !== '' &&
            !isMegaMekRaritySortKey(opt.key) &&
            (!opt.gameSystem || opt.gameSystem === this.gameSystem())
        );
    });

    setSheetZoomPercent(value: number): void {
        this.sheetTab()?.setZoomPercent(value);
    }

    resetSheetZoom(): void {
        this.sheetTab()?.resetZoom();
    }

    downloadSheetPng(): void {
        void this.sheetTab()?.downloadPng();
    }

    openSheetPng(): void {
        void this.sheetTab()?.openPng();
    }

    async copySheetPngToClipboard(): Promise<void> {
        const sheetTab = this.sheetTab();
        if (!sheetTab) return;

        try {
            await sheetTab.copyPngToClipboard();
            this.toastService.showToast('Record sheet copied to clipboard', 'success');
        } catch {
            this.toastService.showToast('Could not copy the record sheet image to the clipboard.', 'error');
        }
    }

    setVariantSortOrder(key: string): void {
        this.variantsTabStateChange.emit({ ...this.variantsTabState(), sortKey: key });
    }

    setVariantSortDirection(direction: 'asc' | 'desc'): void {
        this.variantsTabStateChange.emit({ ...this.variantsTabState(), sortDirection: direction });
    }

    toggleVariantViewMode(): void {
        this.variantsTabStateChange.emit({
            ...this.variantsTabState(),
            viewMode: this.variantsTabState().viewMode === 'expanded' ? 'compact' : 'expanded',
        });
    }

    private formatUnitLabel(unit: Unit): string {
        return [unit.chassis, unit.model].filter(Boolean).join(' ') || unit.name;
    }
}