/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { Unit } from '../../models/units.model';
import { CBTGameRules, CORE_2026_GAME_RULES } from '../../models/rules/game-rules';
import {
    clusterTableForUnit,
    clusterTableRows,
    hitLocationRows,
    referenceTableNotes,
    type HitLocationRow,
    type PhysicalLocationColumn,
    type PhysicalLocationRow,
    type ReferenceTableNote,
} from '../../utils/record-sheet-reference-table';
import { clusterHits } from '../../utils/cluster-hit-table';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export type HitLocationColumn = 'leftSide' | 'frontRear' | 'rightSide';

interface PhysicalColumnDefinition {
    readonly key: PhysicalLocationColumn;
    readonly label: 'LS' | 'F/R' | 'RS';
}

type ReferenceTableColumn =
    | { readonly table: 'location'; readonly column: HitLocationColumn }
    | { readonly table: 'cluster'; readonly rackSize: number }
    | { readonly table: 'physical'; readonly column: PhysicalLocationColumn };

interface ReferenceRollResult {
    readonly roll: number;
    readonly value: string;
    readonly column: ReferenceTableColumn;
}

export interface ClusterTableDialogData {
    readonly unit: Unit;
    readonly gameRules?: CBTGameRules;
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
    private readonly physicalRoller = viewChild<DiceRollerComponent>('physicalRoller');
    private readonly dialogContent = viewChild<ElementRef<HTMLElement>>('dialogContent');
    private readonly combinedTable = viewChild<ElementRef<HTMLTableElement>>('combinedTable');
    private selectedColumn: ReferenceTableColumn | null = null;
    readonly data = inject<ClusterTableDialogData>(DIALOG_DATA);
    readonly gameRules = this.data.gameRules ?? CORE_2026_GAME_RULES;
    readonly table = clusterTableForUnit(this.data.unit);
    readonly locationRows: readonly HitLocationRow[] = this.table.hitLocationTable
        ? hitLocationRows(this.table.hitLocationTable)
        : [];
    readonly clusterSizes = [...this.table.clusterSizes];
    readonly clusterRows = clusterTableRows(this.clusterSizes);
    readonly physicalColumns: readonly PhysicalColumnDefinition[] = [
        { key: 'punchLeftSide', label: 'LS' },
        { key: 'punchFrontRear', label: 'F/R' },
        { key: 'punchRightSide', label: 'RS' },
        { key: 'kickLeftSide', label: 'LS' },
        { key: 'kickFrontRear', label: 'F/R' },
        { key: 'kickRightSide', label: 'RS' },
    ];
    readonly physicalRows: readonly PhysicalLocationRow[] = this.locationRows.length
        ? this.gameRules.physicalLocationRows
        : [];
    private readonly allNotes: readonly ReferenceTableNote[] = referenceTableNotes(
        this.table.hitLocationTable,
        this.table.equipment,
    );
    readonly hitLocationNotes = this.allNotes.filter(note => note.id === 'tripodLeg');
    readonly clusterNotes = this.allNotes.filter(note => note.id !== 'tripodLeg');
    readonly rolledResult = signal<ReferenceRollResult | null>(null);
    readonly hoveredColumnKey = signal<string | null>(null);
    readonly useCombinedTable = signal(this.locationRows.length > 0 && this.clusterSizes.length > 0);
    readonly layoutResolved = signal(!this.useCombinedTable());

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

    rollPhysicalColumn(column: PhysicalLocationColumn): void {
        this.rollColumn({ table: 'physical', column });
    }

    onRollFinished(event: { readonly results: number[]; readonly sum: number }): void {
        const selectedColumn = this.selectedColumn;
        if (!selectedColumn || !Number.isInteger(event.sum)) return;

        if (selectedColumn.table === 'physical') {
            const row = this.physicalRows[event.sum - 1];
            if (!row) return;
            this.rolledResult.set({
                roll: event.sum,
                value: row[selectedColumn.column],
                column: selectedColumn,
            });
            return;
        }

        if (event.sum < 2 || event.sum > 12) return;

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

    isPhysicalRollHighlighted(roll: number): boolean {
        const result = this.rolledResult();
        return result?.column.table === 'physical' && result.roll === roll;
    }

    isPhysicalKickGroupHighlighted(roll: number): boolean {
        const result = this.rolledResult();
        return result?.column.table === 'physical'
            && result.column.column.startsWith('kick')
            && Math.ceil(result.roll / 3) === Math.ceil(roll / 3);
    }

    isPhysicalCellHighlighted(roll: number, column: PhysicalLocationColumn): boolean {
        const result = this.rolledResult();
        const isMatchingKickGroup = column.startsWith('kick')
            && this.isPhysicalKickGroupHighlighted(roll);
        return result?.column.table === 'physical'
            && (result.roll === roll || isMatchingKickGroup)
            && result.column.column === column;
    }

    locationColumnKey(column: HitLocationColumn): string {
        return `location:${column}`;
    }

    clusterColumnKey(rackSize: number): string {
        return `cluster:${rackSize}`;
    }

    physicalColumnKey(column: PhysicalLocationColumn): string {
        return `physical:${column}`;
    }

    private rollColumn(column: ReferenceTableColumn): void {
        const roller = column.table === 'physical' ? this.physicalRoller() : this.roller();
        if (!roller || this.roller()?.isRolling() || this.physicalRoller()?.isRolling()) return;
        this.selectedColumn = column;
        this.rolledResult.set(null);
        roller.roll();
    }

    private observeAvailableTableWidth(): void {
        const content = this.dialogContent()?.nativeElement;
        const table = this.combinedTable()?.nativeElement;
        if (!this.locationRows.length || !this.clusterSizes.length) {
            this.layoutResolved.set(true);
            return;
        }
        if (!content || !table) {
            this.useCombinedTable.set(false);
            this.layoutResolved.set(true);
            return;
        }

        const requiredWidth = table.getBoundingClientRect().width;

        const updateLayout = () => {
            const contentStyle = getComputedStyle(content);
            const horizontalPadding = (parseFloat(contentStyle.paddingLeft) || 0)
                + (parseFloat(contentStyle.paddingRight) || 0);
            const availableWidth = content.clientWidth - horizontalPadding;
            this.useCombinedTable.set(shouldCombineReferenceTables(availableWidth, requiredWidth));
            this.layoutResolved.set(true);
        };
        const observer = new ResizeObserver(updateLayout);
        observer.observe(content);
        updateLayout();
        this.destroyRef.onDestroy(() => observer.disconnect());
    }

    close(): void {
        this.dialogRef.close();
    }
}
