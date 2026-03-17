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

import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { Component, computed, input, output, signal, TemplateRef, viewChild } from '@angular/core';

export type DataTableClassValue = string | string[] | Set<string> | Record<string, boolean> | null | undefined;

export interface DataTableCellContext<T> {
    $implicit: T;
    row: T;
    index: number;
    column: DataTableColumn<T>;
    value: unknown;
}

export interface DataTableRowContext<T> {
    $implicit: T;
    row: T;
    index: number;
}

export interface DataTableColumn<T> {
    id: string;
    header: string;
    track: string;
    headerClass?: DataTableClassValue;
    cellClass?: DataTableClassValue | ((row: T, index: number) => DataTableClassValue);
    align?: 'left' | 'center' | 'right';
    value?: (row: T, index: number) => unknown;
    cellTemplate?: TemplateRef<DataTableCellContext<T>>;
    sortKey?: string;
    sortGroupKey?: string;
    sortActive?: boolean;
}

export interface DataTableSortEvent {
    columnId: string;
    sortKey: string;
    groupKey?: string;
}

export interface DataTableRowClickEvent<T> {
    row: T;
    index: number;
    event: MouseEvent;
}

@Component({
    selector: 'mb-data-table',
    imports: [CommonModule, NgTemplateOutlet, ScrollingModule],
    templateUrl: './data-table.component.html',
    styleUrl: './data-table.component.scss'
})
export class DataTableComponent<T> {
    readonly rows = input.required<readonly T[]>();
    readonly columns = input.required<readonly DataTableColumn<T>[]>();
    readonly itemSize = input(48);
    readonly minWidth = input('0px');
    readonly sortDirection = input<'asc' | 'desc' | null>(null);
    readonly minBufferPx = input(600);
    readonly maxBufferPx = input(1200);
    readonly rowTrackBy = input<(index: number, row: T) => unknown>((index) => index);
    readonly rowClass = input<((row: T, index: number) => DataTableClassValue) | null>(null);
    readonly fullRowTemplate = input<TemplateRef<DataTableRowContext<T>> | null>(null);
    readonly isFullRow = input<((row: T, index: number) => boolean) | null>(null);

    readonly sort = output<DataTableSortEvent>();
    readonly rowClick = output<DataTableRowClickEvent<T>>();

    private readonly viewport = viewChild(CdkVirtualScrollViewport);
    readonly scrollLeft = signal(0);

    readonly gridTemplate = computed(() => this.columns().map(column => column.track).join(' '));
    readonly tableWidth = computed(() => `max(${this.minWidth()}, 100%)`);

    onViewportScroll() {
        const viewport = this.viewport();
        if (!viewport) {
            return;
        }

        const scrollLeft = viewport.elementRef.nativeElement.scrollLeft;
        if (this.scrollLeft() !== scrollLeft) {
            this.scrollLeft.set(scrollLeft);
        }
    }

    onHeaderClick(column: DataTableColumn<T>, event: MouseEvent) {
        if (!column.sortKey) {
            return;
        }

        event.stopPropagation();
        this.sort.emit({
            columnId: column.id,
            sortKey: column.sortKey,
            groupKey: column.sortGroupKey,
        });
    }

    onRowClick(row: T, index: number, event: MouseEvent) {
        if (this.isFullRowRow(row, index)) {
            return;
        }

        this.rowClick.emit({ row, index, event });
    }

    trackRow = (index: number, row: T) => this.rowTrackBy()(index, row);

    resolveRowClass(row: T, index: number): DataTableClassValue {
        return this.rowClass()?.(row, index) ?? null;
    }

    resolveCellClass(column: DataTableColumn<T>, row: T, index: number): DataTableClassValue {
        if (typeof column.cellClass === 'function') {
            return column.cellClass(row, index);
        }

        return column.cellClass ?? null;
    }

    cellContext(row: T, column: DataTableColumn<T>, index: number): DataTableCellContext<T> {
        return {
            $implicit: row,
            row,
            index,
            column,
            value: column.value?.(row, index),
        };
    }

    cellValue(column: DataTableColumn<T>, row: T, index: number): unknown {
        return column.value?.(row, index) ?? '';
    }

    rowContext(row: T, index: number): DataTableRowContext<T> {
        return {
            $implicit: row,
            row,
            index,
        };
    }

    isFullRowRow(row: T, index: number): boolean {
        return this.isFullRow()?.(row, index) ?? false;
    }
}