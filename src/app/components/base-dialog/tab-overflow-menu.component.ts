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

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
    selector: 'tab-overflow-menu',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        .tab-overflow-menu {
            background-color: var(--background-color-menu);
            border: 1px solid var(--text-color-secondary);
            min-width: 120px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .tab-overflow-item {
            display: block;
            width: 100%;
            padding: 0.6em 1em;
            background: none;
            border: none;
            color: var(--text-color-secondary);
            text-align: left;
            cursor: pointer;
            font-size: 1em;
            white-space: nowrap;
            transition: background-color 0.15s, color 0.15s;
        }

        .tab-overflow-item:hover {
            background-color: rgba(255, 255, 255, 0.1);
            color: var(--text-color);
        }

        .tab-overflow-item.active {
            color: var(--accent-color);
        }
    `],
    template: `
        <div class="tab-overflow-menu">
            @for (tab of tabs(); track tab) {
                <button class="tab-overflow-item"
                        [class.active]="tab === activeTab()"
                        (click)="onSelect(tab)">
                    {{ tab }}
                </button>
            }
        </div>
    `
})
export class TabOverflowMenuComponent {
    tabs = input<string[]>([]);
    activeTab = input<string>();
    tabSelected = output<string>();

    onSelect(tab: string) {
        this.tabSelected.emit(tab);
    }
}
