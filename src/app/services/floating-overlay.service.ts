// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, DestroyRef, inject, Injectable, Injector } from '@angular/core';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { FloatingCompInfoComponent } from '../components/floating-comp-info/floating-comp-info.component';
import type { UnitSummary, UnitComponent } from '../models/unit-summary.model';


@Injectable({ providedIn: 'root' })
export class FloatingOverlayService {
    private overlay = inject(Overlay);
    private injector = inject(Injector);
    private overlayRef: OverlayRef | null = null;
    private compRef: any = null;
    private isPointerOver = false;
    private hideTimeout: any = null;

    constructor() {
        window.addEventListener('scroll', this.onScroll, true);
        window.addEventListener('wheel', this.onScroll, { capture: true, passive: true });
        window.addEventListener('pointerdown', this.onPointerDown, true);

        inject(DestroyRef).onDestroy(() => {
            window.removeEventListener('scroll', this.onScroll, true);
            window.removeEventListener('wheel', this.onScroll, { capture: true, passive: true } as AddEventListenerOptions);
            window.removeEventListener('pointerdown', this.onPointerDown, true);
        });
    }

    private onPointerDown = (ev: PointerEvent) => {
        if (!this.overlayRef) return;
        const target = ev.target as Node | null;
        if (!target) return;

        try {
            const target = document.elementFromPoint(ev.clientX, ev.clientY) as Element;
            if (!target) return;
            if (target.closest('floating-comp-info')) return;
            if (target.closest('unit-component-item')) return;
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
            .withPush(true)
            .withViewportMargin(6);
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

    show(unit: UnitSummary, comp: UnitComponent | null, origin: HTMLElement) {
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
            pane.addEventListener('pointerleave', (event: PointerEvent) => {
                if (event.pointerType !== 'mouse') return; // only care about mouse pointers
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
