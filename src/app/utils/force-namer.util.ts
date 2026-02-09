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

import { ForceUnit } from '../models/force-unit.model';
import { Faction, FACTION_EXTINCT, FACTION_MERCENARY } from '../models/factions.model';
import { Era } from '../models/eras.model';
import {
    MIDDLE_WORD_MERCENARY, END_WORD_MERCENARY,
    MIDDLE_WORD_CORPORATE, END_WORD_CORPORATE,
    PRE_FAB,
} from './force-name-words.data';

/*
 * Author: Drake
 *
 * Force-level naming: faction analysis + name generation from word lists.
 * Adapted from MekHQ's RandomCompanyNameGenerator / BackgroundsController.
 *
 * Formation (group-level) naming lives in formation-namer.util.ts.
 * ForceType / getForceType lives in force-type.util.ts.
 */

// ─── Public Types ──────────────────────────────────────────────────────────────

/** Display info for a faction in the faction selector. */
export interface FactionDisplayInfo {
    faction: Faction;
    /** Match percentage (0–1) based on the force's unit composition, or 0 if not matching. */
    matchPercentage: number;
    /** True if the faction is among the composition-matching factions. */
    isMatching: boolean;
    /** Per-era availability data for this faction. */
    eraAvailability: { era: Era; isAvailable: boolean }[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MIN_UNITS_PERCENTAGE = 0.7;

/** Factions that get corporate-flavored names (e.g. "ComStar Apex Solutions"). */
const CORPORATE_FACTIONS = new Set(['ComStar', 'Word of Blake']);

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/** Pick a random element from an array. */
function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick a random word from `arr` that doesn't overlap with words already in
 * `existing` (avoids names like "Storm Stormriders"). Falls back to any
 * element after 20 attempts.
 */
function pickUnique(arr: readonly string[], existing: string): string {
    for (let i = 0; i < 20; i++) {
        const candidate = pick(arr);
        const checkLen = Math.max(candidate.length - 2, 2);
        if (!existing.includes(candidate.substring(0, checkLen))) {
            return candidate;
        }
    }
    return pick(arr);
}

/** Generate a random ordinal string (1st-30th). */
function randomOrdinal(): string {
    const n = Math.floor(Math.random() * 30) + 1;
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (mod10 === 1) return `${n}st`;
    if (mod10 === 2) return `${n}nd`;
    if (mod10 === 3) return `${n}rd`;
    return `${n}th`;
}

// ─── Name Body Generators ──────────────────────────────────────────────────────

/**
 * Mercenary-style name (no faction prefix).
 *
 *   0: "The {ordinal} {middle} {end}"  - "The 7th Iron Dragoons"
 *   1: "The {middle} {end}"            - "The Shadow Wolves"
 *   2: "{middle} {end}"                - "Phantom Lancers"
 *   3: Pre-fab name                    - "Misfire Misfits"
 */
function generateMercenaryName(): string {
    const roll = Math.floor(Math.random() * 4);
    switch (roll) {
        case 0: {
            const ord = randomOrdinal();
            const mid = pick(MIDDLE_WORD_MERCENARY);
            const end = pickUnique(END_WORD_MERCENARY, mid);
            return `The ${ord} ${mid} ${end}`;
        }
        case 1: {
            const mid = pick(MIDDLE_WORD_MERCENARY);
            const end = pickUnique(END_WORD_MERCENARY, mid);
            return `The ${mid} ${end}`;
        }
        case 2: {
            const mid = pick(MIDDLE_WORD_MERCENARY);
            const end = pickUnique(END_WORD_MERCENARY, mid);
            return `${mid} ${end}`;
        }
        case 3:
        default:
            return pick(PRE_FAB);
    }
}

/**
 * Corporate-style name for ComStar / Word of Blake.
 *
 *   0: "{faction} {midCorp} {endCorp}"   - "ComStar Apex Solutions"
 *   1: "{faction} {endCorp}"             - "Word of Blake Technologies"
 */
function generateCorporateName(factionName: string): string {
    if (Math.random() < 0.5) {
        const mid = pick(MIDDLE_WORD_CORPORATE);
        const end = pickUnique(END_WORD_CORPORATE, `${factionName} ${mid}`);
        return `${factionName} ${mid} ${end}`;
    }
    return `${factionName} ${pick(END_WORD_CORPORATE)}`;
}

/**
 * Faction military name.
 *
 *   0: "{ordinal} {faction} {end}"       - "3rd Steiner Lancers"
 *   1: "{faction} {middle} {end}"        - "Davion Iron Hussars"
 *   2: "{faction} {end}"                 - "Kurita Dragoons"
 *   3: "The {ordinal} {faction} {end}"   - "The 5th Liao Cavaliers"
 */
function generateFactionMilitaryName(factionName: string): string {
    const roll = Math.floor(Math.random() * 4);
    switch (roll) {
        case 0: {
            const ord = randomOrdinal();
            const end = pick(END_WORD_MERCENARY);
            return `${ord} ${factionName} ${end}`;
        }
        case 1: {
            const mid = pick(MIDDLE_WORD_MERCENARY);
            const end = pickUnique(END_WORD_MERCENARY, `${factionName} ${mid}`);
            return `${factionName} ${mid} ${end}`;
        }
        case 2: {
            const end = pick(END_WORD_MERCENARY);
            return `${factionName} ${end}`;
        }
        case 3:
        default: {
            const ord = randomOrdinal();
            const end = pick(END_WORD_MERCENARY);
            return `The ${ord} ${factionName} ${end}`;
        }
    }
}

// ─── Main Utility Class ────────────────────────────────────────────────────────

export class ForceNamerUtil {

    // ── Faction Analysis ────────────────────────────────────────────────────

    /**
     * Returns matching factions for a set of units (factions where ≥70% of units belong).
     * Map key is the faction name, value is the highest match percentage across eras.
     */
    public static getAvailableFactions(units: ForceUnit[], factions: Faction[], eras: Era[]): Map<string, number> | null {
        if (!units?.length) return null;
        const referenceYear = units.reduce(
            (max, u) => Math.max(max, u.getUnit().year),
            Number.NEGATIVE_INFINITY
        );
        const erasInOrAfter = eras.filter(e => referenceYear <= (e.years.to ?? Number.POSITIVE_INFINITY));
        if (erasInOrAfter.length === 0) return null;

        const unitIds = units.map(u => u.getUnit().id);
        const totalUnits = units.length;
        const results: Map<string, number> = new Map();

        for (const faction of factions) {
            if (faction.id === FACTION_EXTINCT) continue;
            let highestPercentage = 0;
            for (const era of erasInOrAfter) {
                const eraUnitIds = faction.eras[era.id];
                if (!eraUnitIds) continue;
                let count = 0;
                for (const id of unitIds) {
                    if (eraUnitIds.has(id)) count++;
                }
                if (count > 0) {
                    highestPercentage = Math.max(highestPercentage, count / totalUnits);
                }
            }
            if (highestPercentage >= MIN_UNITS_PERCENTAGE) {
                results.set(faction.name, highestPercentage);
            }
        }
        return results;
    }

    /**
     * Returns a random faction from the matching factions, weighted by match percentage.
     * Falls back to FACTION_MERCENARY when no composition matches exist.
     * Returns null only if the factions array itself is empty.
     */
    public static pickRandomFaction(units: ForceUnit[], factions: Faction[], eras: Era[]): Faction | null {
        const mercenary = factions.find(f => f.id === FACTION_MERCENARY) ?? null;
        const availableFactions = this.getAvailableFactions(units, factions, eras);
        if (!availableFactions || availableFactions.size === 0) return mercenary;

        const entries = Array.from(availableFactions.entries());
        if (entries.length === 1) {
            return factions.find(f => f.name === entries[0][0]) ?? null;
        }

        // Weighted random selection
        const totalWeight = entries.reduce((sum, [, pct]) => sum + pct, 0);
        const random = Math.random() * totalWeight;
        let cumulative = 0;
        for (const [name, pct] of entries) {
            cumulative += pct;
            if (random <= cumulative) {
                return factions.find(f => f.name === name) ?? null;
            }
        }
        return factions.find(f => f.name === entries[entries.length - 1][0]) ?? null;
    }

    /**
     * Build the sorted faction display list for the faction selector.
     * Order: matching factions (sorted by percentage desc) → remaining factions (alpha).
     * Excludes FACTION_EXTINCT.
     */
    public static buildFactionDisplayList(
        units: ForceUnit[],
        allFactions: Faction[],
        eras: Era[]
    ): FactionDisplayInfo[] {
        const matchMap = this.getAvailableFactions(units, allFactions, eras);
        const result: FactionDisplayInfo[] = [];

        for (const faction of allFactions) {
            if (faction.id === FACTION_EXTINCT) continue;
            const matchPct = matchMap?.get(faction.name) ?? 0;
            result.push({
                faction,
                matchPercentage: matchPct,
                isMatching: matchPct > 0,
                eraAvailability: eras.map(era => ({
                    era,
                    isAvailable: faction.eras[era.id] != null && (faction.eras[era.id] as Set<number>).size > 0
                }))
            });
        }

        result.sort((a, b) => {
            if (a.isMatching && !b.isMatching) return -1;
            if (!a.isMatching && b.isMatching) return 1;
            if (a.isMatching && b.isMatching) return b.matchPercentage - a.matchPercentage;
            return a.faction.name.localeCompare(b.faction.name);
        });

        return result;
    }

    // ── Tech Base ───────────────────────────────────────────────────────────

    /** Determine the majority tech base of a set of units. */
    static getTechBase(units: ForceUnit[]): string {
        const counts: Record<string, number> = {};
        for (const unit of units) {
            const tb = unit.getUnit().techBase;
            if (tb === 'Mixed') {
                counts['Clan'] = (counts['Clan'] || 0) + 1;
                counts['Inner Sphere'] = (counts['Inner Sphere'] || 0) + 1;
            } else {
                counts[tb] = (counts[tb] || 0) + 1;
            }
        }
        let majority = 'Inner Sphere';
        let max = 0;
        for (const [tb, count] of Object.entries(counts)) {
            if (count > max) { majority = tb; max = count; }
        }
        return majority;
    }

    // ── Force Name Generation ───────────────────────────────────────────────

    /**
     * Generate a force name.
     *
     * If a faction is provided, uses it directly. Otherwise picks one
     * randomly from composition matches (falls back to Mercenary).
     *
     * Name patterns are chosen by faction type:
     *   - Mercenary → mercenary-company name (no faction prefix)
     *   - Corporate (ComStar, WoB) → corporate-style name
     *   - Other factions → military force name with faction prefix
     *
     * Word lists adapted from MekHQ's RandomCompanyNameGenerator.
     */
    static generateForceName(units: ForceUnit[], faction: Faction | null, factions: Faction[], eras: Era[]): string {
        if (!units || units.length === 0) return 'Unnamed Force';
        const resolved = faction ?? this.pickRandomFaction(units, factions, eras);
        return this.generateForceNameForFaction(resolved);
    }

    /**
     * Generate a force name for a specific faction.
     * Dispatches to the appropriate naming pattern based on faction type.
     */
    static generateForceNameForFaction(faction: Faction | null): string {
        if (!faction || faction.id === FACTION_MERCENARY) {
            return generateMercenaryName();
        }
        if (CORPORATE_FACTIONS.has(faction.name)) {
            return generateCorporateName(faction.name);
        }
        return generateFactionMilitaryName(faction.name);
    }
}