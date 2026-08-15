// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import type { MountedEquipment } from './mounted-equipment.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import {
    InventoryControlRuntimeState,
    mergeInventoryControlCalculatorState,
    reconcileInventoryControlRuntimeAmmoSelection,
    splitInventoryControlCalculatorState,
    type InventoryControlRuntimeRangeKey,
    type InventoryControlRuntimeAmmoSelection,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId,
    type InventoryControlUnitTargetState
} from './inventory-control-runtime-state.model';
import { calculateTargetTnModifier } from './target-number-calculator.model';
import { getInventoryControlAmmoSelectionCandidates } from '../utils/inventory-control.util';

export class CBTInventoryControlRuntime extends InventoryControlRuntimeState {
    private readonly unitTargetStates = signal<Map<InventoryControlRuntimeTargetId, InventoryControlUnitTargetState>>(new Map());

    constructor(private readonly unit: CBTForceUnit) {
        super(
            () => unit.getInventory(),
            targetId => unit.getInventoryControlTargetsMap().has(targetId),
            (entry, selection) => {
                const candidates = getInventoryControlAmmoSelectionCandidates(
                    entry,
                    unit.getEquipmentRegistry(),
                    (weapon, ammo, mode) => unit.matchesInventoryControlAmmo(weapon, ammo, mode),
                    undefined,
                    true,
                );
                return reconcileInventoryControlRuntimeAmmoSelection(
                    selection,
                    candidates.sourceOptions,
                    candidates.profileOptions,
                );
            },
        );
    }

    resolveTarget(sharedTarget: InventoryControlRuntimeTarget): InventoryControlRuntimeTarget {
        const local = this.unitTargetStates().get(sharedTarget.id) ?? this.defaultUnitTargetState(sharedTarget);
        const calculator = mergeInventoryControlCalculatorState(sharedTarget.tnCalculator, local.tnCalculator);
        return {
            id: sharedTarget.id,
            letter: sharedTarget.letter,
            name: sharedTarget.name,
            color: sharedTarget.color,
            ...(sharedTarget.source !== undefined && { source: sharedTarget.source }),
            ...(sharedTarget.readOnly !== undefined && { readOnly: sharedTarget.readOnly }),
            ...(sharedTarget.unitType !== undefined && { unitType: sharedTarget.unitType }),
            distance: local.distance,
            tnModifier: local.manualTnModifier ?? local.tnModifier,
            ...(local.manualTnModifier !== undefined && { manualTnModifier: local.manualTnModifier }),
            ...(local.c3Distance !== undefined && { c3Distance: local.c3Distance }),
            ...(local.useC3 !== undefined && { useC3: local.useC3 }),
            ...(calculator && { tnCalculator: calculator })
        };
    }

    updateUnitTargetState(
        sharedTarget: InventoryControlRuntimeTarget,
        patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>
    ): InventoryControlRuntimeTarget {
        const current = this.unitTargetStates().get(sharedTarget.id) ?? this.defaultUnitTargetState(sharedTarget);
        const localCalculator = splitInventoryControlCalculatorState(patch.tnCalculator).local;
        let updated: InventoryControlUnitTargetState = {
            ...current,
            ...(patch.distance !== undefined && { distance: Math.max(0, Number.isFinite(patch.distance) ? patch.distance : current.distance) }),
            ...(patch.c3Distance !== undefined && { c3Distance: Math.max(0, Number.isFinite(patch.c3Distance) ? patch.c3Distance : current.c3Distance ?? current.distance) }),
            ...(patch.useC3 !== undefined && { useC3: patch.useC3 === true }),
            ...(patch.tnModifier !== undefined && { tnModifier: Number.isFinite(patch.tnModifier) ? patch.tnModifier : current.tnModifier }),
            ...(localCalculator && { tnCalculator: { ...current.tnCalculator, ...localCalculator } })
        };
        if (patch.tnModifier !== undefined) delete updated.manualTnModifier;
        if ((localCalculator || patch.distance !== undefined) && patch.tnModifier === undefined) {
            updated = { ...updated, tnModifier: this.calculateModifier(sharedTarget, updated) };
        }
        this.unitTargetStates.update(states => new Map(states).set(sharedTarget.id, updated));
        this.markInventoryViewChanged();
        return this.resolveTarget(sharedTarget);
    }

    overrideTargetModifier(sharedTarget: InventoryControlRuntimeTarget, modifier: number): InventoryControlRuntimeTarget {
        const current = this.unitTargetStates().get(sharedTarget.id) ?? this.defaultUnitTargetState(sharedTarget);
        const updated = {
            ...current,
            manualTnModifier: Number.isFinite(modifier) ? modifier : current.manualTnModifier ?? current.tnModifier
        };
        this.unitTargetStates.update(states => new Map(states).set(sharedTarget.id, updated));
        this.markInventoryViewChanged();
        return this.resolveTarget(sharedTarget);
    }

    reconcileUnitTargetStates(validTargetIds: ReadonlySet<InventoryControlRuntimeTargetId>): void {
        this.unitTargetStates.update(current => new Map(
            Array.from(current).filter(([targetId]) => validTargetIds.has(targetId))
        ));
    }

    recalculateTargetModifiers(sharedTargets: readonly InventoryControlRuntimeTarget[]): void {
        this.unitTargetStates.update(current => {
            const next = new Map(current);
            for (const sharedTarget of sharedTargets) {
                const local = next.get(sharedTarget.id);
                if (!local) continue;
                next.set(sharedTarget.id, {
                    ...local,
                    tnModifier: this.calculateModifier(sharedTarget, local)
                });
            }
            return next;
        });
    }

    private defaultUnitTargetState(sharedTarget: InventoryControlRuntimeTarget): InventoryControlUnitTargetState {
        const distance = 1;
        return {
            distance,
            tnModifier: this.calculateModifier(sharedTarget, { distance, tnModifier: 0 })
        };
    }

    private calculateModifier(sharedTarget: InventoryControlRuntimeTarget, local: InventoryControlUnitTargetState): number {
        const calculator = mergeInventoryControlCalculatorState(sharedTarget.tnCalculator, local.tnCalculator);
        return calculateTargetTnModifier({
            ...calculator,
            unitType: sharedTarget.unitType,
            range: local.distance,
        }, this.unit.gameRules);
    }

    override setEntrySelected(entry: MountedEquipment, selected: boolean): void {
        super.setEntrySelected(entry, selected);
        this.markInventoryViewChanged();
    }

    override setEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        super.setEntryRange(entry, range);
        this.markInventoryViewChanged();
    }

    override setEntryAmmoSelection(entryId: string, selection: InventoryControlRuntimeAmmoSelection): void {
        super.setEntryAmmoSelection(entryId, selection);
        this.reconcileAmmoSelections();
        this.markInventoryViewChanged();
    }

    override setEntryTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        super.setEntryTarget(entry, targetId);
        this.markInventoryViewChanged();
    }

    override clearSelection(): void {
        super.clearSelection();
        this.markInventoryViewChanged();
    }

    markAmmoSourcesChanged(): void {
        this.reconcileAmmoSelections();
        super.markInventoryViewChanged();
    }

}
