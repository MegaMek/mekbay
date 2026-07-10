import fs from 'node:fs';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

const {
    resolveMmDataRoot,
} = require('./lib/script-paths.js') as typeof import('./lib/script-paths.js');

interface Point {
    x: number;
    y: number;
}

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface ParsedPip {
    center: Point;
    radius: number;
}

interface PipLayout {
    width: number;
    height: number;
    radius: number;
    points: Array<readonly [number, number]>;
}

type ArmorLayouts = Record<string, Record<number, PipLayout>>;
type StructureLayouts = Record<number, Record<string, PipLayout>>;

type PathToken =
    | { kind: 'command'; value: string }
    | { kind: 'number'; value: number };

const APP_ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(APP_ROOT, 'src', 'app', 'data', 'biped-pip-layouts.generated.ts');
const OUTPUT_DECIMAL_PLACES = 4;
const ARMOR_LOCATION_ORDER = ['HD', 'CT', 'CT_R', 'LT', 'LT_R', 'RT', 'RT_R', 'LA', 'RA', 'LL', 'RL'];
const STRUCTURE_LOCATION_ORDER = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'];
const ARMOR_FILE_PATTERN = /^Armor_(Head|CT|LT|RT|LArm|RArm|LLeg|RLeg)(?:_(R))?_(\d+)_Humanoid\.svg$/u;
const STRUCTURE_FILE_PATTERN = /^BipedIS(\d+)_(HD|CT|LT|RT|LA|RA|LL|RL)\.svg$/u;
const PATH_TOKEN_PATTERN = /([a-zA-Z])|([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/gu;

const armorLocationNames: Record<string, string> = {
    Head: 'HD',
    CT: 'CT',
    LT: 'LT',
    RT: 'RT',
    LArm: 'LA',
    RArm: 'RA',
    LLeg: 'LL',
    RLeg: 'RL',
};

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
});

function getOption(name: string): string | undefined {
    const optionIndex = process.argv.indexOf(name);
    if (optionIndex === -1) {
        return undefined;
    }

    const value = process.argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Expected a value after ${name}`);
    }

    return value;
}

function round(value: number): number {
    const rounded = Number(value.toFixed(OUTPUT_DECIMAL_PLACES));
    return Object.is(rounded, -0) ? 0 : rounded;
}

function tokenizePath(pathData: string): PathToken[] {
    return [...pathData.matchAll(PATH_TOKEN_PATTERN)].map(match => match[1]
        ? { kind: 'command', value: match[1] }
        : { kind: 'number', value: Number(match[2]) });
}

function parsePathBounds(pathData: string): Bounds {
    const tokens = tokenizePath(pathData);
    const bounds: Bounds = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    };
    let tokenIndex = 0;
    let command = '';
    let current: Point = { x: 0, y: 0 };
    let subpathStart: Point = { x: 0, y: 0 };

    const addPoint = (point: Point): void => {
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
    };

    const readNumber = (): number => {
        const token = tokens[tokenIndex];
        if (!token || token.kind !== 'number') {
            throw new Error(`Invalid SVG path near token ${tokenIndex}`);
        }

        tokenIndex += 1;
        return token.value;
    };

    const relativePoint = (x: number, y: number, relative: boolean): Point => relative
        ? { x: current.x + x, y: current.y + y }
        : { x, y };

    while (tokenIndex < tokens.length) {
        const nextToken = tokens[tokenIndex];
        if (nextToken.kind === 'command') {
            command = nextToken.value;
            tokenIndex += 1;
            if (command.toUpperCase() === 'Z') {
                current = subpathStart;
                addPoint(current);
                command = '';
                continue;
            }
        }

        if (!command) {
            throw new Error(`SVG path has coordinates without a command near token ${tokenIndex}`);
        }

        const commandName = command.toUpperCase();
        const relative = command === command.toLowerCase();

        switch (commandName) {
            case 'M': {
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                subpathStart = point;
                addPoint(point);
                command = relative ? 'l' : 'L';
                break;
            }
            case 'L': {
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                addPoint(point);
                break;
            }
            case 'H': {
                const point = { x: relative ? current.x + readNumber() : readNumber(), y: current.y };
                current = point;
                addPoint(point);
                break;
            }
            case 'V': {
                const point = { x: current.x, y: relative ? current.y + readNumber() : readNumber() };
                current = point;
                addPoint(point);
                break;
            }
            case 'C': {
                const controlOne = relativePoint(readNumber(), readNumber(), relative);
                const controlTwo = relativePoint(readNumber(), readNumber(), relative);
                const point = relativePoint(readNumber(), readNumber(), relative);
                addPoint(controlOne);
                addPoint(controlTwo);
                addPoint(point);
                current = point;
                break;
            }
            case 'S': {
                const controlTwo = relativePoint(readNumber(), readNumber(), relative);
                const point = relativePoint(readNumber(), readNumber(), relative);
                addPoint(controlTwo);
                addPoint(point);
                current = point;
                break;
            }
            case 'Q': {
                const control = relativePoint(readNumber(), readNumber(), relative);
                const point = relativePoint(readNumber(), readNumber(), relative);
                addPoint(control);
                addPoint(point);
                current = point;
                break;
            }
            case 'T': {
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                addPoint(point);
                break;
            }
            case 'A': {
                readNumber();
                readNumber();
                readNumber();
                readNumber();
                readNumber();
                const point = relativePoint(readNumber(), readNumber(), relative);
                current = point;
                addPoint(point);
                break;
            }
            default:
                throw new Error(`Unsupported SVG path command: ${command}`);
        }
    }

    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
        throw new Error('SVG path has no coordinates');
    }

    return bounds;
}

function collectPathData(value: unknown, result: string[]): void {
    if (Array.isArray(value)) {
        for (const child of value) {
            collectPathData(child, result);
        }
        return;
    }

    if (!value || typeof value !== 'object') {
        return;
    }

    const objectValue = value as Record<string, unknown>;
    if (typeof objectValue.d === 'string') {
        result.push(objectValue.d);
    }

    for (const [key, child] of Object.entries(objectValue)) {
        if (key !== 'd') {
            collectPathData(child, result);
        }
    }
}

function extractPips(svgText: string, fileName: string): ParsedPip[] {
    const parsed = xmlParser.parse(svgText) as unknown;
    const pathData: string[] = [];
    collectPathData(parsed, pathData);
    if (pathData.length === 0) {
        throw new Error(`No SVG paths found in ${fileName}`);
    }

    return pathData.map(pathValue => {
        const bounds = parsePathBounds(pathValue);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        return {
            center: {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2,
            },
            radius: (width + height) / 4,
        };
    });
}

function createLayout(pips: ParsedPip[]): PipLayout {
    const averageRadius = pips.reduce((sum, pip) => sum + pip.radius, 0) / pips.length;
    const minX = Math.min(...pips.map(pip => pip.center.x - pip.radius));
    const minY = Math.min(...pips.map(pip => pip.center.y - pip.radius));
    const maxX = Math.max(...pips.map(pip => pip.center.x + pip.radius));
    const maxY = Math.max(...pips.map(pip => pip.center.y + pip.radius));
    const width = maxX - minX;
    const height = maxY - minY;
    const scale = 1 / Math.max(width, height);

    return {
        width: round(width * scale),
        height: round(height * scale),
        radius: round(averageRadius * scale),
        points: pips.map(pip => [
            round((pip.center.x - minX) * scale),
            round((pip.center.y - minY) * scale),
        ]),
    };
}

function addArmorLayout(layouts: ArmorLayouts, fileName: string, location: string, count: number, layout: PipLayout): void {
    const locationLayouts = layouts[location] ?? {};
    locationLayouts[count] = layout;
    layouts[location] = locationLayouts;
    if (!ARMOR_LOCATION_ORDER.includes(location)) {
        throw new Error(`Unknown armor location ${location} in ${fileName}`);
    }
}

function addStructureLayout(layouts: StructureLayouts, fileName: string, tonnage: number, location: string, layout: PipLayout): void {
    const tonnageLayouts = layouts[tonnage] ?? {};
    tonnageLayouts[location] = layout;
    layouts[tonnage] = tonnageLayouts;
    if (!STRUCTURE_LOCATION_ORDER.includes(location)) {
        throw new Error(`Unknown structure location ${location} in ${fileName}`);
    }
}

function sortArmorLayouts(layouts: ArmorLayouts): ArmorLayouts {
    return Object.fromEntries(ARMOR_LOCATION_ORDER
        .filter(location => layouts[location])
        .map(location => [location, Object.fromEntries(Object.entries(layouts[location]).sort(([left], [right]) => Number(left) - Number(right)))]));
}

function sortStructureLayouts(layouts: StructureLayouts): StructureLayouts {
    return Object.fromEntries(Object.entries(layouts)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([tonnage, locationLayouts]) => [
            tonnage,
            Object.fromEntries(STRUCTURE_LOCATION_ORDER
                .filter(location => locationLayouts[location])
                .map(location => [location, locationLayouts[location]])),
        ]));
}

function createGeneratedFile(armorLayouts: ArmorLayouts, structureLayouts: StructureLayouts): string {
    const armorJson = JSON.stringify(sortArmorLayouts(armorLayouts), null, 4);
    const structureJson = JSON.stringify(sortStructureLayouts(structureLayouts), null, 4);
    return `export interface BipedPipLayout {
    readonly width: number;
    readonly height: number;
    readonly radius: number;
    readonly points: readonly (readonly [number, number])[];
}

export type BipedArmorPipLayouts = Readonly<Record<string, Readonly<Record<number, BipedPipLayout>>>>;
export type BipedStructurePipLayouts = Readonly<Record<number, Readonly<Record<string, BipedPipLayout>>>>;

export const BIPED_ARMOR_PIP_LAYOUTS: BipedArmorPipLayouts = ${armorJson};

export const BIPED_STRUCTURE_PIP_LAYOUTS: BipedStructurePipLayouts = ${structureJson};
`;
}

function main(): void {
    const sourceDirectory = path.resolve(APP_ROOT, getOption('--source-dir') ?? path.join(resolveMmDataRoot(APP_ROOT), 'data', 'images', 'recordsheets', 'biped_pips'));
    const outputFile = path.resolve(APP_ROOT, getOption('--output') ?? OUTPUT_FILE);
    const armorLayouts: ArmorLayouts = {};
    const structureLayouts: StructureLayouts = {};
    let armorFileCount = 0;
    let structureFileCount = 0;

    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() || !entry.name.endsWith('.svg')) {
            continue;
        }

        const armorMatch = ARMOR_FILE_PATTERN.exec(entry.name);
        if (armorMatch) {
            const location = `${armorLocationNames[armorMatch[1]]}${armorMatch[2] ? '_R' : ''}`;
            addArmorLayout(
                armorLayouts,
                entry.name,
                location,
                Number(armorMatch[3]),
                createLayout(extractPips(fs.readFileSync(path.join(sourceDirectory, entry.name), 'utf8'), entry.name)),
            );
            armorFileCount += 1;
            continue;
        }

        const structureMatch = STRUCTURE_FILE_PATTERN.exec(entry.name);
        if (!structureMatch) {
            continue;
        }

        addStructureLayout(
            structureLayouts,
            entry.name,
            Number(structureMatch[1]),
            structureMatch[2],
            createLayout(extractPips(fs.readFileSync(path.join(sourceDirectory, entry.name), 'utf8'), entry.name)),
        );
        structureFileCount += 1;
    }

    const output = createGeneratedFile(armorLayouts, structureLayouts);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, output, 'utf8');
    console.log(`Generated ${armorFileCount} armor layouts and ${structureFileCount} structure layouts at ${path.relative(APP_ROOT, outputFile)}`);
}

main();
