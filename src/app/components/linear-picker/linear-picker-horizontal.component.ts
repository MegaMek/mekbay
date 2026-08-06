// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LinearPickerBaseComponent } from './linear-picker-base.component';

@Component({
    selector: 'linear-picker-horizontal',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './linear-picker-horizontal.component.html',
    styleUrls: ['./linear-picker-common.scss', './linear-picker-horizontal.component.scss']
})
export class LinearPickerHorizontalComponent extends LinearPickerBaseComponent {
    readonly align = input<'topleft' | 'left' | 'center' | 'top'>('center');

    protected positionPicker(picker: HTMLDivElement): void {
        const align = this.align();

        if (align === 'topleft') {
            this.positionPickerTopLeft(picker);
        } else if (align === 'top') {
            this.positionPickerTop(picker);
        } else if (align === 'left') {
            this.positionPickerLeft(picker);
        } else {
            this.recenterPicker(picker);
        }
    }

    private recenterPicker(picker: HTMLDivElement): void {
        const selectedCell = this.selectedCell(picker);
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
}