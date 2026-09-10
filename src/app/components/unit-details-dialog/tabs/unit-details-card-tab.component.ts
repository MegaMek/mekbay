// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, viewChild, type ElementRef } from '@angular/core';
import { SvgViewerZoomPan } from '../../svg-viewer-lite/svg-viewer-zoom-pan';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { AlphaStrikeCardComponent } from '../../alpha-strike-card/alpha-strike-card.component';
import { getCardCountForUnitType } from '../../alpha-strike-card/card-layout.config';
import { OptionsService } from '../../../services/options.service';
import { UnitNameService } from '../../../services/unit-name.service';
import { SvgExportUtil } from '../../../utils/svg-export.util';
import { snapshotAlphaStrikeCard } from '../../../utils/alpha-strike-card-export.util';

@Component({
    selector: 'unit-details-card-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlphaStrikeCardComponent],
    templateUrl: './unit-details-card-tab.component.html',
    styleUrl: './unit-details-card-tab.component.css'
})
export class UnitDetailsCardTabComponent {
    optionsService = inject(OptionsService);
    private readonly unitNames = inject(UnitNameService);
    private readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
    private readonly cards = viewChild.required<ElementRef<HTMLDivElement>>('cards');
    unit = input.required<UnitSummary>();
    readonly fluffImageUrl = input<string | null>();

    readonly unitType = computed(() => this.unit().as?.TP ?? '');
    readonly cardIndices = computed<number[]>(() => {
        const count = getCardCountForUnitType(this.unitType());
        return Array.from({ length: count }, (_, i) => i);
    });

    readonly useHex = computed<boolean>(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().colorScheme);

    private readonly zoomPan = new SvgViewerZoomPan(this.viewport, this.cards, () => true, () => 'page', {
        autoLayout: true,
    });
    readonly maxZoomPercent = this.zoomPan.maxZoomPercent;
    readonly zoomPercent = this.zoomPan.zoomPercent;

    constructor() {
        effect(() => {
            this.unit();
            this.resetZoom();
        });
    }

    get minZoomPercent(): number {
        return this.zoomPan.minZoomPercent;
    }

    isZoomPanActive(): boolean {
        return this.zoomPan.isZoomPanActive();
    }

    setZoomPercent(value: number): void {
        this.zoomPan.setZoomPercent(value);
    }

    resetZoom(): void {
        this.zoomPan.resetZoom();
    }

    async downloadPng(): Promise<void> {
        return SvgExportUtil.downloadPng(await this.snapshotCards(), this.exportFileName());
    }

    openPng(): Promise<void> {
        return SvgExportUtil.openPng(this.snapshotCards());
    }

    copyPngToClipboard(): Promise<void> {
        return SvgExportUtil.copyPngToClipboard(this.snapshotCards(), this.exportFileName());
    }

    async downloadSvg(): Promise<void> {
        return SvgExportUtil.downloadSvg(await this.snapshotCards(), this.exportFileName());
    }

    private async snapshotCards(): Promise<SVGSVGElement[]> {
        await document.fonts.ready;
        const cards = this.cards().nativeElement.querySelectorAll<SVGSVGElement>('alpha-strike-card svg.card-svg');
        if (!cards.length) throw new Error('The Alpha Strike card is not ready yet.');
        return Array.from(cards, snapshotAlphaStrikeCard);
    }

    private exportFileName(): string {
        const name = this.unitNames.name(this.unit()).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
        return `${name || 'unit'}-alpha-strike`;
    }
}
