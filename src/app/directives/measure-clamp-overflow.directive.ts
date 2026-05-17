/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { DestroyRef, Directive, ElementRef, afterNextRender, effect, inject, input, output } from '@angular/core';

/**
 * Author: Drake
 * 
 * This directive measures whether the text content exceeds the specified number of lines within the host element, and emits an event when this overflow state changes. 
 * It uses a hidden clone of the element to perform accurate measurements without affecting layout or performance. 
 * The directive also observes size changes to re-measure as needed.
 * 
 */
@Directive({
    selector: '[measureClampOverflow]',
    standalone: true,
})
export class MeasureClampOverflowDirective {
    readonly text = input('', { alias: 'measureClampOverflow' });
    readonly lineCount = input(2, { alias: 'measureClampOverflowLines' });
    readonly measureClampOverflowChange = output<boolean>();

    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private resizeObserver: ResizeObserver | null = null;
    private measureFrameId: number | null = null;
    private lastOverflowing: boolean | null = null;

    constructor() {
        const afterRenderRef = afterNextRender(() => {
            this.connectResizeObserver();
            this.scheduleMeasure();
        });

        effect(() => {
            this.text();
            this.lineCount();
            this.scheduleMeasure();
        });

        this.destroyRef.onDestroy(() => {
            afterRenderRef.destroy();
            this.resizeObserver?.disconnect();
            if (this.measureFrameId !== null) {
                cancelAnimationFrame(this.measureFrameId);
            }
        });
    }

    private connectResizeObserver(): void {
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        this.resizeObserver?.disconnect();

        try {
            this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
            this.resizeObserver.observe(this.host.nativeElement);
        } catch {
            this.resizeObserver = null;
        }
    }

    private scheduleMeasure(): void {
        if (typeof window === 'undefined') {
            return;
        }

        if (this.measureFrameId !== null) {
            cancelAnimationFrame(this.measureFrameId);
        }

        this.measureFrameId = requestAnimationFrame(() => {
            this.measureFrameId = null;
            this.emitOverflowState(this.measureOverflow());
        });
    }

    private emitOverflowState(isOverflowing: boolean): void {
        if (this.lastOverflowing === isOverflowing) {
            return;
        }

        this.lastOverflowing = isOverflowing;
        this.measureClampOverflowChange.emit(isOverflowing);
    }

    private measureOverflow(): boolean {
        const element = this.host.nativeElement;
        const text = this.text();

        if (!element.isConnected || text.trim().length === 0) {
            return false;
        }

        const width = element.getBoundingClientRect().width;
        if (width <= 0) {
            return false;
        }

        const computedStyle = getComputedStyle(element);
        const lineHeight = this.getLineHeightPx(computedStyle);
        if (lineHeight <= 0) {
            return false;
        }

        const measureEl = element.cloneNode(true) as HTMLElement;
        measureEl.textContent = text;
        measureEl.style.position = 'fixed';
        measureEl.style.top = '0';
        measureEl.style.left = '0';
        measureEl.style.width = `${width}px`;
        measureEl.style.height = 'auto';
        measureEl.style.maxHeight = 'none';
        measureEl.style.minHeight = '0';
        measureEl.style.visibility = 'hidden';
        measureEl.style.pointerEvents = 'none';
        measureEl.style.overflow = 'visible';
        measureEl.style.textOverflow = 'clip';
        measureEl.style.display = 'block';
        measureEl.style.setProperty('-webkit-line-clamp', 'unset');
        measureEl.style.setProperty('-webkit-box-orient', 'initial');

        document.body.appendChild(measureEl);

        const fullHeight = measureEl.getBoundingClientRect().height;
        measureEl.remove();

        return fullHeight > (lineHeight * this.lineCount()) + 0.5;
    }

    private getLineHeightPx(computedStyle: CSSStyleDeclaration): number {
        const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
        if (Number.isFinite(parsedLineHeight)) {
            return parsedLineHeight;
        }

        const fontSize = Number.parseFloat(computedStyle.fontSize);
        if (Number.isFinite(fontSize)) {
            return fontSize * 1.2;
        }

        return 0;
    }
}