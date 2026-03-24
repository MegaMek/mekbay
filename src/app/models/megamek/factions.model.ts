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
    key: string;
    name: string;
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

export type MegaMekFactions = Record<string, MegaMekFactionRecord>;

export interface MegaMekFactionsData {
    etag: string;
    factions: Record<string, MegaMekFactionRecordData>;
}

export type MegaMekFactionAffiliation = 'Clan' | 'Inner Sphere' | 'Periphery' | 'Other';

export function hydrateMegaMekFactionRecord(faction: MegaMekFactionRecordData | MegaMekFactionRecord): MegaMekFactionRecord {
    return {
        ...faction,
        fallBackFactionSet: new Set(faction.fallBackFactions),
        tagSet: new Set(faction.tags),
        ancestrySet: new Set(faction.ancestry),
    };
}

function getFactionAffiliationFromTags(faction: MegaMekFactionRecord): MegaMekFactionAffiliation {
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

function getFactionByKey(
    factionKey: string,
    factionsByKey?: ReadonlyMap<string, MegaMekFactionRecord> | MegaMekFactions,
): MegaMekFactionRecord | undefined {
    if (!factionsByKey) {
        return undefined;
    }

    if (typeof (factionsByKey as ReadonlyMap<string, MegaMekFactionRecord>).get === 'function') {
        return (factionsByKey as ReadonlyMap<string, MegaMekFactionRecord>).get(factionKey);
    }

    return (factionsByKey as MegaMekFactions)[factionKey];
}

export function getMegaMekFactionAffiliation(
    faction: MegaMekFactionRecord,
    factionsByKey?: ReadonlyMap<string, MegaMekFactionRecord> | MegaMekFactions,
): MegaMekFactionAffiliation {
    const visited = new Set<string>();

    function visit(current: MegaMekFactionRecord | undefined): MegaMekFactionAffiliation {
        if (!current || visited.has(current.key)) {
            return 'Other';
        }

        visited.add(current.key);

        const directAffiliation = getFactionAffiliationFromTags(current);
        if (directAffiliation !== 'Other') {
            return directAffiliation;
        }

        for (const ancestorKey of current.ancestry) {
            const ancestor = getFactionByKey(ancestorKey, factionsByKey);
            const ancestorAffiliation = visit(ancestor);
            if (ancestorAffiliation !== 'Other') {
                return ancestorAffiliation;
            }
        }

        return 'Other';
    }

    return visit(faction);
}