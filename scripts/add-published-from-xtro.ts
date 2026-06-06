import fs from 'node:fs';
import path from 'node:path';

import { readMegaMekUnitFileMetadata, splitMegaMekSourceList, type MegaMekUnitFileMetadata } from './lib/megamek-unit-file-metadata.js';

const {
    loadOptionalEnvFile,
    resolveExistingPath,
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

interface XtroCsvEntry {
    rowNumber: number;
    chassis: string;
    model: string;
    rawSource: string;
    sources: string[];
}

interface XtroUpdate {
    filePath: string;
    unitName: string;
    sourceEntries: string[];
    publishedEntries: string[];
    validatedSources: string[];
    addedSourceEntries: string[];
    nextSourceEntries: string[];
    addedPublishedSources: string[];
    nextPublishedEntries: string[];
    matches: XtroCsvEntry[];
}

const APP_ROOT = path.resolve(__dirname, '..');
loadOptionalEnvFile(APP_ROOT, { logPrefix: 'MegaMek' });

const DRY_RUN = process.argv.includes('--dry-run');
const SUMMARY_ONLY = process.argv.includes('--summary-only');
const MM_DATA_ROOT = resolveMmDataRoot(APP_ROOT);
const UNIT_FILES_ROOT = path.join(MM_DATA_ROOT, 'data', 'mekfiles');
const XTRO_CSV_PATH = resolveExistingPath(APP_ROOT, 'xtro.csv', [
    'scripts/xtro.csv',
    'xtro.csv',
]);

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

function uniqueSources(sources: string[]): string[] {
    const seenSources = new Set<string>();
    const result: string[] = [];

    for (const source of sources) {
        if (seenSources.has(source)) {
            continue;
        }

        seenSources.add(source);
        result.push(source);
    }

    return result;
}

function formatSourceList(sources: string[]): string {
    return uniqueSources(sources).join(',');
}

function formatList(values: string[]): string {
    return values.length > 0 ? values.join(', ') : '(none)';
}

function formatPercent(numerator: number, denominator: number): string {
    if (denominator === 0) {
        return '100.00';
    }

    return ((numerator / denominator) * 100).toFixed(2);
}

function relativeUnitPath(filePath: string): string {
    return path.relative(UNIT_FILES_ROOT, filePath).replace(/\\/gu, '/');
}

function detectLineEnding(raw: string): string {
    return raw.includes('\r\n') ? '\r\n' : '\n';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildBlkSourceBlock(tagName: string, sources: string[], lineEnding: string): string {
    return `<${tagName}>${lineEnding}${formatSourceList(sources)}${lineEnding}</${tagName}>`;
}

function insertAfterBlkClosingTag(raw: string, tagName: string, insertion: string, lineEnding: string): string | undefined {
    const closingTagPattern = new RegExp(`</${escapeRegExp(tagName)}>`, 'iu');
    const closingTagMatch = closingTagPattern.exec(raw);
    if (!closingTagMatch) {
        return undefined;
    }

    const insertionIndex = closingTagMatch.index + closingTagMatch[0].length;
    return `${raw.slice(0, insertionIndex)}${lineEnding}${lineEnding}${insertion}${raw.slice(insertionIndex)}`;
}

function updateBlkPublished(raw: string, publishedSources: string[]): string {
    const lineEnding = detectLineEnding(raw);
    const publishedBlock = buildBlkSourceBlock('published', publishedSources, lineEnding);
    const publishedBlockPattern = /<published>[\s\S]*?<\/published>/iu;

    if (publishedBlockPattern.test(raw)) {
        return raw.replace(publishedBlockPattern, publishedBlock);
    }

    return insertAfterBlkClosingTag(raw, 'source', publishedBlock, lineEnding)
        ?? insertAfterBlkClosingTag(raw, 'mul id:', publishedBlock, lineEnding)
        ?? `${raw}${raw.endsWith(lineEnding) ? '' : lineEnding}${lineEnding}${publishedBlock}${lineEnding}`;
}

function updateBlkSources(raw: string, sources: string[]): string {
    const lineEnding = detectLineEnding(raw);
    const sourceBlock = buildBlkSourceBlock('source', sources, lineEnding);
    const sourceBlockPattern = /<source>[\s\S]*?<\/source>/iu;

    if (sourceBlockPattern.test(raw)) {
        return raw.replace(sourceBlockPattern, sourceBlock);
    }

    if (sources.length === 0) {
        return raw;
    }

    return insertAfterBlkClosingTag(raw, 'mul id:', sourceBlock, lineEnding)
        ?? `${raw}${raw.endsWith(lineEnding) ? '' : lineEnding}${lineEnding}${sourceBlock}${lineEnding}`;
}

function insertAfterMtfField(raw: string, fieldName: string, insertionLine: string, lineEnding: string): string | undefined {
    const fieldPattern = new RegExp(`^${escapeRegExp(fieldName)}:[^\r\n]*(?:\r?\n|$)`, 'imu');
    const fieldMatch = fieldPattern.exec(raw);
    if (!fieldMatch) {
        return undefined;
    }

    const insertionIndex = fieldMatch.index + fieldMatch[0].length;
    const separator = fieldMatch[0].endsWith('\n') ? '' : lineEnding;
    return `${raw.slice(0, insertionIndex)}${separator}${insertionLine}${lineEnding}${raw.slice(insertionIndex)}`;
}

function updateMtfPublished(raw: string, publishedSources: string[]): string {
    const lineEnding = detectLineEnding(raw);
    const publishedLine = `published:${formatSourceList(publishedSources)}`;
    const publishedLinePattern = /^published:[^\r\n]*/imu;

    if (publishedLinePattern.test(raw)) {
        return raw.replace(publishedLinePattern, publishedLine);
    }

    return insertAfterMtfField(raw, 'source', publishedLine, lineEnding)
        ?? insertAfterMtfField(raw, 'era', publishedLine, lineEnding)
        ?? insertAfterMtfField(raw, 'mul id', publishedLine, lineEnding)
        ?? `${raw}${raw.endsWith(lineEnding) ? '' : lineEnding}${publishedLine}${lineEnding}`;
}

function updateMtfSources(raw: string, sources: string[]): string {
    const lineEnding = detectLineEnding(raw);
    const sourceLine = `source:${formatSourceList(sources)}`;
    const sourceLinePattern = /^source:[^\r\n]*/imu;

    if (sourceLinePattern.test(raw)) {
        return raw.replace(sourceLinePattern, sourceLine);
    }

    if (sources.length === 0) {
        return raw;
    }

    return insertAfterMtfField(raw, 'era', sourceLine, lineEnding)
        ?? insertAfterMtfField(raw, 'mul id', sourceLine, lineEnding)
        ?? `${raw}${raw.endsWith(lineEnding) ? '' : lineEnding}${sourceLine}${lineEnding}`;
}

function updateUnitFileSourcesAndPublished(
    raw: string,
    filePath: string,
    sourceEntries: string[],
    publishedEntries: string[],
): string {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.blk') {
        return updateBlkPublished(updateBlkSources(raw, sourceEntries), publishedEntries);
    }

    return updateMtfPublished(updateMtfSources(raw, sourceEntries), publishedEntries);
}

function normalizeLookupValue(value: string): string {
    return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function buildUnitLookupKey(chassis: string, model: string): string {
    return `${normalizeLookupValue(chassis)}\u0000${normalizeLookupValue(model)}`;
}

function parseSemicolonCsvLine(line: string, rowNumber: number): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotedField = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];

        if (character === '"') {
            if (inQuotedField && line[index + 1] === '"') {
                currentField += '"';
                index += 1;
                continue;
            }

            inQuotedField = !inQuotedField;
            continue;
        }

        if (character === ';' && !inQuotedField) {
            fields.push(currentField.trim());
            currentField = '';
            continue;
        }

        currentField += character;
    }

    if (inQuotedField) {
        throw new Error(`Unterminated quoted field in ${XTRO_CSV_PATH} row ${rowNumber}.`);
    }

    fields.push(currentField.trim());
    return fields;
}

function loadXtroCsv(filePath: string): XtroCsvEntry[] {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
    const headerLineIndex = lines.findIndex((line) => line.trim().length > 0);
    if (headerLineIndex === -1) {
        throw new Error(`Expected ${filePath} to contain a header row.`);
    }

    const headers = parseSemicolonCsvLine(lines[headerLineIndex], headerLineIndex + 1)
        .map((header) => header.replace(/^\uFEFF/u, '').trim().toLowerCase());
    const chassisIndex = headers.indexOf('chassis');
    const modelIndex = headers.indexOf('model');
    const sourceIndex = headers.indexOf('source');

    if (chassisIndex === -1 || modelIndex === -1 || sourceIndex === -1) {
        throw new Error(`Expected ${filePath} header to include chassis, model, and source columns.`);
    }

    const entries: XtroCsvEntry[] = [];
    for (let lineIndex = headerLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
        const rawLine = lines[lineIndex];
        if (!rawLine.trim()) {
            continue;
        }

        const rowNumber = lineIndex + 1;
        const fields = parseSemicolonCsvLine(rawLine, rowNumber);
        const chassis = fields[chassisIndex]?.trim() ?? '';
        const model = fields[modelIndex]?.trim() ?? '';
        const rawSource = fields[sourceIndex]?.trim() ?? '';
        const sources = splitMegaMekSourceList(rawSource);

        if (!chassis || sources.length === 0) {
            throw new Error(`Expected ${filePath} row ${rowNumber} to include chassis and source values.`);
        }

        entries.push({
            rowNumber,
            chassis,
            model,
            rawSource,
            sources,
        });
    }

    return entries;
}

function buildXtroIndex(entries: XtroCsvEntry[]): Map<string, XtroCsvEntry[]> {
    const index = new Map<string, XtroCsvEntry[]>();

    for (const entry of entries) {
        const lookupKey = buildUnitLookupKey(entry.chassis, entry.model);
        const indexedEntries = index.get(lookupKey) ?? [];
        indexedEntries.push(entry);
        index.set(lookupKey, indexedEntries);
    }

    return index;
}

function findXtroMatches(index: Map<string, XtroCsvEntry[]>, metadata: MegaMekUnitFileMetadata): XtroCsvEntry[] {
    return index.get(buildUnitLookupKey(metadata.chassis, metadata.model)) ?? [];
}

function formatMatches(matches: XtroCsvEntry[]): string {
    if (matches.length === 0) {
        return '(none)';
    }

    return matches
        .map((match) => `row=${match.rowNumber} csv=[${match.chassis};${match.model};${match.rawSource}]`)
        .join('; ');
}

function printUpdate(update: XtroUpdate): void {
    const filePath = relativeUnitPath(update.filePath);

    console.log(`validated=[${formatList(update.validatedSources)}] addSource=[${formatList(update.addedSourceEntries)}] addPublished=[${formatList(update.addedPublishedSources)}] source=[${formatList(update.sourceEntries)} -> ${formatList(update.nextSourceEntries)}] published=[${formatList(update.publishedEntries)} -> ${formatList(update.nextPublishedEntries)}] matches="${formatMatches(update.matches)}" unit="${update.unitName}" file="${filePath}"`);
}

function main(): void {
    const xtroEntries = loadXtroCsv(XTRO_CSV_PATH);
    const xtroIndex = buildXtroIndex(xtroEntries);
    const matchedXtroRows = new Set<number>();
    const unitFiles = listFilesRecursive(UNIT_FILES_ROOT, ['.blk', '.mtf']);
    const updates: XtroUpdate[] = [];
    let parsedUnitFiles = 0;
    let matchedUnitFiles = 0;
    let validatedSourceReferences = 0;
    let addedSourceReferences = 0;
    let addedPublishedReferences = 0;

    for (const filePath of unitFiles) {
        const metadata = readMegaMekUnitFileMetadata(filePath, UNIT_FILES_ROOT);
        if (!metadata) {
            continue;
        }

        parsedUnitFiles += 1;

        const matches = findXtroMatches(xtroIndex, metadata);
        if (matches.length === 0) {
            continue;
        }

        matchedUnitFiles += 1;

        for (const match of matches) {
            matchedXtroRows.add(match.rowNumber);
        }

        const validatedSources = uniqueSources(matches.flatMap((match) => match.sources));
        const existingSourceEntries = new Set(metadata.sources);
        const addedSourceEntries = validatedSources.filter((source) => !source.startsWith('RS') && !existingSourceEntries.has(source));
        const nextSourceEntries = uniqueSources([...metadata.sources, ...addedSourceEntries]);
        const existingPublishedSources = new Set(metadata.publishedRSSources);
        const addedPublishedSources = validatedSources.filter((source) => !existingPublishedSources.has(source));
        const nextPublishedEntries = uniqueSources([...metadata.publishedRSSources, ...addedPublishedSources]);

        validatedSourceReferences += validatedSources.length;
        addedSourceReferences += addedSourceEntries.length;
        addedPublishedReferences += addedPublishedSources.length;
        updates.push({
            filePath,
            unitName: `${metadata.chassis} ${metadata.model}`.trim(),
            sourceEntries: metadata.sources,
            publishedEntries: metadata.publishedRSSources,
            validatedSources,
            addedSourceEntries,
            nextSourceEntries,
            addedPublishedSources,
            nextPublishedEntries,
            matches,
        });
    }

    let changedFiles = 0;
    for (const update of updates) {
        const raw = fs.readFileSync(update.filePath, 'utf8');
        const updated = updateUnitFileSourcesAndPublished(raw, update.filePath, update.nextSourceEntries, update.nextPublishedEntries);
        if (updated === raw) {
            continue;
        }

        if (!DRY_RUN) {
            fs.writeFileSync(update.filePath, updated, 'utf8');
        }

        changedFiles += 1;
    }

    console.log(`unit files root: ${UNIT_FILES_ROOT}`);
    console.log(`xtro.csv: ${XTRO_CSV_PATH}`);
    console.log(`mode: ${DRY_RUN ? 'dry-run' : 'write'}`);
    console.log(`xtro rows loaded: ${xtroEntries.length}`);
    console.log(`xtro lookup keys: ${xtroIndex.size}`);
    console.log(`unit files found: ${unitFiles.length}`);
    console.log(`unit files parsed: ${parsedUnitFiles}/${unitFiles.length} (${formatPercent(parsedUnitFiles, unitFiles.length)}%)`);
    console.log(`unit files matched in xtro.csv: ${matchedUnitFiles}/${parsedUnitFiles} (${formatPercent(matchedUnitFiles, parsedUnitFiles)}%)`);
    console.log(`xtro rows matched: ${matchedXtroRows.size}/${xtroEntries.length} (${formatPercent(matchedXtroRows.size, xtroEntries.length)}%)`);
    console.log(`unit files ${DRY_RUN ? 'to update' : 'updated'}: ${changedFiles}`);
    console.log(`source references validated: ${validatedSourceReferences}`);
    console.log(`source references ${DRY_RUN ? 'to add' : 'added'}: ${addedSourceReferences}`);
    console.log(`published references ${DRY_RUN ? 'to add' : 'added'}: ${addedPublishedReferences}`);

    if (SUMMARY_ONLY) {
        return;
    }

    for (const update of updates) {
        printUpdate(update);
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}