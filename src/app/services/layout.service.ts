// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { isPlatformBrowser } from '@angular/common';
import { Injectable, signal, effect, PLATFORM_ID, inject, computed, untracked } from '@angular/core';


@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    /** A signal that is true if the viewport matches mobile breakpoints. */
    private readonly PHONE_BREAKPOINT = 500;
    private readonly TABLET_BREAKPOINT = 900;
    private readonly RESIZE_THROTTLE_MS = 150;

    public isMobile = computed(() => {
        return this.isPhone() || this.isTablet();
    });
    public isPhone = computed(() => {
        return this.windowWidth() < this.PHONE_BREAKPOINT;
    });
    public isTablet = computed(() => {
        if (this.isPhone()) { return false; }
        const width = this.windowWidth();
        return width < this.TABLET_BREAKPOINT || this.isPortraitOrientation();
    });
    public isDesktop = computed(() => {
        return !this.isPhone() && !this.isTablet();
    });
    /** A signal representing the open state of the mobile menu. */
    public isMenuOpen = signal(false);
    public isMenuDragging = signal(false);
    public menuOpenRatio = signal(0);
    public isTouchInput = signal(false);
    public windowWidth = signal(typeof window !== 'undefined' ? window.innerWidth : 1280);
    public windowHeight = signal(typeof window !== 'undefined' ? window.innerHeight : 800);
    public isPortraitOrientation = computed(() => this.windowHeight() > this.windowWidth());

    private readonly platformId: object = inject(PLATFORM_ID);
    private resizeTimeout: number | null = null;

    constructor() {
        effect(() => {
            untracked(() => {
                if (this.isDesktop()) {
                    this.isMenuOpen.set(true);
                }
            });
        });
        effect((onCleanup) => {
            if (!isPlatformBrowser(this.platformId)) return;
            this.isTouchInput.set(('ontouchstart' in window) || navigator.maxTouchPoints > 0);
            
            // Throttled resize handler
            const resizeHandler = () => {
                if (this.resizeTimeout !== null) {
                    return; // Already scheduled
                }
                
                this.resizeTimeout = window.setTimeout(() => {
                    const height = window.innerHeight;
                    const width = window.innerWidth;
                    this.windowWidth.set(width);
                    this.windowHeight.set(height);
                    document.body.style.setProperty('--inner-height', `${height}px`);
                    document.body.style.setProperty('--inner-width', `${width}px`);
                    this.resizeTimeout = null;
                }, this.RESIZE_THROTTLE_MS);
            };

            // Global input listeners
            window.addEventListener('pointerdown', this.onPointerDown, { passive: true, capture: true });
            window.addEventListener('orientationchange', resizeHandler, { passive: true, capture: true });
            window.addEventListener('resize', resizeHandler, { passive: true, capture: true });
            resizeHandler();

            onCleanup(() => {
                if (this.resizeTimeout !== null) {
                    clearTimeout(this.resizeTimeout);
                    this.resizeTimeout = null;
                }
                window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
                window.removeEventListener('orientationchange', resizeHandler, { capture: true });
                window.removeEventListener('resize', resizeHandler, { capture: true });
            });
        });

        // Keep menuOpenRatio in sync without triggering extra work while dragging
        effect(() => {
            if (!this.isMenuDragging()) {
                this.menuOpenRatio.set(this.isMenuOpen() ? 1 : 0);
            }
        });

        // Add layout mode classes to document element
        effect((onCleanup) => {
            const classList = document.documentElement.classList;
            classList.toggle('layout-phone', this.isPhone());
            classList.toggle('layout-tablet', this.isTablet());
            classList.toggle('layout-mobile', this.isMobile());
            classList.toggle('layout-desktop', this.isDesktop());

            onCleanup(() => {
                classList.remove('layout-phone', 'layout-tablet', 'layout-mobile', 'layout-desktop');
            });
        });
    }

    /** Toggles the mobile menu's open/closed state. */
    public toggleMenu() {
        this.isMenuOpen.update(isOpen => !isOpen);
    }

    /** Closes the mobile menu. */
    public closeMenu() {
        this.isMenuOpen.set(false);
    }

    /** Opens the mobile menu. */
    public openMenu() {
        this.isMenuOpen.set(true);
    }

    private onPointerDown = (event: PointerEvent) => {
        const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
        this.isTouchInput.set(isTouch);
    };

    public getSafeAreaInsets(): { top: number; bottom: number, left: number; right: number } {
        try {
            const rootStyle = getComputedStyle(document.documentElement);
            const parse = (v: string | null) => {
                if (!v) return 0;
                // value might be like "20px" or "env(...)" unresolved; attempt to parse numeric portion
                const m = v.match(/(-?\d+(\.\d+)?)/);
                return m ? parseFloat(m[0]) : 0;
            };
            const topRaw = rootStyle.getPropertyValue('--safe-area-inset-top') || '';
            const bottomRaw = rootStyle.getPropertyValue('--safe-area-inset-bottom') || '';
            const leftRaw = rootStyle.getPropertyValue('--safe-area-inset-left') || '';
            const rightRaw = rootStyle.getPropertyValue('--safe-area-inset-right') || '';
            return {
                top: parse(topRaw) || 0,
                bottom: parse(bottomRaw) || 0,
                left: parse(leftRaw) || 0,
                right: parse(rightRaw) || 0
            };
        } catch {
            return { top: 0, bottom: 0, left: 0, right: 0 };
        }
    }
}
