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

import { computed, type Signal } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';

/**
 * Author: Drake
 * 
 * Shared heat-management logic and data structures for Mek and (Aero) Fighters rules.
 * Composed into those rules classes via the HeatManagement class.
 */

// ── Heat Scale ───────────────────────────────────────────────────────────────

/** A single row of a BattleTech Heat Scale table */
export interface HeatScaleEntry {
    heat: number;
    /** Cumulative MP penalty (negative). Mek only. */
    move?: number;
    /** Cumulative to-hit modifier (positive). */
    fire?: number;
    /** Target number to avoid shutdown (100 = automatic). */
    shutdown?: number;
    /** Target number to avoid ammo explosion. */
    ammoExp?: number;
    /** Target number to avoid random movement. Aero only. */
    randomMovement?: number;
    /** Target number to avoid pilot damage. Aero only. */
    pilotDamage?: number;
}

/**
 * Walk a heat scale and return cumulative move/fire modifiers at a given heat level.
 */
export function getHeatEffects(
    scale: readonly HeatScaleEntry[],
    heat: number,
): { moveModifier: number; fireModifier: number } {
    let moveModifier = 0;
    let fireModifier = 0;
    for (const entry of scale) {
        if (heat < entry.heat) break;
        if (entry.move !== undefined) moveModifier = entry.move;
        if (entry.fire !== undefined) fireModifier = entry.fire;
    }
    return { moveModifier, fireModifier };
}

// ── Dissipation State ────────────────────────────────────────────────────────

/** Base heat-dissipation shape returned by every heat-aware rules class. */
export interface HeatDissipationState {
    /** Total heatsink pips (engine + hittable). */
    totalPips: number;
    /** Healthy (undestroyed) pips. */
    healthyPips: number;
    /** Number of destroyed hittable heatsink groups. */
    damagedCount: number;
    /** User-turned-off heatsinks. */
    heatsinksOff: number;
    /** Effective dissipation after damage & turned-off HS. */
    totalDissipation: number;
}

// ── Heatsink Profile ─────────────────────────────────────────────────────────

interface HSEntry { id: string; dissipation: number }

interface HeatsinkProfile {
    engineHSCount: number;
    engineDissipationPer: number;
    hittable: HSEntry[];
    totalPips: number;
}

// ── HeatManagement ───────────────────────────────────────────────────────────

/**
 * Shared heat-management logic composed into any rules class whose unit
 * type tracks heat (Mek, Aero).
 *
 * Reads the unit data model (`unit.comp`, `engineHS`, `engineHSType`)
 * and crit-slot destruction state to produce reactive dissipation signals.
 */
export class HeatManagement {

    constructor(private unit: CBTForceUnit) {}

    /** Engine + hittable heatsink inventory from unit.comp. */
    readonly heatsinkProfile: Signal<HeatsinkProfile | null> = computed(() => {
        const unit = this.unit.getUnit();
        if (!unit) return null;

        // engineHS is used only for non-Mek units. Meks handle it fully via components (including engine HS, in comp.p=-1)
        const engineHSType = unit.engineHSType ?? '';
        const engineDouble = engineHSType.includes('Double') || engineHSType.includes('Laser');
        const engineDissipationPer = engineDouble ? 2 : 1;
        let engineHSCount = unit.engineHS ?? 0;

        const hittable: HSEntry[] = [];
        let totalPips = engineHSCount;
        for (const comp of unit.comp) {
            if (!comp.eq) continue;
            const isSingle = comp.eq.hasFlag('F_HEAT_SINK');
            const isDouble = comp.eq.hasFlag('F_DOUBLE_HEAT_SINK');
            if (!isSingle && !isDouble) continue;
            totalPips += comp.q;
            if (comp.p < 0) {
                // Engine-mounted: each quantity is one heatsink group
                engineHSCount += comp.q;
            } else {
                // Hittable (outside engine): each quantity is one heatsink group
                for (let i = 0; i < comp.q; i++) {
                    hittable.push({ id: comp.id, dissipation: isDouble ? 2 : 1 });
                }
            }
        }

        return { engineHSCount, engineDissipationPer, hittable, totalPips };
    });

    // ── Base dissipation ─────────────────────────────────────────────────────

    /**
     * Base heat dissipation: engine HS + hittable HS - destroyed - turned-off.
     * Does NOT include unit-type-specific extras (SuperCooledMyomer, partial wings).
     */
    readonly baseDissipation: Signal<HeatDissipationState | null> = computed(() => {
        const profile = this.heatsinkProfile();
        if (!profile) return null;

        const critSlots = this.unit.getCritSlots();
        const heatsinksOff = this.unit.getHeat().heatsinksOff || 0;

        // Count destroyed heatsinks
        const destroyedHSIds = new Set<string>();
        let damagedCount = 0;
        let dissipationLost = 0;
        for (const slot of critSlots) {
            if (!slot.id || !slot.destroyed || !slot.eq) continue;
            if (destroyedHSIds.has(slot.id)) continue; // already counted this slot's destruction
            const isSingle = slot.eq.hasFlag('F_HEAT_SINK');
            const isDouble = slot.eq.hasFlag('F_DOUBLE_HEAT_SINK');
            if (!isSingle && !isDouble) continue; // not a heatsink crit!
            destroyedHSIds.add(slot.id);
            damagedCount++;
            dissipationLost += isDouble ? 2 : 1;
        }

        const engineDissipation = profile.engineHSCount * profile.engineDissipationPer;
        const hittableDissipation = profile.hittable.reduce((sum, hs) => sum + hs.dissipation, 0);
        let totalDissipation = engineDissipation + hittableDissipation - dissipationLost;
        totalDissipation -= heatsinksOff * profile.engineDissipationPer;
        totalDissipation = Math.max(0, totalDissipation);

        return {
            totalPips: profile.totalPips,
            healthyPips: profile.totalPips - damagedCount,
            damagedCount,
            heatsinksOff,
            totalDissipation,
        };
    });
}
