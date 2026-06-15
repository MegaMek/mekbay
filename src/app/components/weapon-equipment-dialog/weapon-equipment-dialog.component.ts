import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DragDropModule, type CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { MountedEquipment } from '../../models/force-serialization';
import type { HandlerChoice, HandlerContext } from '../../services/equipment-interaction-registry.service';
import { AmmoControlDialogComponent, type AmmoControlDialogData } from '../ammo-control-dialog/ammo-control-dialog.component';
import { getAmmoControlEntriesForUnitWeapons } from '../../utils/ammo-interaction.util';
import { LayoutService } from '../../services/layout.service';
import {
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

interface WeaponEquipmentDialogRegistry {
    getChoices(entry: MountedEquipment, context: HandlerContext): HandlerChoice[];
    handleSelection(entry: MountedEquipment, choice: HandlerChoice, context: HandlerContext): boolean | Promise<boolean>;
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
    imports: [DragDropModule],
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
    readonly rangeKeys: InventoryRangeKey[] = ['short', 'medium', 'long'];

    constructor() {
        this.data.unit.syncInventoryControlSelectionSvg();
    }

    compactLayout(): boolean {
        return this.layoutService.windowWidth() <= 1200;
    }

    groups(): InventoryControlGroup[] {
        this.revision();
        return getInventoryControlGroups(this.data.unit, this.data.context.dataService.getEquipments());
    }

    hasAmmoColumn(): boolean {
        return this.groups().some(group => this.groupHasAmmo(group));
    }

    hasControlsColumn(): boolean {
        return this.groups().some(group => this.groupHasControls(group));
    }

    groupHasAmmo(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasAmmo(row));
    }

    groupHasControls(group: InventoryControlGroup): boolean {
        return group.rows.some(row => this.rowHasControls(row));
    }

    rowHasAmmo(row: InventoryControlRow): boolean {
        return row.ammo.tracksAmmo;
    }

    rowHasControls(row: InventoryControlRow): boolean {
        return this.handlerChoices(row).length > 0 || this.canMarkDestroyed(row) || this.canRepair(row);
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
        this.revision.update(value => value + 1);
    }

    resetSelections(): void {
        this.data.unit.clearInventoryControlSelection();
        this.revision.update(value => value + 1);
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
        ref.closed.subscribe(() => this.revision.update(value => value + 1));
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
            this.revision.update(value => value + 1);
            return;
        }

        this.data.unit.setInventoryControlSelectedRange(row.entry, range);
        this.revision.update(value => value + 1);
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
        if (!this.hasAvailableAmmoOption(row)) return 'No ammo';
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

    selectAmmoOption(row: InventoryControlRow, event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        this.data.unit.setInventoryControlSelectedAmmoOption(row.id, value);
        this.revision.update(current => current + 1);
    }

    private selectedAmmo(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        const selectedOptionId = this.selectedAmmoOption(row);
        return row.ammo.options.find((option: InventoryControlAmmoOption) => option.id === selectedOptionId)
            ?? this.preferredAmmoOption(row);
    }

    private hasAvailableAmmoOption(row: InventoryControlRow): boolean {
        return row.ammo.options.some((option: InventoryControlAmmoOption) => !option.destroyed);
    }

    private ammoDialogEntries() {
        return getAmmoControlEntriesForUnitWeapons(this.data.unit, this.data.context.dataService.getEquipments());
    }

    private preferredAmmoOption(row: InventoryControlRow): InventoryControlAmmoOption | undefined {
        return row.ammo.options.find((option: InventoryControlAmmoOption) => !option.destroyed && option.remaining > 0)
            ?? row.ammo.options.find((option: InventoryControlAmmoOption) => !option.destroyed)
            ?? row.ammo.options[0];
    }

    drop(event: CdkDragDrop<InventoryControlRow[]>, group: InventoryControlGroup): void {
        if (!group.sortable || this.readOnly() || event.previousIndex === event.currentIndex) return;
        const rows = [...group.rows];
        moveItemInArray(rows, event.previousIndex, event.currentIndex);
        setInventoryControlSortOrder(rows);
        this.revision.update(value => value + 1);
    }

    handlerChoices(row: InventoryControlRow): HandlerChoice[] {
        if (row.destroyed) return [];
        return this.data.context.registry.getChoices(row.entry, this.data.context);
    }

    async selectHandlerDropdown(row: InventoryControlRow, choice: HandlerChoice, event: Event): Promise<void> {
        const value = (event.target as HTMLSelectElement).value;
        const option = choice.choices?.find(candidate => String(candidate.value) === value);
        if (!option) return;
        await this.handleChoice(row, { ...choice, value: option.value, label: option.label, disabled: option.disabled });
    }

    async handleChoice(row: InventoryControlRow, choice: HandlerChoice): Promise<void> {
        if (this.readOnly() || choice.disabled) return;
        await this.data.context.registry.handleSelection(row.entry, choice, this.data.context);
        this.revision.update(value => value + 1);
    }

    canMarkDestroyed(row: InventoryControlRow): boolean {
        return !this.readOnly() && this.data.unit.hasDirectInventory() && !row.destroyed;
    }

    markDestroyed(row: InventoryControlRow): void {
        if (!this.canMarkDestroyed(row)) return;
        row.entry.destroyed = true;
        row.entry.owner.setInventoryEntry(row.entry);
        this.data.context.toastService.showToast(`Critical Hit on ${row.display.name}`, 'error');
        this.revision.update(value => value + 1);
    }

    canRepair(row: InventoryControlRow): boolean {
        return !this.readOnly() && this.data.unit.hasDirectInventory() && row.destroyed;
    }

    repair(row: InventoryControlRow): void {
        if (!this.canRepair(row)) return;
        row.entry.destroyed = false;
        row.entry.owner.setInventoryEntry(row.entry);
        this.data.context.toastService.showToast(`Repaired ${row.display.name}`, 'success');
        this.revision.update(value => value + 1);
    }

    close(): void {
        this.dialogRef.close();
    }
}
