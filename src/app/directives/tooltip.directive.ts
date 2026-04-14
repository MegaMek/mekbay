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

import { DestroyRef, Directive, ElementRef, HostBinding, Input, inject } from '@angular/core';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { TooltipComponent, type TooltipContent, type TooltipType } from '../components/tooltip/tooltip.component';
import { take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const TOOLTIP_HOST_ATTRIBUTE = 'data-tooltip-host';

@Directive({
    selector: '[tooltip]',
    standalone: true,
})
export class TooltipDirective {
    @Input('tooltip') tooltipContent: TooltipContent | null = null;
    @Input() tooltipType: TooltipType = 'info';
    @Input() tooltipDelay = 400; // ms

    @HostBinding(`attr.${TOOLTIP_HOST_ATTRIBUTE}`)
    get tooltipHostAttribute(): string | null {
        return this.hasTooltipContent() ? '' : null;
    }

    private overlay = inject(Overlay);
    private host = inject(ElementRef<HTMLElement>);
    private destroyRef = inject(DestroyRef);
    private overlayRef: OverlayRef | null = null;
    private showTimeout: any = null;
    private isVisible = false;

    constructor() {
        const el = this.host.nativeElement;

        el.addEventListener('pointerover', this.onPointerOver, { passive: true });
        el.addEventListener('pointerout', this.onPointerOut, { passive: true });
        el.addEventListener('pointerdown', this.onPointerDown, { passive: true });
        el.addEventListener('pointercancel', this.hideImmediate, { passive: true });
    
        this.destroyRef.onDestroy(() => {
            this.clearShowTimeout();
            this.hideImmediate();
            const el = this.host.nativeElement;
            el.removeEventListener('pointerover', this.onPointerOver);
            el.removeEventListener('pointerout', this.onPointerOut);
            el.removeEventListener('pointerdown', this.onPointerDown);
            el.removeEventListener('pointercancel', this.hideImmediate);
        });
    }
    
    private onPointerOver = (ev: PointerEvent) => {
        if (ev.pointerType === 'touch') return;
        if (this.isNestedTooltipTarget(ev.target)) {
            this.clearShowTimeout();
            this.hideImmediate();
            return;
        }
        const related = ev.relatedTarget as Node | null;
        // if coming from inside the host, ignore (it's an internal transition)
        if (related && this.host.nativeElement.contains(related)) return;
        this.queueShow(ev);
    };

    private onPointerDown = (ev: PointerEvent) => {
        if (ev.pointerType === 'touch') {
            if (this.isNestedTooltipTarget(ev.target)) {
                this.clearShowTimeout();
                this.hideImmediate();
                return;
            }
            this.queueShow(ev, 250);
        }
    };

    // pointerout bubbles; ignore internal moves by checking relatedTarget
    private onPointerOut = (ev?: PointerEvent) => {
        if (ev) {
            const related = ev.relatedTarget as Node | null;
            if (related && this.host.nativeElement.contains(related)) return;
        }
        this.clearShowTimeout();
        this.hideImmediate();
    };

    private queueShow(ev: PointerEvent, delayOverride?: number) {
        this.clearShowTimeout();
        const delay = typeof delayOverride === 'number' ? delayOverride : this.tooltipDelay;
        this.showTimeout = setTimeout(() => {
            this.show(ev);
        }, delay);
    }

    private clearShowTimeout() {
        if (this.showTimeout) {
            clearTimeout(this.showTimeout);
            this.showTimeout = null;
        }
    }

    private hasTooltipContent(): boolean {
        return !!this.tooltipContent;
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

    private show(ev: PointerEvent) {
        const tooltipContent = this.tooltipContent;
        if (!tooltipContent) return;
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

        this.overlayRef = this.overlay.create({
            positionStrategy: position,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            hasBackdrop: false,
            panelClass: 'tooltip-panel'
        });

        const portal = new ComponentPortal(TooltipComponent);
        const compRef = this.overlayRef.attach(portal);
        compRef.instance.content = tooltipContent;
        compRef.instance.type = this.tooltipType;
        // ensure OnPush component renders immediately
        compRef.changeDetectorRef.detectChanges();

        this.isVisible = true;

        // hide on pointerdown anywhere (so touch will dismiss) or on detach
        const onDocumentPointerDown = (dEv: PointerEvent) => {
            if (!this.host.nativeElement.contains(dEv.target as Node)) {
                this.hideImmediate();
            }
        };
        document.addEventListener('pointerdown', onDocumentPointerDown, { passive: true });

        // use overlayElement (CDK) rather than hostElement
        const overlayEl = this.overlayRef!.overlayElement;
        overlayEl.addEventListener('pointerdown', this.hideImmediate, { passive: true });

        // cleanup when overlay detaches
        const cleanup = () => {
            document.removeEventListener('pointerdown', onDocumentPointerDown as any);
            overlayEl.removeEventListener('pointerdown', this.hideImmediate as any);
        };
        this.overlayRef!.detachments()
            .pipe(take(1), takeUntilDestroyed(this.destroyRef))
            .subscribe(cleanup);
    }

    private hideImmediate = () => {
        if (this.overlayRef) {
            try {
                this.overlayRef.dispose();
            } catch { /* ignore */ }
            this.overlayRef = null;
        }
        this.isVisible = false;
    };
}