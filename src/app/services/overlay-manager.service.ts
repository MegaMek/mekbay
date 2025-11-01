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

import { Injectable, ElementRef, Injector } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';

/*
 * Author: Drake
 */
type ManagedEntry = {
    overlayRef: OverlayRef;
    clickListener?: (ev: MouseEvent) => void;
    triggerElement?: HTMLElement;
};

@Injectable({ providedIn: 'root' })
export class OverlayManagerService {
    private overlay = inject(Overlay);
    private injector = inject(Injector);
    private document = inject(DOCUMENT) as Document;
    private managed = new Map<string, ManagedEntry>();

    createManagedOverlay<T>(
        key: string,
        target: HTMLElement | ElementRef<HTMLElement>,
        portal: ComponentPortal<T>,
        opts?: {
            positions?: Array<any>,
            hasBackdrop?: boolean,
            backdropClass?: string,
            panelClass?: string,
            scrollStrategy?: any,
            closeOnOutsideClick?: boolean
        }
    ) {
        // close existing with same key first
        this.closeManagedOverlay(key);

        const el = (target as ElementRef<HTMLElement>)?.nativeElement ?? (target as HTMLElement);
        const positionStrategy = this.overlay.position()
            .flexibleConnectedTo(el)
            .withPositions(opts?.positions ?? [
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 }
            ])
            .withPush(true);

        const overlayRef = this.overlay.create({
            positionStrategy,
            scrollStrategy: opts?.scrollStrategy ?? this.overlay.scrollStrategies.close(),
            hasBackdrop: Boolean(opts?.hasBackdrop),
            backdropClass: opts?.backdropClass,
            panelClass: opts?.panelClass ?? undefined
        });

        const compRef = overlayRef.attach(portal);

        const entry: ManagedEntry = { overlayRef };

        if (opts?.hasBackdrop) {
            overlayRef.backdropClick().subscribe(() => this.closeManagedOverlay(key));
        } else if (opts?.closeOnOutsideClick ?? true) {
            const triggerEl = el as HTMLElement;
            const listener = (ev: MouseEvent) => {
                const overlayEl = overlayRef.overlayElement;
                if (!overlayEl) return;
                const clicked = ev.target as Node;
                if (overlayEl.contains(clicked) || (triggerEl && triggerEl.contains && triggerEl.contains(clicked))) {
                    return;
                }
                this.closeManagedOverlay(key);
            };
            this.document.addEventListener('click', listener, true);
            entry.clickListener = listener;
            entry.triggerElement = triggerEl;
        }

        this.managed.set(key, entry);
        return compRef;
    }

    closeManagedOverlay(key: string) {
        const entry = this.managed.get(key);
        if (!entry) return;
        try { entry.overlayRef.dispose(); } catch { /* ignore */ }
        if (entry.clickListener) {
            this.document.removeEventListener('click', entry.clickListener, true);
        }
        entry.triggerElement = undefined;
        this.managed.delete(key);
    }

    has(key: string): boolean {
        return this.managed.has(key);
    }

    closeAllManagedOverlays() {
        for (const key of Array.from(this.managed.keys())) {
            this.closeManagedOverlay(key);
        }
    }
}