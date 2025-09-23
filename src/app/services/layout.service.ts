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

import { Injectable, signal, effect, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/*
 * Author: Drake
 */
@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    /** A signal that is true if the viewport matches mobile breakpoints. */
    public isMobile = signal(false);
    public isTiny = signal(false);
    /** A signal representing the open state of the mobile menu. */
    public isMenuOpen = signal(false);
    public isMenuDragging = signal(false);
    public menuOpenRatio = signal(0);
    public isTouchInput = signal(false);
    public activeTouchPoints = signal(0);
    private lastTouchTime = 0;

    private readonly platformId: object = inject(PLATFORM_ID);

    constructor() {
        // Setup browser-only listeners and media query, cleaned up via onCleanup when the service is destroyed.
        effect((onCleanup) => {
            if (!isPlatformBrowser(this.platformId)) return;

            // This media query combines the CDK's Breakpoints.XSmall and Breakpoints.Small
            // (max-width: 599.98px) OR (min-width: 600px) and (max-width: 959.98px)
            // which simplifies to (max-width: 959.98px)
            const mobileQuery = '(max-width: 959.98px)';
            const mobileQueryList = window.matchMedia(mobileQuery);

            const tinyQuery = '(max-width: 599.98px)';
            const tinyQueryList = window.matchMedia(tinyQuery);

            // Initial values
            this.isMobile.set(mobileQueryList.matches);
            this.isTiny.set(tinyQueryList.matches);
            this.isTouchInput.set(('ontouchstart' in window) || navigator.maxTouchPoints > 0);

            // Media query change listener
            const mobileQueryListener = (event: MediaQueryListEvent) => {
                this.isMobile.set(event.matches);
            };
            mobileQueryList.addEventListener('change', mobileQueryListener);

            const tinyQueryListener = (event: MediaQueryListEvent) => {
                this.isTiny.set(event.matches);
            };
            tinyQueryList.addEventListener('change', tinyQueryListener);

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
                if (mobileQueryList && mobileQueryListener) {
                    mobileQueryList.removeEventListener('change', mobileQueryListener);
                }
                if (tinyQueryList && tinyQueryListener) {
                    tinyQueryList.removeEventListener('change', tinyQueryListener);
                }
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