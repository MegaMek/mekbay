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

import { Directive, HostListener, input, effect, output, ElementRef, inject } from '@angular/core';

@Directive({
    selector: '[longPress]',
    standalone: true
})
export class LongPressDirective {
    longPressDuration = input<number>(300); // ms
    longPress = output<PointerEvent>();
    shortPress = output<MouseEvent>();
    
    private longPressed = false;
    private el = inject(ElementRef<HTMLElement>);
    private timeoutId: any;
    private startX = 0;
    private startY = 0;
    private pointerId?: number;
    private readonly MOVE_THRESHOLD = 10; // px
    private pointerDownEvent: PointerEvent | null = null;
    private disableNextClick = false;

    constructor() {
        effect((cleanup) => {
            cleanup(() => this.clearTimer());
        });
    }

    @HostListener('pointerdown', ['$event'])
    onPointerDown(event: PointerEvent) {
        // Only left button
        if (event.button && event.button !== 0) return;
    
        try { event.preventDefault(); } catch (e) { /* ignore */ }
    
        this.longPressed = false;
        this.clearTimer();
        this.startX = event.clientX;
        this.startY = event.clientY;
        this.pointerId = event.pointerId;
        this.pointerDownEvent = event;
        this.disableNextClick = false;

        try {
            (event.target as HTMLElement).setPointerCapture(this.pointerId);
        } catch (e) { /* ignore */ }

        this.timeoutId = setTimeout(() => {
            this.clearTimer();
            this.longPressed = true;
            this.longPress.emit(event);
            this.disableNextClick = true;
        }, this.longPressDuration());
    }

    @HostListener('pointermove', ['$event'])
    onPointerMove(event: PointerEvent) {
        if (!this.timeoutId) return;
        const dx = event.clientX - this.startX;
        const dy = event.clientY - this.startY;
        if (Math.hypot(dx, dy) > this.MOVE_THRESHOLD) {
            this.clearTimer();
        }
    }

    @HostListener('pointerup', ['$event'])
    onPointerUp(event: PointerEvent) {
        this.clearTimer();
    }

    @HostListener('click', ['$event'])
    onClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (this.disableNextClick) {
            this.disableNextClick = false;
            return;
        }
        if (!this.longPressed) {
            this.shortPress.emit(event);
        }
    }

    @HostListener('contextmenu', ['$event'])
    onContextMenu(event: PointerEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (event.pointerType !== 'mouse') return;
        if (!this.timeoutId) {
            this.longPressed = true;
            this.longPress.emit(this.pointerDownEvent!);
            this.clearTimer();
        }
    }

    @HostListener('pointercancel')
    onPointerCancel() {
        this.clearTimer();
    }

    private clearTimer() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        try {
            if (this.pointerId != null) {
                this.el.nativeElement.releasePointerCapture(this.pointerId);
            }
        } catch (e) { /* ignore */ }
        this.pointerId = undefined;
    }
}