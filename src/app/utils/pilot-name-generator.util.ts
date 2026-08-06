// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    BloodnamePhenotype,
    BloodnameRecord,
    PilotNameCatalog,
    WeightedValue,
} from '../models/pilot-name-catalog.model';
import type { UnitSubtype, UnitType } from '../models/entity/types/classification';

export type RandomSource = () => number;

export interface PilotNameGenerationOptions {
    factionId?: number | null;
    isAerospace?: boolean;
    isCommander?: boolean;
    unitType?: UnitType;
    unitSubtype?: UnitSubtype;
    era?: { from?: number; to?: number } | null;
    /** Force callsign inclusion/exclusion. Omit to use the length-based probability. */
    includeCallsign?: boolean;
}

const TYPICAL_FULL_NAME_LENGTH = 14;
const CALLSIGN_CHANCE_PER_EXTRA_CHARACTER = 0.04;
const COMMANDER_BLOODNAME_CHANCE = 0.15;
const OTHER_PILOT_BLOODNAME_CHANCE = 0.001;

export function resolveBloodnamePhenotype(
    unitType?: UnitType,
    unitSubtype?: UnitSubtype,
): BloodnamePhenotype {
    if (unitSubtype === 'Battle Armor') return 'BA';
    if (unitType === 'Mek' || unitType === 'ProtoMek' || unitType === 'Naval' || unitType === 'Aero') return unitType;
    return '*';
}

export function getBloodnameChance(isCommander = false): number {
    return isCommander ? COMMANDER_BLOODNAME_CHANCE : OTHER_PILOT_BLOODNAME_CHANCE;
}

interface EraInterval {
    from?: number;
    to?: number;
}

function normalizeEra(era?: EraInterval | null): EraInterval | undefined {
    if (!era || (era.from == null && era.to == null)) return undefined;
    const from = era.from ?? era.to;
    const to = era.to ?? era.from;
    return from != null && to != null
        ? { from: Math.min(from, to), to: Math.max(from, to) }
        : undefined;
}

function intervalsOverlap(start: number, end: number | undefined, era: EraInterval): boolean {
    return (era.to == null || start <= era.to) && (era.from == null || end == null || end >= era.from);
}

function phenotypeMultiplier(name: BloodnameRecord, phenotype: BloodnamePhenotype, year?: number): number {
    switch (name.phenotype) {
        case 'Mek': return phenotype === 'Mek' ? 3 : 0;
        case 'Aero': return phenotype === 'Aero' || phenotype === 'ProtoMek' ? 3 : 0;
        case 'BA': return year != null && year < 2870 ? 1 : phenotype === 'BA' ? 3 : 0;
        case 'ProtoMek': return phenotype === 'ProtoMek' ? 9 : phenotype === 'Aero' ? 1 : 0;
        case 'Naval': return phenotype === 'Naval' ? 3 : 0;
        default: return 1;
    }
}

/** A record is usable if it was active at any point during the selected era. */
export function isBloodnameAvailable(name: BloodnameRecord, era?: { from?: number; to?: number } | null): boolean {
    const interval = normalizeEra(era);
    if (!interval) return true;
    const initiallyActive = intervalsOverlap(name.start, name.inactive > 0 ? name.inactive : undefined, interval);
    const reactivated = name.reactivated > 0 && intervalsOverlap(name.reactivated, undefined, interval);
    return initiallyActive || reactivated;
}

function eraFraction(year: number): number {
    if (year < 2900) return 1;
    if (year < 2950) return 0.9;
    if (year < 3000) return 0.8;
    if (year < 3050) return 0.7;
    return 0.6;
}

function isClanActive(start: number, end: number, era?: { from?: number; to?: number } | null): boolean {
    const interval = normalizeEra(era);
    return !interval || intervalsOverlap(start, end, interval);
}

function randomIndex(length: number, random: RandomSource): number {
    if (length <= 0) return -1;
    const value = random();
    const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0;
    return Math.floor(normalized * length);
}

function selectBloodname(
    catalog: PilotNameCatalog,
    clanCode: string,
    phenotype: BloodnamePhenotype,
    era: { from?: number; to?: number } | null | undefined,
    random: RandomSource,
    allowIsorla: boolean,
): string | undefined {
    const clan = catalog.bloodnameClans[clanCode];
    if (!clan || !isClanActive(clan.start, clan.end, era)) return undefined;
    const interval = normalizeEra(era);

    if (allowIsorla && random() < 0.05) {
        const rivals = clan.rivals
            .filter((rival) => isClanActive(rival.start, rival.end, era))
            .map((rival) => catalog.bloodnameClans[rival.code])
            .filter((candidate) => candidate && isClanActive(candidate.start, candidate.end, era));
        const rivalIndex = randomIndex(rivals.length + 1, random);
        let rival = rivalIndex < rivals.length ? rivals[rivalIndex] : undefined;
        if (!rival) {
            const spansPreSeparation = interval?.from == null || interval.from <= 3075;
            const fallback = Object.values(catalog.bloodnameClans).filter((candidate) =>
                isClanActive(candidate.start, candidate.end, era)
                && (spansPreSeparation || candidate.homeClan === clan.homeClan));
            rival = fallback[randomIndex(fallback.length, random)];
        }
        if (rival) return selectBloodname(catalog, rival.code, phenotype, era, random, false);
    }

    const requestedPhenotype = random() < 0.05 ? '*' : phenotype;
    const generationCode = clan.generationCode;
    const weights = new Map<string, number>();
    const outsider: BloodnameRecord[] = [];
    let outsiderWeight = 0;

    const addWeight = (name: string, weight: number): void => {
        if (weight > 0) weights.set(name, (weights.get(name) ?? 0) + weight);
    };
    const periods: ({ from?: number; to?: number; policy: 'all' | 'pre' | 'post' })[] = !interval
        ? [{ policy: 'all' }]
        : [
            ...(interval.from! <= 3099 ? [{ from: interval.from, to: Math.min(interval.to!, 3099), policy: 'pre' as const }] : []),
            ...(interval.to! >= 3100 ? [{ from: Math.max(interval.from!, 3100), to: interval.to, policy: 'post' as const }] : []),
        ];

    for (const period of periods) {
            const weightBeforePeriod = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
        const year = period.to ?? period.from;
        for (const name of catalog.bloodnames) {
            if (!isBloodnameAvailable(name, period)) continue;
            if (name.abjured > 0 && period.from != null && name.abjured < period.from && name.clan !== generationCode) continue;
            const multiplier = phenotypeMultiplier(name, requestedPhenotype, year);
            if (multiplier === 0) continue;

            let weight = 0;
            if (period.policy === 'all') {
            const linked = name.clan === generationCode
                || name.acquired.some((entry) => entry.clan === generationCode)
                || name.postReaving.includes(generationCode)
                || name.absorbed?.clan === generationCode;
            if (linked) weight = multiplier;
            else if (!name.exclusive) outsider.push(...Array(multiplier).fill(name));
            } else if (period.policy === 'pre') {
            const activeAcquisitions = name.acquired.filter((entry) => entry.year <= period.to!);
            const clanCount = 1 + activeAcquisitions.length;
            const native = name.clan === generationCode
                || (name.absorbed?.clan === generationCode && name.absorbed.year <= period.to!);
            if (native) {
                if (name.exclusive || clanCount > 1) weight = multiplier / clanCount;
                else {
                    const fraction = eraFraction(year!);
                    outsiderWeight += 1 - fraction;
                    weight = fraction * fraction * multiplier;
                }
            } else if (activeAcquisitions.some((entry) => entry.clan === generationCode)) {
                weight = multiplier / clanCount;
            } else if (!name.exclusive) {
                outsider.push(...Array(multiplier).fill(name));
            }
            } else if (name.postReaving.includes(generationCode)) {
            weight = multiplier * multiplier / name.postReaving.length;
            if (!name.limited) weight *= name.exclusive ? 4 : 2;
            } else if (name.postReaving.length === 0 && !name.exclusive) {
            outsider.push(...Array(multiplier).fill(name));
            }
            addWeight(name.name, weight);
        }
        if (period.policy === 'post') {
            const weightAfterPeriod = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
            outsiderWeight += (weightAfterPeriod - weightBeforePeriod) / 10;
        }
    }

    const weighted = [...weights].map(([value, weight]) => ({ value, weight }));
    if (outsider.length > 0 && outsiderWeight > 0) weighted.push({ value: '__OUTSIDER__', weight: outsiderWeight });
    const selected = pickWeighted(weighted, random);
    if (selected !== '__OUTSIDER__') return selected;
    return outsider[randomIndex(outsider.length, random)]?.name;
}

export function generateBloodname(
    catalog: PilotNameCatalog,
    options: PilotNameGenerationOptions,
    random: RandomSource = Math.random,
): string | undefined {
    const profile = options.factionId == null ? undefined : catalog.factionProfiles[options.factionId];
    if (!profile?.isClan || !profile.bloodnameClan) return undefined;
    if (random() >= getBloodnameChance(options.isCommander)) return undefined;
    return selectBloodname(
        catalog,
        profile.bloodnameClan,
        resolveBloodnamePhenotype(options.unitType, options.unitSubtype),
        options.era,
        random,
        true,
    );
}

export function getCallsignChance(fullNameLength: number, isAerospace = false): number {
    const baseline = isAerospace ? 0.7 : 0.25;
    const maximum = isAerospace ? 1 : 0.8;
    const normalizedLength = Number.isFinite(fullNameLength) ? Math.max(0, fullNameLength) : 0;
    const extraCharacters = Math.max(0, normalizedLength - TYPICAL_FULL_NAME_LENGTH);
    return Math.min(maximum, baseline + extraCharacters * CALLSIGN_CHANCE_PER_EXTRA_CHARACTER);
}

export function pickWeighted<T>(entries: readonly WeightedValue<T>[], random: RandomSource = Math.random): T | undefined {
    const totalWeight = entries.reduce((sum, entry) => sum + (entry.weight > 0 ? entry.weight : 0), 0);
    if (totalWeight <= 0) return undefined;

    const randomValue = random();
    const normalizedRandom = Number.isFinite(randomValue) ? randomValue : 0;
    const roll = Math.min(Math.max(normalizedRandom, 0), 1 - Number.EPSILON) * totalWeight;
    let cursor = 0;
    for (const entry of entries) {
        if (entry.weight <= 0) continue;
        cursor += entry.weight;
        if (roll < cursor) return entry.value;
    }

    return undefined;
}

/** Uses MegaMek's weighted ethnicity/name selection and MekHQ's callsign placement. Callsign probability is MekBay-specific. */
export function generatePilotName(
    catalog: PilotNameCatalog,
    options: PilotNameGenerationOptions = {},
    random: RandomSource = Math.random,
): string | null {
    const profile = options.factionId == null ? undefined : catalog.factionProfiles[options.factionId];
    const requestedGenerator = profile?.generator ?? 'General';
    const isClanPilot = profile?.isClan ?? false;
    const generator = catalog.factions[requestedGenerator]
        ? requestedGenerator
        : 'General';
    const matrix = catalog.factions[generator];
    if (!matrix) return null;

    const surnameEthnicity = pickWeighted(matrix.surnameEthnicities, random);
    if (surnameEthnicity == null) return null;

    const givenNameEthnicity = pickWeighted(matrix.givenNameEthnicities[surnameEthnicity] ?? [], random);
    if (givenNameEthnicity == null) return null;

    const isFemale = random() < 0.5;
    const givenNames = isFemale ? catalog.femaleGivenNames : catalog.maleGivenNames;
    const givenName = pickWeighted(givenNames[givenNameEthnicity] ?? [], random);
    const surname = isClanPilot ? undefined : pickWeighted(catalog.surnames[surnameEthnicity] ?? [], random);
    if (!givenName || (!isClanPilot && !surname)) return null;

    const bloodname = isClanPilot ? generateBloodname(catalog, options, random) : undefined;
    const familyName = bloodname ?? surname;
    const fullNameLength = [givenName, familyName].filter(Boolean).join(' ').length;
    let includeCallsign = options.includeCallsign;
    if (includeCallsign === undefined) {
        const callsignRoll = random();
        includeCallsign = (Number.isFinite(callsignRoll) ? callsignRoll : 0)
            < getCallsignChance(fullNameLength, options.isAerospace);
    }
    const callsign = includeCallsign ? pickWeighted(catalog.callsigns, random) : undefined;

    return [
        givenName,
        callsign ? `"${callsign}"` : undefined,
        familyName,
    ].filter((part): part is string => !!part).join(' ');
}
