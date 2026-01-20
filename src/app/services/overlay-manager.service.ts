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

import { Injectable, ElementRef, Injector, effect } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import { LayoutService } from './layout.service';

/*
 * Author: Drake
 */
type ManagedEntry = {
    overlayRef: OverlayRef;
    clickListener?: (ev: MouseEvent) => void;
    triggerElement?: HTMLElement;
    resizeObserver?: ResizeObserver;
    mutationObserver?: MutationObserver;
    pointerDownListener?: (ev: PointerEvent) => void;
    pointerUpListener?: (ev: PointerEvent) => void;
    pointerStart?: { id: number | null; x: number; y: number } | null;
    closeAreaElement?: HTMLElement | null;
    closeBlockUntil?: number;
    matchTriggerWidth?: boolean;
    fullHeight?: boolean;
};
// Movement threshold (px) to consider a pointer interaction a "click"
const CLICK_MOVE_THRESHOLD = 10;

@Injectable({ providedIn: 'root' })
export class OverlayManagerService {
    private overlay = inject(Overlay);
    private layoutService = inject(LayoutService);
    private injector = inject(Injector);
    private document = inject(DOCUMENT) as Document;
    private managed = new Map<string, ManagedEntry>();

    // RAF id used to throttle position updates
    private rafId: number | null = null;
    // bound listener so it can be removed
    private onGlobalChange = () => this.schedulePositionUpdate();

    private isCloseBlocked(entry?: ManagedEntry): boolean {
        if (!entry || entry.closeBlockUntil == null) return false;
        const blocked = performance.now() < entry.closeBlockUntil;
        if (!blocked) entry.closeBlockUntil = undefined; // clear once elapsed
        return blocked;
    }

    constructor() {
        effect(() => {
            this.layoutService.windowWidth();
            this.layoutService.windowHeight();
            
            if (this.managed.size > 0) {
                this.schedulePositionUpdate();
            }
        });
    }
    
    /** Public: request a reposition for all managed overlays (safe, throttled). */
    repositionAll() {
        this.schedulePositionUpdate();
    }

    createManagedOverlay<T>(
        key: string,
        target: HTMLElement | ElementRef<HTMLElement> | null,
        portal: ComponentPortal<T>,
        opts?: {
            positions?: Array<any>,
            hasBackdrop?: boolean,
            backdropClass?: string,
            panelClass?: string,
            scrollStrategy?: any,
            closeOnOutsidePointerDown?: boolean,
            closeOnOutsideClick?: boolean,
            closeOnOutsideClickOnly?: boolean,
            sensitiveAreaReferenceElement?: HTMLElement,
            disableCloseForMs?: number,
            matchTriggerWidth?: boolean,
            fullHeight?: boolean,
        }
    ) {
        // close existing with same key first
        this.closeManagedOverlay(key);
        const el = target ? ((target as ElementRef<HTMLElement>)?.nativeElement ?? (target as HTMLElement)) : null;
    
        let positionStrategy;
        
        if (opts?.fullHeight && el) {
            // Full height mode: use global positioning but align horizontally to trigger
            const rect = el.getBoundingClientRect();
            positionStrategy = this.overlay.position()
                .global()
                .left(`${rect.left}px`);
        } else if (el) {
            positionStrategy = this.overlay.position()
                .flexibleConnectedTo(el)
                .withPositions(opts?.positions ?? [
                    { originX: 'end', originY: 'bottom', overlayX: 'end',   overlayY: 'top',    offsetY: 4 },
                    { originX: 'end', originY: 'top',    overlayX: 'end',   overlayY: 'bottom', offsetY: -4 },
                    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top',  offsetY: 4 },
                    { originX: 'start', originY: 'top',    overlayX: 'start', overlayY: 'bottom',offsetY: -4 }
                ])
                .withPush(true)
                .withViewportMargin(4);
        } else {
            positionStrategy = this.overlay.position()
                .global()
                .centerHorizontally()
                .centerVertically();
        }

        const overlayRef = this.overlay.create({
            positionStrategy,
            scrollStrategy: opts?.scrollStrategy ?? this.overlay.scrollStrategies.close(),
            hasBackdrop: Boolean(opts?.hasBackdrop),
            backdropClass: opts?.backdropClass,
            panelClass: opts?.panelClass ?? undefined
        });

        const compRef = overlayRef.attach(portal);

        const entry: ManagedEntry = { overlayRef };

        // Subscribe to detachments to clean up managed entry when overlay is closed externally
        // (e.g., by scroll strategy close)
        overlayRef.detachments().subscribe(() => {
            // Only clean up if the entry still exists and hasn't been cleaned up yet
            if (this.managed.get(key) === entry) {
                // Dispose the overlay if it was detached externally (not already disposed)
                try { overlayRef.dispose(); } catch { /* already disposed */ }
                this.cleanupManagedEntry(key, entry);
            }
        });

        const resolveEl = (v?: HTMLElement | ElementRef<HTMLElement> | null): HTMLElement | null => {
            if (!v) return null;
            // ElementRef-like detection
            // (avoid importing types at top; runtime duck-typing)
            const anyV = v as any;
            if (anyV && anyV.nativeElement) return anyV.nativeElement as HTMLElement;
            return v as HTMLElement;
        };

        entry.closeAreaElement = resolveEl(opts?.sensitiveAreaReferenceElement);
        entry.triggerElement = el ?? undefined;
        entry.matchTriggerWidth = opts?.matchTriggerWidth ?? false;
        entry.fullHeight = opts?.fullHeight ?? false;
        
        // Apply initial width if matchTriggerWidth is enabled
        if (entry.matchTriggerWidth && el) {
            this.updateOverlayWidth(entry);
        }
        
        // Apply full height styling if enabled
        if (entry.fullHeight) {
            this.applyFullHeightStyles(entry);
        }
        
        const blockMs = opts?.disableCloseForMs ?? 100;
        if (blockMs > 0) {
            entry.closeBlockUntil = performance.now() + blockMs;
        }

        if (opts?.hasBackdrop) {
            overlayRef.backdropClick().subscribe(() => {
                if (this.isCloseBlocked(entry)) return;
                this.closeManagedOverlay(key);
            });
        } else if (opts?.closeOnOutsidePointerDown ?? false) {
            const triggerEl = el as HTMLElement;
            const onPointerDown = (ev: PointerEvent) => {
                try {
                    if (this.isCloseBlocked(entry)) return;
                    const overlayEl = overlayRef.overlayElement;
                    const targetNode = ev.target as Node;
                    if (entry.closeAreaElement && !this.areaOverlapping(ev, entry.closeAreaElement)) {
                        return;
                    }
                    // Ignore pointerdown that started inside the overlay or trigger element
                    if (overlayEl?.contains(targetNode) || (triggerEl && triggerEl.contains && triggerEl.contains(targetNode))) {
                        return;
                    }
                    // record start position and pointer id
                    entry.pointerStart = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
                } catch { /* ignore */ }
            };
            // attach listeners capturing phase to detect outside interactions
            this.document.addEventListener('pointerdown', onPointerDown, true);
            // store references for later cleanup
            entry.pointerDownListener = onPointerDown;
            entry.triggerElement = triggerEl;
        } else if (opts?.closeOnOutsideClickOnly ?? false) {
            // Close only for "click-like" pointer interactions (no large movement / swipes)
            const triggerEl = el as HTMLElement;
            
            // Fallback for environments without pointer events: keep the old click behavior
            // We unregister this if a pointerdown listener triggers
            const clickFallback = (ev: MouseEvent) => {
                if (this.isCloseBlocked(entry)) return;
                const overlayEl = overlayRef.overlayElement;
                const clicked = ev.target as Node;
                if (entry.closeAreaElement && !this.areaOverlapping(ev, entry.closeAreaElement)) {
                    return;
                }
                if (overlayEl.contains(clicked) || (triggerEl && triggerEl.contains && triggerEl.contains(clicked))) {
                    return;
                }
                // Stop the event from propagating to prevent triggering other UI elements
                ev.stopPropagation();
                ev.preventDefault();
                this.closeManagedOverlay(key);
            };

            const onPointerDown = (ev: PointerEvent) => {
                try {
                    if (this.isCloseBlocked(entry)) return;
                    if (entry.clickListener) {
                        // remove fallback listener once pointer interaction starts
                        this.document.removeEventListener('click', entry.clickListener, true);
                        entry.clickListener = undefined;
                    }
                    const overlayEl = overlayRef.overlayElement;
                    const targetNode = ev.target as Node;
                    if (entry.closeAreaElement && !this.areaOverlapping(ev, entry.closeAreaElement)) {
                        return;
                    }
                    // Ignore pointerdown that started inside the overlay or trigger element
                    if (overlayEl?.contains(targetNode) || (triggerEl && triggerEl.contains && triggerEl.contains(targetNode))) {
                        return;
                    }
                    // record start position and pointer id
                    entry.pointerStart = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
                } catch { /* ignore */ }
            };
            const onPointerUp = (ev: PointerEvent) => {
                try {
                    if (!entry.pointerStart) return;
                    if (this.isCloseBlocked(entry)) { entry.pointerStart = null; return; }
                    // ensure matching pointer id (or allow - for some devices pointerId may differ; be lenient)
                    // compute movement distance
                    if (entry.closeAreaElement && !this.areaOverlapping(ev, entry.closeAreaElement)) {
                        return;
                    }
                    const dx = ev.clientX - entry.pointerStart.x;
                    const dy = ev.clientY - entry.pointerStart.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq <= (CLICK_MOVE_THRESHOLD * CLICK_MOVE_THRESHOLD)) {
                        // pointer up considered a click -> ensure it occurred outside overlay/trigger before closing
                        const overlayEl = overlayRef.overlayElement;
                        const targetNode = ev.target as Node;
                        if (!overlayEl?.contains(targetNode) && !(triggerEl && triggerEl.contains && triggerEl.contains(targetNode))) {
                            // Stop the event from propagating to prevent triggering other UI elements
                            ev.stopPropagation();
                            ev.preventDefault();
                            this.closeManagedOverlay(key);
                        }
                    }
                } catch { /* ignore */ }
                // clear start state
                entry.pointerStart = null;
            };
            // attach listeners capturing phase to detect outside interactions
            this.document.addEventListener('pointerdown', onPointerDown, true);
            this.document.addEventListener('pointerup', onPointerUp, true);
            // store references for later cleanup
            entry.pointerDownListener = onPointerDown;
            entry.pointerUpListener = onPointerUp;
            this.document.addEventListener('click', clickFallback, true);
            entry.clickListener = clickFallback;
            entry.triggerElement = triggerEl;
        } else if (opts?.closeOnOutsideClick ?? ( opts?.closeOnOutsideClickOnly ? false : true )) {
            const triggerEl = el as HTMLElement;
            const listener = (ev: MouseEvent) => {
                if (this.isCloseBlocked(entry)) return;
                const overlayEl = overlayRef.overlayElement;
                if (!overlayEl) return;
                if (entry.closeAreaElement && !this.areaOverlapping(ev, entry.closeAreaElement)) {
                    return;
                }
                const clicked = ev.target as Node;
                if (overlayEl.contains(clicked) || (triggerEl && triggerEl.contains && triggerEl.contains(clicked))) {
                    return;
                }
                // Stop the event from propagating to prevent triggering other UI elements
                ev.stopPropagation();
                ev.preventDefault();
                this.closeManagedOverlay(key);
            };
            this.document.addEventListener('click', listener, true);
            entry.clickListener = listener;
            entry.triggerElement = triggerEl;
        }

        if (el) {
            // observe element size/attribute changes so overlays reposition when the trigger moves
            try {
                const ro = new ResizeObserver(() => this.schedulePositionUpdate());
                ro.observe(el);
                entry.resizeObserver = ro;
            } catch { /* ResizeObserver may not be available in some test envs */ }
            try {
                const mo = new MutationObserver(() => this.schedulePositionUpdate());
                // watch for style/class changes that commonly indicate a positional transform
                mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
                entry.mutationObserver = mo;
            } catch { /* ignore */ }
        }

        this.managed.set(key, entry);

        // ensure global listeners are active while we have overlays
        this.addGlobalListeners();
        // initial position update to ensure correct placement immediately
        this.schedulePositionUpdate();

        return compRef;
    }
 
    /** Request a reposition for all managed overlays (throttled via RAF). */
    private schedulePositionUpdate() {
        if (this.rafId != null) return;
        this.rafId = window.requestAnimationFrame(() => {
            this.rafId = null;
            this.updateAllPositions();
        });
    }

    /** Invoke updatePosition() on every managed overlayRef. */
    private updateAllPositions() {
        for (const entry of this.managed.values()) {
            try {
                // For fullHeight overlays, we need to update the position strategy
                if (entry.fullHeight && entry.triggerElement) {
                    this.updateFullHeightPosition(entry);
                } else {
                    entry.overlayRef.updatePosition();
                }
                if (entry.matchTriggerWidth) {
                    this.updateOverlayWidth(entry);
                }
            } catch { /* ignore */ }
        }
    }

    /** Update overlay width to match trigger element width */
    private updateOverlayWidth(entry: ManagedEntry) {
        if (!entry.triggerElement) return;
        const width = entry.triggerElement.getBoundingClientRect().width;
        entry.overlayRef.updateSize({ width: `${width}px` });
    }

    /** Update full-height overlay position to stay aligned with trigger horizontally */
    private updateFullHeightPosition(entry: ManagedEntry) {
        if (!entry.triggerElement) return;
        const rect = entry.triggerElement.getBoundingClientRect();
        
        // Update the position strategy
        const positionStrategy = this.overlay.position()
            .global()
            .left(`${rect.left}px`);
        
        entry.overlayRef.updatePositionStrategy(positionStrategy);
        this.applyFullHeightStyles(entry);
    }
    
    /** Apply full height styles to overlay pane element */
    private applyFullHeightStyles(entry: ManagedEntry) {
        const paneElement = entry.overlayRef.overlayElement;
        if (paneElement) {
            paneElement.style.maxHeight = `100vh`;
        }
    }
    /** Add global listeners while overlays exist */
    private addGlobalListeners() {
        // Attach once when the first overlay is added
        if (this.managed.size === 1) {
            window.addEventListener('scroll', this.onGlobalChange, true);
        }
    }

    /** Remove global listeners when no overlays remain */
    private removeGlobalListeners() {
        if (this.managed.size === 0) {
            window.removeEventListener('scroll', this.onGlobalChange, true);
        }
    }

    closeManagedOverlay(key: string) {
        const entry = this.managed.get(key);
        if (!entry) return;
        try { entry.overlayRef.dispose(); } catch { /* ignore */ }
        this.cleanupManagedEntry(key, entry);
    }

    /**
     * Internal cleanup of a managed entry (listeners, observers, etc.).
     * Called by closeManagedOverlay and by detachment subscription.
     */
    private cleanupManagedEntry(key: string, entry: ManagedEntry) {
        if (entry.clickListener) {
            this.document.removeEventListener('click', entry.clickListener, true);
        }
        // remove pointer listeners if present
        if (entry.pointerDownListener) {
            this.document.removeEventListener('pointerdown', entry.pointerDownListener, true);
        }
        if (entry.pointerUpListener) {
            this.document.removeEventListener('pointerup', entry.pointerUpListener, true);
        }
        // disconnect observers
        try { entry.resizeObserver?.disconnect(); } catch { /* ignore */ }
        try { entry.mutationObserver?.disconnect(); } catch { /* ignore */ }
        entry.triggerElement = undefined;
        this.managed.delete(key);

        // if no overlays left, remove global listeners; otherwise schedule update
        if (this.managed.size === 0) {
            this.removeGlobalListeners();
        } else {
            this.schedulePositionUpdate();
        }
    }

    has(key: string): boolean {
        return this.managed.has(key);
    }

    /**
     * Block closing for a specific overlay until the given time.
     * Use Infinity to block indefinitely until unblockClose is called.
     */
    blockCloseUntil(key: string, untilMs: number = Infinity) {
        const entry = this.managed.get(key);
        if (entry) {
            entry.closeBlockUntil = untilMs === Infinity ? Infinity : performance.now() + untilMs;
        }
    }

    /**
     * Unblock closing for a specific overlay.
     */
    unblockClose(key: string) {
        const entry = this.managed.get(key);
        if (entry) {
            entry.closeBlockUntil = undefined;
        }
    }

    /**
     * Close all managed overlays whose key starts with the given prefix.
     */
    closeOverlaysByKeyPrefix(prefix: string) {
        for (const key of Array.from(this.managed.keys())) {
            if (key.startsWith(prefix)) {
                this.closeManagedOverlay(key);
            }
        }
    }

    closeAllManagedOverlays() {
        for (const key of Array.from(this.managed.keys())) {
            this.closeManagedOverlay(key);
        }
        // cleanup listeners and any pending RAF
        if (this.rafId != null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.removeGlobalListeners();
    }
    
    private areaOverlapping(ev: MouseEvent, area: HTMLElement): boolean {
        const rect = area.getBoundingClientRect();
        return ev.clientX >= rect.left && ev.clientX <= rect.right &&
               ev.clientY >= rect.top && ev.clientY <= rect.bottom;
    }

}