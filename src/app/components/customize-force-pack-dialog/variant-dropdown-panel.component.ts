// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, type ElementRef, afterNextRender, inject, input, output, viewChild, type computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Unit } from '../../models/units.model';
import type { GameSystem } from '../../models/common.model';
import { UnitCardCompactComponent } from '../unit-card-compact/unit-card-compact.component';
import { TaggingService } from '../../services/tagging.service';
import type { TagClickEvent } from '../unit-tags/unit-tags.component';

@Component({
    selector: 'variant-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitCardCompactComponent],
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" #panelContainer>
            @for (variant of variants(); track variant.name) {
                @let isOriginal = variant.name === originalUnitName();
                @let isCurrent = variant.name === currentUnitName();
                <unit-card-compact
                    [unit]="variant"
                    [gameSystem]="gameSystem()"
                    [isOriginal]="isOriginal"
                    [isSelected]="isCurrent"
                    [showInfoButton]="true"
                    [showTags]="true"
                    (cardClick)="onSelect(variant)"
                    (infoClick)="onInfo(variant)"
                    (tagClick)="onTagClick($event)">
                </unit-card-compact>
            }
        </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .dropdown-panel {
            flex: 1 1 auto;
            min-height: 0;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 6px 4px;
        }

        /* When used as overlay (centered), constrain size */
        :host-context(.variant-dropdown-overlay) .dropdown-panel {
            width: 380px;
            max-width: 100vw;
            max-height: calc(100vh - 32px);
        }

        .dropdown-panel unit-card-compact {
            background: #0003;
        }
    `]
})
export class VariantDropdownPanelComponent {
    private taggingService = inject(TaggingService);

    panelContainer = viewChild<ElementRef<HTMLDivElement>>('panelContainer');

    variants = input.required<Unit[]>();
    originalUnitName = input<string | null>(null);
    currentUnitName = input<string | null>(null);
    /** Game system override for correct stat display (PV vs BV). */
    gameSystem = input<GameSystem | null>(null);

    selected = output<Unit>();
    infoRequested = output<Unit>();

    constructor() {
        // Scroll to current variant after render
        afterNextRender(() => this.scrollToCurrent());
    }

    onSelect(variant: Unit): void {
        this.selected.emit(variant);
    }

    onInfo(variant: Unit): void {
        this.infoRequested.emit(variant);
    }

    async onTagClick({ unit, event }: TagClickEvent): Promise<void> {
        const evtTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorEl = (evtTarget.closest('.add-tag-btn') as HTMLElement) || evtTarget;
        await this.taggingService.openTagSelectorForUnit(unit, anchorEl);
    }

    private scrollToCurrent(): void {
        const container = this.panelContainer()?.nativeElement;
        if (!container) return;

        const currentItem = container.querySelector('unit-card-compact.selected, unit-card-compact .unit-card-compact.selected') as HTMLElement;
        if (currentItem) {
            currentItem.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
    }
}
