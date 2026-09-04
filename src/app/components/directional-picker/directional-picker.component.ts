// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import type { ChoicePickerComponent, PickerChoice, PickerPosition, PickerValue } from '../picker/picker.interface';

const DIAMETER = 160;
const CENTER = DIAMETER / 2;
const INNER_RADIUS = 30;
const OUTER_RADIUS = 78;
const HOLD_DELAY_MS = 300;

export const DIRECTIONAL_PICKER_CHOICES: readonly PickerChoice[] = Object.freeze([
    Object.freeze({ label: 'Front', value: 'front' }),
    Object.freeze({ label: 'Right', value: 'right' }),
    Object.freeze({ label: 'Rear', value: 'rear' }),
    Object.freeze({ label: 'Left', value: 'left' }),
]);

@Component({
    selector: 'directional-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: 'directional-picker.component.html',
    styleUrl: 'directional-picker.component.css',
})
export class DirectionalPickerComponent implements ChoicePickerComponent {
    readonly title = input<string | null>(null);
    readonly values = signal<PickerChoice[]>([...DIRECTIONAL_PICKER_CHOICES]);
    readonly selected = input<PickerValue | null>(null);
    readonly position = input<PickerPosition>({ x: 0, y: 0 });
    readonly lightTheme = input(false);
    readonly initialEvent = signal<PointerEvent | null>(null);

    readonly picked = output<PickerChoice>();
    readonly cancelled = output<void>();
    readonly hoveredChoice = signal<PickerChoice | null>(null);

    readonly diameter = DIAMETER;
    readonly center = CENTER;
    readonly innerRadius = INNER_RADIUS;

    private holdTimeout: number | null = null;
    private pointerDownInside = false;

    constructor() {
        afterNextRender(() => this.setupEventListeners());
        inject(DestroyRef).onDestroy(() => this.cleanupEventListeners());
    }

    sectorPath(index: number): string {
        const startAngle = -135 + index * 90;
        const endAngle = startAngle + 90;
        const outerStart = this.pointOnCircle(OUTER_RADIUS, startAngle);
        const outerEnd = this.pointOnCircle(OUTER_RADIUS, endAngle);
        const innerEnd = this.pointOnCircle(INNER_RADIUS, endAngle);
        const innerStart = this.pointOnCircle(INNER_RADIUS, startAngle);
        return `M ${outerStart.x} ${outerStart.y} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${INNER_RADIUS} ${INNER_RADIUS} 0 0 0 ${innerStart.x} ${innerStart.y} Z`;
    }

    labelPosition(index: number): PickerPosition {
        return this.pointOnCircle((INNER_RADIUS + OUTER_RADIUS) / 2, -90 + index * 90);
    }

    setHoveredChoice(choice: PickerChoice): void {
        this.hoveredChoice.set(choice);
    }

    resetHoveredChoice(): void {
        this.hoveredChoice.set(null);
    }

    handlePointerDown(event: PointerEvent, choice: PickerChoice): void {
        if (event.button !== 0) return;
        this.pointerDownInside = true;
        this.setHoveredChoice(choice);
        event.stopPropagation();
    }

    handleChoiceClick(event: MouseEvent, choice: PickerChoice): void {
        if (!this.pointerDownInside) return;
        event.preventDefault();
        event.stopPropagation();
        this.pointerDownInside = false;
        this.pick(choice);
    }

    handleChoiceKeydown(event: KeyboardEvent, choice: PickerChoice): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.pick(choice);
    }

    pick(choice: PickerChoice): void {
        this.picked.emit(choice);
    }

    cancel(): void {
        this.cancelled.emit();
    }

    private pointOnCircle(radius: number, angle: number): PickerPosition {
        const radians = angle * Math.PI / 180;
        return {
            x: CENTER + radius * Math.cos(radians),
            y: CENTER + radius * Math.sin(radians),
        };
    }

    private setupEventListeners(): void {
        if (this.initialEvent()?.type === 'pointerdown') {
            this.holdTimeout = window.setTimeout(() => {
                window.removeEventListener('pointerup', this.handleQuickPointerUp, true);
                window.addEventListener('pointerup', this.handleHeldPointerUp, { once: true, capture: true });
            }, HOLD_DELAY_MS);
            window.addEventListener('pointerup', this.handleQuickPointerUp, { once: true, capture: true });
        }
        window.addEventListener('pointerdown', this.handleOutsidePointerDown, true);
        window.addEventListener('pointermove', this.handlePointerMove);
    }

    private cleanupEventListeners(): void {
        if (this.holdTimeout !== null) {
            window.clearTimeout(this.holdTimeout);
            this.holdTimeout = null;
        }
        window.removeEventListener('pointerup', this.handleQuickPointerUp, true);
        window.removeEventListener('pointerup', this.handleHeldPointerUp, true);
        window.removeEventListener('pointerdown', this.handleOutsidePointerDown, true);
        window.removeEventListener('pointermove', this.handlePointerMove);
    }

    private readonly handleQuickPointerUp = (event: PointerEvent): void => {
        if (this.holdTimeout !== null) {
            window.clearTimeout(this.holdTimeout);
            this.holdTimeout = null;
        }
        const choice = this.hoveredChoice();
        if (!choice) return;
        event.preventDefault();
        event.stopPropagation();
        this.pick(choice);
    };

    private readonly handleHeldPointerUp = (event: PointerEvent): void => {
        const choice = this.hoveredChoice();
        if (!choice) {
            this.cancel();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.pick(choice);
    };

    private readonly handleOutsidePointerDown = (event: PointerEvent): void => {
        const target = event.target as Element | null;
        if (!target?.closest('.directional-picker-container')) this.cancel();
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        const sector = document.elementFromPoint(event.clientX, event.clientY)
            ?.closest<SVGPathElement>('.directional-sector');
        if (!sector) {
            this.resetHoveredChoice();
            return;
        }
        this.hoveredChoice.set(this.values()[Number(sector.dataset['directionIndex'])] ?? null);
    };
}