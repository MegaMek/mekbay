// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PilotNameCatalog } from '../models/pilot-name-catalog.model';
import {
    generateBloodname,
    generatePilotName,
    getBloodnameChance,
    getCallsignChance,
    isBloodnameAvailable,
    pickWeighted,
    resolveBloodnamePhenotype,
} from './pilot-name-generator.util';

function sequence(...values: number[]): () => number {
    let index = 0;
    return () => values[index++] ?? values.at(-1) ?? 0;
}

function createCatalog(): PilotNameCatalog {
    return {
        maleGivenNames: {
            1: [{ value: 'John', weight: 1 }],
            2: [{ value: 'Kenji', weight: 1 }],
        },
        femaleGivenNames: {
            1: [{ value: 'Jane', weight: 1 }],
            2: [{ value: 'Aiko', weight: 1 }],
        },
        surnames: {
            1: [{ value: 'Smith', weight: 1 }],
            2: [{ value: 'Kurita', weight: 1 }],
        },
        factions: {
            General: {
                surnameEthnicities: [{ value: 1, weight: 1 }],
                givenNameEthnicities: { 1: [{ value: 1, weight: 1 }] },
            },
            DC: {
                surnameEthnicities: [{ value: 2, weight: 1 }],
                givenNameEthnicities: { 2: [{ value: 2, weight: 1 }] },
            },
            Clan: {
                surnameEthnicities: [{ value: 2, weight: 1 }],
                givenNameEthnicities: { 2: [{ value: 2, weight: 1 }] },
            },
        },
        factionProfiles: {
            27: { generator: 'DC', isClan: false },
            28: { generator: 'DC', isClan: true },
            99: { generator: 'Clan', isClan: false },
        },
        callsigns: [{ value: 'Specter', weight: 1 }],
        bloodnameClans: {},
        bloodnames: [],
    };
}

function createBloodnameCatalog(): PilotNameCatalog {
    return {
        maleGivenNames: {}, femaleGivenNames: {}, surnames: {}, factions: {}, callsigns: [],
        factionProfiles: {
            1: { generator: 'Clan', isClan: true, bloodnameClan: 'CW' },
            2: { generator: 'Clan', isClan: true },
            3: { generator: 'Clan', isClan: false, bloodnameClan: 'CW' },
        },
        bloodnameClans: {
            CW: { code: 'CW', generationCode: 'CW', start: 2807, end: 9999, homeClan: false, rivals: [] },
        },
        bloodnames: [
            { name: 'Kerensky', clan: 'CW', phenotype: 'Mek', exclusive: true, limited: false, start: 2807, inactive: 0, abjured: 0, reactivated: 0, postReaving: ['CW'], acquired: [] },
            { name: 'General', clan: 'CW', phenotype: '*', exclusive: true, limited: false, start: 2807, inactive: 0, abjured: 0, reactivated: 0, postReaving: ['CW'], acquired: [] },
        ],
    };
}

describe('pickWeighted', () => {
    it('selects the first and last weighted boundaries', () => {
        const entries = [{ value: 'first', weight: 1 }, { value: 'last', weight: 3 }];
        expect(pickWeighted(entries, () => 0)).toBe('first');
        expect(pickWeighted(entries, () => 0.999999)).toBe('last');
    });

    it('ignores non-positive weights and rejects empty input', () => {
        expect(pickWeighted([{ value: 'invalid', weight: 0 }, { value: 'valid', weight: 1 }], () => 0)).toBe('valid');
        expect(pickWeighted([], () => 0)).toBeUndefined();
    });

    it('normalizes invalid and out-of-range random values', () => {
        const entries = [{ value: 'first', weight: 1 }, { value: 'last', weight: 1 }];
        expect(pickWeighted(entries, () => Number.NaN)).toBe('first');
        expect(pickWeighted(entries, () => -1)).toBe('first');
        expect(pickWeighted(entries, () => Number.POSITIVE_INFINITY)).toBe('first');
        expect(pickWeighted(entries, () => 2)).toBe('last');
    });
});

describe('generatePilotName', () => {
    it('uses the MUL faction generator and female names below the default 50% threshold', () => {
        expect(generatePilotName(createCatalog(), { factionId: 27 }, sequence(0, 0, 0.49, 0, 0, 0)))
            .toBe('Aiko "Specter" Kurita');
    });

    it('uses male names at the 50% boundary and General for unknown factions', () => {
        expect(generatePilotName(createCatalog(), { factionId: 404 }, sequence(0, 0, 0.5, 0, 0, 0)))
            .toBe('John "Specter" Smith');
    });

    it('keeps Clan formatting independent from the ethnicity generator', () => {
        expect(generatePilotName(createCatalog(), { factionId: 28, includeCallsign: false }, sequence(0, 0, 0.5, 0, 0)))
            .toBe('Kenji');
        expect(generatePilotName(createCatalog(), { factionId: 28, includeCallsign: true }, sequence(0, 0, 0.5, 0, 0)))
            .toBe('Kenji "Specter"');
        expect(generatePilotName(createCatalog(), { factionId: 99, includeCallsign: false }, sequence(0, 0, 0.5, 0, 0)))
            .toBe('Kenji Kurita');
    });

    it('can omit callsigns and returns null for incomplete data', () => {
        expect(generatePilotName(createCatalog(), { includeCallsign: false }, sequence(0, 0, 0, 0, 0)))
            .toBe('Jane Smith');
        expect(generatePilotName({ ...createCatalog(), factions: {} }, {}, () => 0)).toBeNull();
    });

    it('includes a callsign below the normal 25% boundary and excludes it at the boundary', () => {
        expect(generatePilotName(createCatalog(), {}, sequence(0, 0, 0, 0, 0, 0.249, 0)))
            .toBe('Jane "Specter" Smith');
        expect(generatePilotName(createCatalog(), {}, sequence(0, 0, 0, 0, 0, 0.25)))
            .toBe('Jane Smith');
    });

    it('uses the 70% aerospace baseline', () => {
        expect(generatePilotName(createCatalog(), { isAerospace: true }, sequence(0, 0, 0, 0, 0, 0.699, 0)))
            .toBe('Jane "Specter" Smith');
        expect(generatePilotName(createCatalog(), { isAerospace: true }, sequence(0, 0, 0, 0, 0, 0.7)))
            .toBe('Jane Smith');
    });
});

describe('bloodname generation', () => {
    it('uses the approved commander and non-commander probabilities', () => {
        expect(getBloodnameChance(true)).toBe(0.15);
        expect(getBloodnameChance(false)).toBe(0.001);
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 1, isCommander: true, unitType: 'Mek' }, sequence(0.149, 1, 1, 0))).toBe('Kerensky');
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 1, isCommander: true, unitType: 'Mek' }, sequence(0.15))).toBeUndefined();
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 1, unitType: 'Mek' }, sequence(0.0009, 1, 1, 0))).toBe('Kerensky');
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 1, unitType: 'Mek' }, sequence(0.001))).toBeUndefined();
    });

    it('requires a Clan profile with a bloodname lineage', () => {
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 2, isCommander: true }, () => 0)).toBeUndefined();
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 3, isCommander: true }, () => 0)).toBeUndefined();
        expect(generateBloodname(createBloodnameCatalog(), { factionId: 404, isCommander: true }, () => 0)).toBeUndefined();
    });

    it('maps all supported unit phenotypes', () => {
        expect(resolveBloodnamePhenotype('Mek')).toBe('Mek');
        expect(resolveBloodnamePhenotype('Infantry', 'Battle Armor')).toBe('BA');
        expect(resolveBloodnamePhenotype('ProtoMek')).toBe('ProtoMek');
        expect(resolveBloodnamePhenotype('Naval')).toBe('Naval');
        expect(resolveBloodnamePhenotype('Aero', 'WarShip')).toBe('Aero');
        expect(resolveBloodnamePhenotype('Tank')).toBe('*');
    });

    it('accepts names active at any point in an era', () => {
        const base = createBloodnameCatalog().bloodnames[0];
        expect(isBloodnameAvailable({ ...base, start: 3050 }, { from: 3000, to: 3055 })).toBeTrue();
        expect(isBloodnameAvailable({ ...base, start: 3056 }, { from: 3000, to: 3055 })).toBeFalse();
        expect(isBloodnameAvailable({ ...base, inactive: 3020 }, { from: 3000, to: 3055 })).toBeTrue();
        expect(isBloodnameAvailable({ ...base, inactive: 2999 }, { from: 3000, to: 3055 })).toBeFalse();
        expect(isBloodnameAvailable({ ...base, inactive: 2999, reactivated: 3050 }, { from: 3000, to: 3055 })).toBeTrue();
        expect(isBloodnameAvailable({ ...base, start: 9999, inactive: 1 }, null)).toBeTrue();
    });

    it('checks both original and reactivated active intervals', () => {
        const base = { ...createBloodnameCatalog().bloodnames[0], inactive: 3050, reactivated: 3100 };
        expect(isBloodnameAvailable(base, { from: 3000, to: 3040 })).toBeTrue();
        expect(isBloodnameAvailable(base, { from: 3051, to: 3099 })).toBeFalse();
        expect(isBloodnameAvailable(base, { from: 3100, to: 3120 })).toBeTrue();
        expect(isBloodnameAvailable(base, { from: 3110, to: 3040 })).toBeTrue();
        expect(isBloodnameAvailable(base, { from: 3050, to: 3050 })).toBeTrue();
        expect(isBloodnameAvailable(base, { from: 3051, to: 3051 })).toBeFalse();
    });
});

describe('getCallsignChance', () => {
    it('uses static baselines through the typical 14-character name length', () => {
        expect(getCallsignChance(-1)).toBe(0.25);
        expect(getCallsignChance(0)).toBe(0.25);
        expect(getCallsignChance(14)).toBe(0.25);
        expect(getCallsignChance(14, true)).toBe(0.7);
    });

    it('adds 4% per extra character and applies normal and aerospace caps', () => {
        expect(getCallsignChance(15)).toBeCloseTo(0.29);
        expect(getCallsignChance(28)).toBe(0.8);
        expect(getCallsignChance(15, true)).toBeCloseTo(0.74);
        expect(getCallsignChance(22, true)).toBe(1);
        expect(getCallsignChance(Number.POSITIVE_INFINITY, true)).toBe(0.7);
        expect(getCallsignChance(Number.NaN)).toBe(0.25);
    });
});
