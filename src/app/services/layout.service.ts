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

import { Injectable, signal, effect, PLATFORM_ID, inject, computed } from '@angular/core';

/*
 * Author: Drake
 */
@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    /** A signal that is true if the viewport matches mobile breakpoints. */
    private mobileQueryMatches = signal(false);
    public isMobile = computed(() => {
        return  this.mobileQueryMatches() || this.isPortraitOrientation();
    });
    /** A signal representing the open state of the mobile menu. */
    public isMenuOpen = signal(false);
    public isMenuDragging = signal(false);
    public menuOpenRatio = signal(0);
    public isTouchInput = signal(false);
    public activeTouchPoints = signal(0);
    private lastTouchTime = 0;
    public windowWidth = signal(typeof window !== 'undefined' ? window.innerWidth : 1280);
    public windowHeight = signal(typeof window !== 'undefined' ? window.innerHeight : 800);
    public isPortraitOrientation = computed(() => this.windowHeight() > this.windowWidth());

    private readonly platformId: object = inject(PLATFORM_ID);

    constructor() {
        effect((onCleanup) => {
            this.isTouchInput.set(('ontouchstart' in window) || navigator.maxTouchPoints > 0);
            const mediaQuery = window.matchMedia('(max-width: 899.98px)');

            // Initialize current state
            this.mobileQueryMatches.set(mediaQuery.matches);
            
            // Listen for media query changes
            const mediaQueryHandler = (event: MediaQueryListEvent) => {
                this.mobileQueryMatches.set(event.matches);
            };
            
            // Listen for orientation changes
            const resizeHandler = () => {
                this.windowWidth.set(window.innerWidth);
                this.windowHeight.set(window.innerHeight);
            };

            // Global input listeners
            window.addEventListener('touchstart', this.setTouchInput, { passive: true, capture: true });
            window.addEventListener('touchend', this.updateTouchPoints, { passive: true, capture: true });
            window.addEventListener('touchcancel', this.updateTouchPoints, { passive: true, capture: true });
            window.addEventListener('mousedown', this.setMouseInput, { passive: true, capture: true });
            window.addEventListener('orientationchange', resizeHandler, { passive: true, capture: true });
            window.addEventListener('resize', resizeHandler, { passive: true, capture: true });
            mediaQuery.addEventListener('change', mediaQueryHandler);

            onCleanup(() => {
                window.removeEventListener('touchstart', this.setTouchInput, { capture: true });
                window.removeEventListener('touchend', this.updateTouchPoints, { capture: true });
                window.removeEventListener('touchcancel', this.updateTouchPoints, { capture: true });
                window.removeEventListener('mousedown', this.setMouseInput, { capture: true });    
                window.removeEventListener('orientationchange', resizeHandler, { capture: true });
                window.removeEventListener('resize', resizeHandler, { capture: true });
                mediaQuery.removeEventListener('change', mediaQueryHandler);
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
