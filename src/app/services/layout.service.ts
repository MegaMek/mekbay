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

import { isPlatformBrowser } from '@angular/common';
import { Injectable, signal, effect, PLATFORM_ID, inject, computed } from '@angular/core';

/*
 * Author: Drake
 */
@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    /** A signal that is true if the viewport matches mobile breakpoints. */
    private readonly PHONE_BREAKPOINT = 600;
    private readonly TABLET_BREAKPOINT = 900

    public isMobile = computed(() => {
        return  this.windowWidth() < this.PHONE_BREAKPOINT || this.isPortraitOrientation();
    });
    public viewportCategory = computed(() => {
        const width = this.windowWidth();
        if (width < this.PHONE_BREAKPOINT) {
            return 'phone';
        } else if (width < this.TABLET_BREAKPOINT) {
            return 'tablet';
        } else {
            return 'desktop';
        }
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

    constructor() {
        effect((onCleanup) => {
            if (!isPlatformBrowser(this.platformId)) return;
            this.isTouchInput.set(('ontouchstart' in window) || navigator.maxTouchPoints > 0);
            
            // Listen for orientation changes
            const resizeHandler = () => {
                const height = window.innerHeight;
                const width = window.innerWidth;
                this.windowWidth.set(width);
                this.windowHeight.set(height);
                document.body.style.setProperty('--inner-height', `${height}px`);
                document.body.style.setProperty('--inner-width', `${width}px`);
            };

            // Global input listeners
            window.addEventListener('pointerdown', this.onPointerDown, { passive: true, capture: true });
            window.addEventListener('orientationchange', resizeHandler, { passive: true, capture: true });
            window.addEventListener('resize', resizeHandler, { passive: true, capture: true });
            resizeHandler();

            onCleanup(() => {
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

        effect(() => {
            document.documentElement.classList.toggle('touch-mode', this.isTouchInput());
        });
        effect(() => {
            document.documentElement.classList.toggle('mobile-mode', this.isMobile());
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
