// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { SvgViewerLiteComponent } from '../../svg-viewer-lite/svg-viewer-lite.component';

@Component({
    selector: 'unit-details-sheet-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, SvgViewerLiteComponent],
    templateUrl: './unit-details-sheet-tab.component.html',
    styleUrls: ['./unit-details-sheet-tab.component.css']
})
export class UnitDetailsSheetTabComponent {
    unit = input.required<UnitSummary>();

    private viewer = viewChild<SvgViewerLiteComponent>(SvgViewerLiteComponent);

    get minZoomPercent(): number {
        return this.viewer()?.minZoomPercent ?? 100;
    }

    get maxZoomPercent(): number {
        return this.viewer()?.maxZoomPercent ?? 300;
    }

    zoomPercent(): number {
        return this.viewer()?.zoomPercent() ?? this.minZoomPercent;
    }

    isZoomPanActive(): boolean {
        return this.viewer()?.isZoomPanActive() ?? false;
    }

    setZoomPercent(value: number): void {
        this.viewer()?.setZoomPercent(value);
    }

    resetZoom(): void {
        this.viewer()?.resetZoom();
    }

    downloadPng(): Promise<void> {
        return this.viewer()?.downloadPng() ?? Promise.resolve();
    }

    openPng(): Promise<void> {
        return this.viewer()?.openPng() ?? Promise.resolve();
    }

    copyPngToClipboard(): Promise<void> {
        return this.viewer()?.copyPngToClipboard() ?? Promise.resolve();
    }
}
