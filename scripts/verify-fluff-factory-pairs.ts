import fs from 'node:fs';
import path from 'node:path';

const {
    resolveExistingPath,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

interface SvgExportUnitRecord {
    id?: number;
    name?: string;
    chassis?: string;
    model?: string;
    unitFile?: string;
    fluff?: {
        manufacturer?: string;
        primaryFactory?: string;
    };
    manufacturer?: string;
    primaryFactory?: string;
}

interface SvgExportUnitsData {
    version?: string;
    units: SvgExportUnitRecord[];
}

interface CountMismatch {
    unit: string;
    manufacturerCount: number;
    primaryFactoryCount: number;
    manufacturers: string[];
    primaryFactories: string[];
}

const APP_ROOT = path.resolve(__dirname, '..');
const SVGEXPORT_UNITS_PATH = resolveExistingPath(APP_ROOT, 'svgexport/units.json', [
    '../../svgexport/units.json',
    '../svgexport/units.json',
]);

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function normalizeUnitsData(data: SvgExportUnitsData | SvgExportUnitRecord[]): SvgExportUnitRecord[] {
    return Array.isArray(data) ? data : data.units;
}

function splitEntries(value: string | undefined): string[] {
    if (!value?.trim()) return [];

    return value
        .split('|')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function unitLabel(unit: SvgExportUnitRecord): string {
    const name = unit.name ?? [unit.chassis, unit.model].filter(Boolean).join(' ').trim();
    const unitFile = unit.unitFile ? ` (${unit.unitFile})` : '';
    return `${name || `id=${unit.id ?? 'unknown'}`}${unitFile}`;
}

function takeSamples<T>(items: readonly T[], limit = 50): T[] {
    return items.slice(0, Math.min(limit, items.length));
}

function printMismatchSamples(label: string, mismatches: readonly CountMismatch[]): void {
    if (mismatches.length === 0) return;

    const samples = takeSamples(mismatches);
    console.error(`[FluffFactoryPairs] ${label}:`);
    for (const mismatch of samples) {
        console.error(`  - ${mismatch.unit}`);
        console.error(`    manufacturers (${mismatch.manufacturerCount}): ${mismatch.manufacturers.join(' | ') || '(none)'}`);
        console.error(`    primary factories (${mismatch.primaryFactoryCount}): ${mismatch.primaryFactories.join(' | ') || '(none)'}`);
    }
    if (samples.length < mismatches.length) {
        console.error(`[FluffFactoryPairs] Showing ${samples.length} of ${mismatches.length} mismatches.`);
    }
}

function main(): void {
    const units = normalizeUnitsData(readJson<SvgExportUnitsData | SvgExportUnitRecord[]>(SVGEXPORT_UNITS_PATH));
    const mismatches: CountMismatch[] = [];
    let unitsWithNeitherField = 0;
    let unitsWithComparedFields = 0;

    for (const unit of units) {
        const manufacturerText = unit.fluff?.manufacturer ?? unit.manufacturer;
        const primaryFactoryText = unit.fluff?.primaryFactory ?? unit.primaryFactory;
        const manufacturers = splitEntries(manufacturerText);
        const primaryFactories = splitEntries(primaryFactoryText);

        if (manufacturers.length === 0 && primaryFactories.length === 0) {
            unitsWithNeitherField += 1;
            continue;
        }

        unitsWithComparedFields += 1;

        if (manufacturers.length !== primaryFactories.length) {
            mismatches.push({
                unit: unitLabel(unit),
                manufacturerCount: manufacturers.length,
                primaryFactoryCount: primaryFactories.length,
                manufacturers,
                primaryFactories,
            });
        }
    }

    const matchingUnits = unitsWithComparedFields - mismatches.length;

    console.log(`[FluffFactoryPairs] svgexport units loaded: ${units.length}`);
    console.log(`[FluffFactoryPairs] units with neither field: ${unitsWithNeitherField}`);
    console.log(`[FluffFactoryPairs] units compared: ${unitsWithComparedFields}`);
    console.log(`[FluffFactoryPairs] units with matching counts: ${matchingUnits}`);
    console.log(`[FluffFactoryPairs] units with mismatched counts: ${mismatches.length}`);

    if (mismatches.length === 0) {
        console.log('[FluffFactoryPairs] Manufacturer/primary factory count verification passed.');
        return;
    }

    printMismatchSamples('Mismatched manufacturer/primary factory counts', mismatches);
    process.exitCode = 1;
}

main();
