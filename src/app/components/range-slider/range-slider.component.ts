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

import { CommonModule } from '@angular/common';
import { Component, signal, computed, OnDestroy, ElementRef, input, output, effect, ChangeDetectionStrategy, HostListener, viewChild } from '@angular/core';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
/*
 * Author: Drake
 */
@Component({
    selector: 'range-slider',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormatNumberPipe],
    templateUrl: './range-slider.component.html',
    styleUrl: './range-slider.component.css',
})
export class RangeSliderComponent implements OnDestroy {
    private readonly DEBOUNCE_TIME_MS = 250;
    private debounceTimer: any;

    min = input.required<number>();
    max = input.required<number>();
    value = input<[number, number]>();
    availableRange = input<[number, number]>();
    interacted = input<boolean>(false);
    curve = input<number>(1); // 1 = linear, >1 = log-like, <1 = exp-like
    
    valueChange = output<[number, number]>();

    left = signal(0);
    right = signal(0);
    dragging = signal<'min' | 'max' | null>(null);
    focusedThumb = signal<'min' | 'max' | null>(null);

    isLeftThumbActive = computed(() => {
        const [availableMin,] = this.availableRange() ?? [this.min(), this.max()];
        return this.dragging() === 'min' || this.left() > availableMin;
    });

    isRightThumbActive = computed(() => {
        const [, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        return this.dragging() === 'max' || this.right() < availableMax;
    });

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    leftThumbRef = viewChild.required<ElementRef<HTMLDivElement>>('leftThumb');
    rightThumbRef = viewChild.required<ElementRef<HTMLDivElement>>('rightThumb');

    constructor() {
        // Watch for changes to min, max, or value and update internal signals
        effect(() => {
            const val = this.value() ?? [this.min(), this.max()];
            const newLeft = Math.max(this.min(), Math.min(val[0], this.max()));
            const newRight = Math.max(this.min(), Math.min(val[1], this.max()));
            this.left.set(newLeft);
            this.right.set(newRight);
        });
    }

    private get shift() {
        // Shift so that min maps to 0 for log scale
        return -this.min();
    }

    private get logMin() {
        // Always log(0 + 1) = 0
        return 0;
    }

    private get logMax() {
        // log(max shifted + 1)
        return Math.log(this.max() + this.shift + 1);
    }

    valueToPercent(value: number): number {
            if (this.max() === this.min()) return 0;

            // Use log scale if curve == 0
            if (this.curve() == 0) {
                const shifted = value + this.shift;
                const logValue = Math.log(shifted + 1);
                return ((logValue - this.logMin) / (this.logMax - this.logMin)) * 100;
            }

            // Use power curve for curve > 0
            const t = (value - this.min()) / (this.max() - this.min());
            const curved = Math.pow(t, this.curve());
            return curved * 100;
    }

    private percentToValue(percent: number): number {
        // Use log scale if curve == 0
        if (this.curve() == 0) {
            const logValue = this.logMin + percent * (this.logMax - this.logMin);
            const shifted = Math.exp(logValue) - 1;
            const value = shifted - this.shift;
            return Math.round(Math.max(this.min(), Math.min(value, this.max())));
        }

        // Use power curve for curve > 0
        const curved = percent;
        const t = Math.pow(curved, 1 / this.curve());
        const value = this.min() + (this.max() - this.min()) * t;
        return Math.round(Math.max(this.min(), Math.min(value, this.max())));
    }

    formatValue(val: number): string {
        const roundedVal = Math.round(val);
        if (roundedVal >= 1_000_000_000) return `${(roundedVal / 1_000_000_000).toFixed(1)}B`;
        if (roundedVal >= 1_000_000) return `${(roundedVal / 1_000_000).toFixed(1)}M`;
        if (roundedVal >= 10_000) return `${(roundedVal / 1000).toFixed(1)}k`;
        return roundedVal.toString();
    }

    onThumbFocus(which: 'min' | 'max') {
        this.focusedThumb.set(which);
    }

    onThumbBlur() {
        this.focusedThumb.set(null);
    }

    @HostListener('keydown', ['$event'])
    onKeyDown(event: KeyboardEvent) {
        const focused = this.focusedThumb();
        if (!focused) return;

        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        let changed = false;

        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            const stepSize = event.key === 'ArrowDown' ? 10 : 1;
            event.preventDefault();
            if (focused === 'min') {
                const newValue = Math.max(availableMin, this.left() - stepSize);
                this.left.set(newValue);
                if (newValue > this.right()) {
                    this.right.set(newValue);
                }
            } else {
                const newValue = Math.max(this.left(), this.right() - stepSize);
                this.right.set(newValue);
            }
            changed = true;
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            const stepSize = event.key === 'ArrowUp' ? 10 : 1;
            event.preventDefault();
            if (focused === 'min') {
                const newValue = Math.min(this.right(), this.left() + stepSize);
                this.left.set(newValue);
            } else {
                const newValue = Math.min(availableMax, this.right() + stepSize);
                this.right.set(newValue);
                if (newValue < this.left()) {
                    this.left.set(newValue);
                }
            }
            changed = true;
        }

        if (changed) {
            this.valueChange.emit([this.left(), this.right()]);
        }
    }

    @HostListener('wheel', ['$event'])
    onWheel(event: WheelEvent) {
        const focused = this.focusedThumb();
        if (!focused) return;

        event.preventDefault();
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        const delta = event.deltaY > 0 ? -1 : 1;
        let changed = false;

        if (focused === 'min') {
            const newValue = Math.max(availableMin, Math.min(this.right(), this.left() + delta));
            this.left.set(newValue);
            if (delta > 0 && newValue > this.right()) {
                this.right.set(newValue);
            }
            changed = true;
        } else {
            const newValue = Math.max(this.left(), Math.min(availableMax, this.right() + delta));
            this.right.set(newValue);
            if (delta < 0 && newValue < this.left()) {
                this.left.set(newValue);
            }
            changed = true;
        }

        if (changed) {
            this.valueChange.emit([this.left(), this.right()]);
        }
    }

    resetThumb(which: 'min' | 'max', event: Event) {
        event.preventDefault();
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        if (which === 'min') {
            this.left.set(availableMin);
            if (this.left() > this.right()) {
                this.right.set(this.left());
            }
        } else {
            this.right.set(availableMax);
            if (this.right() < this.left()) {
                this.left.set(this.right());
            }
        }
        this.valueChange.emit([this.left(), this.right()]);
    }

    startDrag(which: 'min' | 'max', event: MouseEvent | TouchEvent) {
        event.preventDefault();
        this.dragging.set(which);
        this.focusedThumb.set(which);
        if (which === 'min') {
            this.leftThumbRef().nativeElement.focus();
        } else {
            this.rightThumbRef().nativeElement.focus();
        }
        window.addEventListener('mousemove', this.onDragBound);
        window.addEventListener('touchmove', this.onDragBound, { passive: false });
        window.addEventListener('mouseup', this.onDragEndBound);
        window.addEventListener('touchend', this.onDragEndBound);
    }

    onDrag = (event: MouseEvent | TouchEvent) => {
        if (!this.dragging()) return;
        event.preventDefault();
        clearTimeout(this.debounceTimer);

        const rect = this.containerRef().nativeElement.getBoundingClientRect();
        const clientX = (event instanceof MouseEvent) ? event.clientX : event.touches[0].clientX;
        let percent = (clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));

        let value = this.percentToValue(percent);
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];

        if (this.dragging() === 'min') {
            // Clamp the new value to the available minimum.
            const clampedValue = Math.max(availableMin, value);
            this.left.set(clampedValue);

            // If the left thumb is dragged past the right, push the right thumb.
            if (clampedValue > this.right()) {
                const clampedValue = Math.min(availableMax, value);
                this.right.set(clampedValue);
                this.left.set(clampedValue);
            }
        } else { // dragging 'max'
            // Clamp the new value to the available maximum.
            const clampedValue = Math.min(availableMax, value);
            this.right.set(clampedValue);

            // If the right thumb is dragged past the left, push the left thumb.
            if (clampedValue < this.left()) {
                const clampedValue = Math.max(availableMin, value);
                this.left.set(clampedValue);
                this.right.set(clampedValue);
            }
        }

        this.debounceTimer = setTimeout(() => {
            this.valueChange.emit([this.left(), this.right()]);
        }, this.DEBOUNCE_TIME_MS);
    };
    onDragBound = this.onDrag.bind(this);

    onDragEnd = () => {
        clearTimeout(this.debounceTimer);
        if (this.dragging()) {
            this.valueChange.emit([this.left(), this.right()]);
        }
        this.dragging.set(null);
        window.removeEventListener('mousemove', this.onDragBound);
        window.removeEventListener('touchmove', this.onDragBound);
        window.removeEventListener('mouseup', this.onDragEndBound);
        window.removeEventListener('touchend', this.onDragEndBound);
    };
    onDragEndBound = this.onDragEnd.bind(this);

    ngOnDestroy() {
        clearTimeout(this.debounceTimer);
        this.onDragEnd();
    }
}