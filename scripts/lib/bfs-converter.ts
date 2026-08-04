import fs from 'node:fs';
import { parseCsv, requireCsvColumnCount, requireCsvHeader, type CsvRow } from './csv';
import type { MegaMekUnitFileMetadata } from './megamek-unit-file-metadata';

export const GROUND_HEADERS = [
    'BSA Filter', 'Cost', 'Skill', 'MP', 'TMM', 'Range', 'Damage', 'Check', 'Thresh', 'Special',
    'SW', 'CI', 'FCCW', 'Jihad', 'DA', 'IlClan', 'Year', 'Source',
] as const;
export const EMPLACEMENT_HEADERS = [
    'Name', 'Cost', 'Skill', 'MP', 'TMM', 'Range', 'Damage', 'Check', 'Thresh', 'Special',
    'SW', 'CI', 'FCCW', 'Jihad', 'DA', 'IlClan', 'Year', 'Source',
] as const;
export const AEROSPACE_HEADERS = [
    'Name', 'Type', 'Size', 'Skill', 'Check', 'Thrust', 'Damage', 'Range', 'Thresh', 'Fuel', 'Cost',
    'Special', 'Source',
] as const;

export type BfsAssetType = 'Vehicle' | 'Conventional Infantry' | 'Battle Armor' | 'Emplacement';
export type BfsMovementMode = 'TRACKED' | 'WHEELED' | 'HOVER' | 'VTOL' | 'WIGE'
    | 'INF_LEG' | 'INF_JUMP' | 'INF_MOTORIZED' | 'NONE';

export interface ValueProfile {
    standard: number;
    veteran?: number;
}

export interface BfsDocument {
    uuid: string;
    linkedUnitId?: string;
    chassis: string;
    model: string;
    assetType: BfsAssetType;
    cardTitle?: string;
    cardSubtitle?: string;
    year?: number;
    techBase?: MegaMekUnitFileMetadata['techBase'];
    source?: string;
    movement: { mp: number; mode: BfsMovementMode };
    tmm: number;
    range: [number, number, number];
    skill: ValueProfile;
    damage: { perHit: number; hits: number };
    destroyCheck: number;
    threshold: number;
    cost: ValueProfile;
    specials: string[];
    role?: string;
}

export interface GroundCsvRow {
    dataset: 'ground';
    rowNumber: number;
    name: string;
    cost: ValueProfile;
    skill: ValueProfile;
    movement: { mp: number; mode: Exclude<BfsMovementMode, 'NONE' | 'WIGE' | 'INF_MOTORIZED'> };
    tmm: number;
    range: [number, number, number];
    damage: { perHit: number; hits: number };
    destroyCheck: number;
    threshold: number;
    specials: string[];
    year?: number;
    csvSource: string;
}

export interface EmplacementCsvRow extends Omit<GroundCsvRow, 'dataset' | 'movement'> {
    dataset: 'emplacement';
    movement: { mp: 0; mode: 'NONE' };
}

export interface AerospaceCsvRow {
    dataset: 'aerospace';
    rowNumber: number;
    name: string;
    type: string;
    size: number;
    skill: number;
    destroyCheck: number;
    thrust: number;
    damage: { perHit: number; hits: number };
    range: string;
    threshold: number;
    fuel: number;
    cost: ValueProfile;
    specials: string[];
    source: string;
}

function context(filePath: string, rowNumber: number, field: string): string {
    return `${filePath}:${rowNumber} field '${field}'`;
}

export function parseRequiredInteger(raw: string, label: string, minimum = 0): number {
    const value = raw.trim();
    if (!/^\d+$/u.test(value)) {
        throw new Error(`${label} must be an integer; received '${raw}'.`);
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > 2_147_483_647) {
        throw new Error(`${label} is outside the supported range ${minimum}..2147483647.`);
    }
    return parsed;
}

export function parseProfile(raw: string, label: string, dashValue?: number): ValueProfile {
    const value = raw.trim();
    if (value === '-' && dashValue !== undefined) {
        return { standard: dashValue };
    }
    const match = value.match(/^(\d+)(?:\((\d+)\))?$/u);
    if (!match) {
        throw new Error(`${label} must be N or N(V); received '${raw}'.`);
    }
    const standard = parseRequiredInteger(match[1], label);
    const veteran = match[2] === undefined ? undefined : parseRequiredInteger(match[2], label);
    return veteran === undefined ? { standard } : { standard, veteran };
}

export function parseMovement(raw: string, label: string, emplacement = false): GroundCsvRow['movement'] | EmplacementCsvRow['movement'] {
    const value = raw.trim().toUpperCase();
    if (emplacement) {
        if (value !== '0') {
            throw new Error(`${label} must be 0 for an emplacement; received '${raw}'.`);
        }
        return { mp: 0, mode: 'NONE' };
    }
    const match = value.match(/^(\d+)([TWHVJF])$/u);
    if (!match) {
        throw new Error(`${label} must contain MP and a T/W/H/V/J/F suffix; received '${raw}'.`);
    }
    const modes = {
        T: 'TRACKED', W: 'WHEELED', H: 'HOVER', V: 'VTOL', J: 'INF_JUMP', F: 'INF_LEG',
    } as const;
    return { mp: parseRequiredInteger(match[1], label), mode: modes[match[2] as keyof typeof modes] };
}

export function parseRange(raw: string, label: string): [number, number, number] {
    const value = raw.trim();
    if (value === '-' || /^(?:Artillery|Arrow)$/iu.test(value)) {
        return [-1, -1, -1];
    }
    const match = value.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/u);
    if (!match) {
        throw new Error(`${label} must be S/M/L, '-', Artillery, or Arrow; received '${raw}'.`);
    }
    const result = match.slice(1).map((entry) => parseRequiredInteger(entry, label)) as [number, number, number];
    if (!(result[0] <= result[1] && result[1] <= result[2])) {
        throw new Error(`${label} must be ascending; received '${raw}'.`);
    }
    return result;
}

export function parseDamage(raw: string, label: string): { perHit: number; hits: number } {
    const value = raw.trim();
    if (value === '-' || value === '0') {
        return { perHit: 0, hits: 0 };
    }
    const match = value.match(/^(\d+)(?:[xX](\d+))?$/u);
    if (!match) {
        throw new Error(`${label} must be N, NxH, 0, or '-'; received '${raw}'.`);
    }
    const perHit = parseRequiredInteger(match[1], label, 1);
    const hits = match[2] === undefined ? 1 : parseRequiredInteger(match[2], label, 1);
    return { perHit, hits };
}

const SPECIAL_CANONICAL_NAMES = new Map<string, string>([
    ['ai', 'AI'], ['ams', 'AMS'], ['apc', 'APC'], ['arrow', 'Arrow'], ['artillery', 'Artillery'],
    ['commander', 'Commander'], ['critseeker', 'Crit-Seeker'], ['ecm', 'ECM'], ['if', 'IF'],
    ['immobile', 'Immobile'], ['mechanized', 'Mechanized'], ['nimble', 'Nimble'], ['noturret', 'No Turret'],
    ['prb', 'PRB'], ['rfa', 'RFA'], ['spotter', 'Spotter'], ['swarm', 'Swarm'], ['tag', 'TAG'], ['tc', 'TC'],
]);

function canonicalizeSpecial(raw: string): string {
    const trimmed = raw.trim().replace(/^Immobile\*$/iu, 'Immobile');
    const parameterMatch = trimmed.match(/^(.+?)\s*\((.+)\)$/u);
    if (parameterMatch) {
        const key = parameterMatch[1].replace(/[\s.-]/gu, '').toLowerCase();
        const code = SPECIAL_CANONICAL_NAMES.get(key) ?? parameterMatch[1].trim();
        return `${code} (${parameterMatch[2].trim()})`;
    }
    const numericMatch = trimmed.match(/^(.+?)(\d+)$/u);
    if (numericMatch) {
        const key = numericMatch[1].replace(/[\s.-]/gu, '').toLowerCase();
        const code = SPECIAL_CANONICAL_NAMES.get(key) ?? numericMatch[1].trim();
        return `${code}${numericMatch[2]}`;
    }
    const key = trimmed.replace(/[\s.-]/gu, '').toLowerCase();
    return SPECIAL_CANONICAL_NAMES.get(key) ?? trimmed;
}

export function parseSpecials(raw: string): string[] {
    if (raw.trim() === '' || raw.trim() === '-' || raw.trim() === '--') {
        return [];
    }
    const fragments = raw.split(',').map((value) => value.trim());
    const result: string[] = [];
    for (let index = 0; index < fragments.length; index += 1) {
        const fragment = fragments[index];
        if (!fragment || fragment === '-' || fragment === '--') {
            continue;
        }
        if (fragment.startsWith('+')) {
            result.push(fragments.slice(index).join(', ').replace(/\s+/gu, ' ').trim());
            break;
        }
        result.push(canonicalizeSpecial(fragment));
    }
    return result;
}

function optionalYear(raw: string, label: string): number | undefined {
    const value = raw.trim();
    return value === '' || value === '????' ? undefined : parseRequiredInteger(value, label, 1);
}

function readSupportedRows(filePath: string, headers: readonly string[]): CsvRow[] {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    if (rows.length === 0) {
        throw new Error(`${filePath} is empty.`);
    }
    requireCsvHeader(rows[0].cells, headers, filePath);
    return rows.slice(1).filter((row) => row.cells.some((value) => value.trim().length > 0));
}

function parseGroundLikeRow(row: CsvRow, filePath: string, emplacement: boolean): GroundCsvRow | EmplacementCsvRow {
    requireCsvColumnCount(row, GROUND_HEADERS.length, filePath);
    const cell = (index: number): string => row.cells[index] ?? '';
    const name = cell(0).trim();
    if (!name) {
        throw new Error(`${filePath}:${row.rowNumber} has no unit name.`);
    }
    const movement = parseMovement(cell(3), context(filePath, row.rowNumber, 'MP'), emplacement);
    const result = {
        dataset: emplacement ? 'emplacement' : 'ground',
        rowNumber: row.rowNumber,
        name,
        cost: parseProfile(cell(1), context(filePath, row.rowNumber, 'Cost')),
        skill: parseProfile(cell(2), context(filePath, row.rowNumber, 'Skill'), 6),
        movement,
        tmm: parseRequiredInteger(cell(4), context(filePath, row.rowNumber, 'TMM')),
        range: parseRange(cell(5), context(filePath, row.rowNumber, 'Range')),
        damage: parseDamage(cell(6), context(filePath, row.rowNumber, 'Damage')),
        destroyCheck: parseRequiredInteger(cell(7), context(filePath, row.rowNumber, 'Check')),
        threshold: parseRequiredInteger(cell(8), context(filePath, row.rowNumber, 'Thresh')),
        specials: parseSpecials(cell(9)),
        year: optionalYear(cell(16), context(filePath, row.rowNumber, 'Year')),
        csvSource: cell(17).trim(),
    };
    if (emplacement) {
        if (result.tmm !== 0 || !result.specials.includes('Immobile')) {
            throw new Error(`${filePath}:${row.rowNumber} emplacement must have TMM 0 and Immobile.`);
        }
        return result as EmplacementCsvRow;
    }
    return result as GroundCsvRow;
}

export function readGroundCsv(filePath: string): GroundCsvRow[] {
    return readSupportedRows(filePath, GROUND_HEADERS).map((row) => parseGroundLikeRow(row, filePath, false) as GroundCsvRow);
}

export function readEmplacementCsv(filePath: string): EmplacementCsvRow[] {
    return readSupportedRows(filePath, EMPLACEMENT_HEADERS).map((row) => parseGroundLikeRow(row, filePath, true) as EmplacementCsvRow);
}

export function readAerospaceCsv(filePath: string): AerospaceCsvRow[] {
    const rows = readSupportedRows(filePath, AEROSPACE_HEADERS).filter((row) => {
        const cells = row.cells.map((cell) => cell.trim());
        if (cells[0]) {
            return true;
        }
        const isSummaryHeading = cells.slice(0, 3).every((cell) => cell === '')
            && cells[3] === 'IS' && cells[4]?.toLowerCase() === 'clan'
            && cells.slice(5).every((cell) => cell === '');
        const isSummaryValue = cells.slice(0, 2).every((cell) => cell === '')
            && /^(?:L|M|H)\/AF$/u.test(cells[2] ?? '')
            && cells.slice(5).every((cell) => cell === '');
        if (isSummaryHeading || isSummaryValue) {
            return false;
        }
        throw new Error(`${filePath}:${row.rowNumber} has data but no aerospace unit name.`);
    });
    return rows.map((row) => {
        requireCsvColumnCount(row, AEROSPACE_HEADERS.length, filePath);
        const cell = (index: number): string => row.cells[index] ?? '';
        const type = cell(1).trim();
        const range = cell(7).trim();
        const source = cell(12).trim();
        if (!type) {
            throw new Error(`${context(filePath, row.rowNumber, 'Type')} must not be blank.`);
        }
        if (!/^(?:Short|Med|Long|--)$/u.test(range)) {
            throw new Error(`${context(filePath, row.rowNumber, 'Range')} must be Short, Med, Long, or --; received '${cell(7)}'.`);
        }
        if (!source) {
            throw new Error(`${context(filePath, row.rowNumber, 'Source')} must not be blank.`);
        }
        return {
            dataset: 'aerospace',
            rowNumber: row.rowNumber,
            name: cell(0).trim(),
            type,
            size: parseRequiredInteger(cell(2), context(filePath, row.rowNumber, 'Size'), 1),
            skill: parseRequiredInteger(cell(3), context(filePath, row.rowNumber, 'Skill')),
            destroyCheck: parseRequiredInteger(cell(4), context(filePath, row.rowNumber, 'Check')),
            thrust: parseRequiredInteger(cell(5), context(filePath, row.rowNumber, 'Thrust')),
            damage: parseDamage(cell(6), context(filePath, row.rowNumber, 'Damage')),
            range,
            threshold: parseRequiredInteger(cell(8), context(filePath, row.rowNumber, 'Thresh')),
            fuel: parseRequiredInteger(cell(9), context(filePath, row.rowNumber, 'Fuel')),
            cost: parseProfile(cell(10), context(filePath, row.rowNumber, 'Cost')),
            specials: parseSpecials(cell(11)),
            source,
        };
    });
}

export interface LinkedManifestEntry {
    dataset: 'ground';
    csvName: string;
    uuid: string;
    unitFile: string;
    outputFile?: string;
    linkedUnitId: string;
    cardTitle?: string;
    cardSubtitle?: string;
    provenance: 'existing' | 'new';
}

export interface EmplacementManifestEntry {
    dataset: 'emplacement';
    csvName: string;
    uuid: string;
    outputFile: string;
    chassis: string;
    model: string;
    cardTitle?: string;
    cardSubtitle?: string;
    provenance: 'existing' | 'new';
}

export type BfsManifestEntry = LinkedManifestEntry | EmplacementManifestEntry;

export function convertLinkedRow(
    row: GroundCsvRow,
    entry: LinkedManifestEntry,
    base: MegaMekUnitFileMetadata,
): BfsDocument {
    if (!base.uuid || base.uuid !== entry.linkedUnitId) {
        throw new Error(`${entry.csvName} expected linked UUID ${entry.linkedUnitId}, found ${base.uuid ?? 'none'}.`);
    }
    if (!base.bfsAssetType || !base.movementMode) {
        throw new Error(`${entry.csvName} links to unsupported base type or movement.`);
    }
    return {
        uuid: entry.uuid,
        linkedUnitId: entry.linkedUnitId,
        chassis: base.chassis,
        model: base.model,
        assetType: base.bfsAssetType,
        cardTitle: entry.cardTitle,
        cardSubtitle: entry.cardSubtitle,
        year: base.introYear,
        techBase: base.techBase,
        source: base.source,
        movement: { mp: row.movement.mp, mode: base.movementMode as BfsMovementMode },
        tmm: row.tmm,
        range: row.range,
        skill: row.skill,
        damage: row.damage,
        destroyCheck: row.destroyCheck,
        threshold: row.threshold,
        cost: row.cost,
        specials: row.specials,
        role: base.role,
    };
}

export function convertEmplacementRow(row: EmplacementCsvRow, entry: EmplacementManifestEntry): BfsDocument {
    return {
        uuid: entry.uuid,
        chassis: entry.chassis,
        model: entry.model,
        assetType: 'Emplacement',
        cardTitle: entry.cardTitle,
        cardSubtitle: entry.cardSubtitle,
        year: row.year,
        source: row.csvSource,
        movement: row.movement,
        tmm: row.tmm,
        range: row.range,
        skill: row.skill,
        damage: row.damage,
        destroyCheck: row.destroyCheck,
        threshold: row.threshold,
        cost: row.cost,
        specials: row.specials,
    };
}
