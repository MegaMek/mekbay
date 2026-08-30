// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, effect, type DestroyRef, type ElementRef, inject, signal, TemplateRef, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DragDropModule, type CdkDragDrop, type CdkDragMove } from '@angular/cdk/drag-drop';
import type { Force, UnitGroup } from '../../models/force.model';
import type { ForceUnit } from '../../models/force-unit.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import {
    isCBTForceMember,
    isCBTMekForceMember,
    type CBTForceMember,
    type ForceMember,
} from '../../models/force-member.model';
import { GameService } from '../../services/game.service';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceDialogsService } from '../../services/force-dialogs.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { ForceFormationService } from '../../services/force-formation.service';
import { ForcePilotEditorService } from '../../services/force-pilot-editor.service';
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
import { formatMovement } from '../../utils/as-common.util';
import { DataTableComponent, type DataTableCellContext, type DataTableColumn, type DataTableRowClickEvent, type DataTableRowLongPressEvent, type DataTableSortEvent } from '../data-table/data-table.component';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { FORCE_NOTE_MAX_LENGTH } from '../../models/force-serialization';
import { naturalCompare } from '../../utils/sort.util';
import { formatForceMembersBvPv } from '../../utils/force-viewer-bv-pv-display.util';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../../models/crew.model';
import { CBTForce } from '../../models/cbt-force.model';
import { GameSystem } from '../../models/common.model';
import { LongPressDirective } from '../../directives/long-press.directive';
import {
    buildUnitDataTableColumns,
    formatClassicUnitMovement,
    formatUnitDataTableSortSlotValue,
    getUnitDataTableSortSlotHeader,
    isUnitDataTableSortActive,
} from '../../utils/unit-data-table.util';

export interface ForceOverviewDialogData {
    force: Force;
}

/** View model for displaying units in the force */
interface ForceMemberViewModel {
    member: ForceMember;
    unit: UnitSummary;
}

type ForceTableRow =
    | { kind: 'group'; group: UnitGroup }
    | { kind: 'unit'; vm: ForceMemberViewModel; group: UnitGroup };

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
    ],
    host: {
        class: 'fullscreen-dialog-host fullheight tv-fade'
    },
    templateUrl: './force-overview-dialog.component.html',
    styleUrls: ['./force-overview-dialog.component.scss']
})
export class ForceOverviewDialogComponent {
    protected readonly isCBTMekForceMember = isCBTMekForceMember;
    private dialogRef = inject<DialogRef<void>>(DialogRef);
    protected data = inject<ForceOverviewDialogData>(DIALOG_DATA);
    protected gameService = inject(GameService);
    protected layoutService = inject(LayoutService);
    private dataService = inject(DataService);
    private dialogsService = inject(DialogsService);
    private forceBuilderService = inject(ForceBuilderService);
    private readonly forceDialogs = inject(ForceDialogsService);

    private readonly forceCommands = inject(ForceWorkspaceCommandsService);
    private readonly formations = inject(ForceFormationService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
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

    /** Member ids selected through long press or a modified click. */
    readonly selectedUnitIds = signal<ReadonlySet<string>>(new Set());

    /** Number of currently selected members. */
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
    gameSystem = computed(() => this.data.force.gameSystem);

    /** Force faction for header display */
    readonly forceFaction = computed(() => this.data.force.faction());

    /** Force era for header display */
    readonly forceEra = computed(() => this.data.force.era());

    /** Force name for display */
    forceName = computed(() => this.data.force.displayName());

    /** Live force adapter for the preview and summary panels */
    readonly summaryPreviewEntry = computed<ForcePreviewEntry>(() => {
        return createForcePreviewEntryFromForce(
            this.data.force,
            this.data.force.members(),
            {},
            member => this.resolveClassicCatalogSummary(member),
        );
    });

    /** Total unit count */
    unitCount = computed(() => this.units().length);

    /** Hovered unit projected to the radar panel */
    readonly hoveredRadarUnit = computed(() => this.hoveredPreviewUnit()?.unit ?? null);

    /** Whether this is an Alpha Strike force */
    isAlphaStrike = computed(() => this.gameSystem() === GameSystem.ALPHA_STRIKE);

    /** Whether table mode is active */
    readonly isTableMode = computed(() => this.viewMode() === 'table');

    /** Whether the summary tab is active */
    readonly isSummaryTab = computed(() => this.effectiveActiveTab() === 'summary');

    /** Whether the primer tab is active */
    readonly isPrimerTab = computed(() => this.effectiveActiveTab() === 'primer');

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
            const normalizedViewMode = this.normalizeViewMode(savedViewMode);
            untracked(() => {
                if (this.viewMode() !== normalizedViewMode) {
                    this.viewMode.set(normalizedViewMode);
                }
                if (savedViewMode !== normalizedViewMode) {
                    void this.optionsService.setOption('forceOverviewViewMode', normalizedViewMode);
                }
            });
        });
        effect(() => {
            const availableUnitIds = new Set(this.data.force.members().map(member => member.id));
            untracked(() => {
                const selectedUnitIds = this.selectedUnitIds();
                if ([...selectedUnitIds].some(id => !availableUnitIds.has(id))) {
                    this.selectedUnitIds.set(new Set(
                        [...selectedUnitIds].filter(id => availableUnitIds.has(id)),
                    ));
                }
            });
        });
    }

    /** Whether to use hex movement */
    readonly useHex = computed(() => this.optionsService.options().ASUseHex);

    /** Keys always visible in the AS table row */
    private readonly AS_TABLE_VISIBLE_KEYS = ['name', 'year', 'as.PV', 'as.TP', 'role', 'as.SZ', 'as._mv', 'as.TMM', 'as.damage', 'as.Arm', 'as.Str', 'as.OV'];

    /** Keys that are grouped together in the UI display */
    private readonly SORT_KEY_GROUPS: Record<string, string[]> = {
        'as.damage': ['as.dmg.dmgS', 'as.dmg.dmgM', 'as.dmg.dmgL', 'as.dmg.dmgE']
    };

    /** Total BV/PV of the force using the selected display mode. */
    totalBv = computed(() => {
        return this.displayedBvPv(this.data.force.members());
    });

    displayedBvPv(members: readonly ForceMember[]): string {
        return formatForceMembersBvPv(
            members,
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
    hasEmptyGroups = computed(() => this.groups().some(group => this.membersForGroup(group).length === 0));

    /** Whether force has max groups */
    hasMaxGroups = computed(() => this.data.force.hasMaxGroups());

    /** For AS table view: returns the sort slot header label if the current sort is not already visible in the table columns */
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

        if (!iconCell || !nameCell || !yearCell || !skillCell || !movementCell) {
            return [];
        }

        if (!this.isAlphaStrike()) {
            if (!valueCell) return [];
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
                },
                afterValueColumns: [{
                    id: 'skill',
                    header: 'G/P',
                    track: 56,
                    cellTemplate: skillCell,
                    align: 'center',
                }],
                sortSlot: sortSlotHeader ? {
                    header: sortSlotHeader,
                    value: row => row.kind === 'unit' ? this.getTableSortSlot(row.vm.unit) : '',
                } : null,
            });
        }

        if (!specialsCell) return [];

        const columns: DataTableColumn<ForceTableRow>[] = [
            {
                id: 'icon',
                header: '',
                track: 40,
                cellTemplate: iconCell,
                align: 'center',
            },
            {
                id: 'name',
                header: 'Name',
                track: { minPx: 320, flex: 1.35 },
                cellTemplate: nameCell,
                sortKey: 'name',
                sortActive: this.isSortActive('name'),
            },
            {
                id: 'year',
                header: 'Year',
                track: 72,
                cellTemplate: yearCell,
                sortKey: 'year',
                sortActive: this.isSortActive('year'),
                cellClass: this.tableCellClass('as-td-year', this.isSortActive('year')),
                align: 'center',
            },
            {
                id: 'type',
                header: 'Type',
                track: 50,
                value: row => row.kind === 'unit' ? row.vm.unit.as.TP : '',
                sortKey: 'as.TP',
                sortActive: this.isSortActive('as.TP'),
                cellClass: this.tableCellClass('as-td-type', this.isSortActive('as.TP')),
                align: 'center',
            },
            {
                id: 'role',
                header: 'Role',
                track: 130,
                value: row => row.kind === 'unit' && row.vm.unit.role !== 'None' ? row.vm.unit.role : '',
                sortKey: 'role',
                sortActive: this.isSortActive('role'),
                cellClass: this.tableCellClass('as-td-role', this.isSortActive('role')),
            },
            {
                id: 'pv',
                header: 'PV',
                track: 45,
                value: row => row.kind === 'unit'
                    ? this.displayedBvPv([row.vm.member])
                    : '',
                sortKey: 'as.PV',
                sortActive: this.isSortActive('as.PV'),
                cellClass: this.tableCellClass('as-td-pv is-bold', this.isSortActive('as.PV')),
                align: 'right',
            },
            {
                id: 'skill',
                header: 'Skill',
                track: 40,
                cellTemplate: skillCell,
                align: 'center',
            },
            {
                id: 'sz',
                header: 'SZ',
                track: 30,
                value: row => row.kind === 'unit' ? row.vm.unit.as.SZ : '',
                sortKey: 'as.SZ',
                sortActive: this.isSortActive('as.SZ'),
                cellClass: this.tableCellClass('as-td-sz', this.isSortActive('as.SZ')),
                align: 'center',
            },
            {
                id: 'mv',
                header: 'MV',
                track: 65,
                cellTemplate: movementCell,
                sortKey: 'as._mv',
                sortActive: this.isSortActive('as._mv'),
                cellClass: this.tableCellClass('as-td-mv', this.isSortActive('as._mv')),
                align: 'center',
            },
            {
                id: 'tmm',
                header: 'TMM',
                track: 40,
                value: row => row.kind === 'unit' ? row.vm.unit.as.TMM : '',
                sortKey: 'as.TMM',
                sortActive: this.isSortActive('as.TMM'),
                cellClass: this.tableCellClass('as-td-tmm', this.isSortActive('as.TMM')),
                align: 'center',
            },
            {
                id: 'damage',
                header: 'S/M/L',
                track: 60,
                value: row => row.kind === 'unit' && !row.vm.unit.as.usesArcs ? `${row.vm.unit.as.dmg.dmgS}/${row.vm.unit.as.dmg.dmgM}/${row.vm.unit.as.dmg.dmgL}` : '',
                sortKey: 'as.dmg._dmgS',
                sortGroupKey: 'as.damage',
                sortActive: this.isSortActive('as.damage'),
                cellClass: this.tableCellClass('as-td-dmg', this.isSortActive('as.damage')),
                align: 'center',
            },
            {
                id: 'arm',
                header: 'A',
                track: 40,
                value: row => row.kind === 'unit' ? row.vm.unit.as.Arm : '',
                sortKey: 'as.Arm',
                sortActive: this.isSortActive('as.Arm'),
                cellClass: this.tableCellClass('as-td-arm', this.isSortActive('as.Arm')),
                align: 'center',
            },
            {
                id: 'str',
                header: 'S',
                track: 40,
                value: row => row.kind === 'unit' ? row.vm.unit.as.Str : '',
                sortKey: 'as.Str',
                sortActive: this.isSortActive('as.Str'),
                cellClass: this.tableCellClass('as-td-str', this.isSortActive('as.Str')),
                align: 'center',
            },
            {
                id: 'ov',
                header: 'OV',
                track: 30,
                value: row => row.kind === 'unit' && row.vm.unit.as.usesOV ? row.vm.unit.as.OV : '',
                sortKey: 'as.OV',
                sortActive: this.isSortActive('as.OV'),
                cellClass: this.tableCellClass('as-td-ov', this.isSortActive('as.OV')),
                align: 'center',
            },
        ];

        if (this.tableSortSlotHeader()) {
            columns.push({
                id: 'sort-slot',
                header: this.tableSortSlotHeader() ?? '',
                track: 80,
                value: row => row.kind === 'unit' ? this.getAsTableSortSlot(row.vm) ?? '' : '',
                cellClass: 'as-td-sort-slot sort-slot',
                align: 'center',
            });
        }

        columns.push({
            id: 'specials',
            header: 'Special',
            track: { minPx: 220, flex: 1 },
            cellTemplate: specialsCell,
        });

        return columns;
    });

    /** Whether drag-drop is allowed (compact mode + default sort + not read-only) */
    canDragDrop = computed(() => 
        this.viewMode() === 'compact' && 
        this.selectedSort() === '' && 
        !this.isReadOnly() &&
        !this.units().some(vm => isCBTMekForceMember(vm.member))
    );

    /** All units in the force with their view model data */
    units = computed<ForceMemberViewModel[]>(() => {
        const force = this.data.force;
        const members = force.members();
        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        const viewModels: ForceMemberViewModel[] = members.map(member => ({
            member,
            unit: this.memberCatalogSummary(member),
        }));

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

        this.toggleUnitSelection(event.row.vm.member, event.event);
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

    trackByForceUnitId = (_index: number, row: ForceTableRow) => row.kind === 'group' ? `group-${row.group.id}` : row.vm.member.id;

    isForceTableGroupRow = (row: ForceTableRow) => row.kind === 'group';

    readonly forceTableRowClass = (row: ForceTableRow) => ({
        'is-selected': row.kind === 'unit' && this.isUnitSelected(row.vm.member),
    });

    /** Handle unit card click - open unit details dialog */
    onUnitClick(vm: ForceMemberViewModel, event?: MouseEvent): void {
        if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
            this.toggleUnitSelection(vm.member, event);
            return;
        }

        this.openMemberDetails(vm.member);
    }

    toggleUnitSelection(member: Readonly<{ id: string }>, event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();

        const selectedUnitIds = new Set(this.selectedUnitIds());
        if (selectedUnitIds.has(member.id)) {
            selectedUnitIds.delete(member.id);
        } else {
            selectedUnitIds.add(member.id);
        }
        this.selectedUnitIds.set(selectedUnitIds);
    }

    isUnitSelected(member: Readonly<{ id: string }>): boolean {
        return this.selectedUnitIds().has(member.id);
    }

    selectAllUnits(): void {
        this.selectedUnitIds.set(new Set(this.units().map(vm => vm.member.id)));
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
    async onPilotClick(member: ForceMember): Promise<void> {
        if (member.force.readOnly()) return;
        if (isCBTForceMember(member)) {
            await this.pilotEditor.editClassicMember(member.force, member.id);
            return;
        }
        if (member instanceof ASForceUnit) await this.pilotEditor.editAlphaStrikeUnit(member);
    }

    /** Handle force name click - open rename dialog */
    async onForceNameClick(): Promise<void> {
        if (this.isReadOnly()) return;
        await this.forceDialogs.promptChangeForceName(this.data.force);
    }

    /** Show formation info dialog */
    showFormationInfo(event: MouseEvent, group: UnitGroup): void {
        event.stopPropagation();
        this.formations.showFormationInfo(group);
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
        await this.forceDialogs.promptChangeGroupName(group);
    }

    /** Handle C3 network click - open C3 network dialog */
    async openC3Network(event: MouseEvent, member: ForceMember): Promise<void> {
        event.stopPropagation();
        await this.forceDialogs.openC3Network(
            this.data.force,
            isCBTForceMember(member) ? member.force.readOnly() : member.readOnly(),
        );
    }

    /** Handle remove unit */
    async removeUnit(event: MouseEvent, member: ForceMember): Promise<void> {
        event.stopPropagation();
        await this.forceCommands.removeUnit(member, event.ctrlKey);
    }

    /** Handle repair unit */
    async repairUnit(event: MouseEvent, member: ForceMember): Promise<void> {
        event.stopPropagation();
        await this.forceCommands.repairUnit(member);
    }

    /** Handle show unit info */
    showUnitInfo(event: MouseEvent, member: ForceMember): void {
        event.stopPropagation();
        this.openMemberDetails(member);
    }

    /** Get sorted units for a group */
    getSortedUnitsForGroup(group: UnitGroup): ForceMemberViewModel[] {
        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        const viewModels: ForceMemberViewModel[] = this.membersForGroup(group).map(member => ({
            member,
            unit: this.memberCatalogSummary(member),
        }));

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

    membersForGroup(group: UnitGroup): ForceMember[] {
        return this.data.force.membersInGroup(group);
    }

    expandedMemberUnit(member: ForceMember): UnitSummary | ForceUnit {
        return isCBTForceMember(member) ? this.resolveClassicCatalogSummary(member) : member;
    }

    memberAlias(member: ForceMember): string | null {
        return isCBTForceMember(member) ? null : member.alias() ?? null;
    }

    memberGunnery(member: ForceMember): number {
        if (!isCBTForceMember(member)) {
            return member instanceof ASForceUnit ? member.pilotSkill() : DEFAULT_GUNNERY_SKILL;
        }
        return member.force.getUnitCrewAssignment(member.id)?.positions[0]?.gunnery
            ?? DEFAULT_GUNNERY_SKILL;
    }

    memberPiloting(member: ForceMember): number {
        if (!isCBTForceMember(member)) return DEFAULT_PILOTING_SKILL;
        return member.force.getUnitCrewAssignment(member.id)?.positions[0]?.piloting
            ?? DEFAULT_PILOTING_SKILL;
    }

    private openMemberDetails(member: ForceMember): void {
        if (!isCBTForceMember(member)) {
            const unitList = this.data.force.units();
            this.dialogsService.createDialog(UnitDetailsDialogComponent, {
                data: <UnitDetailsDialogData>{
                    unitList: this.data.force.units,
                    unitIndex: unitList.findIndex(unit => unit.id === member.id),
                },
            });
            return;
        }

        const summary = this.resolveClassicCatalogSummary(member);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: [summary],
                unitIndex: 0,
                gunnerySkill: this.memberGunnery(member),
                pilotingSkill: this.memberPiloting(member),
                hideAddButton: true,
                gameSystem: this.data.force.gameSystem,
            },
        });
    }

    private memberCatalogSummary(member: ForceMember): UnitSummary {
        return isCBTForceMember(member)
            ? this.resolveClassicCatalogSummary(member)
            : member.getSummary();
    }

    private resolveClassicCatalogSummary(member: CBTForceMember): UnitSummary {
        const identity = member.force.getUnitSourceIdentity(member.id);
        const summary = identity
            ? this.dataService.getUnitByIdentity(identity.provider, identity.uuid)
            : undefined;
        if (!summary) {
            throw new Error(`Catalog presentation is unavailable for ${member.entity.displayName()}`);
        }
        return summary;
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
    async drop(event: CdkDragDrop<ForceMember[]>): Promise<void> {
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

        const movingMember = this.membersForGroup(fromGroup)[event.previousIndex];
        if (isCBTForceMember(movingMember)) {
            if (!(force instanceof CBTForce)) return;
            const moved = await force.moveMember(movingMember.id, toGroup.id, event.currentIndex);
            if (!moved.accepted) {
                this.toastService.showToast(`Could not move unit: ${moved.reason}`, 'error');
                return;
            }
            await this.formations.assignFormationIfNeeded(fromGroup);
            if (fromGroup !== toGroup) await this.formations.assignFormationIfNeeded(toGroup);
            return;
        }

        if (fromGroup === toGroup) {
            fromGroup.reorderUnit(event.previousIndex, event.currentIndex);
        } else {
            const moved = fromGroup.moveUnitTo(event.previousIndex, toGroup, event.currentIndex);
            if (!moved) return;
            await this.formations.assignFormationIfNeeded(fromGroup);
            await this.formations.assignFormationIfNeeded(toGroup);
        }

        force.removeEmptyGroups();
        force.emitChanged();
    }

    /** Handle drop to create a new group */
    async dropForNewGroup(event: CdkDragDrop<any>): Promise<void> {
        if (this.isReadOnly()) return;

        const force = this.data.force;
        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) return;

        const sourceGroupId = prevId.substring('group-'.length);
        const sourceGroup = force.groups().find(g => g.id === sourceGroupId);
        if (!sourceGroup) return;

        const movingMember = this.membersForGroup(sourceGroup)[event.previousIndex];
        if (!movingMember) return;
        const newGroup = await force.addGroup();

        if (isCBTForceMember(movingMember)) {
            if (!(force instanceof CBTForce)) {
                await force.removeGroup(newGroup);
                return;
            }
            const moved = await force.moveMember(movingMember.id, newGroup.id, 0);
            if (!moved.accepted) {
                await force.removeRosterGroup(newGroup);
                this.toastService.showToast(`Could not move unit: ${moved.reason}`, 'error');
                return;
            }
        } else {
            const moved = sourceGroup.moveUnitTo(event.previousIndex, newGroup);
            if (!moved) {
                await force.removeGroup(newGroup);
                return;
            }
        }

        await this.formations.assignFormationIfNeeded(sourceGroup);
        await this.formations.assignFormationIfNeeded(newGroup);
        if (!(force instanceof CBTForce)) {
            force.removeEmptyGroups();
            force.emitChanged();
        }
    }

    /** Handle group drag-drop for reordering within the force */
    async dropGroup(event: CdkDragDrop<UnitGroup[]>): Promise<void> {
        if (this.isReadOnly()) return;
        await this.data.force.reorderGroup(event.previousIndex, event.currentIndex);
    }

    /** Handle click on empty group to remove it */
    onEmptyGroupClick(group: UnitGroup): void {
        if (this.isReadOnly()) return;
        if (this.membersForGroup(group).length === 0) {
            this.forceCommands.removeGroup(group);
        }
    }

    // --- AS Table View Helpers ---

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

    /** Get the sort slot value for AS table row view */
    getAsTableSortSlot(vm: ForceMemberViewModel): string | null {
        const sortKey = this.selectedSort();
        if (!sortKey || !this.isAlphaStrike()) return null;
        
        // Check if already visible in table
        if (this.AS_TABLE_VISIBLE_KEYS.includes(sortKey)) return null;
        for (const [groupKey, members] of Object.entries(this.SORT_KEY_GROUPS)) {
            if (this.AS_TABLE_VISIBLE_KEYS.includes(groupKey) && members.includes(sortKey)) return null;
        }
        
        const val = this.getNestedProperty(vm.unit, sortKey);
        if (val == null) return null;
        return typeof val === 'number' ? String(val) : String(val);
    }

    getTableSortSlot(unit: UnitSummary): string {
        return formatUnitDataTableSortSlotValue(unit, this.selectedSort(), (candidate, key) => (
            this.getNestedProperty(candidate, key)
        ));
    }

    formatClassicMovement(unit: UnitSummary): string {
        return formatClassicUnitMovement(unit);
    }

    /** Format movement value for Alpha Strike table view */
    formatASMovement(unit: UnitSummary): string {
        const mvm = unit.as.MVm;
        if (!mvm) return unit.as.MV ?? '';

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        if (entries.length === 0) return unit.as.MV ?? '';

        return entries
            .sort((a, b) => {
                if (a[0] === '') return -1;
                if (b[0] === '') return 1;
                return 0;
            })            
            .map(([mode, inches]) => formatMovement(inches, mode, this.useHex()))
            .join('/');
    }

    private tableCellClass(base: string, active: boolean): string {
        return active ? `${base} sort-slot` : base;
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

    /** Get pilot skill for AS table display */
    getPilotSkill(vm: ForceMemberViewModel): number {
        return this.memberGunnery(vm.member);
    }

    private normalizeViewMode(viewMode: 'expanded' | 'compact' | 'table'): 'expanded' | 'compact' | 'table' {
        return viewMode;
    }

    private setViewMode(viewMode: 'expanded' | 'compact' | 'table') {
        const normalizedViewMode = this.normalizeViewMode(viewMode);
        if (normalizedViewMode === 'compact') {
            this.clearUnitSelection();
        }
        this.viewMode.set(normalizedViewMode);
        void this.optionsService.setOption('forceOverviewViewMode', normalizedViewMode);
    }
}
