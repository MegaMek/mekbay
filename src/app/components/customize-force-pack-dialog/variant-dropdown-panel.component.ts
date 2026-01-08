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

import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, viewChild, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { GameService } from '../../services/game.service';

@Component({
    selector: 'variant-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitIconComponent],
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" #panelContainer>
            @for (variant of variants(); track variant.name) {
                @let isOriginal = variant.name === originalUnitName();
                @let isCurrent = variant.name === currentUnitName();
                <div class="dropdown-option"
                     [class.current]="isCurrent"
                     (click)="onSelect(variant)">
                    <unit-icon [unit]="variant"></unit-icon>
                    <div class="variant-info">
                        <div class="variant-model">{{ variant.model }}</div>
                        <div class="variant-chassis">
                            {{ variant.chassis }}
                            @if (isOriginal) {
                                <span class="original-star" title="Original unit">★</span>
                            }
                        </div>
                    </div>
                    <div class="variant-value">
                        @if (gameService.isAlphaStrike()) {
                            PV: {{ variant.as.PV || 0 }}
                        } @else {
                            BV: {{ variant.bv || 0 }}
                        }
                    </div>
                    <button class="info-btn" (click)="onInfo($event, variant)" title="Unit info">
                        <svg stroke="currentColor" width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M15.8053 15.8013L21 21M10.5 7.5V13.5M7.5 10.5H13.5M18 10.5C18 14.6421 14.6421 18 10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </button>
                </div>
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

        .dropdown-option {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid #333;
            transition: background 0.2s;
        }

        .dropdown-option:last-child {
            border-bottom: none;
        }

        .dropdown-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .dropdown-option.current {
            background: var(--bt-yellow-background);
        }

        .dropdown-option unit-icon {
            width: 32px;
            height: 32px;
            flex-shrink: 0;
        }

        .variant-info {
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
        }

        .variant-model {
            font-size: 0.75em;
            color: var(--text-color-secondary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .variant-chassis {
            font-size: 0.9em;
            font-weight: 600;
            color: var(--text-color);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .variant-value {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            flex-shrink: 0;
            min-width: 60px;
            text-align: right;
        }

        .original-star {
            color: var(--bt-yellow);
            font-size: 0.9em;
            margin-left: 4px;
        }

        .info-btn {
            background: transparent;
            border: none;
            color: var(--text-color-secondary);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
            flex-shrink: 0;
        }

        .info-btn:hover {
            color: var(--text-color);
        }
    `]
})
export class VariantDropdownPanelComponent {
    private injector = inject(Injector);
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

    onInfo(event: Event, variant: Unit): void {
        event.stopPropagation();
        this.infoRequested.emit(variant);
    }

    private scrollToCurrent(): void {
        const container = this.panelContainer()?.nativeElement;
        if (!container) return;

        const currentItem = container.querySelector('.dropdown-option.current') as HTMLElement;
        if (currentItem) {
            currentItem.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
    }
}
