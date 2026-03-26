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

import type { ForceUnit } from '../models/force-unit.model';
import { type MULFaction, MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../models/mulfactions.model';
import type { Era } from '../models/eras.model';
import {
    MIDDLE_WORD_MERCENARY, END_WORD_MERCENARY,
    MIDDLE_WORD_CORPORATE, END_WORD_CORPORATE,
    PRE_FAB,
} from './force-name-words.data';
import { Faction } from '../models/factions.model';

/*
 * Author: Drake
 *
 * Force-level naming: faction analysis + name generation from word lists.
 * Adapted from MekHQ's RandomCompanyNameGenerator / BackgroundsController.
 *
 * Formation (group-level) naming lives in formation-namer.util.ts.
 * ForceType lives in org-definitions.util.ts, solver in org-solver.util.ts.
 */

// ─── Public Types ──────────────────────────────────────────────────────────────

/** Display info for a faction in the faction selector. */
export interface FactionEraDisplayInfo {
    era: Era;
    isAvailable: boolean;
    isBeforeReferenceYear: boolean;
    matchPercentage: number;
}

export interface FactionDisplayInfo {
    faction: Faction;
    /** Best match percentage (0–1) across eras eligible for the latest unit intro year. */
    matchPercentage: number;
    /** True if the faction is among the composition-matching factions for eligible eras. */
    isMatching: boolean;
    /** Per-era availability and match data for this faction. */
    eraAvailability: FactionEraDisplayInfo[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MIN_UNITS_PERCENTAGE = 0.65;

/** Factions that get corporate-flavored names (e.g. "ComStar Apex Solutions"). */
const CORPORATE_FACTIONS = new Set(['SLCOMNET', 'ComStar', 'Word of Blake']);

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

/**
 * Clean a faction name for use in generated force names.
 *  - If name contains parentheses and either "Free Worlds" or "Clan" inside
 *    the parens, keep only the text inside the parentheses.
 *  - Otherwise remove parenthesized text entirely.
 *  - Strip trailing " General".
 */
function cleanFactionNameForGeneration(raw: string): string {
    let name = raw;
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch) {
        const inside = parenMatch[1];
        if (name.includes('Free Worlds') || inside.includes('Clan')) {
            name = inside;
        } else {
            name = name.replace(/\s*\([^)]*\)/, '').trim();
        }
    }
    return name.replace(/ General$/i, '').trim();
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

function getReferenceYear(units: ForceUnit[]): number | null {
    if (!units?.length) return null;
    return units.reduce((max, unit) => Math.max(max, unit.getUnit().year), Number.NEGATIVE_INFINITY);
}

function getEraStartYear(era: Era): number {
    return era.years.from ?? Number.NEGATIVE_INFINITY;
}

function getEraEndYear(era: Era): number {
    return era.years.to ?? Number.POSITIVE_INFINITY;
}

function doesEraContainYear(era: Era, year: number): boolean {
    return getEraStartYear(era) <= year && year <= getEraEndYear(era);
}

function getEligibleEras(eras: Era[], referenceYear: number | null): Era[] {
    if (referenceYear == null) return [];
    return eras.filter(era => getEraEndYear(era) >= referenceYear);
}

function getCandidateEras(eras: Era[], units: ForceUnit[], selectedEra: Era | null = null): Era[] {
    if (selectedEra) return [selectedEra];
    return getEligibleEras(eras, getReferenceYear(units));
}

function getFactionEraUnitIds(faction: Faction, eraId: number): Set<number> | null {
    return faction.eras[eraId] ?? null;
}

function hasFactionEraAvailability(faction: Faction, eraId: number): boolean {
    const eraUnitIds = getFactionEraUnitIds(faction, eraId);
    return !!eraUnitIds && eraUnitIds.size > 0;
}

function getEraMatchPercentage(faction: Faction, eraId: number, unitIds: number[], totalUnits: number): number {
    if (totalUnits === 0) return 0;

    const eraUnitIds = getFactionEraUnitIds(faction, eraId);
    if (!eraUnitIds) return 0;

    let count = 0;
    for (const id of unitIds) {
        if (eraUnitIds.has(id)) count++;
    }
    return count / totalUnits;
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
     * Returns matching factions for a set of units.
     * Map key is the Faction object, value is the best match percentage across eligible eras.
     * @param minPercentage Minimum match threshold (default: MIN_UNITS_PERCENTAGE = 0.7).
     *                      Pass 0 to include all factions with any match.
     */
    public static getAvailableFactions(
        units: ForceUnit[],
        factions: Faction[],
        eras: Era[],
        minPercentage = MIN_UNITS_PERCENTAGE,
        selectedEra: Era | null = null
    ): Map<Faction, number> | null {
        if (!units?.length) return null;
        const eligibleEras = getCandidateEras(eras, units, selectedEra);
        if (eligibleEras.length === 0) return null;

        const unitIds = units.map(u => u.getUnit().id);
        const totalUnits = units.length;
        const results: Map<Faction, number> = new Map();

        for (const faction of factions) {
            if (faction.id === MULFACTION_EXTINCT) continue;
            let bestMatchPercentage = 0;
            for (const era of eligibleEras) {
                bestMatchPercentage = Math.max(
                    bestMatchPercentage,
                    getEraMatchPercentage(faction, era.id, unitIds, totalUnits)
                );
            }

            if (bestMatchPercentage > 0 && bestMatchPercentage >= minPercentage) {
                results.set(faction, bestMatchPercentage);
            }
        }
        return results;
    }

    /**
     * Returns a random faction from the matching factions, weighted by match percentage.
     * Falls back to MULFACTION_MERCENARY when no composition matches exist.
     * Returns null only if the factions array itself is empty.
     */
    public static pickRandomFaction(units: ForceUnit[], factions: Faction[], eras: Era[], selectedEra: Era | null = null): Faction | null {
        const mercenary = factions.find(f => f.id === MULFACTION_MERCENARY) ?? null;
        const availableFactions = this.getAvailableFactions(units, factions, eras, MIN_UNITS_PERCENTAGE, selectedEra);
        if (!availableFactions || availableFactions.size === 0) {
            if (selectedEra) {
                const eraFactions = factions.filter(faction =>
                    faction.id !== MULFACTION_EXTINCT && hasFactionEraAvailability(faction, selectedEra.id)
                );
                if (eraFactions.length > 0) return pick(eraFactions);
                return mercenary && hasFactionEraAvailability(mercenary, selectedEra.id) ? mercenary : null;
            }
            return mercenary;
        }

        const entries = Array.from(availableFactions.entries());
        if (entries.length === 1) return entries[0][0];

        // Weighted random selection
        const totalWeight = entries.reduce((sum, [, pct]) => sum + pct, 0);
        const random = Math.random() * totalWeight;
        let cumulative = 0;
        for (const [faction, pct] of entries) {
            cumulative += pct;
            if (random <= cumulative) return faction;
        }
        return entries[entries.length - 1][0];
    }

    public static pickBestFaction(units: ForceUnit[], factions: Faction[], eras: Era[], currentFaction: Faction | null): Faction | null {
        const mercenary = factions.find(f => f.id === MULFACTION_MERCENARY) ?? null;
        const availableFactions = this.getAvailableFactions(units, factions, eras, MIN_UNITS_PERCENTAGE);
        if (!availableFactions || availableFactions.size === 0) return mercenary;

        // Find the highest match percentage
        const entries = Array.from(availableFactions.entries());
        const bestScore = Math.max(...entries.map(([, pct]) => pct));
        const bestEntries = entries.filter(([, pct]) => pct === bestScore);

        // If the current faction is among the best, keep it
        if (currentFaction && bestEntries.some(([faction]) => faction === currentFaction)) {
            return currentFaction;
        }

        // Pick a random faction from the best ones
        return pick(bestEntries)[0];
    }

    /**
     * Build the sorted faction display list for the faction selector.
     * Order: matching factions (sorted by percentage desc) → remaining factions (alpha).
     * Excludes MULFACTION_EXTINCT.
     */
    public static buildFactionDisplayList(
        units: ForceUnit[],
        allFactions: Faction[],
        eras: Era[]
    ): FactionDisplayInfo[] {
        const result: FactionDisplayInfo[] = [];
        const referenceYear = getReferenceYear(units);
        const eligibleEraIds = new Set(getEligibleEras(eras, referenceYear).map(era => era.id));
        const unitIds = units.map(unit => unit.getUnit().id);
        const totalUnits = units.length;

        for (const faction of allFactions) {
            if (faction.id === MULFACTION_EXTINCT) continue;
            let rawPct = 0;
            for (const era of eras) {
                if (!eligibleEraIds.has(era.id)) continue;
                rawPct = Math.max(rawPct, getEraMatchPercentage(faction, era.id, unitIds, totalUnits));
            }

            result.push({
                faction,
                matchPercentage: rawPct,
                isMatching: rawPct >= MIN_UNITS_PERCENTAGE,
                eraAvailability: eras.map(era => ({
                    era,
                    isAvailable: faction.eras[era.id] != null && faction.eras[era.id].size > 0,
                    isBeforeReferenceYear: referenceYear != null && getEraEndYear(era) < referenceYear,
                    matchPercentage: getEraMatchPercentage(faction, era.id, unitIds, totalUnits)
                }))
            });
        }

        result.sort((a, b) =>
            b.matchPercentage - a.matchPercentage
            || a.faction.name.localeCompare(b.faction.name)
        );

        return result;
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
        if (!faction || faction.id === MULFACTION_MERCENARY) {
            return generateMercenaryName();
        }
        const name = cleanFactionNameForGeneration(faction.name);
        if (CORPORATE_FACTIONS.has(faction.name)) {
            return generateCorporateName(name);
        }
        return generateFactionMilitaryName(name);
    }
}