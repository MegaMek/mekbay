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

import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    input,
    output,
    viewChild,
    type ElementRef
} from '@angular/core';

@Component({
    selector: 'hex-slider',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './hex-slider.component.html',
    styleUrl: './hex-slider.component.scss'
})
export class HexSliderComponent {
    private readonly condensedTickThreshold = 12;
    private readonly destroyRef = inject(DestroyRef);
    private readonly sliderScale = viewChild<ElementRef<HTMLDivElement>>('sliderScale');
    private activePointerId: number | null = null;
    private activeDragTarget: Element | null = null;

    readonly min = input<number>(0);
    readonly max = input<number>(100);
    readonly step = input<number>(1);
    readonly value = input<number>(0);
    readonly ticks = input<readonly number[] | null>(null);
    readonly tickLabels = input<readonly string[] | null>(null);
    readonly label = input<string | number | null>(null);
    readonly ariaLabel = input<string>('Value');
    readonly valueAssigned = input<boolean>(false);
    readonly danger = input<boolean>(false);
    readonly compactLabel = input<boolean>(false);

    readonly valueChange = output<number>();

    readonly minValue = computed(() => this.normalizeNumber(this.min(), 0));
    readonly maxValue = computed(() => Math.max(this.minValue(), this.normalizeNumber(this.max(), this.minValue())));
    readonly stepValue = computed(() => Math.max(0.000001, Math.abs(this.normalizeNumber(this.step(), 1))));
    readonly clampedValue = computed(() => this.alignToStep(this.value()));
    readonly valueLabel = computed(() => this.label() ?? `${this.clampedValue()}`);
    readonly valuePercent = computed(() => this.percentForValue(this.clampedValue()));
    readonly displayTicks = computed(() => {
        const explicitTicks = this.ticks();
        if (explicitTicks !== null) {
            return explicitTicks.filter(tick => tick >= this.minValue() && tick <= this.maxValue());
        }

        const min = this.minValue();
        const max = this.maxValue();
        const step = this.stepValue();
        const count = Math.floor((max - min) / step) + 1;
        if (count > 50) return [min, max];
        return Array.from({ length: count }, (_value, index) => this.roundValue(min + index * step));
    });
    readonly condenseTickLabels = computed(() => this.tickLabels() === null && this.displayTicks().length > this.condensedTickThreshold);
    readonly condensedTickInterval = computed(() => this.displayTicks().length >= 30 ? 10 : 5);

    constructor() {
        this.destroyRef.onDestroy(() => this.stopDrag());
    }

    percentForValue(value: number): number {
        const min = this.minValue();
        const max = this.maxValue();
        if (max <= min) return 0;
        return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    }

    tickLabel(tick: number): string {
        const labels = this.tickLabels();
        if (!labels) return this.isCondensedDotTick(tick) ? '•' : `${tick}`;
        const index = this.displayTicks().indexOf(tick);
        return labels[index] ?? `${tick}`;
    }

    isCondensedDotTick(tick: number): boolean {
        if (!this.condenseTickLabels()) return false;
        return !this.isMajorCondensedTick(tick);
    }

    startDrag(event: PointerEvent): void {
        event.preventDefault();
        this.stopDrag();
        this.activePointerId = event.pointerId;
        this.activeDragTarget = event.target instanceof Element ? event.target : null;
        try {
            this.activeDragTarget?.setPointerCapture(this.activePointerId);
        } catch { /* ignore */ }
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerEnd);
        window.addEventListener('pointercancel', this.onPointerEnd);
        this.updateValueFromPointer(event);
    }

    onKeyDown(event: KeyboardEvent): void {
        const step = this.stepValue();
        let next: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = this.clampedValue() + step;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = this.clampedValue() - step;
        if (event.key === 'PageUp') next = this.clampedValue() + step * 5;
        if (event.key === 'PageDown') next = this.clampedValue() - step * 5;
        if (event.key === 'Home') next = this.minValue();
        if (event.key === 'End') next = this.maxValue();
        if (next === null) return;

        event.preventDefault();
        this.emitValue(this.alignToStep(next));
    }

    private onPointerMove = (event: PointerEvent): void => {
        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
        this.updateValueFromPointer(event);
    };

    private onPointerEnd = (event: PointerEvent): void => {
        this.stopDrag(event);
    };

    private updateValueFromPointer(event: PointerEvent): void {
        const scale = this.sliderScale()?.nativeElement;
        if (!scale) return;
        const rect = scale.getBoundingClientRect();
        const percent = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
        const value = this.minValue() + Math.max(0, Math.min(1, percent)) * (this.maxValue() - this.minValue());
        this.emitValue(this.alignToStep(value));
    }

    private stopDrag(event?: PointerEvent): void {
        if (event && this.activePointerId !== null && event.pointerId !== this.activePointerId) return;

        if (this.activePointerId !== null) {
            try {
                this.activeDragTarget?.releasePointerCapture(this.activePointerId);
            } catch { /* ignore */ }
        }
        this.activePointerId = null;
        this.activeDragTarget = null;
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerEnd);
        window.removeEventListener('pointercancel', this.onPointerEnd);
    }

    private emitValue(value: number): void {
        if (value === this.clampedValue()) return;
        this.valueChange.emit(value);
    }

    private alignToStep(value: number): number {
        const min = this.minValue();
        const max = this.maxValue();
        const step = this.stepValue();
        const stepped = min + Math.round((value - min) / step) * step;
        return Math.max(min, Math.min(max, this.roundValue(stepped)));
    }

    private isMajorCondensedTick(tick: number): boolean {
        const min = this.minValue();
        const max = this.maxValue();
        if (tick === min || tick === max) return true;
        const offset = this.roundValue(tick - min);
        const interval = this.condensedTickInterval();
        const remainder = Math.abs(offset % interval);
        return remainder < 0.000001 || Math.abs(remainder - interval) < 0.000001;
    }

    private normalizeNumber(value: number, fallback: number): number {
        return Number.isFinite(value) ? value : fallback;
    }

    private roundValue(value: number): number {
        return Number(value.toFixed(6));
    }
}