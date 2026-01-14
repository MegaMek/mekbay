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

import { Component, ChangeDetectionStrategy, input, output, signal, afterNextRender, computed } from '@angular/core';
import { CdkMenuModule } from '@angular/cdk/menu';
import { SerializedSearchFilter } from '../../services/unit-search-filters.service';
import { GameSystem } from '../../models/common.model';

@Component({
    selector: 'search-favorites-menu',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkMenuModule],
    host: {
        '[class.ready]': 'ready()'
    },
    template: `
    <div class="favorites-menu glass framed-borders has-shadow">
      @if (favorites().length > 0) {
        <div class="search-container">
          <input
            class="bt-input search-input"
            type="text"
            placeholder="Filter tactical bookmarks..."
            [value]="searchText()"
            (input)="onSearch($any($event.target).value)" />
        </div>
      }
      <div class="favorites-list">
        @let favs = this.filteredFavorites();
        @if (favorites().length === 0) {
          <div class="no-favorites">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span>No tactical bookmarks saved yet</span>
            <span class="hint">Save your current search to quickly access it later</span>
          </div>
        } @else if (favs.length === 0) {
          <div class="no-favorites">
            <span>No tactical bookmarks match your search</span>
          </div>
        } @else {
          @for (f of favs; track f.id) {
            <div class="favorite-item" (click)="selectFavorite(f)">
              <svg class="item-icon" [class.as]="f.gameSystem === GameSystem.ALPHA_STRIKE" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="favorite-name">{{ f.name }}</span>
              <button type="button" class="menu-btn"
                [cdkMenuTriggerFor]="itemMenu"
                (cdkMenuClosed)="onMenuClosed()"
                (click)="onMenuOpen(f, $event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="5" r="2"/>
                  <circle cx="12" cy="12" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                </svg>
              </button>
              <ng-template #itemMenu>
                <div class="popup-menu glass framed-borders has-shadow" cdkMenu>
                  <button class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="onRename()">
                    <span class="icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11 4H4C3.44772 4 3 4.44772 3 5V19C3 19.5523 3.44772 20 4 20H18C18.5523 20 19 19.5523 19 19V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89783 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg></span> Rename
                  </button>
                  <button class="menu-item danger" cdkMenuItem (cdkMenuItemTriggered)="onDelete()">
                    <span class="icon">
                        <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M6 7V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V7M6 7H5M6 7H8M18 7H19M18 7H16M10 11V16M14 11V16M8 7V5C8 3.89543 8.89543 3 10 3H14C15.1046 3 16 3.89543 16 5V7M8 7H16"/></svg>    
                    </span> Delete
                  </button>
                </div>
              </ng-template>
            </div>
          }
        }
      </div>
      <div class="favorites-actions">
        <button type="button" class="bt-button save-btn" [disabled]="!canSave()" (click)="onSave()">
          SAVE CURRENT SEARCH
        </button>
      </div>
    </div>
    `,
    styles: [`
        :host:not(.ready) .bt-button {
            transition: none !important;
        }
        @media print {
            :host {
                display: none !important;
            }
        }
        .favorites-menu {
            width: 340px;
            max-height: 500px;
            min-height: 180px;
            display: flex;
            flex-direction: column;
        }
        .search-container {
            padding: 12px 16px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .search-input {
            width: 100%;
            box-sizing: border-box;
        }
        .favorites-list {
            max-height: 320px;
            overflow: auto;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
        }
        .favorite-item {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            gap: 10px;
            transition: background-color 0.15s ease;
        }
        .favorite-item:hover {
            background-color: rgba(255,255,255,0.06);
        }
        .favorite-item:last-child {
            border-bottom: none;
        }
        .item-icon {
            flex-shrink: 0;
            stroke: #ffcc00;
            fill: #725c00;
        }
        .item-icon.as {
            stroke: #ffcc00;
            fill: #cd0000;
        }
        .favorite-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.9em;
        }
        .menu-btn {
            opacity: 0.4;
            padding: 6px;
            min-width: 28px;
            min-height: 28px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: silver;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.15s ease, background-color 0.15s ease;
        }
        .menu-btn:hover {
            opacity: 1;
            background-color: rgba(255,255,255,0.1);
        }
        .menu-btn svg {
            fill: currentColor;
        }
        .no-favorites {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            flex-grow: 1;
            padding: 32px 24px;
            gap: 12px;
            text-align: center;
        }
        .no-favorites svg {
            opacity: 0.3;
        }
        .no-favorites span {
            font-size: 0.9em;
            color: var(--text-color-secondary);
        }
        .no-favorites .hint {
            font-size: 0.8em;
            color: var(--text-color-tertiary);
            max-width: 220px;
        }
        .favorites-actions {
            padding: 14px 16px;
            border-top: 1px solid var(--border-color);
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .save-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            justify-content: center;
        }
        .save-btn svg {
            flex-shrink: 0;
        }
    `]
})
export class SearchFavoritesMenuComponent {
    protected readonly GameSystem = GameSystem;

    favorites = input<SerializedSearchFilter[]>([]);
    canSave = input<boolean>(false);
    ready = signal(false);
    searchText = signal('');
    select = output<SerializedSearchFilter>();
    rename = output<SerializedSearchFilter>();
    delete = output<SerializedSearchFilter>();
    saveRequest = output<void>();
    
    /** Emitted when the item menu opens - parent should block overlay close */
    menuOpened = output<void>();
    /** Emitted when the item menu closes - parent should unblock overlay close */
    menuClosed = output<void>();

    /** Currently active item for the context menu */
    private activeItem = signal<SerializedSearchFilter | null>(null);

    /** Filtered favorites based on search text */
    filteredFavorites = computed(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return this.favorites();
        return this.favorites().filter(f => {
            const hay = f.name.toLowerCase();
            return tokens.every(t => hay.includes(t));
        });
    });

    constructor() {
        afterNextRender(() => {
            this.ready.set(true);
        });
    }

    onSearch(text: string) {
        this.searchText.set(text);
    }

    selectFavorite(favorite: SerializedSearchFilter) {
        this.select.emit(favorite);
    }

    /** Store the active item when menu button is clicked */
    onMenuOpen(favorite: SerializedSearchFilter, event: MouseEvent) {
        event.stopPropagation();
        this.activeItem.set(favorite);
        this.menuOpened.emit();
    }

    onMenuClosed() {
        this.menuClosed.emit();
    }

    onRename() {
        const item = this.activeItem();
        if (item) {
            this.rename.emit(item);
        }
    }

    onDelete() {
        const item = this.activeItem();
        if (item) {
            this.delete.emit(item);
        }
    }

    onSave() {
        this.saveRequest.emit();
    }
}