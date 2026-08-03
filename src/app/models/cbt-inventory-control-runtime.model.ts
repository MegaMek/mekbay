/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { signal } from '@angular/core';
import type { MountedEquipment } from './mounted-equipment.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import {
    InventoryControlRuntimeState,
    mergeInventoryControlCalculatorState,
    splitInventoryControlCalculatorState,
    type InventoryControlRuntimeRangeKey,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId,
    type InventoryControlUnitTargetState
} from './inventory-control-runtime-state.model';
import { calculateTargetTnModifier } from './target-number-calculator.model';

export class CBTInventoryControlRuntime extends InventoryControlRuntimeState {
    private readonly unitTargetStates = signal<Map<InventoryControlRuntimeTargetId, InventoryControlUnitTargetState>>(new Map());

    constructor(private readonly unit: CBTForceUnit) {
        super(
            () => unit.getInventory(),
            targetId => unit.getInventoryControlTargetsMap().has(targetId)
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
            indirectFireBaseModifier: this.unit.rules.getSpottingModifier()
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

    override setEntryAmmoOption(entryId: string, optionId: string): void {
        super.setEntryAmmoOption(entryId, optionId);
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

}
