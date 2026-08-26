// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    input,
    output,
    signal,
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
    private dragStartValue: number | null = null;
    private lastDragValue: number | null = null;

    readonly min = input<number>(0);
    readonly max = input<number>(100);
    readonly blockedMin = input<number | null>(null);
    readonly blockedMax = input<number | null>(null);
    readonly step = input<number>(1);
    readonly value = input<number>(0);
    readonly ticks = input<readonly number[] | null>(null);
    readonly tickLabels = input<readonly string[] | null>(null);
    readonly tickLabelOverrides = input<Readonly<Record<number, string>> | null>(null);
    readonly label = input<string | number | null>(null);
    readonly ariaLabel = input<string>('Value');
    readonly valueAssigned = input<boolean>(false);
    readonly danger = input<boolean>(false);
    readonly compactLabel = input<boolean>(false);
    readonly modifierLabel = input<string | null>(null);

    readonly valueChange = output<number>();
    readonly valueCommit = output<number>();

    readonly minValue = computed(() => this.normalizeNumber(this.min(), 0));
    readonly maxValue = computed(() => Math.max(this.minValue(), this.normalizeNumber(this.max(), this.minValue())));
    readonly effectiveMinValue = computed(() => {
        const blockedMin = this.blockedMin();
        if (blockedMin === null) return this.minValue();
        return Math.max(this.minValue(), Math.min(this.maxValue(), this.normalizeNumber(blockedMin, this.minValue())));
    });
    readonly effectiveMaxValue = computed(() => {
        const blockedMax = this.blockedMax();
        if (blockedMax === null) return this.maxValue();
        return Math.max(
            this.effectiveMinValue(),
            Math.min(this.maxValue(), this.normalizeNumber(blockedMax, this.maxValue())),
        );
    });
    readonly stepValue = computed(() => Math.max(0.000001, Math.abs(this.normalizeNumber(this.step(), 1))));
    readonly clampedValue = computed(() => this.alignToStep(this.value()));
    readonly valueLabel = computed(() => this.label() ?? `${this.clampedValue()}`);
    readonly valuePercent = computed(() => this.percentForValue(this.clampedValue()));
    readonly blockedMinPercent = computed(() => this.effectiveMinValue() > this.minValue() ? this.percentForValue(this.effectiveMinValue()) : 0);
    readonly blockedMaxPercent = computed(() => this.effectiveMaxValue() < this.maxValue()
        ? 100 - this.percentForValue(this.effectiveMaxValue())
        : 0
    );
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
    readonly touchDragging = signal(false);
    readonly visibleModifierLabel = computed(() => this.valueAssigned() ? this.modifierLabel() : null);

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
        const override = this.tickLabelOverrides()?.[tick];
        if (override !== undefined) return override;
        const labels = this.tickLabels();
        if (!labels) return this.isCondensedDotTick(tick) ? '•' : `${tick}`;
        const index = this.displayTicks().indexOf(tick);
        return labels[index] ?? `${tick}`;
    }

    isOverrideTick(tick: number): boolean {
        return this.tickLabelOverrides()?.[tick] !== undefined;
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
        this.dragStartValue = this.clampedValue();
        this.lastDragValue = null;
        this.touchDragging.set(event.pointerType === 'touch');
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
        if (event.key === 'Home') next = this.effectiveMinValue();
        if (event.key === 'End') next = this.effectiveMaxValue();
        if (next === null) return;

        event.preventDefault();
        const value = this.alignToStep(next);
        if (this.emitValue(value)) {
            this.valueCommit.emit(value);
        }
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
        const nextValue = this.alignToStep(value);
        if (this.emitValue(nextValue)) {
            this.lastDragValue = nextValue;
        }
    }

    private stopDrag(event?: PointerEvent): void {
        if (event && this.activePointerId !== null && event.pointerId !== this.activePointerId) return;

        const dragStartValue = this.dragStartValue;
        const dragEndValue = this.lastDragValue;

        if (this.activePointerId !== null) {
            try {
                this.activeDragTarget?.releasePointerCapture(this.activePointerId);
            } catch { /* ignore */ }
        }
        this.activePointerId = null;
        this.activeDragTarget = null;
        this.dragStartValue = null;
        this.lastDragValue = null;
        this.touchDragging.set(false);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerEnd);
        window.removeEventListener('pointercancel', this.onPointerEnd);

        if (dragEndValue !== null && dragEndValue !== dragStartValue) {
            this.valueCommit.emit(dragEndValue);
        }
    }

    private emitValue(value: number): boolean {
        if (value === this.clampedValue()) return false;
        this.valueChange.emit(value);
        return true;
    }

    private alignToStep(value: number): number {
        const min = this.minValue();
        const max = this.effectiveMaxValue();
        const effectiveMin = this.effectiveMinValue();
        const step = this.stepValue();
        const stepped = min + Math.round((value - min) / step) * step;
        return Math.max(effectiveMin, Math.min(max, this.roundValue(stepped)));
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
