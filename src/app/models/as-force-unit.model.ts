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

import { computed, Injector, signal, Signal } from '@angular/core';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../services/unit-initializer.service';
import { ASSerializedState, ASSerializedUnit, C3_POSITION_SCHEMA } from './force-serialization';
import { ASForce } from './as-force.model';
import { ForceUnit } from './force-unit.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnitState } from './as-force-unit-state.model';
import { CrewMember } from './crew-member.model';
import { ASCustomPilotAbility } from './as-abilities.model';
import { PVCalculatorUtil } from '../utils/pv-calculator.util';

/** Represents either a standard ability (by ID) or a custom ability (object) */
export type AbilitySelection = string | ASCustomPilotAbility;

/*
 * Author: Drake
 */
export class ASForceUnit extends ForceUnit {
    declare force: ASForce;
    protected override state: ASForceUnitState;

    private readonly _pilotName = signal<string | undefined>(undefined);
    private readonly _pilotSkill = signal<number>(4);
    private readonly _pilotAbilities = signal<AbilitySelection[]>([]);

    readonly alias = this._pilotName.asReadonly();
    readonly pilotSkill = this._pilotSkill.asReadonly();
    readonly pilotAbilities = this._pilotAbilities.asReadonly();

    constructor(unit: Unit,
        force: ASForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ) {
        super(unit, force, dataService, unitInitializer, injector);
        this.state = new ASForceUnitState(this);
    }

    override destroy() {
        super.destroy();
    }

    public async load() {
        if (this.isLoaded) return;
        try {
            this.isLoaded = true;
        } finally {
        }
    }

    getBv = computed<number>(() => {
        const adjustedPv = this.adjustedPv();
        if (adjustedPv !== null) {
            return adjustedPv;
        }
        return this.unit.pv;
    })

    public adjustedPv = computed<number>(() => {
        return PVCalculatorUtil.calculateAdjustedPV(
            this.unit.pv,
            this.pilotSkill()
        );
    });

    /** Alpha Strike units don't have detailed crew management - return empty signal */
    getCrewMembers = computed<CrewMember[]>(() => {
        return [];
    });

    getHeat = computed<number>(() => {
        return this.state.heat();
    });

    setHeat(heat: number): void {
        this.state.heat.set(heat);
        this.setModified();
        this.force.emitChanged();
    }

    // ===== State Access Methods =====

    /**
     * Get the unit's state for direct access.
     */
    getState(): ASForceUnitState {
        return this.state;
    }

    /**
     * Check if there are uncommitted changes.
     */
    isDirty = computed<boolean>(() => {
        return this.state.isDirty();
    });

    /**
     * Get the remaining armor (max - effective damage).
     */
    remainingArmor = computed<number>(() => {
        return Math.max(0, this.unit.as.Arm - (this.state.armor() + this.state.pendingArmor()));
    });

    /**
     * Get the remaining internal structure (max - effective damage).
     */
    remainingInternal = computed<number>(() => {
        return Math.max(0, this.unit.as.Str - (this.state.internal() + this.state.pendingInternal()));
    });

    /**
     * Check if unit is destroyed.
     * Destroyed when:
     * a) Internal structure is fully damaged
     * b) Engine gets 2nd hit (3rd for vessels)
     * c) Crew gets more than 1 hit
     * d) Thrust reaches 0 (for units with Th)
     */
    isDestroyed = computed<boolean>(() => {
        // Check if internal is fully damaged
        const maxInternal = this.unit.as.Str;
        if (this.state.internal() >= maxInternal) return true;
        
        // Check engine hits
        const engineHits = this.state.getCommittedCritHits('engine');
        const engineDestroyThreshold = this.isVessel() ? 3 : 2;
        if (engineHits >= engineDestroyThreshold) return true;
        
        const crewHits = this.state.getCommittedCritHits('crew');
        if (crewHits > 1) return true;
        
        // Check if Thrust reaches 0 (only for units with Th)
        const baseTh = this.unit.as.Th;
        if (baseTh > 0) {
            const effectiveTh = this.calculateEffectiveThrust();
            if (effectiveTh <= 0) return true;
        }
        
        return false;
    });

    /**
     * Calculate effective Thrust after applying Engine and Thruster critical hits.
     * 
     * Engine Hit (Aerospace Fighters, Conventional Fighters, Fixed-Wing Support Vehicles):
     * - 1st hit: -50% of original THR (round down, minimum 1 lost)
     * - 2nd hit: THR = 0
     * 
     * Engine Hit (DropShips/Small Craft):
     * - 1st hit: -25% of original THR (round normally, minimum 1 lost)
     * - 2nd hit: -50% of original THR (round normally, minimum 1 lost)
     * - 3rd hit: THR = 0
     * 
     * Thruster Hit:
     * - -1 THR
     */
    public calculateEffectiveThrust(): number {
        const base = this.unit.as.Th;
        if (base <= 0) return base;
        
        const orderedCrits = this.state.getCommittedCritsOrdered();
        const engineHits = this.state.getCommittedCritHits('engine');
        let current = base;
        let engineHitCount = 0;
        
        for (const crit of orderedCrits) {
            if (current <= 0) break;
            
            switch (crit.key) {
                case 'engine':
                    engineHitCount++;
                    if (this.isVessel()) {
                        if (engineHitCount === engineHits) { // Apply only on the last engine hit with his timestamp
                            if (engineHitCount === 1) {
                                // 1st hit: -25% of original THR (round normally, minimum 1 lost)
                                const reduction = Math.max(1, Math.round(base * 0.25));
                                current = Math.max(0, current - reduction);
                            } else if (engineHitCount === 2) {
                                // 2nd hit: -50% of original THR (round normally, minimum 1 lost)
                                const reduction = Math.max(1, Math.round(base * 0.50));
                                current = Math.max(0, current - reduction);
                            } else if (engineHitCount >= 3) {
                                // 3rd hit: THR = 0 (crash/destroyed)
                                current = 0;
                            }
                        }
                    } else {
                        if (engineHitCount === 1) {
                        const reduction = Math.max(1, Math.ceil(base * 0.5));
                        current = Math.max(0, current - reduction);
                        } else if (engineHitCount >= 2) {
                            current = 0;
                        }
                    }
                    break;
                case 'thruster':
                    // -1 THR per hit (only first hit counts per rules)
                    current = Math.max(0, current - 1);
                    break;
            }
        }
        
        return current;
    }

    /**
     * Get pending crit change for a given key.
     */
    getPendingCritChange(key: string): number {
        return this.state.getPendingCritChange(key);
    }

    /**
     * Get committed crit hits for a given key.
     */
    getCommittedCritHits(key: string): number {
        return this.state.getCommittedCritHits(key);
    }

    /**
     * Set pending damage (will be distributed to armor first, then internal).
     */
    setPendingDamage(totalDamage: number): void {
        this.state.setPendingDamage(totalDamage);
    }

    /**
     * Commit all pending changes.
     */
    commitPending(): void {
        this.state.commit();
        
        // Update destroyed signal based on computed destruction state
        this.state.destroyed.set(this.isDestroyed());
        
        this.force.emitChanged();
    }

    /**
     * Discard all pending changes.
     */
    discardPending(): void {
        this.state.discardPending();
    }

    repairAll(): void {
        this.state.destroyed.set(false);
        this.state.shutdown.set(false);
        this.state.armor.set(0);
        this.state.internal.set(0);
        this.state.heat.set(0);
        this.state.crits.set([]);
        this.state.pendingArmor.set(0);
        this.state.pendingInternal.set(0);
        this.state.pendingHeat.set(0);
        this.state.pendingCrits.set([]);
        this.setModified();
    }

    /**
     * Set pending critical hits by delta.
     * Positive delta = add damage, negative delta = heal.
     */
    setPendingCritHits(key: string, delta: number): void {
        this.state.setPendingCritHits(key, delta);
    }

    setPilotName(name: string | undefined): void {
        this._pilotName.set(name);
        this.setModified();
        this.force.emitChanged();
    }

    setPilotSkill(skill: number): void {
        this._pilotSkill.set(skill);
        this.setModified();
        this.force.emitChanged();
    }

    setPilotAbilities(abilities: AbilitySelection[]): void {
        this._pilotAbilities.set(abilities);
        this.setModified();
        this.force.emitChanged();
    }

    public getPilotSkill = computed<number>(() => {
        return this._pilotSkill();
    });

    public getPilotStats = computed<number>(() => {
        return this._pilotSkill();
    });

    public override update(data: ASSerializedUnit) {
        if (data.alias !== this.alias()) {
        }
        if (data.state) {
            this.state.update(data.state);
        }
    }

    public override serialize(): ASSerializedUnit {
        const stateObj: ASSerializedState = {
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            shutdown: this.state.shutdown(),
            c3Position: this.state.c3Position() ?? undefined,
            heat: [this.state.heat(), this.state.pendingHeat()],
            armor: [this.state.armor(), this.state.pendingArmor()],
            internal: [this.state.internal(), this.state.pendingInternal()],
            crits: [...this.state.crits()],
            pCrits: [...this.state.pendingCrits()],
        };
        const data = {
            id: this.id,
            state: stateObj,
            unit: this.getUnit().name, // Serialize only the name,
            alias: this.alias(),
            skill: this._pilotSkill(),
            abilities: this._pilotAbilities()
        };
        return data;
    }

    protected deserializeState(state: ASSerializedState) {
        this.state.modified.set(typeof state.modified === 'boolean' ? state.modified : false);
        this.state.destroyed.set(typeof state.destroyed === 'boolean' ? state.destroyed : false);
        this.state.shutdown.set(typeof state.shutdown === 'boolean' ? state.shutdown : false);
        
        // Handle new array format for heat/armor/internal
        if (Array.isArray(state.heat)) {
            this.state.heat.set(state.heat[0] ?? 0);
            this.state.pendingHeat.set(state.heat[1] ?? 0);
        } else {
            this.state.heat.set(typeof state.heat === 'number' ? state.heat : 0);
            this.state.pendingHeat.set(0);
        }
        
        if (Array.isArray(state.armor)) {
            this.state.armor.set(state.armor[0] ?? 0);
            this.state.pendingArmor.set(state.armor[1] ?? 0);
        } else {
            this.state.armor.set(typeof state.armor === 'number' ? state.armor : 0);
            this.state.pendingArmor.set(0);
        }
        
        if (Array.isArray(state.internal)) {
            this.state.internal.set(state.internal[0] ?? 0);
            this.state.pendingInternal.set(state.internal[1] ?? 0);
        } else {
            this.state.internal.set(typeof state.internal === 'number' ? state.internal : 0);
            this.state.pendingInternal.set(0);
        }
        
        if (state.crits && Array.isArray(state.crits)) {
            this.state.crits.set([...state.crits]);
        } else {
            this.state.crits.set([]);
        }
        
        if (state.pCrits && Array.isArray(state.pCrits)) {
            this.state.pendingCrits.set([...state.pCrits]);
        } else {
            this.state.pendingCrits.set([]);
        }
        
        if (state.c3Position) {
            this.state.c3Position.set(Sanitizer.sanitize(state.c3Position, C3_POSITION_SCHEMA));
        }
    }

    public static override deserialize(
        data: ASSerializedUnit,
        force: ASForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ASForceUnit {
        const unit = dataService.getUnitByName(data.unit);
        if (!unit) {
            throw new Error(`Unit with name "${data.unit}" not found in dataService`);
        }
        const fu = new ASForceUnit(unit, force, dataService, unitInitializer, injector);
        fu.id = data.id;
        
        if (data.alias !== undefined) {
            fu._pilotName.set(data.alias);
        }
        if (data.skill !== undefined) {
            fu._pilotSkill.set(data.skill);
        }
        if (data.abilities !== undefined) {
            fu._pilotAbilities.set(data.abilities);
        }
        fu.deserializeState(data.state);
        return fu;
    }

    isVessel = computed<boolean>(() => {
        const type = this.unit.as.TP;
        return type === 'DA' || type === 'DS' || type === 'SC' || type === 'WS' || type === 'SS' || type === 'JS';
    });

}
