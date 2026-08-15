// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, type Signal } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { MiscEquipment, type Equipment } from '../equipment.model';
import { getMekLegLocations, inferMekConfigFromLocations } from '../entity/types';

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
    /** Additional dissipation provided by operational heatsinks submerged in water. */
    underwaterBonus?: number;
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

function heatSinkDissipation(equipment: Equipment): number {
    if (!(equipment instanceof MiscEquipment) || !equipment.isHeatSink) return 0;
    return equipment.hasAnyFlag(['F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE', 'F_LASER_HEAT_SINK']) ? 2 : 1;
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
            const dissipation = heatSinkDissipation(comp.eq);
            if (dissipation === 0) continue;
            totalPips += comp.q;
            if (comp.p < 0) {
                // Engine-mounted: each quantity is one heatsink group
                engineHSCount += comp.q;
            } else {
                // Hittable (outside engine): each quantity is one heatsink group
                for (let i = 0; i < comp.q; i++) {
                    hittable.push({ id: comp.id, dissipation });
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
        const mountedById = new Map(this.unit.getInventory().map(entry => [entry.id, entry]));

        const criticalHeatsinks = new Map<string, { dissipation: number; locations: Set<string>; unavailable: boolean }>();
        for (const slot of critSlots) {
            if (!slot.id || !slot.eq) continue;
            const dissipation = heatSinkDissipation(slot.eq);
            if (dissipation === 0) continue;
            const state = criticalHeatsinks.get(slot.id) ?? { dissipation, locations: new Set<string>(), unavailable: false };
            if (slot.loc) state.locations.add(slot.loc);
            state.unavailable ||= !this.unit.isEquipmentOperational(mountedById.get(slot.id) ?? slot);
            criticalHeatsinks.set(slot.id, state);
        }

        const unavailableHeatsinks = Array.from(criticalHeatsinks.values()).filter(state => state.unavailable);
        const damagedCount = unavailableHeatsinks.length;
        const dissipationLost = unavailableHeatsinks.reduce((total, state) => total + state.dissipation, 0);
        const engineDissipation = profile.engineHSCount * profile.engineDissipationPer;
        const hittableDissipation = profile.hittable.reduce((sum, hs) => sum + hs.dissipation, 0);
        const baseDissipation = Math.max(
            0,
            engineDissipation + hittableDissipation - dissipationLost
                - heatsinksOff * profile.engineDissipationPer,
        );

        let underwaterBonus = 0;
        const submerged = this.unit.turnState().submerged();
        const partiallyUnderwater = this.unit.turnState().partiallyUnderwater();
        if (this.unit.getUnit().type === 'Mek' && (submerged || partiallyUnderwater)) {
            if (submerged) {
                // Once the torso is underwater, engine-mounted sinks are submerged too.
                underwaterBonus = Math.min(6, baseDissipation);
            } else {
                const legLocations = new Set<string>(getMekLegLocations(inferMekConfigFromLocations(this.unit.locations?.internal.keys() ?? [])));
                const functioningHeatsinkCount = Math.max(0, profile.totalPips - damagedCount - heatsinksOff);
                const underwaterHeatsinks = Array.from(criticalHeatsinks.values())
                    .filter(state => !state.unavailable && Array.from(state.locations).some(loc => legLocations.has(loc)))
                    .sort((left, right) => right.dissipation - left.dissipation);
                underwaterBonus = Math.min(6, underwaterHeatsinks
                    .slice(0, Math.min(underwaterHeatsinks.length, functioningHeatsinkCount))
                    .reduce((total, state) => total + state.dissipation, 0));
            }
        }

        const totalDissipation = baseDissipation + underwaterBonus;

        return {
            totalPips: profile.totalPips,
            healthyPips: profile.totalPips - damagedCount,
            damagedCount,
            heatsinksOff,
            totalDissipation,
            ...(underwaterBonus > 0 ? { underwaterBonus } : {}),
        };
    });
}
