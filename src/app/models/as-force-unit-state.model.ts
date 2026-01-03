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

import { computed, signal } from '@angular/core';
import { ForceUnitState } from './force-unit-state.model';
import { ASForceUnit } from './as-force-unit.model';
import { ASSerializedState, ASCriticalHit, C3_POSITION_SCHEMA, AS_SERIALIZED_STATE_SCHEMA } from './force-serialization';
import { Sanitizer } from '../utils/sanitizer.util';

/*
 * Author: Drake
 * 
 * State model for Alpha Strike force units.
 * Uses timestamp-based critical hit tracking for proper effect ordering.
 * Pending state uses delta system (0 = no change).
 */
export class ASForceUnitState extends ForceUnitState {
    declare unit: ASForceUnit;

    // Committed state
    public heat = signal<number>(0);
    public armor = signal<number>(0);
    public internal = signal<number>(0);
    /** Committed critical hits with timestamps for effect ordering */
    public crits = signal<ASCriticalHit[]>([]);
    /** Committed consumed counts per ability (key = ability originalText) */
    public consumedAbilities = signal<Record<string, number>>({});
    /** Committed exhausted abilities (ability originalText values) */
    public exhaustedAbilities = signal<Set<string>>(new Set());

    // Pending state (uncommitted changes) - all use delta system (0 = no change)
    public pendingHeat = signal<number>(0);
    public pendingArmor = signal<number>(0);
    public pendingInternal = signal<number>(0);
    /** Pending critical hits - positive timestamp = damage, negative timestamp = heal */
    public pendingCrits = signal<ASCriticalHit[]>([]);
    /** Pending consumed delta per ability (positive = consume more, negative = restore) */
    public pendingConsumed = signal<Record<string, number>>({});
    /** Pending abilities to exhaust */
    public pendingExhausted = signal<Set<string>>(new Set());
    /** Pending abilities to restore from exhausted */
    public pendingRestored = signal<Set<string>>(new Set());

    constructor(unit: ASForceUnit) {
        super(unit);
    }

    /**
     * Check if there are any uncommitted changes.
     */
    isDirty = computed<boolean>(() => {
        if (this.pendingHeat() !== 0) return true;
        if (this.pendingArmor() !== 0) return true;
        if (this.pendingInternal() !== 0) return true;
        if (this.pendingCrits().length > 0) return true;
        if (Object.keys(this.pendingConsumed()).length > 0) return true;
        if (this.pendingExhausted().size > 0) return true;
        if (this.pendingRestored().size > 0) return true;
        return false;
    });

    /**
     * Get the number of committed hits for a specific crit key.
     */
    getCommittedCritHits(key: string): number {
        return this.crits().filter(c => c.key === key).length;
    }

    /**
     * Get the pending change for a specific crit key (positive = damage, negative = heal).
     */
    getPendingCritChange(key: string): number {
        const pending = this.pendingCrits().filter(c => c.key === key);
        let change = 0;
        for (const p of pending) {
            change += p.timestamp > 0 ? 1 : -1;
        }
        return change;
    }


    /**
     * Set pending crit hits by delta count.
     * Positive delta = add damage hits, negative delta = add heal hits.
     */
    setPendingCritHits(key: string, delta: number): void {
        // Clear existing pending for this key
        const pending = this.pendingCrits().filter(c => c.key !== key);
        
        if (delta > 0) {
            // Add damage hits
            for (let i = 0; i < delta; i++) {
                pending.push({ key, timestamp: Date.now() + i });
            }
        } else if (delta < 0) {
            // Add heal hits (negative timestamp)
            for (let i = 0; i < -delta; i++) {
                pending.push({ key, timestamp: -(Date.now() + i) });
            }
        }
        
        this.pendingCrits.set(pending);
    }

    /**
     * Get all committed critical hits sorted by timestamp.
     * Used for applying effects in order.
     */
    getCommittedCritsOrdered(): ASCriticalHit[] {
        const committed = [...this.crits()];
        // Sort by absolute timestamp
        return committed.sort((a, b) => Math.abs(a.timestamp) - Math.abs(b.timestamp));
    }

    /**
     * Set pending armor/internal damage.
     * totalDamage is the total damage to distribute across armor and internal.
     */
    setPendingDamage(totalDamage: number): void {
        const maxArmor = this.unit.getUnit().as.Arm;
        const maxInternal = this.unit.getUnit().as.Str;
        const committedArmor = this.armor();
        const committedInternal = this.internal();

        // Clamp totalDamage to valid range
        const minDamage = -(committedArmor + committedInternal);
        const maxDamage = (maxArmor - committedArmor) + (maxInternal - committedInternal);
        totalDamage = Math.max(minDamage, Math.min(maxDamage, totalDamage));

        if (totalDamage >= 0) {
            // Adding damage: first to armor, then to internal
            const armorRemaining = maxArmor - committedArmor;
            const armorDamage = Math.min(totalDamage, armorRemaining);
            const internalDamage = totalDamage - armorDamage;
            this.pendingArmor.set(armorDamage);
            this.pendingInternal.set(internalDamage);
        } else {
            // Removing damage (healing): first from internal, then from armor
            const totalHeal = -totalDamage;
            const internalHeal = Math.min(totalHeal, committedInternal + this.pendingInternal());
            const armorHeal = totalHeal - internalHeal;
            this.pendingInternal.set(-internalHeal);
            this.pendingArmor.set(-armorHeal);
        }
    }

    // ===== Consumable Ability Methods =====

    /**
     * Get the committed consumed count for an ability.
     */
    getConsumedCount(abilityKey: string): number {
        return this.consumedAbilities()[abilityKey] ?? 0;
    }

    /**
     * Get the pending consumed delta for an ability.
     */
    getPendingConsumedDelta(abilityKey: string): number {
        return this.pendingConsumed()[abilityKey] ?? 0;
    }

    /**
     * Get the effective consumed count (committed + pending).
     */
    getEffectiveConsumedCount(abilityKey: string): number {
        return this.getConsumedCount(abilityKey) + this.getPendingConsumedDelta(abilityKey);
    }

    /**
     * Set pending consumed delta for an ability.
     */
    setPendingConsumedDelta(abilityKey: string, delta: number): void {
        const pending = { ...this.pendingConsumed() };
        if (delta === 0) {
            delete pending[abilityKey];
        } else {
            pending[abilityKey] = delta;
        }
        this.pendingConsumed.set(pending);
    }

    // ===== Exhausted Ability Methods =====

    /**
     * Check if an ability is committed as exhausted.
     */
    isAbilityExhausted(abilityKey: string): boolean {
        return this.exhaustedAbilities().has(abilityKey);
    }

    /**
     * Check if an ability is effectively exhausted (committed or pending exhaust, not pending restore).
     */
    isAbilityEffectivelyExhausted(abilityKey: string): boolean {
        if (this.pendingRestored().has(abilityKey)) return false;
        if (this.pendingExhausted().has(abilityKey)) return true;
        return this.exhaustedAbilities().has(abilityKey);
    }

    /**
     * Set pending exhaust for an ability.
     */
    setPendingExhaust(abilityKey: string): void {
        // If already exhausted, no-op
        if (this.exhaustedAbilities().has(abilityKey)) return;
        
        // Remove from pending restored if present
        const restored = new Set(this.pendingRestored());
        restored.delete(abilityKey);
        this.pendingRestored.set(restored);
        
        // Add to pending exhausted
        const exhausted = new Set(this.pendingExhausted());
        exhausted.add(abilityKey);
        this.pendingExhausted.set(exhausted);
    }

    /**
     * Set pending restore for an ability.
     */
    setPendingRestore(abilityKey: string): void {
        // If not exhausted (committed or pending), no-op
        if (!this.exhaustedAbilities().has(abilityKey) && !this.pendingExhausted().has(abilityKey)) return;
        
        // Remove from pending exhausted if present
        const exhausted = new Set(this.pendingExhausted());
        exhausted.delete(abilityKey);
        this.pendingExhausted.set(exhausted);
        
        // Add to pending restored only if it's committed exhausted
        if (this.exhaustedAbilities().has(abilityKey)) {
            const restored = new Set(this.pendingRestored());
            restored.add(abilityKey);
            this.pendingRestored.set(restored);
        }
    }

    /**
     * Clear pending exhaust/restore for an ability (cancel pending change).
     */
    clearPendingExhaustState(abilityKey: string): void {
        const exhausted = new Set(this.pendingExhausted());
        exhausted.delete(abilityKey);
        this.pendingExhausted.set(exhausted);
        
        const restored = new Set(this.pendingRestored());
        restored.delete(abilityKey);
        this.pendingRestored.set(restored);
    }

    /**
     * Commit all pending changes to the committed state.
     */
    commit(): void {
        // Commit heat (delta system)
        this.heat.set(Math.max(0, this.heat() + this.pendingHeat()));
        this.pendingHeat.set(0);

        // Commit armor/internal
        this.armor.set(this.armor() + this.pendingArmor());
        this.internal.set(this.internal() + this.pendingInternal());
        this.pendingArmor.set(0);
        this.pendingInternal.set(0);

        // Commit crits
        const committed = [...this.crits()];
        const pending = this.pendingCrits();
        
        // Count pending heals per key
        const healCounts = new Map<string, number>();
        for (const p of pending) {
            if (p.timestamp < 0) {
                healCounts.set(p.key, (healCounts.get(p.key) ?? 0) + 1);
            }
        }
        
        // Remove healed crits (oldest first per key)
        const newCommitted: ASCriticalHit[] = [];
        const keyHealRemaining = new Map(healCounts);
        const sortedCommitted = [...committed].sort((a, b) => a.timestamp - b.timestamp);
        
        for (const crit of sortedCommitted) {
            const remaining = keyHealRemaining.get(crit.key) ?? 0;
            if (remaining > 0) {
                keyHealRemaining.set(crit.key, remaining - 1);
            } else {
                newCommitted.push(crit);
            }
        }
        
        // Add new damage
        for (const p of pending) {
            if (p.timestamp > 0) {
                newCommitted.push({ key: p.key, timestamp: p.timestamp });
            }
        }
        
        this.crits.set(newCommitted);
        this.pendingCrits.set([]);

        // Commit consumables
        const consumables = { ...this.consumedAbilities() };
        for (const [key, delta] of Object.entries(this.pendingConsumed())) {
            const newValue = (consumables[key] ?? 0) + delta;
            if (newValue <= 0) {
                delete consumables[key];
            } else {
                consumables[key] = newValue;
            }
        }
        this.consumedAbilities.set(consumables);
        this.pendingConsumed.set({});

        // Commit exhausted abilities
        const exhausted = new Set(this.exhaustedAbilities());
        for (const key of this.pendingExhausted()) {
            exhausted.add(key);
        }
        for (const key of this.pendingRestored()) {
            exhausted.delete(key);
        }
        this.exhaustedAbilities.set(exhausted);
        this.pendingExhausted.set(new Set());
        this.pendingRestored.set(new Set());

        // Mark as modified
        this.modified.set(true);
    }

    /**
     * Discard all pending changes.
     */
    discardPending(): void {
        this.pendingHeat.set(0);
        this.pendingArmor.set(0);
        this.pendingInternal.set(0);
        this.pendingCrits.set([]);
        this.pendingConsumed.set({});
        this.pendingExhausted.set(new Set());
        this.pendingRestored.set(new Set());
    }

    override update(data: ASSerializedState) {
        // Sanitize the input data using the schema
        const sanitized = Sanitizer.sanitize(data, AS_SERIALIZED_STATE_SCHEMA);
        
        this.modified.set(sanitized.modified);
        this.destroyed.set(sanitized.destroyed);
        this.shutdown.set(sanitized.shutdown);
        
        // Heat/armor/internal are already validated as [number, number] tuples
        this.heat.set(sanitized.heat[0]);
        this.pendingHeat.set(sanitized.heat[1]);
        
        this.armor.set(sanitized.armor[0]);
        this.pendingArmor.set(sanitized.armor[1]);
        
        this.internal.set(sanitized.internal[0]);
        this.pendingInternal.set(sanitized.internal[1]);
        
        // Crits are already validated arrays
        this.crits.set([...sanitized.crits]);
        this.pendingCrits.set([...sanitized.pCrits]);
        
        // Handle consumed abilities
        if (sanitized.consumed) {
            const consumed: Record<string, number> = {};
            const pending: Record<string, number> = {};
            for (const [key, value] of Object.entries(sanitized.consumed)) {
                if (value[0]) consumed[key] = value[0];
                if (value[1]) pending[key] = value[1];
            }
            this.consumedAbilities.set(consumed);
            this.pendingConsumed.set(pending);
        } else {
            this.consumedAbilities.set({});
            this.pendingConsumed.set({});
        }
        
        // Handle exhausted abilities
        if (sanitized.exhausted) {
            this.exhaustedAbilities.set(new Set(sanitized.exhausted[0]));
            this.pendingExhausted.set(new Set(sanitized.exhausted[1]));
            this.pendingRestored.set(new Set(sanitized.exhausted[2]));
        } else {
            this.exhaustedAbilities.set(new Set());
            this.pendingExhausted.set(new Set());
            this.pendingRestored.set(new Set());
        }
        
        if (sanitized.c3Position) {
            this.c3Position.set(sanitized.c3Position);
        }
    }
}
