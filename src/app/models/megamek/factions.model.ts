export interface MegaMekFactionActiveYears {
    start?: number;
    end?: number;
}

export interface MegaMekFactionNameChange {
    year: number;
    name: string;
}

export interface MegaMekFactionLeader {
    title: string;
    firstName: string;
    surname: string;
    gender: string;
    startYear: number;
    endYear?: number;
    honorific?: string;
}

interface MegaMekFactionRecordBase {
    
    id: string; // Unique faction ID
    name: string; // Faction name
    isCommand: boolean;
    yearsActive: MegaMekFactionActiveYears[];
    ratingLevels: string[];
    nameChanges: MegaMekFactionNameChange[];
    capital?: string;
    capitalChanges?: MegaMekFactionNameChange[];
    color?: [number, number, number];
    logo?: string;
    camos?: string;
    nameGenerator?: string;
    eraMods?: number[];
    rankSystem?: string;
    successor?: string;
    factionLeaders?: MegaMekFactionLeader[];
    preInvasionHonorRating?: string;
    postInvasionHonorRating?: string;
    formationBaseSize?: number;
    formationGrouping?: number;
}

export interface MegaMekFactionRecordData extends MegaMekFactionRecordBase {
    fallBackFactions: string[];
    tags: string[];
    ancestry: string[];
}

export interface MegaMekFactionRecord extends MegaMekFactionRecordData {
    fallBackFactionSet: ReadonlySet<string>;
    tagSet: ReadonlySet<string>;
    ancestrySet: ReadonlySet<string>;
}

type MegaMekFactionRecordSource = MegaMekFactionRecordData | MegaMekFactionRecord;
type MegaMekFactionRecordLookup = ReadonlyMap<string, MegaMekFactionRecordSource> | Record<string, MegaMekFactionRecordSource>;

const INHERITED_FACTION_FIELDS = [
    'capital',
    'capitalChanges',
    'color',
    'logo',
    'camos',
    'nameGenerator',
    'eraMods',
    'rankSystem',
    'successor',
    'factionLeaders',
    'preInvasionHonorRating',
    'postInvasionHonorRating',
    'formationBaseSize',
    'formationGrouping',
] as const;

type InheritedFactionField = typeof INHERITED_FACTION_FIELDS[number];

export type MegaMekFactions = Record<string, MegaMekFactionRecord>;

export interface MegaMekFactionsData {
    etag: string;
    factions: Record<string, MegaMekFactionRecordData>;
}

export type MegaMekFactionAffiliation = 'Clan' | 'Inner Sphere' | 'Periphery' | 'Mercenary' | 'Other';

export function hydrateMegaMekFactionRecord(faction: MegaMekFactionRecordData | MegaMekFactionRecord): MegaMekFactionRecord {
    return {
        ...faction,
        fallBackFactionSet: new Set(faction.fallBackFactions),
        tagSet: new Set(faction.tags),
        ancestrySet: new Set(faction.ancestry),
    };
}

function getFactionFieldValue(faction: MegaMekFactionRecord, field: InheritedFactionField): MegaMekFactionRecord[InheritedFactionField] {
    return faction[field];
}

function hasFactionFieldValue(faction: MegaMekFactionRecord, field: InheritedFactionField): boolean {
    const value = getFactionFieldValue(faction, field);
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
        INHERITED_FACTION_FIELDS.map((field) => [field, resolveFactionField(hydratedFaction, field, factionsById)])
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

    return faction.yearsActive.some(activeYears => {
        const activeStart = activeYears.start ?? Number.NEGATIVE_INFINITY;
        const activeEnd = activeYears.end ?? Number.POSITIVE_INFINITY;
        return activeStart <= rangeEnd && activeEnd >= rangeStart;
    });
}

function getFactionAffiliationFromTags(faction: MegaMekFactionRecord): MegaMekFactionAffiliation {
    
    if (faction.tagSet.has('MERC')) {
        return 'Mercenary';
    }
    
    if (faction.tagSet.has('CLAN')) {
        return 'Clan';
    }

    if (faction.tagSet.has('IS')) {
        return 'Inner Sphere';
    }

    if (faction.tagSet.has('PERIPHERY') || faction.tagSet.has('DEEP_PERIPHERY')) {
        return 'Periphery';
    }

    return 'Other';
}

function getFactionById(
    factionId: string,
    factionsById?: ReadonlyMap<string, MegaMekFactionRecord> | MegaMekFactions,
): MegaMekFactionRecord | undefined {
    return getFactionRecordById(factionId, factionsById);
}

export function getMegaMekFactionAffiliation(
    faction: MegaMekFactionRecord,
    factionsById?: ReadonlyMap<string, MegaMekFactionRecord> | MegaMekFactions,
): MegaMekFactionAffiliation {
    const visited = new Set<string>();

    function visit(current: MegaMekFactionRecord | undefined): MegaMekFactionAffiliation {
        if (!current || visited.has(current.id)) {
            return 'Other';
        }

        visited.add(current.id);

        const directAffiliation = getFactionAffiliationFromTags(current);
        if (directAffiliation !== 'Other') {
            return directAffiliation;
        }

        for (const ancestorId of current.ancestry) {
            const ancestor = getFactionById(ancestorId, factionsById);
            const ancestorAffiliation = visit(ancestor);
            if (ancestorAffiliation !== 'Other') {
                return ancestorAffiliation;
            }
        }

        return 'Other';
    }

    return visit(faction);
}