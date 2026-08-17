// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, type Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { Unit } from "./units.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { type CBTSerializedUnit, type CBTSerializedForce, CBT_SERIALIZED_FORCE_SCHEMA, type SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force } from './force.model';
import { CBTForceUnit } from './cbt-force-unit.model';
import { Sanitizer } from '../utils/sanitizer.util';
import {
    InventoryControlRuntimeState,
    splitInventoryControlCalculatorState,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId
} from './inventory-control-runtime-state.model';
import { getEffectivePilotingSkill } from '../utils/cbt-common.util';



export class CBTForce extends Force<CBTForceUnit> {
    override gameSystem: GameSystem = GameSystem.CLASSIC;
    readonly inventoryControlTargets = new InventoryControlRuntimeState(() => []);
    readonly inventoryControlOpforEnabled = signal(false);

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): CBTForceUnit {
        return new CBTForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
    }

    getInventoryControlTargets(): InventoryControlRuntimeTarget[] {
        return this.inventoryControlTargets.getTargets();
    }

    getInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        return this.inventoryControlTargets.getTarget(targetId);
    }

    hasInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): boolean {
        return this.inventoryControlTargets.targetsMap().has(targetId);
    }

    createInventoryControlTarget(sourceUnit?: CBTForceUnit): InventoryControlRuntimeTarget | null {
        const existingTargets = this.getInventoryControlTargets();
        const target = this.inventoryControlTargets.createTarget();
        if (target && existingTargets.length === 0) this.assignFirstTargetToExistingSelections(target.id, sourceUnit);
        this.markInventoryControlChanged(false, sourceUnit);
        return target;
    }

    updateInventoryControlTarget(
        targetId: InventoryControlRuntimeTargetId,
        patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>,
        sourceUnit?: CBTForceUnit
    ): InventoryControlRuntimeTarget | null {
        const sharedCalculator = splitInventoryControlCalculatorState(patch.tnCalculator).shared;
        const existingTarget = this.inventoryControlTargets.getTarget(targetId);
        const sharedPatch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>> = {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.color !== undefined && { color: patch.color }),
            ...(patch.unitType !== undefined && { unitType: patch.unitType }),
            ...(sharedCalculator && { tnCalculator: { ...existingTarget?.tnCalculator, ...sharedCalculator } })
        };
        const hasSharedPatch = Object.keys(sharedPatch).length > 0;
        const target = hasSharedPatch
            ? this.inventoryControlTargets.updateTarget(targetId, sharedPatch)
            : this.inventoryControlTargets.getTarget(targetId) ?? null;
        if (hasSharedPatch) {
            this.markInventoryControlChanged(false, sourceUnit, patch.unitType !== undefined || sharedCalculator !== undefined);
        }
        return target;
    }

    deleteInventoryControlTarget(targetId: InventoryControlRuntimeTargetId, sourceUnit?: CBTForceUnit): void {
        this.inventoryControlTargets.deleteTarget(targetId);
        this.markInventoryControlChanged(true, sourceUnit);
    }

    resetInventoryControlTargets(sourceUnit?: CBTForceUnit): void {
        this.inventoryControlOpforEnabled.set(false);
        this.inventoryControlTargets.resetTargets();
        this.markInventoryControlChanged(true, sourceUnit);
    }

    replaceInventoryControlTargets(targets: readonly InventoryControlRuntimeTarget[]): void {
        this.inventoryControlTargets.replaceTargets(targets.map(target => this.toSharedInventoryControlTarget(target)));
        this.markInventoryControlChanged(true, undefined, true);
    }

    clearExpiredManualTargetTags(sourceUnit?: CBTForceUnit): void {
        let changed = false;
        const targets = this.getInventoryControlTargets().map(target => {
            if (target.source === 'opfor' || target.tnCalculator?.tagged !== true) return target;
            changed = true;
            return {
                ...target,
                tnCalculator: { ...target.tnCalculator, tagged: false },
            };
        });
        if (!changed) return;

        this.inventoryControlTargets.replaceTargets(targets);
        this.markInventoryControlChanged(false, sourceUnit);
    }

    private toSharedInventoryControlTarget(target: InventoryControlRuntimeTarget): InventoryControlRuntimeTarget {
        const sharedCalculator = splitInventoryControlCalculatorState(target.tnCalculator).shared;
        return {
            id: target.id,
            letter: target.letter,
            name: target.name,
            color: target.color,
            ...(target.source !== undefined && { source: target.source }),
            ...(target.readOnly !== undefined && { readOnly: target.readOnly }),
            ...(target.unitType !== undefined && { unitType: target.unitType }),
            distance: 1,
            tnModifier: 0,
            ...(sharedCalculator && { tnCalculator: sharedCalculator })
        };
    }

    private markInventoryControlChanged(reconcile = false, sourceUnit?: CBTForceUnit, recalculate = false): void {
        const validTargetIds = new Set(this.inventoryControlTargets.targetsMap().keys());
        for (const unit of this.inventoryControlUnits(sourceUnit)) {
            if (reconcile) {
                unit.inventoryControl.reconcile(validTargetIds);
                unit.inventoryControl.reconcileUnitTargetStates(validTargetIds);
            }
            if (recalculate) unit.inventoryControl.recalculateTargetModifiers(this.getInventoryControlTargets());
            unit.inventoryControl.markInventoryViewChanged();
        }
    }

    private assignFirstTargetToExistingSelections(targetId: InventoryControlRuntimeTargetId, sourceUnit?: CBTForceUnit): void {
        for (const unit of this.inventoryControlUnits(sourceUnit)) {
            const entryStates = unit.inventoryControl.entryStates();
            for (const entry of unit.getInventory()) {
                const state = entryStates.get(entry.id);
                if (state?.selected && !state.targetId) unit.inventoryControl.setEntryTarget(entry, targetId);
            }
        }
    }

    private inventoryControlUnits(sourceUnit?: CBTForceUnit): CBTForceUnit[] {
        return Array.from(new Set([...this.units(), ...(sourceUnit ? [sourceUnit] : [])]));
    }

    /**
     * Transfers pilot data (name, gunnery, piloting skills) from one CBT unit to another.
     */
    protected override transferPilotData(fromUnit: CBTForceUnit, toUnit: CBTForceUnit): void {
        const fromCrew = fromUnit.getCrewMembers();
        const toCrew = toUnit.getCrewMembers();
        const fromIsLandAirMek = fromUnit.getUnit().subtype === 'Land-Air BattleMek';
        const toIsLandAirMek = toUnit.getUnit().subtype === 'Land-Air BattleMek';

        // Transfer data for each crew member that exists in both units
        const crewCount = Math.min(fromCrew.length, toCrew.length);
        for (let i = 0; i < crewCount; i++) {
            const fromMember = fromCrew[i];
            const toMember = toCrew[i];
            if (fromMember && toMember) {
                const name = fromMember.getName();
                if (name) {
                    toMember.setName(name);
                }
                const gunnery = fromMember.getSkill('gunnery');
                const piloting = getEffectivePilotingSkill(toUnit.getUnit(), fromMember.getSkill('piloting'));
                toMember.setSkill('gunnery', gunnery);
                toMember.setSkill('piloting', piloting);
                if (toIsLandAirMek) {
                    toMember.setSkill(
                        'gunnery',
                        fromIsLandAirMek ? fromMember.getSkill('gunnery', true) : gunnery,
                        true,
                    );
                    toMember.setSkill(
                        'piloting',
                        fromIsLandAirMek ? fromMember.getSkill('piloting', true) : piloting,
                        true,
                    );
                }
            }
        }

        toUnit.setFormationCommander(fromUnit.commander());
    }

    protected override deserializeForceUnit(data: CBTSerializedUnit): CBTForceUnit {
        return CBTForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector);
    }

    protected override sanitizeForceData(data: SerializedForce): SerializedForce {
        return Sanitizer.sanitize(data, CBT_SERIALIZED_FORCE_SCHEMA);
    }

    public static override deserialize(
        data: CBTSerializedForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): CBTForce {
        const force = new CBTForce(data.name, dataService, unitInitializer, injector);
        force.populateFromSerialized(data);
        return force;
    }

    protected override deserializeFrom(serialized: SerializedForce): CBTForce {
        return CBTForce.deserialize(
            serialized as CBTSerializedForce,
            this.dataService, this.unitInitializer, this.injector
        );
    }
}
