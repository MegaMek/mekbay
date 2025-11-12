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
import { Component, ElementRef, signal, output, computed, inject, Injector, ChangeDetectionStrategy, viewChild, afterNextRender, effect } from '@angular/core';
import { PickerComponent, PickerChoice, PickerValue } from '../picker/picker.interface';

/*
 * Author: Drake
 */
@Component({
    selector: 'linear-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
        <div #picker class="linear-picker" 
                [class.touch]="interactionType() === 'touch'"
                [class.horizontal]="horizontal()"
                [class.vertical]="!horizontal()"
        >    
            @for (choice of values(); let i = $index; track choice.value) {
                <div class="value-cell"
                    [class.selected]="isSelected(choice)"
                    [class.highlight]="isHovered(choice) && !choice.disabled"
                    [class.disabled]="choice.disabled"
                    [attr.data-title]="isSelected(choice) ? title() : null"
                    (pointerenter)="setHoveredChoice(choice)"
                    (pointerleave)="resetHovered()"
                    (pointerdown)="setHoveredChoice(choice)"
                    (click)="handleChoiceClick($event, choice)">
                    {{ choice.label }}
                </div>
            }
        </div>
    `,
    styles: [`
    .linear-picker {
        font-family: 'Roboto', sans-serif;
        position: fixed;
        z-index: 9999;
        user-select: none;
        padding: 0;
        background: #000;
        color: #fff;
        border: 2px solid #fff;
        width: auto;
        min-width: max-content;
        white-space: nowrap;
    }
    
    /* Horizontal layout */
    .linear-picker.horizontal {
        display: flex;
        flex-direction: row;
    }
    
    /* Vertical layout (default) */
    .linear-picker.vertical {
        display: flex;
        flex-direction: column;
    }
    
    .value-cell.selected[data-title]::before {
        position: absolute;
        height: 100%;
        min-height: 100%;
        display: flex;
        align-items: center;
        padding-left: 12px;
        padding-right: 12px;
        border: 2px solid #000;
        content: attr(data-title);
        background-color: #000;
        color: #fff;
        white-space: nowrap;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        box-sizing: border-box;
        font-weight: bold;
    }
    
    /* Vertical layout title positioning */
    .linear-picker.vertical .value-cell.selected[data-title]::before {
        top: 0;
        right: 100%;
    }
    
    /* Horizontal layout title positioning */
    .linear-picker.horizontal .value-cell.selected[data-title]::before {
        bottom: 100%;
        left: 0;
        width: 100%;
        min-width: 100%;
        height: auto;
        min-height: auto;
        justify-content: center;
    }
    
    .value-cell {
        position: relative;
        font-size: 0.8em;
        text-align: center;
        cursor: pointer;
        transition: background-color 0.15s ease-in-out;
        flex-shrink: 0;
    }
    
    .value-cell.disabled {
        cursor: not-allowed;
        color: #666;
        opacity: 0.6;
    }
    
    /* Vertical layout cell styling */
    .linear-picker.vertical .value-cell {
        padding: 2px 8px;
    }
    .linear-picker.vertical.touch .value-cell {
        padding: 3px 64px 3px 8px;
        font-size: 0.9em;
        text-align: right;
    }

    /* Horizontal layout cell styling */
    .linear-picker.horizontal .value-cell {
        padding: 8px 12px;
        border-right: 1px solid rgba(255, 255, 255, 0.3);
    }
    
    .linear-picker.horizontal .value-cell:last-child {
        border-right: none;
    }
    
    .linear-picker.horizontal.touch .value-cell {
        padding: 12px 16px;
        font-size: 1em;
    }
    
    .value-cell.selected {
        background: var(--bt-yellow-background-bright);
        font-weight: bold;
        z-index: 2;
    }
    
    /* Vertical layout selected cell */
    .linear-picker.vertical .value-cell.selected {
        padding-top: 4px !important;
        padding-bottom: 4px !important;
    }
    
    /* Horizontal layout selected cell */
    .linear-picker.horizontal .value-cell.selected {
        padding-left: 16px !important;
        padding-right: 16px !important;
    }
    
    .value-cell.highlight:not(.disabled) {
        background: var(--bt-yellow);
    }
    
    /* Night mode styles */
    :host-context(.night-mode) .linear-picker {
        background: #fff;
        color: #000;
        border-color: #000;
    }
    
    :host-context(.night-mode) .value-cell.selected[data-title]::before {
        background: #fff;
        color: #000;
        border-color: #000;
    }
    
    :host-context(.night-mode) .value-cell.disabled {
        color: #999;
        background: #ccc;
    }
    
    :host-context(.night-mode) .value-cell.selected {
        background: var(--bt-yellow-background-light);
    }
    
    :host-context(.night-mode) .value-cell.highlight:not(.disabled) {
        background: var(--bt-yellow-strong);
    }
    
    :host-context(.night-mode) .linear-picker.horizontal .value-cell {
        border-right-color: rgba(0, 0, 0, 0.3);
    }
`]
})
export class LinearPickerComponent implements PickerComponent {
    private readonly injector = inject(Injector);

    // Input signals
    readonly interactionType = signal<'mouse' | 'touch'>('mouse');
    readonly title = signal<string | null>(null);
    readonly values = signal<PickerChoice[]>([]);
    readonly selected = signal<PickerValue | null>(null);
    readonly position = signal<{ x: number, y: number }>({ x: 0, y: 0 });
    readonly horizontal = signal<boolean>(false);
    readonly align = signal<'topleft' | 'left' | 'center'>('center');
    readonly initialEvent = signal<PointerEvent | null>(null);

    picked = output<PickerValue>();
    cancelled = output<void>();

    hoveredChoice = signal<PickerChoice | null>(null);

    pickerRef = viewChild.required<ElementRef<HTMLDivElement>>('picker');

    // Computed properties
    readonly selectedChoice = computed(() => {
        const selectedValue = this.selected();
        return selectedValue ? this.values().find(c => c.value === selectedValue) ?? null : null;
    });

    // Private properties
    private longPressTimeout?: number;
    private pointerDownInside = false;

    constructor() {
        effect((cleanup) => {
            afterNextRender(() => {
                this.setupEventListeners();
                requestAnimationFrame(() => {
                    if (this.pickerRef()?.nativeElement) {
                        this.centerSelectedCell();
                    }
                });
            }, { injector: this.injector });

            cleanup(() => {
                this.cleanupEventListeners();
            });
        });
    }

    // Helper methods
    isSelected(choice: PickerChoice): boolean {
        return choice.value === this.selected();
    }

    isHovered(choice: PickerChoice): boolean {
        return choice === this.hoveredChoice();
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
        } else 
        if (align === 'left') {
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
        
        if (this.interactionType() === 'touch') {
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
        this.pick(hoveredChoice.value);
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