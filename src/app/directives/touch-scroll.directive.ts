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

import { Directive, ElementRef, inject, input, DestroyRef, NgZone } from '@angular/core';

/**
 * Author: Drake
 * 
 * Programmatic touch-scroll with momentum for containers that use
 * `touch-action: none` (to prevent native scroll from conflicting with
 * CDK drag-drop).
 *
 * Place on the scrollable container alongside `touch-action: none` in CSS.
 * Bind `[touchScrollDisabled]` to a signal that is `true` while CDK drag
 * is active — the directive yields control so CDK owns the gesture.
 *
 * Desktop (mouse-wheel / scrollbar) is completely unaffected because
 * `touch-action` only governs touch input and `overflow-y: auto` is kept.
 *
 * Usage:
 *   <div class="scrollable" touchScroll [touchScrollDisabled]="isDragging()">
 */
@Directive({
    selector: '[touchScroll]',
    standalone: true,
})
export class TouchScrollDirective {
    /** When true, manual touch scrolling is suppressed (e.g. during CDK drag). */
    touchScrollDisabled = input<boolean>(false);

    private el: HTMLElement;
    private zone = inject(NgZone);

    // --- Touch tracking ---
    private tracking = false;
    private lastY = 0;
    private lastTime = 0;

    // Velocity sampling – keep only last ~100 ms of move data
    private velocitySamples: { v: number; t: number }[] = [];

    // --- Momentum animation ---
    private velocity = 0;
    private momentumRafId?: number;
    private readonly FRICTION = 0.96;        // per 16.67 ms frame
    private readonly MIN_VELOCITY = 0.3;     // px/frame threshold to stop

    // Bound handlers for add / removeEventListener
    private handleTouchStart = (e: TouchEvent) => this.onTouchStart(e);
    private handleTouchMove = (e: TouchEvent) => this.onTouchMove(e);
    private handleTouchEnd = () => this.onTouchEnd();

    constructor() {
        this.el = inject(ElementRef<HTMLElement>).nativeElement;

        // Register outside Angular zone — high-frequency events,
        // no signals/CD touched in the hot path.
        this.zone.runOutsideAngular(() => {
            this.el.addEventListener('touchstart', this.handleTouchStart, { passive: true });
            this.el.addEventListener('touchmove', this.handleTouchMove, { passive: true });
            this.el.addEventListener('touchend', this.handleTouchEnd, { passive: true });
            this.el.addEventListener('touchcancel', this.handleTouchEnd, { passive: true });
        });

        inject(DestroyRef).onDestroy(() => {
            this.el.removeEventListener('touchstart', this.handleTouchStart);
            this.el.removeEventListener('touchmove', this.handleTouchMove);
            this.el.removeEventListener('touchend', this.handleTouchEnd);
            this.el.removeEventListener('touchcancel', this.handleTouchEnd);
            this.stopMomentum();
        });
    }

    // ───────── Touch handlers ─────────

    private onTouchStart(e: TouchEvent) {
        this.stopMomentum();
        if (this.touchScrollDisabled()) return;

        this.tracking = true;
        this.lastY = e.touches[0].clientY;
        this.lastTime = performance.now();
        this.velocity = 0;
        this.velocitySamples = [];
    }

    private onTouchMove(e: TouchEvent) {
        if (!this.tracking || this.touchScrollDisabled()) {
            this.tracking = false;
            return;
        }

        const y = e.touches[0].clientY;
        const now = performance.now();
        const dy = this.lastY - y;          // positive = finger moves up = scroll down
        const dt = now - this.lastTime;

        // Apply scroll immediately
        this.el.scrollTop += dy;

        // Track velocity (px / ms)
        if (dt > 0) {
            const v = dy / dt;
            this.velocitySamples.push({ v, t: now });
            // Keep only recent samples
            const cutoff = now - 100;
            this.velocitySamples = this.velocitySamples.filter(s => s.t > cutoff);
        }

        this.lastY = y;
        this.lastTime = now;
    }

    private onTouchEnd() {
        if (!this.tracking) return;
        this.tracking = false;
        if (this.touchScrollDisabled()) return;

        // Average recent velocity samples → px / ms
        if (this.velocitySamples.length < 2) return;
        const avg =
            this.velocitySamples.reduce((sum, s) => sum + s.v, 0) /
            this.velocitySamples.length;

        // Convert to px / frame (@ 60 fps ≈ 16.67 ms)
        this.velocity = avg * 16.67;

        if (Math.abs(this.velocity) > this.MIN_VELOCITY) {
            this.startMomentum();
        }
    }

    // ───────── Momentum loop ─────────

    private startMomentum() {
        let lastTs = performance.now();

        const step = (ts: number) => {
            const dt = Math.min(64, ts - lastTs);   // cap to avoid huge jumps
            lastTs = ts;

            // Time-independent friction
            this.velocity *= Math.pow(this.FRICTION, dt / 16.67);

            if (Math.abs(this.velocity) < this.MIN_VELOCITY) {
                this.stopMomentum();
                return;
            }

            const delta = this.velocity * (dt / 16.67);
            this.el.scrollTop = Math.max(
                0,
                Math.min(
                    this.el.scrollHeight - this.el.clientHeight,
                    this.el.scrollTop + delta,
                ),
            );

            this.momentumRafId = requestAnimationFrame(step);
        };

        this.momentumRafId = requestAnimationFrame(step);
    }

    private stopMomentum() {
        if (this.momentumRafId) {
            cancelAnimationFrame(this.momentumRafId);
            this.momentumRafId = undefined;
        }
        this.velocity = 0;
    }
}
