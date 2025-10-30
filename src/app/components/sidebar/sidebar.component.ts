import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, computed, input } from '@angular/core';
import { Portal, PortalModule } from '@angular/cdk/portal';
import { LayoutService } from '../../services/layout.service';
import { UnitSearchComponent } from '../unit-search/unit-search.component';

/*
 * Main Sidebar component
 *
 */
@Component({
    selector: 'sidebar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, PortalModule],
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
    private readonly COLLAPSED_WIDTH = 80;
    private readonly EXPANDED_WIDTH = 300;
    layout = inject(LayoutService);
    unitSearchPortal = input<Portal<any>>();
    unitSearchComponent = input<UnitSearchComponent>();

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
        if (typeof window === 'undefined') { return 350; }
        const w = Math.min(window.innerWidth * 0.9, 350);
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
            if (this.isPhone()) {
                offset = 0;
            } else if (this.isTablet()) {
                offset = this.COLLAPSED_WIDTH;
            } else {
                // desktop: use computed dock width (150 collapsed / 300 expanded)
                offset = this.desktopDockWidth();
            }
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
    }

    // Toggle button logic (tablet + desktop share the button)
    public onToggleButtonClick() {
        this.isPhone();
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
        (ev.target as Element)?.setPointerCapture?.(ev.pointerId);

        this.startDrag(ev);
    }

    // PHONE: allow starting a drag from the open drawer to swipe it closed
    public onPhoneDrawerPointerDown(ev: PointerEvent) {
        if (!this.isPhone()) { return; }
        if (ev.isPrimary === false) { return; }

        // only start drag when the drawer is at least slightly open (prevents accidental captures when fully closed)
        const currentRatio = this.layout.menuOpenRatio();
        if (currentRatio <= 0.01 && !this.layout.isMenuOpen()) { return; }

        ev.preventDefault();
        (ev.target as Element)?.setPointerCapture?.(ev.pointerId);

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
        const target = startEvent.target as Element | null;
        try { target?.setPointerCapture?.(startEvent.pointerId); } catch { /* ignore */ }
        let gestureDecided = false;
        let gestureIsHorizontal = false;

        const move = (ev: PointerEvent) => {
            if (ev.pointerId !== this.activePointerId) { return; }
            const dx = ev.clientX - this.startX;
            const dy = ev.clientY - this.startY;
            // decide gesture direction once (wait for a small noise threshold)
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
                // release pointer capture for active pointer on document elements if possible
                const el = document.elementFromPoint(this.startX, 10);
                (el as Element)?.releasePointerCapture?.(this.activePointerId!);
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

}