// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitNameService } from '../../services/unit-name.service';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CdkMenuModule } from '@angular/cdk/menu';
import type { UnitSummary } from '../../models/unit-summary.model';
import { GameSystem } from '../../models/common.model';
import { ToastService } from '../../services/toast.service';
import { isMegaMekRaritySortKey, SORT_OPTIONS } from '../../services/unit-search-filters.model';
import { SimpleSliderComponent } from '../simple-slider/simple-slider.component';
import type { UnitDetailsSheetTabComponent } from '../unit-details-dialog/tabs/unit-details-sheet-tab.component';
import {
    DEFAULT_VARIANTS_TAB_STATE,
    type VariantsTabState,
} from '../unit-details-dialog/tabs/unit-details-variants-tab.component';

@Component({
    selector: 'unit-details-footer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkMenuModule, SimpleSliderComponent],
    templateUrl: './unit-details-footer.component.html',
    styleUrl: './unit-details-footer.component.scss',
})
export class UnitDetailsFooterComponent {
    readonly unitNames = inject(UnitNameService);
    private toastService = inject(ToastService);

    readonly activeTab = input.required<string>();
    readonly prevUnit = input<UnitSummary | null>(null);
    readonly nextUnit = input<UnitSummary | null>(null);
    readonly hasPrev = input(false);
    readonly hasNext = input(false);
    readonly sheetTab = input<UnitDetailsSheetTabComponent | undefined>(undefined);
    readonly variantsTabState = input<VariantsTabState>({ ...DEFAULT_VARIANTS_TAB_STATE });
    readonly gameSystem = input<GameSystem>(GameSystem.CBT);

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

    private formatUnitLabel(unit: UnitSummary): string {
        return this.unitNames.name(unit);
    }
}
