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
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 */

/** The four eras used by MegaMek technology availability ratings. */
export const TECH_ERAS = ['sl', 'sw', 'clan', 'da'] as const;
export type TechEra = typeof TECH_ERAS[number];
export type TechEraIndex = 0 | 1 | 2 | 3;

export interface TechEraDescriptor {
    readonly index: TechEraIndex;
    readonly name: string;
    /** First year in this era; omitted for the open-ended first era. */
    readonly startYear?: number;
}

/**
 * Ordered availability eras from MegaMek's `ITechnology.getTechEra(int)`.
 * These are rules buckets and intentionally differ from the universe eras
 * used for faction and unit filtering.
 */
export const TECH_ERA_DATA = {
    sl: { index: 0, name: 'Star League' },
    sw: { index: 1, name: 'Succession Wars', startYear: 2780 },
    clan: { index: 2, name: 'Clan Invasion', startYear: 3050 },
    da: { index: 3, name: 'Dark Age', startYear: 3130 },
} as const satisfies Readonly<Record<TechEra, TechEraDescriptor>>;

/** Return the availability tuple index containing the given year. */
export function techEraIndexForYear(year: number): TechEraIndex {
    if (year >= TECH_ERA_DATA.da.startYear) return TECH_ERA_DATA.da.index;
    if (year >= TECH_ERA_DATA.clan.startYear) return TECH_ERA_DATA.clan.index;
    if (year >= TECH_ERA_DATA.sw.startYear) return TECH_ERA_DATA.sw.index;
    return TECH_ERA_DATA.sl.index;
}