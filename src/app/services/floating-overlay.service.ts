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
import { InspectorInteraction } from '../components/floating-comp-info/inspector-interaction';


@Injectable({ providedIn: 'root' })
export class FloatingOverlayService {
    private overlay = inject(Overlay);
    private dialog = inject(Dialog);
    private layout = inject(LayoutService);
    private injector = inject(Injector);
    private dialogRef: DialogRef<void, FloatingCompInfoComponent> | null = null;
    private overlayRef: OverlayRef | null = null;
    private compRef: ComponentRef<FloatingCompInfoComponent> | null = null;
    readonly inspector = new InspectorInteraction(() => this.dispose());

    constructor() {
        effect(() => {
            if (this.layout.isPhone() && this.overlayRef) this.hide();
        });
        window.addEventListener('scroll', this.onScroll, true);
        window.addEventListener('wheel', this.onScroll, { capture: true, passive: true });
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('keydown', this.onKeyDown, true);

        inject(DestroyRef).onDestroy(() => {
            window.removeEventListener('scroll', this.onScroll, true);
            window.removeEventListener('wheel', this.onScroll, { capture: true, passive: true } as AddEventListenerOptions);
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            window.removeEventListener('keydown', this.onKeyDown, true);
            this.hide();
        });
    }

    private onPointerDown = (ev: PointerEvent) => {
        if (this.overlayRef) this.inspector.closeOutside(ev.target, this.overlayRef.overlayElement);
    };

    private onScroll = (event: Event) => {
        if (event.target instanceof Node && this.overlayRef?.overlayElement.contains(event.target)) return;
        this.inspector.cancelHover();
        // hide on any scroll operation
        if (this.overlayRef) {
            this.hide();
        }
    };

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !this.overlayRef) return;
        event.stopPropagation();
        this.hide();
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

    show(unit: UnitSummary, comp: UnitComponent | null, origin: HTMLElement, byHover = false) {
        if (!comp) return;
        if (byHover && (this.layout.isPhone() || this.inspector.isPinned())) return;

        if (this.layout.isPhone()) {
            this.hide();
            this.inspector.open(origin);
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
                if (this.dialogRef === ref) {
                    this.dialogRef = null;
                    this.inspector.close();
                }
            });
            return;
        }

        this.dialogRef?.close();
        this.inspector.open(origin, byHover);

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
            pane.addEventListener('pointerenter', (event: PointerEvent) => {
                if (event.pointerType === 'mouse') this.inspector.enter();
            });
            pane.addEventListener('pointerleave', (event: PointerEvent) => {
                if (event.pointerType === 'mouse') this.inspector.leave();
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

    hide() {
        this.inspector.close();
    }

    private dispose() {
        this.dialogRef?.close();
        this.dialogRef = null;
        this.overlayRef?.dispose();
        this.overlayRef = null;
        this.compRef = null;
    }
}
