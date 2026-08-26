// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal } from '@angular/core';
import {
    isTnTargetImmobile,
    type TnTargetNumberCalculatorState,
    type TnTargetUnitType,
} from './target-number-calculator.model';

export type InventoryControlRuntimeRangeKey = 'short' | 'medium' | 'long' | 'extreme';

export const INVENTORY_CONTROL_TARGET_MAX_COUNT = 12;
export const INVENTORY_CONTROL_TAG_INFANTRY_TARGET_REASON = 'TAG cannot designate infantry';
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
    /** Present only when this unit owns an explicit manual TN override. */
    manualTnModifier?: number;
    tnCalculator?: TnTargetNumberCalculatorState;
}

/** Calculator-derived modes are inactive while the target TN is manually overridden. */
export function getEffectiveInventoryControlCalculatorState(
    target: Pick<InventoryControlRuntimeTarget, 'manualTnModifier' | 'tnCalculator' | 'unitType'>,
): TnTargetNumberCalculatorState | undefined {
    if (target.manualTnModifier !== undefined || !target.tnCalculator) return undefined;
    if (target.tnCalculator.immobile === true || !isTnTargetImmobile(target.unitType, false)) {
        return target.tnCalculator;
    }
    return { ...target.tnCalculator, immobile: true };
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

/** Attacker-local target facts; these must never be written to the force target registry. */
export type InventoryControlUnitTargetPatch = Partial<Pick<
    InventoryControlRuntimeTarget,
    'distance' | 'c3Distance' | 'useC3' | 'tnModifier' | 'tnCalculator'
>>;

const SHARED_TARGET_CALCULATOR_KEYS = [
    'isAirborne',
    'targetMovementBracket',
    'targetMovementDistance',
    'skidding',
    'prone',
    'immobile',
    'targetHexCover',
    'waterDepth',
    'buildingCover',
    'targetHeight',
    'largeTarget',
    'narcAboveWater',
    'narcUnderwater',
    'tagged',
    'ecmShielded',
    'stealth',
    'stealthSystem',
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

/** Detached presentation row for the supplied record-sheet ammo summary. */
export interface InventoryControlAmmoProfileRow {
    readonly label: string;
    readonly remaining: number;
}

export interface InventoryControlRuntimeAmmoOptionIdentity {
    readonly id: string;
    readonly profileId: string;
    readonly usable: boolean;
}

export interface InventoryControlRuntimeAmmoProfileIdentity {
    readonly profileId: string;
}

/** Stable identity required by selection/range/target presentation state. */
export interface InventoryControlRuntimeEntryRef {
    readonly id: string;
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

export class InventoryControlRuntimeState {
    private readonly entryStatesState = signal<Map<string, InventoryControlRuntimeEntryState>>(new Map());
    private readonly inventoryViewVersionState = signal(0);

    readonly entryStates = computed<ReadonlyMap<string, Readonly<InventoryControlRuntimeEntryState>>>(() => this.cloneEntryStates(this.entryStatesState()));
    readonly inventoryViewVersion = this.inventoryViewVersionState.asReadonly();

    constructor(
        private readonly getInventory: () => readonly InventoryControlRuntimeEntryRef[],
        private readonly isTargetValid: (targetId: InventoryControlRuntimeTargetId) => boolean = () => false,
        private readonly reconcileAmmoSelection: (
            entry: InventoryControlRuntimeEntryRef,
            selection: InventoryControlRuntimeAmmoSelection,
        ) => InventoryControlRuntimeAmmoSelection | undefined = (_entry, selection) => selection,
    ) {}

    getSnapshot(): Pick<InventoryControlRuntimeSnapshot, 'entryStates'> {
        return {
            entryStates: this.cloneEntryStates(this.entryStatesState()),
        };
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

    setEntrySelected(entry: InventoryControlRuntimeEntryRef, selected: boolean): void {
        this.updateEntryState(entry.id, entryState => {
            entryState.selected = selected;
            if (!selected) {
                delete entryState.range;
                delete entryState.targetId;
            }
        });
    }

    setEntryRange(entry: InventoryControlRuntimeEntryRef, range: InventoryControlRuntimeRangeKey | null): void {
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

    toggleEntryRange(entry: InventoryControlRuntimeEntryRef, range: InventoryControlRuntimeRangeKey, forceSelected = false): void {
        const entryState = this.entryStatesState().get(entry.id);
        const selected = (entryState?.selected ?? false) && entryState?.range === range;
        this.setEntryRange(entry, !forceSelected && selected ? null : range);
    }

    setEntryAmmoSelection(entryId: string, selection: InventoryControlRuntimeAmmoSelection): void {
        this.updateEntryState(entryId, entryState => {
            entryState.ammoSelection = { ...selection };
        });
    }

    setEntryTarget(entry: InventoryControlRuntimeEntryRef, targetId: InventoryControlRuntimeTargetId | null): void {
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

    clearSelection(): void {
        this.updateEntryStates(entryStates => {
            for (const entryState of entryStates.values()) {
                entryState.selected = false;
                delete entryState.range;
                delete entryState.targetId;
            }
        });
    }

    reconcile(validTargetIds?: ReadonlySet<InventoryControlRuntimeTargetId>): void {
        const validEntryIds = new Set(this.getInventory().map(entry => entry.id));

        this.updateEntryStates(entryStates => {
            for (const [entryId, entryState] of entryStates) {
                if (!validEntryIds.has(entryId)) {
                    entryStates.delete(entryId);
                    continue;
                }
                if (entryState.targetId
                    && !(validTargetIds?.has(entryState.targetId) ?? this.isTargetValid(entryState.targetId))) {
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

    private cloneEntryStates(
        entryStates: ReadonlyMap<string, Readonly<InventoryControlRuntimeEntryState>>,
    ): Map<string, InventoryControlRuntimeEntryState> {
        return new Map(Array.from(entryStates, ([entryId, entryState]) => [
            entryId,
            this.cloneEntryState(entryState),
        ]));
    }

    private cloneEntryState(entryState: Readonly<InventoryControlRuntimeEntryState>): InventoryControlRuntimeEntryState {
        return {
            ...entryState,
            ...(entryState.ammoSelection && { ammoSelection: { ...entryState.ammoSelection } }),
        };
    }

}
