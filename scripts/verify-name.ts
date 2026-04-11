import fs from 'node:fs';
import path from 'node:path';

import { readMegaMekUnitFileMetadata } from './lib/megamek-unit-file-metadata.js';

const {
    loadOptionalEnvFile,
    resolveExistingPath,
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

interface SvgExportUnitRecord {
    name: string;
    unitFile: string;
}

interface SvgExportUnitsData {
    version?: string;
    units: SvgExportUnitRecord[];
}

interface ComparisonSample {
    key: string;
    expectedName?: string;
    actualName?: string;
    details?: string;
}

const APP_ROOT = path.resolve(__dirname, '..');
const MM_DATA_ROOT = resolveMmDataRoot(APP_ROOT);
const UNIT_FILES_ROOT = path.join(MM_DATA_ROOT, 'data', 'mekfiles');
const SVGEXPORT_UNITS_PATH = resolveExistingPath(APP_ROOT, 'svgexport/units.json', [
    '../../svgexport/units.json',
    '../svgexport/units.json',
]);

loadOptionalEnvFile(APP_ROOT, { logPrefix: 'MegaMek' });

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function normalizeUnitsData(data: SvgExportUnitsData | SvgExportUnitRecord[]): SvgExportUnitRecord[] {
    return Array.isArray(data) ? data : data.units;
}

function takeSamples<T>(items: readonly T[], limit = 10): T[] {
    return items.slice(0, Math.min(limit, items.length));
}

function formatPercent(numerator: number, denominator: number): string {
    if (denominator === 0) {
        return '100.00';
    }

    return ((numerator / denominator) * 100).toFixed(2);
}

function printSamples(label: string, samples: readonly ComparisonSample[]): void {
    if (samples.length === 0) {
        return;
    }

    console.error(`[MegaMek] ${label}:`);
    for (const sample of samples) {
        const parts = [`key=${sample.key}`];
        if (sample.expectedName !== undefined) {
            parts.push(`expected=${sample.expectedName}`);
        }
        if (sample.actualName !== undefined) {
            parts.push(`actual=${sample.actualName}`);
        }
        if (sample.details !== undefined) {
            parts.push(`details=${sample.details}`);
        }
        console.error(`  - ${parts.join(' | ')}`);
    }
}

function resolveUnitFilePath(unitFile: string): string {
    return path.resolve(UNIT_FILES_ROOT, ...unitFile.split(/[\\/]/u).filter(Boolean));
}

function main(): void {
    const svgExportUnits = normalizeUnitsData(readJson<SvgExportUnitsData | SvgExportUnitRecord[]>(SVGEXPORT_UNITS_PATH));

    let matchCount = 0;
    let parsedUnitFileCount = 0;
    const missingUnitFiles: ComparisonSample[] = [];
    const unparseableUnitFiles: ComparisonSample[] = [];
    const mismatches: ComparisonSample[] = [];

    for (const unit of svgExportUnits) {
        const unitFile = unit.unitFile?.trim();
        if (!unitFile) {
            missingUnitFiles.push({
                key: '(missing unitFile)',
                expectedName: unit.name,
            });
            continue;
        }

        const unitFilePath = resolveUnitFilePath(unitFile);
        if (!fs.existsSync(unitFilePath)) {
            missingUnitFiles.push({
                key: unitFile,
                expectedName: unit.name,
                details: unitFilePath,
            });
            continue;
        }

        try {
            const metadata = readMegaMekUnitFileMetadata(unitFilePath, UNIT_FILES_ROOT);
            if (!metadata) {
                unparseableUnitFiles.push({
                    key: unitFile,
                    expectedName: unit.name,
                    details: 'Could not derive unit metadata from file contents.',
                });
                continue;
            }

            parsedUnitFileCount += 1;

            if (metadata.unitName !== unit.name) {
                mismatches.push({
                    key: unitFile,
                    expectedName: unit.name,
                    actualName: metadata.unitName,
                });
                continue;
            }

            matchCount += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            unparseableUnitFiles.push({
                key: unitFile,
                expectedName: unit.name,
                details: message,
            });
        }
    }

    console.log(`[MegaMek] svgexport units loaded: ${svgExportUnits.length}`);
    console.log(`[MegaMek] unit files root: ${UNIT_FILES_ROOT}`);
    console.log(`[MegaMek] unit files parsed: ${parsedUnitFileCount}/${svgExportUnits.length} (${formatPercent(parsedUnitFileCount, svgExportUnits.length)}%)`);
    console.log(`[MegaMek] exact name matches: ${matchCount}/${svgExportUnits.length} (${formatPercent(matchCount, svgExportUnits.length)}%)`);
    console.log(`[MegaMek] missing unit files: ${missingUnitFiles.length}/${svgExportUnits.length} (${formatPercent(missingUnitFiles.length, svgExportUnits.length)}%)`);
    console.log(`[MegaMek] unparseable unit files: ${unparseableUnitFiles.length}/${svgExportUnits.length} (${formatPercent(unparseableUnitFiles.length, svgExportUnits.length)}%)`);
    console.log(`[MegaMek] name mismatches: ${mismatches.length}/${svgExportUnits.length} (${formatPercent(mismatches.length, svgExportUnits.length)}%)`);

    const failed = missingUnitFiles.length > 0
        || unparseableUnitFiles.length > 0
        || mismatches.length > 0
        || matchCount !== svgExportUnits.length;

    if (!failed) {
        console.log('[MegaMek] Unit-file name verification passed with 100.00% exact matches and 100.00% coverage.');
        return;
    }

    printSamples('Missing unit files', takeSamples(missingUnitFiles));
    printSamples('Unparseable unit files', takeSamples(unparseableUnitFiles));
    printSamples('Name mismatches', takeSamples(mismatches));
    process.exitCode = 1;
}

main();