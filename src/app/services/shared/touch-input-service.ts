import { Injectable, Signal, signal, WritableSignal, effect, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SidebarService } from './sidebar-service';

@Injectable({
  providedIn: 'root'
})
export class TouchInputService {
  public isMenuDragging = signal(false);
  public menuOpenRatio = signal(0);
  public isTouchInput = signal(false);
  public activeTouchPoints = signal(0);
  private lastTouchTime = 0;

  sidebarService = inject(SidebarService)

  private readonly platformId: object = inject(PLATFORM_ID);

  constructor() {
        this.isTouchInput.set(('ontouchstart' in window) || navigator.maxTouchPoints > 0);
        // Setup browser-only listeners and media query, cleaned up via onCleanup when the service is destroyed.
        effect((onCleanup) => {
            if (!isPlatformBrowser(this.platformId)) return;
            this.isTouchInput.set(('ontouchstart' in window) || navigator.maxTouchPoints > 0);
            // Global input listeners
            window.addEventListener('touchstart', this.setTouchInput, { passive: true, capture: true });
            window.addEventListener('touchend', this.updateTouchPoints, { passive: true, capture: true });
            window.addEventListener('touchcancel', this.updateTouchPoints, { passive: true, capture: true });
            window.addEventListener('mousedown', this.setMouseInput, { passive: true, capture: true });

            onCleanup(() => {
                window.removeEventListener('touchstart', this.setTouchInput, { capture: true });
                window.removeEventListener('touchend', this.updateTouchPoints, { capture: true });
                window.removeEventListener('touchcancel', this.updateTouchPoints, { capture: true });
                window.removeEventListener('mousedown', this.setMouseInput, { capture: true });
            });
        });

        // Keep menuOpenRatio in sync without triggering extra work while dragging
        effect(() => {
            if (!this.isMenuDragging()) {
                this.menuOpenRatio.set(this.sidebarService.isOpen() ? 1 : 0);
            }
        });

        effect(() => {
            document.documentElement.classList.toggle('touch-mode', this.isTouchInput());
        });
    }
    public isSingleTouch(): boolean {
        return this.activeTouchPoints() <= 1;
    }

    public isMultiTouch(): boolean {
        return this.activeTouchPoints() > 1;
    }

    private setTouchInput = (event: TouchEvent) => {
        this.lastTouchTime = Date.now();
        this.isTouchInput.set(true);
        this.activeTouchPoints.set(event.touches.length);
    };

    private updateTouchPoints = (event: TouchEvent) => {
        this.activeTouchPoints.set(event.touches.length);
    };

    private setMouseInput = () => {
        // Ignore mousedown if it occurs within 1000ms of a touchstart
        if (Date.now() - this.lastTouchTime < 1000) return;
        this.isTouchInput.set(false);
        this.activeTouchPoints.set(0);
    };
}
