import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import { load as loadYaml } from 'js-yaml';

const {
    buildMegaMekUnitName,
    readMegaMekUnitFileMetadata,
} = require('./lib/megamek-unit-file-metadata.ts') as typeof import('./lib/megamek-unit-file-metadata');

const {
    loadOptionalEnvFile,
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

type JsonObject = Record<string, unknown>;
type CompactAvailabilityByRating = [number, number, number, number, number];
type CompactAvailabilityValue = number | `${number}+` | `${number}-` | CompactAvailabilityByRating;
type CompactWeightedByRating = [number, number, number, number, number];
type CompactWeightedValue = [number, number];

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

interface LightFactionRecord {
    id: string;
    name: string;
    mulId: number[];
    yearsActive: DateRange[];
    fallBackFactions: string[];
    ancestry: string[];
    nameChanges: YearKeyedChange[];
    color?: RgbColor;
    logo?: string;
    successor?: string;
}

interface MegaMekEra {
    code: string;
    startYear?: number;
    endYear?: number;
    mulId?: number;
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

type UnitType =
    | 'Aero'
    | 'Handheld Weapon'
    | 'Infantry'
    | 'Mek'
    | 'Naval'
    | 'ProtoMek'
    | 'Tank'
    | 'VTOL';

interface CompactAvailabilityRecordBase {
    t: UnitType;
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
    n: string;
    // t: UnitType;
    // c: string;
    // m: string;
    e: Record<string, CompactWeightedEraAvailability>;
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

interface UnitMetadataRecord {
    unitType: string;
    chassis: string;
    model: string;
    unitName: string;
    introYear?: number;
    weightClass?: number;
    isClanTech: boolean;
    isStarLeague: boolean;
}

interface UnitMetadataIndex {
    byCompositeKey: Map<string, UnitMetadataRecord>;
    byLegacyKey: Map<string, UnitMetadataRecord>;
    byNormalizedKey: Map<string, UnitMetadataRecord>;
    byNormalizedModel: Map<string, UnitMetadataRecord | null>;
    byNormalizedChassis: Map<string, UnitMetadataRecord | null>;
    byNormalizedModelCandidates: Map<string, UnitMetadataRecord[]>;
}

interface ResolvedFactionEraStats {
    pctOmni?: number[];
    pctOmniAero?: number[];
    pctClan?: number[];
    pctClanAero?: number[];
    pctClanVehicle?: number[];
    pctSL?: number[];
    pctSLAero?: number[];
    pctSLVehicle?: number[];
    omniMargin: number;
    techMargin: number;
    upgradeMargin: number;
    salvagePct?: number;
    salvageWeights: Record<string, number>;
    weightDistribution: Record<string, number[]>;
}

interface WeightedRecordChannels {
    normal: CompactWeightedByRating;
    salvage: CompactWeightedByRating;
}

interface FactionMulIdConfig {
    mappedIds: Map<string, number[]>;
    skippedFactions: Set<string>;
}

interface ResolvedFactionRatingProfile {
    sourceLevels: string[];
    canonicalLevels: (typeof DEFAULT_CANONICAL_RATINGS)[number][];
}

const USE_ERA_CODE_KEYS = false;
const BEAUTIFY_OUTPUT = false;
const JSON_INDENT = 2;
const INLINE_JSON_ARRAY_MAX_ITEMS = 8;
const INLINE_JSON_ARRAY_MAX_LENGTH = 40;
const OUTPUT_DECIMAL_PLACES = 1;
const WEIGHTED_AVAILABILITY_MIN_SCORE = 1;
const WEIGHTED_AVAILABILITY_MAX_SCORE = 100;
const WEIGHTED_AVAILABILITY_MIDPOINT_SCORE = 50;
const WEIGHTED_AVAILABILITY_SCORE_SCALE = 10;
const APP_ROOT = path.resolve(__dirname, '..');
const MIN_OMNI_DIFFERENCE = 2.5;
const MIN_SL_DIFFERENCE = 2.5;
const MIN_CLAN_DIFFERENCE = 2.5;
const WEIGHT_DISTRIBUTION_BUCKET_INDEX = [0, 0, 1, 2, 3, 3] as const;
const EXPAND_RATING_ADJUSTMENTS = true;
const GENERAL_FACTION_KEY = 'General';

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
    F: ['F', 'PROVISIONAL GARRISON'],
    D: ['D', 'SOLAHMA'],
    C: ['C', 'SECOND LINE'],
    B: ['B', 'FRONT LINE'],
    A: ['A', 'KESHIK'],
};

loadOptionalEnvFile(APP_ROOT, { logPrefix: 'MegaMek' });

const MM_DATA_ROOT = resolveMmDataRoot(APP_ROOT);
const UNIVERSE_ROOT = path.join(MM_DATA_ROOT, 'data', 'universe');
const FORCEGEN_ROOT = path.join(MM_DATA_ROOT, 'data', 'forcegenerator');
const UNIT_FILES_ROOT = path.join(MM_DATA_ROOT, 'data', 'mekfiles');
const NAME_CHANGES_FILE_PATH = path.join(UNIT_FILES_ROOT, 'name_changes.txt');
const FACTIONS_MM_TO_MUL_PATH = path.join(APP_ROOT, 'scripts', 'config', 'factions-mm-to-mul.csv');
const MM_FACTIONS_IMAGE_DIR = path.join(APP_ROOT, 'public', 'images', 'mmfactions');
const OUTPUT_DIR = path.join(APP_ROOT, 'public', 'assets');

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name, jpath) => {
        const pathKey = typeof jpath === 'string' ? jpath : '';
        return [
            'eras.era',
            'ratgen.factions.faction',
            'ratgen.units.chassis',
        ].includes(pathKey)
            || name === 'model';
    },
});

function getFactionLogoFilename(factionKey: string): string | undefined {
    const fileName = `${factionKey}.png`;
    const filePath = path.join(MM_FACTIONS_IMAGE_DIR, fileName);
    return fs.existsSync(filePath) ? fileName : undefined;
}

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

function listFilesRecursive(dirPath: string, extensions: string[]): string[] {
    const normalizedExtensions = extensions.map((extension) => extension.toLowerCase());
    const files: string[] = [];

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(fullPath, normalizedExtensions));
            continue;
        }

        if (normalizedExtensions.includes(path.extname(entry.name).toLowerCase())) {
            files.push(fullPath);
        }
    }

    return files;
}

function normalizeLookupKey(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[\u2019'`"\[\]\(\)\-]/g, ' ')
        .replace(/\bclass\b/gi, ' ')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function tokenizeLookupKey(value: string): string[] {
    return normalizeLookupKey(value)
        .split(' ')
        .filter(Boolean);
}

function scoreLookupTokens(requestedTokens: string[], candidateTokens: string[]): number {
    if (requestedTokens.length === 0 || candidateTokens.length === 0) {
        return 0;
    }

    const candidateTokenSet = new Set(candidateTokens);
    let shared = 0;
    for (const token of requestedTokens) {
        if (candidateTokenSet.has(token)) {
            shared += 1;
        }
    }

    let prefixMatches = 0;
    const prefixLimit = Math.min(requestedTokens.length, candidateTokens.length);
    for (let index = 0; index < prefixLimit; index += 1) {
        if (requestedTokens[index] !== candidateTokens[index]) {
            break;
        }
        prefixMatches += 1;
    }

    return (prefixMatches * 100) + (shared * 10) - Math.abs(requestedTokens.length - candidateTokens.length);
}

function buildUnitMetadataCompositeKey(unitType: string, chassis: string, model: string): string {
    return `${unitType}\u0000${chassis}\u0000${model}`;
}

function buildUnitMetadataLegacyKey(chassis: string, model: string): string {
    return `${chassis} ${model}`.trim();
}

function addUniqueUnitMetadataLookup(
    index: Map<string, UnitMetadataRecord | null>,
    key: string,
    unitMetadata: UnitMetadataRecord,
): void {
    if (!key) {
        return;
    }

    if (!index.has(key)) {
        index.set(key, unitMetadata);
        return;
    }

    const existing = index.get(key);
    if (existing && existing !== unitMetadata) {
        index.set(key, null);
    }
}

function loadNameChangeAliases(filePath: string): Map<string, string> {
    const aliasMap = new Map<string, string>();
    const raw = readText(filePath);

    for (const line of raw.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('|');
        if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
            continue;
        }

        const previousName = trimmed.slice(0, separatorIndex).trim();
        const replacementName = trimmed.slice(separatorIndex + 1).trim();
        if (previousName && replacementName) {
            aliasMap.set(previousName, replacementName);
        }
    }

    return aliasMap;
}

function resolveAliasName(name: string, aliases: Map<string, string>): string {
    let currentName = name;
    const visited = new Set<string>();

    while (!visited.has(currentName)) {
        visited.add(currentName);
        const nextName = aliases.get(currentName);
        if (!nextName) {
            break;
        }
        currentName = nextName;
    }

    return currentName;
}

function createUnitMetadataIndex(): UnitMetadataIndex {
    return {
        byCompositeKey: new Map<string, UnitMetadataRecord>(),
        byLegacyKey: new Map<string, UnitMetadataRecord>(),
        byNormalizedKey: new Map<string, UnitMetadataRecord>(),
        byNormalizedModel: new Map<string, UnitMetadataRecord | null>(),
        byNormalizedChassis: new Map<string, UnitMetadataRecord | null>(),
        byNormalizedModelCandidates: new Map<string, UnitMetadataRecord[]>(),
    };
}

function indexUnitMetadata(index: UnitMetadataIndex, unitMetadata: UnitMetadataRecord): void {
    const compositeKey = buildUnitMetadataCompositeKey(unitMetadata.unitType, unitMetadata.chassis, unitMetadata.model);
    if (!index.byCompositeKey.has(compositeKey)) {
        index.byCompositeKey.set(compositeKey, unitMetadata);
    }

    const legacyKey = buildUnitMetadataLegacyKey(unitMetadata.chassis, unitMetadata.model);
    if (!index.byLegacyKey.has(legacyKey)) {
        index.byLegacyKey.set(legacyKey, unitMetadata);

        const normalizedKey = normalizeLookupKey(legacyKey);
        if (!index.byNormalizedKey.has(normalizedKey)) {
            index.byNormalizedKey.set(normalizedKey, unitMetadata);
        }

        addUniqueUnitMetadataLookup(index.byNormalizedModel, normalizeLookupKey(unitMetadata.model), unitMetadata);
        addUniqueUnitMetadataLookup(index.byNormalizedChassis, normalizeLookupKey(unitMetadata.chassis), unitMetadata);

        const normalizedModel = normalizeLookupKey(unitMetadata.model);
        if (normalizedModel) {
            const candidates = index.byNormalizedModelCandidates.get(normalizedModel) ?? [];
            candidates.push(unitMetadata);
            index.byNormalizedModelCandidates.set(normalizedModel, candidates);
        }
    }
}

function loadUnitMetadataIndex(unitFilesRoot: string, nameChangesFilePath: string): UnitMetadataIndex {
    const index = createUnitMetadataIndex();

    for (const filePath of listFilesRecursive(unitFilesRoot, ['.blk', '.mtf'])) {
        const unitMetadata = readMegaMekUnitFileMetadata(filePath, unitFilesRoot);
        if (unitMetadata) {
            indexUnitMetadata(index, unitMetadata);
        }
    }

    const aliases = loadNameChangeAliases(nameChangesFilePath);
    for (const [previousName, replacementName] of aliases) {
        const resolvedName = resolveAliasName(replacementName, aliases);
        const unitMetadata = index.byLegacyKey.get(resolvedName)
            ?? index.byNormalizedKey.get(normalizeLookupKey(resolvedName));
        if (!unitMetadata || index.byLegacyKey.has(previousName)) {
            continue;
        }

        index.byLegacyKey.set(previousName, unitMetadata);

        const normalizedPreviousName = normalizeLookupKey(previousName);
        if (normalizedPreviousName && !index.byNormalizedKey.has(normalizedPreviousName)) {
            index.byNormalizedKey.set(normalizedPreviousName, unitMetadata);
        }
    }

    return index;
}

function findClosestUnitMetadataByModelAndChassis(
    index: UnitMetadataIndex,
    chassis: string,
    model: string,
): UnitMetadataRecord | undefined {
    const normalizedModel = normalizeLookupKey(model);
    if (!normalizedModel) {
        return undefined;
    }

    const candidates = index.byNormalizedModelCandidates.get(normalizedModel);
    if (!candidates || candidates.length === 0) {
        return undefined;
    }
    if (candidates.length === 1) {
        return candidates[0];
    }

    const requestedTokens = tokenizeLookupKey(chassis);
    let bestCandidate: UnitMetadataRecord | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestScoreCount = 0;

    for (const candidate of candidates) {
        const candidateTokens = tokenizeLookupKey(candidate.chassis);
        const score = scoreLookupTokens(requestedTokens, candidateTokens);
        if (score > bestScore) {
            bestCandidate = candidate;
            bestScore = score;
            bestScoreCount = 1;
        } else if (score === bestScore) {
            bestScoreCount += 1;
        }
    }

    if (bestCandidate && bestScore > 0 && bestScoreCount === 1) {
        return bestCandidate;
    }

    return undefined;
}

function getCandidateMetadataUnitTypes(compiledUnitType: UnitType): string[] {
    switch (compiledUnitType) {
        case 'Aero':
            return ['AeroSpaceFighter', 'Conventional Fighter', 'Small Craft', 'Dropship', 'Jumpship', 'Warship', 'Space Station'];
        case 'Infantry':
            return ['BattleArmor', 'Infantry'];
        default:
            return [compiledUnitType];
    }
}

function findUnitMetadata(
    index: UnitMetadataIndex,
    unitType: UnitType,
    chassis: string,
    model: string,
): UnitMetadataRecord | undefined {
    for (const candidateUnitType of getCandidateMetadataUnitTypes(unitType)) {
        const exact = index.byCompositeKey.get(buildUnitMetadataCompositeKey(candidateUnitType, chassis, model));
        if (exact) {
            return exact;
        }
    }

    const legacyKey = buildUnitMetadataLegacyKey(chassis, model);
    const legacyMatch = index.byLegacyKey.get(legacyKey);
    if (legacyMatch) {
        return legacyMatch;
    }

    const normalizedLegacyMatch = index.byNormalizedKey.get(normalizeLookupKey(legacyKey));
    if (normalizedLegacyMatch) {
        return normalizedLegacyMatch;
    }

    const closestMatch = findClosestUnitMetadataByModelAndChassis(index, chassis, model);
    if (closestMatch) {
        return closestMatch;
    }

    if (model) {
        const normalizedModelMatch = index.byNormalizedModel.get(normalizeLookupKey(model));
        if (normalizedModelMatch) {
            return normalizedModelMatch;
        }
    }

    const normalizedChassisMatch = index.byNormalizedChassis.get(normalizeLookupKey(chassis));
    return normalizedChassisMatch ?? undefined;
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

    const color = raw as Record<string, unknown>;
    const red = Number(color.red);
    const green = Number(color.green);
    const blue = Number(color.blue);

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
        return { mappedIds, skippedFactions };
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

    return { mappedIds, skippedFactions };
}

function loadUniverseFactions(
    dirPath: string,
    isCommand: boolean,
    factionMulIds: ReadonlyMap<string, number[]>,
): Record<string, UniverseFactionRecord> {
    const result: Record<string, UniverseFactionRecord> = {};

    for (const fileName of listFiles(dirPath, '.yml')) {
        const filePath = path.join(dirPath, fileName);
        const raw = readYamlFile(filePath);
        const id = String(raw.key);
        const logo = getFactionLogoFilename(id);
        result[id] = {
            id,
            name: String(raw.name || id),
            mulId: [...(factionMulIds.get(id) ?? [])],
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

function buildLightFactionRecords(
    factions: Record<string, UniverseFactionRecord>,
): Record<string, LightFactionRecord> {
    return Object.fromEntries(
        Object.entries(factions).map(([factionKey, faction]) => [
            factionKey,
            {
                id: faction.id,
                name: faction.name,
                mulId: faction.mulId,
                yearsActive: faction.yearsActive,
                fallBackFactions: faction.fallBackFactions,
                ancestry: buildAncestry(factions, factionKey),
                nameChanges: faction.nameChanges,
                color: faction.color,
                logo: faction.logo,
                successor: faction.successor,
            },
        ]),
    );
}

function loadMegaMekEras(filePath: string): MegaMekEra[] {
    const parsed = xmlParser.parse(readText(filePath)) as { eras?: { era?: Array<Record<string, unknown>> } };
    const eras: MegaMekEra[] = ensureArray(parsed.eras?.era).map((era) => ({
        code: String(era.code),
        endYear: parseYear(era.end),
        mulId: era.mulid ? Number.parseInt(String(era.mulid), 10) : undefined,
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
            baseAvailability: Object.values(byRating).reduce((highest, value) => Math.max(highest, value), 0),
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

    console.warn(`[MegaMek] unexpected unit type "${unitType}" in ${sourceLabel}`);
}

function compileXmlUnitType(unitType: string, sourceLabel: string): UnitType {
    const compiledUnitType = COMPILED_UNIT_TYPE_BY_XML_UNIT_TYPE[unitType];
    if (compiledUnitType) {
        return compiledUnitType;
    }

    console.warn(`[MegaMek] could not compile unit type "${unitType}" in ${sourceLabel}; keeping original value`);
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

function resolveEraKey(era: MegaMekEra | undefined): string | number | undefined {
    if (!era) {
        return undefined;
    }

    if (USE_ERA_CODE_KEYS) {
        return era.code;
    }

    return era.mulId;
}

function findEraKey(eras: MegaMekEra[], year: number): string | number | undefined {
    return resolveEraKey(findEraForYear(eras, year));
}

function isFactionActiveInYear(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    year: number,
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
    value: number,
): void {
    availability[CANONICAL_RATING_INDEX[canonical]] = value;
}

function createAvailabilityByCanonicalLevels(
    canonicalLevels: readonly (typeof DEFAULT_CANONICAL_RATINGS)[number][],
    value: number,
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
    canonicalLevels = getCanonicalRatingCodes(ratingLevels),
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
    visited = new Set<string>(),
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
    faction: UniverseFactionRecord,
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
    visited = new Set<string>(),
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

function getFactionRatingMap(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
): Map<string, (typeof DEFAULT_CANONICAL_RATINGS)[number]> {
    const profile = resolveFactionRatingProfile(factions, factionKey);
    if (profile.sourceLevels.length === 0 || profile.canonicalLevels.length === 0) {
        return buildRatingMapFromLevels([...DEFAULT_CANONICAL_RATINGS]);
    }

    return buildRatingMapFromLevels(profile.sourceLevels, profile.canonicalLevels);
}

function resolveAvailabilityYearForFaction(
    factions: Record<string, UniverseFactionRecord>,
    availability: ParsedAvailability,
    _sourceLabel: string,
): number | undefined {
    const fileYearIsActive = isFactionActiveInYear(factions, availability.factionKey, availability.fileYear);
    const entryYearIsActive = availability.entryYear !== undefined
        ? isFactionActiveInYear(factions, availability.factionKey, availability.entryYear)
        : undefined;

    if (availability.entryYear !== undefined) {
        if (entryYearIsActive) {
            return availability.entryYear;
        }

        if (fileYearIsActive) {
            return availability.fileYear;
        }

        return availability.entryYear;
    }

    return availability.fileYear;
}

function normalizeExplicitAvailabilityByRating(
    factionKey: string,
    byRating: Record<string, number>,
    factions: Record<string, UniverseFactionRecord>,
    sourceLabel: string,
): CompactAvailabilityByRating {
    const ratingMap = getFactionRatingMap(factions, factionKey);
    const normalized = createEmptyAvailabilityByRating();

    for (const [ratingName, value] of Object.entries(byRating)) {
        const canonical = ratingMap.get(normalizeRatingName(ratingName));
        if (!canonical) {
            console.warn(`[MegaMek] bad ! rating "${ratingName}" for ${factionKey} in ${sourceLabel}`);
            continue;
        }

        const index = CANONICAL_RATING_INDEX[canonical];
        normalized[index] = Math.max(normalized[index], normalizeAvailabilityValue(value));
    }

    return normalized;
}

function expandAdjustedAvailabilityByRating(
    availability: ParsedAvailability,
    factions: Record<string, UniverseFactionRecord>,
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

function encodeCompactAvailabilityValue(
    availability: ParsedAvailability,
    factions: Record<string, UniverseFactionRecord>,
    sourceLabel: string,
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

function addCompactAvailability(
    target: Record<string, CompactEraAvailability>,
    eras: MegaMekEra[],
    factions: Record<string, UniverseFactionRecord>,
    availabilityList: ParsedAvailability[],
    sourceLabel: string,
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
            // console.log(`[MegaMek] skipping availability for ${availability.factionKey} in year ${availabilityYear} (${sourceLabel}) due to undefined era`);
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

function hasRatingSpecificAvailability(value: CompactAvailabilityValue): value is CompactAvailabilityByRating {
    return Array.isArray(value);
}

function mergeCompactAvailabilityByRating(
    current: CompactAvailabilityByRating,
    incoming: CompactAvailabilityByRating,
): CompactAvailabilityByRating {
    const merged = [...current] as CompactAvailabilityByRating;
    for (let index = 0; index < merged.length; index += 1) {
        merged[index] = Math.max(merged[index], incoming[index]);
    }
    return merged;
}

function mergeCompactAvailabilityValue(
    current: CompactAvailabilityValue,
    incoming: CompactAvailabilityValue,
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
    visited = new Set<string>(),
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
            new Set(visited),
        );
    }

    if (faction.fallBackFactions.length > 1) {
        const resolvedParents = faction.fallBackFactions
            .map((fallbackFactionKey) => resolveCompactAvailabilityForFaction(
                eraAvailability,
                factions,
                fallbackFactionKey,
                new Set(visited),
            ))
            .filter((value): value is CompactAvailabilityValue => value !== undefined);

        return averageCompactAvailabilityValues(resolvedParents);
    }

    return eraAvailability[GENERAL_FACTION_KEY];
}

function calcWeightedScore(relativeWeight: number): number {
    if (!Number.isFinite(relativeWeight) || relativeWeight <= 0) {
        return 0;
    }

    const score = WEIGHTED_AVAILABILITY_MIDPOINT_SCORE
        + (calcAvailabilityFromWeight(relativeWeight) * WEIGHTED_AVAILABILITY_SCORE_SCALE);
    return Math.round(Math.min(
        WEIGHTED_AVAILABILITY_MAX_SCORE,
        Math.max(WEIGHTED_AVAILABILITY_MIN_SCORE, score),
    ));
}

function mergeCompactWeightedValueForMul(
    current: CompactWeightedValue,
    incoming: CompactWeightedValue,
): CompactWeightedValue {
    return [
        Math.max(current[0], incoming[0]),
        Math.max(current[1], incoming[1]),
    ];
}

function mergeCompactAvailabilityValueForMul(
    current: CompactAvailabilityValue,
    incoming: CompactAvailabilityValue,
): CompactAvailabilityValue {
    if (!hasRatingSpecificAvailability(current) && !hasRatingSpecificAvailability(incoming)) {
        return Math.max(Number.parseInt(String(current), 10), Number.parseInt(String(incoming), 10));
    }

    return mergeCompactAvailabilityByRating(
        expandAvailabilityValueToByRating(current),
        expandAvailabilityValueToByRating(incoming),
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
    incoming: Record<string, number[]> | undefined,
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
    incoming: EraFactionStats['salvage'],
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
        weights[factionKey] = weights[factionKey] === undefined ? value : Math.max(weights[factionKey], value);
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
    stats: EraFactionStats,
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

function averagePositiveWeightedScores(values: number[]): number {
    const positiveValues = values.filter((value) => value > 0);
    if (positiveValues.length === 0) {
        return 0;
    }

    const total = positiveValues.reduce((sum, value) => sum + value, 0);
    return Math.round(total / positiveValues.length);
}

function cloneWeightedByRating(value?: CompactWeightedByRating): CompactWeightedByRating {
    return value ? [...value] as CompactWeightedByRating : createEmptyWeightedByRating();
}

function createEmptyWeightedChannels(): WeightedRecordChannels {
    return {
        normal: createEmptyWeightedByRating(),
        salvage: createEmptyWeightedByRating(),
    };
}

function mergeResolvedPercentageArrays(values: Array<number[] | undefined>): number[] | undefined {
    const definedValues = values.filter((value): value is number[] => value !== undefined && value.length > 0);
    if (definedValues.length === 0) {
        return undefined;
    }

    const length = Math.max(...definedValues.map((value) => value.length));
    const merged: number[] = [];
    for (let index = 0; index < length; index += 1) {
        let total = 0;
        let count = 0;
        for (const value of definedValues) {
            if (value[index] !== undefined) {
                total += value[index];
                count += 1;
            }
        }
        if (count > 0) {
            merged[index] = Math.trunc(total / count);
        }
    }

    return merged;
}

function mergeSummedNumberArrays(values: Array<number[] | undefined>): number[] | undefined {
    const definedValues = values.filter((value): value is number[] => value !== undefined && value.length > 0);
    if (definedValues.length === 0) {
        return undefined;
    }

    const length = Math.max(...definedValues.map((value) => value.length));
    const merged = new Array<number>(length).fill(0);
    for (const value of definedValues) {
        for (let index = 0; index < value.length; index += 1) {
            merged[index] += value[index] ?? 0;
        }
    }

    return merged;
}

function isClanFaction(faction: UniverseFactionRecord | undefined): boolean {
    if (!faction) {
        return false;
    }

    return faction.name.startsWith('Clan ')
        || faction.id.startsWith('CLAN')
        || faction.tags.some((tag) => tag.toLowerCase() === 'clan');
}

function resolveFactionEraStats(
    factionEraData: Record<string, Record<string, EraFactionStats>>,
    factions: Record<string, UniverseFactionRecord>,
    eraKey: string,
    factionKey: string,
    cache: Map<string, ResolvedFactionEraStats>,
    visited = new Set<string>(),
): ResolvedFactionEraStats {
    const cacheKey = `${eraKey}\u0000${factionKey}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    if (visited.has(factionKey)) {
        return {
            omniMargin: 0,
            techMargin: 0,
            upgradeMargin: 0,
            salvageWeights: {},
            weightDistribution: {},
        };
    }

    visited.add(factionKey);

    const direct = factionEraData[eraKey]?.[factionKey];
    const parentStats = (factions[factionKey]?.fallBackFactions ?? [])
        .map((parentFactionKey) => resolveFactionEraStats(
            factionEraData,
            factions,
            eraKey,
            parentFactionKey,
            cache,
            new Set(visited),
        ));

    const directWeightDistribution = direct?.weightDistribution ?? {};
    const weightDistributionKeys = new Set<string>([
        ...Object.keys(directWeightDistribution),
        ...parentStats.flatMap((entry) => Object.keys(entry.weightDistribution)),
    ]);

    const weightDistribution: Record<string, number[]> = {};
    for (const unitType of weightDistributionKeys) {
        if (directWeightDistribution[unitType]?.length) {
            weightDistribution[unitType] = [...directWeightDistribution[unitType]];
            continue;
        }

        const merged = mergeSummedNumberArrays(parentStats.map((entry) => entry.weightDistribution[unitType]));
        if (merged?.length) {
            weightDistribution[unitType] = merged;
        }
    }

    const hasDirectSalvageWeights = Boolean(direct?.salvage && Object.keys(direct.salvage.weights).length > 0);
    const salvageWeights = hasDirectSalvageWeights
        ? { ...(direct?.salvage?.weights ?? {}) }
        : Object.fromEntries(
            Object.entries(
                parentStats.reduce<Record<string, number>>((merged, parent) => {
                    for (const [sourceFactionKey, value] of Object.entries(parent.salvageWeights)) {
                        merged[sourceFactionKey] = (merged[sourceFactionKey] ?? 0) + value;
                    }
                    return merged;
                }, {}),
            ),
        );

    const resolved: ResolvedFactionEraStats = {
        pctOmni: direct?.pctOmni?.length ? [...direct.pctOmni] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctOmni)),
        pctOmniAero: direct?.pctOmniAero?.length ? [...direct.pctOmniAero] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctOmniAero)),
        pctClan: direct?.pctClan?.length ? [...direct.pctClan] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctClan)),
        pctClanAero: direct?.pctClanAero?.length ? [...direct.pctClanAero] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctClanAero)),
        pctClanVehicle: direct?.pctClanVehicle?.length ? [...direct.pctClanVehicle] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctClanVehicle)),
        pctSL: direct?.pctSL?.length ? [...direct.pctSL] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctSL)),
        pctSLAero: direct?.pctSLAero?.length ? [...direct.pctSLAero] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctSLAero)),
        pctSLVehicle: direct?.pctSLVehicle?.length ? [...direct.pctSLVehicle] : mergeResolvedPercentageArrays(parentStats.map((entry) => entry.pctSLVehicle)),
        omniMargin: direct?.omniMargin ?? 0,
        techMargin: direct?.techMargin ?? 0,
        upgradeMargin: direct?.upgradeMargin ?? 0,
        salvagePct: direct?.salvage?.pct,
        salvageWeights,
        weightDistribution,
    };

    cache.set(cacheKey, resolved);
    return resolved;
}

function getRatingTargetValue(values: number[] | undefined, ratingIndex: number): number | undefined {
    if (!values || values.length === 0 || values[ratingIndex] === undefined) {
        return undefined;
    }

    return values[ratingIndex];
}

function getWeightDistributionForUnitType(stats: ResolvedFactionEraStats, unitType: string): number[] | undefined {
    if (unitType === 'Mek') {
        return stats.weightDistribution.Mek;
    }

    if (unitType === 'Tank') {
        return stats.weightDistribution.Tank;
    }

    if (unitType === 'AeroSpaceFighter') {
        return stats.weightDistribution.AeroSpaceFighter;
    }

    return undefined;
}

function getTechCategoryTargets(
    stats: ResolvedFactionEraStats,
    unitType: string,
): { pctOmni?: number[]; pctClan?: number[]; pctSL?: number[] } {
    if (unitType === 'Mek') {
        return {
            pctOmni: stats.pctOmni,
            pctClan: stats.pctClan,
            pctSL: stats.pctSL,
        };
    }

    if (unitType === 'AeroSpaceFighter') {
        return {
            pctOmni: stats.pctOmniAero,
            pctClan: stats.pctClanAero,
            pctSL: stats.pctSLAero,
        };
    }

    if (unitType === 'Tank' || unitType === 'VTOL') {
        return {
            pctClan: stats.pctClanVehicle,
            pctSL: stats.pctSLVehicle,
        };
    }

    return {};
}

function getEligibleModelKeysBySourceUnitType(
    modelWeightsByKey: Map<string, CompactWeightedByRating>,
    modelMetadataByKey: Map<string, UnitMetadataRecord>,
    unitType: string,
): string[] {
    return Array.from(modelWeightsByKey.keys()).filter((modelKey) => modelMetadataByKey.get(modelKey)?.unitType === unitType);
}

function sumModelWeightsAtRating(modelWeightsByKey: Map<string, CompactWeightedByRating>, ratingIndex: number): number {
    let total = 0;
    for (const weights of modelWeightsByKey.values()) {
        total += weights[ratingIndex] ?? 0;
    }
    return total;
}

function buildSalvageAllocations(
    stats: ResolvedFactionEraStats,
    normalWeightsByModelKey: Map<string, CompactWeightedByRating>,
): { allocations: Map<string, CompactWeightedByRating>; clearNormalRatings: boolean[] } {
    const allocations = new Map<string, CompactWeightedByRating>();
    const clearNormalRatings = [false, false, false, false, false];
    const salvagePct = stats.salvagePct;
    const salvageWeights = Object.entries(stats.salvageWeights).filter(([, value]) => value > 0);

    if (salvagePct === undefined || salvageWeights.length === 0) {
        return { allocations, clearNormalRatings };
    }

    const totalFactionWeight = salvageWeights.reduce((sum, [, value]) => sum + value, 0);
    if (totalFactionWeight <= 0) {
        return { allocations, clearNormalRatings };
    }

    for (let ratingIndex = 0; ratingIndex < 5; ratingIndex += 1) {
        const totalTableWeight = sumModelWeightsAtRating(normalWeightsByModelKey, ratingIndex);
        if (totalTableWeight <= 0) {
            continue;
        }

        let overallSalvage = totalTableWeight * salvagePct / 100;
        if (salvagePct >= 100) {
            overallSalvage = totalTableWeight;
            clearNormalRatings[ratingIndex] = true;
        }

        for (const [sourceFactionKey, weight] of salvageWeights) {
            const factionAllocation = allocations.get(sourceFactionKey) ?? createEmptyWeightedByRating();
            factionAllocation[ratingIndex] = overallSalvage * weight / totalFactionWeight;
            allocations.set(sourceFactionKey, factionAllocation);
        }
    }

    return { allocations, clearNormalRatings };
}

function applyWeightDistributionToModels(
    modelWeightsByKey: Map<string, CompactWeightedByRating>,
    eligibleModelKeys: string[],
    modelMetadataByKey: Map<string, UnitMetadataRecord>,
    distribution: number[] | undefined,
): void {
    if (!distribution || distribution.length === 0 || eligibleModelKeys.length === 0) {
        return;
    }

    for (let ratingIndex = 0; ratingIndex < 5; ratingIndex += 1) {
        const bucketGroups = new Map<number, string[]>();
        let totalTableWeight = 0;

        for (const modelKey of eligibleModelKeys) {
            const weight = modelWeightsByKey.get(modelKey)?.[ratingIndex] ?? 0;
            const weightClass = modelMetadataByKey.get(modelKey)?.weightClass;
            if (weight <= 0 || weightClass === undefined) {
                continue;
            }

            const bucketIndex = WEIGHT_DISTRIBUTION_BUCKET_INDEX[weightClass];
            if (bucketIndex === undefined || bucketIndex >= distribution.length) {
                continue;
            }

            totalTableWeight += weight;
            const bucketModels = bucketGroups.get(bucketIndex) ?? [];
            bucketModels.push(modelKey);
            bucketGroups.set(bucketIndex, bucketModels);
        }

        if (totalTableWeight <= 0 || bucketGroups.size <= 1) {
            continue;
        }

        const totalDistributionWeight = Array.from(bucketGroups.keys())
            .reduce((sum, bucketIndex) => sum + (distribution[bucketIndex] ?? 0), 0);
        if (totalDistributionWeight <= 0) {
            continue;
        }

        for (const [bucketIndex, bucketModelKeys] of bucketGroups.entries()) {
            const bucketWeight = bucketModelKeys.reduce(
                (sum, modelKey) => sum + (modelWeightsByKey.get(modelKey)?.[ratingIndex] ?? 0),
                0,
            );
            if (bucketWeight <= 0) {
                continue;
            }

            const adjustment = totalTableWeight * (distribution[bucketIndex] ?? 0) / (bucketWeight * totalDistributionWeight);
            for (const modelKey of bucketModelKeys) {
                const weights = modelWeightsByKey.get(modelKey);
                if (!weights || weights[ratingIndex] <= 0) {
                    continue;
                }
                weights[ratingIndex] *= adjustment;
            }
        }
    }
}

function applyTechRebalanceToModels(
    modelWeightsByKey: Map<string, CompactWeightedByRating>,
    eligibleModelKeys: string[],
    modelMetadataByKey: Map<string, UnitMetadataRecord>,
    modelRecords: Record<string, CompactModelRecord>,
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    unitType: string,
    stats: ResolvedFactionEraStats,
    salvageAllocations: Map<string, CompactWeightedByRating>,
): void {
    if (eligibleModelKeys.length === 0) {
        return;
    }

    const targetArrays = getTechCategoryTargets(stats, unitType);
    const factionIsClan = isClanFaction(factions[factionKey]);

    for (let ratingIndex = 0; ratingIndex < 5; ratingIndex += 1) {
        const summarize = () => {
            let totalWeight = 0;
            let totalOmniWeight = 0;
            let totalClanWeight = 0;
            let totalSLWeight = 0;
            let totalOtherWeight = 0;

            for (const modelKey of eligibleModelKeys) {
                const weight = modelWeightsByKey.get(modelKey)?.[ratingIndex] ?? 0;
                if (weight <= 0) {
                    continue;
                }

                totalWeight += weight;
                if (modelRecords[modelKey]?.o) {
                    totalOmniWeight += weight;
                }

                const metadata = modelMetadataByKey.get(modelKey);
                if (metadata?.isClanTech) {
                    totalClanWeight += weight;
                } else if (metadata?.isStarLeague) {
                    totalSLWeight += weight;
                } else {
                    totalOtherWeight += weight;
                }
            }

            return {
                totalWeight,
                totalOmniWeight,
                totalClanWeight,
                totalSLWeight,
                totalOtherWeight,
            };
        };

        let { totalWeight, totalOmniWeight, totalClanWeight, totalSLWeight, totalOtherWeight } = summarize();
        if (totalWeight <= 0) {
            continue;
        }

        let pctOmni = getRatingTargetValue(targetArrays.pctOmni, ratingIndex);
        let pctClan = getRatingTargetValue(targetArrays.pctClan, ratingIndex);
        let pctSL = getRatingTargetValue(targetArrays.pctSL, ratingIndex);
        let pctOther: number | undefined;

        if (pctOmni !== undefined && stats.omniMargin > 0) {
            const pct = 100 * totalOmniWeight / totalWeight;
            if (pct < pctOmni - stats.omniMargin) {
                pctOmni -= stats.omniMargin;
            } else if (pct > pctOmni + stats.omniMargin) {
                pctOmni += stats.omniMargin;
            }
        }

        if ((unitType === 'Mek' || unitType === 'AeroSpaceFighter') && pctOmni !== undefined) {
            const omniPctDifference = pctOmni - (100 * totalOmniWeight / totalWeight);
            if (Math.abs(omniPctDifference) > MIN_OMNI_DIFFERENCE && totalOmniWeight > 0 && pctOmni >= 0) {
                const totalNonOmniWeight = totalOmniWeight - totalWeight;
                for (const modelKey of eligibleModelKeys) {
                    const weights = modelWeightsByKey.get(modelKey);
                    if (!weights || weights[ratingIndex] <= 0) {
                        continue;
                    }

                    let currentWeight = weights[ratingIndex];
                    if (modelRecords[modelKey]?.o) {
                        currentWeight = pctOmni > 0
                            ? currentWeight + currentWeight * omniPctDifference / totalOmniWeight
                            : 0;
                    } else {
                        currentWeight = pctOmni < 100
                            ? currentWeight + currentWeight * omniPctDifference / totalNonOmniWeight
                            : 0;
                    }

                    weights[ratingIndex] = Math.max(0, currentWeight);
                }

                ({ totalWeight, totalOmniWeight, totalClanWeight, totalSLWeight, totalOtherWeight } = summarize());
                if (totalWeight <= 0) {
                    continue;
                }
            }
        }

        if (pctSL !== undefined || pctClan !== undefined) {
            pctOther = 100;
            if (pctSL !== undefined) {
                pctOther -= pctSL;
            }
            if (pctClan !== undefined) {
                pctOther -= pctClan;
            }

            if (stats.techMargin > 0) {
                if (pctClan !== undefined) {
                    const pct = 100 * totalClanWeight / totalWeight;
                    if (pct < pctClan - stats.techMargin) {
                        pctClan -= stats.techMargin;
                    } else if (pct > pctClan + stats.techMargin) {
                        pctClan += stats.techMargin;
                    }
                }

                if (pctSL !== undefined) {
                    const pct = 100 * totalSLWeight / totalWeight;
                    if (pct < pctSL - stats.techMargin) {
                        pctSL -= stats.techMargin;
                    } else if (pct > pctSL + stats.techMargin) {
                        pctSL += stats.techMargin;
                    }
                }
            }

            if (stats.upgradeMargin > 0 && pctOther !== undefined) {
                const pct = 100 * (totalWeight - totalClanWeight - totalSLWeight) / totalWeight;
                if (pct < pctOther - stats.upgradeMargin) {
                    pctOther -= stats.upgradeMargin;
                } else if (pct > pctOther + stats.upgradeMargin) {
                    pctOther += stats.upgradeMargin;
                }

                if (stats.techMargin > 0 && stats.upgradeMargin <= stats.techMargin) {
                    if (pctClan === undefined || pctClan === 0) {
                        pctSL = 100 - pctOther;
                    } else if (pctSL === undefined || pctSL === 0) {
                        pctClan = 100 - pctOther;
                    } else {
                        pctSL = (100 - pctOther) * pctSL / (pctSL + pctClan);
                        pctClan = 100 - pctOther - pctSL;
                    }
                }
            }
        }

        if (pctSL !== undefined) {
            const slPctDifference = pctSL - (100 * totalSLWeight / totalWeight);
            if (Math.abs(slPctDifference) > MIN_SL_DIFFERENCE && totalSLWeight > 0) {
                const totalNonSLWeight = totalSLWeight - totalWeight;
                for (const modelKey of eligibleModelKeys) {
                    const weights = modelWeightsByKey.get(modelKey);
                    const metadata = modelMetadataByKey.get(modelKey);
                    if (!weights || !metadata || weights[ratingIndex] <= 0) {
                        continue;
                    }

                    let currentWeight = weights[ratingIndex];
                    if (metadata.isStarLeague) {
                        currentWeight = pctSL > 0
                            ? currentWeight + currentWeight * slPctDifference / totalSLWeight
                            : 0;
                    } else {
                        currentWeight = pctSL < 100
                            ? currentWeight + currentWeight * slPctDifference / totalNonSLWeight
                            : 0;
                    }

                    weights[ratingIndex] = Math.max(0, currentWeight);
                }

                ({ totalWeight, totalOmniWeight, totalClanWeight, totalSLWeight, totalOtherWeight } = summarize());
                if (totalWeight <= 0) {
                    continue;
                }
            }
        }

        let clanSalvageWeight = 0;
        if (pctClan !== undefined && !factionIsClan) {
            for (const [sourceFactionKey, weights] of salvageAllocations.entries()) {
                if (isClanFaction(factions[sourceFactionKey])) {
                    clanSalvageWeight += weights[ratingIndex] ?? 0;
                }
            }
        }

        if (pctClan !== undefined) {
            const clanPctDifference = pctClan - (100 * Math.min(totalWeight, totalClanWeight + clanSalvageWeight) / totalWeight);
            if (Math.abs(clanPctDifference) > MIN_CLAN_DIFFERENCE && totalClanWeight > 0) {
                const totalNonClanWeight = Math.min(totalWeight, totalClanWeight + clanSalvageWeight) - totalWeight;
                for (const modelKey of eligibleModelKeys) {
                    const weights = modelWeightsByKey.get(modelKey);
                    const metadata = modelMetadataByKey.get(modelKey);
                    if (!weights || !metadata || weights[ratingIndex] <= 0) {
                        continue;
                    }

                    let currentWeight = weights[ratingIndex];
                    if (metadata.isClanTech) {
                        currentWeight = pctClan > 0
                            ? currentWeight + currentWeight * clanPctDifference / totalClanWeight
                            : 0;
                    } else {
                        currentWeight = pctClan < 100
                            ? currentWeight + currentWeight * clanPctDifference / totalNonClanWeight
                            : 0;
                    }

                    weights[ratingIndex] = Math.max(0, currentWeight);
                }

                ({ totalWeight, totalOmniWeight, totalClanWeight, totalSLWeight, totalOtherWeight } = summarize());
                if (totalWeight <= 0) {
                    continue;
                }
            }
        }

        if (pctSL !== undefined && pctClan !== undefined && pctOther !== undefined && (pctOther === 0 || pctSL + pctClan >= 100)) {
            const pctOtherDifference = pctOther - 100 * totalOtherWeight / totalWeight;
            const totalAdvancedWeight = totalOtherWeight - totalWeight;
            for (const modelKey of eligibleModelKeys) {
                const weights = modelWeightsByKey.get(modelKey);
                const metadata = modelMetadataByKey.get(modelKey);
                if (!weights || !metadata || weights[ratingIndex] <= 0) {
                    continue;
                }

                let currentWeight = weights[ratingIndex];
                if (!metadata.isStarLeague && !metadata.isClanTech) {
                    currentWeight = 0;
                } else {
                    currentWeight = currentWeight + currentWeight * pctOtherDifference / totalAdvancedWeight;
                }

                weights[ratingIndex] = Math.max(0, currentWeight);
            }
        }
    }
}

function resolveModelMetadataByKey(
    models: Record<string, CompactModelRecord>,
    unitMetadataIndex: UnitMetadataIndex,
): Map<string, UnitMetadataRecord> {
    const metadataByKey = new Map<string, UnitMetadataRecord>();

    for (const [modelKey, modelRecord] of Object.entries(models)) {
        const metadata = findUnitMetadata(unitMetadataIndex, modelRecord.t, modelRecord.c, modelRecord.m);
        if (!metadata) {
            console.warn(`[MegaMek] missing unit metadata for weighted availability model ${modelKey}`);
            continue;
        }

        metadataByKey.set(modelKey, metadata);
    }

    return metadataByKey;
}

function buildWeightedAvailabilityRecords(
    chassis: Record<string, CompactChassisRecord>,
    models: Record<string, CompactModelRecord>,
    factions: Record<string, UniverseFactionRecord>,
    factionEraData: Record<string, Record<string, EraFactionStats>>,
    unitMetadataIndex: UnitMetadataIndex,
): Record<string, CompactWeightedModelRecord> {
    const weightedAvailability: Record<string, CompactWeightedModelRecord> = {};
    const modelsByChassis = new Map<string, Array<[string, CompactModelRecord]>>();
    const chassisKeysByUnitType = new Map<string, string[]>();
    const modelMetadataByKey = resolveModelMetadataByKey(models, unitMetadataIndex);
    const factionStatsCache = new Map<string, ResolvedFactionEraStats>();

    for (const [modelKey, modelRecord] of Object.entries(models)) {
        const chassisKey = buildChassisRecordKey(modelRecord.t, modelRecord.c);
        const groupedModels = modelsByChassis.get(chassisKey) || [];
        groupedModels.push([modelKey, modelRecord]);
        modelsByChassis.set(chassisKey, groupedModels);

        const metadata = modelMetadataByKey.get(modelKey);

        weightedAvailability[modelKey] = {
            n: metadata?.unitName ?? buildMegaMekUnitName(modelRecord.t, modelRecord.c, modelRecord.m),
            // t: modelRecord.t,
            // c: metadata?.chassis ?? modelRecord.c,
            // m: metadata?.model ?? modelRecord.m,
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
            const directFactionKeys = new Set<string>();

            for (const chassisKey of chassisKeys) {
                const chassisRecord = chassis[chassisKey];
                Object.keys(chassisRecord.e[eraKey] || {}).forEach((factionKey) => directFactionKeys.add(factionKey));
                for (const [, modelRecord] of modelsByChassis.get(chassisKey) || []) {
                    Object.keys(modelRecord.e[eraKey] || {}).forEach((factionKey) => directFactionKeys.add(factionKey));
                }
            }

            const factionKeys = new Set<string>(directFactionKeys);
            for (const factionKey of directFactionKeys) {
                const stats = resolveFactionEraStats(factionEraData, factions, eraKey, factionKey, factionStatsCache);
                Object.keys(stats.salvageWeights).forEach((sourceFactionKey) => factionKeys.add(sourceFactionKey));
            }

            const normalWeightsByFaction = new Map<string, Map<string, CompactWeightedByRating>>();
            const salvageAllocationsByFaction = new Map<string, Map<string, CompactWeightedByRating>>();

            for (const factionKey of factionKeys) {
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

                    for (let index = 0; index < totalModelWeight.length; index += 1) {
                        if (chassisByRating[index] <= 0 || totalModelWeight[index] <= 0) {
                            continue;
                        }

                        const chassisWeight = calcAvailabilityWeight(chassisByRating[index]);

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

                if (modelWeightsByKey.size === 0) {
                    continue;
                }

                const resolvedStats = resolveFactionEraStats(factionEraData, factions, eraKey, factionKey, factionStatsCache);

                for (const sourceUnitType of ['Mek', 'Tank', 'AeroSpaceFighter'] as const) {
                    const eligibleModelKeys = getEligibleModelKeysBySourceUnitType(modelWeightsByKey, modelMetadataByKey, sourceUnitType);
                    applyWeightDistributionToModels(
                        modelWeightsByKey,
                        eligibleModelKeys,
                        modelMetadataByKey,
                        getWeightDistributionForUnitType(resolvedStats, sourceUnitType),
                    );
                }

                const { allocations, clearNormalRatings } = buildSalvageAllocations(resolvedStats, modelWeightsByKey);
                for (let ratingIndex = 0; ratingIndex < clearNormalRatings.length; ratingIndex += 1) {
                    if (!clearNormalRatings[ratingIndex]) {
                        continue;
                    }

                    for (const weights of modelWeightsByKey.values()) {
                        weights[ratingIndex] = 0;
                    }
                }

                for (const sourceUnitType of ['Mek', 'AeroSpaceFighter', 'Tank', 'VTOL'] as const) {
                    const eligibleModelKeys = getEligibleModelKeysBySourceUnitType(modelWeightsByKey, modelMetadataByKey, sourceUnitType);
                    applyTechRebalanceToModels(
                        modelWeightsByKey,
                        eligibleModelKeys,
                        modelMetadataByKey,
                        models,
                        factions,
                        factionKey,
                        sourceUnitType,
                        resolvedStats,
                        allocations,
                    );
                }

                normalWeightsByFaction.set(factionKey, modelWeightsByKey);
                salvageAllocationsByFaction.set(factionKey, allocations);
            }

            for (const factionKey of factionKeys) {
                const normalWeightsByKey = normalWeightsByFaction.get(factionKey);
                if (!normalWeightsByKey || normalWeightsByKey.size === 0) {
                    continue;
                }

                const salvageWeightsByKey = new Map<string, CompactWeightedByRating>();
                for (const [sourceFactionKey, sourceAllocations] of salvageAllocationsByFaction.get(factionKey) || new Map<string, CompactWeightedByRating>()) {
                    const sourceWeightsByKey = normalWeightsByFaction.get(sourceFactionKey);
                    if (!sourceWeightsByKey || sourceWeightsByKey.size === 0) {
                        continue;
                    }

                    for (let ratingIndex = 0; ratingIndex < 5; ratingIndex += 1) {
                        const sourceTotalWeight = Array.from(sourceWeightsByKey.values())
                            .reduce((sum, value) => sum + (value[ratingIndex] ?? 0), 0);
                        const allocatedWeight = sourceAllocations[ratingIndex] ?? 0;
                        if (sourceTotalWeight <= 0 || allocatedWeight <= 0) {
                            continue;
                        }

                        for (const [modelKey, sourceWeights] of sourceWeightsByKey.entries()) {
                            const sourceWeight = sourceWeights[ratingIndex] ?? 0;
                            if (sourceWeight <= 0) {
                                continue;
                            }

                            const salvageWeights = salvageWeightsByKey.get(modelKey) ?? createEmptyWeightedByRating();
                            salvageWeights[ratingIndex] += allocatedWeight * sourceWeight / sourceTotalWeight;
                            salvageWeightsByKey.set(modelKey, salvageWeights);
                        }
                    }
                }

                const normalTotals = createEmptyWeightedByRating();
                const normalPositiveCounts = createEmptyWeightedByRating();
                for (const rawWeights of normalWeightsByKey.values()) {
                    for (let index = 0; index < 5; index += 1) {
                        normalTotals[index] += rawWeights[index] ?? 0;
                        if ((rawWeights[index] ?? 0) > 0) {
                            normalPositiveCounts[index] += 1;
                        }
                    }
                }

                const salvageTotals = createEmptyWeightedByRating();
                const salvagePositiveCounts = createEmptyWeightedByRating();
                for (const rawWeights of salvageWeightsByKey.values()) {
                    for (let index = 0; index < 5; index += 1) {
                        salvageTotals[index] += rawWeights[index] ?? 0;
                        if ((rawWeights[index] ?? 0) > 0) {
                            salvagePositiveCounts[index] += 1;
                        }
                    }
                }

                const outputModelKeys = new Set<string>([
                    ...normalWeightsByKey.keys(),
                    ...salvageWeightsByKey.keys(),
                ]);

                for (const modelKey of outputModelKeys) {
                    const weightedChannels = createEmptyWeightedChannels();
                    const normalRawWeights = cloneWeightedByRating(normalWeightsByKey.get(modelKey));
                    const salvageRawWeights = cloneWeightedByRating(salvageWeightsByKey.get(modelKey));

                    for (let index = 0; index < 5; index += 1) {
                        if (normalRawWeights[index] > 0 && normalTotals[index] > 0 && normalPositiveCounts[index] > 0) {
                            weightedChannels.normal[index] = calcWeightedScore(
                                (normalRawWeights[index] * normalPositiveCounts[index]) / normalTotals[index],
                            );
                        }

                        const salvageDenominator = normalTotals[index] > 0 ? normalTotals[index] : salvageTotals[index];
                        if (salvageRawWeights[index] > 0 && salvageDenominator > 0 && salvagePositiveCounts[index] > 0) {
                            weightedChannels.salvage[index] = calcWeightedScore(
                                (salvageRawWeights[index] * salvagePositiveCounts[index]) / salvageDenominator,
                            );
                        }
                    }

                    const normalScore = averagePositiveWeightedScores(weightedChannels.normal);
                    const salvageScore = averagePositiveWeightedScores(weightedChannels.salvage);
                    if (normalScore <= 0 && salvageScore <= 0) {
                        continue;
                    }

                    const modelRecord = weightedAvailability[modelKey];
                    const weightedEraAvailability = modelRecord.e[eraKey] || {};
                    weightedEraAvailability[factionKey] = [normalScore, salvageScore];
                    modelRecord.e[eraKey] = weightedEraAvailability;
                }
            }
        }
    }

    return Object.fromEntries(
        Object.entries(weightedAvailability).filter(([, record]) => Object.keys(record.e).length > 0),
    );
}

function loadForceGeneratorData(
    dirPath: string,
    eras: MegaMekEra[],
    factions: Record<string, UniverseFactionRecord>,
): {
    factionEraData: Record<string, Record<string, EraFactionStats>>;
    chassis: Record<string, CompactChassisRecord>;
    models: Record<string, CompactModelRecord>;
} {
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
                    distributions.map((entry) => [entry.unitType, entry.weights]),
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
                t: unitType as UnitType,
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
                `chassis ${chassisKey} in ${sourceFileName}`,
            );

            for (const rawModelNode of ensureArray(chassisNode.model)) {
                const modelNode = rawModelNode as Record<string, unknown>;
                const modelName = String(modelNode.name || '');
                const modelKey = buildModelRecordKey(unitType, chassisName, modelName);
                const modelRecord = models[modelKey] || {
                    t: unitType as UnitType,
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
                    `model ${modelKey} (chassis ${chassisKey}) in ${sourceFileName}`,
                );
            }
        }
    }

    return {
        factionEraData,
        chassis,
        models,
    };
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
            ([key, renderedValue]) => `${nextIndent}${JSON.stringify(key)}: ${renderedValue}`,
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

function mergeCompactEraAvailabilityForWrite(
    current: Record<string, CompactEraAvailability>,
    incoming: Record<string, CompactEraAvailability>,
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
    incoming: TRecord,
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
    sourceLabel: string,
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
                    `[MegaMek] ${sourceLabel} collision after unit type compilation for ${compiledKey}: ${collidedTypes.join(', ')}`,
                );
            }

            compiledRecords[compiledKey] = mergeCompactAvailabilityRecordForWrite(
                compiledRecords[compiledKey],
                compiledRecord,
            );
        } else {
            compiledRecords[compiledKey] = compiledRecord;
        }

        originalTypes.add(record.t);
        originalTypesByCompiledKey.set(compiledKey, originalTypes);
    }

    return compiledRecords;
}

function compactWeightedRecordsToArrayForWrite(
    records: Record<string, CompactWeightedModelRecord>,
): CompactWeightedModelRecord[] {
    return Object.entries(records)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
        .map(([, record]) => record);
}

function resolveFactionMulIds(
    factions: Record<string, UniverseFactionRecord>,
    factionKey: string,
    skippedFactions: ReadonlySet<string>,
    visited = new Set<string>(),
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

function remapWeightedEraAvailabilityToMulIds(
    eraAvailability: CompactWeightedEraAvailability,
    factions: Record<string, UniverseFactionRecord>,
    skippedFactions: ReadonlySet<string>,
): CompactWeightedEraAvailability {
    const mulizedAvailability: CompactWeightedEraAvailability = {};

    for (const [factionKey, value] of Object.entries(eraAvailability)) {
        const faction = factions[factionKey];
        if (factionKey !== GENERAL_FACTION_KEY && !faction) {
            console.log(`[MegaMek] skipping MUL remap for unknown faction ${factionKey}`);
            continue;
        }

        if (factionKey !== GENERAL_FACTION_KEY && skippedFactions.has(factionKey)) {
            // console.log(`[MegaMek] skipping MUL remap for faction ${factionKey} due to explicit -1 CSV mapping`);
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

function mulizeCompactWeightedRecords(
    records: Record<string, CompactWeightedModelRecord>,
    factions: Record<string, UniverseFactionRecord>,
    skippedFactions: ReadonlySet<string>,
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
                        .filter(([, eraAvailability]) => Object.keys(eraAvailability).length > 0),
                ),
            },
        ]),
    );
}

function run(): void {
    const universeFactionsDir = path.join(UNIVERSE_ROOT, 'factions');
    const universeCommandsDir = path.join(UNIVERSE_ROOT, 'commands');
    const universeErasPath = path.join(UNIVERSE_ROOT, 'eras.xml');

    if (!fs.existsSync(MM_DATA_ROOT)) {
        throw new Error(`MM_DATA_PATH does not exist: ${MM_DATA_ROOT}`);
    }

    const factionMulIdConfig = loadFactionMulIdMap(FACTIONS_MM_TO_MUL_PATH);
    const factions = {
        ...loadUniverseFactions(universeFactionsDir, false, factionMulIdConfig.mappedIds),
        ...loadUniverseFactions(universeCommandsDir, true, factionMulIdConfig.mappedIds),
    };
    const lightFactions = buildLightFactionRecords(factions);
    const eras = loadMegaMekEras(universeErasPath);
    const forceGeneratorData = loadForceGeneratorData(FORCEGEN_ROOT, eras, factions);
    const unitMetadataIndex = loadUnitMetadataIndex(UNIT_FILES_ROOT, NAME_CHANGES_FILE_PATH);
    const compiledChassis = compileCompactAvailabilityRecords(forceGeneratorData.chassis, 'chassis');
    const compiledModels = compileCompactAvailabilityRecords(forceGeneratorData.models, 'models');
    const weightedAvailability = buildWeightedAvailabilityRecords(
        compiledChassis,
        compiledModels,
        factions,
        forceGeneratorData.factionEraData,
        unitMetadataIndex,
    );
    const mulizedWeightedAvailability = mulizeCompactWeightedRecords(
        weightedAvailability,
        factions,
        factionMulIdConfig.skippedFactions,
    );

    writeJsonFile(path.join(OUTPUT_DIR, 'factions-lite.json'), lightFactions);
    writeJsonFile(
        path.join(OUTPUT_DIR, 'availability_weighted.json'),
        compactWeightedRecordsToArrayForWrite(weightedAvailability),
    );
    writeJsonFile(
        path.join(OUTPUT_DIR, 'mulized_availability_weighted.json'),
        compactWeightedRecordsToArrayForWrite(mulizedWeightedAvailability),
    );

    console.log('[MegaMek] Wrote factions-lite.json, availability_weighted.json, and mulized_availability_weighted.json');
}

run();