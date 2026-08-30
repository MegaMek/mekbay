// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { XMLParser } from 'fast-xml-parser';
import type {
    BloodnameClan,
    BloodnamePhenotype,
    BloodnameRecord,
    CompactPilotNameCatalog,
    CompactWeightedString,
    PilotFactionNameProfile as PilotFactionProfile,
    PilotNameFactionMatrix,
    WeightedValue,
} from '../src/app/models/pilot-name-catalog.model';
import { parseCsvRows } from './lib/csv';

const {
    loadOptionalEnvFile,
    resolveMmDataRoot,
} = require('./lib/script-paths');

const {
    writeDeterministicFile,
} = require('./lib/deterministic-output');

interface WordListSource {
    key: string;
    fileName: string;
}

type SourceBloodnamePhenotype = 'GENERAL' | 'MEKWARRIOR' | 'AEROSPACE' | 'ELEMENTAL' | 'PROTOMEK' | 'NAVAL';

const APP_ROOT = path.resolve(__dirname, '..');
const RANDOM_COMPANY_NAME_GENERATOR_PATH = path.join(
    'data',
    'universe',
    'backgrounds',
    'randomCompanyNameGenerator'
);
const OUTPUT_PATH = path.join(APP_ROOT, 'public', 'assets', 'force-name-words.json');
const PILOT_NAMES_OUTPUT_PATH = path.join(APP_ROOT, 'public', 'assets', 'pilot-names.json');
const NAMES_PATH = path.join('data', 'names');
const BLOODNAME_CLANS_PATH = path.join(NAMES_PATH, 'bloodnames', 'clans.xml');
const BLOODNAMES_PATH = path.join('data', 'universe', 'bloodnames');
const BLOODNAME_PHENOTYPES: Record<SourceBloodnamePhenotype, BloodnamePhenotype> = {
    GENERAL: '*',
    MEKWARRIOR: 'Mek',
    AEROSPACE: 'Aero',
    ELEMENTAL: 'BA',
    PROTOMEK: 'ProtoMek',
    NAVAL: 'Naval',
};

const BLOODNAME_CLAN_OVERRIDES: Readonly<Record<number, string>> = {
    8: 'CDS',
    91: 'CGS',
    92: 'CGS',
};

const bloodnameXmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name, jpath) => jpath === 'clans.clan'
        || name === 'rivals',
});

function asArray<T>(value: T | T[] | undefined): T[] {
    return value == null ? [] : Array.isArray(value) ? value : [value];
}

function xmlText(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (value && typeof value === 'object' && '#text' in value) return String((value as { '#text': unknown })['#text']).trim();
    return '';
}

function xmlYear(value: unknown, fallback = 0): number {
    const text = xmlText(value);
    if (!text) return fallback;
    if (!/^\d+$/.test(text)) throw new Error(`Invalid Bloodname year: ${text}.`);
    const year = Number(text);
    if (!Number.isSafeInteger(year)) throw new Error(`Invalid Bloodname year: ${text}.`);
    return year;
}

function yamlText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function yamlYear(value: unknown, fallback = 0): number {
    const text = yamlText(value);
    if (!text) return fallback;
    if (!/^\d+$/.test(text)) throw new Error(`Invalid Bloodname year: ${text}.`);
    const year = Number(text);
    if (!Number.isSafeInteger(year)) throw new Error(`Invalid Bloodname year: ${text}.`);
    return year;
}

function requiredYamlYear(value: unknown, context: string): number {
    const text = yamlText(value);
    if (!text) throw new Error(`${context} is missing its date.`);
    return yamlYear(value);
}

function yamlRecord(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} must be a mapping.`);
    }
    return value as Record<string, unknown>;
}

function yamlBoolean(value: unknown, context: string): boolean {
    if (value == null) return false;
    if (typeof value !== 'boolean') throw new Error(`${context} must be true or false.`);
    return value;
}

function yamlTransfer(value: unknown, context: string, yearOffset = 0): { clan: string; year: number } {
    const raw = yamlRecord(value, context);
    const clan = yamlText(raw['clan']);
    if (!clan) throw new Error(`${context} is missing its Clan.`);
    return { clan, year: requiredYamlYear(raw['date'], context) + yearOffset };
}

function yamlTransfers(value: unknown, context: string, yearOffset = 0): { clan: string; year: number }[] {
    return asArray(value).map((entry, index) => yamlTransfer(entry, `${context} ${index + 1}`, yearOffset));
}

function listBloodnameYamlFiles(directory: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...listBloodnameYamlFiles(entryPath));
        else if (entry.isFile() && entry.name.endsWith('.yml')) files.push(entryPath);
    }
    return files;
}

// MUL umbrella factions can contain MegaMek factions with different generators.
// Keep the intended aggregate choice explicit instead of depending on input order.
const MUL_NAME_GENERATOR_OVERRIDES: Readonly<Record<number, string>> = {
    5: 'CC',
    27: 'DC',
    29: 'FS',
    30: 'FWL',
    41: 'General',
    55: 'General',
    57: 'General',
    60: 'LA',
    86: 'Clan',
    87: 'General',
};

const WORD_LIST_SOURCES: WordListSource[] = [
    { key: 'middleWordCorporate', fileName: 'middleWordCorporate.csv' },
    { key: 'endWordCorporate', fileName: 'endWordCorporate.csv' },
    { key: 'middleWordMercenary', fileName: 'middleWordMercenary.csv' },
    { key: 'endWordMercenary', fileName: 'endWordMercenary.csv' },
    { key: 'preFab', fileName: 'preFab.csv' },
];

const EXCLUDED_WORDS = new Set([
    'Test Name',
    'Your Name Here',
]);

loadOptionalEnvFile(APP_ROOT, { logPrefix: 'Force Name Words' });

export function parseWeight(rawWeight: string, filePath: string, rowNumber: number): number {
    const normalizedWeight = rawWeight.trim();
    if (!/^[0-9]+$/.test(normalizedWeight)) {
        throw new Error(`${filePath}:${rowNumber} has invalid Weight value: ${rawWeight}`);
    }

    return Number.parseInt(normalizedWeight, 10);
}

function readEthnicityCount(filePath: string): number {
    const rows = parseCsvRows(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (rows.length === 0) {
        throw new Error(`${filePath} must contain ethnicity rows.`);
    }

    const startIndex = /^[0-9]+$/.test(rows[0][0]?.trim() ?? '') ? 0 : 1;
    const codes = rows.slice(startIndex).map((row, index) => parseWeight(row[0] ?? '', filePath, index + startIndex + 1));
    if (codes.length === 0 || codes.some((code, index) => code !== index + 1)) {
        throw new Error(`${filePath} must contain sequential ethnicity codes starting at 1.`);
    }

    return codes.length;
}

export function readWeightedNames(filePath: string): Record<number, WeightedValue<string>[]> {
    const rows = parseCsvRows(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (rows.length < 2) {
        throw new Error(`${filePath} must contain a header and name rows.`);
    }

    const namesByEthnicity = new Map<number, Map<string, number>>();
    for (let index = 1; index < rows.length; index += 1) {
        const [rawCode = '', name = '', rawWeight = ''] = rows[index];
        if (rows[index].length < 3 || !rawCode.trim() || !rawWeight.trim()) {
            throw new Error(`${filePath}:${index + 1} must contain Ethnic Code, Name, and Weight.`);
        }

        const ethnicCode = parseWeight(rawCode, filePath, index + 1);
        const weight = parseWeight(rawWeight, filePath, index + 1);
        // mm-data contains explicit blank-name placeholders. They carry no usable value.
        if (!name.trim()) continue;
        const names = namesByEthnicity.get(ethnicCode) ?? new Map<string, number>();
        names.set(name.trim(), weight);
        namesByEthnicity.set(ethnicCode, names);
    }

    return Object.fromEntries([...namesByEthnicity].map(([code, names]) => [
        code,
        [...names]
            .filter(([, weight]) => weight > 0)
            .map(([value, weight]) => ({ value, weight })),
    ])) as Record<number, WeightedValue<string>[]>;
}

export function readCallsigns(filePath: string): WeightedValue<string>[] {
    const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const callsigns = new Map<string, number>();

    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) continue;
        const separator = line.lastIndexOf(',');
        if (separator <= 0) {
            throw new Error(`${filePath}:${index + 1} must contain Callsign and Weight.`);
        }

        const value = line.slice(0, separator).trim();
        if (!value) throw new Error(`${filePath}:${index + 1} has an empty Callsign.`);
        const rawWeight = line.slice(separator + 1);
        // mm-data uses an empty weight to disable a callsign without deleting its row.
        if (!rawWeight.trim()) continue;
        const weight = parseWeight(rawWeight, filePath, index + 1);
        callsigns.set(value, weight);
    }

    return [...callsigns]
        .filter(([, weight]) => weight > 0)
        .map(([value, weight]) => ({ value, weight }));
}

export function readFactionMatrices(
    directory: string,
    ethnicityCount: number,
    nameGroups?: {
        maleGivenNames: Record<number, WeightedValue<string>[]>;
        femaleGivenNames: Record<number, WeightedValue<string>[]>;
        surnames: Record<number, WeightedValue<string>[]>;
    },
): Record<string, PilotNameFactionMatrix> {
    const result: Record<string, PilotNameFactionMatrix> = {};

    for (const fileName of fs.readdirSync(directory).filter((name) => name.endsWith('.csv')).sort()) {
        const filePath = path.join(directory, fileName);
        const surnameEthnicities: WeightedValue<number>[] = [];
        const givenNameEthnicities: Record<number, WeightedValue<number>[]> = {};
        const rows = parseCsvRows(fs.readFileSync(filePath, 'utf8'));
        const startIndex = rows.length > 0 && !/^[0-9]+$/.test(rows[0][0]?.trim() ?? '') ? 1 : 0;
        const seenEthnicities = new Set<number>();

        for (let index = startIndex; index < rows.length; index += 1) {
            const row = rows[index];
            if (row.length < ethnicityCount + 3) {
                throw new Error(`${filePath}:${index + 1} does not contain all ethnicity weights.`);
            }

            const ethnicCode = parseWeight(row[0], filePath, index + 1);
            if (ethnicCode < 1 || ethnicCode > ethnicityCount) {
                throw new Error(`${filePath}:${index + 1} has out-of-range ethnicity code ${ethnicCode}.`);
            }
            if (seenEthnicities.has(ethnicCode)) {
                throw new Error(`${filePath}:${index + 1} duplicates ethnicity code ${ethnicCode}.`);
            }
            seenEthnicities.add(ethnicCode);
            const surnameWeight = parseWeight(row[2], filePath, index + 1);
            if (surnameWeight > 0) {
                if (nameGroups && !nameGroups.surnames[ethnicCode]?.length) {
                    throw new Error(`${filePath}:${index + 1} references missing surname ethnicity ${ethnicCode}.`);
                }
                surnameEthnicities.push({ value: ethnicCode, weight: surnameWeight });
            }

            givenNameEthnicities[ethnicCode] = row.slice(3, 3 + ethnicityCount)
                .map((weight, ethnicityIndex) => ({
                    value: ethnicityIndex + 1,
                    weight: parseWeight(weight, filePath, index + 1),
                }))
                .filter((entry) => entry.weight > 0);
            if (surnameWeight > 0 && givenNameEthnicities[ethnicCode].length === 0) {
                throw new Error(`${filePath}:${index + 1} has no usable given-name ethnicity weights.`);
            }
            for (const entry of givenNameEthnicities[ethnicCode]) {
                if (nameGroups && (!nameGroups.maleGivenNames[entry.value]?.length || !nameGroups.femaleGivenNames[entry.value]?.length)) {
                    throw new Error(`${filePath}:${index + 1} references incomplete given-name ethnicity ${entry.value}.`);
                }
            }
        }

        if (surnameEthnicities.length === 0) throw new Error(`${filePath} has no usable surname ethnicity weights.`);

        result[path.basename(fileName, '.csv')] = { surnameEthnicities, givenNameEthnicities };
    }

    return result;
}

export function readMulFactionNameGenerators(
    mmDataRoot: string,
    mappingPath = path.join(APP_ROOT, 'scripts', 'config', 'factions-mm-to-mul.csv'),
    overrides: Readonly<Record<number, string>> = MUL_NAME_GENERATOR_OVERRIDES,
): Record<number, string> {
    const nameGeneratorByFaction = new Map<string, string>();
    const factionDirectory = path.join(mmDataRoot, 'data', 'universe', 'factions');

    for (const fileName of fs.readdirSync(factionDirectory).filter((name) => name.endsWith('.yml')).sort()) {
        const raw = yaml.load(fs.readFileSync(path.join(factionDirectory, fileName), 'utf8')) as Record<string, unknown>;
        const key = String(raw['key'] ?? '');
        if (key) nameGeneratorByFaction.set(key, String(raw['nameGenerator'] ?? 'General'));
    }

    const generatorsByMulId = new Map<number, Set<string>>();
    const rows = parseCsvRows(fs.readFileSync(mappingPath, 'utf8'));
    for (const row of rows.slice(1)) {
        const factionKey = row[0]?.trim();
        const generator = nameGeneratorByFaction.get(factionKey);
        if (!generator) continue;

        for (const rawMulId of (row[1] ?? '').split(/[|;]/)) {
            const mulId = Number.parseInt(rawMulId.trim(), 10);
            if (mulId > 0) {
                const generators = generatorsByMulId.get(mulId) ?? new Set<string>();
                generators.add(generator);
                generatorsByMulId.set(mulId, generators);
            }
        }
    }

    return Object.fromEntries([...generatorsByMulId].map(([mulId, generators]) => {
        if (generators.size === 1) return [mulId, [...generators][0]];
        const override = overrides[mulId];
        if (!override || !generators.has(override)) {
            throw new Error(`MUL faction ${mulId} has conflicting name generators: ${[...generators].sort().join(', ')}`);
        }
        return [mulId, override];
    })) as Record<number, string>;
}

export function readBloodnameData(mmDataRoot: string): { clans: Record<string, BloodnameClan>; bloodnames: BloodnameRecord[] } {
    const clanDocument = bloodnameXmlParser.parse(fs.readFileSync(path.join(mmDataRoot, BLOODNAME_CLANS_PATH), 'utf8')) as { clans?: { clan?: Record<string, unknown>[] } };
    const clanEntries = asArray(clanDocument.clans?.clan).map((raw) => {
        const code = xmlText(raw['code']);
        if (!code) throw new Error('Bloodname Clan is missing its code.');
        const rivals = asArray(raw['rivals'] as Record<string, unknown>[]).flatMap((entry) =>
            xmlText(entry).split(',').map((rival) => rival.trim()).filter(Boolean).map((rival) => ({
                code: rival,
                start: xmlYear(entry['start'], 2807),
                end: xmlYear(entry['end'], 9999),
            })));
        const clan = {
            code,
            generationCode: xmlText(raw['generateAsIf']) || code,
            start: xmlYear(raw['start'], 2807),
            end: xmlYear(raw['end'], 9999),
            homeClan: Object.hasOwn(raw, 'homeClan'),
            rivals,
        } satisfies BloodnameClan;
        if (clan.start > clan.end) throw new Error(`Clan ${code} starts after it ends.`);
        for (const rival of rivals) {
            if (rival.start > rival.end) throw new Error(`Clan ${code} rival ${rival.code} starts after it ends.`);
        }
        return [code, clan] as const;
    });
    const clanCodes = new Set<string>();
    for (const [code] of clanEntries) {
        if (clanCodes.has(code)) throw new Error(`Duplicate Bloodname Clan ${code}.`);
        clanCodes.add(code);
    }
    const clans = Object.fromEntries(clanEntries);
    for (const clan of Object.values(clans)) {
        if (!clans[clan.generationCode]) throw new Error(`Clan ${clan.code} references unknown generation Clan ${clan.generationCode}.`);
        for (const rival of clan.rivals) {
            if (!clans[rival.code]) throw new Error(`Clan ${clan.code} references unknown rival Clan ${rival.code}.`);
        }
    }

    const bloodnames = listBloodnameYamlFiles(path.join(mmDataRoot, BLOODNAMES_PATH)).flatMap((filePath) => {
        const document = yamlRecord(yaml.load(fs.readFileSync(filePath, 'utf8')), `Bloodname file ${filePath}`);
        const name = yamlText(document['name']);
        const clan = yamlText(document['clan']);
        if (!name || !clans[clan]) throw new Error(`Bloodname ${name || '<unnamed>'} references unknown Clan ${clan || '<empty>'}.`);
        const houses = document['houses'];
        if (!Array.isArray(houses) || houses.length === 0) throw new Error(`Bloodname ${name} must contain at least one House.`);

        return houses.map((house, index): BloodnameRecord => {
            const context = `Bloodname ${name} House ${index + 1}`;
            const raw = yamlRecord(house, context);
            const sourcePhenotype = (yamlText(raw['phenotype']) || 'GENERAL') as SourceBloodnamePhenotype;
            const phenotype = BLOODNAME_PHENOTYPES[sourcePhenotype];
            if (!phenotype) throw new Error(`Bloodname ${name} has unsupported phenotype ${sourcePhenotype}.`);
            const record: BloodnameRecord = {
                name,
                clan,
                phenotype,
                exclusive: yamlBoolean(raw['exclusive'], `${context} exclusive`),
                limited: yamlBoolean(raw['limited'], `${context} limited`),
                start: raw['created'] == null ? 2807 : yamlYear(raw['created']) + 20,
                inactive: raw['dormant'] != null ? yamlYear(raw['dormant']) + 10 : yamlYear(raw['reaved']),
                abjured: yamlYear(raw['abjured']),
                reactivated: raw['reactivated'] == null ? 0 : yamlYear(raw['reactivated']) + 20,
                postReaving: asArray(raw['postReaving']).flatMap((entry) =>
                    yamlText(entry).split(',').map((code) => code.trim()).filter(Boolean)),
                acquired: [
                    ...yamlTransfers(raw['acquired'], `Bloodname ${name} acquisition`, 10),
                    ...yamlTransfers(raw['shared'], `Bloodname ${name} sharing`),
                ],
                absorbed: raw['absorbed'] == null
                    ? undefined
                    : yamlTransfer(raw['absorbed'], `Bloodname ${name} absorption`),
            };
            for (const relationship of [
                ...record.postReaving.map((code) => ({ code, kind: 'post-Reaving' })),
                ...record.acquired.map((entry) => ({ code: entry.clan, kind: 'acquired/shared' })),
                ...(record.absorbed ? [{ code: record.absorbed.clan, kind: 'absorbing' }] : []),
            ]) {
                if (!clans[relationship.code]) throw new Error(`Bloodname ${name} references unknown ${relationship.kind} Clan ${relationship.code}.`);
            }
            if (record.reactivated > 0 && record.inactive === 0) throw new Error(`Bloodname ${name} reactivates without becoming inactive.`);
            if (record.reactivated > 0 && record.reactivated <= record.inactive) throw new Error(`Bloodname ${name} reactivates before its inactive period.`);
            return record;
        });
    });
    return { clans, bloodnames };
}

export function buildPilotFactionProfiles(
    generators: Record<number, string>,
    mappingPath: string,
    mulFactionsPath: string,
    clanCodes: ReadonlySet<string>,
): Record<number, PilotFactionProfile> {
    const groups = new Map(parseCsvRows(fs.readFileSync(mulFactionsPath, 'utf8')).slice(1)
        .map((row) => [Number.parseInt(row[0], 10), row[2]?.trim()] as const));
    const bloodnameClanByMul = new Map<number, string>();
    for (const row of parseCsvRows(fs.readFileSync(mappingPath, 'utf8')).slice(1)) {
        const code = row[0]?.trim();
        if (!clanCodes.has(code)) continue;
        for (const rawId of (row[1] ?? '').split(/[|;]/)) {
            const id = Number.parseInt(rawId, 10);
            if (id > 0) bloodnameClanByMul.set(id, code);
        }
    }
    for (const [id, code] of Object.entries(BLOODNAME_CLAN_OVERRIDES)) bloodnameClanByMul.set(Number(id), code);

    return Object.fromEntries([...groups].filter(([id]) => id > 0).map(([id, group]) => {
        const isClan = group === 'IS Clan' || group === 'HW Clan' || bloodnameClanByMul.has(id);
        const generator = generators[id] ?? (isClan ? 'Clan' : 'General');
        const bloodnameClan = isClan ? bloodnameClanByMul.get(id) : undefined;
        return [id, { generator, isClan, ...(bloodnameClan ? { bloodnameClan } : {}) }];
    }));
}

function compactWeightedStrings(entries: WeightedValue<string>[]): CompactWeightedString[] {
    return entries.map(({ value, weight }) => weight === 1 ? value : [value, weight]);
}

function compactNameGroups(
    groups: Record<number, WeightedValue<string>[]>,
    ethnicityCount: number,
): CompactWeightedString[][] {
    return Array.from({ length: ethnicityCount }, (_, index) => compactWeightedStrings(groups[index + 1] ?? []));
}

export function compactPilotNameCatalog(
    catalog: {
        maleGivenNames: Record<number, WeightedValue<string>[]>;
        femaleGivenNames: Record<number, WeightedValue<string>[]>;
        surnames: Record<number, WeightedValue<string>[]>;
        factions: Record<string, PilotNameFactionMatrix>;
        factionProfiles: Record<number, PilotFactionProfile>;
        callsigns: WeightedValue<string>[];
        bloodnameClans: Record<string, BloodnameClan>;
        bloodnames: BloodnameRecord[];
    },
    ethnicityCount: number,
): CompactPilotNameCatalog {
    const factionEntries = Object.entries(catalog.factions);
    const factionIndexByGenerator = new Map(factionEntries.map(([generator], index) => [generator, index]));
    const factions: CompactPilotNameCatalog['f'] = factionEntries.map(([generator, matrix]) => {
        const surnameWeights = Array<number>(ethnicityCount).fill(0);
        for (const entry of matrix.surnameEthnicities) surnameWeights[entry.value - 1] = entry.weight;
        const givenNameWeights = Array.from({ length: ethnicityCount }, (_, surnameIndex) => {
            const weights = Array<number>(ethnicityCount).fill(0);
            for (const entry of matrix.givenNameEthnicities[surnameIndex + 1] ?? []) {
                weights[entry.value - 1] = entry.weight;
            }
            return weights;
        });
        return [generator, surnameWeights, givenNameWeights];
    });

    const mappings = Object.entries(catalog.factionProfiles).map(([rawMulId, profile]) => {
        const factionIndex = factionIndexByGenerator.get(profile.generator);
        if (factionIndex === undefined) throw new Error(`Missing faction matrix for name generator ${profile.generator}.`);
        return [Number(rawMulId), factionIndex, profile.isClan ? 1 : 0, ...(profile.bloodnameClan ? [profile.bloodnameClan] : [])] as [number, number, 0 | 1, string?];
    });

    return {
        v: 1,
        n: [
            compactNameGroups(catalog.maleGivenNames, ethnicityCount),
            compactNameGroups(catalog.femaleGivenNames, ethnicityCount),
            compactNameGroups(catalog.surnames, ethnicityCount),
        ],
        c: compactWeightedStrings(catalog.callsigns),
        f: factions,
        m: mappings,
        bc: Object.values(catalog.bloodnameClans).map((clan) => [
            clan.code, clan.generationCode === clan.code ? 0 : clan.generationCode,
            clan.start, clan.end, clan.homeClan ? 1 : 0,
            clan.rivals.map((rival) => [rival.code, rival.start, rival.end]),
        ]),
        b: catalog.bloodnames.map((bloodname) => [
            bloodname.name, bloodname.clan, bloodname.phenotype,
            (bloodname.exclusive ? 1 : 0) | (bloodname.limited ? 2 : 0),
            bloodname.start, bloodname.inactive, bloodname.abjured, bloodname.reactivated,
            bloodname.postReaving,
            bloodname.acquired.map((entry) => [entry.clan, entry.year]),
            bloodname.absorbed ? [bloodname.absorbed.clan, bloodname.absorbed.year] : 0,
        ]),
    };
}

function readWeightedWords(filePath: string): string[] {
    const rows = parseCsvRows(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (rows.length < 2) {
        throw new Error(`${filePath} must contain a header and at least one word row.`);
    }

    const header = rows[0].map(cell => cell.trim());
    const wordIndex = header.indexOf('Word');
    const weightIndex = header.indexOf('Weight');
    if (wordIndex === -1 || weightIndex === -1) {
        throw new Error(`${filePath} must contain Word and Weight columns.`);
    }

    const words: string[] = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const hasExtraColumns = row.length > header.length && wordIndex === 0 && weightIndex === 1;
        const word = (hasExtraColumns ? row.slice(0, -1).join(',') : row[wordIndex] ?? '').trim();
        if (!word || EXCLUDED_WORDS.has(word)) continue;

        const rawWeight = hasExtraColumns ? row[row.length - 1] : row[weightIndex] ?? '1';
        const weight = parseWeight(rawWeight, filePath, rowIndex + 1);
        for (let count = 0; count < weight; count += 1) {
            words.push(word);
        }
    }

    if (words.length === 0) {
        throw new Error(`${filePath} did not contain any usable words.`);
    }

    return words;
}

function main(): void {
    const mmDataRoot = resolveMmDataRoot(APP_ROOT);
    const inputRoot = path.join(mmDataRoot, RANDOM_COMPANY_NAME_GENERATOR_PATH);
    const wordsByKey: Record<string, unknown> = {};

    for (const source of WORD_LIST_SOURCES) {
        const filePath = path.join(inputRoot, source.fileName);
        const words = readWeightedWords(filePath);
        wordsByKey[source.key] = words;
        console.log(`[Force Name Words] Loaded ${words.length} entries from ${filePath}`);
    }

    const namesRoot = path.join(mmDataRoot, NAMES_PATH);
    const ethnicityCount = readEthnicityCount(path.join(namesRoot, 'historicalEthnicity.csv'));
    const nameGroups = {
        maleGivenNames: readWeightedNames(path.join(namesRoot, 'maleGivenNames.csv')),
        femaleGivenNames: readWeightedNames(path.join(namesRoot, 'femaleGivenNames.csv')),
        surnames: readWeightedNames(path.join(namesRoot, 'surnames.csv')),
    };
    const nameGenerators = readMulFactionNameGenerators(mmDataRoot);
    const bloodnameData = readBloodnameData(mmDataRoot);
    const pilotNames = {
        ...nameGroups,
        factions: readFactionMatrices(path.join(namesRoot, 'factions'), ethnicityCount, nameGroups),
        factionProfiles: buildPilotFactionProfiles(
            nameGenerators,
            path.join(APP_ROOT, 'scripts', 'config', 'factions-mm-to-mul.csv'),
            path.join(APP_ROOT, 'scripts', 'config', 'mulfactions.csv'),
            new Set(Object.keys(bloodnameData.clans)),
        ),
        callsigns: readCallsigns(path.join(namesRoot, 'callsigns.csv')),
        bloodnameClans: bloodnameData.clans,
        bloodnames: bloodnameData.bloodnames,
    };

    writeDeterministicFile(OUTPUT_PATH, `${JSON.stringify(wordsByKey)}\n`);
    console.log(`[Force Name Words] Generated ${OUTPUT_PATH}`);
    writeDeterministicFile(PILOT_NAMES_OUTPUT_PATH, `${JSON.stringify(compactPilotNameCatalog(pilotNames, ethnicityCount))}\n`);
    console.log(`[Force Name Words] Generated ${PILOT_NAMES_OUTPUT_PATH}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error('[Force Name Words] Error:', error);
        process.exit(1);
    }
}

