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

/**
 * Engine type descriptor data — single source of truth.
 *
 * All static, per-engine-type data lives in `ENGINE_DATA`, a
 * `Record<EngineType, EngineTypeDescriptor>`.  Engine-type-dependent logic
 * elsewhere should derive from this map instead of ad-hoc if/else chains.
 *
 * Data sourced from MegaMek Engine.java and BattleTech TM / TO rules.
 */

import { TECH_ERA_DATA, TECH_ERAS, techEraIndexForYear, type TechEra } from './tech-era';

export {
    TECH_ERA_DATA,
    TECH_ERAS,
    techEraIndexForYear,
    type TechEra,
    type TechEraDescriptor,
    type TechEraIndex,
} from './tech-era';

/** Tech base as stored in entity files */
export type EntityTechBase = 'IS' | 'Clan';
export type EquipmentTechBase = EntityTechBase | 'All';

/** Tech rating:  A (primitive) → F (cutting-edge). */
export type TechRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Availability code per era.  X = not available. */
export type AvailabilityCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X';

/** Availability after composite adjustments. F* is one step harder than F. */
export type CompositeAvailabilityCode = AvailabilityCode | 'F*';

/** Era-keyed availability used by equipment JSON. */
export interface TechAvailability {
    readonly sl?: AvailabilityCode;
    readonly sw?: AvailabilityCode;
    readonly clan?: AvailabilityCode;
    readonly da?: AvailabilityCode;
}

/** Canonical Star League, Succession Wars, Clan Invasion, and Dark Age tuple. */
export type TechAvailabilityTuple = readonly [
    AvailabilityCode,
    AvailabilityCode,
    AvailabilityCode,
    AvailabilityCode,
];

/** Minimum technology data required by the composite-rating calculator. */
export interface TechRatingSource {
    readonly techBase?: EquipmentTechBase;
    readonly base?: EquipmentTechBase;
    readonly rating: TechRating;
    readonly availability: TechAvailability | TechAvailabilityTuple;
    readonly dates?: TechAdvancementDates | SplitTechDates;
    readonly advancement?: SplitTechDates;
}

export interface CompositeTechRatingContext {
    readonly techBase: EntityTechBase;
    readonly year?: number;
    /** Obsolete/reintroduction year pairs from the unit's Obsolete quirk. */
    readonly obsoleteYears?: readonly number[];
}

export type CompositeTechRating = `${TechRating}/${string}`;

/** Technology contract inherited by every entity implementation. */
export interface EntityTechnology {
    readonly techBase: () => EntityTechBase;
    readonly mixedTech: () => boolean;
    readonly techRating: () => CompositeTechRating;
    entityTechAdvancements(): readonly TechRatingSource[];
}

const TECH_RATING_ORDER: readonly TechRating[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const COMPOSITE_AVAILABILITY_ORDER: readonly CompositeAvailabilityCode[] =
    ['A', 'B', 'C', 'D', 'E', 'F', 'F*', 'X'];

function availabilityTuple(source: TechRatingSource): TechAvailabilityTuple {
    if (Array.isArray(source.availability)) {
        return source.availability as TechAvailabilityTuple;
    }
    const availability = source.availability as TechAvailability;
    return TECH_ERAS.map(era => availability[era] ?? 'X') as unknown as TechAvailabilityTuple;
}

function harderAvailability(value: CompositeAvailabilityCode): CompositeAvailabilityCode {
    const index = COMPOSITE_AVAILABILITY_ORDER.indexOf(value);
    return COMPOSITE_AVAILABILITY_ORDER[
        Math.min(index + 1, COMPOSITE_AVAILABILITY_ORDER.length - 1)
    ] ?? 'X';
}

function adjustedAvailability(
    value: CompositeAvailabilityCode,
    era: number,
    source: TechRatingSource,
    context: CompositeTechRatingContext,
): CompositeAvailabilityCode {
    const sourceTechBase = source.techBase ?? source.base ?? 'All';
    if (context.techBase === 'Clan'
        && era === TECH_ERA_DATA.sw.index
        && sourceTechBase !== 'Clan') {
        const dates = sourceDates(source);
        const clanCommonOnly = sourceTechBase === 'All'
            && dates != null
            && isSplitTechDates(dates)
            && dates.clan?.common != null
            && dates.clan.prototype == null
            && dates.clan.production == null;
        if (clanCommonOnly) return value;
        const resolved = dates && resolveTechDates(
            dates,
            sourceTechBase === 'All' ? context.techBase : sourceTechBase,
        );
        const introductionYears = [resolved?.prototype, resolved?.production, resolved?.common]
            .map(date => effectiveTechDateYear(date))
            .filter((year): year is number => year != null);
        const introduction = introductionYears.length ? Math.min(...introductionYears) : undefined;
        if (introduction != null
            && introduction >= TECH_ERA_DATA.sw.startYear
            && introduction < TECH_ERA_DATA.clan.startYear) return 'X';
    }
    if (context.techBase === 'IS' && sourceTechBase === 'Clan') {
        if (era === TECH_ERA_DATA.sw.index) return 'X';
        if (era >= TECH_ERA_DATA.clan.index) return harderAvailability(value);
    }
    return value;
}

function sourceDates(source: TechRatingSource): TechAdvancementDates | SplitTechDates | undefined {
    return source.dates ?? source.advancement;
}

function sourceExtinctionYear(
    source: TechRatingSource,
    context: CompositeTechRatingContext,
): number | undefined {
    const dates = sourceDates(source);
    if (!dates) return undefined;
    const sourceBase = source.techBase ?? source.base ?? context.techBase;
    const resolved = resolveTechDates(
        dates,
        sourceBase === 'All' ? context.techBase : sourceBase,
    );
    const extinct = effectiveTechDateYear(resolved?.extinct, true);
    if (extinct == null) return undefined;
    const reintroduced = effectiveTechDateYear(resolved?.reintroduced);
    if (context.year != null && reintroduced != null && reintroduced <= context.year) return undefined;
    return Math.max(extinct, context.year ?? extinct);
}

/** Calculate MegaMek's composite tech rating and four-era availability string. */
export function calculateCompositeTechRating(
    sources: readonly TechRatingSource[],
    context: CompositeTechRatingContext,
): CompositeTechRating {
    let rating: TechRating = 'A';
    const availability: CompositeAvailabilityCode[] = ['A', 'A', 'A', 'A'];
    let firstExtinction = firstObsoleteYear(context);

    for (const source of sources) {
        if (TECH_RATING_ORDER.indexOf(source.rating) > TECH_RATING_ORDER.indexOf(rating)) {
            rating = source.rating;
        }
        availabilityTuple(source).forEach((value, era) => {
            const adjusted = adjustedAvailability(
                value,
                era,
                source,
                context,
            );
            if (COMPOSITE_AVAILABILITY_ORDER.indexOf(adjusted)
                > COMPOSITE_AVAILABILITY_ORDER.indexOf(availability[era])) {
                availability[era] = adjusted;
            }
        });
        const extinction = sourceExtinctionYear(source, context);
        if (extinction != null && (firstExtinction == null || extinction < firstExtinction)) {
            firstExtinction = extinction;
        }
    }

    if (context.year != null) {
        const introductionEra = techEraIndexForYear(context.year);
        for (let era = 0; era < introductionEra; era++) availability[era] = 'X';
    }

    const formattedAvailability = availability.map((value, era) => {
        if (context.techBase === 'IS'
            && era === TECH_ERA_DATA.sw.index
            && (value === 'E' || value === 'F')
            && firstExtinction != null
            && firstExtinction >= TECH_ERA_DATA.sw.startYear
            && firstExtinction < TECH_ERA_DATA.clan.startYear) {
            return `${value}(${harderAvailability(value)})`;
        }
        return value;
    });

    return `${rating}/${formattedAvailability.join('-')}`;
}

function firstObsoleteYear(context: CompositeTechRatingContext): number | undefined {
    const years = context.obsoleteYears ?? [];
    let first: number | undefined;
    for (let i = 0; i < years.length; i += 2) {
        const obsolete = years[i];
        const reintroduced = years[i + 1];
        const extinctionEnd = reintroduced == null ? undefined : reintroduced - 1;
        if (obsolete == null || obsolete <= 0) continue;
        if (context.year != null && extinctionEnd != null && extinctionEnd <= context.year) continue;
        const start = Math.max(obsolete, context.year ?? obsolete);
        if (first == null || start < first) first = start;
    }
    return first;
}

/**
 * Construction-rules tech level.
 * Matches MegaMek `SimpleTechLevel`.
 */
export type ComponentTechLevel =
    | 'Introductory'
    | 'Standard'
    | 'Advanced'
    | 'Experimental'
    | 'Unofficial';

/** Applicability encoded alongside a construction-rules tech level. */
export type CompoundTechScope =
    | 'IS'
    | 'Clan'
    | 'IS TW'
    | 'TW'
    | 'All IS'
    | 'All Clan'
    | 'All'
    | 'Allowed All'
    | 'Unknown';

/** Structured form of MegaMek's compound technology classification. */
export interface CompoundTechLevel {
    readonly level: ComponentTechLevel;
    readonly scope: CompoundTechScope;
}

// ============================================================================
// Date sentinels  (matching MegaMek ITechnology)
// ============================================================================

/** Date not applicable / never. */
export const DATE_NONE = undefined;
/** Pre-Spaceflight era. */
export const DATE_PS = 1950;
/** Early Spaceflight era. */
export const DATE_ES = 2100;

// ============================================================================
// Tech date value type
// ============================================================================

/** A tech date that is explicitly approximate (~year). */
export interface ApproxDate {
    readonly year: number;
    readonly approximate: true;
}

/**
 * A technology date value.
 * - `number`: exact year
 * - `ApproxDate`: approximate year (displayed as ~year, range checks use year - APPROXIMATE_MARGIN)
 * - `undefined`: not applicable / never
 */
export type TechDate = number | ApproxDate | undefined;

/**
 * Margin in years applied to approximate dates during range checks.
 * Matches MegaMek `TechAdvancement.APPROXIMATE_MARGIN`.
 */
export const APPROXIMATE_MARGIN = 5;

/** Mark a tech year as approximate. */
export function approx(year: number): ApproxDate {
    return { year, approximate: true };
}

/** Extract the numeric year from a `TechDate` (returns `undefined` for DATE_NONE). */
export function techDateYear(date: TechDate): number | undefined {
    if (date == null) return undefined;
    return typeof date === 'number' ? date : date.year;
}

/** Whether a `TechDate` is approximate. */
export function isTechDateApprox(date: TechDate): boolean {
    return date != null && typeof date !== 'number';
}

/**
 * Year value adjusted for range checks: subtracts `APPROXIMATE_MARGIN`
 * for approximate dates (or adds it for extinction dates via `extinct` flag).
 */
export function effectiveTechDateYear(
    date: TechDate,
    extinct = false,
): number | undefined {
    if (date == null) return undefined;
    if (typeof date === 'number') return date;
    return extinct
        ? date.year + APPROXIMATE_MARGIN
        : date.year - APPROXIMATE_MARGIN;
}

/**
 * Format a `TechDate` for display: prepends '~' for approximate dates.
 * Returns `undefined` for DATE_NONE.
 */
export function formatTechDate(date: TechDate): string | undefined {
    if (date == null) return undefined;
    if (typeof date === 'number') return String(date);
    return `~${date.year}`;
}

/**
 * Parse a wire-format date string into a `TechDate`.
 * - `"2439"` => `2439` (exact)
 * - `"~2430"` => `{ year: 2430, approximate: true }` (approximate)
 * - `undefined` / empty => `undefined` (DATE_NONE)
 */
export function parseTechDate(value: string | undefined, noApproximation: boolean = false): TechDate {
    if (!value) return undefined;
    if (!noApproximation && value.startsWith('~')) {
        let v = value.slice(1);
        if (v === 'PS') return approx(DATE_PS);
        if (v === 'ES') return approx(DATE_ES);
        return approx(parseInt(v, 10));
    }
    if (value === 'PS') return DATE_PS;
    if (value === 'ES') return DATE_ES;
    return parseInt(value, 10);
}

// ============================================================================
// Tech advancement types
// ============================================================================

/**
 * Technology advancement dates for one tech variant.
 * Each date is a `TechDate`: a plain year, `approx(year)`, or `undefined`.
 */
export interface TechAdvancementDates {
    readonly prototype?: TechDate;
    readonly production?: TechDate;
    readonly common?: TechDate;
    readonly extinct?: TechDate;
    readonly reintroduced?: TechDate;
}

/**
 * Per-tech-base dates for components that have different IS and Clan
 * availability timelines (e.g. Small Cockpit: IS from 3061, Clan from 3081).
 *
 * Matches MegaMek's `TechAdvancement` which stores `isAdvancement` and
 * `clanAdvancement` separately.
 */
export interface SplitTechDates {
    readonly is?: TechAdvancementDates;
    readonly clan?: TechAdvancementDates;
}

/** Effective equipment technology data with parsed dates. */
export interface TechData {
    readonly base: EquipmentTechBase;
    readonly rating: TechRating;
    readonly level: ComponentTechLevel;
    readonly availability: TechAvailability;
    readonly advancement: SplitTechDates;
}

/** Type guard: is the dates value a per-tech-base split? */
export function isSplitTechDates(dates: TechAdvancementDates | SplitTechDates): dates is SplitTechDates {
    return 'is' in dates;
}

/**
 * Resolve `TechAdvancementDates` for a specific tech base.
 *
 * If the dates are per-tech-base (`SplitTechDates`), returns the dates
 * for the requested tech base.  Otherwise returns the unified `TechAdvancementDates`.
 */
export function resolveTechDates(
    dates: TechAdvancementDates | SplitTechDates,
    techBase: EquipmentTechBase = 'IS',
): TechAdvancementDates | undefined {
    if (isSplitTechDates(dates)) {
        return techBase === 'Clan' ? dates['clan'] : dates['is'];
    }
    return dates;
}

/**
 * Check whether a technology is available (at least prototype level)
 * for a given tech base at a given year.
 *
 * Returns `true` if the resolved prototype or production date for
 * `techBase` is defined and ≤ `year`.
 */
export function isTechAvailableForBase(
    dates: TechAdvancementDates | SplitTechDates,
    techBase: EquipmentTechBase,
    year: number,
): boolean {
    const resolved = resolveTechDates(dates, techBase);
    if (!resolved) {
        throw new Error(`Invalid tech dates: ${JSON.stringify(dates)}`);
    }

    // Must have at least prototype, production, or common date ≤ year to be available
    const protoYear = effectiveTechDateYear(resolved.prototype);
    const prodYear = effectiveTechDateYear(resolved.production);
    const commonYear = effectiveTechDateYear(resolved.common);
    const introduced = (protoYear != null && year >= protoYear)
        || (prodYear != null && year >= prodYear)
        || (commonYear != null && year >= commonYear);
    if (!introduced) return false;

    // MegaMek treats the stated extinction year as available; extinction begins the following year.
    // Approximate extinction dates are shifted forward by APPROXIMATE_MARGIN.
    const extinctYear = effectiveTechDateYear(resolved.extinct, true);
    if (extinctYear != null && year > extinctYear) {
        // Unless reintroduced after the extinction
        const reintroYear = effectiveTechDateYear(resolved.reintroduced);
        if (reintroYear != null && reintroYear > extinctYear && year >= reintroYear) {
            return true;
        }
        return false;
    }

    return true;
}

/** Faction codes for tech-advancement milestones. */
export interface TechFactions {
    readonly prototype?: readonly string[];
    readonly production?: readonly string[];
    readonly extinction?: readonly string[];
    readonly reintroduction?: readonly string[];
}

/**
 * Complete tech advancement for one component variant.
 *
 * Availability eras (tuple indices): [Star League, Succession Wars, Clan Invasion, Dark Age].
 *
 * The `dates` field can be either:
 * - `TechAdvancementDates` — single set of dates (used when IS & Clan share the same timeline,
 *   or when `techBase` is IS-only / Clan-only)
 * - `SplitTechDates` — per-tech-base dates (used when IS & Clan have different
 *   availability timelines, e.g. Small Cockpit)
 */
export interface TechAdvancement {
    readonly techBase: EquipmentTechBase;
    readonly rating: TechRating;
    readonly availability: TechAvailabilityTuple;
    readonly level: ComponentTechLevel;
    readonly dates: TechAdvancementDates | SplitTechDates;
    readonly factions?: TechFactions;
}

export type TechMilestone = 'prototype' | 'production' | 'common' | 'extinct' | 'reintroduced';

/** Minimum data required by the technology-level calculator. */
export interface TechLevelCalculation {
    readonly level: ComponentTechLevel;
    readonly dates: TechAdvancementDates | SplitTechDates;
    readonly factions?: TechFactions;
}

export interface TechLevelContext {
    readonly year: number;
    readonly techBase: EntityTechBase;
    readonly faction?: string;
}

const PROTOTYPE_OTHER_FACTION_OFFSET = 8;
const PRODUCTION_OTHER_FACTION_OFFSET = 10;
const REINTRODUCTION_OTHER_FACTION_OFFSET = 10;

function factionHasMilestoneAccess(
    factions: readonly string[] | undefined,
    faction: string | undefined,
    techBase: EntityTechBase,
): boolean {
    if (!factions?.length || !faction) return true;
    return factions.includes(faction)
        || factions.includes(techBase === 'Clan' ? 'CLAN' : 'IS');
}

function resolvedMilestoneYear(
    technology: TechLevelCalculation,
    milestone: TechMilestone,
    techBase: EntityTechBase,
): number | undefined {
    const dates = resolveTechDates(technology.dates, techBase);
    return effectiveTechDateYear(dates?.[milestone], milestone === 'extinct');
}

/** MegaMek-compatible milestone date, including faction dissemination delays. */
export function getTechMilestoneYear(
    technology: TechLevelCalculation,
    milestone: TechMilestone,
    context: Pick<TechLevelContext, 'techBase' | 'faction'>,
): number | undefined {
    const baseYear = resolvedMilestoneYear(technology, milestone, context.techBase);
    if (baseYear == null || milestone === 'common') return baseYear;

    const factionKey: keyof TechFactions = milestone === 'reintroduced'
        ? 'reintroduction'
        : milestone === 'extinct'
            ? 'extinction'
            : milestone;
    if (factionHasMilestoneAccess(technology.factions?.[factionKey], context.faction, context.techBase)) {
        return baseYear;
    }

    if (milestone === 'extinct') return undefined;
    if (milestone === 'prototype') {
        const delayedYear = baseYear + PROTOTYPE_OTHER_FACTION_OFFSET;
        const productionYear = resolvedMilestoneYear(technology, 'production', context.techBase);
        const commonYear = resolvedMilestoneYear(technology, 'common', context.techBase);
        if ((productionYear != null && productionYear < delayedYear)
            || (commonYear != null && commonYear < delayedYear)
            || isTechExtinct(technology, { year: delayedYear, techBase: context.techBase })) {
            return undefined;
        }
        return delayedYear;
    }
    if (milestone === 'production') {
        const delayedYear = baseYear + PRODUCTION_OTHER_FACTION_OFFSET;
        const commonYear = resolvedMilestoneYear(technology, 'common', context.techBase);
        if ((commonYear != null && commonYear <= delayedYear)
            || isTechExtinct(technology, { year: delayedYear, techBase: context.techBase })) {
            return undefined;
        }
        return delayedYear;
    }

    const productionYear = getTechMilestoneYear(technology, 'production', context);
    const commonYear = resolvedMilestoneYear(technology, 'common', context.techBase);
    if (productionYear != null && productionYear > baseYear) return productionYear;
    if (commonYear != null && commonYear > baseYear) return commonYear;
    return baseYear + REINTRODUCTION_OTHER_FACTION_OFFSET;
}

/** Effective construction-rules level at a year, matching ITechnology.getSimpleLevel(). */
export function calculateTechLevel(
    technology: TechLevelCalculation,
    context: TechLevelContext,
): ComponentTechLevel {
    if (technology.level === 'Unofficial') return 'Unofficial';

    const commonYear = getTechMilestoneYear(technology, 'common', context);
    if (commonYear != null && context.year >= commonYear) {
        return technology.level === 'Introductory' ? 'Introductory' : 'Standard';
    }
    const productionYear = getTechMilestoneYear(technology, 'production', context);
    if (productionYear != null && context.year >= productionYear) return 'Advanced';
    const prototypeYear = getTechMilestoneYear(technology, 'prototype', context);
    if (prototypeYear != null && context.year >= prototypeYear) return 'Experimental';
    return 'Unofficial';
}

export function createCompoundTechLevel(
    level: ComponentTechLevel,
    techBase: EntityTechBase,
): CompoundTechLevel {
    return { level, scope: techBase };
}

/** Effective compound classification at a year for normal IS/Clan usage. */
export function calculateCompoundTechLevel(
    technology: TechLevelCalculation,
    context: TechLevelContext,
): CompoundTechLevel {
    return createCompoundTechLevel(calculateTechLevel(technology, context), context.techBase);
}

/** First prototype, production, or common year for the requested context. */
export function getTechIntroductionYear(
    technology: TechLevelCalculation,
    context: Pick<TechLevelContext, 'techBase' | 'faction'>,
): number | undefined {
    const years = (['prototype', 'production', 'common'] as const)
        .map(milestone => getTechMilestoneYear(technology, milestone, context))
        .filter((year): year is number => year != null);
    return years.length ? Math.min(...years) : undefined;
}

/** Whether technology has been introduced and is not currently extinct. */
export function isTechnologyAvailable(
    technology: TechLevelCalculation,
    context: TechLevelContext,
): boolean {
    const introductionYear = getTechIntroductionYear(technology, context);
    return introductionYear != null
        && context.year >= introductionYear
        && !isTechExtinct(technology, context);
}

const TECH_LEVEL_RANK: Readonly<Record<ComponentTechLevel, number>> = {
    Introductory: 0,
    Standard: 1,
    Advanced: 2,
    Experimental: 3,
    Unofficial: 4,
};

export function compareTechLevels(left: ComponentTechLevel, right: ComponentTechLevel): number {
    return TECH_LEVEL_RANK[left] - TECH_LEVEL_RANK[right];
}

function compoundScopeBases(scope: CompoundTechScope): readonly EntityTechBase[] {
    if (scope === 'Clan' || scope === 'All Clan') return ['Clan'];
    if (scope === 'IS' || scope === 'All IS') return ['IS'];
    if (scope === 'Allowed All' || scope === 'All' || scope === 'TW' || scope === 'IS TW') {
        return ['IS', 'Clan'];
    }
    return [];
}

/** Construction legality equivalent to TechConstants.isLegal() for compound classifications. */
export function isCompoundTechLevelLegal(
    equipment: CompoundTechLevel,
    entity: CompoundTechLevel,
): boolean {
    if (equipment.scope === 'Allowed All' || equipment.scope === 'All') return true;
    const equipmentBases = compoundScopeBases(equipment.scope);
    const entityBases = compoundScopeBases(entity.scope);
    const compatibleBase = equipmentBases.some(base => entityBases.includes(base));
    if (equipment.scope === 'All IS' || equipment.scope === 'All Clan') return compatibleBase;
    return compatibleBase
        && compareTechLevels(equipment.level, entity.level) <= 0;
}

/** Lowest rules level supported by any milestone, matching ITechnology.findMinimumRulesLevel(). */
export function findMinimumTechLevel(
    technology: TechLevelCalculation,
    techBase?: EntityTechBase,
): ComponentTechLevel {
    const bases: readonly EntityTechBase[] = techBase ? [techBase] : ['IS', 'Clan'];
    const hasDate = (milestone: TechMilestone): boolean => bases.some(
        base => resolvedMilestoneYear(technology, milestone, base) != null,
    );
    if (hasDate('common')) return technology.level === 'Introductory' ? 'Introductory' : 'Standard';
    if (hasDate('production')) return 'Advanced';
    if (hasDate('prototype')) return 'Experimental';
    return 'Unofficial';
}

/** Whether technology is between extinction and reintroduction for this context. */
export function isTechExtinct(
    technology: TechLevelCalculation,
    context: TechLevelContext,
): boolean {
    const reintroductionWithoutFaction = resolvedMilestoneYear(
        technology,
        'reintroduced',
        context.techBase,
    );
    if (context.faction === 'CS' && context.techBase === 'IS' && reintroductionWithoutFaction != null) {
        return false;
    }
    const extinctYear = getTechMilestoneYear(technology, 'extinct', context);
    if (extinctYear == null || extinctYear >= context.year) return false;
    const reintroducedYear = getTechMilestoneYear(technology, 'reintroduced', context);
    return reintroducedYear == null || context.year < reintroducedYear;
}
