// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { UnitSummary } from '../../models/unit-summary.model';
import { OptionsService } from '../../services/options.service';
import { SvgViewerLiteComponent } from '../../components/svg-viewer-lite/svg-viewer-lite.component';
import { UnitDetailsCardTabComponent } from '../../components/unit-details-dialog/tabs/unit-details-card-tab.component';

@Component({
    selector: 'construction-preview',
    imports: [FormsModule, SvgViewerLiteComponent, UnitDetailsCardTabComponent],
    templateUrl: './construction-preview.component.html',
    styleUrl: './construction-preview.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionPreviewComponent {
    private readonly optionsService = inject(OptionsService);

    readonly entity = input.required<BaseEntity>();
    readonly unit = input.required<UnitSummary>();
    readonly unsaved = input(false);
    readonly fluffImageUrl = input<string | null>();
    readonly view = signal<'sheet' | 'card'>('sheet');
    readonly paperSize = computed(() => this.optionsService.options().printAllOptions.paperSize);
    readonly sheet = viewChild(SvgViewerLiteComponent);
    readonly card = viewChild(UnitDetailsCardTabComponent);
    readonly working = signal<'print' | 'export' | null>(null);
    readonly actionError = signal('');
    readonly supportsCard = computed(() => !!this.unit().as?.TP && this.unit().as.TP !== 'XX');
    readonly ready = computed(() => this.view() === 'sheet' ? !!this.sheet()?.ready() : this.supportsCard() && !!this.card());

    setView(view: 'sheet' | 'card'): void {
        this.actionError.set('');
        this.view.set(view);
    }

    async output(action: 'print' | 'export'): Promise<void> {
        if (this.view() !== 'sheet' || this.working() || !this.ready()) return;
        // Capture the sheet before waiting; its output methods snapshot the displayed pages.
        const viewer = this.sheet()!;
        this.working.set(action);
        this.actionError.set('');
        try {
            if (action === 'print') await viewer.print();
            else await viewer.downloadPng(true);
        } catch (error) {
            this.actionError.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.working.set(null);
        }
    }
}
