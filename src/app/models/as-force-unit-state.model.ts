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
import { ASSerializedState, ASCriticalHit, C3_POSITION_SCHEMA } from './force-serialization';
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

    // Pending state (uncommitted changes) - all use delta system (0 = no change)
    public pendingHeat = signal<number>(0);
    public pendingArmor = signal<number>(0);
    public pendingInternal = signal<number>(0);
    /** Pending critical hits - positive timestamp = damage, negative timestamp = heal */
    public pendingCrits = signal<ASCriticalHit[]>([]);

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
        return this.pendingCrits().length > 0;
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
    }

    override update(data: ASSerializedState) {
        this.modified.set(data.modified);
        this.destroyed.set(data.destroyed);
        this.shutdown.set(data.shutdown);
        
        // Handle new array format for heat/armor/internal
        if (Array.isArray(data.heat)) {
            this.heat.set(data.heat[0] ?? 0);
            this.pendingHeat.set(data.heat[1] ?? 0);
        } else {
            this.heat.set(typeof data.heat === 'number' ? data.heat : 0);
            this.pendingHeat.set(0);
        }
        
        if (Array.isArray(data.armor)) {
            this.armor.set(data.armor[0] ?? 0);
            this.pendingArmor.set(data.armor[1] ?? 0);
        } else {
            this.armor.set(typeof data.armor === 'number' ? data.armor : 0);
            this.pendingArmor.set(0);
        }
        
        if (Array.isArray(data.internal)) {
            this.internal.set(data.internal[0] ?? 0);
            this.pendingInternal.set(data.internal[1] ?? 0);
        } else {
            this.internal.set(typeof data.internal === 'number' ? data.internal : 0);
            this.pendingInternal.set(0);
        }
        
        if (data.crits && Array.isArray(data.crits)) {
            this.crits.set([...data.crits]);
        } else {
            this.crits.set([]);
        }
        
        if (data.pCrits && Array.isArray(data.pCrits)) {
            this.pendingCrits.set([...data.pCrits]);
        } else {
            this.pendingCrits.set([]);
        }
        
        if (data.c3Position) {
            this.c3Position.set(Sanitizer.sanitize(data.c3Position, C3_POSITION_SCHEMA));
        }
    }
}
