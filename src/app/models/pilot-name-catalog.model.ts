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