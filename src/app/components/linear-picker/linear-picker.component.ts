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


import { Component, ElementRef, signal, output, computed, inject, Injector, ChangeDetectionStrategy, viewChild, afterNextRender, effect, input } from '@angular/core';
import { ChoicePickerComponent, PickerChoice, PickerPosition, PickerValue } from '../picker/picker.interface';
import { LayoutService } from '../../services/layout.service';

/*
 * Author: Drake
 * 
 * Linear Picker - A horizontal or vertical list picker for selecting from choices.
 * 
 * Usage:
 *   <linear-picker
 *     [title]="'SELECT'"
 *     [values]="choices"
 *     [selected]="currentValue"
 *     [horizontal]="true"
 *     [align]="'center'"
 *     (picked)="onChoicePicked($event)"
 *     (cancelled)="onCancelled()"
 *   />
 */
@Component({
    selector: 'linear-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './linear-picker.component.html',
    styleUrls: ['./linear-picker.component.scss']
})
export class LinearPickerComponent implements ChoicePickerComponent {
    private readonly injector = inject(Injector);
    public readonly layoutService = inject(LayoutService);

    // ChoicePickerComponent interface inputs
    readonly title = input<string | null>(null);
    readonly values = signal<PickerChoice[]>([]);
    readonly selected = input<PickerValue | null>(null);
    readonly position = input<PickerPosition>({ x: 0, y: 0 });
    readonly lightTheme = input<boolean>(false);
    readonly initialEvent = signal<PointerEvent | null>(null);
    
    // Linear-picker specific inputs
    readonly horizontal = input<boolean>(false);
    readonly align = input<'topleft' | 'left' | 'center' | 'top'>('center');

    // ChoicePickerComponent interface outputs
    picked = output<PickerChoice>();
    cancelled = output<void>();

    // Internal state
    hoveredChoice = signal<PickerChoice | null>(null);
    labelOnRight = signal<boolean>(false);

    pickerRef = viewChild.required<ElementRef<HTMLDivElement>>('picker');

    // Computed properties
    readonly selectedChoice = computed(() => {
        const selectedValue = this.selected();
        return selectedValue ? this.values().find(c => c.value === selectedValue) ?? null : null;
    });

    // Private properties
    private longPressTimeout?: number;
    private pointerDownInside = false;
    private initialPositionSet = false;

    constructor() {
        effect((cleanup) => {
            afterNextRender(() => {
                this.setupEventListeners();
                requestAnimationFrame(() => {
                    if (this.pickerRef()?.nativeElement) {
                        this.centerSelectedCell();
                        this.computeLabelSide();
                        this.initialPositionSet = true;
                    }
                });
            }, { injector: this.injector });

            cleanup(() => {
                this.cleanupEventListeners();
            });
        });
        
        // Watch for position changes and re-position the picker (for scroll updates)
        effect(() => {
            const pos = this.position();
            // Only update after initial positioning is set
            if (this.initialPositionSet && this.pickerRef()?.nativeElement) {
                this.updatePosition();
            }
        });
    }
    
    /** Re-position the picker when position input changes (e.g., during scroll) */
    private updatePosition(): void {
        const picker = this.pickerRef()?.nativeElement;
        if (!picker) return;
        
        const align = this.align();
        
        if (align === 'topleft') {
            this.positionPickerTopLeft(picker);
        } else if (align === 'top') {
            this.positionPickerTop(picker);
        } else if (align === 'left') {
            this.positionPickerLeft(picker);
        } else {
            // For 'center' alignment with selected cell, just update transform
            this.recenterPicker(picker);
        }
    }
    
    /** Recenter the picker based on current position */
    private recenterPicker(picker: HTMLDivElement): void {
        const selectedValue = this.selected();
        const cells = Array.from(picker.querySelectorAll('.value-cell')) as HTMLElement[];
        const selectedIdx = selectedValue !== null ? this.values().findIndex(choice => choice.value === selectedValue) : -1;
        
        if (selectedIdx === -1) {
            this.centerPickerAtPosition(picker);
            return;
        }
        
        const selectedCell = cells[selectedIdx];
        if (!selectedCell) {
            this.centerPickerAtPosition(picker);
            return;
        }
        
        this.centerPickerOnSelectedCell(picker, selectedCell);
    }

    // Helper methods
    isSelected(choice: PickerChoice): boolean {
        return choice.value === this.selected();
    }

    isHovered(choice: PickerChoice): boolean {
        return choice === this.hoveredChoice();
    }

    /** Compute whether the label should display on right side based on viewport space */
    private computeLabelSide(): void {
        if (this.horizontal()) return;
        const picker = this.pickerRef()?.nativeElement;
        if (!picker) return;
        
        const rect = picker.getBoundingClientRect();
        const labelWidth = 150; // Approximate label width
        const leftSpace = rect.left;
        const rightSpace = window.innerWidth - rect.right;
        
        // Default left, switch to right if left overflows more
        this.labelOnRight.set(leftSpace < labelWidth && rightSpace > leftSpace);
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
        this.pick(choice);
    }

    handleDropdownChange(event: Event, choice: PickerChoice): void {
        const selectElement = event.target as HTMLSelectElement;
        const selectedValue = selectElement.value;
        const selectedOption = choice.choices?.find(c => c.value == selectedValue);
        if (selectedOption) {
            const newChoice = { ...choice, value: selectedOption.value, label: selectedOption.label };
            this.pick(newChoice);
        }
    }

    pick(val: PickerChoice): void {
        this.picked.emit(val);
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

        window.addEventListener('pointermove', this.pointerMoveListener, { capture: true });
        window.addEventListener('pointerdown', this.handleOutsideClick, { capture: true });

        const el = this.pickerRef()?.nativeElement;
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
        window.removeEventListener('pointermove', this.pointerMoveListener, true);
        window.removeEventListener('pointerdown', this.handleOutsideClick, true);

        const el = this.pickerRef()?.nativeElement;
        if (el) {
            el.removeEventListener('pointerdown', this.onPointerDownInside, { capture: true });
            el.removeEventListener('contextmenu', this.noContextMenu);
        }
    }

    private centerSelectedCell(): void {
        const picker = this.pickerRef()?.nativeElement;
        const cells = Array.from(picker.querySelectorAll('.value-cell')) as HTMLElement[];
        const selectedValue = this.selected();
        const selectedIdx = selectedValue !== null ? this.values().findIndex(choice => choice.value === selectedValue) : -1;
        const align = this.align();
            
        if (align === 'topleft') {
            this.positionPickerTopLeft(picker);
            return;
        } else if (align === 'top') {
            this.positionPickerTop(picker);
            return;
        } else if (align === 'left') {
            this.positionPickerLeft(picker);
            return;
        }

        if (selectedIdx === -1) {
            this.centerPickerAtPosition(picker);
            return;
        }

        const selectedCell = cells[selectedIdx];
        if (!selectedCell) {
            this.centerPickerAtPosition(picker);
            return;
        }

        this.centerPickerOnSelectedCell(picker, selectedCell);
    }

    private positionPickerTopLeft(picker: HTMLDivElement): void {
        let leftPosition = Math.max(0, this.position().x);
        picker.style.left = `${leftPosition}px`;
        picker.style.top = `${this.position().y}px`;
        picker.style.transform = 'translateY(-100%)';
        picker.style.visibility = 'hidden';
        
        // Check if picker overflows the right side of viewport
        requestAnimationFrame(() => {
            const pickerRect = picker.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            
            if (pickerRect.right > viewportWidth) {
                const overflow = pickerRect.right - viewportWidth;
                leftPosition = Math.max(0, leftPosition - overflow);
                picker.style.left = `${leftPosition}px`;
            }
            picker.style.visibility = 'visible';
        });
    }

    private positionPickerTop(picker: HTMLDivElement): void {
        picker.style.left = `${this.position().x}px`;
        picker.style.top = `${this.position().y}px`;
        picker.style.transform = 'translate(-50%, -100%)';
        picker.style.visibility = 'hidden';
        
        // Check if picker overflows the viewport and adjust
        requestAnimationFrame(() => {
            const pickerRect = picker.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            let adjustX = 0;
            
            if (pickerRect.left < 0) {
                adjustX = -pickerRect.left;
            } else if (pickerRect.right > viewportWidth) {
                adjustX = viewportWidth - pickerRect.right;
            }
            
            if (adjustX !== 0) {
                picker.style.transform = `translate(calc(-50% + ${adjustX}px), -100%)`;
            }
            picker.style.visibility = 'visible';
        });
    }

    private positionPickerLeft(picker: HTMLDivElement): void {
        let leftPosition = Math.max(0, this.position().x);
        picker.style.left = `${leftPosition}px`;
        picker.style.top = `${this.position().y}px`;
        picker.style.transform = 'translateY(-50%)';
        picker.style.visibility = 'hidden';
        
        // Check if picker overflows the right side of viewport
        requestAnimationFrame(() => {
            const pickerRect = picker.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            
            if (pickerRect.right > viewportWidth) {
                const overflow = pickerRect.right - viewportWidth;
                leftPosition = Math.max(0, leftPosition - overflow);
                picker.style.left = `${leftPosition}px`;
            }
            picker.style.visibility = 'visible';
        });
    }

    private centerPickerAtPosition(picker: HTMLDivElement): void {
        picker.style.left = `${this.position().x}px`;
        picker.style.top = `${this.position().y}px`;
        picker.style.transform = 'translate(-50%, -50%)';
    }

    private centerPickerOnSelectedCell(picker: HTMLDivElement, selectedCell: HTMLElement): void {
        const pickerRect = picker.getBoundingClientRect();
        const cellRect = selectedCell.getBoundingClientRect();
        const cellCenterX = (cellRect.left - pickerRect.left) + cellRect.width / 2;
        const cellCenterY = (cellRect.top - pickerRect.top) + cellRect.height / 2;
        let pickerOffsetX = this.position().x - cellCenterX;
        const pickerOffsetY = this.position().y - cellCenterY;
        
        if (this.layoutService.isTouchInput()) {
            // For touch interaction, adjust the offset to center the cell
            pickerOffsetX -= (cellRect.width / 3);
        }
        
        picker.style.transform = `translate(${pickerOffsetX}px, ${pickerOffsetY}px)`;
        picker.style.left = '0px';
        picker.style.top = '0px';
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
        this.pick(hoveredChoice);
    };

    private readonly handleOutsideClick = (event: PointerEvent): void => {
        const target = event.target as HTMLElement;
        if (!target?.closest('.linear-picker')) {
            this.cancel();
        }
    };

    
    private readonly pointerMoveListener = (event: PointerEvent): void => {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const cell = element?.closest('.value-cell') as HTMLElement | null;
        
        if (cell) {
            // Find the choice by checking which cell this is
            const allCells = Array.from(this.pickerRef()?.nativeElement.querySelectorAll('.value-cell'));
            const cellIndex = allCells.indexOf(cell);
            const choice = this.values()[cellIndex];
            
            if (choice && !choice.disabled) {
                this.setHoveredChoice(choice);
            }
        } else {
            this.resetHovered();
        }
    };

}