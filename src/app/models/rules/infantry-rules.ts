// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit, EquipmentAction } from '../cbt-force-unit.model';
import { WeaponEquipment } from '../equipment.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import { parseInventoryComponentReference } from '../inventory-component-reference.model';
import type { MotiveModes } from '../motiveModes.model';
import { getTargetUnitTypeModifier } from '../target-number-calculator.model';
import type { TurnState } from '../turn-state.model';
import type { UnitComponent } from '../unit-summary.model';
import { UnitTypeRulesBase, type UnitModifierBreakdownEntry } from './unit-type-rules';

export const FIELD_GUN_LOCATION = 'FGUN';

/**
 * 
 * Infantry / Battle Armor game rules.
 */
export class InfantryRules extends UnitTypeRulesBase {

    override canPerformEquipmentAction(entry: MountedEquipment, action: EquipmentAction): boolean {
        return action !== 'fire' || !this.isInfantryFieldGunEntryDisabled(entry);
    }

    constructor(unit: CBTForceUnit) {
        super(unit);
    }

    evaluateDestroyed(): void {
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

    protected override getTargetUnitTypeModifierBreakdown(_turnState: TurnState): UnitModifierBreakdownEntry[] {
        const baseUnit = this.unit.getUnit();
        if (baseUnit.subtype !== 'Battle Armor') return [];
        return [{ label: 'Battle Armor', modifier: getTargetUnitTypeModifier('battle-armor') }];
    }

    override getMinDistanceForMoveMode(moveMode: MotiveModes): number | null {
        if (moveMode === 'jump') return 1;
        return null;
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
