/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { Unit } from '../../models/units.model';
import {
    clusterTableForUnit,
    clusterTableRows,
    hitLocationRows,
    referenceTableNotes,
    type HitLocationRow,
    type ReferenceTableNote,
} from '../../utils/record-sheet-reference-table';
import { clusterHits } from '../../utils/cluster-hit-table';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export type HitLocationColumn = 'leftSide' | 'frontRear' | 'rightSide';

type ReferenceTableColumn =
    | { readonly table: 'location'; readonly column: HitLocationColumn }
    | { readonly table: 'cluster'; readonly rackSize: number };

interface ReferenceRollResult {
    readonly roll: number;
    readonly value: string;
    readonly column: ReferenceTableColumn;
}

export interface ClusterTableDialogData {
    readonly unit: Unit;
}

export function shouldCombineReferenceTables(availableWidth: number, requiredWidth: number): boolean {
    return availableWidth > 0 && requiredWidth > 0 && requiredWidth <= availableWidth;
}

@Component({
    selector: 'cluster-table-dialog',
    standalone: true,
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './cluster-table-dialog.component.html',
    styleUrl: './cluster-table-dialog.component.scss',
})
export class ClusterTableDialogComponent {
    private readonly dialogRef = inject(DialogRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly roller = viewChild<DiceRollerComponent>('roller');
    private readonly dialogContent = viewChild<ElementRef<HTMLElement>>('dialogContent');
    private readonly combinedTable = viewChild<ElementRef<HTMLTableElement>>('combinedTable');
    private selectedColumn: ReferenceTableColumn | null = null;
    readonly data = inject<ClusterTableDialogData>(DIALOG_DATA);
    readonly table = clusterTableForUnit(this.data.unit);
    readonly locationRows: readonly HitLocationRow[] = this.table.hitLocationTable
        ? hitLocationRows(this.table.hitLocationTable)
        : [];
    readonly clusterSizes = [...this.table.clusterSizes];
    readonly clusterRows = clusterTableRows(this.clusterSizes);
    private readonly allNotes: readonly ReferenceTableNote[] = referenceTableNotes(
        this.table.hitLocationTable,
        this.table.equipment,
    );
    readonly hitLocationNotes = this.allNotes.filter(note => note.id === 'tripodLeg');
    readonly clusterNotes = this.allNotes.filter(note => note.id !== 'tripodLeg');
    readonly rolledResult = signal<ReferenceRollResult | null>(null);
    readonly hoveredColumnKey = signal<string | null>(null);
    readonly useCombinedTable = signal(false);

    constructor() {
        afterNextRender(() => this.observeAvailableTableWidth());
    }

    setHoveredColumn(event: PointerEvent, columnKey: string): void {
        if (event.pointerType === 'mouse') this.hoveredColumnKey.set(columnKey);
    }

    clearHoveredColumn(columnKey: string): void {
        if (this.hoveredColumnKey() === columnKey) this.hoveredColumnKey.set(null);
    }

    rollLocationColumn(column: HitLocationColumn): void {
        this.rollColumn({ table: 'location', column });
    }

    rollClusterColumn(rackSize: number): void {
        this.rollColumn({ table: 'cluster', rackSize });
    }

    onRollFinished(event: { readonly results: number[]; readonly sum: number }): void {
        const selectedColumn = this.selectedColumn;
        if (!selectedColumn || !Number.isInteger(event.sum) || event.sum < 2 || event.sum > 12) return;

        if (selectedColumn.table === 'location') {
            const row = this.locationRows[event.sum - 2];
            if (!row) return;
            const result = {
                roll: event.sum,
                value: row[selectedColumn.column],
                column: selectedColumn,
            };
            this.rolledResult.set(result);
            return;
        }

        const result = {
            roll: event.sum,
            value: String(clusterHits(event.sum, selectedColumn.rackSize)),
            column: selectedColumn,
        };
        this.rolledResult.set(result);
    }

    isLocationRollHighlighted(roll: number): boolean {
        const result = this.rolledResult();
        return result?.column.table === 'location' && result.roll === roll;
    }

    isClusterRollHighlighted(roll: number): boolean {
        const result = this.rolledResult();
        return result?.column.table === 'cluster' && result.roll === roll;
    }

    isLocationCellHighlighted(roll: number, column: HitLocationColumn): boolean {
        const result = this.rolledResult();
        return result?.column.table === 'location'
            && result.roll === roll
            && result.column.column === column;
    }

    isClusterCellHighlighted(roll: number, rackSize: number): boolean {
        const result = this.rolledResult();
        return result?.column.table === 'cluster'
            && result.roll === roll
            && result.column.rackSize === rackSize;
    }

    locationColumnKey(column: HitLocationColumn): string {
        return `location:${column}`;
    }

    clusterColumnKey(rackSize: number): string {
        return `cluster:${rackSize}`;
    }

    private rollColumn(column: ReferenceTableColumn): void {
        const roller = this.roller();
        if (!roller || roller.isRolling()) return;
        this.selectedColumn = column;
        this.rolledResult.set(null);
        roller.roll();
    }

    private observeAvailableTableWidth(): void {
        const content = this.dialogContent()?.nativeElement;
        const table = this.combinedTable()?.nativeElement;
        if (!content || !table || !this.locationRows.length || !this.clusterSizes.length) return;

        const updateLayout = () => {
            const contentStyle = getComputedStyle(content);
            const horizontalPadding = (parseFloat(contentStyle.paddingLeft) || 0)
                + (parseFloat(contentStyle.paddingRight) || 0);
            const availableWidth = content.clientWidth - horizontalPadding;
            const requiredWidth = table.getBoundingClientRect().width;
            this.useCombinedTable.set(shouldCombineReferenceTables(availableWidth, requiredWidth));
        };
        const observer = new ResizeObserver(updateLayout);
        observer.observe(content);
        observer.observe(table);
        updateLayout();
        this.destroyRef.onDestroy(() => observer.disconnect());
    }

    close(): void {
        this.dialogRef.close();
    }
}
