import type { MountedEquipment } from './force-serialization';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { InventoryControlRuntimeState, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from './inventory-control-runtime-state.model';

export class CBTInventoryControlRuntime extends InventoryControlRuntimeState {
    constructor(unit: CBTForceUnit) {
        super(() => unit.getInventory());
    }

    override setEntrySelected(entry: MountedEquipment, selected: boolean): void {
        super.setEntrySelected(entry, selected);
        this.markInventoryViewChanged();
    }

    override setEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        super.setEntryRange(entry, range);
        this.markInventoryViewChanged();
    }

    override setEntryAmmoOption(entryId: string, optionId: string): void {
        super.setEntryAmmoOption(entryId, optionId);
        this.markInventoryViewChanged();
    }

    override setEntryPendingDestroyed(entry: MountedEquipment, destroyed: boolean | undefined): void {
        super.setEntryPendingDestroyed(entry, destroyed);
        this.markInventoryViewChanged();
    }

    override setEntryTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        super.setEntryTarget(entry, targetId);
        this.markInventoryViewChanged();
    }

    override createTarget(): InventoryControlRuntimeTarget | null {
        const target = super.createTarget();
        this.markInventoryViewChanged();
        return target;
    }

    override updateTarget(targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): InventoryControlRuntimeTarget | null {
        const target = super.updateTarget(targetId, patch);
        this.markInventoryViewChanged();
        return target;
    }

    override deleteTarget(targetId: InventoryControlRuntimeTargetId): void {
        super.deleteTarget(targetId);
        this.markInventoryViewChanged();
    }

    override resetTargets(): void {
        super.resetTargets();
        this.markInventoryViewChanged();
    }

    override clearSelection(): void {
        super.clearSelection();
        this.markInventoryViewChanged();
    }

    override clearPendingDestroyed(): void {
        super.clearPendingDestroyed();
        this.markInventoryViewChanged();
    }
}
