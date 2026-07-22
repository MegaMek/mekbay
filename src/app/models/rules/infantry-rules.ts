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

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { WeaponEquipment } from '../equipment.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import type { MotiveModes } from '../motiveModes.model';
import { getTargetUnitTypeModifier } from '../target-number-calculator.model';
import type { TurnState } from '../turn-state.model';
import type { UnitComponent } from '../units.model';
import type { MountedEquipmentRuleState } from './unit-type-rules';
import { UnitTypeRulesBase, type UnitModifierBreakdownEntry } from './unit-type-rules';

export const FIELD_GUN_LOCATION = 'FGUN';

/**
 * Author: Drake
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

    override computeEntryState(entry: MountedEquipment): MountedEquipmentRuleState {
        const state = super.computeEntryState(entry);
        return {
            ...state,
            isDisabled: state.isDisabled || this.isInfantryFieldGunEntryDisabled(entry)
        };
    }

    isInfantryFieldGunEntryDisabled(entry: MountedEquipment): boolean {
        const componentRef = this.getInventoryComponentRef(entry);
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
        const componentRef = this.getInventoryComponentRef(entry);
        const component = componentRef === null ? undefined : this.unit.getUnit().comp[componentRef.componentIndex];
        if (!component || component.l !== FIELD_GUN_LOCATION || component.t === 'X') return null;
        return component;
    }

    private getInventoryComponentRef(entry: MountedEquipment): { componentIndex: number; binIndex: number | null } | null {
        const indexText = entry.id.split('#').pop();
        if (!indexText) return null;
        const [componentIndexText, binIndexText] = indexText.split('.');
        const componentIndex = Number(componentIndexText);
        const binIndex = binIndexText === undefined ? null : Number(binIndexText);
        if (!Number.isInteger(componentIndex)) return null;
        if (binIndex !== null && !Number.isInteger(binIndex)) return null;
        return { componentIndex, binIndex };
    }

}
