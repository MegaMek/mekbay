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
    type?: string;
    subtype?: string;
    omni?: number | string | boolean | null;
    as?: {
        TP?: string | null;
    };
    unitFile?: string;
}

interface SvgExportUnitsData {
    version?: string;
    units: SvgExportUnitRecord[];
}

interface CollisionSummary {
    key: string;
    units: SvgExportUnitRecord[];
    subtypeValues: Map<string, number>;
    omniValues: Map<string, number>;
    asTpValues: Map<string, number>;
    collisionFields: string[];
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

function normalizeKeyPart(value: unknown, missingLabel: string): string {
    if (value === null || value === undefined) {
        return missingLabel;
    }

    const text = String(value).trim();
    return text || missingLabel;
}

function formatValue(value: unknown): string {
    if (value === undefined) {
        return '(missing)';
    }
    if (value === null) {
        return '(null)';
    }

    const text = String(value).trim();
    return text || '(blank)';
}

function unitLabel(unit: SvgExportUnitRecord): string {
    const name = unit.name ?? [unit.chassis, unit.model].filter(Boolean).join(' ').trim();
    const id = unit.id === undefined ? '' : `id=${unit.id}`;
    const unitFile = unit.unitFile ? ` (${unit.unitFile})` : '';
    return `${name || id || '(unnamed unit)'}${unitFile}`;
}

function addCount(counts: Map<string, number>, value: string): void {
    counts.set(value, (counts.get(value) ?? 0) + 1);
}

function countValues<T>(items: readonly T[], getValue: (item: T) => unknown): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
        addCount(counts, formatValue(getValue(item)));
    }
    return counts;
}

function formatValueCounts(counts: ReadonlyMap<string, number>): string {
    return Array.from(counts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([value, count]) => `${value} (${count})`)
        .join(', ');
}

function summarizeCollision(key: string, units: SvgExportUnitRecord[]): CollisionSummary {
    const subtypeValues = countValues(units, (unit) => unit.subtype);
    const omniValues = countValues(units, (unit) => unit.omni);
    const asTpValues = countValues(units, (unit) => unit.as?.TP);
    const collisionFields: string[] = [];

    if (subtypeValues.size > 1) {
        collisionFields.push('subtype');
    }
    if (omniValues.size > 1) {
        collisionFields.push('omni');
    }
    if (asTpValues.size > 1) {
        collisionFields.push('as.TP');
    }

    return {
        key,
        units,
        subtypeValues,
        omniValues,
        asTpValues,
        collisionFields,
    };
}

function printCollision(collision: CollisionSummary): void {
    console.error(`[ChassisTypeCollisions] ${collision.key}`);
    console.error(`  units: ${collision.units.length}`);
    console.error(`  collision fields: ${collision.collisionFields.join(', ')}`);
    console.error(`  subtype values: ${formatValueCounts(collision.subtypeValues)}`);
    console.error(`  omni values: ${formatValueCounts(collision.omniValues)}`);
    console.error(`  as.TP values: ${formatValueCounts(collision.asTpValues)}`);
    console.error('  entries:');
    for (const unit of collision.units) {
        console.error(`    - ${unitLabel(unit)} | subtype=${formatValue(unit.subtype)} | omni=${formatValue(unit.omni)} | as.TP=${formatValue(unit.as?.TP)}`);
    }
}

function main(): void {
    const units = normalizeUnitsData(readJson<SvgExportUnitsData | SvgExportUnitRecord[]>(SVGEXPORT_UNITS_PATH));
    const unitsByChassisType = new Map<string, SvgExportUnitRecord[]>();
    const chassisCounts = new Map<string, number>();
    let unitsMissingChassis = 0;
    let unitsMissingType = 0;

    for (const unit of units) {
        const chassis = normalizeKeyPart(unit.chassis, '(missing chassis)');
        const type = normalizeKeyPart(unit.type, '(missing type)');
        const omni = unit.omni ? '1' : '0';
        if (chassis === '(missing chassis)') {
            unitsMissingChassis += 1;
        }
        if (type === '(missing type)') {
            unitsMissingType += 1;
        }

        addCount(chassisCounts, chassis);

        const key = `${chassis}|${type}|omni=${omni}`;
        const group = unitsByChassisType.get(key);
        if (group) {
            group.push(unit);
        } else {
            unitsByChassisType.set(key, [unit]);
        }
    }

    const duplicateChassisCount = Array.from(chassisCounts.values()).filter((count) => count > 1).length;
    const duplicateChassisTypeGroups = Array.from(unitsByChassisType.entries())
        .filter(([, group]) => group.length > 1);
    const collisions = duplicateChassisTypeGroups
        .map(([key, group]) => summarizeCollision(key, group))
        .filter((collision) => collision.collisionFields.length > 0)
        .sort((left, right) => left.key.localeCompare(right.key));
    const collisionUnitCount = collisions.reduce((total, collision) => total + collision.units.length, 0);
    const subtypeCollisionCount = collisions.filter((collision) => collision.subtypeValues.size > 1).length;
    const omniCollisionCount = collisions.filter((collision) => collision.omniValues.size > 1).length;
    const asTpCollisionCount = collisions.filter((collision) => collision.asTpValues.size > 1).length;

    console.log(`[ChassisTypeCollisions] svgexport units loaded: ${units.length}`);
    console.log(`[ChassisTypeCollisions] unique chassis values: ${chassisCounts.size}`);
    console.log(`[ChassisTypeCollisions] duplicate chassis values: ${duplicateChassisCount}`);
    console.log(`[ChassisTypeCollisions] chassis|type groups: ${unitsByChassisType.size}`);
    console.log(`[ChassisTypeCollisions] duplicate chassis|type groups checked: ${duplicateChassisTypeGroups.length}`);
    console.log(`[ChassisTypeCollisions] units missing chassis: ${unitsMissingChassis}`);
    console.log(`[ChassisTypeCollisions] units missing type: ${unitsMissingType}`);
    console.log(`[ChassisTypeCollisions] collision groups: ${collisions.length}`);
    console.log(`[ChassisTypeCollisions] units in collision groups: ${collisionUnitCount}`);
    console.log(`[ChassisTypeCollisions] groups with subtype collisions: ${subtypeCollisionCount}`);
    console.log(`[ChassisTypeCollisions] groups with omni collisions: ${omniCollisionCount}`);
    console.log(`[ChassisTypeCollisions] groups with as.TP collisions: ${asTpCollisionCount}`);

    if (collisions.length === 0) {
        console.log('[ChassisTypeCollisions] No chassis|type collisions found.');
        return;
    }

    for (const collision of collisions) {
        printCollision(collision);
    }

    process.exitCode = 1;
}

main();