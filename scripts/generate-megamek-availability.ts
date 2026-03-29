import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import { load as loadYaml } from 'js-yaml';

const {
    loadOptionalEnvFile,
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

type JsonObject = Record<string, unknown>;
type CompactAvailabilityByRating = [number, number, number, number, number];
type CompactAvailabilityValue = number | `${number}+` | `${number}-` | CompactAvailabilityByRating;
type CompactWeightedByRating = [number, number, number, number, number];
type CompactWeightedValue = number | CompactWeightedByRating;
type AvailabilityWeightedQName = 'X' | 'R' | 'U' | 'C' | 'I';
type CompactWeightedQByRating = [AvailabilityWeightedQName, AvailabilityWeightedQName, AvailabilityWeightedQName, AvailabilityWeightedQName, AvailabilityWeightedQName];
type CompactWeightedQValue = AvailabilityWeightedQName | CompactWeightedQByRating;

interface DateRange {
    start?: number;
    end?: number;
}

interface YearKeyedChange {
    year: number;
    name: string;
}

interface FactionLeader {
    title: string;
    firstName: string;
    surname: string;
    gender?: string;
    honorific?: string;
    startYear?: number;
    endYear?: number;
}

type RgbColor = [number, number, number];

interface UniverseFactionRecord {
    id: string;
    name: string;
    mulId: number[];
    filename: string;
    isCommand: boolean;
    yearsActive: DateRange[];
    ratingLevels: string[];
    fallBackFactions: string[];
    tags: string[];
    nameChanges: YearKeyedChange[];
    capital?: string;
    capitalChanges?: YearKeyedChange[];
    color?: RgbColor;
    logo?: string;
    camos?: string;
    nameGenerator?: string;
    eraMods?: number[];
    rankSystem?: string;
    factionLeaders?: FactionLeader[];
    successor?: string;
    preInvasionHonorRating?: string;
    postInvasionHonorRating?: string;
    formationBaseSize?: number;
    formationGrouping?: number;
}

interface MegaMekEra {
    code: string;
    name: string;
    startYear?: number;
    endYear?: number;
    mulId?: number;
    icon?: string;
}

interface ParsedAvailability {
    factionKey: string;
    fileYear: number;
    entryYear?: number;
    baseAvailability?: number;
    ratingAdjustment: -1 | 0 | 1;
    byRating?: Record<string, number>;
}

type CompactEraAvailability = Record<string, CompactAvailabilityValue>;
type CompactWeightedEraAvailability = Record<string, CompactWeightedValue>;

interface CompactAvailabilityRecordBase {
    t: string;
    c: string;
    o?: 'Clan' | 'IS';
    e: Record<string, CompactEraAvailability>;
}

interface CompactChassisRecord extends CompactAvailabilityRecordBase {}

interface CompactModelRecord extends CompactAvailabilityRecordBase {
    m: string;
}

type CompactAvailabilityRecord = CompactChassisRecord | CompactModelRecord;

interface CompactWeightedModelRecord {
    t: string;
    c: string;
    m: string;
    e: Record<string, CompactWeightedEraAvailability>;
}

interface CompactWeightedQModelRecord {
    t: string;
    c: string;
    m: string;
    e: Record<string, Record<string, CompactWeightedQValue>>;
}

interface EraFactionStats {
    pctOmni?: number[];
    pctOmniAero?: number[];
    pctClan?: number[];
    pctClanAero?: number[];
    pctClanVehicle?: number[];
    pctSL?: number[];
    pctSLAero?: number[];
    pctSLVehicle?: number[];
    omniMargin?: number;
    techMargin?: number;
    upgradeMargin?: number;
    salvage?: {
        pct: number;
        weights: Record<string, number>;
    };
    weightDistribution?: Record<string, number[]>;
}

interface RulesetRecord {
    factionKey: string;
    parentFaction?: string;
    ratingSystem?: string;
    document: JsonObject;
    forceCount: number;
}

interface FactionMulIdConfig {
    mappedIds: Map<string, number[]>;
    skippedFactions: Set<string>;
}

interface MegaMekAvailabilitySharedMetadata {
    version: 2;
    generatedAt: string;
    generator: string;
    source: {
        type: 'MegaMek';
        mmDataPath: string;
        paths: {
            universeFactions: string;
            universeCommands: string;
            universeEras: string;
            forceGenerator: string;
            forceGeneratorRules: string;
        };
    };
    summary: {
        factionCount: number;
        commandCount: number;
        forceGeneratorEraCount: number;
        megaMekEraCount: number;
        chassisCount: number;
        modelCount: number;
    };
}

interface MegaMekAvailabilityExport extends MegaMekAvailabilitySharedMetadata {
    eras: {
        eras: MegaMekEra[];
        forceGenerator: Record<string, number[]>;
    };
    factions: Record<string, UniverseFactionRecord & { ancestry: string[] }>;
    factionEraData: Record<string, Record<string, EraFactionStats>>;
    chassis: Record<string, CompactChassisRecord>;
    models: Record<string, CompactModelRecord>;
    availability: Record<string, CompactModelRecord>;
}

const BEAUTIFY_OUTPUT = true;
const JSON_INDENT = 2;
const INLINE_JSON_ARRAY_MAX_ITEMS = 8;
const INLINE_JSON_ARRAY_MAX_LENGTH = 40;
const OUTPUT_DECIMAL_PLACES = 1;
const WEIGHTED_Q_BUCKETS = ['R', 'U', 'C', 'I'] as const;
const USE_ERA_CODE_KEYS = true;
const APP_ROOT = path.resolve(__dirname, '..');

loadOptionalEnvFile(APP_ROOT, { logPrefix: 'MegaMek' });

const MM_DATA_ROOT = resolveMmDataRoot(APP_ROOT);
const UNIVERSE_ROOT = path.join(MM_DATA_ROOT, 'data', 'universe');
const FORCEGEN_ROOT = path.join(MM_DATA_ROOT, 'data', 'forcegenerator');
const FACTIONS_MM_TO_MUL_PATH = path.join(APP_ROOT, 'scripts', 'config', 'factions-mm-to-mul.csv');
const MM_FACTIONS_IMAGE_DIR = path.join(APP_ROOT, 'public', 'images', 'mmfactions');
const OUTPUT_DIR = path.join(APP_ROOT, 'public', 'assets');
const EXPAND_RATING_ADJUSTMENTS = true;
const GENERAL_FACTION_KEY = 'General';
type UnitType =
    | 'Aero'
    | 'Handheld Weapon'
    | 'Infantry'
    | 'Mek'
    | 'Naval'
    | 'ProtoMek'
    | 'Tank'
    | 'VTOL';

const COMPILED_UNIT_TYPE_BY_XML_UNIT_TYPE: Record<string, UnitType> = {
    Mek: 'Mek',
    Tank: 'Tank',
    BattleArmor: 'Infantry',
    Infantry: 'Infantry',
    ProtoMek: 'ProtoMek',
    VTOL: 'VTOL',
    Naval: 'Naval',
    'Conventional Fighter': 'Aero',
    AeroSpaceFighter: 'Aero',
    'Small Craft': 'Aero',
    Dropship: 'Aero',
    Jumpship: 'Aero',
    Warship: 'Aero',
    'Space Station': 'Aero',
};

const VALID_XML_UNIT_TYPES = new Set(Object.keys(COMPILED_UNIT_TYPE_BY_XML_UNIT_TYPE));
const DEFAULT_CANONICAL_RATINGS = ['F', 'D', 'C', 'B', 'A'] as const;
const CANONICAL_RATING_INDEX: Record<(typeof DEFAULT_CANONICAL_RATINGS)[number], number> = {
    F: 0,
    D: 1,
    C: 2,
    B: 3,
    A: 4,
};
const RATING_ALIASES_BY_CANONICAL: Record<
    (typeof DEFAULT_CANONICAL_RATINGS)[number],
    string[]
> = {
    F: ['F', 'PROVISIONAL GARRISON', 'PG'],
    D: ['D', 'SOLAHMA'],
    C: ['C', 'SECOND LINE'],
    B: ['B', 'FRONT LINE'],
    A: ['A', 'KESHIK'],
};

interface ResolvedFactionRatingProfile {
    sourceLevels: string[];
    canonicalLevels: (typeof DEFAULT_CANONICAL_RATINGS)[number][];
}

function getFactionLogoFilename(factionKey: string): string | undefined {
    const fileName = `${factionKey}.png`;
    const filePath = path.join(MM_FACTIONS_IMAGE_DIR, fileName);
    return fs.existsSync(filePath) ? fileName : undefined;
}

function shouldTreatXmlNodeAsArray(name: string, jpath: unknown): boolean {
    const pathKey = typeof jpath === 'string' ? jpath : '';
    return [
        'eras.era',
        'ruleset.customRanks.rank',
        'ruleset.defaults.unitType',
        'ruleset.defaults.echelon',
        'ruleset.defaults.rankSystem',
        'ruleset.defaults.rating',
        'ruleset.toc.unitType.option',
        'ruleset.toc.echelon.option',
        'ruleset.toc.rating.option',
        'ruleset.toc.flags.option',
        'ruleset.force',
    ].includes(pathKey)
        || name === 'option'
        || name === 'subforceOption'
        || name === 'subforce'
        || name === 'name'
        || name === 'co'
        || name === 'xo'
        || name === 'ruleGroup'
        || name === 'subforces'
        || name === 'attachedForces';
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name, jpath) => shouldTreatXmlNodeAsArray(name, jpath),
});

const rulesetXmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name, jpath) => shouldTreatXmlNodeAsArray(name, jpath),
});

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function normalizeTextList(value: unknown): string[] {
    return ensureArray(value)
        .flatMap((entry) => {
            if (typeof entry === 'string') {
                return entry.split(',');
            }

            if (entry && typeof entry === 'object') {
                const record = entry as Record<string, unknown>;
                if (typeof record['#text'] === 'string') {
                    return record['#text'].split(',');
                }

                if ('name' in record) {
                    return [String(record.name)];
                }

                return [];
            }

            return [String(entry)];
        })
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function parseDateBetweenAttribute(value: string): { fromYear?: number; toYear?: number } {
    const [fromRaw = '', toRaw = ''] = value.split(',', 2);
    const fromYear = parseYear(fromRaw);
    const toYear = parseYear(toRaw);

    return {
        fromYear,
        toYear,
    };
}

const ECHELON_TOKEN_RE = /^([0-9]+|%[A-Z_]+%)([+\-^])?$/;
const CONSTANT_TOKEN_RE = /^%([A-Z_]+)%$/;

const PREDICATE_ATTR_NAMES = new Set([
    'ifUnitType', 'ifWeightClass', 'ifRating', 'ifEschelon',
    'ifFormation', 'ifRole', 'ifMotive', 'ifAugmented',
    'ifDateBetween', 'ifYearBetween', 'ifTopLevel', 'ifName',
    'ifFaction', 'ifFlags', 'ifIndex',
]);

const ASSERTION_ATTR_NAMES = new Set([
    'unitType', 'weightClass', 'rating', 'formation', 'role',
    'motive', 'augmented', 'chassis', 'model', 'variant',
    'name', 'fluffName', 'faction', 'flags',
]);

function parseEchelonToken(raw: string): JsonObject {
    const token = raw.trim();
    const match = token.match(ECHELON_TOKEN_RE);
    if (!match) {
        return { echelon: normalizeConstantToken(token) };
    }

    const result: JsonObject = { echelon: normalizeConstantToken(match[1]) };
    if (match[2] === '^') {
        result.augmented = true;
    } else if (match[2] === '+') {
        result.modifier = 'R';
    } else if (match[2] === '-') {
        result.modifier = 'US';
    }
    return result;
}

function isEchelonList(text: string): boolean {
    const tokens = text.split(',');
    return tokens.length > 0 && tokens.every((t) => ECHELON_TOKEN_RE.test(t.trim()));
}

function normalizeConstantToken(value: string): string {
    const match = value.trim().match(CONSTANT_TOKEN_RE);
    return match ? match[1] : value.trim();
}

function splitDelimitedValues(value: string, delimiter = ','): string[] {
    return value.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function parseBooleanToken(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no'].includes(normalized)) {
        return false;
    }
    return undefined;
}

function parseCodeLabelToken(raw: string): JsonObject {
    const [codePart, ...labelParts] = raw.split(':');
    const code = normalizeConstantToken(codePart);
    const label = labelParts.join(':').trim();
    return label ? { code, label } : { code };
}

function parseCodeLabelList(value: string): JsonObject[] {
    return splitDelimitedValues(value).map((entry) => parseCodeLabelToken(entry));
}

function parseStringList(value: string): string[] {
    return splitDelimitedValues(value).map((entry) => normalizeConstantToken(entry));
}

function parseEchelonList(value: string): JsonObject[] {
    return splitDelimitedValues(value).map((entry) => parseEchelonToken(entry));
}

function parseSingleEchelon(value: string): JsonObject | string {
    const parsed = parseEchelonList(value);
    return parsed.length === 1 ? parsed[0] : value.trim();
}

function mergeNormalizedContent(target: JsonObject, content: unknown): void {
    if (content === undefined) {
        return;
    }

    if (content && typeof content === 'object' && !Array.isArray(content)) {
        Object.assign(target, content as JsonObject);
        return;
    }

    target.value = content;
}

function normalizeRulesetScalar(raw: string, path: string[]): unknown {
    const nodeName = path[path.length - 1] || '';
    const parentName = path[path.length - 2] || '';
    const trimmed = raw.trim();

    if (trimmed === '') {
        if ([
            'option', 'subforce', 'name', 'co', 'xo', 'unitType', 'echelon',
            'rankSystem', 'rating', 'weightClass', 'formation', 'role',
            'motive', 'flags', 'chassis', 'variant', 'changeEschelon', 'rank',
        ].includes(nodeName)) {
            return {};
        }
        return '';
    }

    if (nodeName === 'asParent') {
        return true;
    }

    if (nodeName === 'asFaction') {
        return normalizeConstantToken(trimmed);
    }

    if (nodeName === 'base') {
        return normalizeConstantToken(trimmed);
    }

    if (nodeName === 'rank') {
        return parseCodeLabelToken(trimmed);
    }

    if (nodeName === 'co' || nodeName === 'xo') {
        return { rank: normalizeConstantToken(trimmed) };
    }

    if (nodeName === 'name') {
        return { name: trimmed };
    }

    if (nodeName === 'subforce') {
        return { echelon: parseSingleEchelon(trimmed) };
    }

    if (nodeName === 'unitType' || (nodeName === 'option' && parentName === 'unitType')) {
        return { unitTypes: parseStringList(trimmed) };
    }

    if (nodeName === 'echelon' || (nodeName === 'option' && parentName === 'echelon')) {
        return { echelons: parseEchelonList(trimmed) };
    }

    if (nodeName === 'rankSystem') {
        return { rankSystems: parseStringList(trimmed) };
    }

    if (nodeName === 'rating' || (nodeName === 'option' && parentName === 'rating')) {
        return { ratings: parseCodeLabelList(trimmed) };
    }

    if (nodeName === 'weightClass' || (nodeName === 'option' && parentName === 'weightClass')) {
        return { weightClasses: parseStringList(trimmed) };
    }

    if (nodeName === 'formation' || (nodeName === 'option' && parentName === 'formation')) {
        return { formations: parseStringList(trimmed) };
    }

    if (nodeName === 'role' || (nodeName === 'option' && parentName === 'role')) {
        return { roles: parseStringList(trimmed) };
    }

    if (nodeName === 'motive' || (nodeName === 'option' && parentName === 'motive')) {
        return { motives: parseStringList(trimmed) };
    }

    if (nodeName === 'flags' || (nodeName === 'option' && parentName === 'flags')) {
        return { flags: parseStringList(trimmed) };
    }

    if (nodeName === 'chassis' || (nodeName === 'option' && parentName === 'chassis')) {
        return { chassis: parseStringList(trimmed) };
    }

    if (nodeName === 'variant' || (nodeName === 'option' && parentName === 'variant')) {
        return { variants: parseStringList(trimmed) };
    }

    if (nodeName === 'changeEschelon' || (nodeName === 'option' && parentName === 'changeEschelon')) {
        const echelons = parseEchelonList(trimmed);
        return echelons.length === 1 ? { echelon: echelons[0] } : { echelons };
    }

    if (isEchelonList(trimmed)) {
        const echelons = parseEchelonList(trimmed);
        return echelons.length === 1 ? { echelon: echelons[0] } : { echelons };
    }

    return normalizeConstantToken(trimmed);
}

function normalizeRulesetAttributeValue(attrName: string, attrValue: string): unknown {
    switch (attrName) {
        case 'ifUnitType':
        case 'unitType':
        case 'ifFormation':
        case 'ifRole':
        case 'ifMotive':
        case 'ifName':
        case 'ifFaction':
        case 'ifFlags':
        case 'ifIndex':
            return splitDelimitedValues(attrValue, '|');
        case 'ifWeightClass':
            return splitDelimitedValues(attrValue, '|');
        case 'ifRating':
            return splitDelimitedValues(attrValue, '|');
        case 'ifEschelon':
            return splitDelimitedValues(attrValue, '|').map((entry) => parseEchelonToken(entry));
        case 'weightClass':
            return splitDelimitedValues(attrValue);
        case 'rating':
            return splitDelimitedValues(attrValue);
        case 'formation':
            return splitDelimitedValues(attrValue);
        case 'role':
            return splitDelimitedValues(attrValue);
        case 'motive':
            return splitDelimitedValues(attrValue);
        case 'flags':
            return splitDelimitedValues(attrValue);
        case 'augmented':
        case 'ifAugmented':
        case 'ifTopLevel': {
            const parsed = parseBooleanToken(attrValue);
            return parsed === undefined ? attrValue : parsed;
        }
        case 'echelon':
            return parseSingleEchelon(attrValue);
        case 'weight':
        case 'num':
        case 'position':
            return Number.parseInt(attrValue, 10);
        default:
            return normalizeConstantToken(attrValue);
    }
}

function mapPredicateAttrName(attrName: string): string {
    switch (attrName) {
        case 'ifUnitType':
            return 'unitTypes';
        case 'ifWeightClass':
            return 'weightClasses';
        case 'ifRating':
            return 'ratings';
        case 'ifEschelon':
            return 'echelons';
        case 'ifFormation':
            return 'formations';
        case 'ifRole':
            return 'roles';
        case 'ifMotive':
            return 'motives';
        case 'ifAugmented':
            return 'augmented';
        case 'ifTopLevel':
            return 'topLevel';
        case 'ifName':
            return 'names';
        case 'ifFaction':
            return 'factions';
        case 'ifFlags':
            return 'flags';
        case 'ifIndex':
            return 'indexes';
        default:
            return attrName;
    }
}

function mapAssertionAttrName(attrName: string): string {
    switch (attrName) {
        case 'unitType':
            return 'unitTypes';
        case 'weightClass':
            return 'weightClasses';
        case 'rating':
            return 'ratings';
        case 'formation':
            return 'formations';
        case 'role':
            return 'roles';
        case 'motive':
            return 'motives';
        case 'flags':
            return 'flags';
        default:
            return attrName;
    }
}

function mapRulesetChildKey(key: string, path: string[]): string {
    if (key === 'force' && path.length === 1 && path[0] === 'ruleset') {
        return 'forces';
    }
    if (key === 'option') {
        return 'options';
    }
    if (key === 'subforce') {
        return 'subforces';
    }
    if (key === 'subforceOption') {
        return 'subforceOptions';
    }
    return key;
}

function normalizeRulesetNode(value: unknown, path: string[] = []): unknown {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeRulesetNode(entry, path));
    }

    if (typeof value !== 'object') {
        return normalizeRulesetScalar(String(value), path);
    }

    const source = value as Record<string, unknown>;
    const normalized: JsonObject = {};
    const when: JsonObject = {};
    const assign: JsonObject = {};

    for (const [key, entry] of Object.entries(source)) {
        if (key === '#text') {
            mergeNormalizedContent(normalized, normalizeRulesetScalar(String(entry), path));
            continue;
        }

        if (key.startsWith('@_')) {
            const attrName = key.slice(2);
            const attrValue = entry === undefined || entry === null ? '' : String(entry);

            if (attrName === 'ifDateBetween' || attrName === 'ifYearBetween') {
                const { fromYear, toYear } = parseDateBetweenAttribute(attrValue);
                if (fromYear !== undefined) {
                    when.fromYear = fromYear;
                }
                if (toYear !== undefined) {
                    when.toYear = toYear;
                }
                continue;
            }

            if (attrName === 'xmlns:xsi') {
                continue;
            }

            if (attrName === 'xsi:noNamespaceSchemaLocation') {
                continue;
            }

            if (PREDICATE_ATTR_NAMES.has(attrName)) {
                when[mapPredicateAttrName(attrName)] = normalizeRulesetAttributeValue(attrName, attrValue);
                continue;
            }

            if (ASSERTION_ATTR_NAMES.has(attrName)) {
                assign[mapAssertionAttrName(attrName)] = normalizeRulesetAttributeValue(attrName, attrValue);
                continue;
            }

            switch (attrName) {
                case 'echelon':
                    normalized.echelon = normalizeRulesetAttributeValue(attrName, attrValue);
                    break;
                case 'eschName':
                    normalized.echelonName = attrValue;
                    break;
                case 'weight':
                case 'num':
                case 'position':
                    normalized[attrName] = normalizeRulesetAttributeValue(attrName, attrValue);
                    break;
                case 'title':
                case 'generate':
                case 'faction':
                case 'ratingSystem':
                    if (attrValue !== '') {
                        normalized[attrName] = attrValue;
                    }
                    break;
                default:
                    normalized[attrName] = normalizeRulesetAttributeValue(attrName, attrValue);
                    break;
            }
            continue;
        }

        const child = normalizeRulesetNode(entry, [...path, key]);
        if (child !== undefined) {
            normalized[mapRulesetChildKey(key, path)] = child;
        }
    }

    if (Object.keys(when).length > 0) {
        normalized.when = when;
    }

    if (Object.keys(assign).length > 0) {
        normalized.assign = assign;
    }

    return normalized;
}

function readText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

function readYamlFile(filePath: string): JsonObject {
    const parsed = loadYaml(readText(filePath));
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Invalid YAML data in ${filePath}`);
    }

    return parsed as JsonObject;
}

function parseYear(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})/);
    return match ? Number.parseInt(match[1], 10) : undefined;
}

function listFiles(dirPath: string, extension: string): string[] {
    return fs.readdirSync(dirPath)
        .filter((name) => name.toLowerCase().endsWith(extension.toLowerCase()))
        .sort((left, right) => left.localeCompare(right));
}

function parseYearsActive(rawRanges: unknown): DateRange[] {
    return ensureArray(rawRanges).map((entry) => {
        if (!entry || typeof entry !== 'object') {
            return {};
        }

        const range = entry as Record<string, unknown>;
        return {
            start: parseYear(range.start),
            end: parseYear(range.end),
        };
    });
}

function parseYearKeyedChanges(raw: unknown): YearKeyedChange[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }

    return Object.entries(raw as Record<string, unknown>)
        .map(([yearStr, name]) => ({
            year: Number.parseInt(String(yearStr), 10),
            name: String(name),
        }))
        .filter((entry) => Number.isFinite(entry.year) && entry.name.length > 0)
        .sort((left, right) => left.year - right.year);
}

function parseColor(raw: unknown): RgbColor | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const c = raw as Record<string, unknown>;
    const red = Number(c.red);
    const green = Number(c.green);
    const blue = Number(c.blue);

    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
        return undefined;
    }

    return [red, green, blue];
}

function parseFactionLeaders(raw: unknown): FactionLeader[] | undefined {
    const entries = ensureArray(raw).filter((e) => e && typeof e === 'object');
    if (entries.length === 0) {
        return undefined;
    }

    return entries.map((entry) => {
        const e = entry as Record<string, unknown>;
        return {
            title: String(e.title || ''),
            firstName: String(e.firstName || ''),
            surname: String(e.surname || ''),
            gender: e.gender ? String(e.gender) : undefined,
            honorific: e.honorific ? String(e.honorific) : undefined,
            startYear: parseYear(e.startYear),
            endYear: parseYear(e.endYear),
        };
    });
}

function parseEraMods(raw: unknown): number[] | undefined {
    const arr = ensureArray(raw);
    if (arr.length === 0) {
        return undefined;
    }

    return arr.map((v) => Number(v));
}

function loadFactionMulIdMap(filePath: string): FactionMulIdConfig {
    const mappedIds = new Map<string, number[]>();
    const skippedFactions = new Set<string>();

    if (!fs.existsSync(filePath)) {
        return {
            mappedIds,
            skippedFactions,
        };
    }

    const lines = readText(filePath)
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines.slice(1)) {
        const [rawFactionId = '', rawMulIds = ''] = line.split(',', 2);
        const factionId = rawFactionId.trim();
        if (!factionId) {
            continue;
        }

        const rawValues = rawMulIds
            .split(';')
            .map((value) => Number.parseInt(value.trim(), 10))
            .filter((value) => Number.isFinite(value));

        if (rawValues.includes(-1)) {
            skippedFactions.add(factionId);
            continue;
        }

        const mulIds = rawValues.filter((value) => value > 0);

        if (mulIds.length > 0) {
            mappedIds.set(factionId, mulIds);
        }
    }

    return {
        mappedIds,
        skippedFactions,
    };
}

function loadUniverseFactions(
    dirPath: string,
    isCommand: boolean,
    factionMulIds: ReadonlyMap<string, number[]>
): Record<string, UniverseFactionRecord> {
    const result: Record<string, UniverseFactionRecord> = {};

    for (const fileName of listFiles(dirPath, '.yml')) {
        const filePath = path.join(dirPath, fileName);
        const raw = readYamlFile(filePath);
        const id = String(raw.key);
        const logo = getFactionLogoFilename(id);
        const mulId = factionMulIds.get(id) ?? [];

        result[id] = {
            id,
            name: String(raw.name || id),
            mulId: [...mulId],
            filename: fileName,
            isCommand,
            yearsActive: parseYearsActive(raw.yearsActive),
            ratingLevels: normalizeTextList(raw.ratingLevels),
            fallBackFactions: normalizeTextList(raw.fallBackFactions),
            tags: normalizeTextList(raw.tags),
            nameChanges: parseYearKeyedChanges(raw.nameChanges),
            capital: raw.capital ? String(raw.capital) : undefined,
            capitalChanges: raw.capitalChanges ? parseYearKeyedChanges(raw.capitalChanges) : undefined,
            color: parseColor(raw.color),
            logo,
            camos: raw.camos ? String(raw.camos) : undefined,
            nameGenerator: raw.nameGenerator ? String(raw.nameGenerator) : undefined,
            eraMods: parseEraMods(raw.eraMods),
            rankSystem: raw.rankSystem ? String(raw.rankSystem) : undefined,
            factionLeaders: parseFactionLeaders(raw.factionLeaders),
            successor: raw.successor ? String(raw.successor) : undefined,
            preInvasionHonorRating: raw.preInvasionHonorRating ? String(raw.preInvasionHonorRating) : undefined,
            postInvasionHonorRating: raw.postInvasionHonorRating ? String(raw.postInvasionHonorRating) : undefined,
            formationBaseSize: raw.formationBaseSize !== undefined ? Number(raw.formationBaseSize) : undefined,
            formationGrouping: raw.formationGrouping !== undefined ? Number(raw.formationGrouping) : undefined,
        };
    }

    return result;
}

function loadMegaMekEras(filePath: string): MegaMekEra[] {
    const parsed = xmlParser.parse(readText(filePath)) as { eras?: { era?: Array<Record<string, unknown>> } };
    const eras: MegaMekEra[] = ensureArray(parsed.eras?.era).map((era) => ({
        code: String(era.code),
        name: String(era.name),
        endYear: parseYear(era.end),
        mulId: era.mulid === undefined ? undefined : Number.parseInt(String(era.mulid), 10),
        icon: era.icon === undefined ? undefined : String(era.icon),
    }));

    let previousEnd: number | undefined;
    for (const era of eras) {
        era.startYear = previousEnd === undefined ? undefined : previousEnd + 1;
        previousEnd = era.endYear;
    }

    return eras;
}

function parseAvailability(rawCode: string, eraYear: number): ParsedAvailability {
    const trimmed = rawCode.trim();
    if (trimmed.includes('!')) {
        const [factionKey, ...ratingParts] = trimmed.split('!');
        const byRating: Record<string, number> = {};
        for (const ratingPart of ratingParts) {
            const [rating, value] = ratingPart.split(':');
            if (rating && value) {
                byRating[rating] = Number.parseInt(value, 10);
            }
        }

        return {
            factionKey,
            fileYear: eraYear,
            ratingAdjustment: 0,
            baseAvailability: Object.values(byRating).reduce(
                (highest, value) => Math.max(highest, value),
                0
            ),
            byRating,
        };
    }

    const parts = trimmed.split(':');
    if (parts.length < 2 || parts.length > 3) {
        throw new Error(`Unsupported availability code: ${trimmed}`);
    }

    let ratingAdjustment: -1 | 0 | 1 = 0;
    let availabilityToken = parts[1];
    if (availabilityToken.endsWith('+')) {
        ratingAdjustment = 1;
        availabilityToken = availabilityToken.slice(0, -1);
    } else if (availabilityToken.endsWith('-')) {
        ratingAdjustment = -1;
        availabilityToken = availabilityToken.slice(0, -1);
    }

    return {
        factionKey: parts[0],
        fileYear: eraYear,
        entryYear: parts[2] ? Number.parseInt(parts[2], 10) : undefined,
        baseAvailability: Number.parseInt(availabilityToken, 10),
        ratingAdjustment,
    };
}

function parseAvailabilityList(raw: unknown, eraYear: number): ParsedAvailability[] {
    if (typeof raw !== 'string') {
        return [];
    }

    return raw.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => parseAvailability(entry, eraYear));
}

function warnOnInvalidXmlUnitType(unitType: string, sourceLabel: string): void {
    if (!unitType || VALID_XML_UNIT_TYPES.has(unitType)) {
        return;
    }

    console.warn(
        `[MegaMek] unexpected unit type "${unitType}" in ${sourceLabel}`
    );
}

function compileXmlUnitType(unitType: string, sourceLabel: string): UnitType {
    const compiledUnitType = COMPILED_UNIT_TYPE_BY_XML_UNIT_TYPE[unitType];
    if (compiledUnitType) {
        return compiledUnitType;
    }

    console.warn(
        `[MegaMek] could not compile unit type "${unitType}" in ${sourceLabel}; keeping original value`
    );
    return unitType as UnitType;
}

function parseWeightDistributionNode(node: Record<string, unknown>): { unitType: string; weights: number[] } | null {
    if (!node.unitType || !node['#text']) {
        return null;
    }

    const unitType = String(node.unitType);
    warnOnInvalidXmlUnitType(unitType, 'weightDistribution');

    return {
        unitType,
        weights: String(node['#text'])
            .split(',')
            .map((value) => Number.parseInt(value.trim(), 10))
            .filter((value) => Number.isFinite(value)),
    };
}

function parseSalvage(node: Record<string, unknown>): EraFactionStats['salvage'] | undefined {
    if (!node.pct) {
        return undefined;
    }

    const weights: Record<string, number> = {};
    const raw = typeof node['#text'] === 'string' ? node['#text'] : '';
    for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
        const [factionKey, value] = entry.split(':');
        if (factionKey && value) {
            weights[factionKey] = Number.parseInt(value, 10);
        }
    }

    return {
        pct: Number.parseInt(String(node.pct), 10),
        weights,
    };
}

function getNodeText(node: unknown): string | undefined {
    if (typeof node === 'string') {
        return node.trim();
    }

    if (node && typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
        const value = (node as Record<string, unknown>)['#text'];
        return typeof value === 'string' ? value.trim() : undefined;
    }

    return undefined;
}

function findEraForYear(eras: MegaMekEra[], year: number): MegaMekEra | undefined {
    return eras.find((era) => {
        const startYear = era.startYear ?? Number.MIN_SAFE_INTEGER;
        const endYear = era.endYear ?? 9999;
        return year >= startYear && year <= endYear;
    });
}

function resolveEraKey(era: MegaMekEra | undefined): string | undefined {
    if (!era) {
        return undefined;
    }

    if (USE_ERA_CODE_KEYS) {
        return era.code;
    }

    return era.mulId === undefined ? undefined : String(era.mulId);
}

function findEraKey(eras: MegaMekEra[], year: number): string | undefined {
    return resolveEraKey(findEraForYear(eras, year));
}

function isFactionActiveInYear(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    year: number
): boolean {
    const faction = factions[factionKey];
    if (!faction || faction.yearsActive.length === 0) {
        return true;
    }

    return faction.yearsActive.some((activeRange) => {
        const startYear = activeRange.start ?? Number.NEGATIVE_INFINITY;
        const endYear = activeRange.end ?? Number.POSITIVE_INFINITY;
        return year >= startYear && year <= endYear;
    });
}

function normalizeRatingName(value: string): string {
    return value.trim().toUpperCase();
}

function roundOutputValue(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const decimalPlaces = Math.max(0, OUTPUT_DECIMAL_PLACES);
    if (decimalPlaces === 0) {
        return Math.round(value);
    }

    const factor = 10 ** decimalPlaces;
    return Math.round(value * factor) / factor;
}

function normalizeAvailabilityValue(value: number): number {
    return roundOutputValue(value);
}

function createEmptyAvailabilityByRating(): CompactAvailabilityByRating {
    return [0, 0, 0, 0, 0];
}

function createEmptyWeightedByRating(): CompactWeightedByRating {
    return [0, 0, 0, 0, 0];
}

function setAvailabilityByCanonical(
    availability: CompactAvailabilityByRating,
    canonical: (typeof DEFAULT_CANONICAL_RATINGS)[number],
    value: number
): void {
    availability[CANONICAL_RATING_INDEX[canonical]] = value;
}

function createAvailabilityByCanonicalLevels(
    canonicalLevels: readonly (typeof DEFAULT_CANONICAL_RATINGS)[number][],
    value: number
): CompactAvailabilityByRating {
    const encoded = createEmptyAvailabilityByRating();
    for (const canonical of canonicalLevels) {
        setAvailabilityByCanonical(encoded, canonical, value);
    }
    return encoded;
}

function getCanonicalRatingCodes(ratingLevels: string[]): (typeof DEFAULT_CANONICAL_RATINGS)[number][] {
    if (ratingLevels.length >= DEFAULT_CANONICAL_RATINGS.length) {
        return [...DEFAULT_CANONICAL_RATINGS];
    }

    return [...DEFAULT_CANONICAL_RATINGS.slice(DEFAULT_CANONICAL_RATINGS.length - ratingLevels.length)];
}

function buildRatingMapFromLevels(
    ratingLevels: string[],
    canonicalLevels = getCanonicalRatingCodes(ratingLevels)
): Map<string, (typeof DEFAULT_CANONICAL_RATINGS)[number]> {
    const ratingMap = new Map<string, (typeof DEFAULT_CANONICAL_RATINGS)[number]>();

    ratingLevels.forEach((level, index) => {
        const canonical = canonicalLevels[index];
        if (!canonical) {
            return;
        }

        ratingMap.set(normalizeRatingName(level), canonical);
        for (const alias of RATING_ALIASES_BY_CANONICAL[canonical]) {
            ratingMap.set(alias, canonical);
        }
    });

    return ratingMap;
}

function resolveFactionRatingSystem(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    visited = new Set<string>()
): string[] {
    if (visited.has(factionKey)) {
        return [];
    }

    visited.add(factionKey);
    const faction = factions[factionKey];
    if (!faction) {
        return [];
    }

    let singleLevelCandidate = faction.ratingLevels.length === 1 ? faction.ratingLevels : [];
    if (faction.ratingLevels.length > 1) {
        return faction.ratingLevels;
    }

    for (const fallbackFactionKey of faction.fallBackFactions) {
        const fallbackLevels = resolveFactionRatingSystem(factions, fallbackFactionKey, new Set(visited));
        if (fallbackLevels.length > 1) {
            return fallbackLevels;
        }

        if (singleLevelCandidate.length === 0 && fallbackLevels.length === 1) {
            singleLevelCandidate = fallbackLevels;
        }
    }

    return singleLevelCandidate;
}

function resolveSingleFactionRatingProfile(
    factions: Record<string, UniverseFactionRecord>,
    faction: UniverseFactionRecord
): ResolvedFactionRatingProfile {
    const sourceLevels = faction.ratingLevels.slice(0, 1);
    const parentSystem = resolveFactionRatingSystem(factions, faction.id);
    const systemLevels = parentSystem.length > 0 ? parentSystem : sourceLevels;
    const systemRatingMap = buildRatingMapFromLevels(systemLevels);
    const ownLevel = normalizeRatingName(sourceLevels[0]);
    const canonical = systemRatingMap.get(ownLevel)
        ?? buildRatingMapFromLevels(sourceLevels).get(ownLevel)
        ?? 'A';

    return {
        sourceLevels,
        canonicalLevels: [canonical],
    };
}

function resolveFactionRatingProfile(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    visited = new Set<string>()
): ResolvedFactionRatingProfile {
    if (factionKey === GENERAL_FACTION_KEY) {
        return {
            sourceLevels: [...DEFAULT_CANONICAL_RATINGS],
            canonicalLevels: [...DEFAULT_CANONICAL_RATINGS],
        };
    }

    if (visited.has(factionKey)) {
        return {
            sourceLevels: [],
            canonicalLevels: [],
        };
    }

    visited.add(factionKey);
    const faction = factions[factionKey];
    if (!faction) {
        return {
            sourceLevels: [],
            canonicalLevels: [],
        };
    }

    if (faction.ratingLevels.length === 0) {
        for (const fallbackFactionKey of faction.fallBackFactions) {
            const fallbackProfile = resolveFactionRatingProfile(factions, fallbackFactionKey, new Set(visited));
            if (fallbackProfile.canonicalLevels.length > 0) {
                return fallbackProfile;
            }
        }

        return {
            sourceLevels: [],
            canonicalLevels: [],
        };
    }

    if (faction.ratingLevels.length === 1) {
        return resolveSingleFactionRatingProfile(factions, faction);
    }

    return {
        sourceLevels: [...faction.ratingLevels],
        canonicalLevels: getCanonicalRatingCodes(faction.ratingLevels),
    };
}

function resolveFactionRatingLevels(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    visited = new Set<string>()
): string[] {
    return resolveFactionRatingProfile(factions, factionKey, visited).sourceLevels;
}

function getFactionRatingMap(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string
): Map<string, (typeof DEFAULT_CANONICAL_RATINGS)[number]> {
    const profile = resolveFactionRatingProfile(factions, factionKey);
    if (profile.sourceLevels.length === 0 || profile.canonicalLevels.length === 0) {
        return buildRatingMapFromLevels([...DEFAULT_CANONICAL_RATINGS]);
    }

    return buildRatingMapFromLevels(profile.sourceLevels, profile.canonicalLevels);
}

function addCompactAvailability(
    target: Record<string, CompactEraAvailability>,
    eras: MegaMekEra[],
    factions: Record<string, UniverseFactionRecord>,
    availabilityList: ParsedAvailability[],
    sourceLabel: string
): void {
    for (const availability of availabilityList) {
        if (availability.baseAvailability === undefined) {
            continue;
        }

        const availabilityYear = resolveAvailabilityYearForFaction(factions, availability, sourceLabel);
        if (availabilityYear === undefined) {
            continue;
        }

        const eraKey = findEraKey(eras, availabilityYear);
        if (eraKey === undefined) {
            console.log(`[MegaMek] skipping availability for ${availability.factionKey} in year ${availabilityYear} (${sourceLabel}) due to undefined era`);
            continue;
        }

        const eraAvailability = target[eraKey] || {};
        const previousValue = eraAvailability[availability.factionKey];
        const nextValue = encodeCompactAvailabilityValue(availability, factions, sourceLabel);

        eraAvailability[availability.factionKey] = previousValue === undefined
            ? nextValue
            : mergeCompactAvailabilityValue(previousValue, nextValue);
        target[eraKey] = eraAvailability;
    }
}

function resolveAvailabilityYearForFaction(
    factions: Record<string, UniverseFactionRecord>,
    availability: ParsedAvailability,
    sourceLabel: string
): number | undefined {
    const fileYearIsActive = isFactionActiveInYear(factions, availability.factionKey, availability.fileYear);
    const entryYearIsActive = availability.entryYear !== undefined
        ? isFactionActiveInYear(factions, availability.factionKey, availability.entryYear)
        : undefined;

    if (availability.entryYear !== undefined) {
        if (entryYearIsActive) {
            if (!fileYearIsActive && availability.entryYear !== availability.fileYear) {
                // console.warn(
                //     `[MegaMek] using availability entry year ${availability.entryYear} for inactive file year ` +
                //     `${availability.fileYear} on faction ${availability.factionKey} (${sourceLabel})`
                // );
            }

            return availability.entryYear;
        }

        if (fileYearIsActive) {
            // console.warn(
            //     `[MegaMek] using file year ${availability.fileYear} because availability entry year ` +
            //     `${availability.entryYear} is inactive for faction ${availability.factionKey} (${sourceLabel})`
            // );
            return availability.fileYear;
        }

        // console.warn(
        //     `[MegaMek] keeping availability for inactive faction ${availability.factionKey}: ` +
        //     `entry year ${availability.entryYear}, file year ${availability.fileYear} (${sourceLabel})`
        // );
        return availability.entryYear;
    }

    if (!fileYearIsActive) {
        // console.warn(
        //     `[MegaMek] keeping availability for inactive faction ${availability.factionKey}: ` +
        //     `file year ${availability.fileYear} (${sourceLabel})`
        // );
    }

    return availability.fileYear;
}

function encodeCompactAvailabilityValue(
    availability: ParsedAvailability,
    factions: Record<string, UniverseFactionRecord>,
    sourceLabel: string
): CompactAvailabilityValue {
    const profile = resolveFactionRatingProfile(factions, availability.factionKey);

    if (availability.byRating) {
        return normalizeExplicitAvailabilityByRating(availability.factionKey, availability.byRating, factions, sourceLabel);
    }

    if (availability.ratingAdjustment !== 0) {
        if (!EXPAND_RATING_ADJUSTMENTS) {
            const baseAvailability = availability.baseAvailability ?? 0;
            return availability.ratingAdjustment > 0 ? `${baseAvailability}+` : `${baseAvailability}-`;
        }
        return expandAdjustedAvailabilityByRating(availability, factions);
    }

    const baseAvailability = normalizeAvailabilityValue(availability.baseAvailability ?? 0);
    if (profile.canonicalLevels.length > 0) {
        return createAvailabilityByCanonicalLevels(profile.canonicalLevels, baseAvailability);
    }

    return baseAvailability;
}

function normalizeExplicitAvailabilityByRating(
    factionKey: string,
    byRating: Record<string, number>,
    factions: Record<string, UniverseFactionRecord>,
    sourceLabel: string
): CompactAvailabilityByRating {
    const ratingMap = getFactionRatingMap(factions, factionKey);
    const normalized = createEmptyAvailabilityByRating();

    for (const [ratingName, value] of Object.entries(byRating)) {
        const canonical = ratingMap.get(normalizeRatingName(ratingName));
        if (!canonical) {
            console.warn(
                `[MegaMek] bad ! rating "${ratingName}" for ${factionKey} in ${sourceLabel}`
            );
            continue;
        }

        const index = CANONICAL_RATING_INDEX[canonical];
        normalized[index] = Math.max(normalized[index], normalizeAvailabilityValue(value));
    }

    return normalized;
}

function expandAdjustedAvailabilityByRating(
    availability: ParsedAvailability,
    factions: Record<string, UniverseFactionRecord>
): CompactAvailabilityByRating {
    const profile = resolveFactionRatingProfile(factions, availability.factionKey);
    const canonicalLevels = profile.canonicalLevels.length > 0
        ? profile.canonicalLevels
        : [...DEFAULT_CANONICAL_RATINGS];
    const baseAvailability = normalizeAvailabilityValue(availability.baseAvailability ?? 0);
    const expanded = createEmptyAvailabilityByRating();

    for (let index = 0; index < canonicalLevels.length; index += 1) {
        const canonical = canonicalLevels[index];
        const value = normalizeAvailabilityValue(availability.ratingAdjustment > 0
            ? baseAvailability - (canonicalLevels.length - 1 - index)
            : baseAvailability - index);

        setAvailabilityByCanonical(expanded, canonical, value);
    }

    return expanded;
}

function hasRatingSpecificAvailability(value: CompactAvailabilityValue): value is CompactAvailabilityByRating {
    return Array.isArray(value);
}

function mergeCompactAvailabilityByRating(
    current: CompactAvailabilityByRating,
    incoming: CompactAvailabilityByRating
): CompactAvailabilityByRating {
    const merged = [...current] as CompactAvailabilityByRating;
    for (let index = 0; index < merged.length; index += 1) {
        merged[index] = Math.max(merged[index], incoming[index]);
    }
    return merged;
}

function mergeCompactAvailabilityValue(
    current: CompactAvailabilityValue,
    incoming: CompactAvailabilityValue
): CompactAvailabilityValue {
    if (hasRatingSpecificAvailability(current) && hasRatingSpecificAvailability(incoming)) {
        return mergeCompactAvailabilityByRating(current, incoming);
    }
    throw new Error(`Cannot merge incompatible availability values: ${current} vs ${incoming}`);
}

function expandAvailabilityValueToByRating(value: CompactAvailabilityValue): CompactAvailabilityByRating {
    if (hasRatingSpecificAvailability(value)) {
        return [...value] as CompactAvailabilityByRating;
    }

    const numericValue = Number.parseInt(String(value), 10);
    return [numericValue, numericValue, numericValue, numericValue, numericValue];
}

function hasPositiveAvailabilityValue(value: CompactAvailabilityValue | undefined): boolean {
    if (value === undefined) {
        return false;
    }

    return expandAvailabilityValueToByRating(value).some((entry) => entry > 0);
}

function calcAvailabilityWeight(value: number): number {
    return Math.pow(2, value / 2);
}

function calcAvailabilityFromWeight(weight: number): number {
    if (weight <= 0) {
        return 0;
    }

    return 2 * Math.log2(weight);
}

function averageAvailabilityNumbers(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    const totalWeight = values.reduce((sum, value) => sum + calcAvailabilityWeight(value), 0);
    return normalizeAvailabilityValue(calcAvailabilityFromWeight(totalWeight / values.length));
}

function averageCompactAvailabilityValues(values: CompactAvailabilityValue[]): CompactAvailabilityValue | undefined {
    if (values.length === 0) {
        return undefined;
    }

    const expandedValues = values.map((value) => expandAvailabilityValueToByRating(value));
    const averaged = createEmptyAvailabilityByRating();

    for (let index = 0; index < averaged.length; index += 1) {
        averaged[index] = averageAvailabilityNumbers(expandedValues.map((value) => value[index]));
    }

    return averaged;
}

function resolveCompactAvailabilityForFaction(
    eraAvailability: CompactEraAvailability,
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    visited = new Set<string>()
): CompactAvailabilityValue | undefined {
    if (Object.prototype.hasOwnProperty.call(eraAvailability, factionKey)) {
        return eraAvailability[factionKey];
    }

    if (visited.has(factionKey)) {
        return undefined;
    }

    visited.add(factionKey);

    if (factionKey === GENERAL_FACTION_KEY) {
        return eraAvailability[GENERAL_FACTION_KEY];
    }

    const faction = factions[factionKey];
    if (!faction) {
        return eraAvailability[GENERAL_FACTION_KEY];
    }

    if (faction.fallBackFactions.length === 1) {
        return resolveCompactAvailabilityForFaction(
            eraAvailability,
            factions,
            faction.fallBackFactions[0],
            new Set(visited)
        );
    }

    if (faction.fallBackFactions.length > 1) {
        const resolvedParents = faction.fallBackFactions
            .map((fallbackFactionKey) => resolveCompactAvailabilityForFaction(
                eraAvailability,
                factions,
                fallbackFactionKey,
                new Set(visited)
            ))
            .filter((value): value is CompactAvailabilityValue => value !== undefined);

        return averageCompactAvailabilityValues(resolvedParents);
    }

    return eraAvailability[GENERAL_FACTION_KEY];
}

function combineResolvedAvailabilityValues(
    chassisValue: CompactAvailabilityValue | undefined,
    modelValue: CompactAvailabilityValue | undefined
): CompactAvailabilityValue | undefined {
    if (chassisValue === undefined || modelValue === undefined) {
        return undefined;
    }

    const chassisByRating = expandAvailabilityValueToByRating(chassisValue);
    const modelByRating = expandAvailabilityValueToByRating(modelValue);
    const combined = createEmptyAvailabilityByRating();

    for (let index = 0; index < combined.length; index += 1) {
        const chassisAvailability = chassisByRating[index];
        const modelAvailability = modelByRating[index];
        combined[index] = (chassisAvailability <= 0 || modelAvailability <= 0)
            ? 0
            : averageAvailabilityNumbers([chassisAvailability, modelAvailability]);
    }

    return combined;
}

function calcWeightedScore(relativeWeight: number): number {
    if (!Number.isFinite(relativeWeight) || relativeWeight <= 0) {
        return 0;
    }

    const score = 5.5 + calcAvailabilityFromWeight(relativeWeight);
    return roundOutputValue(Math.min(10, Math.max(1, score)));
}

function expandWeightedValueToByRating(value: CompactWeightedValue): CompactWeightedByRating {
    if (Array.isArray(value)) {
        return [...value] as CompactWeightedByRating;
    }

    return [value, value, value, value, value];
}

function hasPositiveWeightedValue(value: CompactWeightedValue | undefined): boolean {
    if (value === undefined) {
        return false;
    }

    return expandWeightedValueToByRating(value).some((entry) => entry > 0);
}

function mergeCompactWeightedByRating(
    current: CompactWeightedByRating,
    incoming: CompactWeightedByRating
): CompactWeightedByRating {
    const merged = [...current] as CompactWeightedByRating;
    for (let index = 0; index < merged.length; index += 1) {
        merged[index] = Math.max(current[index], incoming[index]);
    }
    return merged;
}

function mergeCompactWeightedValueForMul(
    current: CompactWeightedValue,
    incoming: CompactWeightedValue
): CompactWeightedValue {
    if (!Array.isArray(current) && !Array.isArray(incoming)) {
        return Math.max(current, incoming);
    }

    return mergeCompactWeightedByRating(
        expandWeightedValueToByRating(current),
        expandWeightedValueToByRating(incoming)
    );
}

function mergeCompactAvailabilityValueForMul(
    current: CompactAvailabilityValue,
    incoming: CompactAvailabilityValue
): CompactAvailabilityValue {
    if (!hasRatingSpecificAvailability(current) && !hasRatingSpecificAvailability(incoming)) {
        return Math.max(Number.parseInt(String(current), 10), Number.parseInt(String(incoming), 10));
    }

    return mergeCompactAvailabilityByRating(
        expandAvailabilityValueToByRating(current),
        expandAvailabilityValueToByRating(incoming)
    );
}

function mergeNumberArrays(current: number[] | undefined, incoming: number[] | undefined): number[] | undefined {
    if (!incoming || incoming.length === 0) {
        return current;
    }

    if (!current || current.length === 0) {
        return [...incoming];
    }

    const mergedLength = Math.max(current.length, incoming.length);
    const merged: number[] = [];
    for (let index = 0; index < mergedLength; index += 1) {
        const currentValue = current[index];
        const incomingValue = incoming[index];
        if (currentValue === undefined) {
            merged[index] = incomingValue;
        } else if (incomingValue === undefined) {
            merged[index] = currentValue;
        } else {
            merged[index] = Math.max(currentValue, incomingValue);
        }
    }

    return merged;
}

function mergeWeightDistribution(
    current: Record<string, number[]> | undefined,
    incoming: Record<string, number[]> | undefined
): Record<string, number[]> | undefined {
    if (!incoming) {
        return current;
    }

    const merged = { ...(current || {}) };
    for (const [unitType, weights] of Object.entries(incoming)) {
        merged[unitType] = mergeNumberArrays(merged[unitType], weights) || [];
    }

    return merged;
}

function mergeSalvage(
    current: EraFactionStats['salvage'],
    incoming: EraFactionStats['salvage']
): EraFactionStats['salvage'] {
    if (!incoming) {
        return current;
    }

    if (!current) {
        return {
            pct: incoming.pct,
            weights: { ...incoming.weights },
        };
    }

    const weights = { ...current.weights };
    for (const [factionKey, value] of Object.entries(incoming.weights)) {
        weights[factionKey] = weights[factionKey] === undefined
            ? value
            : Math.max(weights[factionKey], value);
    }

    return {
        pct: Math.max(current.pct, incoming.pct),
        weights,
    };
}

function mergeEraFactionStats(current: EraFactionStats | undefined, incoming: EraFactionStats): EraFactionStats {
    if (!current) {
        return {
            pctOmni: incoming.pctOmni ? [...incoming.pctOmni] : undefined,
            pctOmniAero: incoming.pctOmniAero ? [...incoming.pctOmniAero] : undefined,
            pctClan: incoming.pctClan ? [...incoming.pctClan] : undefined,
            pctClanAero: incoming.pctClanAero ? [...incoming.pctClanAero] : undefined,
            pctClanVehicle: incoming.pctClanVehicle ? [...incoming.pctClanVehicle] : undefined,
            pctSL: incoming.pctSL ? [...incoming.pctSL] : undefined,
            pctSLAero: incoming.pctSLAero ? [...incoming.pctSLAero] : undefined,
            pctSLVehicle: incoming.pctSLVehicle ? [...incoming.pctSLVehicle] : undefined,
            omniMargin: incoming.omniMargin,
            techMargin: incoming.techMargin,
            upgradeMargin: incoming.upgradeMargin,
            salvage: mergeSalvage(undefined, incoming.salvage),
            weightDistribution: mergeWeightDistribution(undefined, incoming.weightDistribution),
        };
    }

    return {
        pctOmni: mergeNumberArrays(current.pctOmni, incoming.pctOmni),
        pctOmniAero: mergeNumberArrays(current.pctOmniAero, incoming.pctOmniAero),
        pctClan: mergeNumberArrays(current.pctClan, incoming.pctClan),
        pctClanAero: mergeNumberArrays(current.pctClanAero, incoming.pctClanAero),
        pctClanVehicle: mergeNumberArrays(current.pctClanVehicle, incoming.pctClanVehicle),
        pctSL: mergeNumberArrays(current.pctSL, incoming.pctSL),
        pctSLAero: mergeNumberArrays(current.pctSLAero, incoming.pctSLAero),
        pctSLVehicle: mergeNumberArrays(current.pctSLVehicle, incoming.pctSLVehicle),
        omniMargin: incoming.omniMargin === undefined
            ? current.omniMargin
            : current.omniMargin === undefined
                ? incoming.omniMargin
                : Math.max(current.omniMargin, incoming.omniMargin),
        techMargin: incoming.techMargin === undefined
            ? current.techMargin
            : current.techMargin === undefined
                ? incoming.techMargin
                : Math.max(current.techMargin, incoming.techMargin),
        upgradeMargin: incoming.upgradeMargin === undefined
            ? current.upgradeMargin
            : current.upgradeMargin === undefined
                ? incoming.upgradeMargin
                : Math.max(current.upgradeMargin, incoming.upgradeMargin),
        salvage: mergeSalvage(current.salvage, incoming.salvage),
        weightDistribution: mergeWeightDistribution(current.weightDistribution, incoming.weightDistribution),
    };
}

function addCompactFactionEraStats(
    target: Record<string, Record<string, EraFactionStats>>,
    eras: MegaMekEra[],
    year: number,
    factionKey: string,
    stats: EraFactionStats
): void {
    const eraKey = findEraKey(eras, year);
    if (eraKey === undefined) {
        return;
    }

    const eraStats = target[eraKey] || {};
    eraStats[factionKey] = mergeEraFactionStats(eraStats[factionKey], stats);
    target[eraKey] = eraStats;
}

function buildChassisRecordKey(unitType: string, chassisName: string): string {
    return `${unitType}|${chassisName}`;
}

function buildModelRecordKey(unitType: string, chassisName: string, modelName: string): string {
    return `${unitType}|${chassisName}|${modelName}`;
}

function hasAnyPositiveDirectAvailability(eraAvailability: CompactEraAvailability): boolean {
    return Object.values(eraAvailability).some((value) => hasPositiveAvailabilityValue(value));
}

function warnOnAvailabilityMismatches(
    chassis: Record<string, CompactChassisRecord>,
    models: Record<string, CompactModelRecord>,
    factions: Record<string, UniverseFactionRecord>
): void {
    const modelsByChassis = new Map<string, CompactModelRecord[]>();

    for (const modelRecord of Object.values(models)) {
        const chassisKey = buildChassisRecordKey(modelRecord.t, modelRecord.c);
        const groupedModels = modelsByChassis.get(chassisKey) || [];
        groupedModels.push(modelRecord);
        modelsByChassis.set(chassisKey, groupedModels);
    }

    for (const [chassisKey, chassisRecord] of Object.entries(chassis)) {
        const chassisModels = modelsByChassis.get(chassisKey) || [];
        const eraKeys = new Set<string>([
            ...Object.keys(chassisRecord.e),
            ...chassisModels.flatMap((modelRecord) => Object.keys(modelRecord.e)),
        ]);

        for (const eraKey of eraKeys) {
            const chassisEraAvailability = chassisRecord.e[eraKey] || {};
            const directFactionKeys = new Set<string>([
                ...Object.keys(chassisEraAvailability),
                ...chassisModels.flatMap((modelRecord) => Object.keys(modelRecord.e[eraKey] || {})),
            ]);

            for (const modelRecord of chassisModels) {
                const modelEraAvailability = modelRecord.e[eraKey] || {};
                for (const [factionKey, modelValue] of Object.entries(modelEraAvailability)) {
                    if (!hasPositiveAvailabilityValue(modelValue)) {
                        continue;
                    }

                    if (factionKey === GENERAL_FACTION_KEY
                        && !hasPositiveAvailabilityValue(chassisEraAvailability[GENERAL_FACTION_KEY])
                        && hasAnyPositiveDirectAvailability(chassisEraAvailability)) {
                        continue;
                    }

                    if (hasPositiveAvailabilityValue(resolveCompactAvailabilityForFaction(
                        chassisEraAvailability,
                        factions,
                        factionKey,
                    ))) {
                        continue;
                    }

                    console.warn(
                        `[MegaMek] model availability without chassis availability: ${modelRecord.t}|${modelRecord.c}|${modelRecord.m} ` +
                        `era ${eraKey} faction ${factionKey}`
                    );
                }
            }

            for (const [factionKey, chassisValue] of Object.entries(chassisEraAvailability)) {
                if (!hasPositiveAvailabilityValue(chassisValue)) {
                    continue;
                }

                const hasAnyModelAvailability = chassisModels.some((modelRecord) => {
                    const modelEraAvailability = modelRecord.e[eraKey] || {};
                    return hasPositiveAvailabilityValue(resolveCompactAvailabilityForFaction(
                        modelEraAvailability,
                        factions,
                        factionKey,
                    ));
                });

                if (hasAnyModelAvailability) {
                    continue;
                }

                console.warn(
                    `[MegaMek] chassis availability without model availability: ${chassisKey} ` +
                    `era ${eraKey} faction ${factionKey}`
                );
            }

            for (const factionKey of directFactionKeys) {
                const resolvedChassisAvailability = resolveCompactAvailabilityForFaction(
                    chassisEraAvailability,
                    factions,
                    factionKey,
                );
                if (!hasPositiveAvailabilityValue(resolvedChassisAvailability)) {
                    continue;
                }

                const hasResolvedModelAvailability = chassisModels.some((modelRecord) => {
                    const modelEraAvailability = modelRecord.e[eraKey] || {};
                    return hasPositiveAvailabilityValue(resolveCompactAvailabilityForFaction(
                        modelEraAvailability,
                        factions,
                        factionKey,
                    ));
                });

                if (!hasResolvedModelAvailability) {
                    console.warn(
                        `[MegaMek] chassis availability without resolved model availability: ${chassisKey} ` +
                        `era ${eraKey} faction ${factionKey}`
                    );
                }
            }
        }
    }
}

function buildCombinedAvailabilityRecords(
    chassis: Record<string, CompactChassisRecord>,
    models: Record<string, CompactModelRecord>,
    factions: Record<string, UniverseFactionRecord>
): Record<string, CompactModelRecord> {
    const combinedAvailability: Record<string, CompactModelRecord> = {};

    for (const [modelKey, modelRecord] of Object.entries(models)) {
        const chassisKey = buildChassisRecordKey(modelRecord.t, modelRecord.c);
        const chassisRecord = chassis[chassisKey];

        if (!chassisRecord) {
            console.warn(`[MegaMek] missing chassis record for model ${modelKey}`);
            continue;
        }

        const combinedRecord: CompactModelRecord = {
            t: modelRecord.t,
            c: modelRecord.c,
            m: modelRecord.m,
            e: {},
        };

        const eraKeys = new Set<string>([
            ...Object.keys(chassisRecord.e),
            ...Object.keys(modelRecord.e),
        ]);

        for (const eraKey of eraKeys) {
            const chassisEraAvailability = chassisRecord.e[eraKey] || {};
            const modelEraAvailability = modelRecord.e[eraKey] || {};
            const factionKeys = new Set<string>([
                ...Object.keys(chassisEraAvailability),
                ...Object.keys(modelEraAvailability),
            ]);

            const combinedEraAvailability: CompactEraAvailability = {};

            for (const factionKey of factionKeys) {
                const combinedValue = combineResolvedAvailabilityValues(
                    resolveCompactAvailabilityForFaction(chassisEraAvailability, factions, factionKey),
                    resolveCompactAvailabilityForFaction(modelEraAvailability, factions, factionKey)
                );

                if (combinedValue !== undefined) {
                    combinedEraAvailability[factionKey] = combinedValue;
                }
            }

            if (Object.keys(combinedEraAvailability).length > 0) {
                combinedRecord.e[eraKey] = combinedEraAvailability;
            }
        }

        combinedAvailability[modelKey] = combinedRecord;
    }

    return combinedAvailability;
}

function buildWeightedAvailabilityRecords(
    chassis: Record<string, CompactChassisRecord>,
    models: Record<string, CompactModelRecord>,
    factions: Record<string, UniverseFactionRecord>
): Record<string, CompactWeightedModelRecord> {
    const weightedAvailability: Record<string, CompactWeightedModelRecord> = {};
    const modelsByChassis = new Map<string, Array<[string, CompactModelRecord]>>();
    const chassisKeysByUnitType = new Map<string, string[]>();

    for (const [modelKey, modelRecord] of Object.entries(models)) {
        const chassisKey = buildChassisRecordKey(modelRecord.t, modelRecord.c);
        const groupedModels = modelsByChassis.get(chassisKey) || [];
        groupedModels.push([modelKey, modelRecord]);
        modelsByChassis.set(chassisKey, groupedModels);

        weightedAvailability[modelKey] = {
            t: modelRecord.t,
            c: modelRecord.c,
            m: modelRecord.m,
            e: {},
        };
    }

    for (const [chassisKey, chassisRecord] of Object.entries(chassis)) {
        const chassisKeys = chassisKeysByUnitType.get(chassisRecord.t) || [];
        chassisKeys.push(chassisKey);
        chassisKeysByUnitType.set(chassisRecord.t, chassisKeys);
    }

    for (const chassisKeys of chassisKeysByUnitType.values()) {
        const eraKeys = new Set<string>();

        for (const chassisKey of chassisKeys) {
            const chassisRecord = chassis[chassisKey];
            Object.keys(chassisRecord.e).forEach((eraKey) => eraKeys.add(eraKey));
            for (const [, modelRecord] of modelsByChassis.get(chassisKey) || []) {
                Object.keys(modelRecord.e).forEach((eraKey) => eraKeys.add(eraKey));
            }
        }

        for (const eraKey of eraKeys) {
            const factionKeys = new Set<string>();

            for (const chassisKey of chassisKeys) {
                const chassisRecord = chassis[chassisKey];
                Object.keys(chassisRecord.e[eraKey] || {}).forEach((factionKey) => factionKeys.add(factionKey));
                for (const [, modelRecord] of modelsByChassis.get(chassisKey) || []) {
                    Object.keys(modelRecord.e[eraKey] || {}).forEach((factionKey) => factionKeys.add(factionKey));
                }
            }

            for (const factionKey of factionKeys) {
                const chassisWeightTotal = createEmptyWeightedByRating();
                const modelWeightsByKey = new Map<string, CompactWeightedByRating>();

                for (const chassisKey of chassisKeys) {
                    const chassisRecord = chassis[chassisKey];
                    const chassisValue = resolveCompactAvailabilityForFaction(
                        chassisRecord.e[eraKey] || {},
                        factions,
                        factionKey,
                    );

                    if (chassisValue === undefined) {
                        continue;
                    }

                    const chassisByRating = expandAvailabilityValueToByRating(chassisValue);
                    const siblingModelWeights = new Map<string, CompactWeightedByRating>();
                    const totalModelWeight = createEmptyWeightedByRating();

                    for (const [modelKey, modelRecord] of modelsByChassis.get(chassisKey) || []) {
                        const modelValue = resolveCompactAvailabilityForFaction(
                            modelRecord.e[eraKey] || {},
                            factions,
                            factionKey,
                        );

                        if (modelValue === undefined) {
                            continue;
                        }

                        const modelByRating = expandAvailabilityValueToByRating(modelValue);
                        const weightedByRating = createEmptyWeightedByRating();
                        let hasPositiveWeight = false;

                        for (let index = 0; index < weightedByRating.length; index += 1) {
                            if (chassisByRating[index] <= 0 || modelByRating[index] <= 0) {
                                continue;
                            }

                            const modelWeight = calcAvailabilityWeight(modelByRating[index]);
                            weightedByRating[index] = modelWeight;
                            totalModelWeight[index] += modelWeight;
                            hasPositiveWeight = true;
                        }

                        if (hasPositiveWeight) {
                            siblingModelWeights.set(modelKey, weightedByRating);
                        }
                    }

                    for (let index = 0; index < chassisWeightTotal.length; index += 1) {
                        if (chassisByRating[index] <= 0 || totalModelWeight[index] <= 0) {
                            continue;
                        }

                        const chassisWeight = calcAvailabilityWeight(chassisByRating[index]);
                        chassisWeightTotal[index] += chassisWeight;

                        for (const [modelKey, siblingWeights] of siblingModelWeights.entries()) {
                            if (siblingWeights[index] <= 0) {
                                continue;
                            }

                            const currentWeights = modelWeightsByKey.get(modelKey) || createEmptyWeightedByRating();
                            currentWeights[index] += chassisWeight * siblingWeights[index] / totalModelWeight[index];
                            modelWeightsByKey.set(modelKey, currentWeights);
                        }
                    }
                }

                const positiveModelCounts = createEmptyWeightedByRating();
                for (const rawWeights of modelWeightsByKey.values()) {
                    for (let index = 0; index < positiveModelCounts.length; index += 1) {
                        if (rawWeights[index] > 0) {
                            positiveModelCounts[index] += 1;
                        }
                    }
                }

                for (const [modelKey, rawWeights] of modelWeightsByKey.entries()) {
                    const weightedByRating = createEmptyWeightedByRating();
                    let hasPositiveEntry = false;

                    for (let index = 0; index < weightedByRating.length; index += 1) {
                        if (rawWeights[index] <= 0 || chassisWeightTotal[index] <= 0) {
                            continue;
                        }

                        const relativeWeight = (rawWeights[index] * positiveModelCounts[index]) / chassisWeightTotal[index];
                        weightedByRating[index] = calcWeightedScore(relativeWeight);
                        hasPositiveEntry = hasPositiveEntry || weightedByRating[index] > 0;
                    }

                    if (!hasPositiveEntry) {
                        continue;
                    }

                    const modelRecord = weightedAvailability[modelKey];
                    const weightedEraAvailability = modelRecord.e[eraKey] || {};
                    weightedEraAvailability[factionKey] = weightedByRating;
                    modelRecord.e[eraKey] = weightedEraAvailability;
                }
            }
        }
    }

    return Object.fromEntries(
        Object.entries(weightedAvailability).filter(([, record]) => Object.keys(record.e).length > 0)
    );
}

function loadForceGeneratorData(
    dirPath: string,
    eras: MegaMekEra[],
    factions: Record<string, UniverseFactionRecord>
): Pick<MegaMekAvailabilityExport, 'factionEraData' | 'chassis' | 'models' | 'availability'> & { forceGeneratorYears: number[] } {
    const factionEraData: Record<string, Record<string, EraFactionStats>> = {};
    const chassis: Record<string, CompactChassisRecord> = {};
    const models: Record<string, CompactModelRecord> = {};
    const forceGeneratorYears = listFiles(dirPath, '.xml')
        .map((name) => name.replace(/\.xml$/i, ''))
        .filter((name) => /^\d+$/.test(name))
        .map((name) => Number.parseInt(name, 10))
        .sort((left, right) => left - right);

    for (const year of forceGeneratorYears) {
        const filePath = path.join(dirPath, `${year}.xml`);
        const sourceFileName = path.basename(filePath);
        const parsed = xmlParser.parse(readText(filePath)) as {
            ratgen?: {
                factions?: { faction?: Array<Record<string, unknown>> };
                units?: { chassis?: Array<Record<string, unknown>> };
            };
        };

        for (const factionNode of ensureArray(parsed.ratgen?.factions?.faction)) {
            const factionKey = String(factionNode.key);
            const stats: EraFactionStats = {};

            for (const key of ['pctOmni', 'pctClan', 'pctSL'] as const) {
                for (const node of ensureArray(factionNode[key])) {
                    const text = getNodeText(node);
                    if (!text) {
                        continue;
                    }

                    const values = text.split(',').map((entry) => Number.parseInt(entry.trim(), 10));
                    const unitType = node && typeof node === 'object' ? String((node as Record<string, unknown>).unitType || '') : '';
                    if (key === 'pctOmni' && unitType === 'AeroSpaceFighter') {
                        stats.pctOmniAero = values;
                    } else if (key === 'pctOmni') {
                        stats.pctOmni = values;
                    } else if (key === 'pctClan' && unitType === 'AeroSpaceFighter') {
                        stats.pctClanAero = values;
                    } else if (key === 'pctClan' && unitType === 'Vehicle') {
                        stats.pctClanVehicle = values;
                    } else if (key === 'pctClan') {
                        stats.pctClan = values;
                    } else if (key === 'pctSL' && unitType === 'AeroSpaceFighter') {
                        stats.pctSLAero = values;
                    } else if (key === 'pctSL' && unitType === 'Vehicle') {
                        stats.pctSLVehicle = values;
                    } else if (key === 'pctSL') {
                        stats.pctSL = values;
                    }
                }
            }

            if (factionNode.omniMargin !== undefined) {
                stats.omniMargin = Number.parseInt(String(factionNode.omniMargin), 10);
            }
            if (factionNode.techMargin !== undefined) {
                stats.techMargin = Number.parseInt(String(factionNode.techMargin), 10);
            }
            if (factionNode.upgradeMargin !== undefined) {
                stats.upgradeMargin = Number.parseInt(String(factionNode.upgradeMargin), 10);
            }

            const salvageNode = factionNode.salvage as Record<string, unknown> | undefined;
            if (salvageNode) {
                stats.salvage = parseSalvage(salvageNode);
            }

            const distributions = ensureArray(factionNode.weightDistribution)
                .map((node) => parseWeightDistributionNode(node as Record<string, unknown>))
                .filter((entry): entry is { unitType: string; weights: number[] } => entry !== null);
            if (distributions.length > 0) {
                stats.weightDistribution = Object.fromEntries(
                    distributions.map((entry) => [entry.unitType, entry.weights])
                );
            }

            addCompactFactionEraStats(factionEraData, eras, year, factionKey, stats);
        }

        for (const chassisNode of ensureArray(parsed.ratgen?.units?.chassis)) {
            const chassisName = String(chassisNode.name);
            const unitType = String(chassisNode.unitType);
            warnOnInvalidXmlUnitType(unitType, `chassis ${chassisName} in ${sourceFileName}`);
            const omniType = chassisNode.omni === undefined ? undefined : String(chassisNode.omni);
            let omni: 'Clan' | 'IS' | undefined;
            const chassisKey = buildChassisRecordKey(unitType, chassisName);
            if (omniType === 'Clan') {
                omni = 'Clan';
            } else if (omniType === 'IS') {
                omni = 'IS';
            }

            const chassisRecord = chassis[chassisKey] || {
                t: unitType,
                c: chassisName,
                o: omni,
                e: {},
            };
            chassis[chassisKey] = chassisRecord;

            const chassisAvailability = parseAvailabilityList(getNodeText(chassisNode.availability), year);
            addCompactAvailability(
                chassisRecord.e,
                eras,
                factions,
                chassisAvailability,
                `chassis ${chassisKey} in ${sourceFileName}`
            );

            for (const rawModelNode of ensureArray(chassisNode.model)) {
                const modelNode = rawModelNode as Record<string, unknown>;
                const modelName = String(modelNode.name || '');
                const modelKey = buildModelRecordKey(unitType, chassisName, modelName);
                const modelRecord = models[modelKey] || {
                    t: unitType,
                    c: chassisName,
                    m: modelName,
                    o: omni,
                    e: {},
                };
                models[modelKey] = modelRecord;

                addCompactAvailability(
                    modelRecord.e,
                    eras,
                    factions,
                    parseAvailabilityList(getNodeText(modelNode.availability), year),
                    `model ${modelKey} (chassis ${chassisKey}) in ${sourceFileName}`
                );
            }
        }
    }

    warnOnAvailabilityMismatches(chassis, models, factions);
    const availability = buildCombinedAvailabilityRecords(chassis, models, factions);

    return {
        factionEraData,
        chassis,
        models,
        availability,
        forceGeneratorYears,
    };
}

/*
function loadRulesets(dirPath: string): Record<string, RulesetRecord> {
    const result: Record<string, RulesetRecord> = {};
    for (const fileName of listFiles(dirPath, '.xml')) {
        if (fileName.toLowerCase() === 'formationrulesetschema.xsd') {
            continue;
        }
        const filePath = path.join(dirPath, fileName);
        const parsed = rulesetXmlParser.parse(readText(filePath)) as { ruleset?: Record<string, unknown> };
        const rawRuleset = parsed.ruleset;
        if (!rawRuleset) {
            continue;
        }

        const document = normalizeRulesetNode(rawRuleset, ['ruleset']);
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
            throw new Error(`Failed to normalize ruleset ${fileName}`);
        }

        const factionKey = String(rawRuleset['@_faction'] || fileName.replace(/\.xml$/i, ''));
        result[factionKey] = {
            factionKey,
            parentFaction: rawRuleset['@_parent'] === undefined ? undefined : String(rawRuleset['@_parent']),
            ratingSystem: rawRuleset['@_ratingSystem'] === undefined ? undefined : String(rawRuleset['@_ratingSystem']),
            document: document as JsonObject,
            forceCount: ensureArray(rawRuleset.force).length,
        };
    }
    return result;
}
*/

function buildAncestry(factions: Record<string, UniverseFactionRecord>, factionKey: string): string[] {
    const visited = new Set<string>();
    const ancestry = new Set<string>();

    function visit(currentKey: string): void {
        if (visited.has(currentKey)) {
            return;
        }
        visited.add(currentKey);
        const faction = factions[currentKey];
        if (!faction) {
            return;
        }
        for (const fallback of faction.fallBackFactions) {
            ancestry.add(fallback);
            visit(fallback);
        }
    }

    visit(factionKey);
    return Array.from(ancestry);
}

function groupForceGeneratorYearsByEra(
    forceGeneratorYears: number[],
    eras: MegaMekEra[]
): Record<string, number[]> {
    const groupedYears: Record<string, number[]> = {};

    for (const year of forceGeneratorYears) {
        const matched = eras.find((era) => {
            const from = era.startYear ?? Number.MIN_SAFE_INTEGER;
            const to = era.endYear ?? Number.MAX_SAFE_INTEGER;
            return year >= from && year <= to;
        });

        if (!matched?.code) {
            continue;
        }

        if (!groupedYears[matched.code]) {
            groupedYears[matched.code] = [];
        }

        groupedYears[matched.code].push(year);
    }

    return groupedYears;
}

function isJsonInlinePrimitive(value: unknown): value is string | number | boolean | null {
    return value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean';
}

function tryFormatInlineJsonArray(value: unknown[]): string | undefined {
    if (value.length === 0) {
        return '[]';
    }

    if (value.length > INLINE_JSON_ARRAY_MAX_ITEMS || !value.every((entry) => isJsonInlinePrimitive(entry))) {
        return undefined;
    }

    const rendered = `[${value.map((entry) => JSON.stringify(entry)).join(',')}]`;
    return rendered.length <= INLINE_JSON_ARRAY_MAX_LENGTH ? rendered : undefined;
}

function formatJsonValue(value: unknown, indentLevel = 0): string | undefined {
    if (value && typeof value === 'object' && typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
        return formatJsonValue((value as { toJSON: () => unknown }).toJSON(), indentLevel);
    }

    if (Array.isArray(value)) {
        const inlineArray = tryFormatInlineJsonArray(value);
        if (inlineArray !== undefined) {
            return inlineArray;
        }

        if (value.length === 0) {
            return '[]';
        }

        const currentIndent = ' '.repeat(indentLevel * JSON_INDENT);
        const nextIndent = ' '.repeat((indentLevel + 1) * JSON_INDENT);
        const renderedItems = value.map((entry) => `${nextIndent}${formatJsonValue(entry, indentLevel + 1) ?? 'null'}`);
        return `[` + os.EOL
            + renderedItems.join(`,${os.EOL}`)
            + os.EOL
            + `${currentIndent}]`;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, entryValue]) => [key, formatJsonValue(entryValue, indentLevel + 1)] as const)
            .filter(([, renderedValue]) => renderedValue !== undefined);

        if (entries.length === 0) {
            return '{}';
        }

        const currentIndent = ' '.repeat(indentLevel * JSON_INDENT);
        const nextIndent = ' '.repeat((indentLevel + 1) * JSON_INDENT);
        const renderedEntries = entries.map(
            ([key, renderedValue]) => `${nextIndent}${JSON.stringify(key)}: ${renderedValue}`
        );
        return `{` + os.EOL
            + renderedEntries.join(`,${os.EOL}`)
            + os.EOL
            + `${currentIndent}}`;
    }

    return JSON.stringify(value);
}

function writeJsonFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const contents = BEAUTIFY_OUTPUT
        ? formatJsonValue(data) ?? ''
        : JSON.stringify(data);
    fs.writeFileSync(filePath, contents + os.EOL, 'utf8');
}

function collapseUniformAvailabilityValueForWrite(value: CompactAvailabilityValue): CompactAvailabilityValue {
    if (!hasRatingSpecificAvailability(value)) {
        return value;
    }

    const [first, ...rest] = value;
    return rest.every((entry) => entry === first) ? first : value;
}

function collapseUniformAvailabilityRecordsForWrite<
    TRecord extends CompactAvailabilityRecordBase,
>(records: Record<string, TRecord>): Record<string, TRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([recordKey, record]) => [
            recordKey,
            {
                ...record,
                e: Object.fromEntries(
                    Object.entries(record.e).map(([eraKey, eraAvailability]) => [
                        eraKey,
                        Object.fromEntries(
                            Object.entries(eraAvailability).map(([factionKey, value]) => [
                                factionKey,
                                collapseUniformAvailabilityValueForWrite(value),
                            ])
                        ),
                    ])
                ),
            },
        ])
    );
}

function mergeCompactEraAvailabilityForWrite(
    current: Record<string, CompactEraAvailability>,
    incoming: Record<string, CompactEraAvailability>
): Record<string, CompactEraAvailability> {
    const merged: Record<string, CompactEraAvailability> = {
        ...current,
    };

    for (const [eraKey, incomingEraAvailability] of Object.entries(incoming)) {
        const currentEraAvailability = merged[eraKey] || {};
        const nextEraAvailability: CompactEraAvailability = {
            ...currentEraAvailability,
        };

        for (const [factionKey, incomingValue] of Object.entries(incomingEraAvailability)) {
            const currentValue = nextEraAvailability[factionKey];
            nextEraAvailability[factionKey] = currentValue === undefined
                ? incomingValue
                : mergeCompactAvailabilityValueForMul(currentValue, incomingValue);
        }

        merged[eraKey] = nextEraAvailability;
    }

    return merged;
}

function mergeCompactAvailabilityRecordForWrite<TRecord extends CompactAvailabilityRecord>(
    current: TRecord,
    incoming: TRecord
): TRecord {
    return {
        ...current,
        e: mergeCompactEraAvailabilityForWrite(current.e, incoming.e),
    };
}

function buildCompiledRecordKey(record: CompactAvailabilityRecord, unitType: UnitType): string {
    if ('m' in record) {
        return buildModelRecordKey(unitType, record.c, record.m);
    }

    return buildChassisRecordKey(unitType, record.c);
}

function compileCompactAvailabilityRecords<TRecord extends CompactAvailabilityRecord>(
    records: Record<string, TRecord>,
    sourceLabel: string
): Record<string, TRecord> {
    const compiledRecords: Record<string, TRecord> = {};
    const originalTypesByCompiledKey = new Map<string, Set<string>>();

    for (const record of Object.values(records)) {
        const compiledUnitType = compileXmlUnitType(record.t, `${sourceLabel} ${record.c}`);
        const compiledRecord = {
            ...record,
            t: compiledUnitType,
        } as TRecord;
        const compiledKey = buildCompiledRecordKey(record, compiledUnitType);
        const originalTypes = originalTypesByCompiledKey.get(compiledKey) || new Set<string>();

        if (compiledRecords[compiledKey]) {
            if (!originalTypes.has(record.t) && originalTypes.size > 0) {
                const collidedTypes = [...originalTypes, record.t].sort((left, right) => left.localeCompare(right));
                console.warn(
                    `[MegaMek] ${sourceLabel} collision after unit type compilation for ${compiledKey}: ${collidedTypes.join(', ')}`
                );
            }

            compiledRecords[compiledKey] = mergeCompactAvailabilityRecordForWrite(
                compiledRecords[compiledKey],
                compiledRecord
            );
        } else {
            compiledRecords[compiledKey] = compiledRecord;
        }

        originalTypes.add(record.t);
        originalTypesByCompiledKey.set(compiledKey, originalTypes);
    }

    return compiledRecords;
}

function compactAvailabilityRecordsToArrayForWrite<TRecord extends CompactAvailabilityRecord>(
    records: Record<string, TRecord>
): TRecord[] {
    const collapsedRecords = collapseUniformAvailabilityRecordsForWrite(records);
    return Object.entries(collapsedRecords)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
        .map(([, record]) => record);
}

function collapseUniformWeightedValueForWrite(value: CompactWeightedValue): CompactWeightedValue {
    if (!Array.isArray(value)) {
        return value;
    }

    const [first, ...rest] = value;
    return rest.every((entry) => entry === first) ? first : value;
}

function encodeWeightedQValue(value: number): AvailabilityWeightedQName {
    if (!Number.isFinite(value) || value <= 0) {
        return 'X';
    }

    const clampedValue = Math.min(10, Math.max(1, value));
    const normalizedValue = (clampedValue - 1) / 9;
    const bucketIndex = Math.min(
        WEIGHTED_Q_BUCKETS.length - 1,
        Math.floor(normalizedValue * WEIGHTED_Q_BUCKETS.length)
    );

    return WEIGHTED_Q_BUCKETS[bucketIndex];
}

function encodeWeightedQByRating(value: CompactWeightedByRating): CompactWeightedQByRating {
    return value.map((entry) => encodeWeightedQValue(entry)) as CompactWeightedQByRating;
}

function encodeWeightedQRecordValue(value: CompactWeightedValue): CompactWeightedQValue {
    if (Array.isArray(value)) {
        return encodeWeightedQByRating(value);
    }

    return encodeWeightedQValue(value);
}

function collapseUniformWeightedQValueForWrite(value: CompactWeightedQValue): CompactWeightedQValue {
    if (!Array.isArray(value)) {
        return value;
    }

    const [first, ...rest] = value;
    return rest.every((entry) => entry === first) ? first : value;
}

function collapseUniformWeightedRecordsForWrite(
    records: Record<string, CompactWeightedModelRecord>
): Record<string, CompactWeightedModelRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([recordKey, record]) => [
            recordKey,
            {
                ...record,
                e: Object.fromEntries(
                    Object.entries(record.e).map(([eraKey, eraAvailability]) => [
                        eraKey,
                        Object.fromEntries(
                            Object.entries(eraAvailability).map(([factionKey, value]) => [
                                factionKey,
                                collapseUniformWeightedValueForWrite(value),
                            ])
                        ),
                    ])
                ),
            },
        ])
    );
}

function buildWeightedQRecords(
    records: Record<string, CompactWeightedModelRecord>
): Record<string, CompactWeightedQModelRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([recordKey, record]) => [
            recordKey,
            {
                ...record,
                e: Object.fromEntries(
                    Object.entries(record.e).map(([eraKey, eraAvailability]) => [
                        eraKey,
                        Object.fromEntries(
                            Object.entries(eraAvailability).map(([factionKey, value]) => [
                                factionKey,
                                encodeWeightedQRecordValue(value),
                            ])
                        ),
                    ])
                ),
            },
        ])
    );
}

function collapseUniformWeightedQRecordsForWrite(
    records: Record<string, CompactWeightedQModelRecord>
): Record<string, CompactWeightedQModelRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([recordKey, record]) => [
            recordKey,
            {
                ...record,
                e: Object.fromEntries(
                    Object.entries(record.e).map(([eraKey, eraAvailability]) => [
                        eraKey,
                        Object.fromEntries(
                            Object.entries(eraAvailability).map(([factionKey, value]) => [
                                factionKey,
                                collapseUniformWeightedQValueForWrite(value),
                            ])
                        ),
                    ])
                ),
            },
        ])
    );
}

function compactWeightedRecordsToArrayForWrite(
    records: Record<string, CompactWeightedModelRecord>
): CompactWeightedModelRecord[] {
    const collapsedRecords = collapseUniformWeightedRecordsForWrite(records);
    return Object.entries(collapsedRecords)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
        .map(([, record]) => record);
}

function compactWeightedQRecordsToArrayForWrite(
    records: Record<string, CompactWeightedQModelRecord>
): CompactWeightedQModelRecord[] {
    const collapsedRecords = collapseUniformWeightedQRecordsForWrite(records);
    return Object.entries(collapsedRecords)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
        .map(([, record]) => record);
}

function resolveFactionMulIds(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    skippedFactions: ReadonlySet<string>,
    visited = new Set<string>()
): number[] {
    if (factionKey === GENERAL_FACTION_KEY) {
        return [0];
    }

    if (visited.has(factionKey)) {
        return [];
    }

    visited.add(factionKey);

    const faction = factions[factionKey];
    if (!faction) {
        return [];
    }

    if (skippedFactions.has(factionKey)) {
        return [];
    }

    if (faction.mulId.length > 0) {
        return [...faction.mulId];
    }

    for (const fallbackFactionKey of faction.fallBackFactions) {
        const fallbackMulIds = resolveFactionMulIds(factions, fallbackFactionKey, skippedFactions, new Set(visited));
        if (fallbackMulIds.length > 0) {
            return fallbackMulIds;
        }
    }

    return [];
}

function remapEraAvailabilityToMulIds(
    eraAvailability: CompactEraAvailability,
    factions: Record<string, UniverseFactionRecord>,
    skippedFactions: ReadonlySet<string>
): CompactEraAvailability {
    const mulizedAvailability: CompactEraAvailability = {};

    for (const [factionKey, value] of Object.entries(eraAvailability)) {
        const faction = factions[factionKey];
        if (factionKey !== GENERAL_FACTION_KEY && !faction) {
            console.log(`[MegaMek] skipping MUL remap for unknown faction ${factionKey}`);
            continue;
        }

        if (factionKey !== GENERAL_FACTION_KEY && skippedFactions.has(factionKey)) {
            console.log(`[MegaMek] skipping MUL remap for faction ${factionKey} due to explicit -1 CSV mapping`);
            continue;
        }

        const resolvedMulIds = resolveFactionMulIds(factions, factionKey, skippedFactions);
        if (resolvedMulIds.length === 0) {
            console.log(`[MegaMek] skipping MUL remap for faction ${factionKey} due to missing CSV mapping`);
            continue;
        }

        for (const mulId of resolvedMulIds) {
            const mulKey = String(mulId);
            const previousValue = mulizedAvailability[mulKey];
            mulizedAvailability[mulKey] = previousValue === undefined
                ? value
                : mergeCompactAvailabilityValueForMul(previousValue, value);
        }
    }

    return mulizedAvailability;
}

function remapWeightedEraAvailabilityToMulIds(
    eraAvailability: CompactWeightedEraAvailability,
    factions: Record<string, UniverseFactionRecord>,
    skippedFactions: ReadonlySet<string>
): CompactWeightedEraAvailability {
    const mulizedAvailability: CompactWeightedEraAvailability = {};

    for (const [factionKey, value] of Object.entries(eraAvailability)) {
        const faction = factions[factionKey];
        if (factionKey !== GENERAL_FACTION_KEY && !faction) {
            console.log(`[MegaMek] skipping MUL remap for unknown faction ${factionKey}`);
            continue;
        }

        if (factionKey !== GENERAL_FACTION_KEY && skippedFactions.has(factionKey)) {
            console.log(`[MegaMek] skipping MUL remap for faction ${factionKey} due to explicit -1 CSV mapping`);
            continue;
        }

        const resolvedMulIds = resolveFactionMulIds(factions, factionKey, skippedFactions);
        if (resolvedMulIds.length === 0) {
            console.log(`[MegaMek] skipping MUL remap for faction ${factionKey} due to missing CSV mapping`);
            continue;
        }

        for (const mulId of resolvedMulIds) {
            const mulKey = String(mulId);
            const previousValue = mulizedAvailability[mulKey];
            mulizedAvailability[mulKey] = previousValue === undefined
                ? value
                : mergeCompactWeightedValueForMul(previousValue, value);
        }
    }

    return mulizedAvailability;
}

function mulizeCompactAvailabilityRecords<TRecord extends CompactAvailabilityRecord>(
    records: Record<string, TRecord>,
    factions: Record<string, UniverseFactionRecord>,
    skippedFactions: ReadonlySet<string>
): Record<string, TRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([recordKey, record]) => [
            recordKey,
            {
                ...record,
                e: Object.fromEntries(
                    Object.entries(record.e)
                        .map(([eraKey, eraAvailability]) => [
                            eraKey,
                            remapEraAvailabilityToMulIds(eraAvailability, factions, skippedFactions),
                        ])
                        .filter(([, eraAvailability]) => Object.keys(eraAvailability).length > 0)
                ),
            },
        ])
    );
}

function mulizeCompactWeightedRecords(
    records: Record<string, CompactWeightedModelRecord>,
    factions: Record<string, UniverseFactionRecord>,
    skippedFactions: ReadonlySet<string>
): Record<string, CompactWeightedModelRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([recordKey, record]) => [
            recordKey,
            {
                ...record,
                e: Object.fromEntries(
                    Object.entries(record.e)
                        .map(([eraKey, eraAvailability]) => [
                            eraKey,
                            remapWeightedEraAvailabilityToMulIds(eraAvailability, factions, skippedFactions),
                        ])
                        .filter(([, eraAvailability]) => Object.keys(eraAvailability).length > 0)
                ),
            },
        ])
    );
}

function ensureOutputDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function isManagedOutputFile(fileName: string): boolean {
    return fileName === 'index.json'
        || fileName === 'eras.json'
        || fileName === 'factions.json'
        || fileName === 'mmfactions.json'
        || fileName === 'faction-era-data.json'
        || fileName === 'rulesets.json'
        || fileName === 'chassis.json'
        || fileName === 'models.json'
        || fileName === 'availability.json'
    || fileName === 'availability_weighted.json'
        || fileName === 'availability_weighted_q.json'
        || fileName === 'mulized_chassis.json'
        || fileName === 'mulized_models.json'
    || fileName === 'mulized_availability.json'
    || fileName === 'mulized_availability_weighted.json';
}

function cleanupStaleOutputFiles(dirPath: string, expectedFiles: string[]): void {
    if (!fs.existsSync(dirPath)) {
        return;
    }

    const expected = new Set(expectedFiles);
    for (const fileName of fs.readdirSync(dirPath)) {
        const filePath = path.join(dirPath, fileName);
        if (expected.has(fileName) || !fs.statSync(filePath).isFile() || !isManagedOutputFile(fileName)) {
            continue;
        }

        try {
            fs.rmSync(filePath, { force: true });
        } catch (error) {
            console.warn(`[MegaMek] Skipped cleanup for ${filePath}: ${String(error)}`);
        }
    }
}

function run(): void {
    const universeFactionsDir = path.join(UNIVERSE_ROOT, 'factions');
    const universeCommandsDir = path.join(UNIVERSE_ROOT, 'commands');
    const universeErasPath = path.join(UNIVERSE_ROOT, 'eras.xml');
    const forceGeneratorRulesDir = path.join(FORCEGEN_ROOT, 'faction_rules');

    if (!fs.existsSync(MM_DATA_ROOT)) {
        throw new Error(`MM_DATA_PATH does not exist: ${MM_DATA_ROOT}`);
    }

    const factionMulIdConfig = loadFactionMulIdMap(FACTIONS_MM_TO_MUL_PATH);
    const factions = {
        ...loadUniverseFactions(universeFactionsDir, false, factionMulIdConfig.mappedIds),
        ...loadUniverseFactions(universeCommandsDir, true, factionMulIdConfig.mappedIds),
    };
    const eras = loadMegaMekEras(universeErasPath);
    const forceGeneratorData = loadForceGeneratorData(FORCEGEN_ROOT, eras, factions);
    const compiledChassis = compileCompactAvailabilityRecords(forceGeneratorData.chassis, 'chassis');
    const compiledModels = compileCompactAvailabilityRecords(forceGeneratorData.models, 'models');
    const compiledAvailability = compileCompactAvailabilityRecords(forceGeneratorData.availability, 'availability');
    const weightedAvailability = buildWeightedAvailabilityRecords(compiledChassis, compiledModels, factions);
    const weightedAvailabilityQ = buildWeightedQRecords(weightedAvailability);
    // const rulesets = loadRulesets(forceGeneratorRulesDir);

    const enrichedFactions = Object.fromEntries(
        Object.entries(factions).map(([key, faction]) => [key, {
            ...faction,
            ancestry: buildAncestry(factions, key),
        }])
    );

    const sharedMetadata: MegaMekAvailabilitySharedMetadata = {
        version: 2,
        generatedAt: new Date().toISOString(),
        generator: 'scripts/generate-megamek-availability.ts',
        source: {
            type: 'MegaMek',
            mmDataPath: MM_DATA_ROOT,
            paths: {
                universeFactions: universeFactionsDir,
                universeCommands: universeCommandsDir,
                universeEras: universeErasPath,
                forceGenerator: FORCEGEN_ROOT,
                forceGeneratorRules: forceGeneratorRulesDir,
            },
        },
        summary: {
            factionCount: Object.values(factions).filter((faction) => !faction.isCommand).length,
            commandCount: Object.values(factions).filter((faction) => faction.isCommand).length,
            forceGeneratorEraCount: forceGeneratorData.forceGeneratorYears.length,
            megaMekEraCount: eras.length,
            chassisCount: Object.keys(compiledChassis).length,
            modelCount: Object.keys(compiledModels).length,
        },
    };

    const exportData: MegaMekAvailabilityExport = {
        ...sharedMetadata,
        eras: {
            eras,
            forceGenerator: groupForceGeneratorYearsByEra(forceGeneratorData.forceGeneratorYears, eras),
        },
        factions: enrichedFactions,
        factionEraData: forceGeneratorData.factionEraData,
        chassis: compiledChassis,
        models: compiledModels,
        availability: compiledAvailability,
    };
    const mulizedChassis = mulizeCompactAvailabilityRecords(
        exportData.chassis,
        factions,
        factionMulIdConfig.skippedFactions
    );
    const mulizedModels = mulizeCompactAvailabilityRecords(
        exportData.models,
        factions,
        factionMulIdConfig.skippedFactions
    );
    const mulizedAvailability = mulizeCompactAvailabilityRecords(
        exportData.availability,
        factions,
        factionMulIdConfig.skippedFactions
    );
    const mulizedWeightedAvailability = mulizeCompactWeightedRecords(
        weightedAvailability,
        factions,
        factionMulIdConfig.skippedFactions
    );

    ensureOutputDir(OUTPUT_DIR);

    writeJsonFile(path.join(OUTPUT_DIR, 'eras.json'), exportData.eras);
    writeJsonFile(path.join(OUTPUT_DIR, 'factions.json'), exportData.factions);
    writeJsonFile(path.join(OUTPUT_DIR, 'faction-era-data.json'), exportData.factionEraData);
    writeJsonFile(
        path.join(OUTPUT_DIR, 'chassis.json'),
        compactAvailabilityRecordsToArrayForWrite(exportData.chassis)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'models.json'),
        compactAvailabilityRecordsToArrayForWrite(exportData.models)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'availability.json'),
        compactAvailabilityRecordsToArrayForWrite(exportData.availability)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'availability_weighted.json'),
        compactWeightedRecordsToArrayForWrite(weightedAvailability)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'availability_weighted_q.json'),
        compactWeightedQRecordsToArrayForWrite(weightedAvailabilityQ)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'mulized_chassis.json'),
        compactAvailabilityRecordsToArrayForWrite(mulizedChassis)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'mulized_models.json'),
        compactAvailabilityRecordsToArrayForWrite(mulizedModels)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'mulized_availability.json'),
        compactAvailabilityRecordsToArrayForWrite(mulizedAvailability)
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'mulized_availability_weighted.json'),
        compactWeightedRecordsToArrayForWrite(mulizedWeightedAvailability)
    );
    // writeJsonFile(
    //     path.join(OUTPUT_DIR, 'rulesets.json'),
    //     {
    //         rulesets: exportData.rulesets,
    //     }
    // );

    cleanupStaleOutputFiles(
        OUTPUT_DIR,
        [
            'eras.json',
            'factions.json',
            'faction-era-data.json',
            'chassis.json',
            'models.json',
            'availability.json',
            'availability_weighted.json',
            'availability_weighted_q.json',
            'mulized_chassis.json',
            'mulized_models.json',
            'mulized_availability.json',
            'mulized_availability_weighted.json',
        ]
    );

    console.log(`[MegaMek] Generated ${OUTPUT_DIR}`);
    console.log(
        `[MegaMek] Factions: ${exportData.summary.factionCount}, commands: ${exportData.summary.commandCount}, ` +
        `models: ${exportData.summary.modelCount}, chassis: ${exportData.summary.chassisCount}`
    );
}

run();