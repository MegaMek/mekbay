// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface WeightedValue<T> {
    value: T;
    weight: number;
}

export interface PilotNameFactionMatrix {
    surnameEthnicities: WeightedValue<number>[];
    givenNameEthnicities: Record<number, WeightedValue<number>[]>;
}

/** MekBay-native unit classification used by generated Bloodname records. */
export type BloodnamePhenotype = '*' | 'Mek' | 'Aero' | 'BA' | 'ProtoMek' | 'Naval';

export interface BloodnameClan {
    code: string;
    generationCode: string;
    start: number;
    end: number;
    homeClan: boolean;
    rivals: { code: string; start: number; end: number }[];
}

export interface BloodnameRecord {
    name: string;
    clan: string;
    phenotype: BloodnamePhenotype;
    exclusive: boolean;
    limited: boolean;
    start: number;
    inactive: number;
    abjured: number;
    reactivated: number;
    postReaving: string[];
    acquired: { clan: string; year: number }[];
    absorbed?: { clan: string; year: number };
}

export interface PilotFactionNameProfile {
    generator: string;
    isClan: boolean;
    bloodnameClan?: string;
}

export interface PilotNameCatalog {
    maleGivenNames: Record<number, WeightedValue<string>[]>;
    femaleGivenNames: Record<number, WeightedValue<string>[]>;
    surnames: Record<number, WeightedValue<string>[]>;
    factions: Record<string, PilotNameFactionMatrix>;
    factionProfiles: Record<number, PilotFactionNameProfile>;
    callsigns: WeightedValue<string>[];
    bloodnameClans: Record<string, BloodnameClan>;
    bloodnames: BloodnameRecord[];
}

export type CompactWeightedString = string | [value: string, weight: number];
export type CompactNameGroups = CompactWeightedString[][];
export type CompactFactionMatrix = [
    generator: string,
    surnameWeights: number[],
    givenNameWeights: number[][],
];

/** Minified asset and IndexedDB representation. Array indices are ethnicity code minus one. */
export interface CompactPilotNameCatalog {
    v: 1;
    /** Male given names, female given names, and surnames. */
    n: [CompactNameGroups, CompactNameGroups, CompactNameGroups];
    /** Callsigns. */
    c: CompactWeightedString[];
    /** Faction matrices. MUL mappings reference entries by index. */
    f: CompactFactionMatrix[];
    /** MUL faction ID, faction-matrix index, Clan flag, and optional bloodname Clan code. */
    m: [mulFactionId: number, factionIndex: number, isClan: 0 | 1, bloodnameClan?: string][];
    /** Bloodname Clans: code, generation code, start, end, home flag, and dated rivals. */
    bc: [string, string | 0, number, number, 0 | 1, [string, number, number][]][];
    /** Bloodnames: name, Clan, phenotype, flags, dates, post-Reaving Clans, acquisitions, absorption. */
    b: [string, string, BloodnamePhenotype, number, number, number, number, number, string[], [string, number][], [string, number] | 0][];
}

export interface PilotNameCatalogData {
    etag: string;
    catalog: CompactPilotNameCatalog;
}

export function createEmptyPilotNameCatalog(): PilotNameCatalog {
    return {
        maleGivenNames: {},
        femaleGivenNames: {},
        surnames: {},
        factions: {},
        factionProfiles: {},
        callsigns: [],
        bloodnameClans: {},
        bloodnames: [],
    };
}