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


import { Component, signal, computed, type ElementRef, input, output, effect, ChangeDetectionStrategy, viewChild, inject, DestroyRef } from '@angular/core';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';

type SliderThumb = 'min' | 'max' | 'single';
/*
 * Author: Drake
 */
@Component({
    selector: 'range-slider',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './range-slider.component.html',
    styleUrl: './range-slider.component.css',
    host: {
        '(keydown)': 'onKeyDown($event)',
        '(wheel)': 'onWheel($event)'
    }
})
export class RangeSliderComponent {
    private readonly DEBOUNCE_TIME_MS = 150;
    private debounceTimer: any;
    // Softening offset for log scale to avoid huge jumps near the low end.
    // Effectively starts the log curve as if the scale began ~-LOG_OFFSET.
    private readonly LOG_OFFSET = 20;

    min = input.required<number>();
    max = input.required<number>();
    value = input<[number, number]>();
    singleValue = input<number>();
    availableRange = input<[number, number]>();
    interacted = input<boolean>(false);
    curve = input<number>(1); // 1 = linear, >1 = log-like, <1 = exp-like
    stepSize = input<number>(1);
    specialValues = input<readonly number[] | undefined>();
    formatValue = input<((value: number) => string) | undefined>();
    disabled = input<boolean>(false);
    /** Display excluded ranges (values that are filtered OUT) */
    excludeRanges = input<[number, number][] | undefined>();
    /** Display included ranges from semantic filters (highlighted in cyan) */
    includeRanges = input<[number, number][] | undefined>();
    
    valueChange = output<[number, number]>();
    singleValueChange = output<number>();

    left = signal(0);
    right = signal(0);
    dragging = signal<SliderThumb | null>(null);
    focusedThumb = signal<SliderThumb | null>(null);

    isSingleValueMode = computed(() => this.singleValue() !== undefined);
    rightThumbKind = computed<SliderThumb>(() => this.isSingleValueMode() ? 'single' : 'max');

    isLeftThumbActive = computed(() => {
        const [availableMin,] = this.availableRange() ?? [this.min(), this.max()];
        return this.dragging() === 'min' || this.left() > availableMin;
    });

    isRightThumbActive = computed(() => {
        const [, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        return this.dragging() === 'max' || this.right() < availableMax;
    });

    /** Left thumb is clamped: has a set value below the available min */
    isLeftThumbClamped = computed(() => {
        const ranges = this.includeRanges();
        if (!ranges || ranges.length === 0) return false;
        const [availableMin,] = this.availableRange() ?? [this.min(), this.max()];
        // Check if any include range starts below the available min
        return ranges.some(r => r[0] < availableMin);
    });

    /** Right thumb is clamped: has a set value above the available max */
    isRightThumbClamped = computed(() => {
        const ranges = this.includeRanges();
        if (!ranges || ranges.length === 0) return false;
        const [, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        // Check if any include range ends above the available max
        return ranges.some(r => r[1] > availableMax);
    });

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    leftThumbRef = viewChild<ElementRef<HTMLDivElement>>('leftThumb');
    rightThumbRef = viewChild.required<ElementRef<HTMLDivElement>>('rightThumb');

    constructor() {
        // Watch for changes to min, max, or value and update internal signals
        effect(() => {
            if (this.isSingleValueMode()) {
                const val = this.singleValue() ?? this.min();
                this.setSingleValue(val);
                return;
            }

            const val = this.value() ?? [this.min(), this.max()];
            const newLeft = Math.max(this.min(), Math.min(val[0], this.max()));
            const newRight = Math.max(this.min(), Math.min(val[1], this.max()));
            this.left.set(this.alignToStep(newLeft));
            this.right.set(this.alignToStep(newRight));
        });

        inject(DestroyRef).onDestroy(() => {
            clearTimeout(this.debounceTimer);
            // Clean up any active drag listeners
            try {
                const container = this.containerRef()?.nativeElement;
                if (container) {
                    container.removeEventListener('pointermove', this.onDrag);
                    container.removeEventListener('pointerup', this.onDragEnd);
                    container.removeEventListener('pointercancel', this.onDragEnd);
                }
            } catch { /* ignore */ }
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

    private getStepSize(): number {
        const stepRaw = this.stepSize() ?? 1;
        return typeof stepRaw === 'number' && stepRaw > 0 ? stepRaw : 1;
    }

    private normalizeStepValue(value: number): number {
        const step = this.getStepSize();
        if (Number.isInteger(step)) return Math.round(value);
        return Number(value.toFixed(6));
    }

    private getValueStops(): number[] | null {
        const specialValues = this.specialValues()?.filter(value => Number.isFinite(value));
        if (!specialValues || specialValues.length === 0) {
            return null;
        }

        const [min, max] = this.availableRange() ?? [this.min(), this.max()];
        const step = this.getStepSize();
        const stops = new Set<number>([min, max]);
        const start = Math.ceil(min / step) * step;

        for (let value = start; value <= max + Number.EPSILON; value += step) {
            stops.add(this.normalizeStepValue(value));
        }

        for (const value of specialValues) {
            if (value >= min && value <= max) {
                stops.add(value);
            }
        }

        return Array.from(stops).sort((left, right) => left - right);
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

    /**
     * Get the left percentage for a range band visualization.
     * Extends the range by half a step to the left, clamped to min.
     */
    rangeBandLeft(value: number): number {
        const step = this.stepSize();
        const adjusted = Math.max(this.min(), value - step / 2);
        return this.valueToPercent(adjusted);
    }

    /**
     * Get the right percentage for a range band visualization.
     * Extends the range by half a step to the right, clamped to max.
     */
    rangeBandRight(value: number): number {
        const step = this.stepSize();
        const adjusted = Math.min(this.max(), value + step / 2);
        return 100 - this.valueToPercent(adjusted);
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
        const valueStops = this.getValueStops();
        if (valueStops) {
            let nearest = valueStops[0];
            let nearestDistance = Math.abs(value - nearest);
            for (let i = 1; i < valueStops.length; i++) {
                const distance = Math.abs(value - valueStops[i]);
                if (distance < nearestDistance) {
                    nearest = valueStops[i];
                    nearestDistance = distance;
                }
            }
            return nearest;
        }

        const step = this.getStepSize();
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

    private moveValue(value: number, direction: -1 | 1, largeStep: boolean): number {
        const valueStops = this.getValueStops();
        if (!valueStops) {
            const step = this.getStepSize() * (largeStep ? 10 : 1);
            return this.alignToStep(value + direction * step);
        }

        const currentValue = this.alignToStep(value);
        const stepCount = largeStep ? 10 : 1;
        const currentIndex = valueStops.findIndex(stop => Math.abs(stop - currentValue) < 0.000001);
        if (currentIndex === -1) {
            let fallbackIndex = -1;
            if (direction > 0) {
                fallbackIndex = valueStops.findIndex(stop => stop > currentValue);
            } else {
                for (let i = valueStops.length - 1; i >= 0; i--) {
                    if (valueStops[i] < currentValue) {
                        fallbackIndex = i;
                        break;
                    }
                }
            }
            return fallbackIndex === -1 ? currentValue : valueStops[fallbackIndex];
        }

        const nextIndex = Math.max(0, Math.min(valueStops.length - 1, currentIndex + direction * stepCount));
        return valueStops[nextIndex];
    }

    displayValue(value: number): string {
        return this.formatValue()?.(value) ?? FormatNumberPipe.formatValue(value);
    }

    private setSingleValue(value: number) {
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        const clampedValue = Math.max(availableMin, Math.min(availableMax, value));
        this.left.set(this.min());
        this.right.set(this.alignToStep(clampedValue));
    }

    private emitCurrentValue() {
        if (this.isSingleValueMode()) {
            this.singleValueChange.emit(this.right());
            return;
        }

        this.valueChange.emit([this.left(), this.right()]);
    }

    onThumbFocus(which: SliderThumb) {
        this.focusedThumb.set(which);
    }

    onThumbBlur() {
        this.focusedThumb.set(null);
    }

    onKeyDown(event: KeyboardEvent) {
        if (this.disabled()) return;
        const focused = this.focusedThumb();
        if (!focused) return;

        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        let changed = false;

        // ArrowUp/ArrowDown act as "large" steps (x10).
        const isSmallLeft = event.key === 'ArrowLeft';
        const isSmallRight = event.key === 'ArrowRight';
        const isLargeDown = event.key === 'ArrowDown';
        const isLargeUp = event.key === 'ArrowUp';

        if (this.isSingleValueMode()) {
            if (isSmallLeft || isLargeDown || isSmallRight || isLargeUp) {
                const direction = (isSmallLeft || isLargeDown) ? -1 : 1;
                event.preventDefault();
                this.setSingleValue(this.moveValue(this.right(), direction, isLargeDown || isLargeUp));
                this.emitCurrentValue();
            }

            return;
        }

        if (isSmallLeft || isLargeDown) {
            event.preventDefault();
            if (focused === 'min') {
                const newValue = this.alignToStep(Math.max(availableMin, this.moveValue(this.left(), -1, isLargeDown)));
                this.left.set(newValue);
                if (newValue > this.right()) {
                    this.right.set(newValue);
                }
            } else {
                const newValue = this.alignToStep(Math.max(this.left(), this.moveValue(this.right(), -1, isLargeDown)));
                this.right.set(newValue);
            }
            changed = true;
        } else if (isSmallRight || isLargeUp) {
            event.preventDefault();
            if (focused === 'min') {
                const newValue = this.alignToStep(Math.min(this.right(), this.moveValue(this.left(), 1, isLargeUp)));
                this.left.set(newValue);
            } else {
                const newValue = this.alignToStep(Math.min(availableMax, this.moveValue(this.right(), 1, isLargeUp)));
                this.right.set(newValue);
                if (newValue < this.left()) {
                    this.left.set(newValue);
                }
            }
            changed = true;
        }
 
        if (changed) {
            this.emitCurrentValue();
        }
    }
 
    onWheel(event: WheelEvent) {
        if (this.disabled()) return;
        const focused = this.focusedThumb();
        if (!focused) return;
 
        event.preventDefault();
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];
        const notch = event.deltaY > 0 ? -1 : 1;
        let changed = false;

        if (this.isSingleValueMode()) {
            this.setSingleValue(this.moveValue(this.right(), notch as -1 | 1, false));
            this.emitCurrentValue();
            return;
        }
 
        if (focused === 'min') {
            const newValue = this.alignToStep(Math.max(availableMin, Math.min(this.right(), this.moveValue(this.left(), notch as -1 | 1, false))));
            this.left.set(newValue);
             if (notch > 0 && newValue > this.right()) {
                this.right.set(newValue);
             }
             changed = true;
         } else {
            const newValue = this.alignToStep(Math.max(this.left(), Math.min(availableMax, this.moveValue(this.right(), notch as -1 | 1, false))));
            this.right.set(newValue);
             if (notch < 0 && newValue < this.left()) {
                 this.left.set(newValue);
             }
             changed = true;
         }
 
         if (changed) {
             this.emitCurrentValue();
         }
     }

    resetThumb(which: SliderThumb, event: Event) {
        event.preventDefault();
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];

        if (this.isSingleValueMode()) {
            this.setSingleValue(availableMin);
            this.emitCurrentValue();
            return;
        }

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
        this.emitCurrentValue();
    }

    startDrag(which: SliderThumb, event: PointerEvent) {
        if (this.disabled()) return;
        event.preventDefault();
        event.stopPropagation();
        this.dragging.set(which);
        this.focusedThumb.set(which);
        const thumbRef = which === 'min' ? this.leftThumbRef() : this.rightThumbRef();
        const thumbEl = thumbRef?.nativeElement;
        try { thumbEl?.classList.add('dragging'); thumbEl?.focus(); } catch (e) { /* ignore */ }
        const container = this.containerRef().nativeElement as HTMLElement;
        try { container.classList.add('dragging'); } catch (e) { /* ignore */ }

        container.addEventListener('pointermove', this.onDrag);
        container.addEventListener('pointerup', this.onDragEnd);
        container.addEventListener('pointercancel', this.onDragEnd);
        try {
            container.setPointerCapture(event.pointerId);
        } catch (e) { /* ignore */ }
    }

    onDrag = (event: PointerEvent) => {
        if (!this.dragging()) return;
        event.preventDefault();
        clearTimeout(this.debounceTimer);

        const rect = this.containerRef().nativeElement.getBoundingClientRect();
        let percent = (event.clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));

        let value = this.percentToValue(percent);
        const [availableMin, availableMax] = this.availableRange() ?? [this.min(), this.max()];

        if (this.dragging() === 'single') {
            this.setSingleValue(value);
        } else if (this.dragging() === 'min') {
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
            this.emitCurrentValue();
        }, this.DEBOUNCE_TIME_MS);
    };

    onDragEnd = (event: PointerEvent) => {
        clearTimeout(this.debounceTimer);
        if (this.dragging()) {
            this.emitCurrentValue();
        }
        try { (this.containerRef().nativeElement as HTMLElement).classList.remove('dragging'); } catch (e) { /* ignore */ }
        this.dragging.set(null);
        const container = this.containerRef().nativeElement as HTMLElement;
        container.removeEventListener('pointermove', this.onDrag);
        container.removeEventListener('pointerup', this.onDragEnd);
        container.removeEventListener('pointercancel', this.onDragEnd);

        try {
            container.releasePointerCapture(event.pointerId);
        } catch (e) { /* ignore */ }
    };
}