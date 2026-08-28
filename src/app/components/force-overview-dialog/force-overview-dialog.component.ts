// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, effect, type ElementRef, inject, signal, type TemplateRef, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DragDropModule, type CdkDragDrop, type CdkDragMove } from '@angular/cdk/drag-drop';
import type { Force, UnitGroup } from '../../models/force.model';
import type { ForceUnit } from '../../models/force-unit.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { GameSystem } from '../../models/common.model';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { OptionsService } from '../../services/options.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { formatSummaryMovement } from '../../models/pilot-abilities.model';
import { createForcePreviewEntryFromForce, type ForcePreviewEntry, type ForcePreviewUnit } from '../../models/force-preview.model';
import { ForcePreviewPanelComponent } from '../force-preview-panel/force-preview-panel.component';
import { ForceRadarPanelComponent } from '../force-radar-panel/force-radar-panel.component';
import { UnitCardExpandedComponent } from '../unit-card-expanded/unit-card-expanded.component';
import { UnitBlockComponent } from '../unit-block/unit-block.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import type { TagClickEvent } from '../unit-tags/unit-tags.component';
import { AbilityInfoDialogComponent, type AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { isMegaMekRaritySortKey, SORT_OPTIONS } from '../../services/unit-search-filters.model';
import { getFormationDefinition } from '../../utils/formation-blueprints';
import { formationInheritsParentEffects } from '../../utils/formation-type.model';
import { TaggingService } from '../../services/tagging.service';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { DataTableComponent, type DataTableCellContext, type DataTableColumn, type DataTableRowClickEvent, type DataTableRowLongPressEvent, type DataTableSortEvent } from '../data-table/data-table.component';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { LongPressDirective } from '../../directives/long-press.directive';
import { FORCE_NOTE_MAX_LENGTH } from '../../models/force-serialization';
import { naturalCompare } from '../../utils/sort.util';
import { formatBvPv } from '../../utils/force-viewer-bv-pv-display.util';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import {
    buildUnitDataTableColumns,
    formatAlphaStrikeUnitMovement,
    formatClassicUnitMovement,
    formatUnitDataTableSortSlotValue,
    getUnitDataTableSortSlotHeader,
    isUnitDataTableSortActive,
} from '../../utils/unit-data-table.util';

export interface ForceOverviewDialogData {
    force: Force;
}

/** View model for displaying units in the force */
interface ForceUnitViewModel {
    forceUnit: ForceUnit;
    unit: UnitSummary;
}

type ForceTableRow =
    | { kind: 'group'; group: UnitGroup }
    | { kind: 'unit'; vm: ForceUnitViewModel; group: UnitGroup };

type ForceOverviewTab = 'primer' | 'summary' | 'units';

const FORCE_PRIMER_META_THRESHOLD = 0.9;

/**
 * State for the overview that can be persisted.
 */
export interface OverviewState {
    viewMode: 'expanded' | 'compact' | 'table';
    sortKey: string;
    sortDirection: 'asc' | 'desc';
}

/** Default state for the overview */
export const DEFAULT_OVERVIEW_STATE: OverviewState = {
    viewMode: 'compact',
    sortKey: '',
    sortDirection: 'asc'
};

/**
 * Force Overview Dialog
 * Displays all units in a force with sorting and view mode options.
 */
@Component({
    selector: 'force-overview-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        DragDropModule,
        UnitCardExpandedComponent,
        ForcePreviewPanelComponent,
        ForceRadarPanelComponent,
        UnitBlockComponent,
        UnitIconComponent,
        DataTableComponent,
        TooltipDirective,
        LongPressDirective,
        FormatTonsPipe,
    ],
    host: {
        class: 'fullscreen-dialog-host fullheight tv-fade'
    },
    templateUrl: './force-overview-dialog.component.html',
    styleUrls: ['./force-overview-dialog.component.scss']
})
export class ForceOverviewDialogComponent {
    private dialogRef = inject<DialogRef<void>>(DialogRef);
    protected data = inject<ForceOverviewDialogData>(DIALOG_DATA);
    protected layoutService = inject(LayoutService);
    private dataService = inject(DataService);
    private dialogsService = inject(DialogsService);
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    private optionsService = inject(OptionsService);
    private abilityLookup = inject(AsAbilityLookupService);
    private taggingService = inject(TaggingService);

    /** Reference to new group dropzone */
    private newGroupDropzone = viewChild<ElementRef<HTMLElement>>('newGroupDropzone');

    /** Reference to scrollable units list */
    private scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');

    private readonly tableIconCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableIconCell');
    private readonly tableNameCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableNameCell');
    private readonly tableYearCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableYearCell');
    private readonly tableValueCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableValueCell');
    private readonly tableSkillCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableSkillCell');
    private readonly tableMovementCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableMovementCell');
    private readonly tableSpecialsCell = viewChild<TemplateRef<DataTableCellContext<ForceTableRow>>>('tableSpecialsCell');
    private readonly tableGroupRow = viewChild<TemplateRef<{ $implicit: ForceTableRow; row: ForceTableRow; index: number }>>('tableGroupRow');

    /** Flag for unit drag/sorting */
    readonly isUnitDragging = signal<boolean>(false);

    /** Flag for group drag/reorder */
    readonly isGroupDragging = signal<boolean>(false);

    /** Force-unit ids selected through long press or a modified click. */
    readonly selectedUnitIds = signal<ReadonlySet<string>>(new Set());

    /** Number of force units currently selected. */
    readonly selectedUnitCount = computed(() => this.selectedUnitIds().size);

    /** Active high-level tab */
    readonly activeTab = signal<ForceOverviewTab>(
        this.data.force.readOnly() && (this.data.force.note ?? '').trim().length > 0
            ? 'primer'
            : 'summary'
    );

    /** Active tab after visibility-based fallbacks are applied */
    readonly effectiveActiveTab = computed<ForceOverviewTab>(() => {
        const activeTab = this.activeTab();
        if (activeTab === 'primer' && !this.showPrimerTab()) {
            return 'summary';
        }

        return activeTab;
    });

    /** Hovered unit for the radar overlay */
    readonly hoveredPreviewUnit = signal<ForcePreviewUnit | null>(null);

    // --- Autoscroll State ---
    private autoScrollVelocity = signal<number>(0);
    private autoScrollRafId?: number;
    private lastAutoScrollTs?: number;
    private readonly AUTOSCROLL_EDGE = 64;   // px threshold from edge
    private readonly AUTOSCROLL_MAX = 800;   // px/sec max scroll speed
    private readonly AUTOSCROLL_MIN = 40;    // px/sec min scroll speed

    /** Sort options available - Custom is the default order by the user */
    readonly SORT_OPTIONS = SORT_OPTIONS
        .filter(opt => !isMegaMekRaritySortKey(opt.key))
        .map(opt => opt.key === '' ? { ...opt, label: 'Custom' } : opt);

    /** Current view mode */
    viewMode = signal<'expanded' | 'compact' | 'table'>(this.optionsService.options().forceOverviewViewMode);

    readonly noteLimit = FORCE_NOTE_MAX_LENGTH;

    /** Current sort key */
    selectedSort = signal<string>(DEFAULT_OVERVIEW_STATE.sortKey);

    /** Current sort direction */
    selectedSortDirection = signal<'asc' | 'desc'>(DEFAULT_OVERVIEW_STATE.sortDirection);

    /** Get the label for the currently selected sort option */
    selectedSortLabel = computed(() => {
        const key = this.selectedSort();
        const opt = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel ?? opt?.label ?? null;
    });

    /** Get the current game system for filtering sort options */
    readonly gameSystem = computed(() => this.data.force.gameSystem);

    /** Force faction for header display */
    readonly forceFaction = computed(() => this.data.force.faction());

    /** Force era for header display */
    readonly forceEra = computed(() => this.data.force.era());

    /** Force name for display */
    forceName = computed(() => this.data.force.displayName());

    /** Live force adapter for the preview and summary panels */
    readonly summaryPreviewEntry = computed<ForcePreviewEntry>(() => {
        return createForcePreviewEntryFromForce(this.data.force);
    });

    /** Total unit count */
    unitCount = computed(() => this.units().length);

    /** Hovered unit projected to the radar panel */
    readonly hoveredRadarUnit = computed(() => this.hoveredPreviewUnit()?.unit ?? null);

    /** Whether this is an Alpha Strike force */
    readonly isAlphaStrike = computed(() => this.gameSystem() === GameSystem.ALPHA_STRIKE);

    /** Whether table mode is active */
    readonly isTableMode = computed(() => this.viewMode() === 'table');

    /** Whether the summary tab is active */
    readonly isSummaryTab = computed(() => this.effectiveActiveTab() === 'summary');

    /** Whether the primer tab is active */
    readonly isPrimerTab = computed(() => this.effectiveActiveTab() === 'primer');

    /** Whether the units tab is active */
    readonly isUnitsTab = computed(() => this.effectiveActiveTab() === 'units');

    /** Current primer note */
    readonly primerNote = computed(() => this.data.force.note ?? '');

    /** Primer note with whitespace-only content normalized away for visibility checks */
    readonly trimmedPrimerNote = computed(() => this.primerNote().trim());

    /** Whether the PRIMER tab should be available in the current state */
    readonly showPrimerTab = computed(() => !this.isReadOnly() || this.trimmedPrimerNote().length > 0);

    readonly nextViewMode = computed<'compact' | 'expanded' | 'table'>(() => {
        const current = this.viewMode();
        if (current === 'compact') return 'expanded';
        if (current === 'expanded') return 'table';
        return 'compact';
    });

    readonly nextViewModeTitle = computed(() => {
        const current = this.viewMode();
        const next = this.nextViewMode();
        const currentLabel = current === 'compact' ? 'Compact View' : current === 'expanded' ? 'Expanded View' : 'Table View';
        const nextLabel = next === 'compact' ? 'Compact View' : next === 'expanded' ? 'Expanded View' : 'Table View';
        return `${currentLabel}. Click to switch to ${nextLabel}.`;
    });

    constructor() {
        effect(() => {
            const savedViewMode = this.optionsService.options().forceOverviewViewMode;
            untracked(() => {
                if (this.viewMode() !== savedViewMode) {
                    this.viewMode.set(savedViewMode);
                }
            });
        });
        effect(() => {
            const availableUnitIds = new Set(this.data.force.units().map(unit => unit.id));
            untracked(() => {
                const selectedUnitIds = this.selectedUnitIds();
                if ([...selectedUnitIds].some(id => !availableUnitIds.has(id))) {
                    this.selectedUnitIds.set(new Set(
                        [...selectedUnitIds].filter(id => availableUnitIds.has(id))
                    ));
                }
            });
        });
    }

    /** Whether to use hex movement */
    readonly useHex = computed(() => this.optionsService.options().ASUseHex);

    /** Total BV/PV of the force using the selected display mode. */
    totalBv = computed(() => this.displayedBvPv(this.data.force.units()));

    displayedBvPv(units: readonly ForceUnit[]): string {
        return formatBvPv(
            units.reduce((total, unit) => total + unit.getBv(), 0),
            units.reduce((total, unit) => total + unit.getPreSkillBv(), 0),
            this.optionsService.options().forceViewerBVPVDisplay,
        );
    }

    totalTons(units: readonly ForceUnit[]): number {
        return units.reduce((total, unit) => total + unit.getUnit().tons, 0);
    }

    displayedUnitBvPv(unit: ForceUnit): string {
        return formatBvPv(
            unit.getBv(),
            unit.getPreSkillBv(),
            this.optionsService.options().forceViewerBVPVDisplay,
        );
    }

    /** Whether the force is read-only */
    isReadOnly = computed(() => this.data.force.readOnly());

    /** All groups in the force */
    groups = computed(() => this.data.force.groups());

    /** Whether there's only one group */
    hasSingleGroup = computed(() => this.groups().length === 1);

    /** Whether any group is empty */
    hasEmptyGroups = computed(() => this.groups().some(g => g.units().length === 0));

    /** Whether force has max groups */
    hasMaxGroups = computed(() => this.data.force.hasMaxGroups());

    /** Label for a selected sort that is not represented by a standard table column. */
    readonly tableSortSlotHeader = computed(() => getUnitDataTableSortSlotHeader(
        this.gameSystem(),
        this.selectedSort(),
        this.SORT_OPTIONS,
    ));

    readonly forceTableRows = computed<readonly ForceTableRow[]>(() => {
        const rows: ForceTableRow[] = [];
        for (const group of this.groups()) {
            rows.push({ kind: 'group', group });
            for (const vm of this.getSortedUnitsForGroup(group)) {
                rows.push({ kind: 'unit', vm, group });
            }
        }
        return rows;
    });

    readonly forceTableColumns = computed<readonly DataTableColumn<ForceTableRow>[]>(() => {
        const iconCell = this.tableIconCell();
        const nameCell = this.tableNameCell();
        const yearCell = this.tableYearCell();
        const valueCell = this.tableValueCell();
        const skillCell = this.tableSkillCell();
        const movementCell = this.tableMovementCell();
        const specialsCell = this.tableSpecialsCell();

        if (!iconCell || !nameCell || !yearCell || !valueCell || !skillCell || !movementCell) {
            return [];
        }
        if (this.isAlphaStrike() && !specialsCell) {
            return [];
        }

        const skillColumn: DataTableColumn<ForceTableRow> = {
            id: 'skill',
            header: this.isAlphaStrike() ? 'Skill' : 'G/P',
            track: this.isAlphaStrike() ? 40 : 56,
            cellTemplate: skillCell,
            align: 'center',
        };

        const sortSlotHeader = this.tableSortSlotHeader();
        return buildUnitDataTableColumns({
            gameSystem: this.gameSystem(),
            getUnit: row => row.kind === 'unit' ? row.vm.unit : null,
            isSortActive: keyOrGroup => this.isSortActive(keyOrGroup),
            templates: {
                icon: iconCell,
                name: nameCell,
                year: yearCell,
                value: valueCell,
                movement: movementCell,
                specials: specialsCell,
            },
            afterValueColumns: [skillColumn],
            sortSlot: sortSlotHeader ? {
                header: sortSlotHeader,
                value: row => row.kind === 'unit' ? this.getTableSortSlot(row.vm.unit) ?? '' : '',
            } : null,
        });
    });

    /** Whether drag-drop is allowed (compact mode + default sort + not read-only) */
    canDragDrop = computed(() => 
        this.viewMode() === 'compact' && 
        this.selectedSort() === '' && 
        !this.isReadOnly()
    );

    /** All units in the force with their view model data */
    units = computed<ForceUnitViewModel[]>(() => {
        const force = this.data.force;
        const forceUnits = force.units();
        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        // Build view models - ForceUnit now contains all needed data
        const viewModels: ForceUnitViewModel[] = forceUnits.map(fu => {
            const unit = fu.getUnit();
            return {
                forceUnit: fu,
                unit
            };
        }).filter(vm => vm.unit != null) as ForceUnitViewModel[];

        // Sort the units (skip if no sort key - show default order)
        if (sortKey) {
            viewModels.sort((a, b) => {
                const valA = this.getNestedProperty(a.unit, sortKey);
                const valB = this.getNestedProperty(b.unit, sortKey);

                let cmp = 0;
                if (valA == null && valB == null) cmp = 0;
                else if (valA == null) cmp = 1;
                else if (valB == null) cmp = -1;
                else if (typeof valA === 'number' && typeof valB === 'number') {
                    cmp = valA - valB;
                } else {
                    cmp = naturalCompare(String(valA), String(valB));
                }

                return sortDirection === 'asc' ? cmp : -cmp;
            });
        }

        return viewModels;
    });

    /** Toggle between expanded and compact view modes */
    toggleViewMode(): void {
        this.setViewMode(this.nextViewMode());
    }

    setActiveTab(tab: ForceOverviewTab): void {
        const nextTab = tab === 'primer' && !this.showPrimerTab() ? 'summary' : tab;

        if (this.effectiveActiveTab() === nextTab) {
            return;
        }

        this.activeTab.set(nextTab);
        if (nextTab !== 'summary') {
            this.clearHoveredPreviewUnit();
        }
    }

    /** Set the sort key */
    setSortOrder(key: string): void {
        this.selectedSort.set(key);
    }

    /** Set the sort direction */
    setSortDirection(direction: 'asc' | 'desc'): void {
        this.selectedSortDirection.set(direction);
    }

    onForceTableSort(event: DataTableSortEvent): void {
        this.onHeaderSort(event.sortKey, event.groupKey);
    }

    onForceTableRowClick(event: DataTableRowClickEvent<ForceTableRow>): void {
        if (event.row.kind !== 'unit') {
            return;
        }

        this.onUnitClick(event.row.vm, event.event);
    }

    onForceTableRowLongPress(event: DataTableRowLongPressEvent<ForceTableRow>): void {
        if (event.row.kind !== 'unit') {
            return;
        }

        this.toggleUnitSelection(event.row.vm.forceUnit, event.event);
    }

    onPreviewUnitHover(unitEntry: ForcePreviewUnit | null): void {
        this.hoveredPreviewUnit.set(unitEntry?.unit ? unitEntry : null);
    }

    onPrimerNoteChange(event: Event): void {
        if (this.isReadOnly()) {
            return;
        }

        const textArea = event.target as HTMLTextAreaElement;
        const nextNote = this.clampText(textArea.value, this.noteLimit);
        if (textArea.value !== nextNote) {
            textArea.value = nextNote;
        }
        this.data.force.setNote(nextNote);
    }

    showPrimerMeta(): boolean {
        return this.shouldShowLengthMeta(this.primerNote().length, this.noteLimit);
    }

    trackByForceUnitId = (_index: number, row: ForceTableRow) => row.kind === 'group' ? `group-${row.group.id}` : row.vm.forceUnit.id;

    isForceTableGroupRow = (row: ForceTableRow) => row.kind === 'group';

    readonly forceTableRowClass = (row: ForceTableRow) => ({
        'is-selected': row.kind === 'unit' && this.isUnitSelected(row.vm.forceUnit),
    });

    /** Handle unit card click - open unit details dialog */
    onUnitClick(vm: ForceUnitViewModel, event?: MouseEvent): void {
        if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
            this.toggleUnitSelection(vm.forceUnit, event);
            return;
        }

        const unitList = this.data.force.units();
        const unitIndex = unitList.findIndex(u => u.id === vm.forceUnit.id);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: this.data.force.units,
                unitIndex: unitIndex
            }
        });
    }

    toggleUnitSelection(forceUnit: ForceUnit, event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();

        const selectedUnitIds = new Set(this.selectedUnitIds());
        if (selectedUnitIds.has(forceUnit.id)) {
            selectedUnitIds.delete(forceUnit.id);
        } else {
            selectedUnitIds.add(forceUnit.id);
        }
        this.selectedUnitIds.set(selectedUnitIds);
    }

    isUnitSelected(forceUnit: ForceUnit): boolean {
        return this.selectedUnitIds().has(forceUnit.id);
    }

    selectAllUnits(): void {
        this.selectedUnitIds.set(new Set(this.units().map(vm => vm.forceUnit.id)));
    }

    clearUnitSelection(): void {
        if (this.selectedUnitCount() > 0) {
            this.selectedUnitIds.set(new Set());
        }
    }

    async onTagClick({ unit, event }: TagClickEvent): Promise<void> {
        event.stopPropagation();
        
        // Get anchor element for positioning
        const evtTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorEl = (evtTarget.closest('.add-tag-btn') as HTMLElement) || evtTarget;
        
        await this.taggingService.openTagSelector([unit], anchorEl);
    }

    /** Handle pilot click - open pilot edit dialog */
    async onPilotClick(forceUnit: ForceUnit): Promise<void> {
        if (forceUnit.readOnly()) return;
        await this.forceBuilderService.editPilotOfUnit(forceUnit);
    }

    /** Handle force name click - open rename dialog */
    async onForceNameClick(): Promise<void> {
        if (this.isReadOnly()) return;
        await this.forceBuilderService.promptChangeForceName(this.data.force);
    }

    /** Show formation info dialog */
    showFormationInfo(event: MouseEvent, group: UnitGroup): void {
        event.stopPropagation();
        this.forceBuilderService.showFormationInfo(group);
    }

    /** Build tooltip HTML for a mismatched formation */
    getFormationMismatchTitle(group: UnitGroup): string {
        const formation = group.formation();
        if (!formation) return 'Formation does not match group composition';

        const parts: string[] = [];
        const showParentRequirements = formationInheritsParentEffects(formation) && !!formation.parent;

        if (showParentRequirements) {
            const parent = getFormationDefinition(formation.parent!, group.force.gameSystem);
            if (parent?.requirements) {
                const parentReq = parent.requirements;
                if (parentReq) parts.push(this.buildFormationRequirementTooltipLine(parent.name, parentReq));
            }
        }

        if (formation.requirements) {
            const req = formation.requirements;
            if (req) parts.push(this.buildFormationRequirementTooltipLine(showParentRequirements ? formation.name : null, req));
        }

        return parts.length > 0 ? parts.join('') : 'Formation does not match group composition';
    }

    private buildFormationRequirementTooltipLine(label: string | null, requirements: string): string {
        const formattedRequirements = formatSummaryMovement(requirements, this.optionsService.options().ASUseHex);
        return label
            ? `<div><strong>${label}:</strong> ${formattedRequirements}</div>`
            : `<div>${formattedRequirements}</div>`;
    }

    /** Handle group name click - open rename dialog */
    async onGroupNameClick(group: UnitGroup): Promise<void> {
        if (this.isReadOnly()) return;
        await this.forceBuilderService.promptChangeGroupName(group);
    }

    /** Handle C3 network click - open C3 network dialog */
    async openC3Network(event: MouseEvent, forceUnit: ForceUnit): Promise<void> {
        event.stopPropagation();
        await this.forceBuilderService.openC3Network(this.data.force, forceUnit.readOnly());
    }

    /** Handle remove unit */
    async removeUnit(event: MouseEvent, forceUnit: ForceUnit): Promise<void> {
        event.stopPropagation();
        await this.forceBuilderService.removeUnit(forceUnit, event.ctrlKey);
    }

    /** Handle repair unit */
    async repairUnit(event: MouseEvent, forceUnit: ForceUnit): Promise<void> {
        event.stopPropagation();
        const unit = forceUnit.getUnit();
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to repair the unit "${unit?.chassis} ${unit?.model}"? This will reset all damage and status effects.`,
            `Repair ${unit?.chassis}`,
            'info');
        if (confirmed) {
            forceUnit.repairAll();
            this.toastService.showToast(`Repaired unit ${unit?.chassis} ${unit?.model}.`, 'success');
        }
    }

    /** Handle show unit info */
    showUnitInfo(event: MouseEvent, forceUnit: ForceUnit): void {
        event.stopPropagation();
        const unitList = this.data.force.units();
        const unitIndex = unitList.findIndex(u => u.id === forceUnit.id);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: this.data.force.units,
                unitIndex: unitIndex
            }
        });
    }

    /** Get sorted units for a group */
    getSortedUnitsForGroup(group: UnitGroup): ForceUnitViewModel[] {
        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        const viewModels: ForceUnitViewModel[] = group.units().map(fu => {
            const unit = fu.getUnit();
            return { forceUnit: fu, unit };
        }).filter(vm => vm.unit != null) as ForceUnitViewModel[];

        // Skip sorting if no sort key - show default order
        if (sortKey) {
            viewModels.sort((a, b) => {
                const valA = this.getNestedProperty(a.unit, sortKey);
                const valB = this.getNestedProperty(b.unit, sortKey);

                let cmp = 0;
                if (valA == null && valB == null) cmp = 0;
                else if (valA == null) cmp = 1;
                else if (valB == null) cmp = -1;
                else if (typeof valA === 'number' && typeof valB === 'number') {
                    cmp = valA - valB;
                } else {
                    cmp = naturalCompare(String(valA), String(valB));
                }

                return sortDirection === 'asc' ? cmp : -cmp;
            });
        }

        return viewModels;
    }

    /** Close the dialog */
    close(): void {
        this.dialogRef.close();
    }

    private clearHoveredPreviewUnit(): void {
        this.hoveredPreviewUnit.set(null);
    }

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: any, key: string): any {
        if (!obj || !key) return undefined;
        if (!key.includes('.')) return obj[key];
        const parts = key.split('.');
        let cur: any = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    // --- Drag and Drop ---

    /** Called when drag starts */
    onUnitDragStart(): void {
        if (this.isReadOnly()) return;
        this.isUnitDragging.set(true);
    }

    /** Called when group drag starts */
    onGroupDragStart(): void {
        if (this.isReadOnly()) return;
        this.isGroupDragging.set(true);
    }

    /** Called when dragging moves */
    onUnitDragMoved(event: CdkDragMove<any>): void {
        if (this.isReadOnly()) return;

        const scrollRef = this.scrollContainer?.();
        if (!scrollRef) {
            this.stopAutoScrollLoop();
            return;
        }
        const container = scrollRef.nativeElement as HTMLElement;
        const rect = container.getBoundingClientRect();

        const pointerY = (event.event as PointerEvent)?.clientY ?? event.pointerPosition?.y;
        if (pointerY == null) {
            this.stopAutoScrollLoop();
            return;
        }

        const topDist = pointerY - rect.top;
        const bottomDist = rect.bottom - pointerY;

        let ratio = 0;
        if (topDist < this.AUTOSCROLL_EDGE) {
            ratio = (this.AUTOSCROLL_EDGE - topDist) / this.AUTOSCROLL_EDGE;
            ratio = Math.max(0, Math.min(1, ratio));
            ratio = ratio * ratio;
            this.autoScrollVelocity.set(-Math.max(this.AUTOSCROLL_MIN, ratio * this.AUTOSCROLL_MAX));
        } else if (bottomDist < this.AUTOSCROLL_EDGE) {
            ratio = (this.AUTOSCROLL_EDGE - bottomDist) / this.AUTOSCROLL_EDGE;
            ratio = Math.max(0, Math.min(1, ratio));
            ratio = ratio * ratio;
            this.autoScrollVelocity.set(Math.max(this.AUTOSCROLL_MIN, ratio * this.AUTOSCROLL_MAX));
        } else {
            this.autoScrollVelocity.set(0);
        }

        if (Math.abs(this.autoScrollVelocity()) > 0.5) {
            this.startAutoScrollLoop();
        } else {
            this.stopAutoScrollLoop();
        }
    }

    /** Called when drag ends */
    onUnitDragEnd(): void {
        this.stopAutoScrollLoop();
        this.isUnitDragging.set(false);
    }

    /** Called when group drag ends */
    onGroupDragEnd(): void {
        this.stopAutoScrollLoop();
        this.isGroupDragging.set(false);
    }

    private startAutoScrollLoop(): void {
        if (this.autoScrollRafId) return;
        this.lastAutoScrollTs = performance.now();
        const step = (ts: number) => {
            if (!this.autoScrollRafId) return;
            const last = this.lastAutoScrollTs ?? ts;
            const dt = Math.min(100, ts - last) / 1000;
            this.lastAutoScrollTs = ts;

            const v = this.autoScrollVelocity();
            if (Math.abs(v) > 0.5) {
                const scrollRef = this.scrollContainer?.();
                if (scrollRef) {
                    const el = scrollRef.nativeElement as HTMLElement;
                    const delta = v * dt;
                    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + delta));
                }
                this.autoScrollRafId = requestAnimationFrame(step);
            } else {
                this.stopAutoScrollLoop();
            }
        };
        this.autoScrollRafId = requestAnimationFrame(step);
    }

    private stopAutoScrollLoop(): void {
        if (this.autoScrollRafId) {
            cancelAnimationFrame(this.autoScrollRafId);
            this.autoScrollRafId = undefined;
        }
        this.autoScrollVelocity.set(0);
        this.lastAutoScrollTs = undefined;
    }

    /** Get connected drop lists for unit drag-drop across groups */
    connectedDropLists = computed(() => {
        const ids: string[] = [];
        for (const g of this.data.force.groups()) {
            ids.push(`group-${g.id}`);
        }
        if (this.newGroupDropzone()?.nativeElement) {
            ids.push('new-group-dropzone');
        }
        return ids;
    });

    /** Handle drop within or between groups */
    drop(event: CdkDragDrop<ForceUnit[]>): void {
        if (this.isReadOnly()) return;

        const force = this.data.force;
        const groups = force.groups();

        const groupIdFromContainer = (id?: string) => id && id.startsWith('group-') ? id.substring('group-'.length) : null;

        const fromGroupId = groupIdFromContainer(event.previousContainer?.id);
        const toGroupId = groupIdFromContainer(event.container?.id);

        if (!fromGroupId || !toGroupId) return;

        const fromGroup = groups.find(g => g.id === fromGroupId);
        const toGroup = groups.find(g => g.id === toGroupId);
        if (!fromGroup || !toGroup) return;

        // No-op if same group and same index
        if (fromGroup === toGroup && event.previousIndex === event.currentIndex) {
            return;
        }

        if (fromGroup === toGroup) {
            fromGroup.reorderUnit(event.previousIndex, event.currentIndex);
        } else {
            const moved = fromGroup.moveUnitTo(event.previousIndex, toGroup, event.currentIndex);
            if (!moved) return;
            this.forceBuilderService.assignFormationIfNeeded(fromGroup);
            this.forceBuilderService.assignFormationIfNeeded(toGroup);
        }

        force.removeEmptyGroups();
        force.emitChanged();
    }

    /** Handle drop to create a new group */
    dropForNewGroup(event: CdkDragDrop<any>): void {
        if (this.isReadOnly()) return;

        const force = this.data.force;
        const newGroup = force.addGroup();
        if (!newGroup) return;

        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) return;

        const sourceGroupId = prevId.substring('group-'.length);
        const sourceGroup = force.groups().find(g => g.id === sourceGroupId);
        if (!sourceGroup) return;

        const moved = sourceGroup.moveUnitTo(event.previousIndex, newGroup);
        if (!moved) return;

        this.forceBuilderService.assignFormationIfNeeded(sourceGroup);
        this.forceBuilderService.assignFormationIfNeeded(newGroup);
        force.removeEmptyGroups();
        force.emitChanged();
    }

    /** Handle group drag-drop for reordering within the force */
    dropGroup(event: CdkDragDrop<UnitGroup[]>): void {
        if (this.isReadOnly()) return;
        this.data.force.reorderGroup(event.previousIndex, event.currentIndex);
    }

    /** Handle click on empty group to remove it */
    onEmptyGroupClick(group: UnitGroup): void {
        if (this.isReadOnly()) return;
        if (group.units().length === 0) {
            this.forceBuilderService.removeGroup(group);
        }
    }

    // --- Unit Table View Helpers ---

    /** Handle header click: toggle direction if already active, otherwise activate with asc */
    onHeaderSort(sortKey: string, groupKey?: string): void {
        const isActive = groupKey ? this.isSortActive(groupKey) : this.isSortActive(sortKey);
        if (isActive) {
            this.selectedSortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            this.selectedSort.set(sortKey);
            this.selectedSortDirection.set('asc');
        }
    }

    /** Check if the current sort key matches any of the provided keys or groups */
    isSortActive(...keysOrGroups: string[]): boolean {
        return isUnitDataTableSortActive(this.selectedSort(), ...keysOrGroups);
    }

    getTableSortSlot(unit: UnitSummary): string | null {
        const sortKey = this.selectedSort();
        if (!sortKey || !this.tableSortSlotHeader()) {
            return null;
        }

        return formatUnitDataTableSortSlotValue(unit, sortKey);
    }

    /** Format movement value for Alpha Strike table view */
    formatASMovement(unit: UnitSummary): string {
        return formatAlphaStrikeUnitMovement(unit, this.useHex());
    }

    formatClassicMovement(unit: UnitSummary): string {
        return formatClassicUnitMovement(unit);
    }

    private clampText(value: string, maxLength: number): string {
        return value.slice(0, maxLength);
    }

    private shouldShowLengthMeta(currentLength: number, maxLength: number): boolean {
        return currentLength > maxLength * FORCE_PRIMER_META_THRESHOLD;
    }

    /** Show ability info dialog for an Alpha Strike special ability */
    showAbilityInfoDialog(abilityText: string): void {
        const parsedAbility = this.abilityLookup.parseAbility(abilityText);
        this.dialogsService.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }

    getPilotStats(vm: ForceUnitViewModel): string | number {
        return vm.forceUnit.getPilotStats();
    }

    private setViewMode(viewMode: 'expanded' | 'compact' | 'table') {
        if (viewMode === 'compact') {
            this.clearUnitSelection();
        }
        this.viewMode.set(viewMode);
        void this.optionsService.setOption('forceOverviewViewMode', viewMode);
    }
}
