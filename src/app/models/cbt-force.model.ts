/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { Unit } from "./units.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { type CBTSerializedUnit, type CBTSerializedForce, CBT_SERIALIZED_FORCE_SCHEMA, type SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force } from './force.model';
import { CBTForceUnit } from './cbt-force-unit.model';
import { Sanitizer } from '../utils/sanitizer.util';
import {
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
    getInventoryControlTargetLetter,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId,
    type InventoryControlSharedTarget
} from './inventory-control-runtime-state.model';
import type { TnTargetNumberCalculatorState } from './target-number-calculator.model';

let nextSharedInventoryControlTargetId = 1;

/*
 * Author: Drake
 */

export class CBTForce extends Force<CBTForceUnit> {
    override gameSystem: GameSystem = GameSystem.CLASSIC;
    private readonly sharedInventoryControlTargets = new Map<InventoryControlRuntimeTargetId, InventoryControlSharedTarget>();

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): CBTForceUnit {
        return this.attachSharedInventoryControlTargets(
            new CBTForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector)
        );
    }

    createSharedInventoryControlTarget(sourceUnit: CBTForceUnit): InventoryControlRuntimeTarget | null {
        const units = this.inventoryControlUnits(sourceUnit);
        if (units.some(unit => unit.getInventoryControlTargets().length >= INVENTORY_CONTROL_TARGET_MAX_COUNT)) return null;
        const letter = this.nextSharedTargetLetter(units);
        if (!letter) return null;
        const targetIndex = letter.charCodeAt(0) - 'A'.charCodeAt(0);
        const targetId = `shared-target-${nextSharedInventoryControlTargetId++}`;
        const sharedTarget: InventoryControlSharedTarget = {
            id: targetId,
            letter,
            name: `Target ${letter}`,
            color: INVENTORY_CONTROL_TARGET_COLORS[targetIndex % INVENTORY_CONTROL_TARGET_COLORS.length],
            shared: true,
            unitType: 'mek-biped'
        };
        this.sharedInventoryControlTargets.set(targetId, sharedTarget);
        for (const unit of units) {
            unit.inventoryControl.createTarget({
                sharedTarget: this.cloneSharedTarget(sharedTarget),
                upgradeExistingSelections: unit === sourceUnit
            });
        }
        return sourceUnit.getInventoryControlTarget(targetId) ?? null;
    }

    updateSharedInventoryControlTarget(
        sourceUnit: CBTForceUnit,
        targetId: InventoryControlRuntimeTargetId,
        patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>
    ): InventoryControlRuntimeTarget | null {
        const sharedTarget = this.sharedInventoryControlTargets.get(targetId);
        if (!sharedTarget) return null;
        const sharedCalculatorPatch = this.sharedCalculatorPatch(patch.tnCalculator);
        const updatedSharedTarget: InventoryControlSharedTarget = {
            ...sharedTarget,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.color !== undefined && { color: patch.color }),
            ...(patch.unitType !== undefined && { unitType: patch.unitType }),
            ...(sharedCalculatorPatch && {
                tnCalculator: { ...sharedTarget.tnCalculator, ...sharedCalculatorPatch }
            })
        };
        this.sharedInventoryControlTargets.set(targetId, updatedSharedTarget);

        const observerCalculatorPatch = this.observerCalculatorPatch(patch.tnCalculator);
        const units = this.inventoryControlUnits(sourceUnit);
        for (const unit of units) {
            const current = unit.getInventoryControlTarget(targetId);
            if (!current) continue;
            const calculator = {
                ...current.tnCalculator,
                ...updatedSharedTarget.tnCalculator,
                ...(unit === sourceUnit ? observerCalculatorPatch : {})
            };
            const unitPatch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>> = {
                name: updatedSharedTarget.name,
                color: updatedSharedTarget.color,
                unitType: updatedSharedTarget.unitType,
                tnCalculator: calculator
            };
            if (unit === sourceUnit) {
                Object.assign(unitPatch, this.observerTargetPatch(patch));
            }
            unit.inventoryControl.updateTarget(targetId, unitPatch);
        }
        return sourceUnit.getInventoryControlTarget(targetId) ?? null;
    }

    deleteSharedInventoryControlTarget(sourceUnit: CBTForceUnit, targetId: InventoryControlRuntimeTargetId): void {
        if (!this.sharedInventoryControlTargets.delete(targetId)) return;
        const units = this.inventoryControlUnits(sourceUnit);
        units.forEach(unit => unit.inventoryControl.deleteTarget(targetId));
    }

    isSharedInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): boolean {
        return this.sharedInventoryControlTargets.has(targetId);
    }

    private inventoryControlUnits(sourceUnit: CBTForceUnit): CBTForceUnit[] {
        return Array.from(new Set([...this.units(), sourceUnit]));
    }

    private nextSharedTargetLetter(units: readonly CBTForceUnit[]): string | null {
        const usedLetters = new Set(units.flatMap(unit => unit.getInventoryControlTargets().map(target => target.letter)));
        for (let index = 0; index < INVENTORY_CONTROL_TARGET_MAX_COUNT; index++) {
            const letter = getInventoryControlTargetLetter(index);
            if (!usedLetters.has(letter)) return letter;
        }
        return null;
    }

    private sharedCalculatorPatch(calculator: TnTargetNumberCalculatorState | undefined): Partial<TnTargetNumberCalculatorState> | null {
        if (!calculator) return null;
        const patch: Partial<TnTargetNumberCalculatorState> = {
            ...(calculator.isAirborne !== undefined && { isAirborne: calculator.isAirborne }),
            ...(calculator.targetMovementBracket !== undefined && { targetMovementBracket: calculator.targetMovementBracket }),
            ...(calculator.skidding !== undefined && { skidding: calculator.skidding }),
            ...(calculator.stance !== undefined && { stance: calculator.stance }),
            ...(calculator.targetHexCover !== undefined && { targetHexCover: calculator.targetHexCover }),
            ...(calculator.largeTarget !== undefined && { largeTarget: calculator.largeTarget })
        };
        return Object.keys(patch).length > 0 ? patch : null;
    }

    private observerCalculatorPatch(calculator: TnTargetNumberCalculatorState | undefined): Partial<TnTargetNumberCalculatorState> {
        if (!calculator) return {};
        const { isAirborne, targetMovementBracket, skidding, stance, targetHexCover, largeTarget, ...observerPatch } = calculator;
        return observerPatch;
    }

    private observerTargetPatch(patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): Partial<InventoryControlRuntimeTarget> {
        return {
            ...(patch.distance !== undefined && { distance: patch.distance }),
            ...(patch.c3Distance !== undefined && { c3Distance: patch.c3Distance }),
            ...(patch.useC3 !== undefined && { useC3: patch.useC3 }),
            ...(patch.tnModifier !== undefined && { tnModifier: patch.tnModifier })
        };
    }

    private cloneSharedTarget(target: InventoryControlSharedTarget): InventoryControlSharedTarget {
        return { ...target, ...(target.tnCalculator && { tnCalculator: { ...target.tnCalculator } }) };
    }

    private attachSharedInventoryControlTargets(unit: CBTForceUnit): CBTForceUnit {
        for (const target of this.sharedInventoryControlTargets.values()) {
            unit.inventoryControl.createTarget({ sharedTarget: this.cloneSharedTarget(target), upgradeExistingSelections: false });
        }
        return unit;
    }

    /**
     * Transfers pilot data (name, gunnery, piloting skills) from one CBT unit to another.
     */
    protected override transferPilotData(fromUnit: CBTForceUnit, toUnit: CBTForceUnit): void {
        const fromCrew = fromUnit.getCrewMembers();
        const toCrew = toUnit.getCrewMembers();

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
                toMember.setSkill('gunnery', fromMember.getSkill('gunnery'));
                toMember.setSkill('piloting', fromMember.getSkill('piloting'));
            }
        }

        toUnit.setFormationCommander(fromUnit.commander());
    }

    protected override deserializeForceUnit(data: CBTSerializedUnit): CBTForceUnit {
        return this.attachSharedInventoryControlTargets(
            CBTForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector)
        );
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
