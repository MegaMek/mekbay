// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, DestroyRef, effect, inject, Injectable, Injector, inputBinding, type ComponentRef } from '@angular/core';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { FloatingCompInfoComponent } from '../components/floating-comp-info/floating-comp-info.component';
import type { UnitSummary, UnitComponent } from '../models/unit-summary.model';
import { LayoutService } from './layout.service';


@Injectable({ providedIn: 'root' })
export class FloatingOverlayService {
    private overlay = inject(Overlay);
    private dialog = inject(Dialog);
    private layout = inject(LayoutService);
    private injector = inject(Injector);
    private dialogRef: DialogRef<void, FloatingCompInfoComponent> | null = null;
    private overlayRef: OverlayRef | null = null;
    private compRef: ComponentRef<FloatingCompInfoComponent> | null = null;
    private isPointerOver = false;
    private hideTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        effect(() => {
            if (this.layout.isPhone() && this.overlayRef) this.destroy();
        });
        window.addEventListener('scroll', this.onScroll, true);
        window.addEventListener('wheel', this.onScroll, { capture: true, passive: true });
        window.addEventListener('pointerdown', this.onPointerDown, true);

        inject(DestroyRef).onDestroy(() => {
            window.removeEventListener('scroll', this.onScroll, true);
            window.removeEventListener('wheel', this.onScroll, { capture: true, passive: true } as AddEventListenerOptions);
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            this.destroy();
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
            .flexibleConnectedTo(origin)
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
        if (!comp) return;

        if (this.layout.isPhone()) {
            this.destroy();
            const ref = this.dialog.open<void, unknown, FloatingCompInfoComponent>(FloatingCompInfoComponent, {
                bindings: [inputBinding('unit', () => unit), inputBinding('comp', () => comp)],
                ariaLabel: `Component inspector: ${comp.n}`,
                ariaModal: true,
                width: 'calc(100vw - 24px)',
                maxWidth: '340px',
                maxHeight: 'calc(100dvh - 24px)',
                autoFocus: '.inspector-close',
                restoreFocus: origin,
            });
            this.dialogRef = ref;
            ref.closed.subscribe(() => {
                if (this.dialogRef === ref) this.dialogRef = null;
            });
            return;
        }

        this.dialogRef?.close();
        
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
        if (this.dialogRef) return;
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
        this.dialogRef?.close();
        this.dialogRef = null;
        this.overlayRef?.dispose();
        this.overlayRef = null;
        this.compRef = null;
        this.isPointerOver = false;
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }
}
