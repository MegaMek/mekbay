// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, type ComponentRef, DestroyRef, inject, Injector, input } from '@angular/core';
import { DragDropModule, type CdkDragDrop, type CdkDragStart, moveItemInArray } from '@angular/cdk/drag-drop';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { HandlerChoice } from '../../services/equipment-interaction-registry.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { INVENTORY_MODE_CHOICE_LABEL, INVENTORY_MODE_HANDLER_ID } from '../../equipment-handlers/inventory-mode.handler';
import { changeAmmoEntriesRemaining, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining, setAmmoEntryValue } from '../../utils/ammo-interaction.util';
import type { HeatDissipationState } from '../../models/rules/heat-management';
import { LayoutService } from '../../services/layout.service';
import { MultilineDropdownComponent, type MultilineDropdownOption } from '../multiline-dropdown/multiline-dropdown.component';
import { WeaponTargetChoiceMenuComponent } from '../equipment-dialog/weapon-target-choice-menu.component';
import type { InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { formatInventoryTargetSignedModifier, inventoryTargetNumberState, inventoryTargetRangeSelection, type InventoryTargetNumberInput, type InventoryTargetRangeSelection } from '../../utils/inventory-target-number.util';
import { SKILL_BREAKDOWN_PRIORITY, type C3DegradationSource, type ToHitResolution } from '../../models/rules/game-rules';
import type { EquipmentDialogContext } from './equipment-dialog.model';
import {
    formatInventoryControlModeName,
    getInventoryControlGroups,
    isInventoryControlSelectableEntry,
    resolveInventoryControlSelectedAmmoOption,
    selectInventoryControlEntry,
    setInventoryControlSortOrder,
    type InventoryControlAmmoOption,
    type InventoryControlGroup,
    type InventoryControlRow,
    type InventoryRangeDisplayKey,
    type InventoryRangeKey
} from '../../utils/inventory-control.util';
import { inventoryControlDamageRange, resolveInventoryControlDamageText } from '../../utils/inventory-control-damage.util';
import { MASC_HANDLER_ID } from '../../equipment-handlers/masc.handler';
import { ESCALATING_FAILURE_HANDLER_ID } from '../../equipment-handlers/escalatingfailure.handler';
import { TN_IMMOBILE } from '../../models/target-number-calculator.model';
import { orderedModifierTooltipLines } from '../../utils/hit-target-tooltip.util';
import { STANDARD_AEROSPACE_RANGE_LIMITS, aerospaceRangeCaptions } from '../../utils/aerospace-range.util';
import { calculateHeatProjection } from '../../models/turn-state.model';
import { resolveSelectedWeaponFiringHeatSources, SELECTED_WEAPONS_HEAT_SOURCE_ID } from '../../utils/inventory-control-heat.util';
import type { UnitModifierBreakdownEntry } from '../../models/rules/unit-type-rules';

interface RangeColumn {
    key: InventoryRangeDisplayKey;
    label: string;
    caption?: string;
}

const GROUND_RANGE_COLUMNS: readonly RangeColumn[] = [
    { key: 'short', label: 'Sht' },
    { key: 'medium', label: 'Med' },
    { key: 'long', label: 'Lng' }
];
const GROUND_EXTREME_RANGE_COLUMNS: readonly RangeColumn[] = [
    ...GROUND_RANGE_COLUMNS,
    { key: 'extreme', label: 'Ext' }
];
const AERO_RANGE_CAPTIONS = aerospaceRangeCaptions(STANDARD_AEROSPACE_RANGE_LIMITS);
const AERO_RANGE_COLUMNS: readonly RangeColumn[] = [
    { key: 'short', label: 'SRV', caption: AERO_RANGE_CAPTIONS[0] },
    { key: 'medium', label: 'MRV', caption: AERO_RANGE_CAPTIONS[1] },
    { key: 'long', label: 'LRV', caption: AERO_RANGE_CAPTIONS[2] },
    { key: 'extreme', label: 'ERV', caption: AERO_RANGE_CAPTIONS[3] }
];
const HEAT_BAR_SCALE = 30;
const WEAPON_TARGET_CHOICE_OVERLAY_KEY = 'weapon-equipment-target-choice';

interface SelectedHeatProjection {
    current: number;
    base: number;
    sources: number;
    selection: number;
    pending: number;
    dissipation: number;
    final: number;
    pendingWidth: number;
    dissipationWidth: number;
    retainedWidth: number;
}

interface TargetNumberBreakdown {
    total: number;
    lines: TooltipLine[];
}

interface SectionSkillDisplay {
    label: 'Gunnery' | 'Piloting';
    value: string;
}

interface TargetRowState {
    target: InventoryControlRuntimeTarget | null;
    invalidTarget: boolean;
    invalidTargetReason?: 'type' | 'out-of-range';
    rangeSelection: InventoryTargetRangeSelection | null;
    hitText: string;
    hitModifierTooltip: TooltipLine[] | null;
    hitModifierWeakened: boolean;
    damageText: string;
    targetNumberText: string;
    targetNumberTooltip: TooltipLine[] | null;
    breakdown: TargetNumberBreakdown | null;
}

interface AmmoRowState {
    hasAmmo: boolean;
    showDropdown: boolean;
    selectedOption: InventoryControlAmmoOption | undefined;
    selectedOptionId: string;
    text: string;
    depleted: boolean;
    destroyed: boolean;
    disabled: boolean;
    canDecrease: boolean;
    canIncrease: boolean;
}

interface AmmoConsumptionRequest {
    row: InventoryControlRow;
    option: InventoryControlAmmoOption;
    count: number;
}

interface AmmoConsumptionSummaryItem {
    label: string;
    count: number;
}

interface DragPreviewCellSizing {
    path: number[];
    width: number;
}

interface DragPreviewSizing {
    sourceRow: HTMLElement;
    rowWidth: number;
    gridTemplateColumns: string;
    cells: DragPreviewCellSizing[];
}

@Component({
    selector: 'weapons-equipment-panel',
    standalone: true,
    imports: [DragDropModule, MultilineDropdownComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './weapons-equipment-panel.component.html',
    styleUrl: './weapons-equipment-panel.component.scss'
})
export class WeaponsEquipmentPanelComponent {
    readonly layoutService = inject(LayoutService);
    private readonly overlay = inject(Overlay);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    readonly outOfRangeTooltip: TooltipLine[] = [{ value: 'OUT OF RANGE', isHeader: true }];
    readonly invalidTargetTypeTooltip: TooltipLine[] = [{ value: 'INVALID TARGET', isHeader: true }];
    readonly unitInput = input.required<CBTForceUnit>({ alias: 'unit' });
    readonly contextInput = input.required<EquipmentDialogContext>({ alias: 'context' });
    readonly readOnlyInput = input<boolean | undefined>(undefined, { alias: 'readOnly' });
    private pendingDragPreviewSizing: DragPreviewSizing | null = null;
    readonly unit = computed(() => this.unitInput());
    readonly usesAerospaceWeaponValues = computed(() => this.unit().getUnit().type === 'Aero');
    readonly showsGroundExtremeRange = computed(() =>
        !this.usesAerospaceWeaponValues() && this.unit().allowsExtremeRangeAttacks());
    readonly rangeColumns = computed(() => this.usesAerospaceWeaponValues()
        ? AERO_RANGE_COLUMNS
        : this.showsGroundExtremeRange() ? GROUND_EXTREME_RANGE_COLUMNS : GROUND_RANGE_COLUMNS);
    readonly context = computed(() => this.contextInput());
    readonly inventoryControl = computed(() => this.unit().inventoryControl);
    readonly gunnerySkillDisplay = computed<SectionSkillDisplay>(() => ({
        label: 'Gunnery',
        value: this.unit().rules.getBaseGunnerySkill().toString()
    }));
    readonly pilotingSkillDisplay = computed<SectionSkillDisplay>(() => ({
        label: 'Piloting',
        value: this.unit().rules.getBasePilotingSkill().toString()
    }));
    readonly groups = computed(() => {
        this.inventoryControl().inventoryViewVersion();
        return getInventoryControlGroups(
            this.unit(),
            this.context().queryContext.equipmentCatalog,
            this.unit().getInventoryControlRules()
        );
    });

    sectionSkill(group: InventoryControlGroup): SectionSkillDisplay | null {
        if (group.id === 'ranged') return this.gunnerySkillDisplay();
        if (group.id === 'physical') return this.pilotingSkillDisplay();
        return null;
    }

    readonly targets = computed(() => {
        this.unit().getInventoryControlTargetsMap();
        return this.unit().getInventoryControlTargets();
    });
    readonly hasTargets = computed(() => this.targets().length > 0);
    readonly hasAmmoColumn = computed(() => this.groups().some(group => this.groupTracksAmmo(group)));
    readonly hasControlsColumn = computed(() => this.groups().some(group => this.groupHasControls(group)));
    readonly hasActionsColumn = computed(() => this.groups().some(group => this.groupHasActions(group)));
    readonly tracksHeat = computed(() => this.heatDissipationState() !== null);
    readonly selectedRows = computed(() => {
        const entryStates = this.inventoryControl().entryStates();
        return this.groups()
            .flatMap(group => group.rows)
            .filter(row => entryStates.get(row.id)?.selected ?? false);
    });
    readonly selectedHeatTotal = computed(() => this.selectedRows()
        .reduce((total, row) => total + this.heatValue(row), 0));
    readonly selectedHeatProjection = computed<SelectedHeatProjection | null>(() => {
        this.inventoryControl().inventoryViewVersion();
        const dissipationState = this.heatDissipationState();
        if (!dissipationState) return null;
        const heat = this.unit().getHeat();
        const base = heat.next ?? heat.current;
        const selectedWeaponHeat = this.unit().selectedInventoryWeaponHeat();
        const selection = selectedWeaponHeat.value;
        const dissipation = this.unit().turnState().effectiveHeatDissipation();
        const previewSources = resolveSelectedWeaponFiringHeatSources(
            this.unit().turnState().heatSources(),
            selectedWeaponHeat
        );
        const projection = calculateHeatProjection(base, previewSources, dissipation);
        const sources = previewSources
            .filter(source => source.id !== SELECTED_WEAPONS_HEAT_SOURCE_ID)
            .reduce((total, source) => total + Math.max(0, source.value), 0);
        const pending = base + projection.sourceHeat;
        const final = projection.projected;
        return {
            current: base,
            base,
            sources,
            selection,
            pending,
            dissipation,
            final,
            pendingWidth: this.heatPercent(pending, HEAT_BAR_SCALE),
            dissipationWidth: this.heatPercent(dissipation, HEAT_BAR_SCALE),
            retainedWidth: this.heatPercent(final, HEAT_BAR_SCALE)
        };
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        });
    }

    onRowTargetSelectorClick(event: MouseEvent, row: InventoryControlRow): void {
        event.stopPropagation();
        const updated = selectInventoryControlEntry(this.unit(), row.entry, selectedTargetId => {
            this.openTargetChoiceOverlay(
                event.currentTarget as HTMLElement,
                selectedTargetId,
                targetId => {
                    this.unit().setInventoryControlEntryTarget(row.entry, targetId);
                },
                this.targetChoiceTargetNumberTexts(row)
            );
        });
    }

    groupTargetSelection(group: InventoryControlGroup): InventoryControlRuntimeTarget | null {
        const rows = this.groupActiveSelectableRows(group);
        if (rows.length === 0) return null;
        const firstTargetId = this.unit().getInventoryControlEntryTargetId(rows[0].id);
        if (!firstTargetId || !rows.every(row => this.unit().getInventoryControlEntryTargetId(row.id) === firstTargetId)) {
            return null;
        }
        return this.targets().find(target => target.id === firstTargetId) ?? null;
    }

    groupSomeTargetRowsSelected(group: InventoryControlGroup): boolean {
        const rows = this.groupActiveSelectableRows(group);
        const selectedCount = rows.filter(row => !!this.unit().getInventoryControlEntryTargetId(row.id)).length;
        return selectedCount > 0 && selectedCount < rows.length;
    }

    onGroupTargetSelectorClick(event: MouseEvent, group: InventoryControlGroup): void {
        event.stopPropagation();
        if (group.id !== 'ranged') return;
        const targets = this.targets();
        if (targets.length === 0) return;
        if (targets.length === 1) {
            const targetId = targets[0].id;
            const selected = this.groupTargetSelection(group)?.id === targetId;
            this.setGroupTarget(group, selected ? null : targetId);
            return;
        }

        this.openTargetChoiceOverlay(
            event.currentTarget as HTMLElement,
            this.groupTargetSelection(group)?.id ?? null,
            targetId => this.setGroupTarget(group, targetId)
        );
    }

    private setGroupTarget(group: InventoryControlGroup, targetId: InventoryControlRuntimeTargetId | null): void {
        const rows = targetId ? this.groupActiveSelectableRows(group) : this.groupSelectableRows(group);
        for (const row of rows) {
            this.unit().setInventoryControlEntryTarget(row.entry, targetId);
        }
    }

    private openTargetChoiceOverlay(
        anchor: HTMLElement,
        selectedTargetId: InventoryControlRuntimeTargetId | null,
        onSelect: (targetId: InventoryControlRuntimeTargetId | null) => void,
        targetNumberTexts: Readonly<Record<InventoryControlRuntimeTargetId, string>> = {}
    ): void {
        this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        const portal = new ComponentPortal(WeaponTargetChoiceMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY, anchor, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-target-choice-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
                { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        componentRef.setInput('targets', this.targets());
        componentRef.setInput('selectedTargetId', selectedTargetId);
        componentRef.setInput('targetNumberTexts', targetNumberTexts);
        componentRef.changeDetectorRef.detectChanges();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            onSelect(targetId);
            this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        });
    }

    groupTracksAmmo(group: InventoryControlGroup): boolean {
        return group.rows.some(row => row.tracksAmmo);
    }

    groupHasControls(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasControls(row));
    }

    groupHasActions(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasActions(row));
    }

    groupActionsHeader(group: InventoryControlGroup): string {
        const hasAmmo = this.groupTracksAmmo(group);
        const hasControls = this.groupHasControls(group);
        if (hasAmmo && hasControls) return 'Ammo & Controls';
        if (hasAmmo) return 'Ammo';
        if (hasControls) return 'Controls';
        return '';
    }

    rowHasControls(row: InventoryControlRow): boolean {
        return this.handlerChoices(row).length > 0 || this.canMarkDestroyed(row) || this.canRepair(row);
    }

    rowHasActions(row: InventoryControlRow): boolean {
        return row.tracksAmmo || this.rowHasControls(row);
    }

    readOnly(): boolean {
        return this.readOnlyInput() ?? this.unit().readOnly();
    }

    isSelectable(row: InventoryControlRow): boolean {
        return isInventoryControlSelectableEntry(row.entry);
    }

    isSelected(row: InventoryControlRow): boolean {
        return this.unit().isInventoryControlEntrySelected(row.id);
    }

    toggleSelected(row: InventoryControlRow): void {
        if (row.disabled || row.destroyed) return;
        selectInventoryControlEntry(this.unit(), row.entry);
    }

    groupAllSelectableRowsSelected(group: InventoryControlGroup): boolean {
        const rows = this.groupActiveSelectableRows(group);
        return rows.length > 0 && rows.every(row => this.isSelected(row));
    }

    groupSomeSelectableRowsSelected(group: InventoryControlGroup): boolean {
        const rows = this.groupActiveSelectableRows(group);
        return rows.some(row => this.isSelected(row)) && !rows.every(row => this.isSelected(row));
    }

    toggleGroupSelectableRows(group: InventoryControlGroup): void {
        if (group.id !== 'ranged') return;
        const selected = !this.groupAllSelectableRowsSelected(group);
        const rows = selected ? this.groupActiveSelectableRows(group) : this.groupSelectableRows(group);
        rows.forEach(row => this.unit().setInventoryControlEntrySelected(row.entry, selected));
    }

    resetSelections(): void {
        this.unit().clearInventoryControlSelection();
    }

    hasSelectedRows(): boolean {
        return this.selectedRows().length > 0;
    }

    canSelectRange(row: InventoryControlRow, range: InventoryRangeDisplayKey, state = this.targetState(row)): boolean {
        if (state.target || row.disabled || row.destroyed) return false;
        if (range === 'extreme' && !this.usesAerospaceWeaponValues() && !this.showsGroundExtremeRange()) return false;
        const value = this.rangeValue(row, range);
        return this.isSelectable(row) && value !== '—';
    }

    selectRange(row: InventoryControlRow, range: InventoryRangeDisplayKey): void {
        if (!this.canSelectRange(row, range)) return;
        this.unit().toggleInventoryControlEntryRange(row.entry, range);
    }

    isRangeSelected(row: InventoryControlRow, range: InventoryRangeDisplayKey, state = this.targetState(row)): boolean {
        if (row.category === 'physical' && state.target) return false;
        const targetRange = state.rangeSelection;
        if (targetRange) {
            return !targetRange.outOfRange && targetRange.range === range;
        }
        return this.unit().getInventoryControlEntryRange(row.id) === range;
    }

    private resolveHitForRange(row: InventoryControlRow, range: InventoryControlRuntimeRangeKey | null): ToHitResolution {
        const selectedAmmo = this.resolvedSelectedAmmoOption(row)?.ammo ?? null;
        const rules = this.unit().getInventoryControlRules();
        return this.unit().gameRules.resolveToHit({
            subject: row.entry,
            stateModifiers: row.hitModifierBreakdown,
            range,
            adjustments: rules.resolveToHitAdjustments?.(row.entry, selectedAmmo)
        });
    }

    private hitTextForResolution(
        row: InventoryControlRow,
        resolution: ToHitResolution,
        hasTarget: boolean,
        hasSelectedRange: boolean,
        attackModifierBreakdown: readonly UnitModifierBreakdownEntry[]
    ): string {
        const attackModifier = attackModifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
        if (!hasTarget && resolution.value === null) {
            return row.display.hit;
        }
        if (!hasTarget && !hasSelectedRange && resolution.profile.length > 1) {
            return resolution.profile
                .map(value => formatInventoryTargetSignedModifier(value + attackModifier))
                .join('/');
        }
        return this.formatHitValue(resolution, attackModifier);
    }

    private formatHitValue(resolution: ToHitResolution, attackModifier: number): string {
        const { value } = resolution;
        if (value === null) return '';
        if (value === 'Vs') {
            if (resolution.modifierBreakdown.length === 0 && attackModifier === 0) return value;
            const modifier = resolution.modifierBreakdown.reduce((total, entry) => total + entry.modifier, attackModifier);
            const prefix = resolution.modifierBreakdown.length > 0 ? 'VS' : value;
            return `${prefix}${formatInventoryTargetSignedModifier(modifier)}`;
        }
        if (typeof value === 'number') return formatInventoryTargetSignedModifier(value + attackModifier);
        return value;
    }

    private hitModifierTooltip(
        resolution: ToHitResolution,
        attackModifierBreakdown: readonly UnitModifierBreakdownEntry[]
    ): TooltipLine[] | null {
        const modifierBreakdown = [...attackModifierBreakdown, ...resolution.modifierBreakdown];
        if (modifierBreakdown.length === 0) return null;
        const formatModifier = (entry: UnitModifierBreakdownEntry): string => formatInventoryTargetSignedModifier(entry.modifier);
        const lines = orderedModifierTooltipLines(modifierBreakdown, formatModifier);
        if (lines.length <= 1) return lines;
        const modifier = modifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
        if (resolution.value === 'Vs') {
            return [
                ...lines,
                { isBreak: true },
                { label: 'Total', value: `VS${formatInventoryTargetSignedModifier(modifier)}`, isHeader: true },
            ];
        }
        if (typeof resolution.value !== 'number') return lines;
        return [
            ...lines,
            { isBreak: true },
            { label: 'Total', value: formatInventoryTargetSignedModifier(modifier), isHeader: true },
        ];
    }

    private targetNumberTooltip(
        row: InventoryControlRow,
        resolution: ToHitResolution,
        breakdown: TargetNumberBreakdown | null,
    ): TooltipLine[] | null {
        if (resolution.value !== 'Vs') return breakdown?.lines ?? null;
        if (resolution.modifierBreakdown.length === 0) return null;
        const modifier = resolution.modifierBreakdown.reduce((total, entry) => total + entry.modifier, 0);
        const total = modifier === 0 ? 'Vs' : `Vs${formatInventoryTargetSignedModifier(modifier)}`;
        const lines: TooltipLine[] = [
            { label: row.display.name, value: 'Vs', priority: SKILL_BREAKDOWN_PRIORITY },
            ...orderedModifierTooltipLines(
                resolution.modifierBreakdown,
                entry => formatInventoryTargetSignedModifier(entry.modifier),
            ),
        ];
        return [
            ...lines,
            { isBreak: true },
            { label: 'Total', value: total, isHeader: true },
        ];
    }

    rangeValue(row: InventoryControlRow, range: InventoryRangeDisplayKey): string {
        if (range === 'extreme' && !this.usesAerospaceWeaponValues()) {
            return row.extremeRange?.toString() ?? '—';
        }
        return row.rangePresentation.values[range];
    }

    private targetChoiceTargetNumberTexts(row: InventoryControlRow): Readonly<Record<InventoryControlRuntimeTargetId, string>> {
        return Object.fromEntries(this.targets()
            .map(target => [target.id, this.targetNumberTextForTarget(row, target)] as const)
            .filter(([, targetNumber]) => targetNumber !== ''));
    }

    private canTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget): boolean {
        return !row.damageTypes.includes('AE')
            || target.unitType === 'terrain'
            || target.unitType === 'building';
    }

    private targetNumberTextForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): string {
        return this.createTargetState(row, target).targetNumberText;
    }

    private targetNumberInput(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null, hitResolution: ToHitResolution, c3DegradationSource: C3DegradationSource = 'none'): InventoryTargetNumberInput {
        this.inventoryControl().inventoryViewVersion();
        const missingMovementModifier = this.unit().turnState().missingAttackMovementModifier();
        const selectedAmmo = this.resolvedSelectedAmmoOption(row)?.ammo ?? null;
        return {
            entry: row.entry,
            category: row.category,
            display: row.display,
            extremeRange: row.extremeRange,
            allowExtremeRange: this.unit().allowsExtremeRangeAttacks(),
            selectedAmmo,
            target,
            gunnerySkill: this.unit().rules.getBaseGunnerySkill(),
            pilotingSkill: this.unit().rules.getBasePilotingSkill(),
            missingMovementModifier,
            attackModifierBreakdown: this.unit().turnState().getAttackModifierBreakdown(),
            hitResolution,
            c3DegradationSource,
            gameRules: this.unit().gameRules
        };
    }

    targetState(row: InventoryControlRow): TargetRowState {
        const target = this.resolveTargetForRow(row);
        return this.createTargetState(row, target);
    }

    private createTargetState(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): TargetRowState {
        const c3Resolution = target
            ? this.unit().resolveC3Targeting(target)
            : { target: null, degradationSource: 'none' as const };
        const calculationTarget = this.targetForTargetNumber(row, c3Resolution.target);
        const selectedAmmo = this.resolvedSelectedAmmoOption(row)?.ammo ?? null;
        const selectedAmmoProfile = selectedAmmo
            ? null
            : row.modes.find(mode => mode.mode === row.selectedMode)?.ammoProfile ?? null;
        const rangeSelection = inventoryTargetRangeSelection({
            entry: row.entry,
            category: row.category,
            display: row.display,
            extremeRange: row.extremeRange,
            allowExtremeRange: this.unit().allowsExtremeRangeAttacks(),
            target: calculationTarget,
            selectedAmmo
        });
        const weaponRuleRangeSelection = inventoryTargetRangeSelection({
            entry: row.entry,
            category: row.category,
            display: row.display,
            extremeRange: row.extremeRange,
            allowExtremeRange: this.unit().allowsExtremeRangeAttacks(),
            target: this.targetForWeaponRange(target),
            selectedAmmo
        });
        const weaponRuleRange = weaponRuleRangeSelection?.range ?? this.unit().getInventoryControlEntryRange(row.id) ?? null;
        const hitResolution = this.resolveHitForRange(row, weaponRuleRange);
        const attackModifierBreakdown = this.unit().turnState().getAttackModifierBreakdown();
        const hitText = this.hitTextForResolution(
            row,
            hitResolution,
            !!target,
            weaponRuleRange !== null,
            attackModifierBreakdown,
        );
        const input = this.targetNumberInput(row, calculationTarget, hitResolution, c3Resolution.degradationSource);
        const targetNumber = inventoryTargetNumberState(input, rangeSelection);
        const breakdown = targetNumber.breakdown === null ? null : { total: targetNumber.breakdown.total, lines: targetNumber.breakdown.lines };
        const invalidTargetType = false; // target !== null && !this.canTarget(row, target);
        const invalidTarget = invalidTargetType || (rangeSelection?.outOfRange ?? false);
        const invalidTargetReason = invalidTargetType ? 'type' : rangeSelection?.outOfRange ? 'out-of-range' : undefined;
        return {
            target,
            invalidTarget,
            invalidTargetReason,
            rangeSelection,
            hitText,
            hitModifierTooltip: this.hitModifierTooltip(hitResolution, attackModifierBreakdown),
            hitModifierWeakened: hitResolution.weakened || attackModifierBreakdown.some(entry => entry.weakened === true),
            damageText: resolveInventoryControlDamageText(
                row.entry,
                {
                    selectedRange: inventoryControlDamageRange(weaponRuleRange),
                    selectedAmmo,
                    ammoProfile: selectedAmmoProfile,
                    equipmentCatalog: this.context().queryContext.equipmentCatalog,
                },
                this.unit().getInventoryControlRules()
            ) ?? row.display.damage,
            targetNumberText: invalidTarget ? 'X' : targetNumber.text,
            targetNumberTooltip: this.targetNumberTooltip(row, hitResolution, breakdown),
            breakdown
        };
    }

    private resolveTargetForRow(row: InventoryControlRow): InventoryControlRuntimeTarget | null {
        const targetId = this.unit().getInventoryControlEntryTargetId(row.id);
        return targetId ? this.targets().find(target => target.id === targetId) ?? null : null;
    }

    private targetForTargetNumber(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): InventoryControlRuntimeTarget | null {
        if (!target) return null;
        const ignoreImmobileModifier = row.damageTypes.includes('AE')
            && target.tnCalculator?.stance === 'immobile';
        if (!ignoreImmobileModifier) return target;
        return {
            ...target,
            tnModifier: target.tnModifier - TN_IMMOBILE
        };
    }

    private targetForWeaponRange(target: InventoryControlRuntimeTarget | null): InventoryControlRuntimeTarget | null {
        if (!target || target.c3Distance === undefined) return target;
        return { ...target, c3Distance: undefined };
    }

    ammoState(row: InventoryControlRow): AmmoRowState {
        const hasUsableAmmo = this.hasUsableAmmoOption(row);
        const hasAmmo = row.tracksAmmo && hasUsableAmmo;
        const selectedOption = this.resolvedSelectedAmmoOption(row);
        const selectedOptionId = selectedOption?.id ?? '';
        const text = this.ammoStateText(row, hasAmmo, selectedOption);
        const depleted = row.tracksAmmo
            ? selectedOption?.remaining !== undefined ? selectedOption.remaining <= 0 : row.ammo.remaining <= 0
            : false;
        const destroyed = !!selectedOption?.destroyed;
        const disabled = !!selectedOption?.disabled && !destroyed;
        return {
            hasAmmo,
            showDropdown: row.ammo.options.length > 1 && hasUsableAmmo,
            selectedOption,
            selectedOptionId,
            text,
            depleted,
            destroyed,
            disabled,
            canDecrease: this.canAdjustResolvedAmmo(row, selectedOption, 1, hasUsableAmmo),
            canIncrease: this.canAdjustResolvedAmmo(row, selectedOption, -1, hasUsableAmmo),
        };
    }

    private resolvedSelectedAmmoOption(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        const selection = this.unit().getInventoryControlEntryAmmoSelection(row.id);
        return resolveInventoryControlSelectedAmmoOption(
            row.ammo.options,
            selection?.selectedProfileId,
            selection?.preferredSourceOptionId
        );
    }

    private ammoStateText(row: InventoryControlRow, hasAmmo: boolean, selectedOption: InventoryControlAmmoOption | undefined): string {
        if (!hasAmmo) return '';
        if (selectedOption) return selectedOption.label;
        if (row.ammo.options.length === 1) return row.ammo.options[0].label;
        return `${row.ammo.remaining}/${row.ammo.total}`;
    }

    ammoDropdownOptions(row: InventoryControlRow): MultilineDropdownOption[] {
        return row.ammo.options.map(option => ({
            value: option.id,
            label: option.label,
            disabled: option.disabled,
            destroyed: option.destroyed,
        }));
    }

    selectAmmoOption(row: InventoryControlRow, value: string): void {
        const option = row.ammo.options.find(candidate => candidate.id === value);
        if (!option?.ammo) return;
        this.persistResolvedAmmoSelection(row, option);
    }

    private canAdjustResolvedAmmo(row: InventoryControlRow, option: InventoryControlAmmoOption | undefined, delta: number, hasUsableAmmo: boolean): boolean {
        if (this.readOnly() || !row.tracksAmmo || delta === 0) return false;
        if (!option || option.disabled) return false;
        if (!hasUsableAmmo) return false;
        if (delta > 0) return option.remaining > 0;
        return option.remaining < option.total;
    }

    adjustAmmo(row: InventoryControlRow, delta: number): void {
        const state = this.ammoState(row);
        if (delta > 0 && !state.canDecrease) return;
        if (delta < 0 && !state.canIncrease) return;
        if (delta === 0) return;
        const option = state.selectedOption;
        if (!option) return;
        const changed = changeAmmoEntriesRemaining(this.getAmmoEntriesForOption(row, option.id), -delta, this.context().commandContext);
        if (changed) {
            this.persistResolvedAmmoSelection(row, option);
            this.inventoryControl().markInventoryViewChanged();
        }
    }

    async consumeSelectedHeatAndAmmo(): Promise<void> {
        if (this.readOnly()) return;
        const selectedRows = this.selectedRows();
        if (selectedRows.length === 0) return;
        const unavailableRow = selectedRows.find(row => row.disabled || row.destroyed);
        if (unavailableRow) {
            await this.context().commandContext.dialogsService.showError(`${unavailableRow.display.name} cannot be fired.`, 'Weapon Unavailable');
            return;
        }

        const requests = new Map<string, AmmoConsumptionRequest>();
        for (const row of selectedRows) {
            if (!row.tracksAmmo) continue;
            const option = this.selectedAmmo(row);
            if (!option || option.disabled || option.remaining <= 0) {
                await this.context().commandContext.dialogsService.showError(`${row.display.name} has no available ammo.`, 'No Ammo');
                return;
            }
            const requestKey = option.id;
            const request = requests.get(requestKey);
            if (request) {
                request.count += 1;
            } else {
                requests.set(requestKey, { row, option, count: 1 });
            }
        }

        for (const request of requests.values()) {
            const remaining = this.getAmmoEntriesForOption(request.row, request.option.id)
                .reduce((total, entry) => total + getAmmoEntryRemaining(entry), 0);
            if (remaining < request.count) {
                await this.context().commandContext.dialogsService.showError(`${request.option.label} does not have enough ammo for the selected weapons.`, 'Not Enough Ammo');
                return;
            }
        }

        const heatProjection = this.selectedHeatProjection();
        const hasManualHeatTarget = this.unit().getHeat().next !== undefined;

        for (const request of requests.values()) {
            this.persistResolvedAmmoSelection(request.row, request.option);
            this.consumeAmmoFromOption(request.row, request.option.id, request.count);
        }

        if (heatProjection) {
            this.unit().turnState().addFiredHeat(heatProjection.selection);
            if (hasManualHeatTarget) {
                this.unit().setHeat(heatProjection.final);
            }
        }
        await this.runSelectedFireHooks(selectedRows);
        this.inventoryControl().markInventoryViewChanged();
        const ammoSummary = Array.from(requests.values())
            .map(request => this.consumedAmmoSummaryItem(request));
        await this.context().commandContext.dialogsService.showNoticeHtml(
            this.consumptionSummaryHtml(ammoSummary, heatProjection),
            'Weapons Fired'
        );
    }

    private selectedAmmo(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        return this.ammoState(row).selectedOption;
    }

    private persistResolvedAmmoSelection(row: InventoryControlRow, option: InventoryControlAmmoOption): void {
        const selection = this.unit().getInventoryControlEntryAmmoSelection(row.id);
        if (selection?.selectedProfileId === option.profileId
            && selection.preferredSourceOptionId === option.id) return;
        this.unit().setInventoryControlEntryAmmoSelection(row.id, {
            selectedProfileId: option.profileId,
            preferredSourceOptionId: option.id,
        });
    }

    private getAmmoEntriesForOption(row: InventoryControlRow, optionId: string) {
        return getAmmoControlEntriesForWeapon(row.entry, this.context().queryContext.equipmentCatalog)
            .filter(entry => entry.id === optionId
                || `${entry.currentAmmo.internalName}:${entry.locationLabel}` === optionId);
    }

    private consumeAmmoFromOption(row: InventoryControlRow, optionId: string, count: number): void {
        let remainingToConsume = count;
        const entries = this.getAmmoEntriesForOption(row, optionId)
            .filter(entry => getAmmoEntryRemaining(entry) > 0)
            .reverse();
        for (const entry of entries) {
            if (remainingToConsume <= 0) return;
            const consumedFromEntry = Math.min(getAmmoEntryRemaining(entry), remainingToConsume);
            setAmmoEntryValue(
                entry,
                entry.currentAmmo,
                entry.totalAmmo,
                getAmmoEntryRemaining(entry) - consumedFromEntry,
            );
            remainingToConsume -= consumedFromEntry;
        }
    }

    private async runSelectedFireHooks(selectedRows: InventoryControlRow[]): Promise<void> {
        for (const row of selectedRows) {
            await this.context().registry.afterInventoryControlFire(row.entry);
        }
    }

    private consumedAmmoSummaryItem(request: AmmoConsumptionRequest): AmmoConsumptionSummaryItem {
        const currentRow = this.groups()
            .flatMap(group => group.rows)
            .find(row => row.id === request.row.id);
        const currentOption = currentRow?.ammo.options.find(option => option.id === request.option.id);
        return {
            label: currentOption?.label ?? request.option.label,
            count: request.count
        };
    }

    private consumptionSummaryHtml(ammoSummary: AmmoConsumptionSummaryItem[], heatProjection: SelectedHeatProjection | null): string {
        const ammoHtml = ammoSummary.length > 0
            ? `Ammo consumed:<ul>${ammoSummary.map(item => `<li>${item.count} ammo from ${this.escapeHtml(item.label)}</li>`).join('')}</ul>`
            : '<p>No ammo consumed.</p>';
        if (!heatProjection) return ammoHtml;
        return `${ammoHtml}<p>Heat Projection: +${heatProjection.selection}<br></p>`;
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[character] ?? character));
    }

    private hasUsableAmmoOption(row: InventoryControlRow): boolean {
        return row.ammo.options.some((option: InventoryControlAmmoOption) => this.isUsableAmmoOption(option));
    }

    private isUsableAmmoOption(option: InventoryControlAmmoOption): boolean {
        return !option.disabled && option.remaining > 0;
    }

    private heatDissipationState(): HeatDissipationState | null {
        return this.unit().rules.heatDissipation();
    }

    private heatPercent(value: number, scale: number): number {
        return Math.min(100, Math.max(0, (value / scale) * 100));
    }

    private heatValue(row: InventoryControlRow): number {
        return row.firingHeat ?? 0;
    }

    private groupSelectableRows(group: InventoryControlGroup): InventoryControlRow[] {
        return group.rows.filter(row => this.isSelectable(row));
    }

    private groupActiveSelectableRows(group: InventoryControlGroup): InventoryControlRow[] {
        return this.groupSelectableRows(group).filter(row => !row.destroyed && !row.disabled);
    }

    cacheDragPreviewCellWidths(event: PointerEvent): void {
        const sourceRow = event.currentTarget;
        if (!(sourceRow instanceof HTMLElement)) return;
        this.pendingDragPreviewSizing = this.measureDragPreviewSizing(sourceRow);
    }

    onDragStarted(event: CdkDragStart): void {
        const sourceRow = event.source.getRootElement();
        const sizing = this.pendingDragPreviewSizing?.sourceRow === sourceRow
            ? this.pendingDragPreviewSizing
            : this.measureDragPreviewSizing(sourceRow);
        this.pendingDragPreviewSizing = null;
        this.lockDragPreviewCellWidths(sourceRow, sizing);
    }

    private measureDragPreviewSizing(sourceRow: HTMLElement): DragPreviewSizing | null {
        const cells = this.measureDragPreviewCells(sourceRow);
        if (cells.length === 0) return null;
        const sourceRowStyle = getComputedStyle(sourceRow);
        return {
            sourceRow,
            rowWidth: sourceRow.getBoundingClientRect().width,
            gridTemplateColumns: this.dragPreviewGridTemplateColumns(sourceRow, sourceRowStyle),
            cells
        };
    }

    private dragPreviewGridTemplateColumns(sourceRow: HTMLElement, sourceRowStyle: CSSStyleDeclaration): string {
        const sourceColumns = sourceRowStyle.gridTemplateColumns;
        if (sourceColumns && sourceColumns !== 'none' && !sourceColumns.includes('subgrid')) return sourceColumns;

        const contentColumns = sourceRowStyle.getPropertyValue('--weapon-equipment-content-columns').trim();
        if (!contentColumns) return sourceColumns;

        return [
            this.measuredTrackWidth(sourceRow, '.grid-fill-left'),
            contentColumns,
            this.measuredTrackWidth(sourceRow, '.grid-fill-right')
        ].join(' ');
    }

    private measuredTrackWidth(sourceRow: HTMLElement, selector: string): string {
        const element = sourceRow.querySelector<HTMLElement>(selector);
        const width = element?.getBoundingClientRect().width ?? 0;
        return `${Math.max(0, width)}px`;
    }

    private measureDragPreviewCells(parent: HTMLElement, parentPath: number[] = []): DragPreviewCellSizing[] {
        return Array.from(parent.children).flatMap((child, index) => {
            if (!(child instanceof HTMLElement)) return [];
            const path = [...parentPath, index];
            if (getComputedStyle(child).display === 'contents') {
                return this.measureDragPreviewCells(child, path);
            }
            const width = child.getBoundingClientRect().width;
            return Number.isFinite(width) && width > 0 ? [{ path, width }] : [];
        });
    }

    private lockDragPreviewCellWidths(sourceRow: HTMLElement, sizing: DragPreviewSizing | null): void {
        if (!sizing) return;

        const applyWidth = () => {
            const previewRow = this.findDragPreviewRow(sourceRow);
            if (!previewRow) return false;
            if (Number.isFinite(sizing.rowWidth) && sizing.rowWidth > 0) {
                const fixedRowWidth = `${sizing.rowWidth}px`;
                previewRow.style.width = fixedRowWidth;
                previewRow.style.minWidth = fixedRowWidth;
                previewRow.style.maxWidth = fixedRowWidth;
            }
            if (sizing.gridTemplateColumns && sizing.gridTemplateColumns !== 'none') {
                previewRow.style.gridTemplateColumns = sizing.gridTemplateColumns;
            }
            let appliedAnyCell = false;
            for (const cell of sizing.cells) {
                const previewCell = this.elementAtPath(previewRow, cell.path);
                if (!previewCell) continue;
                const fixedWidth = `${cell.width}px`;
                previewCell.style.width = fixedWidth;
                previewCell.style.minWidth = fixedWidth;
                previewCell.style.maxWidth = fixedWidth;
                previewCell.style.flexBasis = fixedWidth;
                appliedAnyCell = true;
            }
            return appliedAnyCell;
        };

        if (!applyWidth()) {
            queueMicrotask(applyWidth);
            requestAnimationFrame(applyWidth);
        }
    }

    private elementAtPath(root: HTMLElement, path: number[]): HTMLElement | null {
        let current: Element = root;
        for (const index of path) {
            const child = current.children.item(index);
            if (!(child instanceof HTMLElement)) return null;
            current = child;
        }
        return current instanceof HTMLElement ? current : null;
    }

    private findDragPreviewRow(sourceRow: HTMLElement): HTMLElement | null {
        const container = sourceRow.parentElement;
        if (!container) return null;
        const previews = Array.from(container.querySelectorAll<HTMLElement>('.weapon-equipment-row.cdk-drag-preview'));
        return previews.find(preview => preview !== sourceRow) ?? null;
    }

    drop(event: CdkDragDrop<InventoryControlRow[]>, group: InventoryControlGroup): void {
        if (!group.sortable || this.readOnly() || event.previousIndex === event.currentIndex) return;
        const rows = [...group.rows];
        moveItemInArray(rows, event.previousIndex, event.currentIndex);
        setInventoryControlSortOrder(rows);
    }

    handlerChoices(row: InventoryControlRow): HandlerChoice[] {
        return this.getHandlerChoices(row)
            .filter(choice => !this.isModeChoice(choice));
    }

    isEscalatingFailureSequenceChoice(choice: HandlerChoice): boolean {
        return (choice._handler?.id === ESCALATING_FAILURE_HANDLER_ID 
                || choice._handler?.id === MASC_HANDLER_ID ) && typeof choice.value === 'number';
    }

    modeChoice(row: InventoryControlRow): HandlerChoice | undefined {
        return this.getHandlerChoices(row)
            .find(choice => this.isModeChoice(choice));
    }

    modeText(row: InventoryControlRow, choice: HandlerChoice): string {
        const option = choice.choices?.find(candidate => candidate.value === choice.value);
        if (option) return option.label;
        const mode = row.modes.find(candidate => candidate.mode === choice.value);
        return formatInventoryControlModeName(mode?.name ?? String(choice.value));
    }

    handlerDropdownOptions(choice: HandlerChoice): MultilineDropdownOption[] {
        return choice.choices?.map(option => ({
            value: String(option.value),
            label: option.label,
            disabled: option.disabled
        })) ?? [];
    }

    handlerDropdownValue(choice: HandlerChoice): string {
        return String(choice.value);
    }

    async selectHandlerDropdown(row: InventoryControlRow, choice: HandlerChoice, value: string): Promise<void> {
        const option = choice.choices?.find(candidate => String(candidate.value) === value);
        if (!option) return;
        await this.handleChoice(row, { ...choice, value: option.value, label: option.label, disabled: option.disabled });
    }

    async handleChoice(row: InventoryControlRow, choice: HandlerChoice): Promise<void> {
        if (this.readOnly() || choice.disabled) return;
        await this.context().registry.handleSelection(row.entry, choice, this.context().commandContext);
        this.inventoryControl().markInventoryViewChanged();
        const updatedRow = this.groups().flatMap(group => group.rows).find(candidate => candidate.id === row.id);
        if (updatedRow && (updatedRow.disabled || updatedRow.destroyed) && this.isSelected(updatedRow)) {
            this.unit().setInventoryControlEntrySelected(updatedRow.entry, false);
        }
    }

    private getHandlerChoices(row: InventoryControlRow): HandlerChoice[] {
        if (this.rowEffectivelyDestroyed(row)) return [];
        return this.context().registry.getChoices(row.entry, this.context().queryContext);
    }

    private isModeChoice(choice: HandlerChoice): boolean {
        return choice._handler?.id === INVENTORY_MODE_HANDLER_ID
            || (choice.label === INVENTORY_MODE_CHOICE_LABEL && choice.displayType === 'dropdown');
    }

    canMarkDestroyed(row: InventoryControlRow): boolean {
        return !this.readOnly()
            && this.unit().hasDirectInventory()
            && this.unit().canEditEquipmentState(row.entry, 'apply-damage');
    }

    markDestroyed(row: InventoryControlRow): void {
        if (!this.canMarkDestroyed(row)) return;
        if (!this.unit().applyEquipmentDamage(row.entry)) return;
        this.context().commandContext.toastService.showToast(`Critical Hit on ${row.display.name}`, 'error');
    }

    canRepair(row: InventoryControlRow): boolean {
        return !this.readOnly()
            && this.unit().hasDirectInventory()
            && this.rowEffectivelyDestroyed(row)
            && this.unit().canEditEquipmentState(row.entry, 'repair');
    }

    rowEffectivelyDestroyed(row: InventoryControlRow): boolean {
        const state = this.rowPresentationState(row);
        return state === 'destroying' || state === 'destroyed';
    }

    rowDestroying(row: InventoryControlRow): boolean {
        return this.rowPresentationState(row) === 'destroying';
    }

    rowRepairing(row: InventoryControlRow): boolean {
        return this.rowPresentationState(row) === 'repairing';
    }

    rowCommittedDestroyed(row: InventoryControlRow): boolean {
        return this.rowPresentationState(row) === 'destroyed';
    }

    rowPresentationState(row: InventoryControlRow): 'destroying' | 'repairing' | 'destroyed' | 'disabled' | null {
        if (this.unit().getEquipmentInstallationLocationStatus(row.entry) === 'destroyed') return 'destroyed';
        if (row.entry.isRepairing()) return 'repairing';
        if (row.entry.isDestroying()) return 'destroying';
        if (row.destroyed) return 'destroyed';
        const status = this.unit().getEquipmentStatus(row.entry);
        if (status === 'disabled') return 'disabled';
        return null;
    }

    repair(row: InventoryControlRow): void {
        if (!this.canRepair(row)) return;
        if (!this.unit().repairEquipment(row.entry)) return;
        this.context().commandContext.toastService.showToast(`Repaired ${row.display.name}`, 'success');
    }

}
