import { ChangeDetectionStrategy, Component, computed, type ComponentRef, DestroyRef, inject, Injector, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DragDropModule, type CdkDragDrop, type CdkDragStart, moveItemInArray } from '@angular/cdk/drag-drop';
import { Overlay, OverlayModule } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { WeaponEquipment } from '../../models/equipment.model';
import type { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import type { HandlerChoice, HandlerContext } from '../../services/equipment-interaction-registry.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { AmmoControlDialogComponent, type AmmoControlDialogData } from '../ammo-control-dialog/ammo-control-dialog.component';
import { INVENTORY_MODE_CHOICE_LABEL, INVENTORY_MODE_HANDLER_ID } from '../../equipment-handlers/inventory-mode.handler';
import { getAmmoControlEntriesForUnitWeapons, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining } from '../../utils/ammo-interaction.util';
import type { HeatDissipationState } from '../../models/rules/heat-management';
import { LayoutService } from '../../services/layout.service';
import { MultilineDropdownComponent, type MultilineDropdownOption } from '../multiline-dropdown/multiline-dropdown.component';
import { WeaponTargetChoiceMenuComponent } from './weapon-target-choice-menu.component';
import { WeaponTargetsMenuComponent, type WeaponTargetUpdateRequest } from './weapon-targets-menu.component';
import type { InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { getMotiveModeLabel, getMotiveModeTargetNumberModifier } from '../../models/motiveModes.model';
import {
    formatInventoryControlModeName,
    getInventoryControlGroups,
    setInventoryControlSortOrder,
    type InventoryControlAmmoOption,
    type InventoryControlGroup,
    type InventoryControlRow,
    type InventoryRangeKey
} from '../../utils/inventory-control.util';

const RANGE_LABELS: Record<InventoryRangeKey, string> = {
    min: 'Min',
    short: 'Sht',
    medium: 'Med',
    long: 'Lng'
};
const HEAT_BAR_SCALE = 30;
const WEAPON_TARGETS_OVERLAY_KEY = 'weapon-equipment-targets';
const WEAPON_TARGET_CHOICE_OVERLAY_KEY = 'weapon-equipment-target-choice';

interface WeaponEquipmentDialogRegistry {
    getChoices(entry: MountedEquipment, context: HandlerContext): HandlerChoice[];
    handleSelection(entry: MountedEquipment, choice: HandlerChoice, context: HandlerContext): boolean | Promise<boolean>;
}

type HeatDissipationWithWings = HeatDissipationState & { totalDissipationWithWings?: number };
type TargetRangeKey = Exclude<InventoryRangeKey, 'min'> | 'extreme';

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

export interface WeaponEquipmentDialogContext extends HandlerContext {
    registry: WeaponEquipmentDialogRegistry;
}

export interface WeaponEquipmentDialogData {
    title: string;
    unit: CBTForceUnit;
    context: WeaponEquipmentDialogContext;
    readOnly?: boolean;
}

@Component({
    selector: 'weapon-equipment-dialog',
    standalone: true,
    imports: [DragDropModule, OverlayModule, MultilineDropdownComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './weapon-equipment-dialog.component.html',
    styleUrl: './weapon-equipment-dialog.component.scss'
})
export class WeaponEquipmentDialogComponent {
    readonly data: WeaponEquipmentDialogData = inject(DIALOG_DATA);
    readonly layoutService = inject(LayoutService);
    private readonly overlay = inject(Overlay);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialogRef: DialogRef<void, WeaponEquipmentDialogComponent> = inject(DialogRef);
    private readonly revision = signal(0);
    private readonly handlerChoiceCache = new Map<MountedEquipment, HandlerChoice[]>();
    private handlerChoiceCacheRevision = -1;
    private targetsCompRef: ComponentRef<WeaponTargetsMenuComponent> | null = null;
    private targetChoiceCompRef: ComponentRef<WeaponTargetChoiceMenuComponent> | null = null;
    private pendingDragPreviewSizing: DragPreviewSizing | null = null;
    readonly rangeKeys: InventoryRangeKey[] = ['short', 'medium', 'long'];
    readonly groups = computed(() => {
        this.revision();
        return getInventoryControlGroups(this.data.unit, this.data.context.dataService.getEquipments());
    });
    readonly targets = computed(() => {
        this.revision();
        return this.data.unit.getInventoryControlTargets();
    });
    readonly hasTargets = computed(() => this.targets().length > 0);
    readonly hasAmmoColumn = computed(() => this.groups().some(group => this.groupHasAmmo(group)));
    readonly hasControlsColumn = computed(() => this.groups().some(group => this.groupHasControls(group)));
    readonly hasActionsColumn = computed(() => this.groups().some(group => this.groupHasActions(group)));
    readonly selectedRows = computed(() => this.groups()
        .flatMap(group => group.rows)
        .filter(row => this.data.unit.isInventoryControlEntrySelected(row.id)));
    readonly selectedHeatTotal = computed(() => this.selectedRows()
        .reduce((total, row) => total + this.heatValue(row), 0));
    readonly selectedHeatProjection = computed<SelectedHeatProjection | null>(() => {
        this.revision();
        const dissipationState = this.heatDissipationState();
        if (!dissipationState) return null;
        const heat = this.data.unit.getHeat();
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
        this.data.unit.syncInventoryControlSelectionSvg();
        this.destroyRef.onDestroy(() => {
            this.overlayManager.closeManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY);
            this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        });
    }

    openTargets(event: MouseEvent): void {
        event.stopPropagation();

        if (this.overlayManager.has(WEAPON_TARGETS_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY);
            this.targetsCompRef = null;
            return;
        }

        const target = event.currentTarget as HTMLElement;
        const portal = new ComponentPortal(WeaponTargetsMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY, target, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-targets-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });
        this.targetsCompRef = componentRef;
        this.syncTargetsOverlayInputs();

        outputToObservable(componentRef.instance.addRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.data.unit.createInventoryControlTarget();
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.resetRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.data.unit.resetInventoryControlTargets();
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.updateRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((request: WeaponTargetUpdateRequest) => {
            this.data.unit.updateInventoryControlTarget(request.targetId, request.patch);
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.deleteRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            this.data.unit.deleteInventoryControlTarget(targetId);
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.colorPickerOpened).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.blockCloseUntil(WEAPON_TARGETS_OVERLAY_KEY);
        });
        outputToObservable(componentRef.instance.colorPickerClosed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.unblockClose(WEAPON_TARGETS_OVERLAY_KEY);
        });
        closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.targetsCompRef = null;
        });
    }

    private syncTargetsOverlayInputs(): void {
        if (!this.targetsCompRef) return;
        this.targetsCompRef.setInput('targets', this.targets());
        this.targetsCompRef.setInput('readOnly', this.readOnly());
        this.targetsCompRef.changeDetectorRef.detectChanges();
    }

    targetForRow(row: InventoryControlRow): InventoryControlRuntimeTarget | null {
        const targetId = this.data.unit.getInventoryControlSelectedTarget(row.id);
        return targetId ? this.targets().find(target => target.id === targetId) ?? null : null;
    }

    targetSelectionLabel(row: InventoryControlRow): string {
        return this.targetForRow(row)?.letter ?? '';
    }

    targetSelectionColor(row: InventoryControlRow): string | null {
        return this.targetForRow(row)?.color ?? null;
    }

    onRowTargetSelectorClick(event: MouseEvent, row: InventoryControlRow): void {
        event.stopPropagation();
        if (!this.isSelectable(row)) return;
        const targets = this.targets();
        if (targets.length === 0) return;
        if (targets.length === 1) {
            const targetId = targets[0].id;
            const selectedTargetId = this.data.unit.getInventoryControlSelectedTarget(row.id);
            this.data.unit.setInventoryControlSelectedTarget(row.entry, selectedTargetId === targetId ? null : targetId);
            this.refresh();
            return;
        }

        this.openTargetChoiceOverlay(
            event.currentTarget as HTMLElement,
            this.data.unit.getInventoryControlSelectedTarget(row.id) ?? null,
            targetId => {
                this.data.unit.setInventoryControlSelectedTarget(row.entry, targetId);
                this.refresh();
            },
            this.targetChoiceTargetNumberTexts(row)
        );
    }

    groupTargetSelection(group: InventoryControlGroup): InventoryControlRuntimeTarget | null {
        const rows = this.groupSelectableRows(group);
        if (rows.length === 0) return null;
        const firstTargetId = this.data.unit.getInventoryControlSelectedTarget(rows[0].id);
        if (!firstTargetId || !rows.every(row => this.data.unit.getInventoryControlSelectedTarget(row.id) === firstTargetId)) {
            return null;
        }
        return this.targets().find(target => target.id === firstTargetId) ?? null;
    }

    groupSomeTargetRowsSelected(group: InventoryControlGroup): boolean {
        const rows = this.groupSelectableRows(group);
        const selectedCount = rows.filter(row => !!this.data.unit.getInventoryControlSelectedTarget(row.id)).length;
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
        for (const row of this.groupSelectableRows(group)) {
            this.data.unit.setInventoryControlSelectedTarget(row.entry, targetId);
        }
        this.refresh();
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
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
                { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 }
            ]
        });
        this.targetChoiceCompRef = componentRef;
        componentRef.setInput('targets', this.targets());
        componentRef.setInput('selectedTargetId', selectedTargetId);
        componentRef.setInput('targetNumberTexts', targetNumberTexts);
        componentRef.changeDetectorRef.detectChanges();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            onSelect(targetId);
            this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
            this.targetChoiceCompRef = null;
        });
        closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.targetChoiceCompRef = null;
        });
    }

    compactLayout(): boolean {
        return this.layoutService.windowWidth() <= 760;
    }

    groupHasAmmo(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasAmmo(row));
    }

    groupHasControls(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasControls(row));
    }

    groupHasActions(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasActions(row));
    }

    groupActionsHeader(group: InventoryControlGroup): string {
        const hasAmmo = this.groupHasAmmo(group);
        const hasControls = this.groupHasControls(group);
        if (hasAmmo && hasControls) return 'Ammo & Controls';
        if (hasAmmo) return 'Ammo';
        if (hasControls) return 'Controls';
        return '';
    }

    rowHasAmmo(row: InventoryControlRow): boolean {
        return row.ammo.tracksAmmo;
    }

    rowHasControls(row: InventoryControlRow): boolean {
        return this.handlerChoices(row).length > 0 || this.canMarkDestroyed(row) || this.canRepair(row);
    }

    rowHasActions(row: InventoryControlRow): boolean {
        return this.rowHasAmmo(row) || this.rowHasControls(row);
    }

    readOnly(): boolean {
        return this.data.readOnly ?? this.data.unit.readOnly();
    }

    isSelectable(row: InventoryControlRow): boolean {
        return row.category === 'ranged' || row.category === 'physical';
    }

    isSelected(row: InventoryControlRow): boolean {
        this.revision();
        return this.data.unit.isInventoryControlEntrySelected(row.id);
    }

    toggleSelected(row: InventoryControlRow): void {
        this.data.unit.setInventoryControlEntrySelected(row.entry, !this.isSelected(row));
        this.refresh();
    }

    groupAllSelectableRowsSelected(group: InventoryControlGroup): boolean {
        const rows = this.groupSelectableRows(group);
        return rows.length > 0 && rows.every(row => this.isSelected(row));
    }

    groupSomeSelectableRowsSelected(group: InventoryControlGroup): boolean {
        const rows = this.groupSelectableRows(group);
        return rows.some(row => this.isSelected(row)) && !rows.every(row => this.isSelected(row));
    }

    toggleGroupSelectableRows(group: InventoryControlGroup): void {
        if (group.id !== 'ranged') return;
        const rows = this.groupSelectableRows(group);
        const selected = !this.groupAllSelectableRowsSelected(group);
        rows.forEach(row => this.data.unit.setInventoryControlEntrySelected(row.entry, selected));
        this.refresh();
    }

    resetSelections(): void {
        this.data.unit.clearInventoryControlSelection();
        this.refresh();
    }

    hasSelectedRows(): boolean {
        return this.selectedRows().length > 0;
    }

    consumeButtonLabel(): string {
        return this.selectedHeatProjection() ? 'CONSUME HEAT & AMMO' : 'CONSUME AMMO';
    }

    canOpenAmmoDialog(): boolean {
        this.revision();
        return this.ammoDialogEntries().length > 0;
    }

    openAmmoDialog(): void {
        const entries = this.ammoDialogEntries();
        if (entries.length === 0) return;
        const ref = this.data.context.dialogsService.createDialog<void>(AmmoControlDialogComponent, {
            data: {
                title: 'Ammo',
                entries,
                readOnly: this.readOnly(),
                getEntries: () => this.ammoDialogEntries(),
                context: this.data.context
            } as AmmoControlDialogData,
        });
        ref.closed.subscribe(() => this.refresh());
    }

    canSelectRange(row: InventoryControlRow, range: InventoryRangeKey): boolean {
        if (range === 'min') return false;
        if (this.targetForRow(row)) return false;
        const value = this.rangeValue(row, range);
        return this.isSelectable(row) && value !== '—';
    }

    selectRange(row: InventoryControlRow, range: InventoryRangeKey): void {
        if (!this.canSelectRange(row, range)) return;
        const wasSelectedRange = this.data.unit.getInventoryControlSelectedRange(row.id) === range;
        if (wasSelectedRange) {
            this.data.unit.setInventoryControlSelectedRange(row.entry, null);
            this.refresh();
            return;
        }

        this.data.unit.setInventoryControlSelectedRange(row.entry, range);
        this.refresh();
    }

    isRangeSelected(row: InventoryControlRow, range: InventoryRangeKey): boolean {
        this.revision();
        if (row.category === 'physical' && this.targetForRow(row)) return false;
        const targetRange = this.targetRangeSelection(row);
        if (targetRange) {
            return !targetRange.outOfLongRange && targetRange.range === range;
        }
        return this.data.unit.getInventoryControlSelectedRange(row.id) === range;
    }

    isOutOfLongRange(row: InventoryControlRow): boolean {
        this.revision();
        return this.targetRangeSelection(row)?.outOfLongRange ?? false;
    }

    isOutOfExtremeRange(row: InventoryControlRow): boolean {
        this.revision();
        return this.targetRangeSelection(row)?.outOfExtremeRange ?? false;
    }

    targetNumberText(row: InventoryControlRow): string {
        this.revision();
        return this.targetNumberTextForTarget(row, this.targetForRow(row));
    }

    targetNumberTooltip(row: InventoryControlRow): TooltipLine[] | null {
        this.revision();
        if (this.targetRangeSelection(row)?.outOfExtremeRange) return [{ value: 'OUT OF RANGE', isHeader: true }];
        return this.targetNumberBreakdown(row)?.lines ?? null;
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
        if (!target) return null;
        if (row.category === 'physical') return { range: 'short', outOfLongRange: false, outOfExtremeRange: false };

        const thresholds = this.rangeKeys
            .map(range => ({ range, value: this.parseNumericCell(row.display[range]) }))
            .filter((item): item is { range: Exclude<InventoryRangeKey, 'min'>; value: number } => item.value !== null);
        if (thresholds.length === 0) return null;

        for (const threshold of thresholds) {
            if (target.distance <= threshold.value) {
                return { range: threshold.range, outOfLongRange: false, outOfExtremeRange: false };
            }
        }

        const extremeRange = this.extremeRange(row);
        return {
            range: 'extreme',
            outOfLongRange: true,
            outOfExtremeRange: extremeRange !== null && target.distance > extremeRange
        };
    }

    private targetChoiceTargetNumberTexts(row: InventoryControlRow): Readonly<Record<InventoryControlRuntimeTargetId, string>> {
        return Object.fromEntries(this.targets()
            .map(target => [target.id, this.targetNumberTextForTarget(row, target)] as const)
            .filter(([, targetNumber]) => targetNumber !== ''));
    }

    private targetNumberTextForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): string {
        if (this.targetRangeSelectionForTarget(row, target)?.outOfExtremeRange) return 'X';
        const targetNumber = this.targetNumberBreakdownForTarget(row, target);
        return targetNumber === null ? '' : targetNumber.total.toString();
    }

    private extremeRange(row: InventoryControlRow): number | null {
        const equipment = row.entry.equipment;
        if (!(equipment instanceof WeaponEquipment)) return null;
        const extremeRange = equipment.ranges[3];
        return Number.isFinite(extremeRange) && extremeRange > 0 ? extremeRange : null;
    }

    private targetNumberBreakdown(row: InventoryControlRow): TargetNumberBreakdown | null {
        return this.targetNumberBreakdownForTarget(row, this.targetForRow(row));
    }

    private targetNumberBreakdownForTarget(row: InventoryControlRow, target: InventoryControlRuntimeTarget | null): TargetNumberBreakdown | null {    
        if (!target) return null;
        const rangeSelection = this.targetRangeSelectionForTarget(row, target);
        if (!rangeSelection) return null;

        const skillLabel = row.category === 'physical' ? 'Piloting' : 'Gunnery';
        const skill = row.category === 'physical'
            ? this.data.unit.pilotingSkill()
            : this.data.unit.gunnerySkill();
        const moveMode = this.data.unit.turnState().moveMode();
        const movementModifier = getMotiveModeTargetNumberModifier(moveMode);
        const rangeModifier = this.rangeModifier(rangeSelection.range);
        const minimumRangeModifier = this.minimumRangeModifier(row, target.distance);
        const hitModifier = this.hitModifier(row.display.hit);
        const terms: TooltipLine[] = [
            { label: skillLabel, value: skill.toString() },
            { label: `Movement (${this.motiveModeLabel(moveMode)})`, value: this.formatSignedModifier(movementModifier) },
            { label: `Target (${target.letter})`, value: this.formatSignedModifier(target.tnModifier) },
        ];

        if (row.category !== 'physical') {
            terms.push({ label: `Range (${this.rangeDisplayName(rangeSelection.range)})`, value: this.formatSignedModifier(rangeModifier) });
        }

        if (minimumRangeModifier !== 0) {
            terms.push({ label: 'Minimum Range', value: this.formatSignedModifier(minimumRangeModifier) });
        }
        if (hitModifier !== 0) {
            terms.push({ label: 'Hit Modifier', value: this.formatSignedModifier(hitModifier) });
        }

        const total = skill + movementModifier + target.tnModifier + rangeModifier + minimumRangeModifier + hitModifier;
        terms.push({ isBreak: true });
        terms.push({ label: 'Total', value: total.toString(), isHeader: true });

        return { total, lines: terms };
    }

    private motiveModeLabel(moveMode: ReturnType<ReturnType<CBTForceUnit['turnState']>['moveMode']>): string {
        if (!moveMode) return 'None';
        return getMotiveModeLabel(moveMode, this.data.unit.getUnit(), this.data.unit.turnState().airborne() ?? false);
    }

    private rangeDisplayName(range: TargetRangeKey): string {
        switch (range) {
            case 'short': return 'Short';
            case 'medium': return 'Medium';
            case 'long': return 'Long';
            case 'extreme': return 'Extreme';
        }
    }

    private formatSignedModifier(value: number): string {
        return value >= 0 ? `+${value}` : value.toString();
    }

    private rangeModifier(range: TargetRangeKey): number {
        switch (range) {
            case 'medium': return 2;
            case 'long': return 4;
            case 'extreme': return 6;
            default: return 0;
        }
    }

    private minimumRangeModifier(row: InventoryControlRow, distance: number): number {
        const min = this.parseNumericCell(row.display.min);
        if (min === null || min <= 0 || distance > min) return 0;
        return (min - distance) + 1;
    }

    private hitModifier(value: string): number {
        return this.parseNumericCell(value) ?? 0;
    }

    private parseNumericCell(value: string): number | null {
        const text = value.trim();
        if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : null;
    }

    ammoText(row: InventoryControlRow): string {
        if (!row.ammo.tracksAmmo) return '';
        if (!this.hasAvailableAmmoOption(row)) return 'NO AMMO';
        const selectedOption = this.selectedAmmo(row);
        if (selectedOption) return selectedOption.label;
        if (row.ammo.options.length === 1) return row.ammo.options[0].label;
        return `${row.ammo.remaining}/${row.ammo.total}`;
    }

    showAmmoDropdown(row: InventoryControlRow): boolean {
        return row.ammo.options.length > 1 && this.hasAvailableAmmoOption(row);
    }

    ammoDepleted(row: InventoryControlRow): boolean {
        if (!row.ammo.tracksAmmo) return false;
        const selectedOption = this.selectedAmmo(row);
        return selectedOption ? selectedOption.remaining <= 0 : row.ammo.remaining <= 0;
    }

    ammoDestroyed(row: InventoryControlRow): boolean {
        if (!this.hasAvailableAmmoOption(row)) return false;
        const selectedOption = this.selectedAmmo(row);
        return !!selectedOption?.destroyed;
    }

    selectedAmmoOption(row: InventoryControlRow): string {
        this.revision();
        const selectedOptionId = this.data.unit.getInventoryControlSelectedAmmoOption(row.id);
        const selectedOption = selectedOptionId
            ? row.ammo.options.find((option: InventoryControlAmmoOption) => option.id === selectedOptionId)
            : undefined;
        if (selectedOption && (!this.hasAvailableAmmoOption(row) || this.isUsableAmmoOption(selectedOption))) {
            return selectedOption.id;
        }
        if (selectedOption) {
            return this.preferredUsableAmmoOption(row, selectedOption)?.id ?? selectedOption.id;
        }
        return this.preferredAmmoOption(row)?.id ?? '';
    }

    ammoDropdownOptions(row: InventoryControlRow): MultilineDropdownOption[] {
        return row.ammo.options.map(option => ({
            value: option.id,
            label: option.label,
            disabled: option.disabled
        }));
    }

    selectAmmoOption(row: InventoryControlRow, value: string): void {
        this.data.unit.setInventoryControlSelectedAmmoOption(row.id, value);
        this.refresh();
    }

    async consumeSelectedHeatAndAmmo(): Promise<void> {
        if (this.readOnly()) return;
        const selectedRows = this.selectedRows();
        if (selectedRows.length === 0) return;

        const requests = new Map<string, { row: InventoryControlRow; option: InventoryControlAmmoOption; count: number }>();
        for (const row of selectedRows) {
            if (!row.ammo.tracksAmmo) continue;
            const option = this.selectedAmmo(row);
            if (!option || option.destroyed || option.remaining <= 0) {
                await this.data.context.dialogsService.showError(`${row.display.name} has no available ammo.`, 'No Ammo');
                return;
            }
            const request = requests.get(option.id);
            if (request) {
                request.count += 1;
            } else {
                requests.set(option.id, { row, option, count: 1 });
            }
        }

        for (const request of requests.values()) {
            const remaining = this.getAmmoEntriesForOption(request.row, request.option.id)
                .reduce((total, entry) => total + getAmmoEntryRemaining(entry), 0);
            if (remaining < request.count) {
                await this.data.context.dialogsService.showError(`${request.option.label} does not have enough ammo for the selected weapons.`, 'Not Enough Ammo');
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
            this.data.unit.setHeat(heatProjection.pending);
        }
        this.refresh();
        await this.data.context.dialogsService.showNoticeHtml(
            this.consumptionSummaryHtml(ammoSummary, heatProjection),
            'Weapons Fired'
        );
    }

    private selectedAmmo(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        const selectedOptionId = this.selectedAmmoOption(row);
        return row.ammo.options.find((option: InventoryControlAmmoOption) => option.id === selectedOptionId)
            ?? this.preferredAmmoOption(row);
    }

    private getAmmoEntriesForOption(row: InventoryControlRow, optionId: string) {
        return getAmmoControlEntriesForWeapon(row.entry, this.data.context)
            .filter(entry => `${entry.currentAmmo.internalName}:${entry.locationLabel}` === optionId);
    }

    private consumeAmmoFromOption(row: InventoryControlRow, optionId: string, count: number): void {
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
            ? `<ul>${ammoSummary.map(item => `<li>${this.escapeHtml(item.label)}: ${item.count}</li>`).join('')}</ul>`
            : '<p>No ammo consumed.</p>';
        if (!heatProjection) return ammoHtml;
        return `${ammoHtml}<p>Heat raised: +${heatProjection.selection}<br>Current heat: ${heatProjection.current}<br>Pending heat: ${heatProjection.pending}<br>Projected dissipation: -${heatProjection.dissipation}<br>Projected heat: ${heatProjection.final}</p>`;
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[character] ?? character));
    }

    private hasAvailableAmmoOption(row: InventoryControlRow): boolean {
        return row.ammo.options.some((option: InventoryControlAmmoOption) => this.isUsableAmmoOption(option));
    }

    private isUsableAmmoOption(option: InventoryControlAmmoOption): boolean {
        return !option.destroyed && option.remaining > 0;
    }

    private sameAmmoType(left: InventoryControlAmmoOption, right: InventoryControlAmmoOption): boolean {
        return this.ammoTypeKey(left) === this.ammoTypeKey(right);
    }

    private ammoTypeKey(option: InventoryControlAmmoOption): string {
        const separator = option.id.indexOf(':');
        return separator === -1 ? option.id : option.id.slice(0, separator);
    }

    private heatDissipationState(): HeatDissipationWithWings | null {
        const rules = this.data.unit.rules as Partial<HeatAwareRules>;
        return typeof rules.heatDissipation === 'function' ? rules.heatDissipation() : null;
    }

    private heatDissipationValue(state: HeatDissipationWithWings): number {
        return Math.max(0, state.totalDissipationWithWings ?? state.totalDissipation);
    }

    private heatPercent(value: number, scale: number): number {
        return Math.min(100, Math.max(0, (value / scale) * 100));
    }

    private ammoDialogEntries() {
        return getAmmoControlEntriesForUnitWeapons(this.data.unit, this.data.context.dataService.getEquipments());
    }

    private preferredAmmoOption(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        return this.preferredUsableAmmoOption(row)
            ?? row.ammo.options.find((option: InventoryControlAmmoOption) => !option.destroyed)
            ?? row.ammo.options[0];
    }

    private preferredUsableAmmoOption(row: InventoryControlRow, sameTypeAs?: InventoryControlAmmoOption): InventoryControlAmmoOption | undefined {
        return row.ammo.options.find((option: InventoryControlAmmoOption) => this.isUsableAmmoOption(option)
            && (!sameTypeAs || this.sameAmmoType(option, sameTypeAs)));
    }

    private heatValue(row: InventoryControlRow): number {
        const heat = Number.parseFloat(row.display.heat);
        return Number.isFinite(heat) ? heat : 0;
    }

    private groupSelectableRows(group: InventoryControlGroup): InventoryControlRow[] {
        return group.rows.filter(row => this.isSelectable(row));
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
            gridTemplateColumns: sourceRowStyle.gridTemplateColumns,
            cells
        };
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
        this.refresh();
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
        await this.data.context.registry.handleSelection(row.entry, choice, this.data.context);
        this.refresh();
    }

    private getHandlerChoices(row: InventoryControlRow): HandlerChoice[] {
        if (row.destroyed) return [];
        const revision = this.revision();
        if (this.handlerChoiceCacheRevision !== revision) {
            this.handlerChoiceCache.clear();
            this.handlerChoiceCacheRevision = revision;
        }

        const cachedChoices = this.handlerChoiceCache.get(row.entry);
        if (cachedChoices) return cachedChoices;

        const choices = this.data.context.registry.getChoices(row.entry, this.data.context);
        this.handlerChoiceCache.set(row.entry, choices);
        return choices;
    }

    private isModeChoice(choice: HandlerChoice): boolean {
        return choice._handler?.id === INVENTORY_MODE_HANDLER_ID
            || (choice.label === INVENTORY_MODE_CHOICE_LABEL && choice.displayType === 'dropdown');
    }

    canMarkDestroyed(row: InventoryControlRow): boolean {
        return !this.readOnly() && this.data.unit.hasDirectInventory() && !row.destroyed;
    }

    markDestroyed(row: InventoryControlRow): void {
        if (!this.canMarkDestroyed(row)) return;
        row.entry.destroyed = true;
        row.entry.owner.setInventoryEntry(row.entry);
        this.data.context.toastService.showToast(`Critical Hit on ${row.display.name}`, 'error');
        this.refresh();
    }

    canRepair(row: InventoryControlRow): boolean {
        return !this.readOnly() && this.data.unit.hasDirectInventory() && row.destroyed;
    }

    repair(row: InventoryControlRow): void {
        if (!this.canRepair(row)) return;
        row.entry.destroyed = false;
        row.entry.owner.setInventoryEntry(row.entry);
        this.data.context.toastService.showToast(`Repaired ${row.display.name}`, 'success');
        this.refresh();
    }

    private refresh(): void {
        this.revision.update(value => value + 1);
    }

    close(): void {
        this.dialogRef.close();
    }
}
