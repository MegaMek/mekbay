// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, type Signal } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';

/**
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
    /** Effective dissipation including partial-wing cooling when applicable. */
    totalDissipationWithWings?: number;
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
