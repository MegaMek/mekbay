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
import { Component, ElementRef, signal, computed, output, ChangeDetectionStrategy, viewChild, effect, afterNextRender, inject, Injector, input } from '@angular/core';
import { PickerChoice, PickerComponent, PickerValue } from '../picker/picker.interface';
import { LayoutService } from '../../services/layout.service';

/*
 * Author: Drake
 */
const RADIAL_PICKER_DIAMETER = 120;
const DEFAULT_RADIAL_INNER_RADIUS = 25;
const START_AT_180_DEGREES = false;
const BEGIN_END_SECTOR_PADDING = 110;

@Component({
    selector: 'radial-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: 'radial-picker.component.html',
    styleUrls: ['radial-picker.component.css']
})
export class RadialPickerComponent implements PickerComponent {
    private readonly injector = inject(Injector);
    public readonly layoutService = inject(LayoutService);

    // Input signals
    readonly title = input<string | null>(null);
    readonly values = signal<PickerChoice[]>([]);
    readonly selected = input<PickerValue | null>(null);
    readonly position = input<{ x: number, y: number }>({ x: 0, y: 0 });
    readonly useCurvedText = signal<boolean>(false);
    readonly innerRadius = signal<number>(DEFAULT_RADIAL_INNER_RADIUS);
    readonly beginEndPadding = signal<number>(BEGIN_END_SECTOR_PADDING);
    readonly initialEvent = signal<PointerEvent | null>(null);

    picked = output<PickerChoice>();
    cancelled = output<void>();

    hoveredChoice = signal<PickerChoice | null>(null);

    pickerRef = viewChild.required<ElementRef<HTMLDivElement>>('picker');

    // Computed properties
    readonly selectedChoice = computed(() => {
        const selectedValue = this.selected();
        return selectedValue ? this.values().find(c => c.value === selectedValue) ?? null : null;
    });

    readonly diameter = computed(() => {
        const baseRadius = this.innerRadius() + 30;
        if (this.useCurvedText()) {
            return baseRadius * 2;
        }

        const baseDiameter = this.layoutService.isTouchInput()
            ? RADIAL_PICKER_DIAMETER * 1.3
            : RADIAL_PICKER_DIAMETER;
        const baseOuterDiameter = Math.max(baseRadius * 2, baseDiameter);

        // Calculate dynamic size based on longest string
        const maxLength = Math.max(...this.values().map(v => v.label.length), 0);
        const dynamicMultiplier = Math.max(1.2, Math.min(2.5, 1 + maxLength * 0.1));

        return Math.round(baseOuterDiameter * dynamicMultiplier);
    });

    readonly radius = computed(() => this.diameter() / 2);

    readonly titleFontSize = computed(() => {
        const title = this.title();
        if (!title) return '1em';

        const maxWidth = 90; // Available width in hex

        const avgCharWidth = 10; // pixels per character at base font size
        const estimatedWidth = title.length * avgCharWidth;

        // Calculate scale factor
        const scaleFactor = Math.min(1, maxWidth / estimatedWidth);
        const finalSize = Math.max(0.5, scaleFactor); // Minimum 0.5em

        return `${finalSize}em`;
    });

    // Private properties
    private readonly sectorPadding = 0;
    private longPressTimeout?: number;
    private pointerDownInside = false;

    constructor() {
        effect((cleanup) => {
            afterNextRender(() => {
                this.setupEventListeners();
            }, { injector: this.injector });
            cleanup(() => this.cleanupEventListeners());
        })
    }

    // Helper methods
    isSelected(choice: PickerChoice): boolean {
        return choice.value === this.selected();
    }

    isHovered(choice: PickerChoice): boolean {
        return choice === this.hoveredChoice();
    }

    private getSectorAngles(index: number) {
        const n = this.values().length;
        const pad = this.sectorPadding;
        const beginEndPad = this.beginEndPadding();

        const startOffset = START_AT_180_DEGREES ? 180 : -90;
        const direction = START_AT_180_DEGREES ? -1 : 1;

        const totalPadding = n * pad + beginEndPad;
        const totalAngle = 360 - totalPadding;
        const anglePer = totalAngle / n;

        let startAngle = direction * (index * anglePer + index * pad);
        let endAngle = direction * ((index + 1) * anglePer + index * pad);

        if (n > 1 && beginEndPad > 0) {
            const halfPadding = direction * (beginEndPad / 2);
            startAngle += halfPadding;
            endAngle += halfPadding;
        }

        return {
            start: startAngle + startOffset,
            end: endAngle + startOffset,
            center: (startAngle + endAngle) / 2 + startOffset
        };
    }

    getDonutSectorPath(index: number): string {
        const n = this.values().length;
        const rOuter = this.radius();
        const rInner = this.innerRadius();

        // Special case for single value - create full circle
        if (n === 1) {
            return [
                `M ${this.radius() - rOuter} ${this.radius()}`,
                `A ${rOuter} ${rOuter} 0 1 1 ${this.radius() + rOuter} ${this.radius()}`,
                `A ${rOuter} ${rOuter} 0 1 1 ${this.radius() - rOuter} ${this.radius()}`,
                `M ${this.radius() - rInner} ${this.radius()}`,
                `A ${rInner} ${rInner} 0 1 0 ${this.radius() + rInner} ${this.radius()}`,
                `A ${rInner} ${rInner} 0 1 0 ${this.radius() - rInner} ${this.radius()}`,
            ].join(' ');
        }

        const angles = this.getSectorAngles(index);
        const direction = START_AT_180_DEGREES ? -1 : 1;
        const toRad = (deg: number) => (deg - 90) * Math.PI / 180;

        // Calculate arc points
        const x1 = this.radius() + rOuter * Math.cos(toRad(angles.start));
        const y1 = this.radius() + rOuter * Math.sin(toRad(angles.start));
        const x2 = this.radius() + rOuter * Math.cos(toRad(angles.end));
        const y2 = this.radius() + rOuter * Math.sin(toRad(angles.end));
        const x3 = this.radius() + rInner * Math.cos(toRad(angles.end));
        const y3 = this.radius() + rInner * Math.sin(toRad(angles.end));
        const x4 = this.radius() + rInner * Math.cos(toRad(angles.start));
        const y4 = this.radius() + rInner * Math.sin(toRad(angles.start));

        const largeArc = Math.abs(angles.end - angles.start) > 180 ? 1 : 0;

        return [
            `M ${x1} ${y1}`,
            `A ${rOuter} ${rOuter} 0 ${largeArc} ${direction === 1 ? 1 : 0} ${x2} ${y2}`,
            `L ${x3} ${y3}`,
            `A ${rInner} ${rInner} 0 ${largeArc} ${direction === 1 ? 0 : 1} ${x4} ${y4}`,
            'Z'
        ].join(' ');
    }

    getLabelPosition(index: number): { x: number, y: number } {
        const n = this.values().length;
        const coefficient = this.layoutService.isTouchInput() ? 0.7 : 0.6;
        const labelRadius = this.innerRadius() + (this.radius() - this.innerRadius()) * coefficient;

        // Special case for single value - center at top
        if (n === 1) {
            const rad = -Math.PI / 2; // -90 degrees = top position
            return {
                x: this.radius() + labelRadius * Math.cos(rad),
                y: this.radius() + labelRadius * Math.sin(rad)
            };
        }

        const angles = this.getSectorAngles(index);
        const rad = (angles.center - 90) * Math.PI / 180;

        return {
            x: this.radius() + labelRadius * Math.cos(rad),
            y: this.radius() + labelRadius * Math.sin(rad)
        };
    }

    getCurvedTextPath(index: number): string {
        const n = this.values().length;
        const textRadius = this.innerRadius() + (this.radius() - this.innerRadius()) * 0.5;

        // Special case for single value
        if (n === 1) {
            const startAngle = -150;
            const endAngle = -30;
            const startRad = startAngle * Math.PI / 180;
            const endRad = endAngle * Math.PI / 180;

            const x1 = this.radius() + textRadius * Math.cos(startRad);
            const y1 = this.radius() + textRadius * Math.sin(startRad);
            const x2 = this.radius() + textRadius * Math.cos(endRad);
            const y2 = this.radius() + textRadius * Math.sin(endRad);

            return `M ${x1} ${y1} A ${textRadius} ${textRadius} 0 0 1 ${x2} ${y2}`;
        }

        const angles = this.getSectorAngles(index);
        const direction = START_AT_180_DEGREES ? -1 : 1;

        // Determine text orientation based on position
        const isUpperHalf = angles.center >= -90 && angles.center <= 90;
        const startRad = (angles.start - 90) * Math.PI / 180;
        const endRad = (angles.end - 90) * Math.PI / 180;

        let x1, y1, x2, y2, sweep;

        if (isUpperHalf) {
            // Upper half: text faces inward (clockwise path)
            x1 = this.radius() + textRadius * Math.cos(startRad);
            y1 = this.radius() + textRadius * Math.sin(startRad);
            x2 = this.radius() + textRadius * Math.cos(endRad);
            y2 = this.radius() + textRadius * Math.sin(endRad);
            sweep = direction === 1 ? 1 : 0;
        } else {
            // Lower half: text faces outward (counter-clockwise path)
            x1 = this.radius() + textRadius * Math.cos(endRad);
            y1 = this.radius() + textRadius * Math.sin(endRad);
            x2 = this.radius() + textRadius * Math.cos(startRad);
            y2 = this.radius() + textRadius * Math.sin(startRad);
            sweep = direction === 1 ? 0 : 1;
        }

        const largeArc = Math.abs(angles.end - angles.start) > 180 ? 1 : 0;
        return `M ${x1} ${y1} A ${textRadius} ${textRadius} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
    }

    getCenterValuePosition(): { x: number, y: number } {
        const centerX = this.diameter() / 2;
        const centerY = this.diameter() / 2;

        const hoveredValue = this.hoveredChoice()?.value?.toString() ?? '';

        // If the value starts with "-", adjust x position slightly to the left
        // to visually center the numeric content without the minus sign
        if (hoveredValue.startsWith('-')) {
            return {
                x: centerX - 3,
                y: centerY
            };
        }

        return {
            x: centerX,
            y: centerY
        };
    }

    getTextPathId(index: number): string {
        return `textPath-${index}`;
    }

    getBorderPath(): string {
        const beginEndPad = this.beginEndPadding();
        const rOuter = this.radius();

        // Special case for full circle
        if (beginEndPad === 0) {
            return [
                `M ${this.radius() - rOuter} ${this.radius()}`,
                `A ${rOuter} ${rOuter} 0 1 1 ${this.radius() + rOuter} ${this.radius()}`,
                `A ${rOuter} ${rOuter} 0 1 1 ${this.radius() - rOuter} ${this.radius()}`
            ].join(' ');
        }

        const n = this.values().length;
        const pad = this.sectorPadding;
        const startOffset = START_AT_180_DEGREES ? 180 : -90;
        const direction = START_AT_180_DEGREES ? -1 : 1;

        const totalPadding = n * pad + beginEndPad;
        const totalAngle = 360 - totalPadding;

        const startAngle = direction * (beginEndPad / 2) + startOffset;
        const endAngle = direction * (totalAngle + beginEndPad / 2) + startOffset;

        const toRad = (deg: number) => (deg - 90) * Math.PI / 180;
        const x1 = this.radius() + rOuter * Math.cos(toRad(startAngle));
        const y1 = this.radius() + rOuter * Math.sin(toRad(startAngle));
        const x2 = this.radius() + rOuter * Math.cos(toRad(endAngle));
        const y2 = this.radius() + rOuter * Math.sin(toRad(endAngle));
        const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;

        return [
            `M ${x1} ${y1}`,
            `A ${rOuter} ${rOuter} 0 ${largeArc} ${direction === 1 ? 1 : 0} ${x2} ${y2}`
        ].join(' ');
    }

    // Event handlers
    setHoveredChoice(choice: PickerChoice): void {
        if (choice.disabled) return;
        this.hoveredChoice.set(choice);
    }

    resetHovered(): void {
        this.hoveredChoice.set(null);
    }

    handleChoiceClick(event: MouseEvent, choice: PickerChoice): void {
        if (!this.pointerDownInside || choice.disabled) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        this.pointerDownInside = false;
        this.pick({value: choice.value, label: choice.label});
    }

    pick(val: PickerChoice): void {
        this.picked.emit(val);
        this.resetHovered();
    }

    cancel(): void {
        this.cancelled.emit();
    }

    private noContextMenu(event: MouseEvent): void {
        event.preventDefault();
    }

    private setupEventListeners(): void {

        const initialEvent = this.initialEvent();
        if (initialEvent && initialEvent.type === 'pointerdown') {
            this.longPressTimeout = window.setTimeout(() => {
                window.removeEventListener('pointerup', this.handleQuickClickPointerUp, true);
                window.addEventListener('pointerup', this.pointerUpListener, { once: true, capture: true });
            }, 300);
            window.addEventListener('pointerup', this.handleQuickClickPointerUp, { once: true, capture: true });
        }

        window.addEventListener('pointerdown', this.handleOutsideClick, { capture: true });
        window.addEventListener('pointermove', this.onPointerMove, { passive: false });
        
        const el = this.pickerRef().nativeElement;
        if (el) {
            el.addEventListener('pointerdown', this.onPointerDownInside, { capture: true });
            el.addEventListener('contextmenu', this.noContextMenu);
        }
    }

    private cleanupEventListeners(): void {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
        }

        window.removeEventListener('pointerup', this.handleQuickClickPointerUp, true);
        window.removeEventListener('pointerup', this.pointerUpListener, true);
        window.removeEventListener('pointerdown', this.handleOutsideClick, true);
        window.removeEventListener('pointermove', this.onPointerMove);

        const el = this.pickerRef().nativeElement;
        if (el) {
            el.removeEventListener('pointerdown', this.onPointerDownInside, { capture: true });
            el.removeEventListener('contextmenu', this.noContextMenu);
        }
    }

    private readonly onPointerDownInside = (event: PointerEvent): void => {
        this.pointerDownInside = true;
        event.stopPropagation();
    };

    private readonly handleQuickClickPointerUp = (event: PointerEvent): void => {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
        }
    };

    private readonly pointerUpListener = (event: PointerEvent): void => {
        const hoveredChoice = this.hoveredChoice();
        if (!hoveredChoice || hoveredChoice.disabled) {
            this.cancel();
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        this.pick(hoveredChoice);
    };

    private readonly handleOutsideClick = (event: PointerEvent): void => {
        const target = event.target as HTMLElement;
        if (!target?.closest('.radial-picker-container') || target?.classList.contains('radial-inner-circle')) {
            this.cancel();
        }
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const sector = element?.closest('.radial-sector') as HTMLElement | null;

        if (sector) {
            // Find the choice by checking which sector this is
            const allSectors = Array.from(this.pickerRef().nativeElement.querySelectorAll('.radial-sector'));
            const sectorIndex = allSectors.indexOf(sector);
            const choice = this.values()[sectorIndex];

            if (choice) {
                this.setHoveredChoice(choice);
            }
        } else {
            this.resetHovered();
        }
    };
}