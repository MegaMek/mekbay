import { signal } from '@angular/core';
import type { MountedEquipment } from './force-serialization';

export type InventoryControlRuntimeRangeKey = 'short' | 'medium' | 'long' | 'extreme';

export const INVENTORY_CONTROL_TARGET_MAX_COUNT = 12;
export const INVENTORY_CONTROL_TARGET_COLORS = [
    '#c0f7ff',
    '#ffebca',
    '#c6ffe1',
    '#ecc6ff',
    '#ddffc0',
    '#ffc6c6',
    '#6fb3bd',
    '#eacc80',
    '#8ed2ad',
    '#ab77c6',
    '#a9d087',
    '#d5a790',
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
    private readonly selectedEntryIdsState = signal<Set<string>>(new Set());
    private readonly selectedRangesState = signal<Map<string, InventoryControlRuntimeRangeKey>>(new Map());
    private readonly selectedAmmoOptionsState = signal<Map<string, string>>(new Map());
    private readonly selectedTargetsState = signal<Map<string, InventoryControlRuntimeTargetId>>(new Map());
    private readonly targetsState = signal<Map<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget>>(new Map());
    private readonly inventoryViewVersionState = signal(0);

    readonly selectedEntryIds = this.selectedEntryIdsState.asReadonly();
    readonly selectedRanges = this.selectedRangesState.asReadonly();
    readonly selectedAmmoOptions = this.selectedAmmoOptionsState.asReadonly();
    readonly selectedTargets = this.selectedTargetsState.asReadonly();
    readonly targetsMap = this.targetsState.asReadonly();
    readonly inventoryViewVersion = this.inventoryViewVersionState.asReadonly();

    constructor(private readonly getInventory: () => MountedEquipment[]) {}

    getSelectionSnapshot(): InventoryControlRuntimeSelectionSnapshot {
        return {
            selectedEntryIds: new Set(this.selectedEntryIds()),
            selectedRanges: new Map(this.selectedRanges()),
            selectedAmmoOptions: new Map(this.selectedAmmoOptions()),
            selectedTargets: new Map(this.selectedTargets()),
            targets: this.getTargets()
        };
    }

    getTargets(): InventoryControlRuntimeTarget[] {
        return Array.from(this.targetsMap().values())
            .sort((a, b) => getInventoryControlTargetIndex(a.id) - getInventoryControlTargetIndex(b.id))
            .map(target => ({ ...target }));
    }

    getTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        const target = this.targetsMap().get(targetId);
        return target ? { ...target } : undefined;
    }

    getSelectedTarget(entryId: string): InventoryControlRuntimeTargetId | undefined {
        return this.selectedTargets().get(entryId);
    }

    isEntrySelected(entryId: string): boolean {
        return this.selectedEntryIds().has(entryId);
    }

    getSelectedRange(entryId: string): InventoryControlRuntimeRangeKey | undefined {
        return this.selectedRanges().get(entryId);
    }

    getSelectedAmmoOption(entryId: string): string | undefined {
        return this.selectedAmmoOptions().get(entryId);
    }

    setEntrySelected(entry: MountedEquipment, selected: boolean): void {
        if (selected) {
            this.updateSelectedEntryIds(selectedEntryIds => selectedEntryIds.add(entry.id));
        } else {
            this.updateSelectedEntryIds(selectedEntryIds => selectedEntryIds.delete(entry.id));
            this.updateSelectedRanges(selectedRanges => selectedRanges.delete(entry.id));
            this.updateSelectedTargets(selectedTargets => selectedTargets.delete(entry.id));
        }
    }

    setSelectedRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        if (range === null) {
            this.updateSelectedEntryIds(selectedEntryIds => selectedEntryIds.delete(entry.id));
            this.updateSelectedRanges(selectedRanges => selectedRanges.delete(entry.id));
            this.updateSelectedTargets(selectedTargets => selectedTargets.delete(entry.id));
        } else {
            this.updateSelectedEntryIds(selectedEntryIds => selectedEntryIds.add(entry.id));
            this.updateSelectedRanges(selectedRanges => selectedRanges.set(entry.id, range));
            this.updateSelectedTargets(selectedTargets => selectedTargets.delete(entry.id));
        }
    }

    toggleSelectedRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey, forceSelected = false): void {
        const selected = this.selectedEntryIds().has(entry.id) && this.selectedRanges().get(entry.id) === range;
        this.setSelectedRange(entry, !forceSelected && selected ? null : range);
    }

    setSelectedAmmoOption(entryId: string, optionId: string): void {
        this.updateSelectedAmmoOptions(selectedAmmoOptions => selectedAmmoOptions.set(entryId, optionId));
    }

    setSelectedTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        if (targetId === null || !this.targetsMap().has(targetId)) {
            this.updateSelectedEntryIds(selectedEntryIds => selectedEntryIds.delete(entry.id));
            this.updateSelectedTargets(selectedTargets => selectedTargets.delete(entry.id));
            this.updateSelectedRanges(selectedRanges => selectedRanges.delete(entry.id));
        } else {
            this.updateSelectedEntryIds(selectedEntryIds => selectedEntryIds.add(entry.id));
            this.updateSelectedTargets(selectedTargets => selectedTargets.set(entry.id, targetId));
            this.updateSelectedRanges(selectedRanges => selectedRanges.delete(entry.id));
        }
    }

    createTarget(): InventoryControlRuntimeTarget | null {
        const targets = this.targetsMap();
        if (targets.size >= INVENTORY_CONTROL_TARGET_MAX_COUNT) return null;
        const targetId = this.nextTargetId();
        if (!targetId) return null;

        const wasEmpty = targets.size === 0;
        const targetIndex = getInventoryControlTargetIndex(targetId);
        const target: InventoryControlRuntimeTarget = {
            id: targetId,
            letter: targetId,
            name: `Target ${targetId}`,
            color: INVENTORY_CONTROL_TARGET_COLORS[targetIndex % INVENTORY_CONTROL_TARGET_COLORS.length],
            distance: 0,
            tnModifier: 0
        };
        this.updateTargets(nextTargets => nextTargets.set(targetId, target));

        if (wasEmpty) {
            const selectedEntryIds = this.selectedEntryIds();
            this.updateSelectedTargets(selectedTargets => {
                for (const entryId of selectedEntryIds) {
                    if (!selectedTargets.has(entryId)) {
                        selectedTargets.set(entryId, targetId);
                    }
                }
            });
            this.updateSelectedRanges(selectedRanges => {
                for (const entryId of selectedEntryIds) {
                    selectedRanges.delete(entryId);
                }
            });
        }

        return { ...target };
    }

    updateTarget(targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): InventoryControlRuntimeTarget | null {
        const target = this.targetsMap().get(targetId);
        if (!target) return null;
        const updated: InventoryControlRuntimeTarget = {
            ...target,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.color !== undefined && { color: patch.color }),
            ...(patch.distance !== undefined && { distance: Math.max(0, Number.isFinite(patch.distance) ? patch.distance : target.distance) }),
            ...(patch.tnModifier !== undefined && { tnModifier: Number.isFinite(patch.tnModifier) ? patch.tnModifier : target.tnModifier })
        };
        this.updateTargets(targets => targets.set(targetId, updated));
        return { ...updated };
    }

    deleteTarget(targetId: InventoryControlRuntimeTargetId): void {
        const targets = new Map(this.targetsMap());
        if (!targets.delete(targetId)) return;
        this.targetsState.set(targets);
        const deselectedEntryIds = new Set<string>();
        this.updateSelectedTargets(selectedTargets => {
            for (const [entryId, selectedTargetId] of selectedTargets) {
                if (selectedTargetId === targetId) {
                    selectedTargets.delete(entryId);
                    deselectedEntryIds.add(entryId);
                }
            }
        });
        this.updateSelectedEntryIds(selectedEntryIds => {
            for (const entryId of deselectedEntryIds) {
                selectedEntryIds.delete(entryId);
            }
        });
        this.updateSelectedRanges(selectedRanges => {
            for (const entryId of deselectedEntryIds) {
                selectedRanges.delete(entryId);
            }
        });
        if (targets.size === 0) {
            this.selectedTargetsState.set(new Map());
            this.selectedEntryIdsState.set(new Set());
            this.selectedRangesState.set(new Map());
        }
    }

    resetTargets(): void {
        this.targetsState.set(new Map());
        this.selectedTargetsState.set(new Map());
        this.selectedEntryIdsState.set(new Set());
        this.selectedRangesState.set(new Map());
    }

    clearSelection(): void {
        this.selectedEntryIdsState.set(new Set());
        this.selectedRangesState.set(new Map());
        this.selectedAmmoOptionsState.set(new Map());
        this.selectedTargetsState.set(new Map());
    }

    reconcile(): void {
        const validEntryIds = new Set(this.getInventory().map(entry => entry.id));
        const validTargetIds = new Set(this.targetsMap().keys());

        const selectedEntryIds = new Set(this.selectedEntryIds());
        const selectedRanges = new Map(this.selectedRanges());
        const selectedAmmoOptions = new Map(this.selectedAmmoOptions());
        const selectedTargets = new Map(this.selectedTargets());

        for (const entryId of Array.from(selectedEntryIds)) {
            if (!validEntryIds.has(entryId)) {
                selectedEntryIds.delete(entryId);
            }
        }
        for (const entryId of Array.from(selectedRanges.keys())) {
            if (!validEntryIds.has(entryId)) {
                selectedRanges.delete(entryId);
            }
        }
        for (const entryId of Array.from(selectedAmmoOptions.keys())) {
            if (!validEntryIds.has(entryId)) {
                selectedAmmoOptions.delete(entryId);
            }
        }
        for (const [entryId, targetId] of Array.from(selectedTargets.entries())) {
            if (!validEntryIds.has(entryId) || !validTargetIds.has(targetId)) {
                selectedTargets.delete(entryId);
                selectedEntryIds.delete(entryId);
                selectedRanges.delete(entryId);
            }
        }

        this.selectedEntryIdsState.set(selectedEntryIds);
        this.selectedRangesState.set(selectedRanges);
        this.selectedAmmoOptionsState.set(selectedAmmoOptions);
        this.selectedTargetsState.set(selectedTargets);
    }

    markInventoryViewChanged(): void {
        this.inventoryViewVersionState.update(value => value + 1);
    }

    syncSelectionSvg(): void {
        this.inventoryViewVersion();
    }

    private nextTargetId(): InventoryControlRuntimeTargetId | null {
        for (let index = 0; index < INVENTORY_CONTROL_TARGET_MAX_COUNT; index++) {
            const targetId = getInventoryControlTargetLetter(index);
            if (!this.targetsMap().has(targetId)) return targetId;
        }
        return null;
    }

    private updateSelectedEntryIds(mutator: (selectedEntryIds: Set<string>) => void): void {
        this.selectedEntryIdsState.update(current => {
            const next = new Set(current);
            mutator(next);
            return next;
        });
    }

    private updateSelectedRanges(mutator: (selectedRanges: Map<string, InventoryControlRuntimeRangeKey>) => void): void {
        this.selectedRangesState.update(current => {
            const next = new Map(current);
            mutator(next);
            return next;
        });
    }

    private updateSelectedAmmoOptions(mutator: (selectedAmmoOptions: Map<string, string>) => void): void {
        this.selectedAmmoOptionsState.update(current => {
            const next = new Map(current);
            mutator(next);
            return next;
        });
    }

    private updateSelectedTargets(mutator: (selectedTargets: Map<string, InventoryControlRuntimeTargetId>) => void): void {
        this.selectedTargetsState.update(current => {
            const next = new Map(current);
            mutator(next);
            return next;
        });
    }

    private updateTargets(mutator: (targets: Map<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget>) => void): void {
        this.targetsState.update(current => {
            const next = new Map(current);
            mutator(next);
            return next;
        });
    }
}