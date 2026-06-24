import { ChangeDetectionStrategy, Component, computed, type ComponentRef, DestroyRef, inject, Injector, input } from '@angular/core';
import { DragDropModule, type CdkDragDrop, type CdkDragStart, moveItemInArray } from '@angular/cdk/drag-drop';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import type { HandlerChoice } from '../../services/equipment-interaction-registry.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { INVENTORY_MODE_CHOICE_LABEL, INVENTORY_MODE_HANDLER_ID } from '../../equipment-handlers/inventory-mode.handler';
import { changeAmmoEntriesRemaining, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining } from '../../utils/ammo-interaction.util';
import type { HeatDissipationState } from '../../models/rules/heat-management';
import { LayoutService } from '../../services/layout.service';
import { MultilineDropdownComponent, type MultilineDropdownOption } from '../multiline-dropdown/multiline-dropdown.component';
import { WeaponTargetChoiceMenuComponent } from '../equipment-dialog/weapon-target-choice-menu.component';
import type { InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { formatInventoryTargetSignedModifier, inventoryTargetNumberBreakdown, InventoryTargetNumberInput, inventoryTargetNumberText, inventoryTargetRangeSelection, parseInventoryTargetNumberCell, type InventoryTargetRangeKey } from '../../utils/inventory-target-number.util';
import { resolveHitModifier } from '../../models/rules/hit-modifier.util';
import { resolveWeaponRangeDamageText } from '../../models/rules/weapon-range-rules.util';
import { getMotiveModeLabel } from '../../models/motiveModes.model';
import type { EquipmentDialogContext } from './equipment-dialog.model';
import {
    formatInventoryControlModeName,
    getBuiltInOneShotCapacity,
    getBuiltInOneShotConsumed,
    getInventoryControlGroups,
    isBuiltInOneShotAmmoOption,
    INVENTORY_CONTROL_VIRTUAL_TROOPER_ROW_STATE,
    isInventoryControlSelectableEntry,
    selectInventoryControlEntry,
    setInventoryControlSortOrder,
    type InventoryControlAmmoOption,
    type InventoryControlGroup,
    type InventoryControlRow,
    type InventoryRangeKey
} from '../../utils/inventory-control.util';

const RANGE_LABELS: Record<InventoryRangeKey, string> = {
    short: 'Sht',
    medium: 'Med',
    long: 'Lng'
};
const HEAT_BAR_SCALE = 30;
const WEAPON_TARGET_CHOICE_OVERLAY_KEY = 'weapon-equipment-target-choice';

type HeatDissipationWithWings = HeatDissipationState & { totalDissipationWithWings?: number };
type TargetRangeKey = InventoryTargetRangeKey;

interface HeatAwareRules {
    heatDissipation: () => HeatDissipationWithWings | null;
}

interface SelectedHeatProjection {
    current: number;
    base: number;
    selection: number;
    pending: number;
    dissipation: number;
    final: number;
    pendingWidth: number;
    dissipationWidth: number;
    retainedWidth: number;
}

interface TargetRangeSelection {
    range: TargetRangeKey;
    outOfLongRange: boolean;
    outOfExtremeRange: boolean;
}

interface TargetNumberBreakdown {
    total: number;
    lines: TooltipLine[];
}

interface AmmoRowState {
    hasAmmo: boolean;
    showDropdown: boolean;
    selectedOption: InventoryControlAmmoOption | undefined;
    selectedOptionId: string;
    text: string;
    depleted: boolean;
    destroyed: boolean;
    canDecrease: boolean;
    canIncrease: boolean;
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
    readonly unitInput = input.required<CBTForceUnit>({ alias: 'unit' });
    readonly contextInput = input.required<EquipmentDialogContext>({ alias: 'context' });
    readonly readOnlyInput = input<boolean | undefined>(undefined, { alias: 'readOnly' });
    private pendingDragPreviewSizing: DragPreviewSizing | null = null;
    private readonly manuallySelectedDepletedAmmo = new Map<string, string>();
    readonly rangeKeys: InventoryRangeKey[] = ['short', 'medium', 'long'];
    readonly unit = computed(() => this.unitInput());
    readonly context = computed(() => this.contextInput());
    readonly inventoryControl = computed(() => this.unit().inventoryControl);
    readonly groups = computed(() => {
        this.inventoryControl().inventoryViewVersion();
        return getInventoryControlGroups(this.unit(), this.context().dataService.getEquipments());
    });
    readonly targets = computed(() => {
        this.inventoryControl().targetsMap();
        return this.unit().getInventoryControlTargets();
    });
    readonly hasTargets = computed(() => this.targets().length > 0);
    readonly hasAmmoColumn = computed(() => this.groups().some(group => this.groupTracksAmmo(group)));
    readonly hasControlsColumn = computed(() => this.groups().some(group => this.groupHasControls(group)));
    readonly hasActionsColumn = computed(() => this.groups().some(group => this.groupHasActions(group)));
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
        const selection = this.selectedHeatTotal();
        const dissipation = this.heatDissipationValue(dissipationState);
        const pending = base + selection;
        const final = Math.max(0, pending - dissipation);
        return {
            current: base,
            base,
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

    targetForRow(row: InventoryControlRow): InventoryControlRuntimeTarget | null {
        const targetId = this.unit().getInventoryControlEntryTargetId(row.id);
        return targetId ? this.targets().find(target => target.id === targetId) ?? null : null;
    }

    targetSelectionLabel(row: InventoryControlRow): string {
        return this.targetForRow(row)?.letter ?? '';
    }

    targetSelectionColor(row: InventoryControlRow): string | null {
        return this.targetForRow(row)?.color ?? null;
    }

    targetRangeSelectionColor(row: InventoryControlRow): string | null {
        if (this.isOutOfLongRange(row)) return null;
        return this.targetSelectionColor(row);
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

    canSelectRange(row: InventoryControlRow, range: InventoryRangeKey): boolean {
        if (this.targetForRow(row)) return false;
        const value = this.rangeValue(row, range);
        return this.isSelectable(row) && value !== '—';
    }

    selectRange(row: InventoryControlRow, range: InventoryRangeKey): void {
        if (!this.canSelectRange(row, range)) return;
        this.unit().toggleInventoryControlEntryRange(row.entry, range);
    }

    isRangeSelected(row: InventoryControlRow, range: InventoryRangeKey): boolean {
        if (row.category === 'physical' && this.targetForRow(row)) return false;
        const targetRange = this.targetRangeSelection(row);
        if (targetRange) {
            return !targetRange.outOfLongRange && targetRange.range === range;
        }
        return this.unit().getInventoryControlEntryRange(row.id) === range;
    }

    isOutOfLongRange(row: InventoryControlRow): boolean {
        return this.targetRangeSelection(row)?.outOfLongRange ?? false;
    }

    isOutOfExtremeRange(row: InventoryControlRow): boolean {
        return this.targetRangeSelection(row)?.outOfExtremeRange ?? false;
    }

    targetNumberText(row: InventoryControlRow): string {
        return this.targetNumberTextForTarget(row, this.targetForRow(row));
    }

    hitText(row: InventoryControlRow): string {
        return this.hitTextForTarget(row, this.targetForRow(row));
    }

    private hitTextForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): string {
        if (!target) return row.display.hit;

        const range = this.targetRangeSelectionForTarget(row, target)?.range ?? null;
        const hitModifier = resolveHitModifier(row.entry, row.additionalHitModifier, range);
        if (hitModifier === null) return row.display.hit;
        if (hitModifier === 'Vs' || hitModifier === '*') return hitModifier;
        return formatInventoryTargetSignedModifier(hitModifier);
    }

    damageText(row: InventoryControlRow): string {
        const range = this.targetRangeSelection(row)?.range ?? this.unit().getInventoryControlEntryRange(row.id) ?? null;
        return resolveWeaponRangeDamageText(row.entry, range, row.display.damage) ?? row.display.damage;
    }

    targetNumberTooltip(row: InventoryControlRow): TooltipLine[] | null {
        if (this.targetRangeSelection(row)?.outOfLongRange) {
            return [{ value: 'OUT OF RANGE', isHeader: true }];
        }
        const lines = this.targetNumberBreakdown(row)?.lines ?? null;
        return lines;
    }

    rangeValue(row: InventoryControlRow, range: InventoryRangeKey): string {
        return row.display[range];
    }

    rangeLabel(range: InventoryRangeKey): string {
        return RANGE_LABELS[range];
    }

    private targetRangeSelection(row: InventoryControlRow): TargetRangeSelection | null {
        return this.targetRangeSelectionForTarget(row, this.targetForRow(row));
    }

    private targetRangeSelectionForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): TargetRangeSelection | null {
        return inventoryTargetRangeSelection({
            entry: row.entry,
            category: row.category,
            display: row.display,
            target
        });
    }

    private targetChoiceTargetNumberTexts(row: InventoryControlRow): Readonly<Record<InventoryControlRuntimeTargetId, string>> {
        return Object.fromEntries(this.targets()
            .map(target => [target.id, this.targetNumberTextForTarget(row, target)] as const)
            .filter(([, targetNumber]) => targetNumber !== ''));
    }

    private targetNumberTextForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): string {
        return inventoryTargetNumberText(this.targetNumberInput(row, target));
    }

    private targetNumberBreakdown(row: InventoryControlRow): TargetNumberBreakdown | null {
        return this.targetNumberBreakdownForTarget(row, this.targetForRow(row));
    }

    private targetNumberBreakdownForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): TargetNumberBreakdown | null {    
        const breakdown = inventoryTargetNumberBreakdown(this.targetNumberInput(row, target));
        return breakdown === null ? null : { total: breakdown.total, lines: breakdown.lines };
    }

    private targetNumberInput(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): InventoryTargetNumberInput {
        this.inventoryControl().inventoryViewVersion();
        const moveMode = this.unit().turnState().moveMode();
        const movementModifier = this.unit().turnState().getAttackMovementModifier();
        const missingMovementModifier = this.unit().turnState().missingAttackMovementModifier();
        const spotterModifier = this.unit().turnState().getSpottingModifier();
        const heatFireModifier = this.unit().svgService?.inventoryTargetHeatFireModifier(row.entry) ?? 0;
        const hitModifier = parseInventoryTargetNumberCell(this.hitTextForTarget(row, target)) ?? 0;
        return {
            entry: row.entry,
            category: row.category,
            display: row.display,
            target,
            gunnerySkill: this.unit().gunnerySkill(),
            pilotingSkill: this.unit().pilotingSkill(),
            movementLabel: moveMode ? getMotiveModeLabel(moveMode, this.unit().getUnit(), this.unit().turnState().airborne() ?? false) : 'None',
            movementModifier: movementModifier,
            missingMovementModifier,
            spottingModifier: spotterModifier,
            hitModifier: hitModifier - heatFireModifier,
            heatFireModifier
        };
    }

    ammoState(row: InventoryControlRow): AmmoRowState {
        const hasUsableAmmo = this.hasUsableAmmoOption(row);
        const hasAmmo = row.tracksAmmo && (hasUsableAmmo || this.hasBuiltInOneShotAmmoOption(row));
        const selectedOption = this.resolvedSelectedAmmoOption(row, hasUsableAmmo);
        const selectedOptionId = selectedOption?.id ?? '';
        const text = this.ammoStateText(row, hasAmmo, selectedOption);
        const depleted = row.tracksAmmo
            ? selectedOption?.remaining !== undefined ? selectedOption.remaining <= 0 : row.ammo.remaining <= 0
            : false;
        const destroyed = hasUsableAmmo ? !!selectedOption?.destroyed : false;
        return {
            hasAmmo,
            showDropdown: row.ammo.options.length > 1 && hasUsableAmmo,
            selectedOption,
            selectedOptionId,
            text,
            depleted,
            destroyed,
            canDecrease: this.canAdjustResolvedAmmo(row, selectedOption, 1, hasUsableAmmo),
            canIncrease: this.canAdjustResolvedAmmo(row, selectedOption, -1, hasUsableAmmo),
        };
    }

    private resolvedSelectedAmmoOption(row: InventoryControlRow, hasUsableAmmo = this.hasUsableAmmoOption(row)): InventoryControlAmmoOption | undefined {
        const selectedOptionId = this.unit().getInventoryControlEntryAmmoOption(row.id);
        const selectedOption = selectedOptionId
            ? row.ammo.options.find((option: InventoryControlAmmoOption) => option.id === selectedOptionId)
            : undefined;
        if (selectedOption && this.isManuallySelectedDepletedAmmo(row, selectedOption)) {
            return selectedOption;
        }
        if (selectedOption && (!hasUsableAmmo || this.isUsableAmmoOption(selectedOption))) {
            return selectedOption;
        }
        if (selectedOption) {
            return this.preferredUsableAmmoOption(row, selectedOption) ?? selectedOption;
        }
        return this.preferredAmmoOption(row);
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
        const option = row.ammo.options.find((ammoOption: InventoryControlAmmoOption) => ammoOption.id === value);
        if (option && !option.destroyed && option.remaining <= 0) {
            this.manuallySelectedDepletedAmmo.set(row.id, option.id);
        } else {
            this.manuallySelectedDepletedAmmo.delete(row.id);
        }
        this.unit().setInventoryControlEntryAmmoOption(row.id, value);
    }

    private canAdjustResolvedAmmo(row: InventoryControlRow, option: InventoryControlAmmoOption | undefined, delta: number, hasUsableAmmo: boolean): boolean {
        if (this.readOnly() || !row.tracksAmmo || delta === 0) return false;
        if (!option || option.destroyed) return false;
        if (isBuiltInOneShotAmmoOption(option.id)) {
            if (delta > 0) return option.remaining > 0;
            return option.remaining < option.total;
        }
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
        if (isBuiltInOneShotAmmoOption(option.id)) {
            if (this.adjustBuiltInOneShotAmmo(row, delta)) {
                this.inventoryControl().markInventoryViewChanged();
            }
            return;
        }
        if (changeAmmoEntriesRemaining(this.getAmmoEntriesForOption(row, option.id), -delta, this.context())) {
            this.inventoryControl().markInventoryViewChanged();
        }
    }

    async consumeSelectedHeatAndAmmo(): Promise<void> {
        if (this.readOnly()) return;
        const selectedRows = this.selectedRows();
        if (selectedRows.length === 0) return;

        const requests = new Map<string, { row: InventoryControlRow; option: InventoryControlAmmoOption; count: number }>();
        for (const row of selectedRows) {
            if (!row.tracksAmmo) continue;
            const option = this.selectedAmmo(row);
            if (!option || option.destroyed || option.remaining <= 0) {
                await this.context().dialogsService.showError(`${row.display.name} has no available ammo.`, 'No Ammo');
                return;
            }
            const requestKey = isBuiltInOneShotAmmoOption(option.id) ? `${row.id}:${option.id}` : option.id;
            const request = requests.get(requestKey);
            if (request) {
                request.count += 1;
            } else {
                requests.set(requestKey, { row, option, count: 1 });
            }
        }

        for (const request of requests.values()) {
            const remaining = isBuiltInOneShotAmmoOption(request.option.id)
                ? request.option.remaining
                : this.getAmmoEntriesForOption(request.row, request.option.id)
                    .reduce((total, entry) => total + getAmmoEntryRemaining(entry), 0);
            if (remaining < request.count) {
                await this.context().dialogsService.showError(`${request.option.label} does not have enough ammo for the selected weapons.`, 'Not Enough Ammo');
                return;
            }
        }

        const ammoSummary = Array.from(requests.values())
            .map(request => ({ label: request.option.label, count: request.count }));
        const heatProjection = this.selectedHeatProjection();

        for (const request of requests.values()) {
            this.consumeAmmoFromOption(request.row, request.option.id, request.count);
        }

        if (heatProjection) {
            this.unit().setHeat(heatProjection.pending);
        }
        this.inventoryControl().markInventoryViewChanged();
        await this.context().dialogsService.showNoticeHtml(
            this.consumptionSummaryHtml(ammoSummary, heatProjection),
            'Weapons Fired'
        );
    }

    private selectedAmmo(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        return this.ammoState(row).selectedOption;
    }

    private getAmmoEntriesForOption(row: InventoryControlRow, optionId: string) {
        return getAmmoControlEntriesForWeapon(row.entry, this.context())
            .filter(entry => `${entry.currentAmmo.internalName}:${entry.locationLabel}` === optionId);
    }

    private consumeAmmoFromOption(row: InventoryControlRow, optionId: string, count: number): void {
        if (isBuiltInOneShotAmmoOption(optionId)) {
            this.adjustBuiltInOneShotAmmo(row, count);
            return;
        }
        let remainingToConsume = count;
        const entries = this.getAmmoEntriesForOption(row, optionId)
            .filter(entry => getAmmoEntryRemaining(entry) > 0)
            .reverse();
        for (const entry of entries) {
            if (remainingToConsume <= 0) return;
            const consumedFromEntry = Math.min(getAmmoEntryRemaining(entry), remainingToConsume);
            entry.source.consumed = (entry.source.consumed ?? 0) + consumedFromEntry;
            if (entry.sourceType === 'inventory') {
                entry.owner.setInventoryEntry(entry.source as MountedEquipment);
            } else {
                entry.owner.setCritSlot(entry.source as CriticalSlot);
            }
            remainingToConsume -= consumedFromEntry;
        }
    }

    private consumptionSummaryHtml(ammoSummary: { label: string; count: number }[], heatProjection: SelectedHeatProjection | null): string {
        const ammoHtml = ammoSummary.length > 0
            ? `Ammo consumed:<ul>${ammoSummary.map(item => `<li>${item.count} ammo from ${this.escapeHtml(item.label)}</li>`).join('')}</ul>`
            : '<p>No ammo consumed.</p>';
        if (!heatProjection) return ammoHtml;
        return `${ammoHtml}<p>Heat raised: +${heatProjection.selection}<br></p>`;
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[character] ?? character));
    }

    private adjustBuiltInOneShotAmmo(row: InventoryControlRow, deltaConsumed: number): boolean {
        const capacity = getBuiltInOneShotCapacity(row.entry);
        if (capacity <= 0 || deltaConsumed === 0) return false;

        const consumed = getBuiltInOneShotConsumed(row.entry);
        const nextConsumed = Math.max(0, Math.min(capacity, consumed + deltaConsumed));
        if (nextConsumed === consumed) return false;

        if (row.entry.critSlots?.length) {
            const slot = row.entry.critSlots[0];
            slot.consumed = nextConsumed || undefined;
            row.entry.owner.setCritSlot(slot);
        } else {
            row.entry.consumed = nextConsumed || undefined;
            row.entry.owner.setInventoryEntry(row.entry);
        }
        return true;
    }

    private hasUsableAmmoOption(row: InventoryControlRow): boolean {
        return row.ammo.options.some((option: InventoryControlAmmoOption) => this.isUsableAmmoOption(option));
    }

    private hasBuiltInOneShotAmmoOption(row: InventoryControlRow): boolean {
        return row.ammo.options.some((option: InventoryControlAmmoOption) => isBuiltInOneShotAmmoOption(option.id));
    }

    private isUsableAmmoOption(option: InventoryControlAmmoOption): boolean {
        return !option.destroyed && option.remaining > 0;
    }

    private isManuallySelectedDepletedAmmo(row: InventoryControlRow, option: InventoryControlAmmoOption): boolean {
        if (this.manuallySelectedDepletedAmmo.get(row.id) !== option.id) return false;
        if (this.isUsableAmmoOption(option)) {
            this.manuallySelectedDepletedAmmo.delete(row.id);
            return false;
        }
        return !option.destroyed;
    }

    private sameAmmoType(left: InventoryControlAmmoOption, right: InventoryControlAmmoOption): boolean {
        return this.ammoTypeKey(left) === this.ammoTypeKey(right);
    }

    private ammoTypeKey(option: InventoryControlAmmoOption): string {
        const separator = option.id.indexOf(':');
        return separator === -1 ? option.id : option.id.slice(0, separator);
    }

    private heatDissipationState(): HeatDissipationWithWings | null {
        const rules = this.unit().rules as Partial<HeatAwareRules>;
        return typeof rules.heatDissipation === 'function' ? rules.heatDissipation() : null;
    }

    private heatDissipationValue(state: HeatDissipationWithWings): number {
        return Math.max(0, state.totalDissipationWithWings ?? state.totalDissipation);
    }

    private heatPercent(value: number, scale: number): number {
        return Math.min(100, Math.max(0, (value / scale) * 100));
    }

    private preferredAmmoOption(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        return this.preferredUsableAmmoOption(row)
            ?? row.ammo.options.find((option: InventoryControlAmmoOption) => !option.destroyed)
            ?? row.ammo.options[0];
    }

    private preferredUsableAmmoOption(row: InventoryControlRow, sameTypeAs?: InventoryControlAmmoOption): InventoryControlAmmoOption | undefined {
        return row.ammo.options
            .filter((option: InventoryControlAmmoOption) => this.isUsableAmmoOption(option)
                && (!sameTypeAs || this.sameAmmoType(option, sameTypeAs)))
            .reduce<InventoryControlAmmoOption | undefined>((best, option) => !best || option.remaining > best.remaining ? option : best, undefined);
    }

    private heatValue(row: InventoryControlRow): number {
        const heat = Number.parseFloat(row.display.heat);
        return Number.isFinite(heat) ? heat : 0;
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
        await this.context().registry.handleSelection(row.entry, choice, this.context());
        this.inventoryControl().markInventoryViewChanged();
    }

    private getHandlerChoices(row: InventoryControlRow): HandlerChoice[] {
        if (this.isVirtualTrooperRow(row)) return [];
        if (row.destroyed) return [];
        return this.context().registry.getChoices(row.entry, this.context());
    }

    private isModeChoice(choice: HandlerChoice): boolean {
        return choice._handler?.id === INVENTORY_MODE_HANDLER_ID
            || (choice.label === INVENTORY_MODE_CHOICE_LABEL && choice.displayType === 'dropdown');
    }

    canMarkDestroyed(row: InventoryControlRow): boolean {
        return !this.isVirtualTrooperRow(row) && !this.readOnly() && this.unit().hasDirectInventory() && !row.destroyed;
    }

    markDestroyed(row: InventoryControlRow): void {
        if (!this.canMarkDestroyed(row)) return;
        row.entry.destroyed = true;
        row.entry.owner.setInventoryEntry(row.entry);
        this.context().toastService.showToast(`Critical Hit on ${row.display.name}`, 'error');
    }

    canRepair(row: InventoryControlRow): boolean {
        return !this.isVirtualTrooperRow(row) && !this.readOnly() && this.unit().hasDirectInventory() && row.destroyed;
    }

    private isVirtualTrooperRow(row: InventoryControlRow): boolean {
        return row.entry.states.has(INVENTORY_CONTROL_VIRTUAL_TROOPER_ROW_STATE);
    }

    repair(row: InventoryControlRow): void {
        if (!this.canRepair(row)) return;
        row.entry.destroyed = false;
        row.entry.owner.setInventoryEntry(row.entry);
        this.context().toastService.showToast(`Repaired ${row.display.name}`, 'success');
    }

}
