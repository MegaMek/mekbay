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

import { Injectable, ElementRef, Injector, effect, ComponentRef } from '@angular/core';
import { GlobalPositionStrategy, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import { Subject, take, takeUntil } from 'rxjs';
import { LayoutService } from './layout.service';

/*
 * Result returned by createManagedOverlay containing the component ref and a closed observable.
 */
export interface ManagedOverlayRef<T> {
    /** The component reference attached to the overlay */
    componentRef: ComponentRef<T>;
    /** Observable that emits once when the overlay is closed/disposed */
    closed: Subject<void>;
}

/*
 * Author: Drake
 */
type ManagedEntry = {
    overlayRef: OverlayRef;
    closed: Subject<void>;
    clickListener?: (ev: MouseEvent) => void;
    triggerElement?: HTMLElement;
    resizeObserver?: ResizeObserver;
    mutationObserver?: MutationObserver;
    contentResizeObserver?: ResizeObserver;
    pointerDownListener?: (ev: PointerEvent) => void;
    pointerUpListener?: (ev: PointerEvent) => void;
    pointerStart?: { id: number | null; x: number; y: number } | null;
    closeAreaElement?: HTMLElement | null;
    closeBlockUntil?: number;
    matchTriggerWidth?: boolean;
    anchorActiveSelector?: string;
    /** Reusable position strategy for anchored-active overlays (avoids allocating a new one per frame). */
    anchorPositionStrategy?: GlobalPositionStrategy;
    /** True after the first anchored-position call has set scrollTop. */
    anchorScrollInitDone?: boolean;
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
    /** Whether global scroll listeners are currently attached. */
    private globalListenersActive = false;

    // RAF id used to throttle position updates
    private rafId: number | null = null;
    // bound listener so it can be removed
    private onGlobalChange = (ev: Event) => {
        // Ignore scroll events originating inside a managed overlay pane
        // (e.g. user scrolling the dropdown list).  Without this guard the
        // reposition logic would fight the user's scroll.
        if (ev.type === 'scroll' && ev.target instanceof HTMLElement) {
            for (const entry of this.managed.values()) {
                if (entry.overlayRef.overlayElement?.contains(ev.target)) return;
            }
        }
        this.schedulePositionUpdate();
    };

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
            anchorActiveSelector?: string,
        }
    ): ManagedOverlayRef<T> {
        // close existing with same key first
        this.closeManagedOverlay(key);
        const el = target ? ((target as ElementRef<HTMLElement>)?.nativeElement ?? (target as HTMLElement)) : null;
    
        let positionStrategy;
        let anchorStrategy: GlobalPositionStrategy | undefined;
        
        if (opts?.anchorActiveSelector && el) {
            // Anchored-active mode: global positioning, managed by updateAnchoredPosition
            anchorStrategy = this.overlay.position().global();
            positionStrategy = anchorStrategy;
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

        const closed = new Subject<void>();
        const entry: ManagedEntry = { overlayRef, closed };
        if (anchorStrategy) entry.anchorPositionStrategy = anchorStrategy;

        // Subscribe to detachments to clean up managed entry when overlay is closed externally
        // (e.g., by scroll strategy close)
        overlayRef.detachments().pipe(take(1)).subscribe(() => {
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
        entry.anchorActiveSelector = opts?.anchorActiveSelector;
        
        // Apply initial width if matchTriggerWidth is enabled
        if (entry.matchTriggerWidth && el) {
            this.updateOverlayWidth(entry);
        }
        
        // Anchored-active mode: initial position + content observer
        if (entry.anchorActiveSelector && el) {
            // Run initial position after a microtask so the component has rendered
            Promise.resolve().then(() => {
                this.updateAnchoredPosition(entry);
                // Observe content size changes (e.g. expanding a details chevron)
                try {
                    const cro = new ResizeObserver(() => this.schedulePositionUpdate());
                    cro.observe(overlayRef.overlayElement);
                    entry.contentResizeObserver = cro;
                } catch { /* ignore */ }
            });
        }
        
        const blockMs = opts?.disableCloseForMs ?? 100;
        if (blockMs > 0) {
            entry.closeBlockUntil = performance.now() + blockMs;
        }

        if (opts?.hasBackdrop) {
            overlayRef.backdropClick().pipe(takeUntil(overlayRef.detachments())).subscribe(() => {
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
                    if (entry.closeAreaElement && !this.isInsideArea(ev, entry.closeAreaElement)) {
                        return;
                    }
                    // Ignore pointerdown that started inside the overlay or trigger element
                    if (overlayEl?.contains(targetNode) || (triggerEl && triggerEl.contains && triggerEl.contains(targetNode))) {
                        return;
                    }
                    // Close immediately on outside pointer-down
                    this.closeManagedOverlay(key);
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
                if (entry.closeAreaElement && !this.isInsideArea(ev, entry.closeAreaElement)) {
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
                    if (entry.closeAreaElement && !this.isInsideArea(ev, entry.closeAreaElement)) {
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
                    if (entry.closeAreaElement && !this.isInsideArea(ev, entry.closeAreaElement)) {
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
                if (entry.closeAreaElement && !this.isInsideArea(ev, entry.closeAreaElement)) {
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
                // Also observe the parent for childList changes so we are notified when
                // the trigger element is removed from the DOM (e.g. Angular *ngIf / route
                // change).  The next position-update cycle will detect isConnected === false
                // and close the overlay gracefully.
                if (el.parentElement) {
                    mo.observe(el.parentElement, { childList: true });
                }
                entry.mutationObserver = mo;
            } catch { /* ignore */ }
        }

        this.managed.set(key, entry);

        // ensure global listeners are active while we have overlays
        this.addGlobalListeners();
        // initial position update to ensure correct placement immediately
        this.schedulePositionUpdate();

        return { componentRef: compRef, closed };
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
        // Collect keys whose trigger elements have been removed from the DOM
        const keysToClose: string[] = [];

        for (const [key, entry] of this.managed.entries()) {
            try {
                // If the trigger element was destroyed / removed from the DOM, schedule
                // the overlay for graceful closure instead of repositioning (which would
                // cause it to jump to 0,0).
                if (entry.triggerElement && !entry.triggerElement.isConnected) {
                    keysToClose.push(key);
                    continue;
                }

                // For anchored-active overlays, recompute position from scratch
                if (entry.anchorActiveSelector && entry.triggerElement) {
                    this.updateAnchoredPosition(entry);
                } else {
                    entry.overlayRef.updatePosition();
                }
                if (entry.matchTriggerWidth) {
                    this.updateOverlayWidth(entry);
                }
            } catch { /* ignore */ }
        }

        // Close overlays whose anchor elements are gone (outside the iteration
        // to avoid mutating the map while iterating).
        for (const key of keysToClose) {
            this.closeManagedOverlay(key);
        }
    }

    /** Update overlay width to match trigger element width */
    private updateOverlayWidth(entry: ManagedEntry) {
        if (!entry.triggerElement) return;
        const width = entry.triggerElement.getBoundingClientRect().width;
        entry.overlayRef.updateSize({ width: `${width}px` });
    }

    /**
     * Position an anchored-active overlay so that the element matching
     * `anchorActiveSelector` aligns vertically with the trigger element's
     * center.  The panel is content-sized with a max-height clamped to the
     * viewport, and scrolled internally when the content overflows.
     */
    private updateAnchoredPosition(entry: ManagedEntry): void {
        const trigger = entry.triggerElement;
        const pane = entry.overlayRef.overlayElement;
        const selector = entry.anchorActiveSelector;
        if (!trigger || !pane || !selector) return;

        const MARGIN = 8;
        const viewportH = window.innerHeight;
        const triggerRect = trigger.getBoundingClientRect();
        const triggerCenterY = triggerRect.top + triggerRect.height / 2;

        // The scrollable content container is the first child of the pane
        // (the component's root element or the panel div).
        const content = pane.firstElementChild as HTMLElement | null;
        const scrollContainer = content
            ? (content.querySelector('[data-scroll-container]') as HTMLElement ?? content)
            : pane;

        const maxPanelH = viewportH - 2 * MARGIN;
        const naturalH = scrollContainer.scrollHeight;
        const effectiveH = Math.min(naturalH, maxPanelH);
        const overflows = naturalH > maxPanelH;

        // Find the active element inside the overlay
        const active = pane.querySelector(selector) as HTMLElement | null;

        // Active item's position relative to the scroll container's content.
        // Use getBoundingClientRect for accuracy regardless of offsetParent chain.
        let activeCenterInContent = 0;
        if (active) {
            const activeRect = active.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            activeCenterInContent = activeRect.top - containerRect.top
                + scrollContainer.scrollTop + activeRect.height / 2;
        }

        let top: number;

        if (!overflows) {
            // Content fits — position so the active item aligns with the trigger
            top = triggerCenterY - activeCenterInContent;
        } else {
            // Content overflows — panel will be viewport-sized.
            // Place it so the trigger center is vertically centred in the panel,
            // then use scrollTop to bring the active item to that position.
            top = triggerCenterY - effectiveH / 2;
        }

        // Clamp to viewport
        if (top < MARGIN) top = MARGIN;
        if (top + effectiveH > viewportH - MARGIN) {
            top = viewportH - MARGIN - effectiveH;
        }
        if (top < MARGIN) top = MARGIN;

        // Update the cached global position strategy (avoids allocating a new one per frame)
        const strategy = entry.anchorPositionStrategy;
        if (!strategy) return;
        strategy.left(`${triggerRect.left}px`).top(`${top}px`);
        entry.overlayRef.updatePosition();

        // Constrain panel height
        scrollContainer.style.maxHeight = `${maxPanelH}px`;
        scrollContainer.style.overflowY = 'auto';

        // Scroll to centre the active item inside the panel —
        // only on the FIRST successful positioning so subsequent user scrolling
        // is preserved.  Guard: only mark done when we actually have scrollable
        // content and an active element, otherwise a premature call (before
        // Angular renders) would lock us out of the real scroll.
        if (!entry.anchorScrollInitDone && active && overflows) {
            entry.anchorScrollInitDone = true;
            // Force reflow so maxHeight constraint is applied before setting scrollTop
            scrollContainer.offsetHeight;
            // Scroll so the active item sits at the vertical position
            // within the panel that lines up with the trigger's centre.
            const targetOffsetInPanel = triggerCenterY - top;
            const desiredScrollTop = activeCenterInContent - targetOffsetInPanel;
            scrollContainer.scrollTop = Math.max(0, desiredScrollTop);
        }
    }
    /** Add global listeners while overlays exist */
    private addGlobalListeners() {
        if (this.globalListenersActive) return;
        this.globalListenersActive = true;
        window.addEventListener('scroll', this.onGlobalChange, true);
    }

    /** Remove global listeners when no overlays remain */
    private removeGlobalListeners() {
        if (!this.globalListenersActive) return;
        this.globalListenersActive = false;
        window.removeEventListener('scroll', this.onGlobalChange, true);
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
        // Emit closed signal to notify subscribers
        if (!entry.closed.closed) {
            entry.closed.next();
            entry.closed.complete();
        }
        
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
        try { entry.contentResizeObserver?.disconnect(); } catch { /* ignore */ }
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
    
    /** Check whether the pointer event landed inside the given element's bounding box. */
    private isInsideArea(ev: MouseEvent, area: HTMLElement): boolean {
        const rect = area.getBoundingClientRect();
        return ev.clientX >= rect.left && ev.clientX <= rect.right &&
               ev.clientY >= rect.top && ev.clientY <= rect.bottom;
    }

}