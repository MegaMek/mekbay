// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import type { BackgroundCatalogProgressView } from '../../models/startup-progress.model';
import { LoggerService } from '../../services/logger.service';

const SUMMARY_EXTRACTION_PREFIX = 'Reading prebuilt unit summaries:';

@Component({
    selector: 'catalog-refresh-status',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './catalog-refresh-status.component.html',
    styleUrl: './catalog-refresh-status.component.scss',
})
export class CatalogRefreshStatusComponent {
    public readonly view = input.required<BackgroundCatalogProgressView>();
    private readonly logger = inject(LoggerService);
    private lastLoggedView?: string;
    private summaryExtractionStartedAt?: number;
    private completedSummaryExtractionTotal?: number;

    public constructor() {
        effect(() => {
            const view = this.view();
            const key = JSON.stringify(view);
            if (key === this.lastLoggedView) return;
            this.lastLoggedView = key;
            if (view.kind === 'progress') {
                if (view.detail.startsWith(SUMMARY_EXTRACTION_PREFIX)) {
                    this.logSummaryExtraction(view);
                    return;
                }
                this.logger.info(`[Loading] ${view.title}: ${view.detail}`);
            } else if (view.kind === 'notice') {
                this.logger.warn(`[Loading] ${view.title}: ${view.detail}`);
            }
        });
    }

    private logSummaryExtraction(view: Extract<BackgroundCatalogProgressView, { kind: 'progress' }>): void {
        const complete = view.mode === 'determinate'
            && view.total > 0
            && view.completed === view.total;
        if (complete && this.summaryExtractionStartedAt === undefined
            && this.completedSummaryExtractionTotal === view.total) {
            return;
        }
        if (!complete) this.completedSummaryExtractionTotal = undefined;
        if (this.summaryExtractionStartedAt === undefined) {
            this.summaryExtractionStartedAt = Date.now();
            this.logger.info('[Loading] Reading prebuilt unit summaries started.');
        }
        if (!complete) return;

        const elapsed = Math.max(0, Date.now() - this.summaryExtractionStartedAt);
        this.summaryExtractionStartedAt = undefined;
        this.completedSummaryExtractionTotal = view.total;
        this.logger.info(
            `[Loading] Reading prebuilt unit summaries finished in ${elapsed} ms (${view.total.toLocaleString('en-US')} unit summaries read).`,
        );
    }
}
