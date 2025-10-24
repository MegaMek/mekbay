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
    private readonly DEBOUNCE_TIME_MS = 150;
    private debounceTimer: any;
    // Softening offset for log scale to avoid huge jumps near the low end.
    // Effectively starts the log curve as if the scale began ~-LOG_OFFSET.
    private readonly LOG_OFFSET = 20;

    min = input.required<number>();
    max = input.required<number>();
    value = input<[number, number]>();
    availableRange = input<[number, number]>();
    interacted = input<boolean>(false);
    curve = input<number>(1); // 1 = linear, >1 = log-like, <1 = exp-like
    stepSize = input<number>(1);
    
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
            this.left.set(this.alignToStep(newLeft));
            this.right.set(this.alignToStep(newRight));
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
                // Apply an offset so the log curve doesn't expand the very bottom too much.
                const offset = this.LOG_OFFSET;
                const baseLog = Math.log(offset + 1); // equivalent to starting point
                const maxLog = Math.log(this.max() + this.shift + 1 + offset);
                const logValue = Math.log(value + this.shift + 1 + offset);
                // normalize into 0..100%
                return ((logValue - baseLog) / (maxLog - baseLog)) * 100;
            }

            // Use power curve for curve > 0
            const t = (value - this.min()) / (this.max() - this.min());
            const curved = Math.pow(t, this.curve());
            return curved * 100;
    }

    private percentToValue(percent: number): number {
        // Use log scale if curve == 0
        if (this.curve() == 0) {
            // Inverse of valueToPercent with the same offset applied.
            const offset = this.LOG_OFFSET;
            const baseLog = Math.log(offset + 1);
            const maxLog = Math.log(this.max() + this.shift + 1 + offset);
            const logValue = baseLog + percent * (maxLog - baseLog);
            // exp(logValue)-1 = value + shift + offset  -> subtract offset then shift
            const shifted = Math.exp(logValue) - 1 - offset;
            const value = shifted - this.shift;
            return this.alignToStep(Math.max(this.min(), Math.min(value, this.max())));
        }

        // Use power curve for curve > 0
        const curved = percent;
        const t = Math.pow(curved, 1 / this.curve());
        const value = this.min() + (this.max() - this.min()) * t;
        return this.alignToStep(Math.max(this.min(), Math.min(value, this.max())));
    }

    private alignToStep(value: number): number {
        const [min, max] = this.availableRange() ?? [this.min(), this.max()];
        if (value <= min || value >= max) return value;
        const stepRaw = this.stepSize() ?? 1;
        const step = (typeof stepRaw === 'number' && stepRaw > 0) ? stepRaw : 1;
        // If step is 1, just round to nearest integer for stability
        const steps = Math.round(value / step);
        const aligned = steps * step;
        // Clamp to bounds and avoid floating point noise
        const clamped = Math.max(min, Math.min(max, aligned));
        // If step is an integer, return integer values
        if (Number.isInteger(step)) return Math.round(clamped);
        // For fractional steps, round to reasonable precision
        return Number(clamped.toFixed(6));
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

        // ArrowUp/ArrowDown act as "large" steps (x10).
        const baseStep = this.stepSize?.() ?? 1;
        const isSmallLeft = event.key === 'ArrowLeft';
        const isSmallRight = event.key === 'ArrowRight';
        const isLargeDown = event.key === 'ArrowDown';
        const isLargeUp = event.key === 'ArrowUp';

        if (isSmallLeft || isLargeDown) {
            const step = isLargeDown ? baseStep * 10 : baseStep;
            event.preventDefault();
            if (focused === 'min') {
                const newValue = this.alignToStep(Math.max(availableMin, this.left() - step));
                this.left.set(newValue);
                if (newValue > this.right()) {
                    this.right.set(newValue);
                }
            } else {
                const newValue = this.alignToStep(Math.max(this.left(), this.right() - step));
                this.right.set(newValue);
            }
            changed = true;
        } else if (isSmallRight || isLargeUp) {
            const step = isLargeUp ? baseStep * 10 : baseStep;
            event.preventDefault();
            if (focused === 'min') {
                const newValue = this.alignToStep(Math.min(this.right(), this.left() + step));
                this.left.set(newValue);
            } else {
                const newValue = this.alignToStep(Math.min(availableMax, this.right() + step));
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
        // Wheel moves by configured step size per notch
        const baseStep = this.stepSize?.() ?? 1;
        const notch = event.deltaY > 0 ? -1 : 1;
        const delta = notch * baseStep;
        let changed = false;
 
        if (focused === 'min') {
            const newValue = this.alignToStep(Math.max(availableMin, Math.min(this.right(), this.left() + delta)));
            this.left.set(newValue);
             if (delta > 0 && newValue > this.right()) {
                this.right.set(newValue);
             }
             changed = true;
         } else {
            const newValue = this.alignToStep(Math.max(this.left(), Math.min(availableMax, this.right() + delta)));
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