// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    Directive,
    ElementRef,
    type OnDestroy,
    afterRenderEffect,
    inject,
    input,
} from '@angular/core';

const PIPS_PER_GROUP = 5;
export const TACTICAL_PIP_DEFAULT_ROWS = 2;
export const TACTICAL_PIP_GROUP_WIDTH = 49;
export const TACTICAL_PIP_COLUMN_GAP = 10;
const FIT_EPSILON = 0.5;

export function calculateTacticalPipRows(
    maximum: number,
    availableWidth: number,
    singleLine = false,
    groupWidth = TACTICAL_PIP_GROUP_WIDTH,
    columnGap = TACTICAL_PIP_COLUMN_GAP,
): number {
    const pipCount = Number.isFinite(maximum) ? Math.max(0, Math.trunc(maximum)) : 0;
    const groupCount = Math.ceil(pipCount / PIPS_PER_GROUP);
    if (singleLine || groupCount <= 1) return 1;

    if (!Number.isFinite(availableWidth) || availableWidth <= 0
        || !Number.isFinite(groupWidth) || groupWidth <= 0
        || !Number.isFinite(columnGap) || columnGap < 0) {
        return TACTICAL_PIP_DEFAULT_ROWS;
    }

    const fittingColumns = Math.max(
        1,
        Math.floor((availableWidth + columnGap + FIT_EPSILON) / (groupWidth + columnGap)),
    );
    return Math.max(TACTICAL_PIP_DEFAULT_ROWS, Math.ceil(groupCount / fittingColumns));
}

export function calculateTacticalPipContentWidth(
    groupCount: number,
    singleLine = false,
    groupWidth = TACTICAL_PIP_GROUP_WIDTH,
    columnGap = TACTICAL_PIP_COLUMN_GAP,
): number {
    const safeGroupCount = Number.isFinite(groupCount) ? Math.max(0, Math.trunc(groupCount)) : 0;
    if (safeGroupCount === 0) return 0;

    const rows = singleLine ? 1 : Math.min(TACTICAL_PIP_DEFAULT_ROWS, safeGroupCount);
    const columns = Math.ceil(safeGroupCount / rows);
    return columns * groupWidth + Math.max(0, columns - 1) * columnGap;
}

@Directive({
    selector: '[tacticalPipMatrix]',
    host: {
        '[class.single-line]': 'singleLine()',
    },
})
export class TacticalPipMatrixDirective implements OnDestroy {
    readonly maximum = input(0, { alias: 'tacticalPipMatrix' });
    readonly singleLine = input(false, { alias: 'tacticalPipMatrixSingleLine' });

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly afterRenderRef = afterRenderEffect(() => {
        this.maximum();
        this.singleLine();
        this.observeDamageStrip();
        this.updateRows();
    });
    private resizeObserver: ResizeObserver | null = null;
    private observedStrip: HTMLElement | null = null;

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.afterRenderRef.destroy();
    }

    private observeDamageStrip(): void {
        const strip = this.host.nativeElement.parentElement;
        if (strip === this.observedStrip) return;

        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.observedStrip = strip;
        if (!strip || typeof ResizeObserver === 'undefined') return;

        const resizeObserver = new ResizeObserver(() => this.updateRows());
        this.resizeObserver = resizeObserver;
        resizeObserver.observe(strip);
    }

    private updateRows(): void {
        const matrix = this.host.nativeElement;
        if (!matrix.isConnected) return;

        const matrixStyle = getComputedStyle(matrix);
        const groupWidth = readPositivePixelValue(
            matrixStyle.getPropertyValue('--pip-group-width'),
            TACTICAL_PIP_GROUP_WIDTH,
        );
        const columnGap = readNonNegativePixelValue(matrixStyle.columnGap, TACTICAL_PIP_COLUMN_GAP);
        const rows = calculateTacticalPipRows(
            this.maximum(),
            availableMatrixWidth(matrix),
            this.singleLine(),
            groupWidth,
            columnGap,
        );
        matrix.style.setProperty('--pip-rows', `${rows}`);
    }
}

function availableMatrixWidth(matrix: HTMLElement): number {
    const strip = matrix.parentElement;
    if (!strip) return 0;

    const stripStyle = getComputedStyle(strip);
    const contentWidth = strip.clientWidth
        - readNonNegativePixelValue(stripStyle.paddingLeft)
        - readNonNegativePixelValue(stripStyle.paddingRight);
    const visibleChildren = Array.from(strip.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .filter(child => getComputedStyle(child).display !== 'none');
    const occupiedBySiblings = visibleChildren
        .filter(child => child !== matrix)
        .reduce((width, child) => {
            const style = getComputedStyle(child);
            return width
                + child.getBoundingClientRect().width
                + readNonNegativePixelValue(style.marginLeft)
                + readNonNegativePixelValue(style.marginRight);
        }, 0);
    const gap = readNonNegativePixelValue(stripStyle.columnGap);
    const occupiedByGaps = gap * Math.max(0, visibleChildren.length - 1);
    return Math.max(0, contentWidth - occupiedBySiblings - occupiedByGaps);
}

export function readPositivePixelValue(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readNonNegativePixelValue(value: string, fallback = 0): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
