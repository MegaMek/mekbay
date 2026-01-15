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
import { ASSerializedState, ASSerializedUnit, AS_SERIALIZED_UNIT_SCHEMA } from './force-serialization';
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
     * Set pending heat delta.
     * @param delta Heat delta from committed heat (can be negative to reduce pending)
     */
    setPendingHeat(delta: number): void {
        this.state.pendingHeat.set(delta);
        this.force.emitChanged();
    }

    /**
     * Set pending damage (will be distributed to armor first, then internal).
     */
    setPendingDamage(totalDamage: number): void {
        this.state.setPendingDamage(totalDamage);
        this.force.emitChanged();
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
        this.force.emitChanged();
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
        // Reset consumable and exhausted abilities
        this.state.consumedAbilities.set({});
        this.state.pendingConsumed.set({});
        this.state.exhaustedAbilities.set(new Set());
        this.state.pendingExhausted.set(new Set());
        this.state.pendingRestored.set(new Set());
        this.setModified();
    }

    /**
     * Set pending critical hits by delta.
     * Positive delta = add damage, negative delta = heal.
     */
    setPendingCritHits(key: string, delta: number): void {
        this.state.setPendingCritHits(key, delta);
        this.force.emitChanged();
    }

    /**
     * Set pending consumed delta for an ability.
     * Positive delta = consume more, negative delta = restore.
     */
    setPendingConsumedDelta(abilityKey: string, delta: number): void {
        this.state.setPendingConsumedDelta(abilityKey, delta);
        this.force.emitChanged();
    }

    /**
     * Set an ability as pending exhausted.
     */
    setPendingExhaust(abilityKey: string): void {
        this.state.setPendingExhaust(abilityKey);
        this.force.emitChanged();
    }

    /**
     * Set an ability as pending restored from exhausted.
     */
    setPendingRestore(abilityKey: string): void {
        this.state.setPendingRestore(abilityKey);
        this.force.emitChanged();
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
        // Update pilot name/alias
        if (data.alias !== this.alias()) {
            this._pilotName.set(data.alias);
        }
        // Update pilot skill
        if (data.skill !== undefined && data.skill !== this._pilotSkill()) {
            this._pilotSkill.set(data.skill);
        }
        // Update pilot abilities
        if (data.abilities !== undefined) {
            this._pilotAbilities.set(data.abilities);
        }
        // Update state (includes pending)
        if (data.state) {
            this.state.update(data.state);
        }
    }

    public override serialize(): ASSerializedUnit {
        // Build consumed map with [committed, pending] format
        const consumed: Record<string, [number, number]> = {};
        for (const [key, value] of Object.entries(this.state.consumedAbilities())) {
            const pending = this.state.pendingConsumed()[key] ?? 0;
            consumed[key] = [value, pending];
        }
        // Add pending-only entries
        for (const [key, value] of Object.entries(this.state.pendingConsumed())) {
            if (!consumed[key]) {
                consumed[key] = [0, value];
            }
        }
        
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
            consumed: Object.keys(consumed).length > 0 ? consumed : undefined,
            exhausted: (this.state.exhaustedAbilities().size > 0 || 
                       this.state.pendingExhausted().size > 0 || 
                       this.state.pendingRestored().size > 0) 
                ? [
                    [...this.state.exhaustedAbilities()],
                    [...this.state.pendingExhausted()],
                    [...this.state.pendingRestored()]
                  ] 
                : undefined,
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
        // State is already sanitized by AS_SERIALIZED_STATE_SCHEMA via AS_SERIALIZED_UNIT_SCHEMA
        this.state.modified.set(state.modified);
        this.state.destroyed.set(state.destroyed);
        this.state.shutdown.set(state.shutdown);
        
        // Heat/armor/internal are already validated as [number, number] tuples
        this.state.heat.set(state.heat[0]);
        this.state.pendingHeat.set(state.heat[1]);
        
        this.state.armor.set(state.armor[0]);
        this.state.pendingArmor.set(state.armor[1]);
        
        this.state.internal.set(state.internal[0]);
        this.state.pendingInternal.set(state.internal[1]);
        
        // Crits are already validated arrays
        this.state.crits.set([...state.crits]);
        this.state.pendingCrits.set([...state.pCrits]);
        
        // Handle consumed abilities
        if (state.consumed) {
            const consumed: Record<string, number> = {};
            const pending: Record<string, number> = {};
            for (const [key, value] of Object.entries(state.consumed)) {
                if (value[0]) consumed[key] = value[0];
                if (value[1]) pending[key] = value[1];
            }
            this.state.consumedAbilities.set(consumed);
            this.state.pendingConsumed.set(pending);
        }
        
        // Handle exhausted abilities
        if (state.exhausted) {
            this.state.exhaustedAbilities.set(new Set(state.exhausted[0]));
            this.state.pendingExhausted.set(new Set(state.exhausted[1]));
            this.state.pendingRestored.set(new Set(state.exhausted[2]));
        }
        
        if (state.c3Position) {
            this.state.c3Position.set(state.c3Position);
        }
    }

    public static override deserialize(
        data: ASSerializedUnit,
        force: ASForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ASForceUnit {
        // Sanitize the input data using the schema
        const sanitizedData = Sanitizer.sanitize(data, AS_SERIALIZED_UNIT_SCHEMA);
        
        const unit = dataService.getUnitByName(sanitizedData.unit);
        if (!unit) {
            throw new Error(`Unit with name "${sanitizedData.unit}" not found in dataService`);
        }
        const fu = new ASForceUnit(unit, force, dataService, unitInitializer, injector);
        fu.id = sanitizedData.id;
        
        if (sanitizedData.alias !== undefined) {
            fu._pilotName.set(sanitizedData.alias);
        }
        if (sanitizedData.skill !== undefined) {
            fu._pilotSkill.set(sanitizedData.skill);
        }
        if (sanitizedData.abilities !== undefined) {
            fu._pilotAbilities.set(sanitizedData.abilities);
        }
        fu.deserializeState(sanitizedData.state);
        return fu;
    }

    isVessel = computed<boolean>(() => {
        const type = this.unit.as.TP;
        return type === 'DA' || type === 'DS' || type === 'SC' || type === 'WS' || type === 'SS' || type === 'JS';
    });

    isVehicle = computed<boolean>(() => {
        const type = this.unit.as.TP;
        return type === 'CV' || type === 'SV';
    });

    // ===== Movement & TMM Calculations =====

    /**
     * Get effective movement values in inches after applying crits and heat.
     */
    effectiveMovement = computed<{ [mode: string]: number }>(() => {
        const mvm = this.unit.as.MVm;
        if (!mvm) return {};

        const heat = this.state.heat();
        const heatReduction = heat * 2;
        const mpHits = this.state.getCommittedCritHits('mp');
        const mvByMode: { [mode: string]: number } = {};

        const entries = Object.entries(mvm);
        if (entries.length === 1) {
            // Single movement, if is "j", we create a ground entry as well "" with same value
            const [mode, inches] = entries[0];
            if (mode === 'j') {
                entries.unshift(['', inches]);
            }
        }

        for (const [mode, inches] of entries) {
            if (typeof inches !== 'number' || inches <= 0) continue;

            let reducedInches: number;
            if (this.isVehicle()) {
                reducedInches = this.applyVehicleMotiveReduction(inches);
            } else {
                reducedInches = this.applyMpHitsReduction(inches, mpHits);
            }
            // Apply heat reduction only to ground movement (not 'j')
            if (mode !== 'j') {
                reducedInches = Math.max(0, reducedInches - heatReduction);
            }
            mvByMode[mode] = reducedInches;
        }

        if (Object.keys(mvByMode).length === 0) return {};

        // Build result with '' always first
        const result: { [mode: string]: number } = {};
        if ('' in mvByMode) {
            result[''] = mvByMode[''];
        }
        for (const [mode, mv] of Object.entries(mvByMode)) {
            if (mode !== '') {
                result[mode] = mv;
            }
        }
        return result;
    });

    isShutdown = computed<boolean>(() => {
        const heat = this.getState().heat();
        return heat >= 4;
    });

    /**
     * Check if unit is immobilized (all movement values are 0 or shutdown).
     */
    isImmobilized = computed<boolean>(() => {
        if (this.isShutdown()) {
            return true;
        }
        const movement = this.effectiveMovement();
        const entries = Object.entries(movement);
        if (entries.length === 0) return false;

        return entries.every(([, inches]) => inches <= 0);
    });

    /**
     * Get effective TMM values after applying crits and heat.
     * Returns { [mode: string]: number }
     * Modes with the same TMM are merged (e.g., if ground and jump have same TMM, only '' is returned).
     */
    effectiveTmm = computed<{ [mode: string]: number }>(() => {
        // Immobilized units have TMM of -4
        if (this.isImmobilized()) {
            return { '': -4 };
        }

        const stats = this.unit.as;
        const mvm = stats.MVm;
        if (!mvm) return {};

        const entries = Object.entries(mvm);
        if (entries.length === 0) return {};

        if (entries.length === 1) {
            // Single movement, if is "j", we create a ground entry as well "" with same value
            const [mode, inches] = entries[0];
            if (mode === 'j') {
                entries.unshift(['', inches]);
            }
        }

        // Get jump/sub TMM modifiers from specials
        // OBSOLETE: we calculate the TMM from calculateBaseTMMFromInches which would include those modifiers alreadyy.
        // const jumpMod = this.getSignedSpecialModifier(stats.specials, 'JMPS', 'JMPW');
        // const subMod = this.getSignedSpecialModifier(stats.specials, 'SUBS', 'SUBW');

        // Calculate TMM penalty from crits
        let tmmPenalty: number;
        if (this.isVehicle()) {
            tmmPenalty = this.calculateVehicleTmmPenalty();
        } else {
            tmmPenalty = this.state.getCommittedCritHits('mp');
        }

        // Apply heat TMM penalty: -1 at heat level 2+ (only for ground movement)
        const heat = this.state.heat();
        const heatTmmPenalty = heat >= 2 ? 1 : 0;

        // Calculate TMM for each movement mode
        const tmmByMode: { [mode: string]: number } = {};

        for (const [mode, inches] of entries) {
            if (typeof inches !== 'number' || inches <= 0) continue;

            const baseTmm = this.calculateBaseTMMFromInches(inches);

            // Apply mode-specific modifiers
            let modifier = 0;
            // if (mode === 'j' && jumpMod !== null) {
            //     modifier = jumpMod;
            // } else if (mode === 's' && subMod !== null) {
            //     modifier = subMod;
            // }

            // Heat penalty applies to ground movement only (not 'j')
            const heatPenalty = mode === 'j' ? 0 : heatTmmPenalty;

            const effectiveTmm = Math.max(0, baseTmm + modifier - tmmPenalty - heatPenalty);
            tmmByMode[mode] = effectiveTmm;
        }

        if (Object.keys(tmmByMode).length === 0) return {};

        // Get base (ground) TMM - prefer '' key, otherwise use the first available mode
        const groundTmm = tmmByMode[''];

        // Build result with '' always first, merging modes with same TMM as ground
        const result: { [mode: string]: number } = {};
        if (groundTmm !== undefined) {
            result[''] = groundTmm;
        }
        for (const [mode, tmm] of Object.entries(tmmByMode)) {
            // Skip '' (already added) and modes with same TMM as ground
            if (mode === '' || tmm === groundTmm) continue;
            result[mode] = tmm;
        }

        return result;
    });

    /**
     * Applies MP hit reduction to movement.
     * Each hit halves movement (rounded down), but always reduces by at least 2".
     */
    private applyMpHitsReduction(inches: number, mpHits: number): number {
        let current = inches;
        for (let i = 0; i < mpHits && current > 0; i++) {
            const halved = Math.floor(current / 2);
            const reduction = Math.max(2, current - halved);
            current = Math.max(0, current - reduction);
        }
        return current;
    }

    /**
     * Apply vehicle motive critical hits to movement value.
     */
    private applyVehicleMotiveReduction(baseInches: number): number {
        const orderedCrits = this.state.getCommittedCritsOrdered();
        let current = baseInches;

        for (const crit of orderedCrits) {
            if (current <= 0) break;

            switch (crit.key) {
                case 'motive1':
                    current = Math.max(0, current - 2);
                    break;
                case 'engine':
                case 'motive2': {
                    let newCurrent = Math.floor(current / 2);
                    if (newCurrent > 0 && (current - newCurrent) < 2) {
                        newCurrent = Math.max(0, current - 2);
                    }
                    current = newCurrent;
                    break;
                }
                case 'motive3':
                    current = 0;
                    break;
            }
        }
        return current;
    }

    /**
     * Calculate total TMM penalty from vehicle motive critical hits.
     */
    private calculateVehicleTmmPenalty(): number {
        const orderedCrits = this.state.getCommittedCritsOrdered();
        const baseTmm = this.unit.as.TMM ?? 0;
        let currentTmm = baseTmm;

        for (const crit of orderedCrits) {
            switch (crit.key) {
                case 'motive1':
                    currentTmm = Math.max(0, currentTmm - 1);
                    break;
                case 'engine':
                case 'motive2': {
                    let newTmm = Math.floor(currentTmm / 2);
                    if (newTmm > 0 && newTmm >= currentTmm) {
                        newTmm = Math.max(0, currentTmm - 1);
                    }
                    currentTmm = newTmm;
                    break;
                }
            }
        }
        return baseTmm - currentTmm;
    }

    /**
     * Calculate base TMM from movement in inches (undamaged unit starting values).
     */
    private calculateBaseTMMFromInches(inches: number): number {
        // Alpha Strike TMM ranges
        if (inches <= 4) return 0;
        if (inches <= 8) return 1;
        if (inches <= 12) return 2;
        if (inches <= 18) return 3;
        if (inches <= 34) return 4;
        return 5;
    }

    // ===== Damage Calculations =====

    /**
     * Get effective Short range damage after applying crits.
     */
    effectiveDamageS = computed<string>(() => {
        const base = this.unit.as.dmg.dmgS;
        return this.calculateReducedDamage(base);
    });

    /**
     * Get effective Medium range damage after applying crits.
     */
    effectiveDamageM = computed<string>(() => {
        const base = this.unit.as.dmg.dmgM;
        return this.calculateReducedDamage(base);
    });

    /**
     * Get effective Long range damage after applying crits.
     */
    effectiveDamageL = computed<string>(() => {
        const base = this.unit.as.dmg.dmgL;
        return this.calculateReducedDamage(base);
    });

    /**
     * Get effective Extreme range damage after applying crits.
     */
    effectiveDamageE = computed<string>(() => {
        const base = this.unit.as.dmg.dmgE;
        return this.calculateReducedDamage(base);
    });

    /**
     * Check if all damage values are at minimum (0 or '-').
     * Used to determine if a weapon critical hit would have any effect.
     */
    isAllDamageAtMinimum = computed<boolean>(() => {
        const dmgS = this.effectiveDamageS();
        const dmgM = this.effectiveDamageM();
        const dmgL = this.effectiveDamageL();
        const dmgE = this.effectiveDamageE();
        
        return this.isDamageAtMinimum(dmgS) &&
               this.isDamageAtMinimum(dmgM) &&
               this.isDamageAtMinimum(dmgL) &&
               this.isDamageAtMinimum(dmgE);
    });

    /**
     * Check if a single damage value is at minimum (0 or '-').
     */
    private isDamageAtMinimum(value: string): boolean {
        return value === '0' || value === '-' || value === '';
    }

    /**
     * Calculate reduced damage after applying critical hit effects.
     * 
     * For vehicles (order matters):
     *   1. Engine Hit: 50% reduction (floor, min 0)
     *   2. Weapon Hits: -1 per hit
     * 
     * For non-vehicles:
     *   - Weapon Hits: -1 per hit using position scale (9 8 7 6 5 4 3 2 1 0* 0)
     */
    private calculateReducedDamage(base: string): string {
        if (this.isVehicle()) {
            return this.calculateVehicleDamageReduction(base);
        }
        const weaponHits = this.state.getCommittedCritHits('weapons');
        return this.reduceDamageValue(base, weaponHits);
    }

    /**
     * Vehicle damage reduction using ordered crits:
     *   - Engine hit: 50% of current damage value (floor, min 0)
     *   - Weapon hit: -1 per hit using position scale (1→0*→0)
     * Order matters - effects are applied sequentially.
     */
    private calculateVehicleDamageReduction(base: string): string {
        // Handle special cases
        if (base === '-' || base === '') return base;

        // Track as string to handle 0* properly
        let current = base;

        // Process crits in order
        const orderedCrits = this.state.getCommittedCritsOrdered();

        for (const crit of orderedCrits) {
            if (current === '0') break; // Already at minimum

            switch (crit.key) {
                case 'engine':
                    // Engine hit: 50% reduction (convert to number, reduce, convert back)
                    current = this.applyEngineHitToValue(current);
                    break;
                case 'weapons':
                    // Weapon hit: use position scale (1→0*→0)
                    current = this.reduceDamageValue(current, 1);
                    break;
            }
        }

        return current;
    }

    /**
     * Apply engine hit reduction (50%, floor) to a single damage value.
     * Handles 0* specially: 0* → 0
     */
    private applyEngineHitToValue(value: string): string {
        if (value === '0' || value === '-' || value === '') return value;
        if (value === '0*') return '0';
        
        const numericValue = parseInt(value, 10);
        if (isNaN(numericValue) || numericValue < 0) return value;
        
        const reduced = Math.floor(numericValue / 2);
        return reduced.toString();
    }

    /**
     * Reduce a single damage value by weapon hits.
     * Uses damage scale: 9 8 7 6 5 4 3 2 1 0* 0
     * Non-numeric values (like '-') are returned unchanged.
     */
    private reduceDamageValue(value: string, weaponHits: number): string {
        value = value.trim();
        
        // Handle special values
        if (value === '-' || value === '') return value;
        if (value === '0*') {
            // 0* is at position 1 in the scale (0=0, 1=0*)
            // After weaponHits reductions, if position <= 0, return '0'
            const newPosition = Math.max(0, 1 - weaponHits);
            return newPosition === 0 ? '0' : '0*';
        }
        if (value === '0') return '0'; // Already at minimum
        
        // Parse numeric value
        const numericValue = parseInt(value, 10);
        if (isNaN(numericValue) || numericValue < 0) {
            // Non-numeric, return as-is
            return value;
        }
        
        // Position in sequence: value + 1 (so 1 -> position 2, 9 -> position 10)
        const position = numericValue + 1;
        const newPosition = Math.max(0, position - weaponHits);
        
        // Convert back to string
        if (newPosition === 0) return '0';
        if (newPosition === 1) return '0*';
        return (newPosition - 1).toString();
    }
}