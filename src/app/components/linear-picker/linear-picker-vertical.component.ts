// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LinearPickerBaseComponent } from './linear-picker-base.component';

@Component({
    selector: 'linear-picker-vertical',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './linear-picker-vertical.component.html',
    styleUrls: ['./linear-picker-common.scss', './linear-picker-vertical.component.scss']
})
export class LinearPickerVerticalComponent extends LinearPickerBaseComponent {
    readonly labelOnRight = signal<boolean>(false);

    protected positionPicker(picker: HTMLDivElement): void {
        const selectedCell = this.selectedCell(picker);
        if (!selectedCell) {
            this.centerPickerAtPosition(picker);
        } else {
            this.centerPickerOnSelectedCell(picker, selectedCell);
        }
        this.computeLabelSide(picker);
    }

    private computeLabelSide(picker: HTMLDivElement): void {
        const rect = picker.getBoundingClientRect();
        const labelWidth = 150;
        const leftSpace = rect.left;
        const rightSpace = window.innerWidth - rect.right;

        this.labelOnRight.set(leftSpace < labelWidth && rightSpace > leftSpace);
    }
}
