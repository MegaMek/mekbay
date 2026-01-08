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

import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, viewChild, Injector, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { UnitCardCompactComponent } from '../unit-card-compact/unit-card-compact.component';
import { GameService } from '../../services/game.service';
import { TaggingService } from '../../services/tagging.service';
import { TagClickEvent } from '../unit-tags/unit-tags.component';

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
            scrollbar-width: thin;
        }

        /* When used as overlay (centered), constrain size */
        :host-context(.variant-dropdown-overlay) .dropdown-panel {
            width: 350px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 32px);
        }

        /* Style the unit cards within the dropdown */
        .dropdown-panel unit-card-compact {
            border-bottom: 1px solid #333;
        }

        .dropdown-panel unit-card-compact:last-child {
            border-bottom: none;
        }
    `]
})
export class VariantDropdownPanelComponent {
    private injector = inject(Injector);
    private taggingService = inject(TaggingService);
    gameService = inject(GameService);

    panelContainer = viewChild<ElementRef<HTMLDivElement>>('panelContainer');

    variants = input.required<Unit[]>();
    originalUnitName = input<string | null>(null);
    currentUnitName = input<string | null>(null);

    selected = output<Unit>();
    infoRequested = output<Unit>();

    constructor() {
        // Scroll to current variant after render
        afterNextRender(() => this.scrollToCurrent(), { injector: this.injector });
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
