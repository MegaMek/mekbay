import { computed, signal } from '@angular/core';
import type { MountedEquipment } from './force-serialization';
import type { TnTargetNumberCalculatorState, TnTargetUnitType } from './target-number-calculator.model';

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
    unitType?: TnTargetUnitType;
    distance: number;
    tnModifier: number;
    tnCalculator?: TnTargetNumberCalculatorState;
}

export interface InventoryControlRuntimeSnapshot {
    entryStates: Map<string, InventoryControlRuntimeEntryState>;
    targets: InventoryControlRuntimeTarget[];
}

export interface InventoryControlRuntimeEntryState {
    selected: boolean;
    range?: InventoryControlRuntimeRangeKey;
    ammoOption?: string;
    targetId?: InventoryControlRuntimeTargetId;
    pendingDestroyed?: boolean;
}

export function getInventoryControlTargetLetter(index: number): string {
    return String.fromCharCode('A'.charCodeAt(0) + index);
}

function getInventoryControlTargetIndex(targetId: InventoryControlRuntimeTargetId): number {
    if (targetId.length !== 1) return Number.MAX_SAFE_INTEGER;
    return targetId.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
}

export class InventoryControlRuntimeState {
    private readonly entryStatesState = signal<Map<string, InventoryControlRuntimeEntryState>>(new Map());
    private readonly targetsState = signal<Map<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget>>(new Map());
    private readonly inventoryViewVersionState = signal(0);

    readonly entryStates = computed<ReadonlyMap<string, Readonly<InventoryControlRuntimeEntryState>>>(() => this.cloneEntryStates(this.entryStatesState()));
    readonly targetsMap = this.targetsState.asReadonly();
    readonly inventoryViewVersion = this.inventoryViewVersionState.asReadonly();

    constructor(private readonly getInventory: () => MountedEquipment[]) {}

    getSnapshot(): InventoryControlRuntimeSnapshot {
        return {
            entryStates: this.cloneEntryStates(this.entryStatesState()),
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

    getEntryState(entryId: string): InventoryControlRuntimeEntryState | undefined {
        const entryState = this.entryStatesState().get(entryId);
        return entryState ? { ...entryState } : undefined;
    }

    getEntryTargetId(entryId: string): InventoryControlRuntimeTargetId | undefined {
        return this.entryStatesState().get(entryId)?.targetId;
    }

    isEntrySelected(entryId: string): boolean {
        return this.entryStatesState().get(entryId)?.selected ?? false;
    }

    getEntryRange(entryId: string): InventoryControlRuntimeRangeKey | undefined {
        return this.entryStatesState().get(entryId)?.range;
    }

    getEntryAmmoOption(entryId: string): string | undefined {
        return this.entryStatesState().get(entryId)?.ammoOption;
    }

    getEntryPendingDestroyed(entryId: string): boolean | undefined {
        return this.entryStatesState().get(entryId)?.pendingDestroyed;
    }

    setEntrySelected(entry: MountedEquipment, selected: boolean): void {
        this.updateEntryState(entry.id, entryState => {
            entryState.selected = selected;
            if (!selected) {
                delete entryState.range;
                delete entryState.targetId;
            }
        });
    }

    setEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        this.updateEntryState(entry.id, entryState => {
            entryState.selected = range !== null;
            if (range === null) {
                delete entryState.range;
            } else {
                entryState.range = range;
            }
            delete entryState.targetId;
        });
    }

    toggleEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey, forceSelected = false): void {
        const entryState = this.entryStatesState().get(entry.id);
        const selected = (entryState?.selected ?? false) && entryState?.range === range;
        this.setEntryRange(entry, !forceSelected && selected ? null : range);
    }

    setEntryAmmoOption(entryId: string, optionId: string): void {
        this.updateEntryState(entryId, entryState => {
            entryState.ammoOption = optionId;
        });
    }

    setEntryPendingDestroyed(entry: MountedEquipment, destroyed: boolean | undefined): void {
        this.updateEntryState(entry.id, entryState => {
            entryState.selected = false;
            delete entryState.range;
            delete entryState.targetId;
            if (destroyed === undefined || destroyed === !!entry.destroyed) {
                delete entryState.pendingDestroyed;
            } else {
                entryState.pendingDestroyed = destroyed;
            }
        });
    }

    setEntryTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        const validTargetId = targetId !== null && this.targetsMap().has(targetId) ? targetId : null;
        this.updateEntryState(entry.id, entryState => {
            entryState.selected = validTargetId !== null;
            if (validTargetId === null) {
                delete entryState.targetId;
            } else {
                entryState.targetId = validTargetId;
            }
            delete entryState.range;
        });
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
            unitType: 'mek-biped',
            distance: 1,
            tnModifier: 0
        };
        this.updateTargets(nextTargets => nextTargets.set(targetId, target));

        if (wasEmpty) {
            this.updateEntryStates(entryStates => {
                for (const entryState of entryStates.values()) {
                    if (entryState.selected && !entryState.targetId) {
                        entryState.targetId = targetId;
                    }
                    if (entryState.selected) {
                        delete entryState.range;
                    }
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
            ...(patch.unitType !== undefined && { unitType: patch.unitType }),
            ...(patch.distance !== undefined && { distance: Math.max(0, Number.isFinite(patch.distance) ? patch.distance : target.distance) }),
            ...(patch.tnModifier !== undefined && { tnModifier: Number.isFinite(patch.tnModifier) ? patch.tnModifier : target.tnModifier }),
            ...(patch.tnCalculator !== undefined && { tnCalculator: { ...patch.tnCalculator } })
        };
        this.updateTargets(targets => targets.set(targetId, updated));
        return { ...updated };
    }

    deleteTarget(targetId: InventoryControlRuntimeTargetId): void {
        const targets = new Map(this.targetsMap());
        if (!targets.delete(targetId)) return;
        this.targetsState.set(targets);
        this.updateEntryStates(entryStates => {
            for (const entryState of entryStates.values()) {
                if (entryState.targetId === targetId || targets.size === 0) {
                    entryState.selected = false;
                    delete entryState.range;
                    delete entryState.targetId;
                }
            }
        });
    }

    resetTargets(): void {
        this.targetsState.set(new Map());
        this.updateEntryStates(entryStates => {
            for (const entryState of entryStates.values()) {
                entryState.selected = false;
                delete entryState.range;
                delete entryState.targetId;
            }
        });
    }

    clearSelection(): void {
        this.updateEntryStates(entryStates => {
            for (const entryState of entryStates.values()) {
                entryState.selected = false;
                delete entryState.range;
                delete entryState.targetId;
            }
        });
    }

    pendingDestroyedEntries(): Map<string, boolean> {
        return new Map(Array.from(this.entryStatesState())
            .filter(([, entryState]) => entryState.pendingDestroyed !== undefined)
            .map(([entryId, entryState]) => [entryId, entryState.pendingDestroyed!]));
    }

    clearPendingDestroyed(): void {
        this.updateEntryStates(entryStates => {
            for (const entryState of entryStates.values()) {
                delete entryState.pendingDestroyed;
            }
        });
    }

    reconcile(): void {
        const validEntryIds = new Set(this.getInventory().map(entry => entry.id));
        const validTargetIds = new Set(this.targetsMap().keys());

        this.updateEntryStates(entryStates => {
            for (const [entryId, entryState] of entryStates) {
                if (!validEntryIds.has(entryId)) {
                    entryStates.delete(entryId);
                    continue;
                }
                if (entryState.targetId && !validTargetIds.has(entryState.targetId)) {
                    entryState.selected = false;
                    delete entryState.range;
                    delete entryState.targetId;
                }
            }
        });
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

    private updateEntryState(entryId: string, mutator: (entryState: InventoryControlRuntimeEntryState) => void): void {
        this.updateEntryStates(entryStates => {
            const entryState = entryStates.get(entryId) ?? { selected: false };
            mutator(entryState);
            entryStates.set(entryId, entryState);
        });
    }

    private updateEntryStates(mutator: (entryStates: Map<string, InventoryControlRuntimeEntryState>) => void): void {
        this.entryStatesState.update(current => {
            const next = this.cloneEntryStates(current);
            mutator(next);
            for (const [entryId, entryState] of next) {
                const normalizedEntryState = this.normalizeEntryState(entryState);
                if (normalizedEntryState) {
                    next.set(entryId, normalizedEntryState);
                } else {
                    next.delete(entryId);
                }
            }
            return next;
        });
    }

    private normalizeEntryState(entryState: InventoryControlRuntimeEntryState): InventoryControlRuntimeEntryState | null {
        if (!entryState.selected) {
            delete entryState.range;
            delete entryState.targetId;
        }
        if (entryState.targetId) {
            delete entryState.range;
        }
        if (!entryState.selected && entryState.ammoOption === undefined && entryState.pendingDestroyed === undefined) return null;
        return { ...entryState };
    }

    private cloneEntryStates(entryStates: Map<string, InventoryControlRuntimeEntryState>): Map<string, InventoryControlRuntimeEntryState> {
        return new Map(Array.from(entryStates, ([entryId, entryState]) => [entryId, { ...entryState }]));
    }

    private updateTargets(mutator: (targets: Map<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget>) => void): void {
        this.targetsState.update(current => {
            const next = new Map(current);
            mutator(next);
            return next;
        });
    }
}