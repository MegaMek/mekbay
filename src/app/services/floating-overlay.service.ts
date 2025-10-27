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

import { afterNextRender, effect, inject, Injectable, Injector } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { FloatingCompInfoComponent } from '../components/floating-comp-info/floating-comp-info.component';
import type { Unit, UnitComponent } from '../models/units.model';

/*
 * Author: Drake
 */
@Injectable({ providedIn: 'root' })
export class FloatingOverlayService {
    private overlay = inject(Overlay);
    private injector = inject(Injector);
    private overlayRef: OverlayRef | null = null;
    private compRef: any = null;
    private isPointerOver = false;
    private hideTimeout: any = null;

    constructor() {
        effect((cleanup) => {
            window.addEventListener('scroll', this.onScroll, true);
            window.addEventListener('wheel', this.onScroll, { capture: true, passive: true });
            window.addEventListener('pointerdown', this.onPointerDown, true);
            cleanup(() => {
                window.removeEventListener('scroll', this.onScroll, true);
                window.removeEventListener('wheel', this.onScroll, { capture: true, passive: true } as AddEventListenerOptions);
                window.removeEventListener('pointerdown', this.onPointerDown, true);
            });
        });
    }

    private onPointerDown = (ev: Event) => {
        if (!this.overlayRef) return;
        const target = ev.target as Node | null;
        if (!target) return;

        try {
            const pane = this.overlayRef.overlayElement;
            if (pane && pane.contains(target)) return;

            const components = document.querySelectorAll('unit-component-item');
            for (const el of Array.from(components)) {
                if (el.contains(target)) return;
            }
        } catch (e) {
            // ignore any DOM errors and fall through to destroy
        }

        this.destroy();
    };

    private onScroll = () => {
        // hide on any scroll operation
        if (this.overlayRef) {
            this.destroy();
        }
    };

    private createPositionStrategy(origin: HTMLElement) {
        return this.overlay.position()
            .flexibleConnectedTo(origin as any)
            .withPositions([
                { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 6, offsetY: 0 },
                { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -6, offsetY: 0 },
            ])
            .withFlexibleDimensions(false)
            .withPush(true);
    }

    private ensureZIndex() {
        if (!this.overlayRef) return;
        try {
            const pane = this.overlayRef.overlayElement;
            pane.style.zIndex = '30000';
            const boundingBox = pane.parentElement as HTMLElement | null;
            if (boundingBox) {
                boundingBox.style.zIndex = '30001';
                boundingBox.style.position = boundingBox.style.position || 'fixed';
            }
        } catch (e) { /* ignore */ }
    }

    show(unit: Unit, comp: UnitComponent | null, origin: HTMLElement) {
        if (!origin) return;
        
        // Cancel any pending hide so quick moves between anchors won't hide the overlay.
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        const positionStrategy = this.createPositionStrategy(origin);

        if (!this.overlayRef) {
            this.overlayRef = this.overlay.create({
                positionStrategy,
                scrollStrategy: this.overlay.scrollStrategies.reposition(),
                hasBackdrop: false,
                panelClass: 'floating-comp-overlay-panel'
            });
        } else {
            this.overlayRef.updatePositionStrategy(positionStrategy);
        }

        if (!this.compRef) {
            const portal = new ComponentPortal(FloatingCompInfoComponent, null, this.injector);
            this.compRef = this.overlayRef.attach(portal);
            // keep overlay open while pointer is over it
            const pane = this.overlayRef.overlayElement;
            pane.addEventListener('pointerenter', () => {
                this.isPointerOver = true;
                // cancel any pending hide while pointer is over the overlay
                if (this.hideTimeout) {
                    clearTimeout(this.hideTimeout);
                    this.hideTimeout = null;
                }
            });
            pane.addEventListener('pointerleave', () => {
                this.isPointerOver = false;
                this.hideWithDelay();
            });
        }
        this.ensureZIndex()

        // update inputs and force CD change check if available
        this.compRef.setInput('unit', unit);
        this.compRef.setInput('comp', comp);

        afterNextRender(() => {
            try { this.overlayRef?.updatePosition(); } catch (e) { /* ignore */ }
        }, { injector: this.injector });
    }

    hideWithDelay(delay = 60) {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }
        this.hideTimeout = setTimeout(() => {
            if (!this.isPointerOver) this.hide();
            this.hideTimeout = null;
        }, delay);
    }

    hide() {
        if (this.compRef) {
            this.compRef.setInput('comp', null);
        }
        this.destroy();
    }

    destroy() {
        if (this.overlayRef) {
            this.overlayRef.dispose();
            this.overlayRef = null;
            this.compRef = null;
            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        }
    }
}