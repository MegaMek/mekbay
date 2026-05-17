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
import { CdkMenuModule } from '@angular/cdk/menu';
import type { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, inject, signal } from '@angular/core';

export interface CompactFilterMenuOption {
    id: number;
    name: string;
    img?: string;
    count?: number;
}

@Component({
    selector: 'compact-filter-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkMenuModule],
    host: {
        '[class.small]': 'size === "small"',
    },
    template: `
        <button
            type="button"
            class="compact-filter-trigger"
            [class.open]="menuOpen()"
            [class.active]="selectedId !== null"
            [title]="activeOption?.name || allLabel"
            [attr.aria-label]="ariaLabel"
            [cdkMenuTriggerFor]="filterMenu"
            [cdkMenuPosition]="menuPositions"
            (cdkMenuOpened)="menuOpen.set(true)"
            (cdkMenuClosed)="menuOpen.set(false)">
            @if (activeOption; as option) {
                @if (option.img) {
                <img [src]="option.img" class="compact-filter-icon" alt="" />
                } @else {
                <span class="compact-filter-fallback">{{ fallbackLabel }}</span>
                }
            } @else {
                <span class="compact-filter-empty">-</span>
            }
        </button>
        <ng-template #filterMenu>
            <div
                class="compact-filter-menu glass framed-borders"
                [class.small]="size === 'small'"
                [class.align-left]="panelAlign === 'left'"
                [style.max-height.px]="menuMaxHeight"
                cdkMenu>
                <button type="button" class="compact-filter-option" [class.active]="selectedId === null" cdkMenuItem (cdkMenuItemTriggered)="select(null)">
                    <span class="compact-filter-option-label">{{ allLabel }}</span>
                </button>
                @for (option of options; track option.id) {
                <button type="button" class="compact-filter-option" [class.active]="selectedId === option.id" cdkMenuItem (cdkMenuItemTriggered)="select(option.id)">
                    @if (option.img) {
                    <img [src]="option.img" class="compact-filter-option-icon" alt="" />
                    }
                    <span class="compact-filter-option-label">{{ option.name }}</span>
                    @if (option.count !== undefined) {
                    <span class="compact-filter-option-count">{{ option.count }}</span>
                    }
                </button>
                }
            </div>
        </ng-template>
    `,
    styles: [`
        :host {
            display: inline-flex;
        }

        .compact-filter-trigger {
            width: 32px;
            height: 32px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 2px;
            border: 2px solid transparent;
            background-color: var(--background-input);
            background-repeat: no-repeat;
            background-origin: border-box;
            background-image:
                linear-gradient(#666, #666),
                linear-gradient(#666, #666),
                linear-gradient(#666, #666),
                linear-gradient(#666, #666),
                linear-gradient(#666, #666),
                linear-gradient(#666, #666),
                linear-gradient(#666, #666),
                linear-gradient(#666, #666);
            background-size: 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px;
            background-position: top left, top left, top right, top right, bottom left, bottom left, bottom right, bottom right;
            color: var(--text-color-secondary);
            cursor: pointer;
            transition: border 0.2s ease-in-out, background 0.2s ease-in-out, color 0.2s ease-in-out;
        }

        .compact-filter-trigger:hover,
        .compact-filter-trigger.open {
            background-color: var(--background-highlight);
            color: var(--text-color);
            background-image:
                linear-gradient(white, white),
                linear-gradient(white, white),
                linear-gradient(white, white),
                linear-gradient(white, white),
                linear-gradient(white, white),
                linear-gradient(white, white),
                linear-gradient(white, white),
                linear-gradient(white, white);
            background-size: 100% 2px, 2px 100%, 100% 2px, 2px 100%, 100% 2px, 2px 100%, 100% 2px, 2px 100%;
        }

        .compact-filter-trigger.active {
            color: var(--bt-yellow);
            background-image:
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow)),
                linear-gradient(var(--bt-yellow), var(--bt-yellow));
            background-size: 100% 2px, 2px 100%, 100% 2px, 2px 100%, 100% 2px, 2px 100%, 100% 2px, 2px 100%;
        }

        .compact-filter-trigger.active.open,
        .compact-filter-trigger.active:hover {
            background-size: 100% 2px, 2px 100%, 100% 2px, 2px 100%, 100% 2px, 2px 100%, 100% 2px, 2px 100%;
        }

        .compact-filter-icon,
        .compact-filter-option-icon {
            width: 20px;
            height: 20px;
            object-fit: contain;
            flex: 0 0 auto;
        }

        .compact-filter-empty,
        .compact-filter-fallback {
            font-size: 0.9rem;
            font-weight: 700;
            line-height: 1;
        }

        .compact-filter-menu {
            display: flex;
            flex-direction: column;
            gap: 2px;
            width: min(260px, calc(100vw - 24px));
            box-sizing: border-box;
            overflow-y: auto;
            padding: 2px;
            background-color: var(--background-color-menu);
        }

        .compact-filter-menu.align-left {
            width: 240px;
        }

        .compact-filter-option {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            min-height: 28px;
            padding: 3px 6px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--text-color);
            cursor: pointer;
            text-align: left;
            font: inherit;
            font-size: 0.8rem;
        }

        .compact-filter-option:hover {
            background: var(--background-highlight);
        }

        .compact-filter-option.cdk-keyboard-focused,
        .compact-filter-option.cdk-program-focused {
            background: var(--background-highlight);
            outline: none;
        }

        .compact-filter-option.active {
            color: var(--bt-yellow);
            background: var(--bt-yellow-background);
        }

        .compact-filter-option-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .compact-filter-option-count {
            margin-left: auto;
            color: inherit;
            opacity: 0.75;
            font-size: 0.75rem;
        }

        :host(.small) .compact-filter-trigger {
            width: 28px;
            height: 28px;
        }

        :host(.small) .compact-filter-icon,
        .compact-filter-menu.small .compact-filter-option-icon {
            width: 18px;
            height: 18px;
        }

        :host(.small) .compact-filter-empty,
        :host(.small) .compact-filter-fallback {
            font-size: 0.8rem;
        }

        .compact-filter-menu.small .compact-filter-option {
            font-size: 0.75rem;
        }

        .compact-filter-menu.small .compact-filter-option-count {
            font-size: 0.72rem;
        }
    `]
})
export class CompactFilterMenuComponent {
    private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly menuViewportMargin = 8;
    private readonly menuTriggerGap = 4;
    private readonly menuMaxNaturalHeight = 320;

    private readonly leftAboveMenuPositions: ConnectedPosition[] = [
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    ];

    private readonly leftBelowMenuPositions: ConnectedPosition[] = [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    ];

    private readonly rightAboveMenuPositions: ConnectedPosition[] = [
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    ];

    private readonly rightBelowMenuPositions: ConnectedPosition[] = [
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    ];

    readonly menuOpen = signal(false);

    @Input() options: readonly CompactFilterMenuOption[] = [];
    @Input() selectedId: number | null = null;
    @Input() allLabel = 'All';
    @Input() ariaLabel = 'Filter';
    @Input() fallbackLabel = '?';
    @Input() size: 'default' | 'small' = 'default';
    @Input() panelAlign: 'left' | 'right' = 'right';

    @Output() selectedIdChange = new EventEmitter<number | null>();

    get menuPositions(): ConnectedPosition[] {
        const above = this.availableSpaceAboveTrigger();
        const below = this.availableSpaceBelowTrigger();
        const preferAbove = above >= below;

        if (this.panelAlign === 'left') {
            return preferAbove ? this.leftAboveMenuPositions : this.leftBelowMenuPositions;
        }

        return preferAbove ? this.rightAboveMenuPositions : this.rightBelowMenuPositions;
    }

    get menuMaxHeight(): number {
        const availableHeight = Math.max(this.availableSpaceAboveTrigger(), this.availableSpaceBelowTrigger());
        return Math.max(0, Math.min(this.menuMaxNaturalHeight, availableHeight));
    }

    get activeOption(): CompactFilterMenuOption | null {
        return this.selectedId == null
            ? null
            : this.options.find(option => option.id === this.selectedId) ?? null;
    }

    select(id: number | null): void {
        this.selectedIdChange.emit(id);
    }

    private availableSpaceAboveTrigger(): number {
        const rect = this.hostElement.nativeElement.getBoundingClientRect();
        return Math.max(0, rect.top - this.menuViewportMargin - this.menuTriggerGap);
    }

    private availableSpaceBelowTrigger(): number {
        const rect = this.hostElement.nativeElement.getBoundingClientRect();
        return Math.max(0, window.innerHeight - rect.bottom - this.menuViewportMargin - this.menuTriggerGap);
    }
}