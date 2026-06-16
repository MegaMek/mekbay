import type { MountedEquipment } from './force-serialization';

export type InventoryControlRuntimeRangeKey = 'min' | 'short' | 'medium' | 'long';

export const INVENTORY_CONTROL_TARGET_MAX_COUNT = 12;
export const INVENTORY_CONTROL_TARGET_COLORS = [
    '#d1495b',
    '#00798c',
    '#edae49',
    '#66a182',
    '#8d6a9f',
    '#f26419',
    '#2e86ab',
    '#a23b72',
    '#6a994e',
    '#c44536',
    '#4d908e',
    '#b08968'
] as const;

export type InventoryControlRuntimeTargetId = string;

export interface InventoryControlRuntimeTarget {
    id: InventoryControlRuntimeTargetId;
    letter: string;
    name: string;
    color: string;
    distance: number;
    tnModifier: number;
}

export interface InventoryControlRuntimeSelectionSnapshot {
    selectedEntryIds: Set<string>;
    selectedRanges: Map<string, InventoryControlRuntimeRangeKey>;
    selectedAmmoOptions: Map<string, string>;
    selectedTargets: Map<string, InventoryControlRuntimeTargetId>;
    targets: InventoryControlRuntimeTarget[];
}

export function getInventoryControlTargetLetter(index: number): string {
    return String.fromCharCode('A'.charCodeAt(0) + index);
}

function getInventoryControlTargetIndex(targetId: InventoryControlRuntimeTargetId): number {
    if (targetId.length !== 1) return Number.MAX_SAFE_INTEGER;
    return targetId.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
}

export class InventoryControlRuntimeState {
    private readonly selectedEntryIds = new Set<string>();
    private readonly selectedRanges = new Map<string, InventoryControlRuntimeRangeKey>();
    private readonly selectedAmmoOptions = new Map<string, string>();
    private readonly selectedTargets = new Map<string, InventoryControlRuntimeTargetId>();
    private readonly targets = new Map<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget>();

    constructor(private readonly getInventory: () => MountedEquipment[]) {}

    getSelectionSnapshot(): InventoryControlRuntimeSelectionSnapshot {
        return {
            selectedEntryIds: new Set(this.selectedEntryIds),
            selectedRanges: new Map(this.selectedRanges),
            selectedAmmoOptions: new Map(this.selectedAmmoOptions),
            selectedTargets: new Map(this.selectedTargets),
            targets: this.getTargets()
        };
    }

    getTargets(): InventoryControlRuntimeTarget[] {
        return Array.from(this.targets.values())
            .sort((a, b) => getInventoryControlTargetIndex(a.id) - getInventoryControlTargetIndex(b.id))
            .map(target => ({ ...target }));
    }

    getTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        const target = this.targets.get(targetId);
        return target ? { ...target } : undefined;
    }

    getSelectedTarget(entryId: string): InventoryControlRuntimeTargetId | undefined {
        return this.selectedTargets.get(entryId);
    }

    isEntrySelected(entryId: string): boolean {
        return this.selectedEntryIds.has(entryId);
    }

    getSelectedRange(entryId: string): InventoryControlRuntimeRangeKey | undefined {
        return this.selectedRanges.get(entryId);
    }

    getSelectedAmmoOption(entryId: string): string | undefined {
        return this.selectedAmmoOptions.get(entryId);
    }

    setEntrySelected(entry: MountedEquipment, selected: boolean): void {
        if (selected) {
            this.selectedEntryIds.add(entry.id);
        } else {
            this.selectedEntryIds.delete(entry.id);
            this.selectedRanges.delete(entry.id);
            this.selectedTargets.delete(entry.id);
        }
        this.syncEntrySelectionSvg(entry);
    }

    setSelectedRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        if (range === null) {
            this.selectedEntryIds.delete(entry.id);
            this.selectedRanges.delete(entry.id);
            this.selectedTargets.delete(entry.id);
        } else {
            this.selectedEntryIds.add(entry.id);
            this.selectedRanges.set(entry.id, range);
            this.selectedTargets.delete(entry.id);
        }
        this.syncEntrySelectionSvg(entry);
    }

    setSelectedAmmoOption(entryId: string, optionId: string): void {
        this.selectedAmmoOptions.set(entryId, optionId);
    }

    setSelectedTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        if (targetId === null || !this.targets.has(targetId)) {
            this.selectedEntryIds.delete(entry.id);
            this.selectedTargets.delete(entry.id);
            this.selectedRanges.delete(entry.id);
        } else {
            this.selectedEntryIds.add(entry.id);
            this.selectedTargets.set(entry.id, targetId);
            this.selectedRanges.delete(entry.id);
        }
        this.syncEntrySelectionSvg(entry);
    }

    createTarget(): InventoryControlRuntimeTarget | null {
        if (this.targets.size >= INVENTORY_CONTROL_TARGET_MAX_COUNT) return null;
        const targetId = this.nextTargetId();
        if (!targetId) return null;

        const wasEmpty = this.targets.size === 0;
        const targetIndex = getInventoryControlTargetIndex(targetId);
        const target: InventoryControlRuntimeTarget = {
            id: targetId,
            letter: targetId,
            name: `Target ${targetId}`,
            color: INVENTORY_CONTROL_TARGET_COLORS[targetIndex % INVENTORY_CONTROL_TARGET_COLORS.length],
            distance: 0,
            tnModifier: 0
        };
        this.targets.set(targetId, target);

        if (wasEmpty) {
            for (const entryId of this.selectedEntryIds) {
                if (!this.selectedTargets.has(entryId)) {
                    this.selectedTargets.set(entryId, targetId);
                    this.selectedRanges.delete(entryId);
                }
            }
            this.syncSelectionSvg();
        }

        return { ...target };
    }

    updateTarget(targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): InventoryControlRuntimeTarget | null {
        const target = this.targets.get(targetId);
        if (!target) return null;
        const updated: InventoryControlRuntimeTarget = {
            ...target,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.color !== undefined && { color: patch.color }),
            ...(patch.distance !== undefined && { distance: Math.max(0, Number.isFinite(patch.distance) ? patch.distance : target.distance) }),
            ...(patch.tnModifier !== undefined && { tnModifier: Number.isFinite(patch.tnModifier) ? patch.tnModifier : target.tnModifier })
        };
        this.targets.set(targetId, updated);
        return { ...updated };
    }

    deleteTarget(targetId: InventoryControlRuntimeTargetId): void {
        if (!this.targets.delete(targetId)) return;
        for (const [entryId, selectedTargetId] of this.selectedTargets) {
            if (selectedTargetId === targetId) {
                this.selectedTargets.delete(entryId);
                this.selectedEntryIds.delete(entryId);
                this.selectedRanges.delete(entryId);
            }
        }
        if (this.targets.size === 0) {
            this.selectedTargets.clear();
            this.selectedEntryIds.clear();
            this.selectedRanges.clear();
        }
        this.syncSelectionSvg();
    }

    resetTargets(): void {
        this.targets.clear();
        this.selectedTargets.clear();
        this.selectedEntryIds.clear();
        this.selectedRanges.clear();
        this.syncSelectionSvg();
    }

    clearSelection(): void {
        this.selectedEntryIds.clear();
        this.selectedRanges.clear();
        this.selectedAmmoOptions.clear();
        this.selectedTargets.clear();
        this.syncSelectionSvg();
    }

    reconcile(): void {
        const validEntryIds = new Set(this.getInventory().map(entry => entry.id));
        const validTargetIds = new Set(this.targets.keys());

        for (const entryId of Array.from(this.selectedEntryIds)) {
            if (!validEntryIds.has(entryId)) {
                this.selectedEntryIds.delete(entryId);
            }
        }
        for (const entryId of Array.from(this.selectedRanges.keys())) {
            if (!validEntryIds.has(entryId)) {
                this.selectedRanges.delete(entryId);
            }
        }
        for (const entryId of Array.from(this.selectedAmmoOptions.keys())) {
            if (!validEntryIds.has(entryId)) {
                this.selectedAmmoOptions.delete(entryId);
            }
        }
        for (const [entryId, targetId] of Array.from(this.selectedTargets.entries())) {
            if (!validEntryIds.has(entryId) || !validTargetIds.has(targetId)) {
                this.selectedTargets.delete(entryId);
                this.selectedEntryIds.delete(entryId);
                this.selectedRanges.delete(entryId);
            }
        }
    }

    syncSelectionSvg(): void {
        for (const entry of this.getInventory()) {
            this.syncEntrySelectionSvg(entry);
        }
    }

    private syncEntrySelectionSvg(entry: MountedEquipment): void {
        const el = entry.el;
        if (!el) return;
        const selected = this.selectedEntryIds.has(entry.id);
        const hasSelectedMode = !!el.querySelector(':scope > .alternativeMode.selected');
        el.classList.toggle('selected', selected || hasSelectedMode);
    }

    private nextTargetId(): InventoryControlRuntimeTargetId | null {
        for (let index = 0; index < INVENTORY_CONTROL_TARGET_MAX_COUNT; index++) {
            const targetId = getInventoryControlTargetLetter(index);
            if (!this.targets.has(targetId)) return targetId;
        }
        return null;
    }
}