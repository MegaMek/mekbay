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
import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal, computed, inject, output, ChangeDetectionStrategy } from '@angular/core';
import { PickerChoice, PickerComponent, PickerValue } from '../picker/picker.interface';

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
    template: `<div
        class="radial-picker-container"
        [class.touch]="interactionType() === 'touch'"
        [style.width.px]="diameter()"
        [style.position]="'absolute'"
        [style.left.px]="position().x - diameter() / 2"
        [style.top.px]="position().y - diameter() / 2"
        style="z-index: 1000;"
    >
        <div class="radial-title" *ngIf="title()"
            [class.top-positioned]="beginEndPadding() < 50"
            [style.right.px]="beginEndPadding() >= 50 ? 130 + radius() + innerRadius() : null"
            [style.top.px]="beginEndPadding() < 50 ? -40 : null"
            [style.left.px]="beginEndPadding() < 50 ? diameter() / 2 - 68 : null"
        >
            <svg class="radial-title-hex" width="130" height="40" viewBox="-3 -3 136 46">
                <polygon class="radial-title-hex-shape"
                    points="10,20 20,5 120,5 130,20 120,35 20,35"
                    stroke-width="2"
                />
            </svg>
            <div class="radial-title-text" [style.font-size]="titleFontSize()">{{ title() }}</div>
        </div>
        <svg #picker
            [attr.width]="diameter()"
            [attr.height]="diameter()"
            [attr.viewBox]="'-3 -3 ' + (diameter() + 6) + ' ' + (diameter() + 6)"
            class="radial-picker"
        >
            <defs>
                <ng-container *ngFor="let choice of values(); let i = index">
                    <path 
                        *ngIf="useCurvedText()"
                        [attr.id]="getTextPathId(i)"
                        [attr.d]="getCurvedTextPath(i)"
                        fill="none"
                        stroke="none"
                    />
                </ng-container>
            </defs>
            
            <ng-container *ngFor="let choice of values(); let i = index">
                <path
                    [attr.d]="getDonutSectorPath(i)"
                    class="radial-sector"
                    [class.selected]="isSelected(choice)"
                    [class.highlight]="isHovered(choice) && !choice.disabled"
                    [class.disabled]="choice.disabled"
                    (mouseenter)="setHoveredChoice(choice)"
                    (mouseleave)="resetHovered()"
                    (touchstart)="setHoveredChoice(choice)"
                    (click)="handleChoiceClick($event, choice)"
                ></path>
                
                <!-- Curved text -->
                <text 
                    *ngIf="useCurvedText()"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    class="radial-label curved-text"
                    [class.selected]="isSelected(choice)"
                    [class.highlight]="isHovered(choice) && !choice.disabled"
                    [class.disabled]="choice.disabled"
                    (mouseenter)="setHoveredChoice(choice)"
                    (mouseleave)="resetHovered()"
                    (touchstart)="setHoveredChoice(choice)"
                    (click)="handleChoiceClick($event, choice)"
                >
                    <textPath 
                        [attr.href]="'#' + getTextPathId(i)"
                        startOffset="50%"
                        text-anchor="middle"
                    >
                        {{ choice.label }}
                    </textPath>
                </text>
                
                <!-- Straight text -->
                <text
                    *ngIf="!useCurvedText()"
                    [attr.x]="getLabelPosition(i).x"
                    [attr.y]="getLabelPosition(i).y"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    class="radial-label"
                    [class.selected]="isSelected(choice)"
                    [class.highlight]="isHovered(choice) && !choice.disabled"
                    [class.disabled]="choice.disabled"
                    (mouseenter)="setHoveredChoice(choice)"
                    (mouseleave)="resetHovered()"
                    (touchstart)="setHoveredChoice(choice)"
                    (click)="handleChoiceClick($event, choice)"
                >
                    {{ choice.label }}
                </text>
            </ng-container>
            
            <circle
                [attr.cx]="diameter() / 2"
                [attr.cy]="diameter() / 2"
                [attr.r]="innerRadius()"
                [attr.fill]="title() && hoveredChoice() ? 'var(--bt-yellow)' : 'transparent'"
                class="radial-inner-circle"
            />
            <text *ngIf="title()"
                [attr.x]="getCenterValuePosition().x"
                [attr.y]="getCenterValuePosition().y"
                text-anchor="middle"
                dominant-baseline="middle"
                dy=".07em"
                class="radial-center-value"
            >
                {{ hoveredChoice()?.value ?? '' }}
            </text>
            <path
                [attr.d]="getBorderPath()"
                stroke-width="2"
                fill="none"
                class="radial-picker-border"
                pointer-events="none"
            />
        </svg>
    </div>
`,
styles: [`
    .radial-picker-container {
        font-family: 'Roboto', sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        user-select: none;
        pointer-events: none;
    }
    .radial-title {
        position: absolute;
        display: flex;
        flex-direction: row;
        align-items: center;
        pointer-events: none;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #fff;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        height: 40px;
    }
    .radial-title.top-positioned {
        transform: none;
    }
    .radial-title-hex {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 0;
        pointer-events: none;
    }
    .radial-title-hex-shape {
        fill: #000;
        stroke: #fff;
    }
    .radial-title-text {
        position: absolute;
        left: 22px;
        top: 0;
        width: 94px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
        font-size: 1em;
        background: transparent;
        min-height: unset;
        text-align: center;
    }
    .radial-picker {
        display: block;
    }
    .radial-sector {
        stroke-width: 2;
        cursor: pointer;
        transition: fill 0.15s;
        fill: #000A;
        pointer-events: auto;
    }
    .radial-sector.disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }
    .radial-sector.selected {
        fill: var(--bt-yellow-background-bright-transparent);
    }
    .radial-sector.highlight:not(.disabled),
    :host-context(.night-mode) .radial-sector.highlight:not(.disabled) {
        fill: var(--bt-yellow);
    }
    .radial-label {
        font-family: 'Roboto', sans-serif;
        font-size: 0.9em;
        pointer-events: none;
        fill: #fff;
        font-weight: 500;
        text-shadow: 0 1px 2px #111;
        transition: fill 0.15s;
    }
    .radial-label.disabled {
        opacity: 0.5;
        fill: #666;
    }
    .radial-label.selected {
        font-weight: bold;
    }
    .radial-center-value {
        font-family: 'Roboto', sans-serif;
        font-size: 1.2em;
        font-weight: bold;
        fill: #fff;
        pointer-events: none;
        dominant-baseline: middle;
    }   
    .radial-picker-border {
        pointer-events: none;
        stroke: #fff;
    }
    :host-context(.night-mode) .radial-title-hex-shape {
        fill: #fff;
        stroke: #000;
    }
    :host-context(.night-mode) .radial-title-text {
        color: #000;
    }
    :host-context(.night-mode) .radial-sector {
        fill: #FFFC;
    }
    :host-context(.night-mode) .radial-sector.selected {
        fill: #AAAC;
    }
    :host-context(.night-mode) .radial-label.selected {
        fill: #FFF;
        text-shadow: 0 1px 2px #111;
    }
    :host-context(.night-mode) .radial-label {
        fill: #000;
        text-shadow: none;
    }
    :host-context(.night-mode) .radial-label.highlight {
        fill: #fff;
        text-shadow: 0 1px 2px #111;
    }
`]
})
export class RadialPickerComponent implements AfterViewInit, OnDestroy, PickerComponent {
    
    // Input signals
    readonly interactionType = signal<'mouse' | 'touch'>('mouse');
    readonly title = signal<string | null>(null);
    readonly values = signal<PickerChoice[]>([]);
    readonly selected = signal<PickerValue | null>(null);
    readonly position = signal<{ x: number, y: number }>({ x: 0, y: 0 });
    readonly useCurvedText = signal<boolean>(false);
    readonly innerRadius = signal<number>(DEFAULT_RADIAL_INNER_RADIUS);
    readonly beginEndPadding = signal<number>(BEGIN_END_SECTOR_PADDING);
    readonly initialEvent = signal<PointerEvent | null>(null);

    picked = output<PickerValue>();
    cancelled = output<void>();

    hoveredChoice = signal<PickerChoice | null>(null);

    @ViewChild('picker') pickerRef!: ElementRef<HTMLDivElement>;

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
        
        const baseDiameter = this.interactionType() === 'touch'
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
        const coefficient = this.interactionType() === 'touch' ? 0.7 : 0.6;
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
        this.pick(choice.value);
    }

    pick(val: PickerValue): void {
        this.picked.emit(val);
        this.resetHovered();
    }

    cancel(): void {
        this.cancelled.emit();
    }

    // Lifecycle hooks
    ngAfterViewInit(): void {
        this.setupEventListeners();
    }

    ngOnDestroy(): void {
        this.cleanupEventListeners();
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

        window.addEventListener('mousedown', this.handleOutsideClick, { capture: true });
        window.addEventListener('touchmove', this.onTouchMove, { passive: false });
        
        this.pickerRef?.nativeElement?.addEventListener('pointerdown', this.onPointerDownInside, { capture: true });
        this.pickerRef?.nativeElement?.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
        });
    }

    private cleanupEventListeners(): void {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
        }
        
        window.removeEventListener('pointerup', this.handleQuickClickPointerUp, true);
        window.removeEventListener('pointerup', this.pointerUpListener, true);
        window.removeEventListener('mousedown', this.handleOutsideClick, true);
        window.removeEventListener('touchmove', this.onTouchMove);
        
        this.pickerRef?.nativeElement?.removeEventListener('pointerdown', this.onPointerDownInside, { capture: true });
    }

    private readonly onPointerDownInside = (): void => {
        this.pointerDownInside = true;
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
        this.pick(hoveredChoice.value);
    };

    private readonly handleOutsideClick = (ev: MouseEvent): void => {
        const target = ev.target as HTMLElement;
        if (!target?.closest('.radial-picker-container') || target?.classList.contains('radial-inner-circle')) {
            this.cancel();
        }
    };

    private readonly onTouchMove = (event: TouchEvent): void => {
        const touch = event.touches[0];
        if (!touch) return;
        
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        const sector = element?.closest('.radial-sector') as HTMLElement | null;
        
        if (sector) {
            // Find the choice by checking which sector this is
            const allSectors = Array.from(this.pickerRef.nativeElement.querySelectorAll('.radial-sector'));
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