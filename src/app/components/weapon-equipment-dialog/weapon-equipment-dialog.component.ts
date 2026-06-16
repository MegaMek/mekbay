import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DragDropModule, type CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CriticalSlot, MountedEquipment } from '../../models/force-serialization';
import type { HandlerChoice, HandlerContext } from '../../services/equipment-interaction-registry.service';
import { AmmoControlDialogComponent, type AmmoControlDialogData } from '../ammo-control-dialog/ammo-control-dialog.component';
import { INVENTORY_MODE_CHOICE_LABEL, INVENTORY_MODE_HANDLER_ID } from '../../equipment-handlers/inventory-mode.handler';
import { getAmmoControlEntriesForUnitWeapons, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining } from '../../utils/ammo-interaction.util';
import type { HeatDissipationState } from '../../models/rules/heat-management';
import { LayoutService } from '../../services/layout.service';
import { MultilineDropdownComponent, type MultilineDropdownOption } from '../multiline-dropdown/multiline-dropdown.component';
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

interface WeaponEquipmentDialogRegistry {
    getChoices(entry: MountedEquipment, context: HandlerContext): HandlerChoice[];
    handleSelection(entry: MountedEquipment, choice: HandlerChoice, context: HandlerContext): boolean | Promise<boolean>;
}

type HeatDissipationWithWings = HeatDissipationState & { totalDissipationWithWings?: number };

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
    imports: [DragDropModule, MultilineDropdownComponent],
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
    private readonly dialogRef: DialogRef<void, WeaponEquipmentDialogComponent> = inject(DialogRef);
    private readonly revision = signal(0);
    private readonly handlerChoiceCache = new Map<MountedEquipment, HandlerChoice[]>();
    private handlerChoiceCacheRevision = -1;
    readonly rangeKeys: InventoryRangeKey[] = ['short', 'medium', 'long'];
    readonly groups = computed(() => {
        this.revision();
        return getInventoryControlGroups(this.data.unit, this.data.context.dataService.getEquipments());
    });
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
        return this.data.unit.getInventoryControlSelectedRange(row.id) === range;
    }

    rangeValue(row: InventoryControlRow, range: InventoryRangeKey): string {
        return row.display[range];
    }

    rangeLabel(range: InventoryRangeKey): string {
        return RANGE_LABELS[range];
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
        if (selectedOptionId && row.ammo.options.some((option: InventoryControlAmmoOption) => option.id === selectedOptionId)) {
            return selectedOptionId;
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
        return row.ammo.options.some((option: InventoryControlAmmoOption) => !option.destroyed);
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
        return row.ammo.options.find((option: InventoryControlAmmoOption) => !option.destroyed && option.remaining > 0)
            ?? row.ammo.options.find((option: InventoryControlAmmoOption) => !option.destroyed)
            ?? row.ammo.options[0];
    }

    private heatValue(row: InventoryControlRow): number {
        const heat = Number.parseFloat(row.display.heat);
        return Number.isFinite(heat) ? heat : 0;
    }

    private groupSelectableRows(group: InventoryControlGroup): InventoryControlRow[] {
        return group.rows.filter(row => this.isSelectable(row));
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
