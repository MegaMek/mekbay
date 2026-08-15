// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal } from '@angular/core';
import type { MountedEquipment } from './mounted-equipment.model';
import { resolveTnTargetWaterState, type TnTargetNumberCalculatorState, type TnTargetUnitType } from './target-number-calculator.model';

export type InventoryControlRuntimeRangeKey = 'short' | 'medium' | 'long' | 'extreme';

export const INVENTORY_CONTROL_TARGET_MAX_COUNT = 12;
export const INVENTORY_CONTROL_INDIRECT_FIRE_TARGET_REASON = 'Requires an indirect-fire weapon';
export const INVENTORY_CONTROL_WATER_LAYER_TARGET_REASON = 'Weapon and target are in different water layers';
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
    source?: 'manual' | 'opfor';
    readOnly?: boolean;
    unitType?: TnTargetUnitType;
    distance: number;
    c3Distance?: number;
    useC3?: boolean;
    tnModifier: number;
    /** Present only on resolved targets when this unit has a manual override. */
    manualTnModifier?: number;
    tnCalculator?: TnTargetNumberCalculatorState;
}

/** Calculator-derived modes are inactive while the target TN is manually overridden. */
export function getEffectiveInventoryControlCalculatorState(
    target: Pick<InventoryControlRuntimeTarget, 'manualTnModifier' | 'tnCalculator'>
): TnTargetNumberCalculatorState | undefined {
    return target.manualTnModifier === undefined ? target.tnCalculator : undefined;
}

export function inventoryControlTargetUsesIndirectFire(
    target: Pick<InventoryControlRuntimeTarget, 'manualTnModifier' | 'tnCalculator'>
): boolean {
    return getEffectiveInventoryControlCalculatorState(target)?.indirectFire === true;
}

export function inventoryControlEntryAllowsTarget(
    entry: MountedEquipment,
    target: Pick<InventoryControlRuntimeTarget, 'manualTnModifier' | 'tnCalculator' | 'unitType'>
): boolean {
    return inventoryControlEntryTargetDisabledReason(entry, target) === null;
}

export function inventoryControlEntryTargetDisabledReason(
    entry: MountedEquipment,
    target: Pick<InventoryControlRuntimeTarget, 'manualTnModifier' | 'tnCalculator' | 'unitType'>
): string | null {
    const calculator = getEffectiveInventoryControlCalculatorState(target);
    if (!calculator) return null;
    if (calculator.indirectFire && entry.equipment?.hasFlag('F_INDIRECT_FIRE') !== true) {
        return INVENTORY_CONTROL_INDIRECT_FIRE_TARGET_REASON;
    }

    const targetWaterState = resolveTnTargetWaterState({ ...calculator, unitType: target.unitType });
    const weaponUnderwater = entry.owner.isEquipmentSubmerged?.(entry) ?? false;
    if ((targetWaterState.submerged && !weaponUnderwater)
        || (weaponUnderwater && !targetWaterState.partiallyUnderwater && !targetWaterState.submerged)) {
        return INVENTORY_CONTROL_WATER_LAYER_TARGET_REASON;
    }
    return null;
}

/** Target data whose value depends on the attacking unit and its line of sight. */
export interface InventoryControlUnitTargetState {
    distance: number;
    c3Distance?: number;
    useC3?: boolean;
    tnModifier: number;
    manualTnModifier?: number;
    tnCalculator?: TnTargetNumberCalculatorState;
}

const SHARED_TARGET_CALCULATOR_KEYS = [
    'isAirborne',
    'targetMovementBracket',
    'skidding',
    'prone',
    'immobile',
    'targetHexCover',
    'waterDepth',
    'buildingCover',
    'largeTarget',
    'narcAboveWater',
    'narcUnderwater',
    'tagged'
] as const satisfies readonly (keyof TnTargetNumberCalculatorState)[];

const SHARED_TARGET_CALCULATOR_KEY_SET = new Set<keyof TnTargetNumberCalculatorState>(SHARED_TARGET_CALCULATOR_KEYS);

export function splitInventoryControlCalculatorState(state: TnTargetNumberCalculatorState | undefined): {
    shared?: TnTargetNumberCalculatorState;
    local?: TnTargetNumberCalculatorState;
} {
    if (!state) return {};
    const shared: TnTargetNumberCalculatorState = {};
    const local: TnTargetNumberCalculatorState = {};
    for (const key of Object.keys(state) as (keyof TnTargetNumberCalculatorState)[]) {
        const value = state[key];
        Object.assign(SHARED_TARGET_CALCULATOR_KEY_SET.has(key) ? shared : local, { [key]: value });
    }
    return {
        ...(Object.keys(shared).length > 0 && { shared }),
        ...(Object.keys(local).length > 0 && { local })
    };
}

export function mergeInventoryControlCalculatorState(
    shared: TnTargetNumberCalculatorState | undefined,
    local: TnTargetNumberCalculatorState | undefined
): TnTargetNumberCalculatorState | undefined {
    if (!shared && !local) return undefined;
    return { ...shared, ...local };
}

export interface InventoryControlRuntimeSnapshot {
    entryStates: Map<string, InventoryControlRuntimeEntryState>;
    targets: InventoryControlRuntimeTarget[];
}

export interface InventoryControlRuntimeEntryState {
    selected: boolean;
    range?: InventoryControlRuntimeRangeKey;
    ammoSelection?: InventoryControlRuntimeAmmoSelection;
    targetId?: InventoryControlRuntimeTargetId;
}

export interface InventoryControlRuntimeAmmoSelection {
    readonly selectedProfileId: string | null;
    readonly preferredSourceOptionId: string | null;
}

export interface InventoryControlRuntimeAmmoOptionIdentity {
    readonly id: string;
    readonly profileId: string;
    readonly usable: boolean;
}

export interface InventoryControlRuntimeAmmoProfileIdentity {
    readonly profileId: string;
}

export function resolveInventoryControlSelectedAmmoProfileId(
    profileOptions: readonly InventoryControlRuntimeAmmoProfileIdentity[],
    selectedProfileId?: string | null,
    preferredSourceOptionId?: string | null,
    sourceOptions: readonly Pick<InventoryControlRuntimeAmmoOptionIdentity, 'id' | 'profileId'>[] = [],
): string | undefined {
    if (selectedProfileId && profileOptions.some(option => option.profileId === selectedProfileId)) {
        return selectedProfileId;
    }
    const preferredProfileId = preferredSourceOptionId
        ? sourceOptions.find(option => option.id === preferredSourceOptionId)?.profileId
        : undefined;
    return preferredProfileId && profileOptions.some(option => option.profileId === preferredProfileId)
        ? preferredProfileId
        : profileOptions[0]?.profileId;
}

export function reconcileInventoryControlRuntimeAmmoSelection(
    selection: InventoryControlRuntimeAmmoSelection | undefined,
    sourceOptions: readonly InventoryControlRuntimeAmmoOptionIdentity[],
    profileOptions: readonly InventoryControlRuntimeAmmoProfileIdentity[],
): InventoryControlRuntimeAmmoSelection | undefined {
    if (!selection || profileOptions.length === 0) return undefined;

    const preferredSource = selection.preferredSourceOptionId
        ? sourceOptions.find(option => option.id === selection.preferredSourceOptionId)
        : undefined;
    const selectedProfileId = resolveInventoryControlSelectedAmmoProfileId(
        profileOptions,
        selection.selectedProfileId,
        selection.preferredSourceOptionId,
        sourceOptions,
    );
    if (!selectedProfileId) return undefined;

    return {
        selectedProfileId,
        preferredSourceOptionId: preferredSource?.profileId === selectedProfileId && preferredSource.usable
            ? preferredSource.id
            : null,
    };
}

export function getInventoryControlTargetLetter(index: number): string {
    let value = index + 1;
    let label = '';
    while (value > 0) {
        value--;
        label = String.fromCharCode('A'.charCodeAt(0) + value % 26) + label;
        value = Math.floor(value / 26);
    }
    return label;
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

    constructor(
        private readonly getInventory: () => MountedEquipment[],
        private readonly isTargetValid: (targetId: InventoryControlRuntimeTargetId) => boolean = targetId => this.targetsMap().has(targetId),
        private readonly reconcileAmmoSelection: (
            entry: MountedEquipment,
            selection: InventoryControlRuntimeAmmoSelection,
        ) => InventoryControlRuntimeAmmoSelection | undefined = (_entry, selection) => selection,
    ) {}

    getSnapshot(): InventoryControlRuntimeSnapshot {
        return {
            entryStates: this.cloneEntryStates(this.entryStatesState()),
            targets: this.getTargets()
        };
    }

    getTargets(): InventoryControlRuntimeTarget[] {
        return Array.from(this.targetsMap().values())
            .sort((a, b) => getInventoryControlTargetIndex(a.letter) - getInventoryControlTargetIndex(b.letter))
            .map(target => this.cloneTarget(target));
    }

    getTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        const target = this.targetsMap().get(targetId);
        return target ? this.cloneTarget(target) : undefined;
    }

    getEntryState(entryId: string): InventoryControlRuntimeEntryState | undefined {
        const entryState = this.entryStatesState().get(entryId);
        return entryState ? this.cloneEntryState(entryState) : undefined;
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

    getEntryAmmoSelection(entryId: string): InventoryControlRuntimeAmmoSelection | undefined {
        const selection = this.entryStatesState().get(entryId)?.ammoSelection;
        return selection ? { ...selection } : undefined;
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

    setEntryAmmoSelection(entryId: string, selection: InventoryControlRuntimeAmmoSelection): void {
        this.updateEntryState(entryId, entryState => {
            entryState.ammoSelection = { ...selection };
        });
    }

    setEntryTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        const validTargetId = targetId !== null && this.isTargetValid(targetId) ? targetId : null;
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
        if (!targetId || targets.has(targetId)) return null;

        const wasEmpty = targets.size === 0;
        const letter = targetId;
        const targetIndex = getInventoryControlTargetIndex(letter);
        const target: InventoryControlRuntimeTarget = {
            id: targetId,
            letter,
            name: `Target ${letter}`,
            color: INVENTORY_CONTROL_TARGET_COLORS[targetIndex % INVENTORY_CONTROL_TARGET_COLORS.length],
            source: 'manual',
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

        return this.cloneTarget(target);
    }

    replaceTargets(targets: readonly InventoryControlRuntimeTarget[]): void {
        this.targetsState.set(new Map(targets.map(target => [target.id, this.cloneTarget(target)])));
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
            ...(patch.c3Distance !== undefined && { c3Distance: Math.max(0, Number.isFinite(patch.c3Distance) ? patch.c3Distance : target.c3Distance ?? target.distance) }),
            ...(patch.useC3 !== undefined && { useC3: patch.useC3 === true }),
            ...(patch.tnModifier !== undefined && { tnModifier: Number.isFinite(patch.tnModifier) ? patch.tnModifier : target.tnModifier }),
            ...(patch.tnCalculator !== undefined && { tnCalculator: { ...patch.tnCalculator } })
        };
        this.updateTargets(targets => targets.set(targetId, updated));
        return this.cloneTarget(updated);
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

    reconcile(validTargetIds: ReadonlySet<InventoryControlRuntimeTargetId> = new Set(this.targetsMap().keys())): void {
        const validEntryIds = new Set(this.getInventory().map(entry => entry.id));

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
        this.reconcileAmmoSelections();
    }

    reconcileAmmoSelections(): void {
        const entriesById = new Map(this.getInventory().map(entry => [entry.id, entry]));
        this.updateEntryStates(entryStates => {
            for (const [entryId, entryState] of entryStates) {
                if (!entryState.ammoSelection) continue;
                const entry = entriesById.get(entryId);
                const selection = entry
                    ? this.reconcileAmmoSelection(entry, entryState.ammoSelection)
                    : undefined;
                if (selection) {
                    entryState.ammoSelection = { ...selection };
                } else {
                    delete entryState.ammoSelection;
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
        const usedLetters = new Set(Array.from(this.targetsMap().values(), target => target.letter));
        for (let index = 0; index < INVENTORY_CONTROL_TARGET_MAX_COUNT; index++) {
            const targetId = getInventoryControlTargetLetter(index);
            if (!usedLetters.has(targetId)) return targetId;
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
        if (!entryState.selected && entryState.ammoSelection === undefined) return null;
        return this.cloneEntryState(entryState);
    }

    private cloneEntryStates(entryStates: Map<string, InventoryControlRuntimeEntryState>): Map<string, InventoryControlRuntimeEntryState> {
        return new Map(Array.from(entryStates, ([entryId, entryState]) => [
            entryId,
            this.cloneEntryState(entryState),
        ]));
    }

    private cloneEntryState(entryState: InventoryControlRuntimeEntryState): InventoryControlRuntimeEntryState {
        return {
            ...entryState,
            ...(entryState.ammoSelection && { ammoSelection: { ...entryState.ammoSelection } }),
        };
    }

    private cloneTarget(target: InventoryControlRuntimeTarget): InventoryControlRuntimeTarget {
        return { ...target, ...(target.tnCalculator && { tnCalculator: { ...target.tnCalculator } }) };
    }

    private updateTargets(mutator: (targets: Map<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget>) => void): void {
        this.targetsState.update(current => {
            const next = new Map(current);
            mutator(next);
            return next;
        });
    }
}
