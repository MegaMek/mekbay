// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { WeaponEquipment } from '../equipment.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import { parseInventoryComponentReference } from '../inventory-component-reference.model';
import type { MotiveModes } from '../motiveModes.model';
import { getTargetUnitTypeModifier } from '../target-number-calculator.model';
import type { TurnState } from '../turn-state.model';
import type { UnitComponent } from '../units.model';
import type { MountedEquipmentStatus } from './unit-type-rules';
import { UnitTypeRulesBase, type UnitModifierBreakdownEntry } from './unit-type-rules';

export const FIELD_GUN_LOCATION = 'FGUN';

/**
 * 
 * Infantry / Battle Armor game rules.
 */
export class InfantryRules extends UnitTypeRulesBase {

    constructor(unit: CBTForceUnit) {
        super(unit);
    }

    evaluateDestroyed(): void {
        this.evaluateInventoryDestruction();

        let allDestroyed = true;

        // Unit destroyed when all troop armor+internal locations are committed-destroyed.
        for (const loc of this.unit.locations?.armor?.keys() ?? []) {
            if (!this.unit.isArmorLocCommittedDestroyed(loc)) {
                allDestroyed = false;
                break;
            }
        }
        if (allDestroyed) {
            for (const loc of this.unit.locations?.internal?.keys() ?? []) {
                if (!this.unit.isInternalLocCommittedDestroyed(loc)) {
                    allDestroyed = false;
                    break;
                }
            }
        }

        if (this.unit.destroyed !== allDestroyed) {
            this.unit.setDestroyed(allDestroyed);
        }
    }

    /** Mark inventory entries as destroyed when the T1 armor location is gone. */
    evaluateInventoryDestruction(): void {
        const squadSize = this.unit.getUnit().squadSize ?? 1;
        let allSquadsDestroyed = true;
        for (let i = 1; i <= squadSize; i++) {
            if (!this.unit.isArmorLocCommittedDestroyed(`T${i}`)) {
                allSquadsDestroyed = false;
                break;
            }
        }
        const t1Destroyed = this.unit.isArmorLocDestroyed('T1');
        for (const entry of this.unit.getInventory()) {
            // These mounts are derived runtime ammo records. Their parent weapon
            // owns availability and is evaluated separately by ammo controls.
            if (entry.intrinsicOneShotAmmo) continue;
            if (!entry.equipment) continue;
            entry.setCommittedDestroyed(allSquadsDestroyed);
            if (allSquadsDestroyed) continue;
            
            // TODO: not working, locations is empty for Infantry!!!! FIX ME!
            if (entry.locations?.has('SSW')) { 
                entry.setCommittedDestroyed(t1Destroyed);
            }
        }
    }

    protected override getTargetUnitTypeModifierBreakdown(_turnState: TurnState): UnitModifierBreakdownEntry[] {
        const baseUnit = this.unit.getUnit();
        if (baseUnit.subtype !== 'Battle Armor') return [];
        return [{ label: 'Battle Armor', modifier: getTargetUnitTypeModifier('battle-armor') }];
    }

    override getMinDistanceForMoveMode(moveMode: MotiveModes): number | null {
        if (moveMode === 'jump') return 1;
        return null;
    }

    override getEquipmentStatus(entry: MountedEquipment): MountedEquipmentStatus {
        const availability = super.getEquipmentStatus(entry);
        if (availability !== 'available') return availability;
        return this.isInfantryFieldGunEntryDisabled(entry) ? 'disabled' : 'available';
    }

    isInfantryFieldGunEntryDisabled(entry: MountedEquipment): boolean {
        const componentRef = parseInventoryComponentReference(entry.id);
        const component = this.getFieldGunComponent(entry);
        if (!component || componentRef === null || componentRef.binIndex === null) return false;
        return componentRef.binIndex >= this.getFieldGunFunctionalCount(component);
    }

    getFieldGunFunctionalCount(component: UnitComponent): number {
        const crewSize = Math.max(1, component.cw ?? 1);
        const maxGuns = Math.max(0, component.q ?? 0);
        return Math.min(maxGuns, Math.floor(this.getCommittedInfantryTroopCount() / crewSize));
    }

    private getCommittedInfantryTroopCount(): number {
        const totalTroops = this.unit.locations?.internal.get('TROOP')?.points
            ?? this.unit.getUnit().internal
            ?? ((this.unit.getUnit().squads ?? 0) * (this.unit.getUnit().squadSize ?? 0));
        const committedDamage = this.unit.getCommittedInternalHits('TROOP');
        return Math.max(0, totalTroops - committedDamage);
    }

    getFieldGunComponent(entry: MountedEquipment): UnitComponent | null {
        if (this.unit.getUnit().type !== 'Infantry' || this.unit.getUnit().subtype === 'Battle Armor') return null;
        if (!(entry.equipment instanceof WeaponEquipment)) return null;
        const componentRef = parseInventoryComponentReference(entry.id);
        const component = componentRef === null ? undefined : this.unit.getUnit().comp[componentRef.componentIndex];
        if (!component || component.l !== FIELD_GUN_LOCATION || component.t === 'X') return null;
        return component;
    }

}
