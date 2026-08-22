// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    afterNextRender,
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    HostListener,
    inject,
    signal,
    viewChild,
    viewChildren,
} from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { UnitSummary } from '../../models/unit-summary.model';
import { CBTGameRules, CORE_2026_GAME_RULES } from '../../models/rules/game-rules';
import { ReferenceTableRollHistoryService } from '../../services/reference-table-roll-history.service';
import {
    buildReferenceTableView,
    defaultReferenceTableOption,
    isReferenceTableCellContinuation,
    REFERENCE_TABLE_GROUPS,
    referenceTableCellRowSpan,
    referenceTableCellText,
    referenceTableRollSource,
    referenceTableGroupForOption,
    resolveReferenceTableRoll,
    type ReferenceTableCellValue,
    type ReferenceTableColumn,
    type ReferenceTableDefinition,
    type ReferenceTableGroupDefinition,
    type ReferenceTableGroupId,
    type ReferenceTableOptionId,
    type ReferenceTableRow,
} from '../../utils/reference-table-definition';
import { clusterTableForUnit, referenceTableNotes } from '../../utils/record-sheet-reference-table';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

interface SelectedReferenceTableColumn {
    readonly table: ReferenceTableDefinition;
    readonly column: ReferenceTableColumn;
}

interface ReferenceRollResult {
    readonly tableKey: string;
    readonly columnKey: string;
    readonly rowKey: string;
    readonly roll: number;
    readonly value: string;
}

export interface ClusterTableDialogData {
    readonly unit: UnitSummary;
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
    private readonly twoDiceRoller = viewChild<DiceRollerComponent>('twoDiceRoller');
    private readonly oneDieRoller = viewChild<DiceRollerComponent>('oneDieRoller');
    private readonly dialogContent = viewChild<ElementRef<HTMLElement>>('dialogContent');
    private readonly tableSelector = viewChild<ElementRef<HTMLElement>>('tableSelector');
    private readonly rollHistoryList = viewChild<ElementRef<HTMLElement>>('rollHistoryList');
    private readonly renderedTables = viewChildren<ElementRef<HTMLTableElement>>('referenceTable');
    private readonly rollHistoryService = inject(ReferenceTableRollHistoryService);
    private selectedColumn: SelectedReferenceTableColumn | null = null;
    private combinedRequiredWidth = 0;

    readonly data = inject<ClusterTableDialogData>(DIALOG_DATA);
    readonly gameRules = this.data.gameRules ?? CORE_2026_GAME_RULES;
    readonly table = clusterTableForUnit(this.data.unit);
    readonly tableGroups = REFERENCE_TABLE_GROUPS;
    readonly physicalRows = this.gameRules.physicalLocationRows;
    private readonly allNotes = referenceTableNotes(this.table.hitLocationTable, this.table.equipment);
    readonly clusterNotes = this.allNotes.filter(note => note.id !== 'tripodLeg');

    readonly selectedOptionId = signal<ReferenceTableOptionId>(defaultReferenceTableOption(this.data.unit));
    readonly selectedGroupId = computed(() => referenceTableGroupForOption(this.selectedOptionId()).id);
    readonly expandedGroupId = signal<ReferenceTableGroupId | null>(null);
    readonly tableView = computed(() => buildReferenceTableView(this.selectedOptionId(), {
        physicalRows: this.physicalRows,
        clusterSizes: this.table.clusterSizes,
        clusterNotes: this.clusterNotes,
    }));
    readonly rolledResult = signal<ReferenceRollResult | null>(null);
    readonly hoveredColumnKey = signal<string | null>(null);
    readonly rollHistory = this.rollHistoryService.entries;
    readonly historyOpen = signal(false);
    readonly rollCount = this.rollHistoryService.count;
    readonly useCombinedTable = signal(this.tableView().combinedTable !== undefined);
    readonly layoutResolved = signal(this.tableView().combinedTable === undefined);
    readonly displayedTables = computed(() => {
        const view = this.tableView();
        if (!this.useCombinedTable() || !view.combinedTable || !view.combinedSourceKeys) {
            return view.tables;
        }
        const sourceKeys = new Set(view.combinedSourceKeys);
        return [view.combinedTable, ...view.tables.filter(table => !sourceKeys.has(table.key))];
    });
    readonly hasRollableTable = computed(() => this.displayedTables().some(table => table.dice !== undefined));

    constructor() {
        afterRenderEffect(() => {
            const expectedCombinedTable = this.tableView().combinedTable;
            const renderedTable = this.renderedTables()
                .map(reference => reference.nativeElement)
                .find(table => table.dataset['tableKey'] === expectedCombinedTable?.key);
            if (!expectedCombinedTable || !renderedTable || this.combinedRequiredWidth > 0) return;
            const requiredWidth = renderedTable.getBoundingClientRect().width;
            if (requiredWidth <= 0) return;
            this.combinedRequiredWidth = requiredWidth;
            this.updateCombinedLayout();
        });
        afterRenderEffect(() => {
            const scrollKey = this.historyOpen() ? this.rollCount() : -1;
            const historyList = this.rollHistoryList()?.nativeElement;
            if (scrollKey >= 0 && historyList) historyList.scrollTop = historyList.scrollHeight;
        });
        afterNextRender(() => this.observeAvailableTableWidth());
    }

    tableGroupButtonLabel(group: ReferenceTableGroupDefinition): string {
        if (group.id !== this.selectedGroupId() || group.options.length === 1) return group.label;
        const option = group.options.find(candidate => candidate.id === this.selectedOptionId());
        return option ? `${group.label} · ${option.label}` : group.label;
    }

    activateTableGroup(group: ReferenceTableGroupDefinition): void {
        if (group.options.length === 1) {
            this.expandedGroupId.set(null);
            this.selectOption(group.options[0].id);
            return;
        }
        this.expandedGroupId.update(groupId => groupId === group.id ? null : group.id);
    }

    selectTableOption(optionId: ReferenceTableOptionId): void {
        this.expandedGroupId.set(null);
        this.selectOption(optionId);
    }

    closeTableGroupMenu(): void {
        this.expandedGroupId.set(null);
    }

    @HostListener('document:pointerdown', ['$event'])
    closeTableGroupMenuOnOutsidePointer(event: PointerEvent): void {
        if (!this.expandedGroupId()) return;
        const target = event.target as Node | null;
        if (!target || !this.tableSelector()?.nativeElement.contains(target)) this.closeTableGroupMenu();
    }

    rollTableColumn(table: ReferenceTableDefinition, column: ReferenceTableColumn): void {
        if (!table.dice || !column.rollable) return;
        const roller = table.dice.count === 1 ? this.oneDieRoller() : this.twoDiceRoller();
        if (!roller || this.twoDiceRoller()?.isRolling() || this.oneDieRoller()?.isRolling()) return;
        this.selectedColumn = { table, column };
        this.rolledResult.set(null);
        roller.roll();
    }

    onRollFinished(
        event: { readonly results: number[]; readonly sum: number },
        diceCount: 1 | 2,
    ): void {
        const selection = this.selectedColumn;
        if (!selection?.table.dice || selection.table.dice.count !== diceCount) return;
        const dice = selection.table.dice;
        const result = resolveReferenceTableRoll(selection.table, selection.column.key, event.sum);
        if (!result) return;

        this.rolledResult.set({
            tableKey: selection.table.key,
            columnKey: selection.column.key,
            rowKey: result.rowKey,
            roll: result.roll,
            value: result.value,
        });
        this.rollHistoryService.add({
            dice: `${dice.count}d${dice.sides}`,
            faces: [...event.results],
            roll: result.roll,
            table: result.source.tableLabel,
            column: selection.column.label,
            result: result.value,
        });
    }

    rollSourceLabel(table: ReferenceTableDefinition, column: ReferenceTableColumn): string {
        return referenceTableRollSource(table, column).tableLabel;
    }

    tableColumnKey(table: ReferenceTableDefinition, column: ReferenceTableColumn): string {
        return `${table.key}:${column.key}`;
    }

    setHoveredColumn(event: PointerEvent, table: ReferenceTableDefinition, column: ReferenceTableColumn): void {
        if (event.pointerType === 'mouse' && column.rollable) {
            this.hoveredColumnKey.set(this.tableColumnKey(table, column));
        }
    }

    clearHoveredColumn(table: ReferenceTableDefinition, column: ReferenceTableColumn): void {
        const key = this.tableColumnKey(table, column);
        if (this.hoveredColumnKey() === key) this.hoveredColumnKey.set(null);
    }

    isRowHighlighted(table: ReferenceTableDefinition, row: ReferenceTableRow): boolean {
        const result = this.rolledResult();
        return result?.tableKey === table.key && result.rowKey === row.key;
    }

    isCellHighlighted(
        table: ReferenceTableDefinition,
        row: ReferenceTableRow,
        column: ReferenceTableColumn,
    ): boolean {
        const result = this.rolledResult();
        if (result?.tableKey !== table.key || result.columnKey !== column.key) return false;
        if (result.rowKey === row.key) return true;

        const rowSpan = referenceTableCellRowSpan(row.cells[column.key]);
        if (!rowSpan) return false;
        const sourceIndex = table.rows.indexOf(row);
        const resultIndex = table.rows.findIndex(candidate => candidate.key === result.rowKey);
        return resultIndex > sourceIndex && resultIndex < sourceIndex + rowSpan;
    }

    cellText(cell: ReferenceTableCellValue): string {
        return referenceTableCellText(cell);
    }

    cellRowSpan(cell: ReferenceTableCellValue): number | null {
        return referenceTableCellRowSpan(cell);
    }

    isCellContinuation(cell: ReferenceTableCellValue): boolean {
        return isReferenceTableCellContinuation(cell);
    }

    overlayResultFor(diceCount: 1 | 2): string | null {
        return this.selectedColumn?.table.dice?.count === diceCount
            ? this.rolledResult()?.value ?? null
            : null;
    }

    toggleHistory(): void {
        this.historyOpen.update(open => !open);
    }

    resetHistory(): void {
        this.rollHistoryService.reset();
    }

    close(): void {
        this.dialogRef.close();
    }

    private selectOption(optionId: ReferenceTableOptionId): void {
        if (optionId === this.selectedOptionId()) return;
        this.selectedOptionId.set(optionId);
        this.selectedColumn = null;
        this.rolledResult.set(null);
        this.hoveredColumnKey.set(null);
        this.combinedRequiredWidth = 0;
        const canCombine = this.tableView().combinedTable !== undefined;
        this.useCombinedTable.set(canCombine);
        this.layoutResolved.set(!canCombine);
    }

    private observeAvailableTableWidth(): void {
        const content = this.dialogContent()?.nativeElement;
        if (!content || typeof ResizeObserver === 'undefined') {
            this.layoutResolved.set(true);
            return;
        }
        const observer = new ResizeObserver(() => this.updateCombinedLayout());
        observer.observe(content);
        this.destroyRef.onDestroy(() => observer.disconnect());
        this.updateCombinedLayout();
    }

    private updateCombinedLayout(): void {
        const view = this.tableView();
        if (!view.combinedTable) {
            this.useCombinedTable.set(false);
            this.layoutResolved.set(true);
            return;
        }
        if (this.combinedRequiredWidth <= 0) return;

        const content = this.dialogContent()?.nativeElement;
        if (!content) {
            this.useCombinedTable.set(false);
            this.layoutResolved.set(true);
            return;
        }
        const contentStyle = getComputedStyle(content);
        const horizontalPadding = (parseFloat(contentStyle.paddingLeft) || 0)
            + (parseFloat(contentStyle.paddingRight) || 0);
        const availableWidth = content.clientWidth - horizontalPadding;
        this.useCombinedTable.set(shouldCombineReferenceTables(availableWidth, this.combinedRequiredWidth));
        this.layoutResolved.set(true);
    }
}
