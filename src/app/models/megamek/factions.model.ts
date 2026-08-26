// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface MegaMekFactionActiveYears {
    start?: number;
    end?: number;
}

export interface MegaMekFactionNameChange {
    year: number;
    name: string;
}

interface MegaMekFactionRecordBase {
    id: string;
    name: string;
    mulId: number[];
    yearsActive: MegaMekFactionActiveYears[];
    fallBackFactions: string[];
    ancestry: string[];
    nameChanges: MegaMekFactionNameChange[];
    color?: [number, number, number];
    logo?: string;
    successor?: string;
    formationBaseSize?: number;
    formationGrouping?: number;
}

export interface MegaMekFactionRecordData extends MegaMekFactionRecordBase {}

export interface MegaMekFactionRecord extends MegaMekFactionRecordBase {}

type MegaMekFactionRecordSource = MegaMekFactionRecordData | MegaMekFactionRecord;
type MegaMekFactionRecordLookup = ReadonlyMap<string, MegaMekFactionRecordSource> | Record<string, MegaMekFactionRecordSource>;

const INHERITED_FACTION_FIELDS = ['mulId', 'color', 'logo', 'successor', 'formationBaseSize', 'formationGrouping'] as const;

type InheritedFactionField = typeof INHERITED_FACTION_FIELDS[number];

export type MegaMekFactions = Record<string, MegaMekFactionRecord>;

export interface MegaMekFactionsData {
    assetHash: string;
    factions: Record<string, MegaMekFactionRecordData>;
}

export type MegaMekFactionAffiliation = 'Clan' | 'Inner Sphere' | 'Periphery' | 'Mercenary' | 'Other';

export function hydrateMegaMekFactionRecord(faction: MegaMekFactionRecordSource): MegaMekFactionRecord {
    return {
        ...faction,
        mulId: [...(faction.mulId ?? [])],
        yearsActive: (faction.yearsActive ?? []).map((years) => ({
            start: years.start,
            end: years.end,
        })),
        fallBackFactions: [...(faction.fallBackFactions ?? [])],
        ancestry: [...(faction.ancestry ?? [])],
        nameChanges: (faction.nameChanges ?? []).map((change) => ({
            year: change.year,
            name: change.name,
        })),
        color: faction.color ? [...faction.color] as [number, number, number] : undefined,
        logo: faction.logo,
        successor: faction.successor,
        formationBaseSize: faction.formationBaseSize,
        formationGrouping: faction.formationGrouping,
    };
}

function getFactionFieldValue(
    faction: MegaMekFactionRecord,
    field: InheritedFactionField,
): MegaMekFactionRecord[InheritedFactionField] {
    return faction[field];
}

function hasFactionFieldValue(faction: MegaMekFactionRecord, field: InheritedFactionField): boolean {
    const value = getFactionFieldValue(faction, field);
    if (field === 'mulId') {
        return Array.isArray(value) && value.length > 0;
    }

    return value !== undefined;
}

function getFactionRecordById(
    factionId: string,
    factionsById?: MegaMekFactionRecordLookup,
): MegaMekFactionRecord | undefined {
    if (!factionsById) {
        return undefined;
    }

    if (typeof (factionsById as ReadonlyMap<string, MegaMekFactionRecordSource>).get === 'function') {
        const faction = (factionsById as ReadonlyMap<string, MegaMekFactionRecordSource>).get(factionId);
        return faction ? hydrateMegaMekFactionRecord(faction) : undefined;
    }

    const faction = (factionsById as Record<string, MegaMekFactionRecordSource>)[factionId];
    return faction ? hydrateMegaMekFactionRecord(faction) : undefined;
}

function resolveFactionField(
    faction: MegaMekFactionRecord,
    field: InheritedFactionField,
    factionsById?: MegaMekFactionRecordLookup,
    visited = new Set<string>(),
): MegaMekFactionRecord[InheritedFactionField] {
    if (hasFactionFieldValue(faction, field)) {
        return getFactionFieldValue(faction, field);
    }

    visited.add(faction.id);

    for (const fallbackId of faction.fallBackFactions) {
        if (visited.has(fallbackId)) {
            continue;
        }

        const fallback = getFactionRecordById(fallbackId, factionsById);
        if (!fallback) {
            continue;
        }

        const resolvedValue = resolveFactionField(fallback, field, factionsById, new Set(visited));
        if (resolvedValue !== undefined) {
            return resolvedValue;
        }
    }

    return undefined;
}

export function resolveMegaMekFactionRecord(
    faction: MegaMekFactionRecordSource,
    factionsById?: MegaMekFactionRecordLookup,
): MegaMekFactionRecord {
    const hydratedFaction = hydrateMegaMekFactionRecord(faction);
    const resolvedFields = Object.fromEntries(
        INHERITED_FACTION_FIELDS.map((field) => {
            const resolvedValue = resolveFactionField(hydratedFaction, field, factionsById);
            return [field, resolvedValue === undefined ? hydratedFaction[field] : resolvedValue];
        }),
    ) as Pick<MegaMekFactionRecord, InheritedFactionField>;

    return {
        ...hydratedFaction,
        ...resolvedFields,
    };
}

export function isMegaMekFactionActiveInYearRange(
    faction: MegaMekFactionRecord,
    startYear?: number,
    endYear?: number,
): boolean {
    if (faction.yearsActive.length === 0) {
        return true;
    }

    const rangeStart = startYear ?? Number.NEGATIVE_INFINITY;
    const rangeEnd = endYear ?? Number.POSITIVE_INFINITY;

    return faction.yearsActive.some((activeYears) => {
        const activeStart = activeYears.start ?? Number.NEGATIVE_INFINITY;
        const activeEnd = activeYears.end ?? Number.POSITIVE_INFINITY;
        return activeStart <= rangeEnd && activeEnd >= rangeStart;
    });
}
