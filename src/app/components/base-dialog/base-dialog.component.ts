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

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

/*
 * Author: Drake
 */
@Component({
    selector: 'base-dialog',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./base-dialog.component.css'],
    template: `
    <div class="modal-flex-center">
      <div class="modal" [ngClass]="modalClassFromTab()">
        <div class="modal-header" [class.tabbed]="isTabbed()">
          <ng-content select="[dialog-header]"></ng-content>
          <div *ngIf="isTabbed()" class="tab-header">
            <div class="tab-buttons">
              <button *ngFor="let tab of tabs()" 
                      class="tab-button" 
                      [class.active]="tab === activeTab()" 
                      (click)="onTabClick(tab)">
                {{ tab }}
              </button>
            </div>
            <div class="tab-actions">
              <ng-content select="[tab-actions]"></ng-content>
            </div>
          </div>
        </div>
        <div class="modal-body">
          <ng-content select="[dialog-body]"></ng-content>
        </div>
        <div class="modal-footer">
          <ng-content select="[dialog-footer]"></ng-content>
        </div>
      </div>
    </div>
  `
})
export class BaseDialogComponent {
    tabs = input<string[]>([]);
    activeTab = input<string>();
    isTabbed = computed(() => this.tabs().length > 0);
    activeTabChange = output<string>();

    onTabClick(tab: string) {
        this.activeTabChange.emit(tab);
    }
    
    modalClassFromTab(): string {
        const tab = this.activeTab();
        if (!tab) return '';
        return `activetab-${tab.toLowerCase()}`;
    }
}