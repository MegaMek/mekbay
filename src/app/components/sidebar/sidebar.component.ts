import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, computed, input, viewChild, ElementRef, Renderer2 } from '@angular/core';
import { Portal, PortalModule } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { UnitSearchComponent } from '../unit-search/unit-search.component';
import { OptionsService } from '../../services/options.service';
import { SidebarFooterComponent } from '../sidebar-footer/sidebar-footer.component';
import { CdkMenuModule } from '@angular/cdk/menu';
import { ForceBuilderViewerComponent } from '../force-builder-viewer/force-builder-viewer.component';
import { SwipeDirective, SwipeEndEvent, SwipeStartEvent } from '../../directives/swipe.directive';

/*
 * Main Sidebar component
 *
 */
@Component({
    selector: 'sidebar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, PortalModule, CdkMenuModule, SidebarFooterComponent, ForceBuilderViewerComponent, SwipeDirective],
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
    readonly COLLAPSED_WIDTH = 72;
    readonly EXPANDED_WIDTH = 360;
    elRef = inject(ElementRef<HTMLElement>);
    layout = inject(LayoutService);
    options = inject(OptionsService);
    renderer = inject(Renderer2);
    unitSearchPortal = input<Portal<any>>();
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
        inject(DestroyRef).onDestroy(() => {
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
        if (topPx === undefined) return null;
        return `${topPx}px`;
    });

    public toggleMenuOpenClose() {
        this.footer()?.closeAllMenus();
        this.layout.isMenuOpen.update(v => !v);
    }

    public onEdgePointerDown(ev: PointerEvent) {
        if (this.isDesktop()) { return; }
        if (ev.isPrimary === false) { return; }
        if (ev.clientX > 32) { return; }

        ev.preventDefault();
        
        const directive = this.swipeDirective();
        if (directive) {
            directive.startSwipe(ev);
        }
    }

    /* --------------------------------------------------------
     * Lip button
     */
    private lipPointerId: number | null = null;
    private lipStartY = 0;
    private lipStartTop = 0;
    private lipMoved = false;
    private ignoreNextLipClick = false;
    private lipUnlistenMove?: () => void;
    private lipUnlistenUp?: () => void;

    onLipPointerDown(event: PointerEvent) {
        const lip = this.burgerLipBtn()?.nativeElement;
        if (!lip || event.isPrimary === false) return;

        // compute current top relative to sidebar host
        const hostRect = this.elRef.nativeElement.getBoundingClientRect();
        const btnRect = lip.getBoundingClientRect();
        const currentTop = btnRect.top - hostRect.top;

        this.lipPointerId = event.pointerId;
        this.lipStartY = event.clientY;
        this.lipStartTop = currentTop;
        this.lipMoved = false;
        this.ignoreNextLipClick = false;

        // set transient signal so computed style will apply top positioning        
        this.lipTop.set(currentTop);

        try { lip.setPointerCapture(event.pointerId); } catch { /* ignore */ }

        const move = (ev: PointerEvent) => {
            if (ev.pointerId !== this.lipPointerId) return;
            const dy = ev.clientY - this.lipStartY;
            const hostHeight = this.elRef.nativeElement.offsetHeight;
            const btnHeight = lip.offsetHeight;
            const minTop = 0;
            const maxTop = Math.max(0, hostHeight - btnHeight);
            const newTop = Math.max(0, Math.min(Math.max(this.lipStartTop + dy, minTop), maxTop));
            this.lipTop.set(newTop);
            if (!this.lipMoved && Math.abs(dy) > 4) this.lipMoved = true;
            ev.preventDefault();
            ev.stopPropagation();
        };

        const up = (ev: PointerEvent) => {
            if (ev.pointerId !== this.lipPointerId) return;
            try { lip.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
            if (this.lipMoved) this.ignoreNextLipClick = true;
            this.lipPointerId = null;
            this.lipStartY = 0;
            this.lipStartTop = 0;
            this.lipMoved = false;
            this.cleanupLipListeners();
            ev.preventDefault();
            ev.stopPropagation();
            let finalTop = this.lipTop();
            if (finalTop !== null) {
                if (finalTop < 0) {
                    finalTop = 0;
                }
                this.options.setOption('sidebarLipPosition', `${Math.round(finalTop)}`);
            }
        };

        // keep the listeners in renderer so Angular can clean them properly
        // use 'window' target for global pointer move/up handling
        this.lipUnlistenMove = this.renderer.listen('window', 'pointermove', move);
        this.lipUnlistenUp = this.renderer.listen('window', 'pointerup', up);
    }

    private cleanupLipListeners() {
        if (this.lipUnlistenMove) { this.lipUnlistenMove(); this.lipUnlistenMove = undefined; }
        if (this.lipUnlistenUp) { this.lipUnlistenUp(); this.lipUnlistenUp = undefined; }
    }

    onLipButtonClick() {
        if (this.ignoreNextLipClick) {
            this.ignoreNextLipClick = false;
            return;
        }
        this.toggleMenuOpenClose();
    }

    public shouldBlockSwipe = () => {
        if (this.unitSearchComponent()?.resultsVisible()) {
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
        this.layout.menuOpenRatio.set(this.layout.menuOpenRatio() >= 0.5 ? 1 : 0);
    }

    // backdrop click to close overlay
    public onBackdropPointerDown() {
        const directive = this.swipeDirective();
        if (directive?.swiping()) return; // ignore if swiping

        this.layout.isMenuOpen.set(false);
        this.layout.menuOpenRatio.set(0);
    }

    public onEdgeTouchStart(ev: TouchEvent) {
        if (this.isDesktop()) { return; }
        if (ev.touches.length !== 1) { return; }
        if (ev.touches[0].clientX > 32) { return; }

        ev.preventDefault();
    }
}