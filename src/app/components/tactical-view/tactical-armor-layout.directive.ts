// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    Directive,
    ElementRef,
    type OnDestroy,
    afterRenderEffect,
    inject,
    input,
    signal,
} from '@angular/core';

import {
    TACTICAL_PIP_COLUMN_GAP,
    TACTICAL_PIP_GROUP_WIDTH,
    calculateTacticalPipContentWidth,
    readNonNegativePixelValue,
    readPositivePixelValue,
} from './tactical-pip-matrix.directive';

const FIT_EPSILON = 0.5;

export interface TacticalDamageTrackRowMeasurement {
    readonly availableWidth: number;
    readonly stripWidths: readonly number[];
    readonly gap: number;
}

export function shouldWrapTacticalDamageTracks(
    rows: readonly TacticalDamageTrackRowMeasurement[],
): boolean {
    return rows.some(row => {
        if (row.availableWidth <= 0 || row.stripWidths.length < 2) return false;

        const requiredWidth = row.stripWidths.reduce((total, width) => total + width, 0)
            + row.gap * (row.stripWidths.length - 1);
        return requiredWidth > row.availableWidth + FIT_EPSILON;
    });
}

@Directive({
    selector: '[tacticalArmorLayout]',
    host: {
        '[class.damage-tracks-wrapped]': 'wrapped()',
    },
})
export class TacticalArmorLayoutDirective implements OnDestroy {
    readonly revision = input<unknown>(null, { alias: 'tacticalArmorLayout' });
    readonly wrapped = signal(false);

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly afterRenderRef = afterRenderEffect(() => {
        this.revision();
        this.observeWidth();
        this.updateLayout();
    });
    private resizeObserver: ResizeObserver | null = null;

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.afterRenderRef.destroy();
    }

    private observeWidth(): void {
        if (this.resizeObserver || typeof ResizeObserver === 'undefined') return;

        const resizeObserver = new ResizeObserver(() => this.updateLayout());
        this.resizeObserver = resizeObserver;
        resizeObserver.observe(this.host.nativeElement);
    }

    private updateLayout(): void {
        const panel = this.host.nativeElement;
        if (!panel.isConnected) return;

        const rows = Array.from(panel.querySelectorAll<HTMLElement>('.location-tracks'))
            .map(measureDamageTrackRow);
        this.wrapped.set(shouldWrapTacticalDamageTracks(rows));
    }
}

function measureDamageTrackRow(row: HTMLElement): TacticalDamageTrackRowMeasurement {
    const rowStyle = getComputedStyle(row);
    const strips = Array.from(row.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .filter(child => child.classList.contains('damage-strip'));

    return {
        availableWidth: row.clientWidth
            - readNonNegativePixelValue(rowStyle.paddingLeft)
            - readNonNegativePixelValue(rowStyle.paddingRight),
        stripWidths: strips.map(measureDamageStripContentWidth),
        gap: readNonNegativePixelValue(rowStyle.columnGap),
    };
}

function measureDamageStripContentWidth(strip: HTMLElement): number {
    const stripStyle = getComputedStyle(strip);
    const children = Array.from(strip.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .filter(child => getComputedStyle(child).display !== 'none');
    const childrenWidth = children.reduce((total, child) => {
        const childStyle = getComputedStyle(child);
        return total
            + measureDamageStripChildWidth(child)
            + readNonNegativePixelValue(childStyle.marginLeft)
            + readNonNegativePixelValue(childStyle.marginRight);
    }, 0);
    const gapsWidth = readNonNegativePixelValue(stripStyle.columnGap)
        * Math.max(0, children.length - 1);

    return childrenWidth
        + gapsWidth
        + readNonNegativePixelValue(stripStyle.paddingLeft)
        + readNonNegativePixelValue(stripStyle.paddingRight)
        + readNonNegativePixelValue(stripStyle.borderLeftWidth)
        + readNonNegativePixelValue(stripStyle.borderRightWidth);
}

function measureDamageStripChildWidth(child: HTMLElement): number {
    if (!child.classList.contains('pip-matrix')) {
        return Math.max(child.scrollWidth, child.getBoundingClientRect().width);
    }

    const matrixStyle = getComputedStyle(child);
    const groupCount = Array.from(child.children)
        .filter(group => group instanceof HTMLElement && group.classList.contains('pip-group'))
        .length;
    return calculateTacticalPipContentWidth(
        groupCount,
        child.classList.contains('single-line'),
        readPositivePixelValue(
            matrixStyle.getPropertyValue('--pip-group-width'),
            TACTICAL_PIP_GROUP_WIDTH,
        ),
        readNonNegativePixelValue(matrixStyle.columnGap, TACTICAL_PIP_COLUMN_GAP),
    );
}
