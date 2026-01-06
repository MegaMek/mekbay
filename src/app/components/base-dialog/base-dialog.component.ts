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

import { 
    AfterViewInit, 
    ChangeDetectionStrategy, 
    Component, 
    computed, 
    DestroyRef,
    ElementRef, 
    inject,
    Injector,
    input, 
    output, 
    signal,
    viewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentPortal } from '@angular/cdk/portal';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { TabOverflowMenuComponent } from './tab-overflow-menu.component';

const OVERFLOW_OVERLAY_KEY = 'tab-overflow-menu';

/*
 * Author: Drake
 */
@Component({
    selector: 'base-dialog',
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./base-dialog.component.scss'],
    template: `
    <div class="modal-flex-center">
      <div class="modal tv-fade" [class.auto-height]="autoHeight()" [ngClass]="modalClassFromTab()">
        <div class="modal-header" [class.tabbed]="isTabbed()">
          <ng-content select="[dialog-header]"></ng-content>
          @if (isTabbed()) {
            <div class="tab-header" #tabHeader [class.wrap-mode]="!overflowToDropdown()">
              <div class="tab-buttons" #tabButtonsContainer [class.wrap]="!overflowToDropdown()">
                @if (overflowToDropdown()) {
                  @for (tab of visibleTabs(); track tab) {
                    <button class="tab-button" 
                            [class.active]="tab === activeTab()" 
                            (click)="onTabClick(tab)">
                      {{ tab }}
                    </button>
                  }
                  @if (overflowTabs().length > 0) {
                    <button class="tab-button tab-overflow-trigger" 
                            #overflowTrigger
                            [class.active]="isActiveTabInOverflow()"
                            (click)="toggleOverflowMenu($event)">
                      @if (isActiveTabInOverflow()) {
                        <span class="overflow-active-label">{{ activeTab() }}</span>
                      }
                      <span class="overflow-icon">▾</span>
                    </button>
                  }
                } @else {
                  @for (tab of tabs(); track tab) {
                    <button class="tab-button" 
                            [class.active]="tab === activeTab()" 
                            (click)="onTabClick(tab)">
                      {{ tab }}
                    </button>
                  }
                }
              </div>
              <div class="tab-actions" #tabActionsContainer>
                <ng-content select="[tab-actions]"></ng-content>
              </div>
            </div>
          }
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
export class BaseDialogComponent implements AfterViewInit {
    private destroyRef = inject(DestroyRef);
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    
    tabs = input<string[]>([]);
    activeTab = input<string>();
    overflowToDropdown = input<boolean>(false);
    autoHeight = input<boolean>(false);
    isTabbed = computed(() => this.tabs().length > 0);
    activeTabChange = output<string>();

    tabHeader = viewChild<ElementRef<HTMLDivElement>>('tabHeader');
    tabButtonsContainer = viewChild<ElementRef<HTMLDivElement>>('tabButtonsContainer');
    tabActionsContainer = viewChild<ElementRef<HTMLDivElement>>('tabActionsContainer');
    overflowTrigger = viewChild<ElementRef<HTMLButtonElement>>('overflowTrigger');

    visibleTabCount = signal<number>(Infinity);

    visibleTabs = computed(() => {
        const allTabs = this.tabs();
        const count = this.visibleTabCount();
        return allTabs.slice(0, count);
    });

    overflowTabs = computed(() => {
        const allTabs = this.tabs();
        const count = this.visibleTabCount();
        return allTabs.slice(count);
    });

    isActiveTabInOverflow = computed(() => {
        const active = this.activeTab();
        return this.overflowTabs().includes(active ?? '');
    });

    private resizeObserver: ResizeObserver | null = null;

    ngAfterViewInit() {
        // Only setup resize observer for dropdown mode
        if (this.overflowToDropdown()) {
            this.setupResizeObserver();
        }
        
        this.destroyRef.onDestroy(() => {
            this.overlayManager.closeManagedOverlay(OVERFLOW_OVERLAY_KEY);
            this.resizeObserver?.disconnect();
        });
    }

    private setupResizeObserver() {
        const headerEl = this.tabHeader()?.nativeElement;
        if (!headerEl) return;

        this.resizeObserver = new ResizeObserver(() => {
            this.calculateVisibleTabs();
        });
        
        this.resizeObserver.observe(headerEl);
        
        // Initial calculation after a frame to ensure DOM is ready
        requestAnimationFrame(() => this.calculateVisibleTabs());
    }

    private calculateVisibleTabs() {
        const headerEl = this.tabHeader()?.nativeElement;
        const actionsEl = this.tabActionsContainer()?.nativeElement;
        
        if (!headerEl) return;

        const allTabs = this.tabs();
        if (allTabs.length === 0) return;

        // Get available width (header width minus actions width minus some padding)
        const headerWidth = headerEl.clientWidth;
        const actionsWidth = actionsEl?.offsetWidth ?? 0;
        const overflowButtonWidth = 60; // Approximate width for overflow trigger
        const padding = 16; // Safety padding
        
        const availableWidth = headerWidth - actionsWidth - padding;

        // Measure tab widths by creating temporary elements
        const tabWidths = this.measureTabWidths(allTabs);
        
        // Calculate how many tabs fit
        let totalWidth = 0;
        let visibleCount = 0;
        
        for (let i = 0; i < allTabs.length; i++) {
            const tabWidth = tabWidths[i];
            const needsOverflow = i < allTabs.length - 1;
            const widthNeeded = totalWidth + tabWidth + (needsOverflow ? overflowButtonWidth : 0);
            
            if (widthNeeded <= availableWidth) {
                totalWidth += tabWidth;
                visibleCount++;
            } else {
                break;
            }
        }

        // If all tabs fit without overflow button, show them all
        if (visibleCount === allTabs.length) {
            this.visibleTabCount.set(allTabs.length);
        } else {
            // Need at least one visible tab
            this.visibleTabCount.set(Math.max(1, visibleCount));
        }
    }

    private measureTabWidths(tabs: string[]): number[] {
        // Create a hidden container to measure tab widths
        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:1em;';
        document.body.appendChild(measurer);

        const widths = tabs.map(tab => {
            const btn = document.createElement('button');
            btn.className = 'tab-button';
            btn.style.cssText = 'padding:0.5em 1em;font-size:1em;white-space:nowrap;';
            btn.textContent = tab;
            measurer.appendChild(btn);
            const width = btn.offsetWidth;
            measurer.removeChild(btn);
            return width;
        });

        document.body.removeChild(measurer);
        return widths;
    }

    onTabClick(tab: string) {
        this.activeTabChange.emit(tab);
    }

    toggleOverflowMenu(event: Event) {
        event.stopPropagation();
        
        // If already open, close it
        if (this.overlayManager.has(OVERFLOW_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(OVERFLOW_OVERLAY_KEY);
            return;
        }

        const triggerEl = this.overflowTrigger()?.nativeElement;
        if (!triggerEl) return;

        const portal = new ComponentPortal(TabOverflowMenuComponent, null, this.injector);
        const compRef = this.overlayManager.createManagedOverlay(OVERFLOW_OVERLAY_KEY, triggerEl, portal, {
            hasBackdrop: false,
            closeOnOutsideClick: true,
            positions: [
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 2 },
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 2 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -2 },
            ]
        });

        compRef.setInput('tabs', this.overflowTabs());
        compRef.setInput('activeTab', this.activeTab());
        
        compRef.instance.tabSelected.subscribe((tab: string) => {
            this.overlayManager.closeManagedOverlay(OVERFLOW_OVERLAY_KEY);
            this.activeTabChange.emit(tab);
        });
    }
    
    modalClassFromTab(): string {
        const tab = this.activeTab();
        if (!tab) return '';
        return `activetab-${tab.toLowerCase()}`;
    }
}