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

import { Component, ElementRef, AfterViewInit, signal, output, computed, effect, untracked, input, ChangeDetectionStrategy, viewChild, DestroyRef, inject } from '@angular/core';
import { NumericPickerComponent, NumericPickerResult, PickerPosition } from '../picker/picker.interface';
import { vibrate } from '../../utils/vibrate.util';
import { LayoutService } from '../../services/layout.service';

/*
 * Author: Drake
 * 
 * Rotating Picker - A numeric dial picker for selecting values within a range.
 * 
 * Usage:
 *   <rotating-picker
 *     [min]="-10"
 *     [max]="10"
 *     [selected]="0"
 *     [step]="1"
 *     [title]="'DAMAGE'"
 *     (picked)="onValuePicked($event)"
 *     (cancelled)="onCancelled()"
 *   />
 */
const ROTATING_PICKER_DIAMETER = 120;
const MIN_360_ROTATION_STEPS = 12;
const MAX_360_ROTATION_STEPS = 48;
const ROTATION_LOWER_LIMIT = 50;
const ROTATION_UPPER_LIMIT = 200;
const START_ARROW_DEG = 0;
const END_ARROW_DEG = 45;
const ARROW_DISTANCE = 5;
const KEYBOARD_INPUT_TIMEOUT = 1000; // 1 second timeout for number concatenation

@Component({
    selector: 'rotating-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        '(keydown)': 'onKeyDown($event)',
        '(wheel)': 'onWheel($event)'
    },
    template: `
        <div #container class="rotating-picker-container"
            [class.light-theme]="lightTheme()"
            [style.position]="'fixed'"
            [style.left.px]="position().x"
            [style.top.px]="position().y"
            [style.transform]="'translate(-50%, -50%)'"
            [style.width.px]="diameter()"
            [style.height.px]="diameter()"
            style="z-index: 1000;"
            tabindex="0"
            (contextmenu)="$event.preventDefault()"
            (pointerdown)="onPointerDown($event)" 
        >
            <!-- Title banner centered above the dial -->
            @if(title()){
                <div class="title">
                    <svg class="title-hex" width="130" height="40" viewBox="-3 -3 136 46">
                        <polygon class="title-hex-shape"
                            points="10,20 20,5 120,5 130,20 120,35 20,35"
                            stroke-width="2"
                        />
                    </svg>
                    <div class="title-text" [style.font-size]="titleFontSize()">{{ title() }}</div>
                </div>
            }

            <svg #picker
                [attr.width]="diameter()"
                [attr.height]="diameter()"
                [attr.viewBox]="'-3 -3 ' + (diameter() + 6) + ' ' + (diameter() + 6)"
                class="rotating-picker"
            >
                <defs>
                    <mask id="donut-mask">
                        <rect width="100%" height="100%" fill="white"/>
                        <circle [attr.cx]="radius()" [attr.cy]="radius()" [attr.r]="innerRadius()" fill="black" />
                    </mask>
                    <filter id="hard-stroke">
                        <feDropShadow dx="0.5" dy="0.5" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="-0.5" dy="0.5" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="0.5" dy="-0.5" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="-0.5" dy="-0.5" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="0" dy="0.5" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="0" dy="-0.5" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="0.5" dy="0" stdDeviation="0" flood-color="white"/>
                        <feDropShadow dx="-0.5" dy="0" stdDeviation="0" flood-color="white"/>
                    </filter>
                    <filter id="light-theme-hard-stroke">
                        <feDropShadow dx="0.5" dy="0.5" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="-0.5" dy="0.5" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="0.5" dy="-0.5" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="-0.5" dy="-0.5" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="0" dy="0.5" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="0" dy="-0.5" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="0.5" dy="0" stdDeviation="0" flood-color="black"/>
                        <feDropShadow dx="-0.5" dy="0" stdDeviation="0" flood-color="black"/>
                    </filter>
                </defs>

                <circle [attr.cx]="radius()" [attr.cy]="radius()" [attr.r]="radius()" class="dial-background" mask="url(#donut-mask)" />

                <!-- Curved arrows -->
                <g class="arrows">
                    <!-- Left arrow -->
                    <g class="left-arrow" [class.hidden]="currentValue() <= min()">
                        <path [attr.d]="leftArrowPath()" class="arrow-path" />
                        <polygon [attr.points]="leftArrowHead()" class="arrow-head" />
                    </g>
                    <!-- Right arrow -->
                    <g class="right-arrow" [class.hidden]="currentValue() >= max()">
                        <path [attr.d]="rightArrowPath()" class="arrow-path" />
                        <polygon [attr.points]="rightArrowHead()" class="arrow-head" />
                    </g>
                </g>

                <g [attr.transform]="'rotate(' + rotationAngle() + ' ' + radius() + ' ' + radius() + ')'">
                    @for (idx of notchIndices(); let i = $index; track i) {
                        <g>
                            <line
                                [attr.transform]="'rotate(' + (idx * 360 / 24) + ' ' + radius() + ' ' + radius() + ')'"
                                [attr.x1]="radius() + innerRadius() + ( idx % 3 === 0 ? 20 : 25)"
                                [attr.y1]="radius()"
                                [attr.x2]="radius() + radius() - 5"
                                [attr.y2]="radius()"
                                class="dial-notch"
                            />
                        </g>
                    }
                </g>

                @if (currentValue() !== 0) {
                    <circle [attr.cx]="radius()" [attr.cy]="radius()" [attr.r]="innerRadius()" class="dial-center-area" [class.over-threshold]="isOverThreshold()" />

                    <text
                        [attr.x]="radius()"
                        [attr.y]="radius()"
                        text-anchor="middle"
                        dominant-baseline="middle"
                        dy=".07em"
                        class="dial-center-value"
                    >
                        {{ currentValue() }}
                    </text>
                } @else {
                    <!-- When value is 0 -->
                    <circle [attr.cx]="radius()" [attr.cy]="radius()" [attr.r]="innerRadius()" fill="transparent" />
                }
                <circle [attr.cx]="radius()" [attr.cy]="radius()" [attr.r]="radius()" class="dial-border" />
                
            </svg>
        </div>
    `,
    styles: [`
        .rotating-picker-container {
            font-family: 'Roboto', sans-serif;
            user-select: none;
            touch-action: none;
            outline: none;
        }
        .rotating-picker-container.grabbing {
            cursor: grabbing;
        }

        /* Title banner */
        .title {
            position: absolute;
            top: -40px;
            height: 40px;
            width: 137px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            left: 50%;
            transform: translateX(-50%);
        }
        .title-hex {
            position: absolute;
            left: 0;
            top: 0;
            z-index: 0;
            pointer-events: none;
        }
        .title-hex-shape {
            fill: #000;
            stroke: #fff;
        }
        .title-text {
            position: absolute;
            left: 22px;
            top: 0;
            width: 94px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #fff;
            background: transparent;
            min-height: unset;
            text-align: center;
        }

        .dial-background {
            fill: #000A;
            cursor: grab;
            pointer-events: auto;
            touch-action: none;
        }
        .dial-notch {
            stroke: #fff;
            stroke-width: 1.5;
            opacity: 0.2;
            pointer-events: none;
        }
        .dial-center-area {
            fill: #000;
            cursor: pointer;
            transition: fill 0.15s ease-in-out;
            pointer-events: auto;
        }
        .dial-center-area:hover {
            fill: var(--bt-yellow);
        }
        .dial-center-area.over-threshold {
            fill: #8B0000;
        }
        .dial-center-area.over-threshold:hover {
            fill: #B22222;
        }
        .dial-center-value {
            font-size: 1.5em;
            font-weight: bold;
            fill: #fff;
            pointer-events: none;
        }
        .dial-border {
            fill: none;
            stroke: #fff;
            stroke-width: 2;
            pointer-events: none;
        }
        .arrows {
            pointer-events: none;
            filter: url(#hard-stroke);
        }
        .left-arrow, .right-arrow {
            opacity: 1;
        }
        .left-arrow.hidden,
        .right-arrow.hidden {
            opacity: 0.3;
        }
        .arrow-path {
            fill: none;
            stroke: #000;
            stroke-width: 2;
        }
        .arrow-head {
            fill: #000;
        }

        /* Light Theme styles */
        .light-theme .title-hex-shape {
            fill: #fff;
            stroke: #000;
        }
        .light-theme .title-text {
            color: #000;
        }
        .light-theme .dial-background {
            fill: #FFFC;
        }
        .light-theme .dial-notch {
            stroke: #000;
        }
        .light-theme .dial-center-area {
            fill: #fff;
        }
        .light-theme .dial-center-area.zero {
            fill: #fff6;
        }
        .light-theme .dial-center-area:hover {
            fill: var(--bt-yellow-strong);
        }
        .light-theme .dial-center-area.over-threshold {
            fill: #FF6B6B;
        }
        .light-theme .dial-center-area.over-threshold:hover {
            fill: #FF4444;
        }
        .light-theme .dial-center-value {
            fill: #000;
        }
        .light-theme .arrows {
            filter: url(#light-theme-hard-stroke);
        }
        .light-theme .arrow-path {
            stroke: #fff;
        }
        .light-theme .arrow-head {
            fill: #fff;
        }
    `]
})
export class RotatingPickerComponent implements AfterViewInit, NumericPickerComponent {
    public layoutService = inject(LayoutService);
    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    pickerRef = viewChild.required<ElementRef<SVGElement>>('picker');

    // NumericPickerComponent interface inputs
    title = input<string | null>(null);
    min = input<number>(-99);
    max = input<number>(99);
    selected = input<number>(0);
    step = input<number>(1);
    position = input<PickerPosition>({ x: 0, y: 0 });
    lightTheme = input<boolean>(false);
    threshold = input<number | null>(null);
    stepDegreeRange = input<[number, number]>([MIN_360_ROTATION_STEPS, MAX_360_ROTATION_STEPS]);
    stepRangeBounds = input<[number, number]>([ROTATION_LOWER_LIMIT, ROTATION_UPPER_LIMIT]);
    initialEvent = signal<PointerEvent | null>(null);

    // NumericPickerComponent interface outputs
    picked = output<NumericPickerResult>();
    cancelled = output<void>();

    // Internal state
    currentValue = signal<number>(0);
    rotationAngle = signal<number>(0);

    readonly rotationStepDegrees = computed(() => {
        const range = this.max() - this.min();
        if (range <= this.stepRangeBounds()[0]) return 360 / this.stepDegreeRange()[0];
        if (range >= this.stepRangeBounds()[1]) return 360 / this.stepDegreeRange()[1];
        const t = (range - this.stepRangeBounds()[0]) / (this.stepRangeBounds()[1] - this.stepRangeBounds()[0]);
        // Linear interpolation MIN -> MAX (note MIN > MAX in actual degree values)
        return 360 / (this.stepDegreeRange()[0] + t * (this.stepDegreeRange()[1] - this.stepDegreeRange()[0]));
    });

    // Computed properties
    readonly diameter = computed(() => this.layoutService.isTouchInput() ? ROTATING_PICKER_DIAMETER * 1.3 : ROTATING_PICKER_DIAMETER);
    readonly radius = computed(() => this.diameter() / 2);
    readonly innerRadius = computed(() => this.radius() * 0.4);
    readonly notchIndices = computed(() => Array.from({ length: 24 }, (_, i) => i));

    readonly titleFontSize = computed(() => {
        const t = this.title();
        if (!t) return '1em';
        const maxWidth = 90; // available width inside the hex
        const avgCharWidth = 10; // px per char at base size
        const estimatedWidth = t.length * avgCharWidth;
        const scaleFactor = Math.min(1, maxWidth / estimatedWidth);
        const finalSize = Math.max(0.5, scaleFactor); // minimum 0.5em
        return `${finalSize}em`;
    });

    readonly isOverThreshold = computed(() => {
        const thresh = this.threshold();
        if (thresh === null) return false;
        return this.currentValue() > thresh;
    });

    readonly leftArrowPath = computed(() => {
        const centerX = this.radius();
        const centerY = this.radius();
        const arrowRadius = this.radius() + ARROW_DISTANCE; // Distance from dial border
        
        const startAngle = (-START_ARROW_DEG - 90) * Math.PI / 180;
        const endAngle = (-END_ARROW_DEG - 90) * Math.PI / 180;
        
        const startX = centerX + arrowRadius * Math.cos(startAngle);
        const startY = centerY + arrowRadius * Math.sin(startAngle);
        const endX = centerX + arrowRadius * Math.cos(endAngle);
        const endY = centerY + arrowRadius * Math.sin(endAngle);
        
        const largeArcFlag = Math.abs(END_ARROW_DEG - START_ARROW_DEG) > 180 ? 1 : 0;
        
        return `M ${startX} ${startY} A ${arrowRadius} ${arrowRadius} 0 ${largeArcFlag} 0 ${endX} ${endY}`;
    });

    readonly rightArrowPath = computed(() => {
        const centerX = this.radius();
        const centerY = this.radius();
        const arrowRadius = this.radius() + ARROW_DISTANCE; // Distance from dial border
        
        const startAngle = (START_ARROW_DEG - 90) * Math.PI / 180;
        const endAngle = (END_ARROW_DEG - 90) * Math.PI / 180;
        
        const startX = centerX + arrowRadius * Math.cos(startAngle);
        const startY = centerY + arrowRadius * Math.sin(startAngle);
        const endX = centerX + arrowRadius * Math.cos(endAngle);
        const endY = centerY + arrowRadius * Math.sin(endAngle);
        
        const largeArcFlag = Math.abs(END_ARROW_DEG - START_ARROW_DEG) > 180 ? 1 : 0;
        
        return `M ${startX} ${startY} A ${arrowRadius} ${arrowRadius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
    });

    readonly leftArrowHead = computed(() => {
        const centerX = this.radius();
        const centerY = this.radius();
        const arrowRadius = this.radius() + ARROW_DISTANCE - 1; // - half the width of the arrow path
        const endAngle = (-END_ARROW_DEG - 90 + 2) * Math.PI / 180;
        
        const endX = centerX + arrowRadius * Math.cos(endAngle);
        const endY = centerY + arrowRadius * Math.sin(endAngle);
        
        // Calculate tangent direction (perpendicular to radius) for sawtooth
        const tangentAngle = endAngle - Math.PI / 2; // Tangent points in direction of rotation
        const headLength = 16; // Elongated sawtooth length
        const headWidth = 8;   // Sawtooth width
        
        // Create elongated sawtooth pointing in rotation direction
        const tipX = endX + headLength * Math.cos(tangentAngle);
        const tipY = endY + headLength * Math.sin(tangentAngle);
        
        const baseAngle = tangentAngle + Math.PI / 2; // Perpendicular to tangent
        const baseX = endX + headWidth * Math.cos(baseAngle);
        const baseY = endY + headWidth * Math.sin(baseAngle);
        
        return `${tipX},${tipY} ${baseX},${baseY} ${endX},${endY}`;
    });

    readonly rightArrowHead = computed(() => {
        const centerX = this.radius();
        const centerY = this.radius();
        const arrowRadius = this.radius() + ARROW_DISTANCE - 1; // - half the width of the arrow path
        const endAngle = (END_ARROW_DEG - 90 - 2) * Math.PI / 180;
        
        const endX = centerX + arrowRadius * Math.cos(endAngle);
        const endY = centerY + arrowRadius * Math.sin(endAngle);
        
        // Calculate tangent direction (perpendicular to radius) for sawtooth
        const tangentAngle = endAngle + Math.PI / 2; // Tangent points in direction of rotation (opposite for right arrow)
        const headLength = 16; // Elongated sawtooth length
        const headWidth = 8;   // Sawtooth width

        // Create elongated sawtooth pointing in rotation direction
        const tipX = endX + headLength * Math.cos(tangentAngle);
        const tipY = endY + headLength * Math.sin(tangentAngle);
        
        const baseAngle = tangentAngle + Math.PI / 2; // Perpendicular to tangent
        const baseX = endX - headWidth * Math.cos(baseAngle);
        const baseY = endY - headWidth * Math.sin(baseAngle);

        return `${tipX},${tipY} ${baseX},${baseY} ${endX},${endY}`;
    });

    private isDragging = false;
    private lastPointerAngle = 0;
    private accumulatedAngle = 0;
    private lastDragChangedValue = false;
    private activePointerId: number | null = null;

    // Keyboard input state
    private keyboardInputBuffer = '';
    private keyboardInputTimeout: number | null = null;

    constructor() {
        // Effect to initialize currentValue from selected signal
        effect(() => {
            const selectedValue = this.selected();
            untracked(() => this.currentValue.set(this.clampValue(selectedValue)));
        });
        inject(DestroyRef).onDestroy(() => {     
            this.cleanupEventListeners();
            this.clearKeyboardInputTimeout();
        });
    }

    // Keyboard event handlers
    onKeyDown(event: KeyboardEvent): void {
        if (this.isDragging) return; // Don't handle keyboard input while dragging

        // Handle arrow keys
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.incrementValue(-1);
            return;
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.incrementValue(1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.incrementValue(10);
            return;
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.incrementValue(-10);
            return;
        }

        // Handle number input and minus sign
        if (this.isValidInputCharacter(event.key) || event.key === 'Backspace') {
            event.preventDefault();
            this.handleNumberInput(event.key);
            return;
        }
        // Handle Enter key to confirm current value
        if (event.key === 'Enter') {
            event.preventDefault();
            this.pick(this.currentValue());
            return;
        }

        // Handle Escape to cancel
        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancel();
            return;
        }
    }

    onWheel(event: WheelEvent): void {
        if (this.isDragging) return; // Don't handle wheel input while dragging

        event.preventDefault();
        event.stopPropagation();

        // Determine direction based on wheel delta
        // Positive deltaY means scrolling down (should decrement)
        // Negative deltaY means scrolling up (should increment)
        const direction = event.deltaY > 0 ? 1 : -1;
        this.incrementValue(direction);
    }

    // Lifecycle hooks
    ngAfterViewInit(): void {
        this.setupEventListeners();
        // Focus the container to enable keyboard input
        this.containerRef().nativeElement.focus();
        
        const event = this.initialEvent();
        if (event && event.type === 'pointerdown') {
            const pickerEl = this.pickerRef().nativeElement;
            const syntheticEvent = new PointerEvent('pointerdown', {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                button: event.button,
                pointerType: event.pointerType,
                pressure: event.pressure,
                isPrimary: event.isPrimary,
                bubbles: true,
                cancelable: true,
            });
            pickerEl.dispatchEvent(syntheticEvent);
        }
    }

    pick(value: number): void {
        this.picked.emit({ value });
    }

    cancel(): void {
        this.cancelled.emit();
    }

    onPointerDown(event: PointerEvent): void {
        if (event.button !== 0) return;
        if (this.activePointerId !== null) return; // Already handling a pointer
        this.initiateDrag(event);
    }

    // Keyboard input methods
    private isValidInputCharacter(key: string): boolean {
        return /^[0-9-]$/.test(key);
    }

    private handleNumberInput(key: string): void {
        // Clear any existing timeout
        this.clearKeyboardInputTimeout();

        if (key === 'Backspace') {
            if (this.keyboardInputBuffer.length === 0) {
                // If we have nothing in the buffer, start from current value
                this.keyboardInputBuffer = this.currentValue().toString();
            }
            if (this.keyboardInputBuffer.length > 0) {
                this.keyboardInputBuffer = this.keyboardInputBuffer.slice(0, -1);
                if (this.keyboardInputBuffer === '' || this.keyboardInputBuffer === '-') {
                    this.currentValue.set(0);
                } else {
                    const numericValue = parseInt(this.keyboardInputBuffer, 10);
                    if (!isNaN(numericValue)) {
                        const clampedValue = this.clampValue(numericValue);
                        this.currentValue.set(clampedValue);
                    }
                }
            }
            this.setKeyboardInputTimeout();
            return;
        }
        // Handle minus sign
        if (key === '-') {
            if (this.keyboardInputBuffer === '' || this.keyboardInputBuffer === '-') {
                this.keyboardInputBuffer = this.keyboardInputBuffer === '-' ? '' : '-';
            }
            // If buffer already has numbers, ignore the minus sign
            this.setKeyboardInputTimeout();
            return;
        }

        // Handle digits
        if (/^[0-9]$/.test(key)) {
            this.keyboardInputBuffer += key;
            const numericValue = parseInt(this.keyboardInputBuffer, 10);
            
            if (!isNaN(numericValue)) {
                const clampedValue = this.clampValue(numericValue);
                this.currentValue.set(clampedValue);
            }
            
            this.setKeyboardInputTimeout();
        }
    }

    private setKeyboardInputTimeout(): void {
        this.clearKeyboardInputTimeout();
        this.keyboardInputTimeout = window.setTimeout(() => {
            this.keyboardInputBuffer = '';
            this.keyboardInputTimeout = null;
        }, KEYBOARD_INPUT_TIMEOUT);
    }

    private clearKeyboardInputTimeout(): void {
        if (this.keyboardInputTimeout !== null) {
            clearTimeout(this.keyboardInputTimeout);
            this.keyboardInputTimeout = null;
        }
    }

    private incrementValue(direction: number): void {
        const newValue = this.currentValue() + (direction * this.step());
        this.currentValue.set(this.clampValue(newValue));
    }

    private initiateDrag(event: PointerEvent): void {
        this.activePointerId = event.pointerId;
        const nativeEl = this.pickerRef().nativeElement;
        // Capture the pointer on the picker element itself to ensure subsequent events are routed correctly.
        try {
            nativeEl.setPointerCapture(this.activePointerId);
        } catch (e) {
            // Failed to capture pointer
            this.activePointerId = null;
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        // We don't start dragging immediately. We wait for the pointer to move into the donut.
        // Add listeners that will handle the state transition.
        nativeEl.addEventListener('pointermove', this.onPointerMove);
        nativeEl.addEventListener('pointerup', this.onPointerUp, { once: true });
        nativeEl.addEventListener('pointercancel', this.onPointerUp, { once: true });

        // Check if the initial event is already in a valid drag position
        this.onPointerMove(event);
    }

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        event.preventDefault();

        if (!this.isDragging) {
            // Check if we should START dragging
            const pickerRect = this.pickerRef().nativeElement.getBoundingClientRect();
            const centerX = pickerRect.left + pickerRect.width / 2;
            const centerY = pickerRect.top + pickerRect.height / 2;
            const distance = Math.sqrt(Math.pow(event.clientX - centerX, 2) + Math.pow(event.clientY - centerY, 2));

            if (distance >= this.innerRadius() && distance <= this.radius()) {
                // Pointer has entered the donut, start the drag!
                this.isDragging = true;
                this.containerRef().nativeElement.classList.add('grabbing');
                this.lastPointerAngle = this.getPointerAngle(event);
                // If the previous drag already produced a value change, clear any leftover
                // partial arc so the next drag starts fresh. Otherwise keep accumulatedAngle
                // so many small nudges across separate drags can add up.
                if (this.lastDragChangedValue) {
                    this.accumulatedAngle = 0;
                    this.lastDragChangedValue = false;
                }
            } else {
                // Not dragging and not in the start zone, so do nothing.
                return;
            }
        }

        // --- From here on, we are definitely dragging ---
        const currentPointerAngle = this.getPointerAngle(event);
        let deltaAngle = currentPointerAngle - this.lastPointerAngle;

        // Handle angle wrap around (1 to 359 degrees)
        if (deltaAngle > 180) deltaAngle -= 360;
        if (deltaAngle < -180) deltaAngle += 360;

        const oldValue = this.currentValue();
        const rotationBuffer = this.rotationStepDegrees();

        // Apply rotation buffer at limits
        if ((oldValue <= this.min() && this.accumulatedAngle + deltaAngle < -rotationBuffer) ||
            (oldValue >= this.max() && this.accumulatedAngle + deltaAngle > rotationBuffer)) {
            // We still need to update the last pointer angle to avoid jumps.
            this.lastPointerAngle = currentPointerAngle;
            return;
        }

        this.lastPointerAngle = currentPointerAngle;
        this.accumulatedAngle += deltaAngle;

        const steps = Math.trunc(this.accumulatedAngle / this.rotationStepDegrees());

        if (steps !== 0) {
            const newValue = this.currentValue() + steps * this.step();
            const clamped = this.clampValue(newValue);
            this.currentValue.set(clamped);

            // Haptic feedback for each step changed
            const changedSteps = Math.round((clamped - oldValue) / this.step()) || 0;
            for (let i = 0; i < Math.abs(changedSteps); i++) {
                vibrate();
            }

            this.accumulatedAngle -= steps * this.rotationStepDegrees();
            this.lastDragChangedValue = true;
        }

        this.rotationAngle.update(angle => angle + deltaAngle);
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;

        if (!this.isDragging) {
            const target = document.elementFromPoint(event.clientX, event.clientY) as SVGElement;
            if (target && target.classList.contains('dial-center-area')) {
                this.pick(this.currentValue());
            }
        }
        // Clean up regardless of whether a drag occurred
        if (this.activePointerId !== null) {
            (event.target as HTMLElement).releasePointerCapture(this.activePointerId);
            this.activePointerId = null;
        }
        this.isDragging = false;
        this.containerRef().nativeElement.classList.remove('grabbing');
        this.pickerRef().nativeElement.removeEventListener('pointermove', this.onPointerMove);
        this.pickerRef().nativeElement.removeEventListener('pointercancel', this.onPointerUp);
    };

    private readonly handleOutsideClick = (ev: MouseEvent): void => {
        if (this.isDragging || this.activePointerId !== null) return;
        const target = ev.target as HTMLElement;
        if (!target?.closest('.rotating-picker-container')) {
            this.cancel();
        }
    };

    private setupEventListeners(): void {
        window.addEventListener('pointerdown', this.handleOutsideClick, { capture: true });
    }

    private cleanupEventListeners(): void {
        window.removeEventListener('pointerdown', this.handleOutsideClick, true);
        const nativeEl = this.pickerRef().nativeElement;
        if (nativeEl) {
            nativeEl.removeEventListener('pointermove', this.onPointerMove);
            nativeEl.removeEventListener('pointerup', this.onPointerUp);
            nativeEl.removeEventListener('pointercancel', this.onPointerUp);
        }
    }

    private getPointerAngle(event: PointerEvent): number {
        const pickerRect = this.pickerRef().nativeElement.getBoundingClientRect();
        const centerX = pickerRect.left + pickerRect.width / 2;
        const centerY = pickerRect.top + pickerRect.height / 2;
        const angleRad = Math.atan2(event.clientY - centerY, event.clientX - centerX);
        return angleRad * (180 / Math.PI);
    }

    private clampValue(value: number): number {
        const steppedValue = Math.round(value / this.step()) * this.step();
        return Math.max(this.min(), Math.min(this.max(), steppedValue));
    }
}