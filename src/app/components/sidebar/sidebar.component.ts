import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, computed, input, viewChild, ElementRef, Renderer2, untracked, afterNextRender, Injector } from '@angular/core';
import { Portal, PortalModule } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { UnitSearchComponent } from '../unit-search/unit-search.component';
import { OptionsService } from '../../services/options.service';
import { SidebarFooterComponent } from '../sidebar-footer/sidebar-footer.component';
import { CdkMenuModule } from '@angular/cdk/menu';
import { ForceBuilderViewerComponent } from '../force-builder-viewer/force-builder-viewer.component';

/*
 * Main Sidebar component
 *
 */
@Component({
    selector: 'sidebar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, PortalModule, CdkMenuModule, SidebarFooterComponent, ForceBuilderViewerComponent],
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
    readonly COLLAPSED_WIDTH = 72;
    readonly EXPANDED_WIDTH = 360;
    injector = inject(Injector);
    elRef = inject(ElementRef<HTMLElement>);
    layout = inject(LayoutService);
    options = inject(OptionsService);
    renderer = inject(Renderer2);
    unitSearchPortal = input<Portal<any>>();
    unitSearchComponent = input<UnitSearchComponent>();

    private burgerLipBtn = viewChild<ElementRef<HTMLButtonElement>>('burgerLipBtn');
    private forceBuilderViewer = viewChild<ForceBuilderViewerComponent>('forceBuilderViewer');
    private footer = viewChild<SidebarFooterComponent>('footer');

    // drag state for phone
    private dragging = signal(false);
    private startX = 0;
    private startY = 0;
    private startRatio = 0;
    private activePointerId: number | null = null;

    // derived signals
    public isPhone = this.layout.isPhone;
    public isTablet = this.layout.isTablet;
    public isDesktop = this.layout.isDesktop;

    // computed phone drawer width in px
    public phoneWidthPx = computed(() => {
        if (typeof window === 'undefined') { return this.EXPANDED_WIDTH; }
        const w = Math.min(window.innerWidth * 0.9, this.EXPANDED_WIDTH);
        return Math.max(280, Math.round(w));
    });

    // backdrop opacity for phone: tied to menuOpenRatio
    public backdropOpacity = computed(() => {
        return Math.min(0.75, 0.6 * this.layout.menuOpenRatio());
    });

    // returns string transform for phone drawer based on layout.menuOpenRatio
    public phoneTransform = computed(() => {
        const w = this.phoneWidthPx();
        const ratio = this.layout.menuOpenRatio();
        const tx = (ratio - 1) * w; // when ratio==1 -> 0, ratio==0 -> -w
        return `translateX(${tx}px)`;
    });

    // boolean drawer open enough
    public drawerOpenState = computed(() => {
        return this.layout.isMenuOpen() || this.layout.menuOpenRatio() > 0.01;
    });

    // desktop dock width based on expanded state
    public desktopDockWidth = computed(() => {
        return this.layout.isMenuOpen() ? this.EXPANDED_WIDTH : this.COLLAPSED_WIDTH;
    });

    constructor() {
        effect((cleanup) => {
            let offset = 0;
            let width = 0;
            if (this.isPhone()) {
                offset = 0;
                width = this.phoneWidthPx();
            } else if (this.isTablet()) {
                offset = this.COLLAPSED_WIDTH;
                width = this.layout.isMenuOpen() ? this.EXPANDED_WIDTH : this.COLLAPSED_WIDTH;
            } else {
                // desktop: use computed dock width (150 collapsed / 300 expanded)
                offset = this.desktopDockWidth();
                width = offset;
            }
            document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
            document.documentElement.style.setProperty('--sidebar-offset', `${offset}px`);
            document.documentElement.classList.toggle('sidebar-docked', offset > 0);

            cleanup(() => {
                document.documentElement.style.removeProperty('--sidebar-offset');
                document.documentElement.classList.remove('sidebar-docked');
            });
        });
        // If a unit-search component instance is passed in, have the sidebar
        // control its `buttonOnly` input only when the portal provided to this
        // sidebar is the active host. Otherwise ensure the component stays false.
        effect(() => {
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
        });
        // Lip button repositioning
        effect(() => {
            const height = this.layout.windowHeight();
            const lip =  this.burgerLipBtn()?.nativeElement;
            if (lip) {
                if (lip.style.bottom !== 'auto') {
                    const savedPos = untracked(() => this.options.options().sidebarLipPosition);
                    if (savedPos) {
                        // switch to top positioning
                        this.renderer.setStyle(lip, 'top', savedPos);
                        this.renderer.setStyle(lip, 'bottom', 'auto');
                    } else {
                        return; // still bottom positioned
                    }
                };
                const topStr = lip.style.top;
                const lipTop = (topStr ? parseFloat(topStr) : lip.offsetTop) || 0;
                const maxTop = Math.max(0, height - lip.offsetHeight);
                if (lipTop > (maxTop + 1)) {
                    this.renderer.setStyle(lip, 'top', `${maxTop}px`);
                }
            }
        });
    }

    public toggleMenuOpenClose() {
        this.footer()?.closeAllMenus();
        this.layout.isMenuOpen.update(v => !v);
    }

    // PHONE: handle pointer down on left edge to start drag
    public onPhoneEdgePointerDown(ev: PointerEvent) {
        if (!this.isPhone()) { return; }
        // only primary pointer
        if (ev.isPrimary === false) { return; }

        // guard: only start if within left 10% of screen (touch-edge already constrained but double-check)
        const maxStartX = (typeof window !== 'undefined') ? Math.max(32, window.innerWidth * 0.10) : 80;
        if (ev.clientX > maxStartX) { return; }

        ev.preventDefault();

        this.startDrag(ev);
    }

    // PHONE: allow starting a drag from the open drawer to swipe it closed
    public onPhoneDrawerPointerDown(ev: PointerEvent) {
        if (!this.isPhone()) { return; }
        if (ev.isPrimary === false) { return; }

        if (this.unitSearchComponent() && this.unitSearchComponent()?.resultsVisible()) {
            return;
        }
        if (this.forceBuilderViewer() && this.forceBuilderViewer()?.isUnitDragging()) {
            return;
        }

        // only start drag when the drawer is at least slightly open (prevents accidental captures when fully closed)
        const currentRatio = this.layout.menuOpenRatio();
        if (currentRatio <= 0.01 && !this.layout.isMenuOpen()) { return; }

        this.startDrag(ev);
    }

    // start drag common
    private startDrag(startEvent: PointerEvent) {
        this.activePointerId = startEvent.pointerId;
        this.dragging.set(true);
        this.layout.isMenuDragging.set(true);
        this.startX = startEvent.clientX;
        this.startY = startEvent.clientY;
        this.startRatio = this.layout.menuOpenRatio();

        // set pointer capture on target if available
        let gestureDecided = false;
        let gestureDecisionCompleted = false;
        let gestureIsHorizontal = false;
        this.footer()?.closeAllMenus();
        
        try { this.elRef.nativeElement.setPointerCapture(startEvent.pointerId); } catch { /* ignore */ }

        const move = (ev: PointerEvent) => {
            if (ev.pointerId !== this.activePointerId) { return; }
            const dx = ev.clientX - this.startX;
            const dy = ev.clientY - this.startY;
            // decide gesture direction once (wait for a small noise threshold)
            
            if (this.forceBuilderViewer() && this.forceBuilderViewer()?.isUnitDragging()) {
                cancel(ev);
                return;
            }
            if (!gestureDecided) {
                const threshold = 6; // px
                if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
                    return; // not enough movement yet
                }
                gestureDecided = true;
                gestureIsHorizontal = Math.abs(dx) > Math.abs(dy);
                if (!gestureIsHorizontal) {
                    // not a horizontal swipe -> cancel gesture and revert
                    cancel(ev);
                    return;
                }
                // if horizontal, continue and handle as before
                if (!gestureDecisionCompleted) {
                    gestureDecisionCompleted = true;
                    this.unitSearchComponent()?.closeAllPanels();
                }
            }
            // compute delta relative to start
            const w = this.phoneWidthPx();
            let newRatio = this.startRatio + dx / w;
            newRatio = Math.max(0, Math.min(1, newRatio));
            this.layout.menuOpenRatio.set(newRatio);
            // reflect immediate open boolean for accessibility
            if (newRatio > 0.02) {
                // keep isMenuOpen true while > small threshold so overlay/backdrop becomes interactive
                this.layout.isMenuOpen.set(true);
            }
        };

        const up = (ev: PointerEvent) => {
            if (ev.pointerId !== this.activePointerId) { return; }
            // finalize
            const finalRatio = this.layout.menuOpenRatio();
            const shouldOpen = finalRatio >= 0.5;
            if (shouldOpen) {
                this.layout.menuOpenRatio.set(1);
                this.layout.isMenuOpen.set(true);
            } else {
                this.layout.menuOpenRatio.set(0);
                this.layout.isMenuOpen.set(false);
            }
            cleanup();
        };

        const cancel = (_: PointerEvent | PointerEvent) => {
            // revert to prior state
            const shouldOpen = this.startRatio >= 0.5;
            this.layout.menuOpenRatio.set(shouldOpen ? 1 : 0);
            this.layout.isMenuOpen.set(shouldOpen);
            cleanup();
        };

        const cleanup = () => {
            try {
                this.elRef.nativeElement.releasePointerCapture?.(this.activePointerId!);
            } catch {
                // ignore
            }
            window.removeEventListener('pointermove', move, { capture: true });
            window.removeEventListener('pointerup', up, { capture: true });
            window.removeEventListener('pointercancel', cancel, { capture: true });
            this.activePointerId = null;
            this.dragging.set(false);
            this.layout.isMenuDragging.set(false);
        };

        window.addEventListener('pointermove', move, { passive: true, capture: true });
        window.addEventListener('pointerup', up, { passive: true, capture: true });
        window.addEventListener('pointercancel', cancel, { passive: true, capture: true });
    }

    // backdrop click to close overlay
    public onBackdropPointerDown() {
        this.layout.isMenuOpen.set(false);
        this.layout.menuOpenRatio.set(0);
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

        // switch to top positioning so we can move it
        this.renderer.setStyle(lip, 'top', `${currentTop}px`);
        this.renderer.setStyle(lip, 'bottom', 'auto');

        try { lip.setPointerCapture(event.pointerId); } catch { /* ignore */ }

        const move = (ev: PointerEvent) => {
            if (ev.pointerId !== this.lipPointerId) return;
            const dy = ev.clientY - this.lipStartY;
            const hostHeight = this.elRef.nativeElement.offsetHeight;
            const btnHeight = lip.offsetHeight;
            const minTop = 0;
            const maxTop = Math.max(0, hostHeight - btnHeight);
            const newTop = Math.min(Math.max(this.lipStartTop + dy, minTop), maxTop);
            this.renderer.setStyle(lip, 'top', `${newTop}px`);
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
            this.options.setOption('sidebarLipPosition', lip.style.top);
        };

        // keep the listeners in renderer so Angular can clean them properly
        // use 'window' target for global pointer move/up handling
        this.lipUnlistenMove = this.renderer.listen('window', 'pointermove', move);
        this.lipUnlistenUp = this.renderer.listen('window', 'pointerup', up);
        event.preventDefault();
        event.stopPropagation();
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

}