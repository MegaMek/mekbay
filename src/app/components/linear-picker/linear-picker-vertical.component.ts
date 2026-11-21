// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { LinearPickerBaseComponent } from './linear-picker-base.component';
import type { LinearPickerLayout } from '../../models/options.model';
import type { PickerPosition } from '../picker/picker.interface';

/** The longest label of a number list, such as "-500" or "..."; a list with longer labels holds words and stays vertical. */
const DIAGONAL_LABEL_LENGTH = 4;
const DIAGONAL_CELL_PADDING = 8;
const DIAGONAL_EDGE_GAP = 4;

type Size = Readonly<{ width: number; height: number }>;

/** A diagonal list: its angle, cell size, where its first cell starts along the line, and where its title goes. */
export interface DiagonalPickerGeometry {
    /** Radians, from the anchor toward the farthest viewport corner. */
    readonly angle: number;
    readonly cellLength: number;
    readonly thickness: number;
    /** Distance along the line from the anchor to the list's start; negative lies behind the anchor. */
    readonly start: number;
    /** The title's centre, beside the selected cell on the side with more room. */
    readonly title: PickerPosition | null;
}

/**
 * Lays a list from `anchor` toward the farthest viewport corner, its upright labels inside cells sized for them, and
 * centres the selected cell (else the first) on the anchor. The list then slides along its line to stay on screen;
 * a list longer than the screen keeps its start on screen.
 */
export function diagonalPickerGeometry(
    anchor: PickerPosition,
    viewport: Size,
    label: Size,
    cells: number,
    selectedIndex: number,
    minCell: number,
    title: Size | null,
): DiagonalPickerGeometry {
    const angle = Math.atan2(
        (anchor.y < viewport.height / 2 ? viewport.height : 0) - anchor.y,
        (anchor.x < viewport.width / 2 ? viewport.width : 0) - anchor.x,
    );
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const cellLength = Math.max(minCell, label.width * Math.abs(dx) + label.height * Math.abs(dy) + DIAGONAL_CELL_PADDING);
    const thickness = Math.max(minCell, label.width * Math.abs(dy) + label.height * Math.abs(dx) + DIAGONAL_CELL_PADDING);
    const margin = thickness / 2 + DIAGONAL_EDGE_GAP;
    const [xFrom, xTo] = onScreen(anchor.x, dx, viewport.width, margin);
    const [yFrom, yTo] = onScreen(anchor.y, dy, viewport.height, margin);
    const centred = -(Math.max(0, selectedIndex) + 0.5) * cellLength;
    const start = Math.max(Math.max(xFrom, yFrom), Math.min(centred, Math.min(xTo, yTo) - cells * cellLength));
    const along = start - centred;
    const selected = { x: anchor.x + along * dx, y: anchor.y + along * dy };
    return { angle, cellLength, thickness, start, title: title && titleCentre(selected, angle, thickness, viewport, title) };
}

/** Beside the selected cell, clear of the list, on the side with more room. */
function titleCentre(selected: PickerPosition, angle: number, thickness: number, viewport: Size, title: Size): PickerPosition {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const offset = thickness / 2 + DIAGONAL_EDGE_GAP + (title.width * Math.abs(dy) + title.height * Math.abs(dx)) / 2;
    const [first, second] = [1, -1].map(side => ({ x: selected.x - side * dy * offset, y: selected.y + side * dx * offset }));
    const room = ({ x, y }: PickerPosition): number => Math.min(
        x - title.width / 2, viewport.width - x - title.width / 2,
        y - title.height / 2, viewport.height - y - title.height / 2);
    const centre = room(first) >= room(second) ? first : second;
    return {
        x: clamp(centre.x, title.width / 2 + DIAGONAL_EDGE_GAP, viewport.width - title.width / 2 - DIAGONAL_EDGE_GAP),
        y: clamp(centre.y, title.height / 2 + DIAGONAL_EDGE_GAP, viewport.height - title.height / 2 - DIAGONAL_EDGE_GAP),
    };
}

/** Where along a line from `from`, moving `step` per unit, it lies within [margin, size - margin] on one axis. */
function onScreen(from: number, step: number, size: number, margin: number): [number, number] {
    if (step === 0) return [-Infinity, Infinity];
    const low = (margin - from) / step;
    const high = (size - margin - from) / step;
    return [Math.min(low, high), Math.max(low, high)];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

@Component({
    selector: 'linear-picker-vertical',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './linear-picker-vertical.component.html',
    styleUrls: ['./linear-picker-common.scss', './linear-picker-vertical.component.scss']
})
export class LinearPickerVerticalComponent extends LinearPickerBaseComponent {
    readonly layout = input<LinearPickerLayout>('vertical');
    readonly labelOnRight = signal<boolean>(false);
    /** Lists of numbers follow the diagonal layout; lists of words, such as attack directions, stay vertical. */
    readonly diagonal = computed(() => this.layout() === 'diagonal'
        && this.values().every(choice => (choice.displayType ?? 'button') === 'button'
            && (choice.shortLabel ?? choice.label).length <= DIAGONAL_LABEL_LENGTH));
    /** The diagonal list stays hidden until it is measured and placed. */
    readonly placed = signal(false);

    protected positionPicker(picker: HTMLDivElement): void {
        if (this.diagonal()) {
            this.placeDiagonal(picker);
            return;
        }
        const selectedCell = this.selectedCell(picker);
        if (!selectedCell) {
            this.centerPickerAtPosition(picker);
        } else {
            this.centerPickerOnSelectedCell(picker, selectedCell);
        }
        this.computeLabelSide(picker);
    }

    private placeDiagonal(picker: HTMLDivElement): void {
        // Layout sizes, which the rotation does not change.
        const labels = [...picker.querySelectorAll<HTMLElement>('.value-label')];
        const title = picker.parentElement?.querySelector<HTMLElement>('.linear-picker-diagonal-title');
        const selected = this.selected();
        const anchor = this.position();
        const geometry = diagonalPickerGeometry(
            anchor,
            { width: window.innerWidth, height: window.innerHeight },
            {
                width: Math.max(...labels.map(label => label.offsetWidth)),
                height: Math.max(...labels.map(label => label.offsetHeight)),
            },
            labels.length,
            selected === null ? -1 : this.values().findIndex(choice => choice.value === selected),
            this.layoutService.isTouchInput() ? 28 : 22,
            title ? { width: title.offsetWidth, height: title.offsetHeight } : null,
        );
        picker.style.left = `${anchor.x}px`;
        picker.style.top = `${anchor.y}px`;
        picker.style.setProperty('--diagonal-angle', `${geometry.angle}rad`);
        picker.style.setProperty('--diagonal-start', `${geometry.start}px`);
        picker.style.setProperty('--diagonal-cell-length', `${geometry.cellLength}px`);
        picker.style.setProperty('--diagonal-thickness', `${geometry.thickness}px`);
        if (title && geometry.title) {
            title.style.left = `${geometry.title.x}px`;
            title.style.top = `${geometry.title.y}px`;
        }
        this.placed.set(true);
    }

    private computeLabelSide(picker: HTMLDivElement): void {
        const rect = picker.getBoundingClientRect();
        const labelWidth = 150;
        const leftSpace = rect.left;
        const rightSpace = window.innerWidth - rect.right;

        this.labelOnRight.set(leftSpace < labelWidth && rightSpace > leftSpace);
    }
}
