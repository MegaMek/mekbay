// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../models/equipment.model';
import type { InventoryControlRuntimeEntryState } from '../models/inventory-control-runtime-state.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';

export interface InventoryControlHeatEffect {
    readonly value: number;
    readonly weakened: boolean;
    readonly suffix?: '*';
}

export interface InventoryControlHeatRules {
    resolveHeatEffect?: (entry: MountedEquipment) => InventoryControlHeatEffect | null;
    applyHeatEffects?: (entry: MountedEquipment, effect: InventoryControlHeatEffect) => InventoryControlHeatEffect;
}

export interface SelectedInventoryWeaponHeat {
    readonly hasSelection: boolean;
    readonly value: number;
    readonly entryIds: ReadonlySet<string>;
}

export const SELECTED_WEAPONS_HEAT_SOURCE_ID = 'selected-weapons';

/** Resolves weapon firing heat from typed model data and equipment effects. */
export function resolveInventoryControlHeat(
    entry: MountedEquipment,
    rules: InventoryControlHeatRules = {}
): number | null {
    return resolveInventoryControlHeatEffect(entry, rules)?.value ?? null;
}

export function resolveInventoryControlHeatEffect(
    entry: MountedEquipment,
    rules: InventoryControlHeatRules = {}
): InventoryControlHeatEffect | null {
    const baseEffect = !entry.isPhysicalWeapon() && entry.equipment instanceof WeaponEquipment
        ? { value: entry.equipment.heat, weakened: false }
        : rules.resolveHeatEffect?.(entry) ?? null;
    if (!baseEffect) return null;
    const effect = rules.applyHeatEffects?.(entry, baseEffect) ?? baseEffect;
    return Number.isFinite(effect.value)
        ? { ...effect, value: Math.max(0, effect.value) }
        : null;
}

/** Resolves the effective firing heat of all selected non-physical weapons. */
export function resolveSelectedInventoryWeaponHeat(
    inventory: readonly MountedEquipment[],
    entryStates: ReadonlyMap<string, Readonly<InventoryControlRuntimeEntryState>>,
    rules: InventoryControlHeatRules = {}
): SelectedInventoryWeaponHeat {
    const entryIds = new Set<string>();
    let value = 0;
    for (const entry of inventory) {
        if (!entryStates.get(entry.id)?.selected) continue;
        const effect = resolveInventoryControlHeatEffect(entry, rules);
        if (!effect) continue;
        entryIds.add(entry.id);
        value += effect.value;
    }
    return { hasSelection: entryIds.size > 0, value, entryIds };
}

export function selectedWeaponHeatSource(
    selection: SelectedInventoryWeaponHeat,
    label = 'Selected'
): UnitHeatSource | null {
    if (!selection.hasSelection) return null;
    return {
        id: SELECTED_WEAPONS_HEAT_SOURCE_ID,
        label,
        value: selection.value,
        inventorySelection: true,
        signature: JSON.stringify([...selection.entryIds].sort()),
    };
}

/** Builds a preview where selected weapons replace committed Weapons heat. */
export function resolveSelectedWeaponPreviewHeatSources(
    sources: readonly UnitHeatSource[],
    selection: SelectedInventoryWeaponHeat
): UnitHeatSource[] {
    if (!selection.hasSelection) return [...sources];

    const selectedSource = selectedWeaponHeatSource(selection)!;
    const previewSources: UnitHeatSource[] = [];
    let insertedSelection = false;
    for (const source of sources) {
        if (source.id === 'weapons') {
            if (!insertedSelection) previewSources.push(selectedSource);
            insertedSelection = true;
            continue;
        }
        if (source.replacedByFiringEntryId && selection.entryIds.has(source.replacedByFiringEntryId)) continue;
        previewSources.push(source);
    }
    if (!insertedSelection) previewSources.push(selectedSource);
    return previewSources;
}

/** Builds a pending firing action where selected weapons add to committed Weapons heat. */
export function resolveSelectedWeaponFiringHeatSources(
    sources: readonly UnitHeatSource[],
    selection: SelectedInventoryWeaponHeat
): UnitHeatSource[] {
    if (!selection.hasSelection) return [...sources];

    return [
        ...sources.filter(source => !source.replacedByFiringEntryId
            || !selection.entryIds.has(source.replacedByFiringEntryId)),
        selectedWeaponHeatSource(selection)!,
    ];
}

/** Adds selected weapons for display without changing committed sources. */
export function resolveHeatSummarySources(
    sources: readonly UnitHeatSource[],
    selection: SelectedInventoryWeaponHeat,
    selectedLabel = 'Selected'
): UnitHeatSource[] {
    const selectedSource = selectedWeaponHeatSource(selection, selectedLabel);
    if (!selectedSource) return [...sources];
    return [selectedSource, ...sources];
}

export function formatInventoryControlHeat(heat: number, suffix = '', rapidFireCount = 0): string {
    if (heat === 0) return '—';
    const value = Number.isInteger(heat) ? heat.toString() : heat.toFixed(1).replace(/\.0$/, '');
    return `${value}${suffix}${rapidFireCount > 0 ? '/s' : ''}`;
}
