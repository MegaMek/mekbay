// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, computed, Directive, effect, type ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import type { ChoicePickerComponent, PickerChoice, PickerPosition, PickerValue } from '../picker/picker.interface';

@Directive()
export abstract class LinearPickerBaseComponent implements ChoicePickerComponent {
    private readonly injector = inject(Injector);
    public readonly layoutService = inject(LayoutService);

    readonly title = input<string | null>(null);
    readonly values = signal<PickerChoice[]>([]);
    readonly selected = input<PickerValue | null>(null);
    readonly position = input<PickerPosition>({ x: 0, y: 0 });
    readonly lightTheme = input<boolean>(false);
    readonly initialEvent = signal<PointerEvent | null>(null);

    picked = output<PickerChoice>();
    cancelled = output<void>();

    hoveredChoice = signal<PickerChoice | null>(null);

    readonly selectedChoice = computed(() => {
        const selectedValue = this.selected();
        return selectedValue ? this.values().find(c => c.value === selectedValue) ?? null : null;
    });

    pickerRef = viewChild.required<ElementRef<HTMLDivElement>>('picker');

    private longPressTimeout?: number;
    private pointerDownInside = false;
    private initialPositionSet = false;

    constructor() {
        effect((cleanup) => {
            const afterRenderRef = afterNextRender(() => {
                this.setupEventListeners();
                requestAnimationFrame(() => {
                    const picker = this.pickerRef()?.nativeElement;
                    if (picker) {
                        this.positionPicker(picker);
                        this.initialPositionSet = true;
                    }
                });
            }, { injector: this.injector });

            cleanup(() => {
                afterRenderRef.destroy();
                this.cleanupEventListeners();
            });
        });

        effect(() => {
            this.position();
            const picker = this.pickerRef()?.nativeElement;
            if (this.initialPositionSet && picker) {
                this.positionPicker(picker);
            }
        });
    }

    protected abstract positionPicker(picker: HTMLDivElement): void;

    isSelected(choice: PickerChoice): boolean {
        return choice.value === this.selected();
    }

    isHovered(choice: PickerChoice): boolean {
        return choice === this.hoveredChoice();
    }

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

    protected selectedCell(picker: HTMLDivElement): HTMLElement | null {
        const selectedValue = this.selected();
        const selectedIdx = selectedValue !== null ? this.values().findIndex(choice => choice.value === selectedValue) : -1;
        if (selectedIdx === -1) {
            return null;
        }

        const cells = Array.from(picker.querySelectorAll('.value-cell')) as HTMLElement[];
        return cells[selectedIdx] ?? null;
    }

    protected centerPickerAtPosition(picker: HTMLDivElement): void {
        picker.style.left = `${this.position().x}px`;
        picker.style.top = `${this.position().y}px`;
        picker.style.transform = 'translate(-50%, -50%)';
    }

    protected centerPickerOnSelectedCell(picker: HTMLDivElement, selectedCell: HTMLElement): void {
        const pickerRect = picker.getBoundingClientRect();
        const cellRect = selectedCell.getBoundingClientRect();
        const cellCenterX = (cellRect.left - pickerRect.left) + cellRect.width / 2;
        const cellCenterY = (cellRect.top - pickerRect.top) + cellRect.height / 2;
        let pickerOffsetX = this.position().x - cellCenterX;
        const pickerOffsetY = this.position().y - cellCenterY;

        if (this.layoutService.isTouchInput()) {
            pickerOffsetX -= (cellRect.width / 3);
        }

        picker.style.transform = `translate(${pickerOffsetX}px, ${pickerOffsetY}px)`;
        picker.style.left = '0px';
        picker.style.top = '0px';
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

    private readonly onPointerDownInside = (): void => {
        this.pointerDownInside = true;
    };

    private readonly handleQuickClickPointerUp = (_event: PointerEvent): void => {
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