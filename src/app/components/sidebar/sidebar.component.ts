// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, computed, input, viewChild, ElementRef } from '@angular/core';
import { type Portal, PortalModule } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import type { UnitSearchComponent } from '../unit-search/unit-search.component';
import { OptionsService } from '../../services/options.service';
import { SidebarFooterComponent } from '../sidebar-footer/sidebar-footer.component';
import { CdkMenuModule } from '@angular/cdk/menu';
import { ForceBuilderViewerComponent } from '../force-builder-viewer/force-builder-viewer.component';
import { SwipeDirective, type SwipeEndEvent, type SwipeStartEvent } from '../../directives/swipe.directive';
import { BUILD_BRANCH } from '../../build-meta';
import { DialogsService } from '../../services/dialogs.service';
import { ConnectionStatusBadgeComponent } from '../connection-status-badge/connection-status-badge.component';

/*
 * Main Sidebar component
 *
 */
@Component({
    selector: 'sidebar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgTemplateOutlet, PortalModule, CdkMenuModule, SidebarFooterComponent, ForceBuilderViewerComponent, SwipeDirective, ConnectionStatusBadgeComponent],
    templateUrl: './sidebar.component.html',
    styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
    readonly COLLAPSED_WIDTH = 72;
    readonly EXPANDED_WIDTH = 360;
    private readonly EDGE_SWIPE_WIDTH = 32;
    private readonly LIP_DRAG_THRESHOLD = 4;

    elRef = inject(ElementRef<HTMLElement>);
    layout = inject(LayoutService);
    options = inject(OptionsService);
    protected isNextBuild = BUILD_BRANCH !== 'main';
    private dialogsService = inject(DialogsService);
    unitSearchPortal = input<Portal<HTMLElement>>();
    unitSearchComponent = input<UnitSearchComponent>();

    private burgerLipBtn = viewChild<ElementRef<HTMLButtonElement>>('burgerLipBtn');
    private forceBuilderViewer = viewChild<ForceBuilderViewerComponent>('forceBuilderViewer');
    private footer = viewChild<SidebarFooterComponent>('footer');
    private swipeDirective = viewChild<SwipeDirective>(SwipeDirective);

    private startRatio = 0;

    // derived signals
    public isPhone = this.layout.isPhone;
    public isTablet = this.layout.isTablet;
    public isDesktop = this.layout.isDesktop;

    // backdrop opacity for phone: tied to menuOpenRatio
    public backdropOpacity = computed(() => {
        return Math.min(0.75, 0.6 * this.layout.menuOpenRatio());
    });

    public getDragWidth() {
        return this.isPhone() ? this.sidebarExpandedWidth() : this.EXPANDED_WIDTH - this.COLLAPSED_WIDTH;
    }
    public getDragDimension = () => this.getDragWidth(); // Bonded version for swipe directive


    public sidebarExpandedWidth = computed(() => {
        const width = this.layout.windowWidth();
        const drawerWidth = this.EXPANDED_WIDTH > width - 32 ? width : this.EXPANDED_WIDTH;
        return Math.max(320, Math.min(width*0.92, drawerWidth));
    });

    public drawerTransform = computed(() => {
        const slide = this.getDragWidth();
        const ratio = this.layout.menuOpenRatio();
        const tx = (ratio - 1) * slide; // 0 -> fully closed (offset left), 1 -> aligned
        return `translateX(${Math.round(tx)}px)`;
    });

    // visibility state
    public drawerOpenState = computed(() => {
        return this.layout.isMenuOpen() || this.layout.menuOpenRatio() > 0.01;
    });

    // desktop dock width based on expanded state
    public desktopDockWidth = computed(() => {
        return this.layout.isMenuOpen() ? this.EXPANDED_WIDTH : this.COLLAPSED_WIDTH;
    });

    public tinyMode = computed(() => {
        return !this.isPhone() && !this.drawerOpenState();
    });

    constructor() {
        window.addEventListener('pointerdown', this.onEdgePointerDown, true);

        inject(DestroyRef).onDestroy(() => {
            window.removeEventListener('pointerdown', this.onEdgePointerDown, true);
            this.cleanupLipListeners();
            // Detach portal if still attached to prevent DOM node retention
            const portal = this.unitSearchPortal();
            if (portal?.isAttached) {
                portal.detach();
            }
        });
        
        effect((cleanup) => {
            let offset = 0;
            let width = 0;
            if (this.isPhone()) {
                offset = 0;
                width = this.sidebarExpandedWidth();
            } else if (this.isTablet()) {
                // Tablet: content is always pushed by the collapsed dock only
                offset = this.COLLAPSED_WIDTH;
                width = this.desktopDockWidth();
            } else {
                // desktop: use computed dock width
                width = this.desktopDockWidth();
                offset = this.COLLAPSED_WIDTH + (this.layout.menuOpenRatio() * (this.EXPANDED_WIDTH - this.COLLAPSED_WIDTH));
            }
            const docStyle = document.documentElement.style;
            docStyle.setProperty('--sidebar-expanded-width', `${this.sidebarExpandedWidth()}px`);
            docStyle.setProperty('--sidebar-width', `${width}px`);
            docStyle.setProperty('--sidebar-offset', `${offset}px`);
            document.documentElement.classList.toggle('sidebar-docked', offset > 0);

            cleanup(() => {
                document.documentElement.style.removeProperty('--sidebar-expanded-width');
                document.documentElement.style.removeProperty('--sidebar-width');
                document.documentElement.style.removeProperty('--sidebar-offset');
                document.documentElement.classList.remove('sidebar-docked');
            });
        });
        // If a unit-search component instance is passed in, have the sidebar
        // control its `buttonOnly` input only when the portal provided to this
        // sidebar is the active host. Otherwise ensure the component stays false.
        effect((onCleanup) => {
            const comp = this.unitSearchComponent?.();
            const portal = this.unitSearchPortal?.();
            if (!comp) return;
            if (portal) {
                // Sidebar pilots the control while the portal is hosted here
                comp.buttonOnly.set(!this.isPhone() && !this.layout.isMenuOpen());
            } else {
                // Revert to main-app default when not hosted in sidebar
                comp.buttonOnly.set(false);
            }
            onCleanup(() => {
                if (comp) {
                    comp.buttonOnly.set(false);
                }
            });
        });
    }

    private lipTop = signal<number | null>(null);

    lipButtonTop = computed(() => {
        const height = this.layout.windowHeight();
        const lip = this.burgerLipBtn()?.nativeElement;
        if (!lip) return null;
        // If we're actively dragging, prefer transient signal value
        const transientTop = this.lipTop();
        const savedPos = this.options.options().sidebarLipPosition;
        if (transientTop === null && !savedPos) return null;
        // Determine the raw top value in pixels
        let topPx: number | null = null;
        if (transientTop !== null) {
            topPx = transientTop;
        } else if (savedPos) {
            // savedPos could be like "123px"
            const parsed = parseFloat(savedPos);
            if (!Number.isNaN(parsed)) topPx = parsed;
        }
        if (topPx === null) return null;
        return `${topPx}px`;
    });

    public toggleMenuOpenClose() {
        this.footer()?.closeAllMenus();
        this.layout.isMenuOpen.update(v => !v);
    }

    showNextDialog(): void {
        this.dialogsService.showNextDialog();
    }

    private readonly onEdgePointerDown = (event: PointerEvent): void => {
        if (this.isDesktop() || this.drawerOpenState() || event.clientX > this.EDGE_SWIPE_WIDTH) return;
        if (document.querySelector('[aria-modal="true"]')) return;

        const target = event.target;
        if (target instanceof Element && target.closest('.burger-lip-btn, .cdk-overlay-container')) {
            return;
        }

        // Observe edge gestures from the capture phase instead of placing a hit
        // target over the page. startSwipe does not consume a tap; the actual
        // control under the pointer remains the click target unless a swipe wins.
        this.swipeDirective()?.startSwipe(event);
    };

    /* --------------------------------------------------------
     * Lip button
     */
    private lipPointerId: number | null = null;
    private lipStartX = 0;
    private lipStartY = 0;
    private lipStartTop = 0;
    private lipDragging = false;
    private lipSwipeActive = false;
    private ignoreNextLipClick = false;

    onLipPointerDown(event: PointerEvent) {
        const lip = this.burgerLipBtn()?.nativeElement;
        if (!lip || event.isPrimary === false || event.button !== 0) return;

        // compute current top relative to sidebar host
        const hostRect = this.elRef.nativeElement.getBoundingClientRect();
        const btnRect = lip.getBoundingClientRect();
        const currentTop = btnRect.top - hostRect.top;

        this.lipPointerId = event.pointerId;
        this.lipStartX = event.clientX;
        this.lipStartY = event.clientY;
        this.lipStartTop = currentTop;
        this.lipDragging = false;
        this.lipSwipeActive = false;
        this.ignoreNextLipClick = false;

        window.addEventListener('pointermove', this.onLipPointerMove, true);
        window.addEventListener('pointerup', this.onLipPointerUp, true);
        window.addEventListener('pointercancel', this.onLipPointerCancel, true);
    }

    private readonly onLipPointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.lipPointerId || this.lipSwipeActive) return;

        const lip = this.burgerLipBtn()?.nativeElement;
        if (!lip) return;

        const dx = event.clientX - this.lipStartX;
        const dy = event.clientY - this.lipStartY;
        if (!this.lipDragging) {
            if (Math.abs(dy) <= this.LIP_DRAG_THRESHOLD || Math.abs(dy) <= Math.abs(dx)) return;

            this.lipDragging = true;
            this.ignoreNextLipClick = true;
            this.lipTop.set(this.lipStartTop);
            try { lip.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        }

        const maxTop = Math.max(0, this.elRef.nativeElement.offsetHeight - lip.offsetHeight);
        this.lipTop.set(Math.max(0, Math.min(this.lipStartTop + dy, maxTop)));
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly onLipPointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.lipPointerId) return;

        if (this.lipDragging) {
            event.preventDefault();
            event.stopPropagation();
            const finalTop = this.lipTop();
            if (finalTop !== null) {
                this.options.setOption('sidebarLipPosition', `${Math.round(finalTop)}`);
            }
        }

        this.finishLipPointer(event.pointerId);
    };

    private readonly onLipPointerCancel = (event: PointerEvent): void => {
        if (event.pointerId !== this.lipPointerId) return;

        if (this.lipDragging) {
            this.lipTop.set(this.lipStartTop);
        }
        this.ignoreNextLipClick = false;
        this.finishLipPointer(event.pointerId);
    };

    private finishLipPointer(pointerId: number): void {
        const lip = this.burgerLipBtn()?.nativeElement;
        try {
            if (lip?.hasPointerCapture(pointerId)) lip.releasePointerCapture(pointerId);
        } catch { /* ignore */ }

        this.lipPointerId = null;
        this.lipStartX = 0;
        this.lipStartY = 0;
        this.lipStartTop = 0;
        this.lipDragging = false;
        this.lipSwipeActive = false;
        this.cleanupLipListeners();
    }

    private cleanupLipListeners(): void {
        window.removeEventListener('pointermove', this.onLipPointerMove, true);
        window.removeEventListener('pointerup', this.onLipPointerUp, true);
        window.removeEventListener('pointercancel', this.onLipPointerCancel, true);
    }

    onLipButtonClick() {
        if (this.ignoreNextLipClick) {
            this.ignoreNextLipClick = false;
            return;
        }
        this.toggleMenuOpenClose();
    }

    public shouldBlockSwipe = () => {
        if (this.unitSearchComponent()?.resultsVisible() || this.unitSearchComponent()?.advOpen()) {
            return true;
        }
        if (this.forceBuilderViewer()?.isUnitDragging() 
        || this.forceBuilderViewer()?.isGroupDragging() 
        || this.forceBuilderViewer()?.isForceDragging()) {
            return true;
        }
        return false;
    };

    public onSwipeStart(event: SwipeStartEvent) {
        if (event.originalEvent.pointerId === this.lipPointerId) {
            this.lipSwipeActive = true;
            this.ignoreNextLipClick = true;
        }

        this.layout.isMenuDragging.set(true);
        this.startRatio = this.layout.menuOpenRatio();

        // Close menus/panels at start
        try {
            this.footer()?.closeAllMenus();
            this.unitSearchComponent()?.closeAllPanels();
        } catch { /* ignore */ }
    }

    public onSwipeRatio(ratio: number) {
        let newRatio = this.startRatio + ratio;
        
        // Clamp between 0 and 1 for the menu state
        newRatio = Math.max(0, Math.min(1, newRatio));
        
        this.layout.menuOpenRatio.set(newRatio);

        if (newRatio > 0.02) {
            this.layout.isMenuOpen.set(true);
        }
    }

    public onSwipeEnd(event: SwipeEndEvent) {

        this.layout.isMenuDragging.set(false);
        
        const shouldOpen = event.success 
          ? event.direction === 'right' 
          : this.layout.menuOpenRatio() >= 0.5;

        this.layout.menuOpenRatio.set(shouldOpen ? 1 : 0);
        this.layout.isMenuOpen.set(shouldOpen);
    }

    public onSwipeCancel() {
        this.layout.isMenuDragging.set(false);
        this.layout.menuOpenRatio.update(v => v >= 0.5 ? 1 : 0);
    }

    // backdrop click to close overlay
    public onBackdropPointerDown() {
        const directive = this.swipeDirective();
        if (directive?.swiping()) return; // ignore if swiping

        this.layout.isMenuOpen.set(false);
        this.layout.menuOpenRatio.set(0);
    }

}
