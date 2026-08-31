// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, Directive, ElementRef, computed, inject, input } from '@angular/core';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { TooltipComponent, type TooltipContent, type TooltipType } from '../components/tooltip/tooltip.component';
import { take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const TOOLTIP_HOST_ATTRIBUTE = 'data-tooltip-host';
const TOUCH_HOLD_DELAY = 300;
const MOUSE_LOCK_DELAY = 2000;

@Directive({
    selector: '[tooltip]',
    host: {
        '[attr.data-tooltip-host]': 'hasTooltipContent() ? "" : null',
    },
})
export class TooltipDirective {
    readonly tooltipContent = input<TooltipContent | null>(null, { alias: 'tooltip' });
    readonly tooltipType = input<TooltipType>('info');
    readonly tooltipDelay = input(400); // ms
    readonly hasTooltipContent = computed(() => {
        const content = this.tooltipContent();
        return typeof content === 'string' ? content.length > 0 : (content?.length ?? 0) > 0;
    });

    private readonly overlay = inject(Overlay);
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private overlayRef: OverlayRef | null = null;
    private showTimeout: ReturnType<typeof setTimeout> | null = null;
    private lockTimeout: ReturnType<typeof setTimeout> | null = null;
    private isVisible = false;
    private isMouseLocked = false;

    constructor() {
        const el = this.host.nativeElement;

        el.addEventListener('pointerover', this.onPointerOver, { passive: true });
        el.addEventListener('pointerout', this.onPointerOut, { passive: true });
        el.addEventListener('pointerdown', this.onPointerDown, { passive: true });
        el.addEventListener('pointerup', this.onPointerUp, { passive: true });
        el.addEventListener('pointercancel', this.hideImmediate, { passive: true });
    
        this.destroyRef.onDestroy(() => {
            this.hideImmediate();
            const el = this.host.nativeElement;
            el.removeEventListener('pointerover', this.onPointerOver);
            el.removeEventListener('pointerout', this.onPointerOut);
            el.removeEventListener('pointerdown', this.onPointerDown);
            el.removeEventListener('pointerup', this.onPointerUp);
            el.removeEventListener('pointercancel', this.hideImmediate);
        });
    }
    
    private onPointerOver = (ev: PointerEvent) => {
        if (ev.pointerType === 'touch') return;
        if (this.isNestedTooltipTarget(ev.target)) {
            this.hideImmediate();
            return;
        }
        const related = ev.relatedTarget as Node | null;
        // if coming from inside the host, ignore (it's an internal transition)
        if (related && this.host.nativeElement.contains(related)) return;
        this.queueShow(this.tooltipDelay(), ev.pointerType === 'mouse');
    };

    private onPointerDown = (ev: PointerEvent) => {
        if (ev.pointerType !== 'touch') return;
        if (this.isNestedTooltipTarget(ev.target)) {
            this.hideImmediate();
            return;
        }
        this.queueShow(TOUCH_HOLD_DELAY, false);
    };

    private onPointerUp = (ev: PointerEvent) => {
        if (ev.pointerType !== 'touch') return;
        if (this.isNestedTooltipTarget(ev.target)) {
            this.hideImmediate();
            return;
        }
        this.clearShowTimeout();
        this.show(false);
    };

    // pointerout bubbles; ignore internal moves by checking relatedTarget
    private onPointerOut = (ev: PointerEvent) => {
        if (ev.pointerType === 'touch') return;
        const related = ev.relatedTarget as Node | null;
        if (related && this.host.nativeElement.contains(related)) return;
        this.clearShowTimeout();
        if (this.isMouseLocked) return;
        this.hideImmediate();
    };

    private queueShow(delay: number, lockOnHover: boolean) {
        this.clearShowTimeout();
        this.showTimeout = setTimeout(() => {
            this.showTimeout = null;
            this.show(lockOnHover);
        }, delay);
    }

    private clearShowTimeout() {
        if (this.showTimeout) {
            clearTimeout(this.showTimeout);
            this.showTimeout = null;
        }
    }

    private clearLockTimeout() {
        if (this.lockTimeout) {
            clearTimeout(this.lockTimeout);
            this.lockTimeout = null;
        }
    }

    private isNestedTooltipTarget(target: EventTarget | null): boolean {
        const targetElement = this.getTargetElement(target);
        if (!targetElement) return false;

        const nearestTooltipHost = targetElement.closest(`[${TOOLTIP_HOST_ATTRIBUTE}]`);
        return !!nearestTooltipHost && nearestTooltipHost !== this.host.nativeElement;
    }

    private getTargetElement(target: EventTarget | null): Element | null {
        if (!target) return null;
        if (target instanceof Element) return target;
        if (target instanceof Node) return target.parentElement;
        return null;
    }

    private show(lockOnHover: boolean) {
        const tooltipContent = this.tooltipContent();
        if (!this.hasTooltipContent() || tooltipContent === null) return;
        if (this.isVisible) return;

        // create overlay positioned relative to host native element
        const position = this.overlay.position()
            .flexibleConnectedTo(this.host.nativeElement)
            .withPositions([
                {
                    originX: 'center',
                    originY: 'top',
                    overlayX: 'center',
                    overlayY: 'bottom',
                    offsetY: -8
                },
                {
                    originX: 'center',
                    originY: 'bottom',
                    overlayX: 'center',
                    overlayY: 'top',
                    offsetY: 8
                },
                {
                    originX: 'start',
                    originY: 'top',
                    overlayX: 'start',
                    overlayY: 'bottom',
                    offsetY: -8
                },
                {
                    originX: 'end',
                    originY: 'top',
                    overlayX: 'end',
                    overlayY: 'bottom',
                    offsetY: -8
                },
                {
                    originX: 'start',
                    originY: 'bottom',
                    overlayX: 'start',
                    overlayY: 'top',
                    offsetY: 8
                },
                {
                    originX: 'end',
                    originY: 'bottom',
                    overlayX: 'end',
                    overlayY: 'top',
                    offsetY: 8
                }
            ])
            .withFlexibleDimensions(true)
            .withGrowAfterOpen(true)
            .withPush(true)
            .withViewportMargin(12);

        const overlayRef = this.overlay.create({
            positionStrategy: position,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            hasBackdrop: false,
            panelClass: 'tooltip-panel'
        });
        this.overlayRef = overlayRef;

        const portal = new ComponentPortal(TooltipComponent);
        const compRef = overlayRef.attach(portal);
        compRef.setInput('content', tooltipContent);
        compRef.setInput('type', this.tooltipType());
        compRef.setInput('lockProgressDuration', lockOnHover ? MOUSE_LOCK_DELAY : 0);

        this.isVisible = true;
        this.isMouseLocked = false;
        if (lockOnHover) {
            this.lockTimeout = setTimeout(() => {
                this.lockTimeout = null;
                this.isMouseLocked = true;
            }, MOUSE_LOCK_DELAY);
        }

        const overlayEl = overlayRef.overlayElement;
        const onDocumentPointerDown = (dEv: PointerEvent) => {
            const target = dEv.target as Node;
            if (!this.host.nativeElement.contains(target) && !overlayEl.contains(target)) {
                this.hideImmediate();
            }
        };
        document.addEventListener('pointerdown', onDocumentPointerDown, { passive: true });

        // cleanup when overlay detaches
        const cleanup = () => {
            document.removeEventListener('pointerdown', onDocumentPointerDown);
        };
        overlayRef.detachments()
            .pipe(take(1), takeUntilDestroyed(this.destroyRef))
            .subscribe(cleanup);
    }

    private hideImmediate = () => {
        this.clearShowTimeout();
        this.clearLockTimeout();
        if (this.overlayRef) {
            try {
                this.overlayRef.dispose();
            } catch { /* ignore */ }
            this.overlayRef = null;
        }
        this.isVisible = false;
        this.isMouseLocked = false;
    };
}
