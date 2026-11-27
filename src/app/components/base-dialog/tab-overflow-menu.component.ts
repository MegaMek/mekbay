// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
    tabs = input<readonly string[]>([]);
    activeTab = input<string>();
    tabSelected = output<string>();

    onSelect(tab: string) {
        this.tabSelected.emit(tab);
    }
}
